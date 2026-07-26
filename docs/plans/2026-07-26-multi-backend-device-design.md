# 多设备后端连接与部署设计

## 目标

让同一个移动端网页配置并缓存多个设备网关，浏览器直接连接每台设备自己的透明网关，并同时保持所有已启用后端的 WebSocket：

- Mac mini 托管前端、透明网关和本机 app-server。
- 当前 Mac 运行独立透明网关和本机 app-server。
- 手机从 Mac mini 加载前端后，直接连接两个设备网关，不经中心网关转发。
- 每个设备的线程、模型、权限、审批、草稿和连接状态严格隔离。
- 未选中的设备仍能实时上报运行状态和待审批请求。

不补全 app-server 未返回的桌面工具记录，不引入第二套会话存储。

## 方案比较

### 方案 A：Mac mini 中心代理

Mac mini 保存后端列表并代理其他设备。

优点是浏览器只连接一个入口。缺点是所有流量绕行 Mac mini，形成单点故障，并且中心网关需要理解后端身份和路由。

### 方案 B：浏览器直连每台设备的透明网关

浏览器保存后端配置，每台设备运行自己的网关和回环 app-server。

优点是网关继续透明、故障隔离清晰、设备之间没有转发依赖。缺点是浏览器需要管理多个连接和多个访问口令。

采用本方案。

### 方案 C：浏览器直连原始 app-server

不采用。浏览器 WebSocket 自动携带 `Origin`，当前 app-server 会返回 `403 Forbidden`；远程鉴权还要求浏览器 WebSocket API 无法设置的 `Authorization` 请求头。

## 部署拓扑

```text
手机浏览器
├── HTTP 读取前端：Mac mini :4173
├── WebSocket：Mac mini :4173/ws
│   └── Mac mini 127.0.0.1:18765 app-server
└── WebSocket：MacBook :4173/ws
    └── MacBook 127.0.0.1:18765 app-server
```

每台设备使用独立访问口令。app-server 始终只监听本机回环地址。

## 持久化配置

浏览器 `localStorage` 只保存版本化的连接配置：

```ts
interface BackendConfig {
  id: string;
  name: string;
  baseUrl: string;
  token: string;
  enabled: boolean;
  order: number;
}

interface BackendRegistry {
  version: 1;
  selectedBackendId: string;
  backends: BackendConfig[];
}
```

规则：

- URL 仅允许 `http:` 和 `https:`，保存时去除尾部斜杠。
- `id` 和规范化后的 `baseUrl` 都不得重复。
- 最多保存 8 个后端。
- 无配置时用当前页面 origin 创建默认后端，兼容现有单后端部署。
- 配置损坏时保留可解析条目并回退到当前 origin。
- 不持久化线程、消息、审批和 app-server 事件。

## 网关控制面

业务 WebSocket `/ws` 继续原样转发 JSON-RPC，不注入后端字段。

新增：

```http
GET /api/host
```

返回：

```json
{
  "hostId": "mac-mini",
  "displayName": "Mac mini",
  "hostname": "mac-mini.local",
  "gatewayVersion": "0.2.0",
  "appServerReady": true
}
```

网关通过环境变量接收：

- `CODEX_MOBILE_HOST_ID`
- `CODEX_MOBILE_HOST_NAME`
- `CODEX_MOBILE_ALLOWED_ORIGINS`
- `CODEX_MOBILE_SERVE_STATIC`

`/api/host` 与 `/api/status`：

- 使用与 `/ws` 相同的 token 验证。
- 支持受控 CORS 和 `OPTIONS` 预检。
- 不返回 app-server 密钥或本地敏感路径。
- 检查 app-server 是否就绪，而不是只报告配置 URL。

## 浏览器运行状态

持久化配置之外，每个后端在内存中拥有独立运行状态：

```ts
interface BackendRuntime {
  config: BackendConfig;
  generation: number;
  connection: "connecting" | "online" | "offline";
  client: AppServerClient | null;
  threads: Thread[];
  threadListState: "loading" | "ready" | "error";
  activeThread: Thread | null;
  models: Model[];
  permissionProfiles: PermissionProfile[];
  approvals: RpcMessage[];
  draft: string;
  draftImages: DraftImage[];
  busy: boolean;
  error: string;
}
```

连接池为每个启用的后端建立独立 WebSocket：

1. 打开 `/ws?token=...`。
2. 执行 `initialize` 和 `initialized`。
3. 并行读取模型、权限、配置和线程列表。
4. 将所有通知写入来源后端的运行状态。
5. 每个后端独立指数退避重连。
6. 使用 `generation` 丢弃旧连接的迟到事件。

一个后端断线不得关闭、清空或阻塞其他后端。

## 设备切换

`selectedBackendId` 只决定当前展示哪个运行状态，不关闭任何连接。

切换时：

- 保存当前设备的会话位置、草稿和图片。
- 展示目标设备已加载的线程列表或加载骨架。
- 不发送 `turn/interrupt`。
- 不发送 `thread/unsubscribe`。
- 不复用前一个设备的客户端、审批、模型或权限设置。

切回设备时恢复其原状态。

## 后台任务与审批

设备标签显示：

- 在线圆点。
- 进行中任务旋转标记。
- 待审批数量。
- 离线或重连状态。

未选中设备收到审批时：

- 将请求加入来源设备的审批队列。
- 显示带设备名的全局提醒。
- 不在当前设备上直接弹出审批 Sheet。
- 用户点击提醒后切换到来源设备，再显示审批。
- 回答始终通过来源设备的 `AppServerClient` 发送。

多个设备同时审批时分别排队。删除存在运行任务或待审批请求的设备需要二次确认。

## 配置界面

Remote 页的设备标签保持横向滚动，末尾增加添加按钮。设备管理 Sheet 支持：

- 添加设备。
- 修改显示名称、网关 URL 和 token。
- 测试连接。
- 启用或暂停设备。
- 调整顺序。
- 删除设备。

保存前请求 `/api/host` 并临时完成一次 WebSocket `initialize`，同时检查 `hostId` 和 URL 重复。

首版不做自动发现、二维码配对、配置云同步或公网访问。

## 错误与恢复

- 单设备连接失败：只在对应设备标签显示错误，并独立重连。
- token 错误：停止自动重连，提示编辑配置。
- app-server 未就绪：网关返回明确状态，前端保留配置并退避重试。
- 页面重新加载：恢复所有启用配置并重新建立连接。
- 旧连接通知：通过 `generation` 忽略。
- 配置被删除：关闭对应连接并撤销 Blob URL。
- 审批在重连期间失效：从队列移除并提示已过期，不向其他设备转发。

## 安全边界

- 原始 app-server 不暴露到局域网。
- 每台网关使用不同高熵 token。
- token 只用于设备网关，不复用 Codex 登录凭据。
- CORS 只允许配置的前端 origin。
- Markdown 不执行 HTML，减少本地存储 token 被脚本读取的风险。
- 局域网 HTTP 属于可信网络模式；公网或不可信网络必须增加 HTTPS/WSS 和正式认证。

## 部署

Mac mini 已确认：

- `mac-mini.local` / `192.168.100.8`
- 用户 `loock`
- macOS 26.5.2，arm64
- Node 24.14.1
- Codex CLI 0.144.6
- 4173 与 18765 当前空闲
- 目标仓库尚不存在

部署采用用户级 LaunchAgent：

- Mac mini 使用 combined 模式，托管静态前端并管理本机 app-server。
- 当前 Mac 使用独立网关作为第二后端。
- 服务配置和 token 文件权限限制为当前用户。
- 更新前保留上一版构建和 LaunchAgent 配置，失败时可恢复。

## 验收

自动化：

- 配置规范化、迁移、去重和损坏恢复。
- 两个模拟网关并发连接。
- 后端状态、事件和审批完全隔离。
- 切换设备不关闭旧连接。
- 单设备掉线不影响其他设备。
- 审批响应使用正确客户端。
- 配置管理 UI。
- 双网关移动视口 E2E。

真实局域网：

- Mac mini LaunchAgent 自动启动并通过健康检查。
- 手机或真实浏览器同时连接 Mac mini 与当前 Mac。
- 两个设备加载各自线程列表。
- 分别发起只回复 `E2E_OK` 的安全测试会话。
- 切换设备时两个连接持续在线。
- 停止一个网关后另一个继续可用，恢复后自动重连。


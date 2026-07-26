# 多设备后端改造、部署与测试实施计划

## 原则

- 采用 TDD：每一阶段先增加失败测试，再实现最小代码，最后重构。
- app-server JSON-RPC 保持透明，不增加业务协议包装。
- 所有线程、消息和审批状态按 `backendId` 隔离。
- 本地完整测试通过后才部署 Mac mini。
- 部署和回滚都通过 SSH 在 Mac mini 上执行。

## 第一阶段：后端配置存储

测试：

- 新增 `tests/ui/backend-registry.test.ts`。
- 覆盖当前 origin 默认配置、URL 规范化、重复检测、最多 8 个设备、损坏数据恢复、选择项回退。

实现：

- 新增 `src/backends/types.ts`。
- 新增 `src/backends/registry.ts`。
- 封装 localStorage 读写和 schema 版本。

验收：

- 新测试由红转绿。
- 现有单元测试、类型检查保持通过。

## 第二阶段：网关设备信息和 CORS

测试：

- 扩展 `tests/server/gateway.test.ts`。
- 覆盖 `/api/host`、token、允许/拒绝 origin、OPTIONS、app-server readiness 和不泄漏敏感配置。

实现：

- 扩展 `GatewayOptions` 的设备身份与允许 origin。
- 新增 `/api/host`。
- 为控制接口增加受控 CORS。
- 保持 `/ws` 原样转发。
- 扩展 `server/index.ts` 的运行环境配置。

验收：

- 两个不同配置的测试网关返回不同身份。
- 原有透明转发测试保持通过。

## 第三阶段：多连接池

测试：

- 新增 `tests/ui/backend-connection-manager.test.ts`。
- 使用两个可控假 WebSocket 后端。
- 覆盖并发 initialize、独立重连、迟到通知丢弃、关闭单设备、错误隔离和正确客户端响应。

实现：

- 新增 `src/backends/connection-manager.ts`。
- 新增 `src/backends/runtime.ts`。
- 将单一 `socketRef`、`clientRef` 和重连逻辑迁入连接池。
- 一个配置对应一个 runtime 和一个 `AppServerClient`。

验收：

- 两个后端可同时在线。
- 一个连接失败时另一个状态不变。

## 第四阶段：按设备隔离业务状态

测试：

- 扩展连接池测试和 React 组件测试。
- 覆盖线程列表、活动线程、模型、权限、草稿、图片、busy 和审批不跨设备。
- 覆盖设备切换不调用 interrupt、unsubscribe 或 close。

实现：

- 将 `App.tsx` 的单后端状态改为 `backendId -> runtime`。
- 所有通知和请求处理器捕获来源 `backendId`。
- `loadThreads`、`openThread`、`send`、`interrupt`、审批响应均显式接收后端上下文。
- 每个后端保存自己的页面状态。

验收：

- 切换后立即显示目标设备数据。
- 隐藏设备继续接收实时事件。

## 第五阶段：设备管理与多主机 UI

测试：

- 新增设备管理组件测试。
- 扩展 `tests/e2e/mobile.spec.ts`。
- 覆盖添加、编辑、测试、禁用、删除、排序、在线状态、运行标记和审批角标。

实现：

- 新增 `src/features/backends/BackendSwitcher.tsx`。
- 新增 `src/features/backends/BackendManagerSheet.tsx`。
- 新增 `src/features/backends/BackendAttentionBanner.tsx`。
- 调整 `ThreadListPage` 接收多设备视图模型。
- 审批 Sheet 只展示当前设备队列；后台审批通过提醒切换。
- 增加对应移动端样式。

验收：

- 360、390、412 像素宽度无横向页面溢出。
- 设备标签自身可横向滚动。

## 第六阶段：双网关浏览器 E2E

测试基础设施：

- 增加两个假 app-server / 网关实例。
- 静态前端使用独立 origin。
- 为测试 origin 配置 CORS。

场景：

1. 添加两个后端并在刷新后恢复。
2. 两个 WebSocket 同时完成 initialize。
3. 两个设备显示不同线程。
4. 隐藏设备发出运行事件和审批请求。
5. 点击审批提醒切换并通过正确连接响应。
6. 停止一个后端，另一个继续工作。
7. 恢复后端并验证自动重连。

## 第七阶段：构建与本地验收

运行：

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

另做 412×915 真实 Chrome 检查：

- 多设备标签。
- 配置 Sheet。
- 切换保持滚动和草稿。
- 后台运行/审批提示。
- 所有弹框吸顶和无页面横向溢出。

## 第八阶段：Mac mini 部署

只读确认目标身份后：

1. 将已测试代码部署到 Mac mini 用户目录。
2. 安装依赖并构建。
3. 生成 Mac mini 独立高熵 token。
4. 创建用户级 LaunchAgent。
5. 启动 combined 网关和 managed app-server。
6. 验证 4173 局域网监听、18765 仅回环监听。
7. 验证 `/api/host`、静态前端和 WebSocket initialize。

当前 Mac：

1. 使用不同 token 启动独立网关。
2. 保持 18765 仅回环监听。
3. 验证 Mac mini 前端可跨源连接。

## 第九阶段：真实双设备验收

从 Mac mini 前端：

1. 添加 Mac mini 和当前 Mac 两个后端。
2. 确认两个后端同时在线。
3. 分别加载线程列表。
4. 在两端分别发送安全的 `E2E_OK` 请求。
5. 在一个设备任务进行中时切换另一个设备。
6. 验证后台状态仍实时更新。
7. 临时停止一个网关并确认另一个不受影响。
8. 恢复并验证自动重连。

## 第十阶段：审查与交付

- 检查工作区只包含本任务变更。
- 运行 `git diff --check` 和完整测试。
- 审查 token、日志、CORS 和跨设备状态泄漏。
- 提交实现代码，不自动推送远端。
- 报告本地与 Mac mini 服务地址、LaunchAgent、测试结果和回滚方法。


# 桌面程序控制通道

本阶段提供独立 `control` 命令及 Node 客户端。传输为程序 → 鉴权 WebSocket → CDP → 桌面 renderer 的 electronBridge → 桌面既有 host/app-server 连接。网关不会为该通道另起 app-server，也不会向现有服务重新 initialize。

当前启动器的 CDP 模式已使用结构化通道，并提供现有 Web 页面。主按钮“启动并打开 Web”会等待服务启动成功后打开网页；原 managed/external 模式可继续选择。实际桌面及 Dots 验收仍待完成。

## 启动

工作目录 `/Users/loock/myFile/codex-launcher`。需要目标桌面已开放本机 CDP 且只有一个主窗口，renderer 有兼容的 electronBridge。

```sh
npm run build:server
CODEX_MOBILE_TOKEN='请替换为自己的长随机口令' node bin/codex-mobile.mjs control --port 19878
```

配置：HOST 默认 127.0.0.1，CODEX_MOBILE_CDP_URL 默认 http://127.0.0.1:9333；访问口令必须提供。连接为 `ws://127.0.0.1:19878/ws?token=<口令>`。口令不要写进源码或日志。服务只附加连接，不启动、重启或退出桌面应用。

## Node 调用

```js
import {DesktopControlClient} from './npm-dist/server/cdp/control-client.js';

const url = new URL('ws://127.0.0.1:19878/ws');
url.searchParams.set('token', process.env.CODEX_MOBILE_TOKEN);
const client = new DesktopControlClient(url.href);
try {
  const status = await client.connect('local');
  const projects = await client.request('project/list', {limit: 100});
  const threads = await client.request('thread/list', {
    limit: 100, archived: false, sortKey: 'recency_at', useStateDbOnly: true
  });
  console.log({status, projects, threads});
} finally {
  client.close();
}
```

`scripts/desktop-control-example.mjs` 默认只列项目和会话第一页。明确带 `--thread ID --send TEXT` 时，会读取元数据和历史，订阅事件，发送一次并按返回的 turn ID 等待完成。它不会自动审批。

```sh
CODEX_MOBILE_TOKEN='同一个口令' node scripts/desktop-control-example.mjs
```

项目/会话/历史返回 nextCursor 时继续分页；不能把第一页当完整列表。

## 请求与事件

普通 WebSocket 请求形状：

```json
{"id":"r1","method":"initialize","params":{"hostId":"local"}}
```

然后发送 project/list、project/read、thread/list、thread/read、thread/search、thread/turns/list、thread/items/list、thread/start、thread/resume、turn/start、turn/interrupt。params 原样遵循该安装包的 app-server schema；网关只允许列出的业务方法。

```json
{"id":"r2","method":"desktop/subscribe","params":{"threadIds":["目标会话ID"]}}
```

threadIds=null 表示当前 host 全部会话；[] 只接没有 threadId 的目录通知。desktop/unsubscribe 取消业务订阅并撤销已投递审批的回答权限。恢复、发送、新建均不隐式改变订阅。Web 会显式订阅当前会话；程序客户端也应先订阅，再发送，避免迟到结果恢复用户已取消的订阅。

事件包含 method、params、hostId、channelSessionId、sequence，保留原 thread/turn/item ID。sequence 属于源通道，按会话过滤后可能自然跳号，不等于一定丢包。本版没有事件回放和自动快照恢复。断线需关闭旧客户端/通道、建立新通道并主动回读历史。

审批作为带 id 的服务器请求事件发出。程序选定回答后：

```js
await client.request('desktop/approval/respond', {
  approvalId: event.id,
  result: {decision: 'decline'}
});
```

回答内容随 request.method 改变；输入问题和权限请求不能固定套用 decision。返回 submitted=true/confirmed=false 只表示交给桌面 bridge；收到 serverRequest/resolved 才清除原 pending。桌面可能先行处理，手机不得重复响应或自动重试。

## 失败和当前限制

- 写入超时或失联返回 ACTION_WRITE_UNKNOWN；发送、创建、审批均不自动重发。
- 通道断线后不能复用同一 DesktopControlChannel 实例，需新实例/新会话身份。
- 当前可接收附加监听后出现的审批；启动前的 pending 快照尚未恢复，capabilities.approvalSnapshot=false。
- 当前支持所分析的 codex-host-chunked-message-v1 重组，不重复 ACK；8 MiB/100000 token/64 层限制或序号缺失时停止通道。真实桌面契约仍需验证。
- 项目读取目前是底层 project/list；桌面旧项目 ID 映射、置顶、跨宿主侧栏合并尚未接入。
- Dots 不走此阶段的 Codex thread 协议，capabilities.dots=false。
- thread/resume 不是桌面导航。真实 UI 是否更新用户消息、乐观状态、侧栏及当前页面必须单独验收。

## 验证证据

受控 Electron fixture 使用真实 contextBridge、ipcRenderer.invoke、ipcMain.handle 与主进程事件；程序通过真正 WebSocket/CDP 取得项目两页、会话及历史，发送后同时更新受控桌面正文，收到增量/完成，处理审批并收到 resolved；未订阅客户端无法回答。

代码测试覆盖请求身份、结果隔离、未知写入、审批单次提交、分块重组、旧 socket 事件、取消及切换订阅、迟到创建结果、断线审批取消。实际 ChatGPT 账号未执行这些操作；此前应用工具明确拒绝访问 com.openai.codex，本轮没有改用 CDP 绕过该限制。

最终记录：默认全套 384 通过、3 跳过；控制通道受控集成及相关测试 13 通过；server 类型检查与编译通过。日志分别为 /tmp/codex-control-suite.log 和 /tmp/codex-control-live.log。

## 2026-10-09 Web 与启动器接入

- control 网关提供 dist 静态 Web、/api/host、/api/projects（全部项目分页转成目录），支持现有 Web 添加设备。
- Web 识别 desktop-control，沿用桌面模型与权限；历史按 turn/item 分页加载，接收增量并提交审批。新建、发送、停止、审批已在受控 Electron 窗口走完整 Web 交互。
- 恢复期间收到新消息会重读稳定快照；过期恢复和迟到新建结果不会改变当前会话/订阅。未知写入不自动恢复成可再次提交的草稿。
- 启动器新配置使用 CDP 9333；历史配置保存的端口需要按当前桌面 CDP 设置核对。启动器使用自有 HTTP 端口，默认19877；独立control命令默认19878。
- 单独托管在 HTTPS 的 Web 需使用可访问的 HTTPS/WSS 网关地址；本地启动器提供的同源网页可直接使用。
- 当前安装包26.1002.52244(build13536)的静态IPC契约与文本流广播匹配。审批在绑定hostEventHandler的场景可能仅走AppHost，因此现有window监听器不能保证收到真实桌面的全部审批；启动前审批快照同样尚未实现。
- 真实工具再次拒绝访问com.openai.codex，未通过CDP操作真实会话。9333的发现接口与唯一普通主窗口已只读确认。

2026-10-09 最终交付：完整测试396通过、4跳过，独立受控Web/IPC集成2项通过，启动器arm64打包完成且资源一致性核对通过。已打开自身启动器并确认配置9333/19877；真实桥接仍待人工启动验收。

## 模型、远程项目与历史修复

当前版本增加model/list。Web中的模型与思考强度选择只在显式选择后发送，权限继续由桌面控制。设备连接弹窗增加“远程项目”开关；通过鉴权/api/desktop/hosts读取桌面已配置为连接的SSH/remote-control/WSL主机最小信息，以独立hostId握手。/api/projects与/api/host接受hostId参数；虚拟设备只存在于运行时，原始设备注册表只保存开关。

分块解析现在过滤不属于控制通道的响应；自身响应按64MiB组装资源预算限制，大只读响应返回RESPONSE_TOO_LARGE并减小历史分页，大写入响应返回ACTION_WRITE_UNKNOWN。历史页附加__desktopSnapshotSequence，Web据此重放快照之后的事件，持续产生消息时也可以打开会话。

412项测试通过，真实受控Web和IPC集成2项通过。该验证未操作用户真实ChatGPT或远程主机会话。

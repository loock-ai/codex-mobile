# Desktop 与 Web 共享 App Server

## 目标与验收

Desktop 与 Mobile 操作同一会话，消息和运行状态双向同步；空闲时两端都可以发送，运行时追加引导消息。必须用真实 Desktop 和浏览器验证，单元测试不能代替最终验收。

## 已核验的现场

- Desktop 二进制：`/Applications/ChatGPT.app/Contents/Resources/codex`，版本 `0.154.0-alpha.6.2`。
- Desktop 当前以 stdio 启动私有 App Server，没有可连接的监听套接字。
- Desktop 的 `app.asar` 中 `src-CCXHtyvY.js` 的 `DH` 函数读取 `CODEX_APP_SERVER_WS_URL`；`CODEX_APP_SERVER_FORCE_CLI=1` 会禁用该入口。
- `CODEX_APP_SERVER_USE_LOCAL_DAEMON` 有额外的平台、配置覆盖和 bundled Git 条件，不可仅设置这个变量就宣称已共享。
- Mobile 当前启动独立 CLI App Server，版本 `0.151.0`，端口 `18765`。

## 实现路线

保留 Desktop 的界面和 Mobile 的界面，连接同一个使用 Desktop Codex 二进制运行的 WebSocket 服务。当前私有 stdio 进程不能无损转换为监听服务，现场切换需要 Desktop 退出后重新启动。进程身份会改变，因此必须明确记录切换，而不能称为已经附着当前进程。

共享服务绑定回环地址，手机通过已有带口令网关连接。共享服务持有会话，网关关闭不停止共享服务。Desktop 配置与插件参数需要从实际启动环境核验并保留，不能仅复制一个二进制路径。

## 执行清单

- [x] 网关增加显式 desktop 模式，使用 `CODEX_APP_SERVER_WS_URL`，缺失时拒绝启动。
- [x] 对地址缺失、错误协议、远程主机和 URL 凭据写失败测试，再实现并验证。
- [ ] 完成共享服务和 Desktop 启动工具，校验 Desktop 支持此入口，保留运行配置，检测端口归属与现有 Desktop 进程。
- [ ] 用隔离测试会话验证两个真实协议客户端的订阅、发送、引导与断线重连。
- [ ] 切换前提供完整命令与恢复方案，确认 Desktop 重启时间；本会话正在 Desktop 服务中执行，不能直接结束其进程。
- [ ] Desktop 与 Web 打开同一测试会话，分别发送并核验对端消息、运行状态、审批和完成通知。
- [ ] 验证网关重启不会杀死共享服务，Desktop 退出后的行为符合实际设计。
- [ ] 记录版本、PID、会话 ID 与验证结果后才完成目标。

启动工具进展：`codex-mobile desktop [--check]` 已实现应用入口、现有进程、共享服务就绪检查及环境传递；运行中的 Desktop 会被明确拒绝，不自动结束任务。共享服务目前使用文档中的外部终端命令启动，完整 Desktop 运行环境仍待真实验收。

双向协议进展：集成测试已扩展为直连客户端与经过真实 Mobile 网关的客户端，使用本机 Responses SSE provider，完成三轮交替发送，两端收到流式文字和完成通知。历史恢复采用 Mobile 完整分页参数。尚未验证运行中引导、审批或真实 Desktop 界面。

继续验证：运行中从网关端发送 `turn/steer` 已通过；网关关闭并重新创建后，共享 PID 保持运行，新客户端恢复历史，历史包含引导消息，并能继续发送下一轮。真实 Desktop 界面与审批仍待验证。`npm run build:package` 已通过（Vite 提示主 bundle 超过 500 kB）。

## 当前状态

仅完成网关接入规则。19 项相关测试与 TypeScript 检查通过；未切换服务、未重启 Desktop、未部署、未完成双端联调。

## 真实协议测试发现

已新增 `tests/server/desktop-sharing.integration.test.ts`，通过 `CODEX_DESKTOP_TEST_BINARY` 显式运行。测试使用临时 HOME/CODEX_HOME 和仅指向回环拒绝端口的独立 provider，不读取个人认证，不调用真实模型。

2026-09-15 在 Desktop 0.154.0-alpha.6.2 上执行：两个连接 initialize 成功，thread/start 与 turn/start 成功，但第二连接 thread/resume 返回 `list_turns is not supported yet`。因此共享协议兼容性尚未证明，必须先定位存储后端或参数差异，再切换 Desktop。另一个发现是没有发送过消息的新线程恢复返回 `no rollout found`，不能用空线程验证跨连接恢复。

重现命令：

```sh
CODEX_DESKTOP_TEST_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex npm test -- tests/server/desktop-sharing.integration.test.ts
```

后续定位：测试漏传 `initialTurnsPage`。仅传 `excludeTurns: true` 会触发上述错误；使用 Mobile 实际参数 `excludeTurns: true` 加 `initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" }` 后真实双连接恢复测试通过。无需修改 Mobile 的恢复参数。显式设置 `experimental_thread_store.type=local` 对该错误无效，已从测试移除。

此结果仅证明同一个服务允许两个协议连接恢复同一会话和返回分页历史，尚不证明真实 Desktop 界面的通知、发送与审批功能通过。

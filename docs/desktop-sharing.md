# Desktop 与 Mobile 共享服务（联调中）

实际切换请优先使用 [另一台电脑 SSH 操作说明](desktop-sharing-ssh-runbook.md)，在独立 SSH 终端完成关闭、启动和恢复，避免本会话随 Desktop 关闭而中断操作。

本功能尚未完成真实 Desktop/Web 界面验收。当前已验证 Desktop 内置 Codex 的两个客户端可以恢复同一会话：一端直连，另一端经过带口令的真实 Mobile 网关，轮流发送三轮消息，两端均收到流式文字与完成通知。测试使用本机 Responses SSE fixture，没有调用真实模型。

还验证了运行时跨端 `turn/steer`、引导消息持久化，以及网关关闭再启动后，共享服务继续存活，新连接恢复历史并继续发送。真实 Desktop 界面的审批与通知仍待联调。

## 前提

当前测试版本为 ChatGPT Desktop 内置 `codex-cli 0.154.0-alpha.6.2`。Desktop 安装包中存在 `CODEX_APP_SERVER_WS_URL` 内部入口，但不是公开稳定接口。升级后需重新验证。当前阶段只验证本机，共享变量对 Desktop 远程机器的影响仍需检查。

Desktop 已运行的私有 stdio 进程不能直接转换成共享监听服务。切换会建立新的共享进程，并由 Desktop 与 Web 一起连接。必须先让现有任务完成，退出 Desktop，再启动共享连接。

## 准备

在仓库执行 `npm run build:package`。保留原来的生产服务与配置，联调使用独立端口 `19876` 和 `19877`。

在外部终端启动共享服务（保持终端运行）：

```sh
/Applications/ChatGPT.app/Contents/Resources/codex \
  -c features.code_mode_host=true \
  -c plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true \
  app-server --analytics-default-enabled --listen ws://127.0.0.1:19876
```

这些参数对应勘察时 Desktop 启动的主要参数；完整运行环境、插件与资源路径仍需通过界面联调核验。

退出 Desktop 后，从仓库目录预检并启动：

```sh
CODEX_APP_SERVER_WS_URL=ws://127.0.0.1:19876 node bin/codex-mobile.mjs desktop --check
CODEX_APP_SERVER_WS_URL=ws://127.0.0.1:19876 node bin/codex-mobile.mjs desktop
```

工具检查应用入口、运行中的 Desktop 进程以及共享服务健康状态。它不自动退出 Desktop、不修改安装包、不修改 launchctl 全局环境。成功启动只说明进程已启动，不代表连接和功能已验收。

另一个终端从仓库启动本机 Web 网关：

```sh
HOST=127.0.0.1 PORT=19877 \
CODEX_APP_SERVER_MODE=desktop \
CODEX_APP_SERVER_WS_URL=ws://127.0.0.1:19876 \
CODEX_MOBILE_RUNTIME_FILE=/tmp/codex-mobile-desktop-test-runtime.json \
node bin/codex-mobile.mjs start
```

访问 `http://127.0.0.1:19877`。局域网访问仍须配置已有的网关口令。网关关闭不会停止外部共享服务。

## 界面验收（尚未执行）

1. 检查 Desktop 不再创建独立 stdio App Server，Desktop 与网关连接同一个 PID 的监听端口。
2. 创建测试会话，在两端打开；Desktop 发消息后 Web 显示回复，Web 发消息后 Desktop 显示回复。
3. 运行时从另一端追加引导消息，核对消息不丢失、不重复、不产生写锁错误。
4. 检查审批、工具调用、历史分页、断线重连及 Desktop 远程机器连接。
5. 关闭网关并重新启动，共享任务继续存在。

## 恢复

完成或停止测试任务后退出共享连接的 Desktop；停止测试网关和共享服务的对应终端进程；正常从 Finder 打开 Desktop，即恢复默认启动方式。此流程未修改原生产网关的配置。

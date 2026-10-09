# 在 Mac mini 上操作：通过 SSH 切换 MacBook Desktop 共享服务

目标机：`macbook`，`loockdeMacBook-Pro.local`，用户 `loock`，当前 IP `192.168.100.17`。
操作机：**Mac mini**。请在 Mac mini 上打开终端或运行 Agent，执行本说明。

本文在 Mac mini 的路径：`/Users/loock/Documents/New project/codex-desktop-sharing-ssh-runbook.md`。项目代码、日志、测试服务均位于远程 **MacBook**；不要求 Mac mini 有项目目录。

**所有命令块都从 Mac mini 执行，涉及 MacBook 的操作已经带上 SSH 包装。不要先登录交互式 SSH 再粘贴整块命令。MacBook Desktop 关闭不会结束 Mac mini 上的 Agent 会话。**

**本文是待执行操作说明，本次没有关闭 Desktop 或部署服务。** 当前方案使用未公开的 `CODEX_APP_SERVER_WS_URL` 内部入口，协议自动测试已通过，真实 Desktop/Web 界面还需要按最后一节验收。它需要重新启动 Desktop 连接共享服务，不能直接接入原 stdio 进程。

## 1. 在 Mac mini 验证 SSH 和远程恢复入口

在 Mac mini 上保留两个终端，一个操作，一个备用。先检查远程连接：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
hostname
whoami
MACBOOK
```

备用窗口同样留在 Mac mini，需要时直接执行第 8 节恢复命令。不要在 MacBook 当前 Codex 会话内部执行关闭 Desktop。

从 Mac mini 查询 MacBook 的桌面登录状态：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
hostname
whoami
stat -f '%Su' /dev/console
MACBOOK
```

预期主机为 `loockdeMacBook-Pro.local`，用户及桌面登录用户都是 `loock`。如果桌面用户未登录，先登录；SSH 本身不能创建一个可用的图形桌面登录会话。可先用另一窗口执行下面的恢复命令，确认能正常调用图形会话：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
/usr/bin/open -a /Applications/ChatGPT.app
MACBOOK
```

此时 Desktop 已在运行，该命令只激活它。若提示无法打开 App 或没有权限，先解决该问题，不要进入关闭步骤。

## 2. 在 Mac mini 触发 MacBook 构建与测试

在 Mac mini 的操作窗口执行，SSH 会在 MacBook 工作目录中构建：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
export PATH="/Users/loock/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/loock/myFile/codex-web-mobile || exit 1
set -e
command -v node
git status --short
npm run build:package
CODEX_DESKTOP_TEST_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex npm test -- tests/server/desktop-sharing.integration.test.ts tests/server/desktop-launch.test.ts tests/server/app-server-manager.test.ts tests/server/gateway.test.ts
MACBOOK
```

每一步必须成功后再继续。当前共享功能尚未提交，因此使用目标机现有工作目录，**不要 git reset、清理工作区或重新拉取覆盖本次文件**。Node 路径是本次现场核验值，如果不存在，先用机器实际 Node 路径替换。

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
umask 077
mkdir -p /Users/loock/.codex-mobile/desktop-share-test
lsof -nP -iTCP:19876 -sTCP:LISTEN
lsof -nP -iTCP:19877 -sTCP:LISTEN
MACBOOK
```

两个端口预期都没有监听。若有进程，先识别归属，不要直接结束未知进程。

## 3. 从 Mac mini 在 MacBook 后台启动共享服务

先启动后台服务，验证可以监听。此阶段不要在新服务打开现有会话，以免与旧服务争锁。

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
nohup /Applications/ChatGPT.app/Contents/Resources/codex \
  -c features.code_mode_host=true \
  -c plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true \
  app-server --analytics-default-enabled --listen ws://127.0.0.1:19876 \
  </dev/null \
  >/Users/loock/.codex-mobile/desktop-share-test/app-server.log 2>&1 &
printf '%s\n' "$!" > /Users/loock/.codex-mobile/desktop-share-test/app-server.pid
MACBOOK
```

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
curl --fail --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:19876/readyz
lsof -nP -iTCP:19876 -sTCP:LISTEN
MACBOOK
```

必须得到 HTTP 成功，并确认监听程序是 Desktop 内置 Codex。失败时查看 `tail -n 80 /Users/loock/.codex-mobile/desktop-share-test/app-server.log`，此时旧 Desktop 仍可继续使用。

`nohup` 加重定向允许服务在 SSH 断开后继续运行；这里只是临时联调启动，不配置开机启动。服务环境、Desktop 插件及远程机器支持仍需实测，不能仅凭 readyz 成功判定完整可用。

## 4. 从 Mac mini 退出 MacBook 的旧 Desktop

先确认当前任务已经结束，停止或完成正在运行的任务，并保存其他未完成工作。记录本会话 ID：

```text
019f9e0b-4afc-74a3-a399-9ed6e5d32ff5
```

记录原生产网关是否运行：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
launchctl print gui/$(id -u)/vip.loock.codex-mobile-web.gateway
MACBOOK
```

只在其原来确实运行、且确认可暂停 Mobile 后执行下面的停用。目的是停止旧独立 App Server，避免其他 Mobile 连接继续持有同一会话：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
launchctl bootout gui/$(id -u)/vip.loock.codex-mobile-web.gateway
MACBOOK
```

从 SSH 温和退出 Desktop：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
/usr/bin/osascript -e 'tell application "ChatGPT" to quit'
ps -axo pid,ppid,command | rg '/Applications/ChatGPT.app/Contents/(MacOS/ChatGPT|Resources/codex)'
MACBOOK
```

确认 Desktop 主程序及其旧 stdio App Server 已退出，而第 3 步带 `--listen ws://127.0.0.1:19876` 的共享进程仍在。若退出被弹窗或权限阻止，处理后再继续；不要用宽泛的 `pkill codex`，它会误伤共享服务和其他任务。

## 5. 从 Mac mini 重新打开 MacBook Desktop

先预检：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
export PATH="/Users/loock/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/loock/myFile/codex-web-mobile || exit 1
cd /Users/loock/myFile/codex-web-mobile
CODEX_APP_SERVER_WS_URL=ws://127.0.0.1:19876 node bin/codex-mobile.mjs desktop --check
MACBOOK
```

预检通过后，使用 macOS 的应用启动命令（本机已核验支持 `--env`）：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
/usr/bin/open -a /Applications/ChatGPT.app \
  --env CODEX_APP_SERVER_WS_URL=ws://127.0.0.1:19876 \
  --env CODEX_APP_SERVER_FORCE_CLI=0
MACBOOK
```

这里环境变量仅传给这次新启动的 Desktop，不执行 `launchctl setenv`。因此恢复时普通打开 App 即可。App 必须先退出，否则 `open` 只会激活旧实例，变量不会生效。

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
curl --fail http://127.0.0.1:19876/readyz
lsof -nP -iTCP:19876
ps -axo pid,ppid,command | rg '/Applications/ChatGPT.app/Contents/(MacOS/ChatGPT|Resources/codex)'
MACBOOK
```

验收重点：Desktop 连接到 19876，没有再启动负责本机会话的独立 stdio App Server。子进程如 `codex-code-mode-host` 不算第二个 App Server。无法确认时不要对真实会话发送测试消息。

## 6. 从 Mac mini 启动 MacBook 测试 Web 网关

从原生产环境文件读取现有口令；不要打印环境文件或用 `set -x`。口令缺失则停止，不可暴露无口令的局域网网关。

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
export PATH="/Users/loock/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/loock/myFile/codex-web-mobile || exit 1
cd /Users/loock/myFile/codex-web-mobile
(
  source "/Users/loock/Library/Application Support/CodexMobileWeb/gateway.env"
  test -n "$CODEX_MOBILE_TOKEN" || exit 1
  export CODEX_MOBILE_TOKEN
  export HOST=0.0.0.0 PORT=19877
  export CODEX_APP_SERVER_MODE=desktop
  export CODEX_APP_SERVER_WS_URL=ws://127.0.0.1:19876
  export CODEX_MOBILE_RUNTIME_FILE=/Users/loock/.codex-mobile/desktop-share-test/runtime.json
  nohup /Users/loock/.nvm/versions/node/v24.18.0/bin/node bin/codex-mobile.mjs start \
    </dev/null \
    >/Users/loock/.codex-mobile/desktop-share-test/gateway.log 2>&1 &
  printf '%s\n' "$!" > /Users/loock/.codex-mobile/desktop-share-test/gateway.pid
)
MACBOOK
```

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
export PATH="/Users/loock/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/loock/myFile/codex-web-mobile || exit 1
lsof -nP -iTCP:19877 -sTCP:LISTEN
CODEX_MOBILE_RUNTIME_FILE=/Users/loock/.codex-mobile/desktop-share-test/runtime.json \
  node bin/codex-mobile.mjs auth --plain
MACBOOK
```

最后一条会显示真实带口令的访问链接，仅在私有终端查看。Mac mini 或手机浏览器打开该链接，地址应是 MacBook 的局域网 IP，端口应为 `19877`；不要打开 Mac mini 的 localhost。如果以前保存的设备仍指向原端口，需要新建测试设备或修改对应网关地址到 19877，不能仅凭网页打开就认定已连新服务。

## 7. 在 Mac mini 或手机打开 MacBook 的 Web 页面

实际查看的是 MacBook Desktop 和浏览器中的界面。纯 SSH 不能证明界面显示正确，可由用户查看或通过已授权屏幕共享核验；未查看时报告界面待验收。

先使用专门的测试会话，分别从 Desktop 和 Web 发送短消息，检查对端用户消息、AI 流式输出、完成状态。再验证运行中追加引导、审批按钮、历史分页、网关重启恢复以及原有远程机器连接。

全部通过后再考虑正式开机启动和生产端口迁移；当前测试端口不替代生产配置。记录 Desktop/Codex 版本、共享 PID、测试会话 ID 和结果。

## 8. 恢复：在 Mac mini 的备用终端执行

只要 SSH 仍能登录，就不依赖当前 Codex 会话恢复。先保存或结束共享服务中的任务，再执行：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
/usr/bin/osascript -e 'tell application "ChatGPT" to quit'
MACBOOK
```

核对两个 PID 文件对应的命令：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
ps -p "$(cat /Users/loock/.codex-mobile/desktop-share-test/gateway.pid)" -o pid=,command=
ps -p "$(cat /Users/loock/.codex-mobile/desktop-share-test/app-server.pid)" -o pid=,command=
MACBOOK
```

只有确认分别是本次测试网关和监听 19876 的共享服务时，才执行：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
kill -TERM "$(cat /Users/loock/.codex-mobile/desktop-share-test/gateway.pid)"
kill -TERM "$(cat /Users/loock/.codex-mobile/desktop-share-test/app-server.pid)"
MACBOOK
```

PID 文件不代表进程永远相同，重启机器或进程已退出后不得盲目 kill。确认 19876 已无监听、Desktop 已退出后，普通启动：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
/usr/bin/open -a /Applications/ChatGPT.app
MACBOOK
```

仅在第 4 步停止过原生产网关时恢复它：

```sh
ssh -T macbook '/bin/zsh -s' <<'MACBOOK'
launchctl bootstrap gui/$(id -u) /Users/loock/Library/LaunchAgents/vip.loock.codex-mobile-web.gateway.plist
launchctl print gui/$(id -u)/vip.loock.codex-mobile-web.gateway
MACBOOK
```

若提示任务已加载，先 print 核对，不重复 bootstrap。恢复后 Desktop 回到默认私有服务，Mobile 回到原生产配置；本次临时文件和日志保留用于排查。

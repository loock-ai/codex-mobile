# Codex Mobile 自动安装指南

本文档写给负责安装 Codex Mobile 的 Agent。目标是在一台 macOS 电脑上完成
Codex Mobile 与 Codex CLI 的安装、升级、登录检查、局域网网关配置和开机启动，
最后向用户提供可在手机上直接打开的带 Token 局域网链接。

## 执行要求

- 必须实际执行安装、配置和验证，不要只把命令转述给用户。
- 当前流程仅适用于 macOS；如果系统不是 macOS，停止执行并说明原因。
- Node.js 必须为 20 或更高版本。缺少 Node.js 或 npm 时，先向用户说明并使用其现有
  Node.js 版本管理方式安装；不要直接执行来源不明的 `curl | sh`。
- 不使用 `sudo npm install -g`。遇到全局目录权限问题时，优先沿用用户已有的
  nvm、fnm、Volta 或 Homebrew Node.js 环境。
- 不覆盖用户现有的 Codex 配置、登录凭据或 `~/.codex` 内容。
- 不在 Git 仓库、命令日志或普通配置文件中记录访问 Token。
- 重复执行安装时，保留已有的有效 Token，不要无故更换，避免已配置的手机失效。
- 最终可以向当前用户显示一次完整访问链接，但要提醒该链接包含访问口令，不要公开
  分享。

## 一、检查基础环境

依次检查：

```bash
uname -s
node --version
npm --version
```

确认系统输出为 `Darwin`，Node.js 主版本不低于 20。记录当前 Node.js、npm、
`codex` 和 `codex-mobile` 的实际路径，后续 LaunchAgent 必须使用与当前终端一致的
Node.js 环境：

```bash
command -v node
command -v npm
command -v codex || true
command -v codex-mobile || true
```

## 二、通过 npm 全局安装 Codex Mobile

先查询 npm 上的最新版，再安装或升级：

```bash
npm view codex-mobile version
npm install -g codex-mobile@latest
codex-mobile --version
```

安装后必须确认：

- `command -v codex-mobile` 返回真实可执行路径；
- `codex-mobile --version` 与 `npm view codex-mobile version` 一致；
- `codex-mobile --help` 可以正常运行。

如果版本不一致，执行 `hash -r` 后重新检查。仍不一致时排查 PATH 中是否存在另一个
旧版 `codex-mobile`，不得在版本未确认前继续配置服务。

## 三、安装或升级 Codex CLI

Codex CLI 的 npm 包名是 `@openai/codex`。先读取已安装版本和 npm 最新版本：

```bash
codex --version 2>/dev/null || true
npm view @openai/codex version
```

未安装或版本落后时执行：

```bash
npm install -g @openai/codex@latest
hash -r
codex --version
```

必须比较 `codex --version` 中的版本号与 `npm view @openai/codex version`；只有完全
一致才视为升级完成。同时确认 `command -v codex` 指向刚刚升级后的 CLI，而不是 PATH
中更靠前的旧版本。

检查登录状态：

```bash
codex login status
```

如果尚未登录，运行 `codex login` 并提示用户在浏览器中完成官方登录。登录属于用户
交互步骤，Agent 不得索取、读取或转发用户密码、验证码、API Key 或登录 Token。
完成后再次执行 `codex login status`，确认退出码为 0。

## 四、配置局域网网关

使用以下固定位置保存私有运行配置：

```text
~/.codex-mobile/gateway.env
```

创建目录并将权限限制为当前用户：

```bash
umask 077
mkdir -p "$HOME/.codex-mobile/logs"
chmod 700 "$HOME/.codex-mobile" "$HOME/.codex-mobile/logs"
```

配置文件必须包含：

```bash
export HOST='0.0.0.0'
export PORT='18766'
export CODEX_MOBILE_TOKEN='<64 位十六进制随机口令>'
export CODEX_APP_SERVER_MODE='managed'
export PATH='<Node.js、npm 全局 bin、Codex CLI 所在目录以及系统目录>'
export CODEX_MOBILE_BIN='<command -v codex-mobile 的绝对路径>'
```

具体规则：

1. 如果 `gateway.env` 已存在且其中有非空 `CODEX_MOBILE_TOKEN`，保留原 Token。
2. 只有首次安装或原 Token 无效时，才使用 `openssl rand -hex 32` 生成新 Token。
3. `PATH` 至少包含 `dirname "$(command -v node)"`、
   `dirname "$(command -v codex)"`、npm 全局 bin 目录和
   `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`。
4. 写入后执行 `chmod 600 "$HOME/.codex-mobile/gateway.env"`。
5. 不要把 Token 直接写入 LaunchAgent plist。

## 五、配置 LaunchAgent 开机启动

创建：

```text
~/Library/LaunchAgents/ai.loock.codex-mobile.plist
```

plist 使用以下配置：

- `Label`：`ai.loock.codex-mobile`
- `ProgramArguments`：
  - `/bin/zsh`
  - `-lc`
  - `source "$HOME/.codex-mobile/gateway.env" && exec "$CODEX_MOBILE_BIN" start`
- `RunAtLoad`：`true`
- `KeepAlive`：`true`
- `ProcessType`：`Background`
- `StandardOutPath`：`~/.codex-mobile/logs/gateway.log` 对应的绝对路径
- `StandardErrorPath`：`~/.codex-mobile/logs/gateway.error.log` 对应的绝对路径
- `ThrottleInterval`：`10`

Agent 应使用可靠的 plist 写入方式生成文件，并把 `$HOME` 替换为当前用户的真实绝对
路径。写入后运行 `plutil -lint`，确认格式正确。

重新加载服务：

```bash
launchctl bootout "gui/$(id -u)/ai.loock.codex-mobile" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/ai.loock.codex-mobile.plist"
launchctl kickstart -k "gui/$(id -u)/ai.loock.codex-mobile"
```

不要用长期前台进程代替 LaunchAgent，也不要在安装结束时停止该服务。

## 六、验证服务

依次验证以下结果：

1. `launchctl print "gui/$(id -u)/ai.loock.codex-mobile"` 能看到服务且没有持续退出；
2. `18766` 正在监听局域网地址；
3. `~/.codex-mobile/logs/gateway.error.log` 没有 Codex CLI、登录或端口占用错误；
4. `codex-mobile auth --plain` 能返回完整局域网 URL；
5. 使用该 URL 的 Token 请求 `/api/host` 返回 HTTP 200，并且
   `appServerReady` 为 `true`；
6. 同一局域网内的其他设备可以访问该电脑的 IP 和 `18766` 端口。

获取最终链接：

```bash
codex-mobile auth --plain
```

预期格式：

```text
http://<电脑局域网IP>:18766/?token=<随机口令>
```

如果无法从手机访问，按顺序检查：

- 手机与电脑是否位于同一局域网；
- macOS 防火墙是否允许 Node.js 接收入站连接；
- 当前网络是否启用了客户端隔离；
- VPN 或代理是否阻止了局域网地址；
- `HOST` 是否确实为 `0.0.0.0`；
- 日志中是否存在端口占用、Codex 未登录或 app-server 启动失败。

不要为了排障关闭系统防火墙；只为当前 Node.js/Codex Mobile 服务添加必要权限。

## 七、向用户交付

安装完成后，Agent 必须用简洁中文报告：

```text
Codex Mobile 已安装并设置为开机启动。

手机访问地址：
http://<电脑局域网IP>:18766/?token=<随机口令>

请在与电脑相同局域网的手机浏览器中打开该链接。
Android 用户也可以从下面的页面下载最新版 App：
https://github.com/loock-ai/codex-mobile/releases/latest

链接中包含访问口令，请勿公开分享。
```

同时报告以下非敏感验证信息：

- Codex Mobile 版本；
- Codex CLI 版本与登录状态；
- LaunchAgent 状态；
- 网关监听端口；
- `/api/host` 与 `appServerReady` 验证结果。

除最终访问链接外，不重复输出 Token，不展示 `gateway.env` 全文，也不把 Token 写入
长期日志、Issue、提交信息或聊天摘要。

# 菜单栏启动器实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 按任务执行，TDD 与最终独立审查。

**Goal:** 菜单栏应用配置并启动原 codex-mobile 与新的 CDP 桌面桥接，复用手机前端实现 Codex/Dots 收发审批。
**Architecture:** Electron 主进程调用控制器管理子进程，React 面板经有限 IPC 配置。网关兼容手机 JSON-RPC，CDP 控制桌面页面，未支持能力报错。
**Tech Stack:** TypeScript、React、Electron、playwright-core、ws、Vitest、electron-builder。
**Spec:** docs/superpowers/specs/2026-10-02-desktop-cdp-launcher-design.md

## Global Constraints
- 中文，macOS，保留用户已有未提交改动，默认不开机启动。
- CDP 本机限定，LAN 网关必须鉴权；不强杀、不重放未知写操作。
- 不部署、发布、提交或自动批准；真实验证与模拟验证分开。

## Review Focus
- 多窗口与错误模式：不选择含糊目标。
- 桌面已有草稿：不覆盖。
- 断线发生在发送后：不重新发送。
- 已消失的审批：不点击其他按钮。
- 无效配置和占用端口：保留原配置，不误杀既有服务。

### Task 1: 配置与生命周期控制
**Files:** server/launcher/config.ts、server/launcher/controller.ts；tests/server/launcher.test.ts。
**Interfaces:** LauncherConfig(mode, gatewayPort, cdpPort, appPath, token, cliPath, upstreamUrl)，load/saveConfig，LauncherController(status/start/stop/restartDesktop)。
- [x] 写配置校验、0600 文件、模式启动参数及进程所有权测试并确认失败。
- [x] 实现配置与生命周期，使用固定 execFile/spawn 参数；测试通过。

### Task 2: CDP 页面适配与协议桥接
**Files:** server/cdp/{adapter,protocol,gateway}.ts；tests/server/cdp-bridge.test.ts。
**Interfaces:** DesktopAdapter(snapshot/open/send/stop/approve/close)，DesktopProtocol(request/poll/response)。
- [x] 写线程恢复、收发事件、草稿/会话变更拒绝、审批过期和未支持方法测试并确认失败。
- [x] 实现浏览器本机连接和 DOM 适配；兼容 initialize、thread/list/read/resume/turns/list、turn/start/interrupt 和审批。
- [x] 网关严格复用鉴权，连接/关闭所有权测试通过。

### Task 3: 菜单栏应用与旧模式启动
**Files:** launcher/、scripts/build-launcher.mjs、package.json、bin/codex-mobile.mjs。
**Interfaces:** preload 暴露 getStatus/saveConfig/start/stop/restart/openDesktop；React 面板订阅状态。
- [x] 实现 IPC 白名单；启动参数与状态界面测试通过，渲染页仅可调用限定接口。
- [x] 实现 Electron Tray 和 React 弹出面板；显示状态、二维码、设置、审批与脱敏日志。
- [x] 新增 launcher/CDP 命令及打包，旧 start/auth/desktop 不改变。

### Task 4: 验证与交付
- [x] 跑完整 Vitest、typecheck、前后端 build、diff check。
- [x] 打包当前架构 .app，实际启动并验证面板与旧模式网关；Tray 注册已实现，原生菜单栏交互未完成 Computer Use 验收。
- [x] 在不结束当前工作会话的前提下验证实际 ChatGPT CDP；若必须重启承载当前会话，记录需外部终端完成的验收。
- [x] 独立审查修复关键问题，记录每个尚未完成的真实联调。

## 执行记录
Ruling: 原协议保留为兼容层，能力来源明确为 CDP；不重新实现一套手机 UI。
Ruling: 隔离 worktree 复制当前脏改动作为基线，不提交或覆盖原始改动。

## 验收记录（2026-10-02）

- 364 项单元/集成测试通过、2 跳过；单独启用真实 Electron/CDP 受控测试通过，含复用手机 UI 收发和审批。
- 类型检查、构建、arm64 打包与 diff check 通过。打包应用实际启动并通过自身渲染页操作，原模式以 Desktop 内置 CLI 完成启动/initialize/停止。
- 实际 ChatGPT CDP 可连接，主窗口和输入/侧栏结构只读验证完成。实际账号 Codex/Dots 收发审批未验收：Computer Use 对 com.openai.codex 返回安全拒绝。
- 最终独立审查的五个重要问题已修复并添加回归测试。
- CLI 改为所选 Desktop 安装包 entrypoint，当前版本 0.159.0-alpha.12.1，不用全局 CLI。
- 完整操作说明及未完成边界见 docs/desktop-launcher.md；真实界面验收待办仍保留，不以受控 fixture 替代。

## 完成审计

| 要求 | 当前证据 | 状态 |
| --- | --- | --- |
| 可运行菜单栏 .app、设置与原模式启动 | arm64 打包；实际启动器 renderer/IPC 和 Desktop CLI 握手 | 已验证 |
| 手机前端复用、CDP 文本与审批协议 | 原 React UI + 受控 Electron/CDP 测试 | 实现并受控验证 |
| 真实 ChatGPT CDP 可行性 | 本机端点、主窗口、路由和编辑器只读检查 | 已验证 |
| 真实 Codex/Dots 手机桌面同步收发、审批 | Computer Use 对目标 app 安全拒绝；fixture 不足以证明 | 未完成 |
| 保留原工作区 | 原目录 git status 与基线一致，全部新增工作在隔离工作树 | 已验证 |

Dots 静态适配与回归记录见 docs/desktop-launcher.md。完整目标尚未完成，真实交互验收保留为待办。

## 阻塞审计

2026-10-02 再次委派 computer_use，仅调用一次 `cua.getApp("com.openai.codex")`，工具再次返回：`Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.` 未读取或操作该应用。此限制已连续三个目标轮次存在。完整实现与受控验证已交付，但目标标记为 blocked，不能标记 complete。恢复条件为真实应用工具限制解除，或用户完成人工真实验收并提供结果；需要逐项核对手机和桌面消息、Dots 和 Codex 审批、原生菜单栏操作。

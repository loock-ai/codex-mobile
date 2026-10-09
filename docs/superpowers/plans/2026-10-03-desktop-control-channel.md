# 桌面程序控制通道实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 按任务执行。用户已要求直接开干，连续实现与验证，不增加中途确认。

**Goal:** 提供通过桌面既有 IPC 连接读列表、读历史、收发事件与审批的可调用通道。
**Architecture:** 有限 CDP transport 监听 renderer message 并调用 electronBridge；控制通道关联请求、服务器审批和事件；鉴权 WebSocket 与客户端 SDK 对外提供接口。
**Tech Stack:** TypeScript、playwright-core、ws、Electron、Vitest。
**Spec:** docs/superpowers/specs/2026-10-03-desktop-control-channel-design.md

## Global Constraints
- 保留脏工作树；不启动独立 app-server 伪装桌面共享连接。
- 真实应用工具安全限制不能经 CDP 绕过；实际集成仅操作受控 fixture。
- 写入未知不重发，审批只提交一次，网关关闭不退出桌面。
- 接口先作为独立 control 命令提供；真实契约与 UI 同步验收前不切换启动器默认传输。

## Review Focus
- 请求 ID 与桌面已有请求不冲突，多客户端结果隔离。
- 事件先于 response、审批被桌面解决、断线后写入结果未知。
- 监听器不拦截桌面事件、不重复 ACK、不把缺失快照当空审批。

### Task 1: 请求与审批路由
- [x] 测试关联、事件、超时、重复回答；先确认失败。
- [x] 实现 server/cdp/control-channel.ts，复测。

### Task 2: renderer transport 与外部接口
- [x] 实现 server/cdp/control-transport.ts，仅连接唯一主窗口，有限监听和 bridge 调用。
- [x] 实现 control-gateway.ts 与 control-client.ts；鉴权、订阅、握手只在网关处理。
- [x] bin 增加 control 命令，编写可执行调用示例和说明。

### Task 3: 受控集成与交付
- [x] Electron fixture 通过真正 preload/main IPC 返回分页、消息流和审批。
- [x] 实际 WebSocket → CDP → renderer → IPC → fixture host 联调；验证桌面状态消费者收到同样事件。
- [x] 类型检查及必要测试；报告真实桌面、Dots、快照和分块限制。

## 执行结果（2026-10-03）

- 默认完整测试：384 通过、3 跳过。
- 单独启用控制通道受控 Electron/CDP 集成：4 文件、13 测试通过。
- server 类型检查、server 编译、CLI help 和 diff check 通过。
- 独立审查提出的重要问题全部关闭，新增订阅切换、取消、迟到创建结果、SDK 旧 socket、通道假重连和审批悬挂回归。
- 新入口为 control 命令及 control-client；程序通道没有替换启动器默认 DOM 模式，未重新打包 .app。
- 实际账号没有被本轮自动操作。真实 ChatGPT UI 同步、启动前审批快照、侧栏显示映射与 Dots 仍未验收/接入，完整原目标保持未完成。

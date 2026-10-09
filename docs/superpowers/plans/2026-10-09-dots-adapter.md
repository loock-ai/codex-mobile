# Dots 独立适配与手机页面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. 使用测试先行，保留工作区既有未提交文件。

**Goal:** 手机网页独立访问桌面已登录账户的 Dots 列表、文字消息历史和收发。
**Architecture:** 窄接口 DotsAdapter 经 DesktopHttpTransport 复用桌面已建立的 AppHost httpFetch；网关只暴露 /api/dots 的白名单业务操作。Dots 页面独立于 Codex BackendWorkspace，以 3 秒轮询获取消息，隐藏页面暂停轮询；不注册第二个 AppView。
**Tech Stack:** TypeScript、React、现有 Playwright CDP、Node HTTP、Vitest、受控 Electron fixture。
**Spec:** 用户确认独立 Dots 适配与手机网页；前序静态证据 /tmp/dots-host-channel-evidence.json 和 /tmp/dots-web-channel-pl7H6N/channel-evidence.json。

## Global Constraints
- 不读取、复制或导出桌面登录凭据；鉴权及设备证明交给宿主现有服务。
- 不调用 thread/start 或 turn/start 代替 Dots 房间消息。
- 对真实 ChatGPT 的既有工具拒绝不可绕过；验收使用受控桌面 fixture，报告真实验收缺口。
- 本期：列表、历史分页、文字发送、自动刷新、状态、未知投递处理。附件、语音、复杂 elicitation/审批暂不开放。
- 确定的400/401/403等失败和写入结果未知分开处理；未知不自动重发。
- 支持当前核实的26.1002.52244构建；未知版本明确提示不支持，禁止猜测导出。

## 协议边界
DesktopHttpTransport: status():Promise<{available:boolean;error?:string}>; request({method:'GET'|'POST',path:string,body?:unknown}):Promise<{status:number;body:unknown}>; close():Promise<void>。
HTTP路由：GET /api/dots/status；GET /api/dots/list?cursor；GET /api/dots/messages?dotId&before；POST /api/dots/send {dotId,text,requestId}。
status: {available,mode:'polling',capabilities:{messages,history,attachments:false,approvals:false},error?}。
list: {dots:[{id,name,roomId:string|null,threadId?:string,paused?:boolean}],nextCursor:string|null}。
messages: {roomId,messages:[{id,role:'user'|'assistant'|'system',text,createdAt,requestId?:string,deleted?:boolean}],before:string|null}。
send: {message:上述消息}；错误 {error:string,code:string}，未知写入用 DOTS_WRITE_UNKNOWN。
所有接口与现有网关同口令；不接受任意上游URL、headers、cookies。

## Tasks
- [x] 1. server/dots/types.ts、adapter.ts、http.ts：业务归一化、分页、请求校验、投递未知，服务端测试。
- [x] 2. server/dots/desktop-transport.ts：复用已初始化 AppHost 导出，构建校验、超时/取消、响应限额、不重复注册；受控fixture测试。
- [x] 3. src/features/dots/：手机页面、API客户端、分页、轮询、错误恢复；React测试。
- [x] 4. 网关/启动器和网页导航集成，受控Electron端到端、全量测试和构建。
- [x] 5. 文档、代码复核，打包安装但不由工具进行真实Dots写入；报告验证边界。

## 验证记录

全量 461 项测试通过，5 项依环境跳过；单独启用受控 Electron 后，Dots Web 与原 Codex Web/IPC 三项集成测试通过。构建和 arm64 打包通过。真实 Dots 账户未执行工具验收；接收为轮询，附件与审批维持未支持。

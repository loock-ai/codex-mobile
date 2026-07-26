# 双机调试部署设计

## 目标

调试阶段由 MacBook 提供可热更新的前端入口；Mac mini 不再托管前端，只提供
自己的透明网关和 app-server。手机始终访问 MacBook。

## 拓扑

### MacBook

- Vite dev server 监听 `0.0.0.0:5173`，提供前端和 HMR。
- 本机网关监听 `0.0.0.0:4173`，托管仅监听
  `127.0.0.1:18765` 的 app-server。
- Vite 将 `/api/*` 和 `/ws` 代理到 `http://127.0.0.1:4173`。
- `npm run dev` 同时管理 Vite 和网关进程；任一进程退出时关闭另一进程。
- 调试阶段不使用 MacBook LaunchAgent，由开发者在终端手动启动和停止。

### Mac mini

- LaunchAgent 继续运行生产网关。
- 网关监听 `0.0.0.0:4173`，托管仅监听
  `127.0.0.1:18765` 的 app-server。
- `CODEX_MOBILE_SERVE_STATIC=false`，不再提供 `dist` 前端。

## 请求流

手机打开 `http://192.168.100.35:5173/?token=<MacBook 口令>`：

1. Vite 返回开发前端并建立 HMR 连接。
2. 当前来源设备通过 Vite 代理访问 MacBook `/api/host` 和 `/ws`。
3. 前端直接跨来源连接 `http://192.168.100.8:4173` 的 Mac mini 网关。
4. 两台网关保持各自独立口令和 app-server 连接。

MacBook 与 Mac mini 网关都允许来源
`http://192.168.100.35:5173`。为兼容已有浏览器配置，暂时继续允许
`http://192.168.100.8:4173` 和 `http://mac-mini.local:4173`。

## 安全与失败处理

- Vite 页面本身仅用于可信局域网调试；实际 `/api` 和 `/ws` 仍要求访问口令。
- 原始 app-server 不暴露到局域网。
- dev 启动器转发 `SIGINT`/`SIGTERM`，避免遗留网关、Vite 或 app-server 子进程。
- MacBook dev 未运行时，Mac mini 网关仍独立运行，但不再提供网页入口。

## 验证

- 单元测试 Vite 监听地址、端口及 HTTP/WebSocket 代理配置。
- 单元测试 dev 双进程启动器的命令和联动退出行为。
- 完整运行单元测试、类型检查、生产构建和既有浏览器 E2E。
- 真实启动 `npm run dev`，从局域网地址 `5173` 打开浏览器。
- 验证 HMR 客户端存在、MacBook 与 Mac mini 同时连接、设备切换正常。
- 验证 Mac mini 的 `/` 返回 404，但 `/api/host` 与 `/ws` 正常。

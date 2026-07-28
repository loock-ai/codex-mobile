# 网关开放跨域并保留 Token 鉴权设计

## 目标

让 Codex Mobile 网关的 HTTP API 和 WebSocket 接受任意来源，解决内置 Android
与 iOS WebView 使用本地页面 Origin 时无法连接的问题。同时继续要求访问 Token，
不改变 app-server 的回环监听和透明转发边界。

## 安全边界

- HTTP API 与 WebSocket 不再检查 Origin。
- 配置了 `CODEX_MOBILE_TOKEN` 时，API 和 WebSocket 仍必须携带正确 Token 或已有
  鉴权 Cookie。
- 非回环地址监听仍必须配置 `CODEX_MOBILE_TOKEN`。
- 原始 Codex app-server 继续只监听回环地址，不直接暴露到局域网。

## HTTP API

控制接口继续处理 CORS 预检。请求携带 Origin 时，响应回显该 Origin 并设置
`Vary: Origin`；不再与白名单比较。API 的路由和 Token 校验顺序保持不变：
跨域允许不代表匿名访问。

## WebSocket

`/ws` 升级请求不再执行 Origin 白名单判断，随后仍执行 Token 校验。路径错误继续
返回 404，Token 错误或缺失继续返回 401，通过鉴权后才连接本机 app-server。

## 配置兼容

废弃 `CODEX_MOBILE_ALLOWED_ORIGINS`。运行时不再解析或要求该变量；旧部署即使仍
保留该变量也不会影响启动和连接。README 中删除白名单配置和同步 IP 的说明。

## TDD 与验证

1. 先把 HTTP 测试改为断言任意 Origin 都返回成功且包含正确 CORS 响应头。
2. 先把 WebSocket 测试改为断言任意 Origin 都能完成升级。
3. 先把运行时安全测试改为断言非回环监听只要求 Token。
4. 运行定向测试，确认旧实现无法满足新测试。
5. 最小化修改网关与运行时配置，使测试通过。
6. 运行完整测试、类型检查和生产构建。

## 非目标

- 不取消 Token。
- 不把 app-server 直接暴露到局域网。
- 不修改前端设备地址格式、持久化方式或移动端打包方式。
- 本次代码实施不自动部署到 Mac mini。

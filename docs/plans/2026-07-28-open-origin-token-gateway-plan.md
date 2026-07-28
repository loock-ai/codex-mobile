# 网关开放跨域并保留 Token 鉴权实施计划

## 任务一：用测试定义开放跨域契约

涉及文件：

- `tests/server/gateway.test.ts`
- `tests/server/app-server-manager.test.ts`

步骤：

1. 将控制接口测试改为：预检成功，任意 HTTP Origin 都能访问，响应回显 Origin。
2. 将 WebSocket 测试改为：任意 Origin 都能完成升级。
3. 将非回环安全测试改为：缺少 Token 时拒绝，存在 Token 时不再要求 Origin。
4. 将运行时配置测试改为：不再解析或返回 Origin 白名单。
5. 运行上述两个测试文件，确认旧实现失败。

## 任务二：最小化修改网关实现

涉及文件：

- `server/gateway.ts`
- `server/app-server-manager.ts`
- `server/index.ts`

步骤：

1. 删除 HTTP 控制接口的 Origin 拒绝分支。
2. CORS 响应直接回显请求 Origin。
3. 删除 WebSocket 升级时的 Origin 拒绝分支。
4. 删除运行时白名单解析和参数传递。
5. 非回环监听只检查 Token。
6. 运行定向测试，确认新契约通过。

## 任务三：更新使用文档

涉及文件：

- `README.md`

步骤：

1. 删除 `CODEX_MOBILE_ALLOWED_ORIGINS` 配置示例。
2. 说明 HTTP API 与 WebSocket 接受任意 Origin，但仍要求 Token。
3. 删除局域网 IP 变化后同步白名单的说明。

## 任务四：完整验证与差异审查

步骤：

1. 运行 `npm test`。
2. 运行 `npm run typecheck`。
3. 运行 `npm run build`。
4. 运行 `git diff --check`。
5. 检查最终差异，确保不覆盖工作区中无关的会话界面修改。
6. 不部署；如需部署 Mac mini，另行确认部署计划。

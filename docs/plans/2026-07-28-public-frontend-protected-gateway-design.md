# 公开前端页面与受保护网关设计

## 目标

未携带 token 访问生产地址时仍返回完整前端页面，避免浏览器显示空白；会话、项目和 app-server 连接继续受到访问口令保护。

## 路由边界

公开访问：

- `/`
- `/index.html`
- `/assets/*`
- 前端路由的 `index.html` 回退

继续鉴权：

- `/api`
- `/api/*`
- `/ws`

正确的 `?token=xxx` 访问前端页面时，网关继续写入现有 HttpOnly Cookie。错误 token 不写入 Cookie，也不能访问 API 或 WebSocket，但仍可加载前端壳并进入设备配置界面。

## 实现

HTTP 请求先判断是否属于 `/api` 路由。只有 API 请求在进入处理逻辑前强制校验 token；静态文件读取不再依赖 token。

WebSocket 的 Origin 与 token 校验保持不变。

## 验证

- 无 token 可读取首页、JS/CSS 和前端路由回退。
- 无 token 或错误 token 请求任意 `/api` 路径仍返回 `401`。
- 正确 token 访问首页会写入 Cookie，Cookie 可继续访问 API。
- WebSocket 无 token 仍返回 `401`。
- 运行完整测试、类型检查和生产构建。

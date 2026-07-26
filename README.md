# Codex Mobile Web

面向局域网手机浏览器的 Codex Remote Web 客户端。界面参考 ChatGPT Android
Remote，协议直接使用 Codex `app-server` V2 双向 JSON-RPC；网关只负责静态资源、
鉴权和 WebSocket 透传。

## 启动

```bash
npm install
npm run build
npm start
```

默认地址为 `http://127.0.0.1:4173`。允许局域网访问时，服务监听
`0.0.0.0:4173`，手机打开 `http://<Mac局域网IP>:4173`。

### Managed 模式（默认）

网关自动启动并管理一个仅监听回环地址的 app-server：

```bash
CODEX_APP_SERVER_MODE=managed \
CODEX_APP_SERVER_PORT=18765 \
npm start
```

### External 模式

连接已经运行的 app-server，网关不管理其生命周期：

```bash
CODEX_APP_SERVER_MODE=external \
CODEX_APP_SERVER_URL=ws://127.0.0.1:18765 \
npm start
```

### 局域网访问口令

建议在局域网启用口令：

```bash
CODEX_MOBILE_TOKEN='<随机口令>' npm start
```

手机访问 `http://<Mac局域网IP>:4173/?token=<随机口令>`。口令仅作为轻量局域网
保护；跨不可信网络应在前面增加 HTTPS 和正式认证。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

协议基准和本地生成物位于
[`protocol/app-server-v2`](./protocol/app-server-v2/README.md)，设计说明位于
[`docs/plans/2026-07-26-codex-mobile-web-design.md`](./docs/plans/2026-07-26-codex-mobile-web-design.md)。

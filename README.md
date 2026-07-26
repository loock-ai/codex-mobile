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

### 多设备调试模式

前端会在浏览器 `localStorage` 中保存最多 8 个设备网关，并同时连接所有已启用
设备。每台 Mac 都运行自己的透明网关和仅监听回环地址的 app-server；设备之间
不互相代理。

调试阶段由 MacBook 提供 Vite 前端和本机网关。先准备
`~/Library/Application Support/CodexMobileWeb/gateway.env`：

```bash
export HOST='0.0.0.0'
export PORT='4173'
export CODEX_APP_SERVER_MODE='managed'
export CODEX_APP_SERVER_PORT='18765'
export CODEX_MOBILE_HOST_ID='macbook-pro'
export CODEX_MOBILE_HOST_NAME='MacBook Pro'
export CODEX_MOBILE_ALLOWED_ORIGINS='http://192.168.100.35:5173,http://192.168.100.8:4173,http://mac-mini.local:4173'
export CODEX_MOBILE_SERVE_STATIC='false'
export CODEX_MOBILE_TOKEN='<MacBook-独立口令>'
```

手动启动真正的开发模式：

```bash
npm run dev
```

该命令同时运行：

- Vite dev server：`http://0.0.0.0:5173`，提供 HMR。
- MacBook 网关：`http://0.0.0.0:4173`。
- MacBook app-server：`ws://127.0.0.1:18765`。

Mac mini 只通过 LaunchAgent 运行本机网关和 app-server，配置中使用：

```bash
export CODEX_MOBILE_HOST_ID='mac-mini'
export CODEX_MOBILE_HOST_NAME='Mac mini'
export CODEX_MOBILE_ALLOWED_ORIGINS='http://192.168.100.35:5173,http://192.168.100.8:4173,http://mac-mini.local:4173'
export CODEX_MOBILE_SERVE_STATIC='false'
export CODEX_MOBILE_TOKEN='<Mac-mini-独立口令>'
```

手机打开
`http://192.168.100.35:5173/?token=<MacBook-独立口令>`，然后在 Remote 页
点击右上角菜单或设备标签后的 `＋`：

1. 输入设备名称、`http://<设备局域网地址>:4173` 和该设备的独立口令。
2. 点击“测试并保存”；前端会检查 `/api/host` 并临时完成一次 WebSocket
   `initialize`。
3. 点击顶部设备标签切换当前设备。未选中的设备仍保持连接，并显示进行中任务和
   待审批数量。

原始 app-server 不应监听局域网地址；只有透明网关监听 `0.0.0.0:4173`。
Mac mini 调试部署不提供网页，访问它的 `/` 会返回 `404`。
如果任一设备的局域网 IP 发生变化，需要同步更新两台网关的
`CODEX_MOBILE_ALLOWED_ORIGINS`，再重启对应网关。

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

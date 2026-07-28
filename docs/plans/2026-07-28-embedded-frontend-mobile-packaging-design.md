# 内置前端的移动 App 打包设计

## 目标

把当前项目构建出的 Vite 静态资源直接内置到 Android 和 iOS App，不再把某个
后端网页地址包装成独立 App。

最终只生成一个通用的 `Codex Mobile` App。App 不预置局域网 IP、后端地址或
Token；用户首次启动时通过现有“添加设备”界面自行添加后端。后端继续支持当前
完整模式和 `gateway-only` 模式，后端代码、协议及部署方式均不因 App 打包而
改变。

## 已确认边界

- 普通 Web 端行为保持不变。
- App 与 Web 复用同一份前端源码和后端管理界面。
- App 不区分 Mac mini、MacBook 或其他后端。
- App 包内不写入 `192.168.*` 地址、访问口令或其他私密配置。
- 不引入 PakePlus Submodule；GitHub Actions 在构建时拉取固定提交。
- `CODEX_MOBILE_SERVE_STATIC=false` 继续作为可选的 `gateway-only` 配置。

## 方案选择

比较以下方案：

1. 在通用注册表初始化中识别当前来源是否为有效 HTTP(S) 后端。
2. 在流水线中修改 Vite 生成的压缩 JavaScript。
3. 给 App 内置一个虚假的本地后端。

采用方案一。当前来源是 HTTP(S) 时，继续沿用现有的 `current-origin` 默认
后端；当前来源是 App 内置页面的 `file:` 或不透明来源时，不创建默认后端。
这不是独立的 App 功能分支，也不需要 `VITE_PACKAGED_APP` 标志。

方案二虽然可以避免修改源码，但会依赖每次构建后的压缩代码结构，无法稳定测试。
方案三会产生一个始终离线的假设备，不符合“App 不关心后端”的要求。

## 运行时设计

### 普通 Web

1. 浏览器从 `http://` 或 `https://` 地址加载前端。
2. 本地尚无后端注册表时，继续使用 `window.location.origin` 创建
   `current-origin`。
3. 后续连接、切换和持久化行为保持现状。

### 内置 App

1. WebView 从 App Bundle 或 Android Assets 加载 `index.html`。
2. 当前来源不能被解析为 HTTP(S) 后端，因此初始化为空注册表。
3. 后端列表为空时自动打开现有“添加设备”面板。
4. 用户输入网关地址和可选 Token，现有探测逻辑检查 `/api/host` 和 `/ws`。
5. 验证成功后写入 WebView 的 `localStorage`，后续启动直接恢复。

空注册表只是一种合法初始状态。添加后端后的数据结构、连接管理和界面行为与
Web 端完全一致。

## 打包流水线

流水线先在当前仓库执行：

```bash
npm ci
npm run build
```

随后拉取固定提交的 PakePlus 平台项目，并使用静态 HTML 模式：

- Android：把 `dist/` 内容复制到 PakePlus 的静态资源目录，设置
  `android.isHtml=true`，构建一个 `Codex Mobile` APK。
- iOS：把同一份 `dist/` 内容复制到 PakePlus-iOS 的静态资源目录，设置
  `ios.isHtml=true`，构建一个 `Codex Mobile` IPA。

应用身份、版本和上游提交在 Workflow 中固定；后端地址不再作为
`workflow_dispatch` 输入。Android 和 iOS 使用同一产品名称与稳定的独立应用
标识。

iOS 的静态资源打包与代码签名分开处理：未配置 Apple 签名材料时只能验证未签名
IPA；正式安装或 TestFlight 分发仍需 Apple Developer 签名。

## 后端兼容

后端保持现有两种静态资源策略：

- 完整模式：网关继续提供自身的 `dist/`，供普通浏览器使用。
- `gateway-only`：设置 `CODEX_MOBILE_SERVE_STATIC=false`，仅提供
  `/api/*` 和 `/ws`，供内置 App 或其他前端连接。

内置页面跨来源访问网关时，后端仍执行现有 Token 和 Origin 白名单检查。不同
WebView 对本地页面可能发送 `Origin: null` 或不发送 Origin；流水线验收阶段要在
真实 Android 和 iOS WebView 上确认实际值。若发送 `null`，部署方通过现有
`CODEX_MOBILE_ALLOWED_ORIGINS` 配置加入 `null`，无需修改网关代码。

## 错误处理

- 当前来源不是 HTTP(S) 且没有已保存后端时，不抛出 URL 解析错误，显示添加设备
  界面。
- 用户关闭添加面板后仍可停留在空状态，并可再次打开添加入口。
- 网关地址无效、Origin 未允许、Token 错误或 WebSocket 初始化失败时，沿用现有
  测试并保存错误提示，不写入无效配置。
- 已保存后端暂时离线时，沿用现有重连和离线状态，不清除用户配置。
- 静态资源缺失、入口文件缺失或 App 内出现硬编码局域网地址时，流水线直接失败。

## TDD 与验证

实施按以下顺序执行：

1. 先增加注册表测试：HTTP(S) 来源仍创建 `current-origin`；`file:`、`null` 或
   其他不透明来源得到空注册表。
2. 先增加界面测试：空注册表首次渲染会打开添加设备面板。
3. 实现最小注册表和界面兼容，再运行现有前端测试，证明 Web 行为没有回归。
4. 先增加 Workflow 静态契约检查，再修改 Android 和 iOS 打包流水线。
5. 构建后检查 APK/IPA 内存在 `index.html` 和 Vite 资源，并确认不包含
   `192.168.*`、后端 Token 或远程页面 URL。
6. 在真实 Android 与 iOS WebView 中验证首次添加、持久化恢复、HTTP API 和
   WebSocket 连接。

## 完成标准

- 仓库能构建一个不绑定后端的 Android App，并具备对应的 iOS 静态打包流程。
- App 首次启动自动显示添加设备面板。
- 用户添加后端后能够完成探测、连接、切换和持久化。
- 普通 Web 首次访问仍自动连接当前来源，现有行为不变。
- 后端完整模式和 `gateway-only` 均能继续使用。
- App 构建产物不包含任何固定局域网地址或访问口令。

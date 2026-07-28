# 新增设备空地址与 Android 沉浸式状态栏设计

## 目标

改善内置 Android App 的首次添加设备体验：

- “网关地址”输入框初始为空，不再要求用户先删除 `http://`。
- Android App 保留时间、信号、电量等系统状态栏图标，同时让页面背景延伸到状态栏
  区域。
- 标题、按钮等可交互内容继续避开状态栏和刘海，不被系统图标遮挡。

## 新增设备表单

新建后端草稿时将 `gatewayUrl` 初始化为空字符串。输入框继续使用完整 URL 作为
placeholder，不改变 URL 解析、Token 提取、编辑已有设备或探测流程。

## Android edge-to-edge

PakePlus Android 容器已经调用 `enableEdgeToEdge()`，但当前又把系统栏顶部 inset
作为根容器 padding，导致 WebView 页面不能绘制到状态栏区域。

Android 流水线在生成 PakePlus 工程后，对固定上游提交执行受保护的源码转换：

1. 保留 `enableEdgeToEdge()` 和状态栏图标。
2. 明确设置 `safeArea=all`，使生成的 `app.json` 保持
   `fullScreen=false`，不隐藏状态栏或导航栏。
3. 根容器保留左、右、底部系统栏 padding，但把顶部原生 padding 设为 0。
4. 继续返回原始 `WindowInsets`，让 WebView 接收并转发安全区信息。
5. 原生层同时把顶部 inset 换算为 CSS 像素，通过 `JsBridge` 和 inset
   变化事件写入 `--native-safe-area-top`；页面取它与标准
   `env(safe-area-inset-top)` 的较大值，兼容尚未完整支持 WebView 安全区的系统版本。

前端移除 Android WebView 将 `--safe-area-top` 强制归零的覆盖，统一使用
`env(safe-area-inset-top)`。页面背景因此绘制到透明状态栏下方，现有列表头部和
对话页顶部 padding 则使用 safe-area 避开系统图标。

## 平台边界

- 普通 Web 行为不变。
- iOS 保持当前实现。
- Android 不启用真正的全屏模式，不隐藏系统状态栏。
- 网关地址格式、Token 鉴权和后端连接协议不变。

## TDD 与验证

1. 先增加组件测试，断言新增设备时网关地址为空。
2. 先增加工作流契约测试，断言 Android 配置使用 `safeArea=all`、生成结果保持
   非全屏，并对生成容器应用顶部 edge-to-edge 转换及原生安全区兜底。
3. 先增加样式契约测试，断言 Android WebView 不再把顶部 safe-area 强制归零。
4. 运行定向测试，确认旧实现失败。
5. 完成最小实现后运行定向测试、完整测试、类型检查和生产构建。
6. Android Workflow 构建后检查 APK 中配置保持 `fullScreen=false`，且生成容器
   包含预期的 inset 处理。

## 完成标准

- 新增设备表单打开时地址输入框为空。
- Android 页面背景延伸到状态栏，系统图标可见，顶部交互内容不被遮挡。
- 普通 Web 与 iOS 没有行为回归。
- 新 APK 通过现有包内容和安全扫描契约。

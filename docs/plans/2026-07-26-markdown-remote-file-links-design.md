# Markdown 远程文件链接设计

日期：2026-07-26

## 目标

AI 或用户 Markdown 中出现远程文件链接时，不把绝对文件路径当作当前网站路由。
点击文件名后，通过 app-server V2 `fs/readFile` 读取远程文件，并在移动端底部
面板展示内容。普通 HTTP/HTTPS 链接保持原有浏览器行为。

## 链接识别

- 支持 macOS/Linux 绝对文件路径，例如
  `/Users/loock/project/src/App.tsx`。
- 支持尾部行列号：
  `/Users/loock/project/src/App.tsx:1173` 和
  `/Users/loock/project/src/App.tsx:1173:5`。
- 支持 `file:///Users/...` 形式。
- 只识别已知本地文件系统根目录；`https://`、`http://`、站内相对链接和锚点
  不拦截。
- 解析后从 `fs/readFile.path` 中去掉行列号。

## 远程文件面板

- 点击文件链接时阻止浏览器路由跳转，再调用
  `fs/readFile({ path })`。
- 将返回的 `dataBase64` 按 UTF-8 解码，按行展示文本与行号。
- 链接包含目标行时，打开后滚动并高亮该行。
- 顶部显示“远程文件”和统一线性 SVG 下载图标，不使用字体字符箭头。
- 文件内容前显示一次 13px 文件名和大小；底部只显示 11px 完整路径，不在
  底部重复文件名。
- 不显示底部“完成”按钮；点击标题栏右侧关闭按钮或面板外灰色区域关闭。
- 读取中、读取失败和空文件都有明确状态。
- 二进制或无法正常解码的内容不作为源码展示，但保留下载入口。

## 组件边界

- `MarkdownMessage` 增加可选链接渲染回调，与现有图片渲染回调并列。
- `RemoteFileLink` 只负责识别链接、阻止跳转和控制面板打开状态。
- `RemoteTextFileSheet` 负责 `fs/readFile`、解码、目标行定位和下载。
- 用户消息与 AI 消息共用同一个远程文件链接实现。

## 测试

- 单元测试覆盖绝对路径、行列号、`file://`、外部 URL 和相对链接。
- Markdown 单元测试覆盖自定义链接渲染回调。
- 移动端 E2E 验证点击后 URL 不变、调用 `fs/readFile`、内容展示、目标行高亮、
  面板关闭，以及普通 HTTPS 链接不被改写。

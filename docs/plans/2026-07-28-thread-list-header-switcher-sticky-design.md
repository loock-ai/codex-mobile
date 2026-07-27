# 会话列表头部与机器横排联合吸顶设计

日期：2026-07-28

## 目标

侧边栏会话列表滚动时，标题、连接状态、操作按钮以及“全部 / 各机器”横排作为一个整体保持在顶部，项目和会话内容从其下方滚动。

## 结构

在 `ThreadListPage` 中增加 `thread-list-sticky` 容器，包含：

1. `list-header`
2. `BackendSwitcher`

`thread-list` 保持在容器之后，作为正常滚动内容。

## 样式

- `thread-list-sticky` 使用 `position: sticky; top: 0`。
- 安全区顶部间距由头部继续承担。
- 半透明白色背景、模糊效果和 z-index 移到联合容器，避免会话内容从两行之间透出。
- `list-header` 从固定定位改为容器内普通布局。
- `BackendSwitcher` 保持横向滚动、选中态和原有尺寸。
- 不引入固定高度或第二套 sticky offset。

## 验证

- DOM 中头部和机器横排属于同一个 sticky 容器。
- CSS 不再把 `list-header` 设为 fixed。
- Android WebView 和带安全区设备顶部间距保持正确。
- 会话列表、机器切换、底部搜索与新聊天按钮功能不变。

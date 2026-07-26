# 前端组件拆分设计

日期：2026-07-26

## 目标

在不改变界面、DOM 结构、CSS 类名、可访问名称和 app-server 协议行为的前提下，
拆分当前约 1900 行的 `src/App.tsx`。`App` 最终只负责连接、状态、业务动作和页面
切换，展示组件按功能域归档。

## 方案

采用组件优先、状态后置的渐进式拆分：

```text
src/
├── App.tsx
├── features/
│   ├── threads/
│   │   └── ThreadListPage.tsx
│   ├── conversation/
│   │   ├── ConversationPage.tsx
│   │   ├── Timeline.tsx
│   │   └── sheets/
│   │       ├── RemoteFileSheets.tsx
│   │       └── ToolSheets.tsx
│   ├── approvals/
│   │   └── ApprovalSheet.tsx
│   └── settings/
│       └── ComposerSettings.tsx
└── ui/
    ├── conversation.tsx
    ├── attachments.ts
    ├── settings.ts
    └── icons.tsx
```

## 边界

- `App.tsx` 保留 WebSocket 生命周期、app-server 通知处理、线程打开/发送/中断、
  草稿状态和设置选择状态。
- `ThreadListPage` 只渲染主机状态、会话列表、搜索和新聊天入口。
- `ConversationPage` 只渲染标题、时间线、草稿图片、输入框和设置入口。
- `Timeline` 与 `sheets/` 负责消息、Markdown、图片、工具详情和文件 Diff 展示。
- `ApprovalSheet` 通过回调提交审批或用户问题答案，不直接访问客户端。
- `ComposerSettings` 接收接口返回的模型、智能、速度和权限选项，不维护业务状态。
- 继续使用现有纯函数，不引入状态库、路由或新的 UI 框架。
- 本次不迁移生成的 app-server TypeScript 类型，不扩大协议改动范围。

## 数据流

```text
App 状态与业务动作
  ├─ ThreadListPage
  ├─ ConversationPage ─ Timeline ─ Sheets
  ├─ ApprovalSheet
  └─ ComposerSettings

子组件只通过 props 读取数据并通过回调上报用户操作。
```

## 验收

- `App.tsx` 明显缩小，展示组件不再定义在其中。
- 现有 CSS 选择器和页面结构保持，手机截图不应出现视觉变化。
- 53 个单元测试、类型检查、构建和完整 E2E 全部通过。
- 真实 app-server 可以进入会话、发送消息、接收最终回复。
- 手机尺寸验证会话列表、对话、设置、审批和各类 Sheet。


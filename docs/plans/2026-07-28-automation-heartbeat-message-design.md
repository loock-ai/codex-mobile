# 自动化 Heartbeat 消息展示设计

## 目标

Codex 自动化任务会把消息包装在 `<heartbeat>` 协议中。移动端目前将协议标签和内部字段作为普通文本展示。

页面应隐藏协议字段，只保留真正的任务内容。

## 解析规则

只解析同时满足以下条件的消息：

- 整条消息去除首尾空白后由 `<heartbeat>` 和 `</heartbeat>` 完整包裹。
- 包含 `<automation_id>`。
- 用户消息包含完整的 `<instructions>`；AI 消息包含完整的 `<message>`。

用户消息：

- 展示 `<instructions>` 内容。
- 隐藏 `automation_id`、`current_time_iso` 等字段。

AI 消息：

- 展示 `<message>` 内容。
- 隐藏 `automation_id`、`decision` 等字段。

## 安全边界

- 不启用 Markdown 原始 HTML 渲染。
- 不对普通 XML、代码块或不完整 heartbeat 做全局标签删除。
- 只在展示层转换，原始 app-server 数据保持不变。

## 验证

- 单元测试覆盖用户和 AI heartbeat 提取。
- 不完整、非自动化和代码示例保持原文。
- 组件测试确认只展示正文且保留折叠行为。
- 运行完整测试、类型检查和生产构建。

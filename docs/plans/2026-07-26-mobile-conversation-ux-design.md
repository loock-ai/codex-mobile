# Codex Mobile Web 对话体验改版设计

日期：2026-07-26

## 目标

在保持 ChatGPT Android Remote 原生简洁感的前提下，提高移动端信息密度与长会话可读性：

- 全局字号收敛到适合手机长时间阅读的 14–17px。
- 模型与权限档位由 app-server 动态提供，不使用硬编码标签。
- AI 正文使用安全的 GitHub Flavored Markdown 渲染。
- 相对时间使用“3 分钟、2 小时”等数字在前、单位在后的格式。
- 每个用户消息和其后的完整 AI 输出组成一个可折叠 Turn。
- 列表页和对话页头部在滚动时保持吸顶。

## 交互设计

### Turn 折叠

每个 Turn 是独立折叠单元：

- 用户消息始终作为回合标题展示。
- 默认展开当前 Turn 和历史 Turn。
- 点击标题区域折叠或展开其 AI 正文、推理、工具调用、终端输出和 Diff。
- 正在运行的 Turn 强制展开，避免隐藏实时状态。
- 没有用户消息的旧数据仍作为一个可展开的“Codex 回合”呈现。

### 模型与权限

输入框上方两个胶囊按钮分别打开底部选择面板：

- 模型来源：`model/list`，显示 `displayName`，提交 `model`。
- 权限来源：`permissionProfile/list`，过滤 `allowed=false`，提交 `permissions`。
- 新线程把选择写入 `thread/start`。
- 已有线程把选择随下一次 `turn/start` 发送，并由 app-server 作为后续 Turn 的覆盖设置。
- 加载失败时保留服务器默认值，不阻止发送消息。

“审批模式”在移动端具体表现为 app-server 权限档位；服务器产生的命令、文件、附加权限审批仍使用现有审批底栏。

### Markdown

仅 AI 消息使用 `react-markdown` 与 GFM 扩展；HTML 默认不解析，避免注入。代码块、表格、引用、列表和链接使用移动端样式，超宽内容横向滚动。

## 数据流

连接初始化成功后并行请求：

1. `thread/list`
2. `model/list`
3. `permissionProfile/list`

发送消息时，从当前选择构造：

```json
{
  "threadId": "...",
  "input": [{ "type": "text", "text": "...", "text_elements": [] }],
  "model": "selected-model",
  "permissions": "selected-profile"
}
```

新线程在 `thread/start` 中使用同样的模型和权限选项。

## 验证

- 单元测试：相对时间、Turn 分组、Markdown 内容与选择参数。
- 协议测试：模型和权限列表响应字段。
- 浏览器 E2E：选择模型/权限、发送消息、看到 Markdown、折叠/展开 Turn、确认头部吸顶。
- 独立测试 subagent 验收后，再由修复 subagent 处理问题并补充优化审计。

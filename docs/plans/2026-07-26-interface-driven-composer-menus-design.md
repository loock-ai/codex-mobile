# 接口驱动的输入框菜单设计

日期：2026-07-26

## 目标

参考 ChatGPT Android Remote 的输入框设置交互，将现有全宽底部设置面板改为输入框上方的锚定式圆角浮层。界面显示的模型、智能等级、速度和权限必须真实影响 app-server 请求，不设置仅用于展示的假选项。

## 数据来源

- 模型：`model/list.data`
- 智能等级：所选模型的 `supportedReasoningEfforts`
- 默认智能等级：所选模型的 `defaultReasoningEffort`
- 速度：所选模型的 `serviceTiers`
- 正常速度：不传 `serviceTier`
- 权限范围：`permissionProfile/list.data`
- 当前默认配置：`config/read`
- 已有线程设置：`thread/resume`

app-server 没有独立的智能或速度列表接口；两者是模型目录的一部分。切换模型时必须重新计算该模型可用的智能与速度。

## 交互

### 模型胶囊

显示 `模型名 智能等级`，点击打开主浮层。速度为“快速”时在模型名前增加
`⚡`；速度为“正常”（`serviceTier = null`）时不显示闪电。图标直接跟随
当前接口选项状态，不单独维护视觉状态。

1. 当前模型支持的智能等级；
2. 模型子菜单入口；
3. 当前模型支持的速度子菜单入口。

模型子菜单显示推荐模型和其他模型；速度子菜单始终包含“正常”，并追加 `serviceTiers` 返回的档位。

### 权限胶囊

独立打开权限浮层，只显示：

- 默认权限
- 自动审核
- 只读
- 完全访问权限

“自定义 config.toml”不显示。

四种模式映射到真实协议字段：

| 模式 | permissions | approvalPolicy | approvalsReviewer |
|---|---|---|---|
| 默认权限 | `:workspace` | `on-request` | `user` |
| 自动审核 | `:workspace` | `on-request` | `auto_review` |
| 只读 | `:read-only` | `on-request` | `user` |
| 完全访问权限 | `:danger-full-access` | `never` | `user` |

如果对应权限 profile 未由 `permissionProfile/list` 返回，则该模式不显示。

## 协议写入与恢复

新线程通过 `thread/start` 写入模型、速度和权限设置；智能等级不属于
`ThreadStartParams`，由紧随其后的 `turn/start.effort` 写入。完整设置组合为：

```json
{
  "model": "gpt-5.6-sol",
  "effort": "high",
  "serviceTier": "priority",
  "permissions": ":workspace",
  "approvalPolicy": "on-request",
  "approvalsReviewer": "user"
}
```

`thread/resume` 恢复 `model`、`reasoningEffort`、`serviceTier`、`activePermissionProfile`、`approvalPolicy` 和 `approvalsReviewer`。

## 视觉

- 浮层定位在 composer 上方，最大宽度约 340px。
- 白色背景、28px 圆角、轻阴影和背景遮罩。
- 主菜单与子菜单在同一位置切换，不使用全屏或全宽底部 Sheet。
- 保留现有移动端字号、Markdown、Turn 折叠和吸顶。

## 会话列表运行态

- `thread/list.data[].status.type === "active"` 时，以蓝色圆点和旋转弧标记进行中。
- 其他状态继续显示 `updatedAt` 相对时间。
- 页面打开期间每 60 秒重新请求一次 `thread/list`，同时推进相对时间基准。

## 单轮消息折叠

- 回合状态为 `inProgress`、`in_progress` 或 `running` 时，严格按协议 item
  顺序展示 AI 消息、思考过程、命令、文件变更和其他工具调用。
- `turn/started` 用于创建或升级本地 pending 回合，所有 `item/*` 事件只写入
  其 `turnId` 对应的回合，不能回退写入最后一个旧回合。
- 收到 `turn/completed` 后，只按 item id 合并其中的最终回复摘要，并保留此前
  由 `item/*` 累计的完整过程；同时把回合状态更新为完成。
- 已完成回合优先保留最后一个 `phase: "final_answer"` 的
  `agentMessage`；协议未提供 phase 时，回退到最后一个 `agentMessage`。
- 其余过程 item 默认收纳为“之前的 N 条消息”，N 按原始 item 数计算。
- 点击折叠入口可展开或再次收起全部过程。每个回合独立保存展开状态；新回合
  加入同一会话时，不会展开已经折叠的旧回合。
- `turn/diff/updated` 的 diff 保存到所属回合，而不是线程级共享字段，避免新
  回合误显示上一轮代码变更。

## 工具与图片

- 连续工具 item 聚合为紧凑摘要，展示修改文件数、执行命令数、工具调用数及
  diff 的增删行；点击单项打开详情 Sheet。
- `userMessage.localImage`、`imageView` 和 `imageGeneration.savedPath`
  通过 app-server V2 `fs/readFile` 获取，不由网关另开任意文件接口。
- 用户长消息超过 260 字或 8 行时默认截断，可用“展开更多/收起”切换。
- 用户文本与 AI 回复复用同一个安全 GFM Markdown 渲染器；用户气泡单独使用
  紧凑标题、列表、引用和代码样式，原始 HTML 不执行。
- Markdown 渲染后仍由外层高度裁切控制长消息折叠，避免块级标题和列表破坏
  原有的“展开更多/收起”交互。

## 全局箭头图标

- 下拉、展开、收起和进入子菜单统一使用同一个 SVG Chevron 路径，不再使用
  `⌄`、`⌃`、`›` 等受系统字体影响的字符。
- 基础图标朝右；展开状态旋转 90°朝下，“收起长消息”旋转 -90°朝上。
- 模型、速度、工具活动、工具详情、单轮过程折叠和长用户消息共用相同线宽、
  尺寸体系与旋转动画。
- 下载箭头属于独立操作图标，不纳入 Chevron 替换范围。

## 图片输入

- 输入框左侧「＋」打开系统图片选择器，支持 PNG、JPEG、WebP 和 GIF。
- 最多暂存 4 张图片，单张最大 10 MiB；不支持的格式、超限文件和超出数量的
  文件在输入框上方给出明确错误。
- 浏览器使用 `FileReader` 把图片转换为 Data URL，并以
  `turn/start.input[].type = "image"`、`url = "data:image/...;base64,..."`
  直接发送给 app-server V2。网关继续透明转发，不增加上传或临时文件接口。
- 暂存区以紧凑缩略图展示，每张图片可单独移除；支持纯图片和文字加图片。
- 本地乐观消息使用与协议历史相同的 `userMessage.content` 数组，因此发送后
  立即按真实用户图片消息样式展示。

## 会话列表密度与吸顶

- 列表采用移动端 Remote 的克制密度：标题 20px、会话标题 16px、时间 13px，
  圆形按钮 44px、底部操作区约 54px。
- 会话行不设置固定高度或最小高度；标题使用 `2em` 行高，由实际文本自然
  撑开，避免不同字体、系统字号或多语言文本产生额外空白和裁切。
- 只调整列表页，不使用全局 `zoom` 或 `transform: scale`，避免影响点击区域、
  视口宽度和对话页现有排版。
- 列表头部是独立的视口固定区域，包含安全区内边距、实色半透明背景和模糊
  层；页面滚动后返回、Remote 标题和更多按钮始终停留在视口顶部。列表正文
  预留等高顶部空间，避免内容被固定头部遮挡。
- E2E 必须真实增加列表高度并执行滚动，验证头部位置、紧凑尺寸以及页面没有
  横向溢出，不能只断言 CSS 中写有 `position: sticky`。

## 首次加载与进入会话定位

- 首次连接后，在 `thread/list` 返回前展示 5 行轻量骨架，不提前显示“暂无对话”；
  只有请求成功且结果为空时才显示真正的空状态。
- 后台每分钟刷新时保留当前列表，不切回骨架，避免页面闪烁。
- 首次请求失败时显示加载失败状态和错误信息，不把失败误报成空列表。
- 打开已有会话后，在消息 DOM 完成布局时自动定位到会话末尾；图片等异步内容
  完成首轮布局后再做一次短暂校正，确保默认看到最新消息。
- 自动定位仅发生在进入或恢复会话时，不在后续流式消息更新时反复抢占用户
  当前阅读位置。
- 从会话详情返回列表时定位到页面顶部，因为会话列表按最新在前排序；详情页
  与列表页不得复用彼此的滚动位置。

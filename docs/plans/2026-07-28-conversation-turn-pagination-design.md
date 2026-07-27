# 会话详情 Turns 分页设计

日期：2026-07-28

## 目标

打开历史会话时不再一次加载全部 turns。首次只取得最近 10 个 turns，用户滚动到会话顶部时继续向前加载，降低大型会话的首屏响应体积和等待时间。

## 方案选择

采用 app-server 原生分页能力：

- `thread/resume` 使用 `excludeTurns: true` 和 `initialTurnsPage`，在恢复会话设置的同时返回最近一页。
- 后续调用 `thread/turns/list`，使用 `nextCursor` 加载更早 turns。
- `itemsView` 使用 `full`，确保工具调用、推理、diff 等现有详情完整显示。

不采用 resume 后再单独请求首屏的两请求方案，避免额外一次网络往返；不继续使用 `thread/read(includeTurns:true)` 作为常规路径，因为它会返回完整历史。

## 数据结构

`ResumedThreadSession` 增加：

- `nextTurnsCursor`：下一页游标；为空表示没有更早历史。
- 初始 `thread.turns`：由 `initialTurnsPage.data` 按时间正序写入。

工作区为当前会话维护分页状态：

- `olderTurnsCursor`
- `olderTurnsState`: `idle | loading | error | exhausted`
- 独立请求序号，用于忽略切换会话后的迟到结果。

## 请求流程

首次打开：

```text
thread/resume
  threadId
  excludeTurns: true
  initialTurnsPage:
    limit: 10
    sortDirection: desc
    itemsView: full
```

将返回页反转为时间正序后放入 `thread.turns`。

滚动到顶部：

```text
thread/turns/list
  threadId
  cursor: nextTurnsCursor
  limit: 10
  sortDirection: desc
  itemsView: full
```

新页反转后去重并插入现有 turns 前面。插入前记录 `scrollHeight`，渲染后增加对应的高度差，保持用户当前阅读位置不跳动。

## 回退与错误

- `thread/resume` 不支持分页参数时，回退 `thread/read(includeTurns:true)`，保证兼容性和完整历史。
- 首屏失败沿用现有详情错误页和重试。
- 加载更早历史失败时保留当前详情，在顶部显示“加载失败，点击重试”。
- 同一页只允许一个在途请求；切换会话或重新打开后，旧结果不得写入新会话。

## 实时消息

实时 turn/item 事件继续合并到当前 `active.turns`。历史分页只向前插入，不替换当前 turns，因此不会覆盖正在运行的新 turn。

## 测试

- resume 请求包含分页参数并正确解析、反转初始页。
- 不支持分页时仍可回退完整 `thread/read`。
- 后续页使用正确 cursor，反转、去重并更新 cursor。
- 顶部触发只产生一个在途请求。
- 切换会话后忽略旧页结果。
- 插入旧历史后保持滚动位置。
- 分页错误只显示局部重试，不破坏当前详情。

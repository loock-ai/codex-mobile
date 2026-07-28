# 对话详情安全区 Padding 调整

## 目标

对话详情页顶部只保留系统安全区；底部暂时完全移除安全区和额外间距，以便验证 Android WebView 中的实际效果。

## 设计

- 顶部 padding 从 `calc(var(--safe-area-top) + 14px)` 改为 `var(--safe-area-top)`。
- 详情页底部 padding 从 `calc(env(safe-area-inset-bottom) + 104px)` 改为 `0`。
- 固定输入框底部 padding 从 `calc(env(safe-area-inset-bottom) + 15px)` 改为 `0`。
- 会话列表底部操作栏 padding 从 `calc(env(safe-area-inset-bottom) + 10px)` 改为 `0`。
- 会话列表内容底部防遮挡占位从 `calc(env(safe-area-inset-bottom) + 88px)` 调整为 `58px`，对应 `50px` 搜索框加 `8px` 顶部间距。
- 左右 padding、标题栏、消息时间线和输入框定位保持不变。
- 本次仅修改并验证本机开发环境，不执行部署。

## 验证

- 运行 TypeScript 类型检查和构建。
- 确认开发服务仍可访问，编译后的 CSS 不再包含详情页额外的顶部、底部 padding。

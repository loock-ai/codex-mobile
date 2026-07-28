# 移除 WebView 蓝色触摸高亮

## 目标

移除 Android WebView 在列表和其他可点击控件上短暂显示的默认蓝色触摸高亮。

## 设计

- 对按钮、链接、`summary` 和 `role="button"` 元素设置 `-webkit-tap-highlight-color: transparent`。
- 会话行、项目标题行和“展开显示”移除原生按钮外观，并将 `:active` 背景保持透明。
- 设备 Tab 和操作菜单已有的选中、按压反馈保持不变。
- 不移除浏览器键盘焦点轮廓，保证键盘操作仍可识别焦点。
- 本次仅修改和验证本机开发环境。

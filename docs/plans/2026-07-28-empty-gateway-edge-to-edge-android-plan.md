# 新增设备空地址与 Android edge-to-edge 实施计划

## 任务一：用测试定义新增设备初始值

涉及文件：

- `tests/ui/backend-components.test.tsx`
- `src/features/backends/BackendManagerSheet.tsx`

步骤：

1. 在设备管理组件测试中断言首次打开新增表单时“网关地址”值为空。
2. 运行该测试，确认现有 `http://` 默认值导致失败。
3. 将新后端草稿的 `gatewayUrl` 改为空字符串。
4. 重跑组件测试并确认通过。

## 任务二：用测试定义 Android edge-to-edge 契约

涉及文件：

- `tests/ci/mobile-packaging-workflows.test.ts`
- `.github/workflows/build-android.yml`
- `src/styles.css`

步骤：

1. 增加工作流契约断言：
   - Android 配置显式设置 `safeArea=all`，生成结果为
     `fullScreen=false`。
   - 生成工程后保留 `enableEdgeToEdge()`。
   - 根容器顶部 padding 改为 0，左、右、底部 inset 保留。
   - 原生顶部 inset 通过 `JsBridge` 和 inset 变化事件提供给前端，兼容旧版
     Android System WebView。
   - 生成的 `app.json` 必须是非全屏。
2. 增加样式契约断言，禁止 Android WebView 把 `--safe-area-top` 强制设为 0。
3. 运行 CI 契约测试，确认旧实现失败。
4. 在 Android Workflow 的固定上游源码转换中加入受保护替换和构建后检查。
5. 删除 Android WebView 的顶部 safe-area 覆盖。
6. 重跑契约测试并确认通过。

## 任务三：完整验证

步骤：

1. 运行组件与工作流定向测试。
2. 运行 `NODE_ENV=test npm test`。
3. 运行 `npm run typecheck`。
4. 运行 `npm run build`。
5. 运行 `git diff --check`。
6. 检查最终差异，确保未覆盖会话界面、后端部署和其他已有工作区修改。

## 任务四：Android APK

步骤：

1. 本地验证完成后报告需要重新运行 Android Workflow。
2. 未经单独确认，不自动推送或触发外部构建。
3. 构建后应检查 APK 签名、静态资源、权限、cleartext 配置和生成容器的
   edge-to-edge 契约。

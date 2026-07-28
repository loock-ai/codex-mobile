# Android 自动发布与应用内更新实施计划

## 执行原则

使用 Plan + TDD：每一组实现先补会失败的测试，确认失败原因与目标一致，再写最小实现，
通过目标测试后才进入下一组。保留工作区已有改动，只暂存本任务文件和明确属于本任务的
代码块。

## 任务一：自动版本与 Release 模型

**新增文件**

- `src/app-update/release.ts`
- `tests/ui/app-update-release.test.ts`

**步骤**

1. 测试 `vX.Y.Z` 解析、补丁递增和版本比较。
2. 测试 Latest Release 响应只接受正式语义版本、预期 APK 和 SHA-256。
3. 测试自动检测缓存与手动检查绕过缓存。
4. 实现纯函数和可注入的 Release 查询器。

## 任务二：更新状态与移动端界面

**新增或修改文件**

- `src/features/update/AppUpdateSheet.tsx`
- `src/features/update/useAppUpdate.ts`
- `src/app-update/native-bridge.ts`
- `src/features/backends/BackendManagerSheet.tsx`
- `src/App.tsx`
- `src/styles.css`
- `tests/ui/app-update-sheet.test.tsx`
- `tests/ui/backend-components.test.tsx`

**步骤**

1. 先测试普通浏览器不展示安装更新入口。
2. 测试 Android 桥存在时显示当前版本和手动检查入口。
3. 测试发现更新、稍后、立即更新、进度、校验、失败与重试。
4. 测试启动、回到前台自动检查以及限流。
5. 实现桥类型、更新 Hook、底部 Sheet 和设备管理入口。

## 任务三：Android 原生更新桥

**修改文件**

- `.github/workflows/build-android.yml`
- `tests/ci/mobile-packaging-workflows.test.ts`

**步骤**

1. 先扩展 CI 测试，要求最小安装权限、`FileProvider`、HTTPS 域名限制、SHA-256 校验、
   原生版本读取和 JS 状态回调。
2. 验证新增测试在现有工作流上失败。
3. 在固定 PakePlus 工程加固步骤中注入更新桥和 provider 配置。
4. 扩展最终 APK Manifest 校验，拒绝未列入允许集合的权限和 provider。
5. 运行 CI 目标测试。

## 任务四：提交触发、自动版本与 Release

**修改文件**

- `.github/workflows/build-android.yml`
- `tests/ci/mobile-packaging-workflows.test.ts`
- `README.md`

**步骤**

1. 先测试 `main` 路径触发、手动触发、并发取消、最小写权限和发布条件。
2. 测试最新 Release 补丁递增、无历史 Release 回退、`versionName` 与
   `versionCode` 注入。
3. 测试 Release 只在 `push main` 且验证成功时创建，并上传 APK 和 SHA-256。
4. 实现工作流，更新构建和应用内更新文档。

## 任务五：完整验证与发布

1. 运行更新模块、组件和 CI 目标测试。
2. 运行 `npm test`。
3. 运行 `npm run typecheck`。
4. 运行 `npm run build`。
5. 检查 `git diff`、YAML 解析和暂存文件范围。
6. 只提交本任务改动并推送 `main`。
7. 使用 `gh` 监控 Android Actions 到完成。
8. 确认新 `vX.Y.Z` Release 已发布且包含 APK 与 SHA-256。
9. 下载 Release APK，核对摘要和文件大小，并报告 Release 链接。

# Android 自动发布与应用内更新设计

## 目标

- `main` 分支的前端代码提交后自动构建 Android APK。
- 以最新 GitHub Release 为基准自动增加补丁版本。
- 构建与安全验证全部通过后自动发布 GitHub Release。
- Android App 自动检测新版本，并在用户确认后下载、校验和调起系统安装。
- 保留现有手动 Android 构建；iOS 未签名 IPA 继续手动构建。

## 自动发布

### 触发范围

自动发布只监听 `main`，并限制为会改变内置前端或 Android 容器的路径：

- `src/**`
- `public/**`
- `index.html`
- `package.json`
- `package-lock.json`
- `tsconfig*.json`
- `vite.config.ts`
- Android 工作流自身

现有 `workflow_dispatch` 保留，用于只构建和验证 APK，不默认创建 Release。

### 版本规则

自动任务读取最新正式 Release 的 `vX.Y.Z` 标签，并将补丁版本增加一位。
如果仓库没有符合格式的正式 Release，则使用 `package.json` 的版本作为起点并增加
补丁版本。

版本只存在于本次流水线环境和生成物中，不反写源码、不产生版本提交，避免工作流递归
触发。APK 的 `versionName` 使用语义版本，`versionCode` 使用 GitHub Actions 的单调
递增运行编号。

并发组按工作流和 `main` 分支唯一。新的提交到达时取消尚未完成的旧任务，避免两个任务
争用同一个补丁版本。

### 发布原子性

流水线依次完成：

1. 计算下一个版本；
2. 安装依赖并运行前端测试、类型检查和生产构建；
3. 生成并加固 PakePlus Android 工程；
4. 构建 APK；
5. 校验权限、签名相关配置、内置资源和 SHA-256；
6. 上传短期 Actions Artifact；
7. 仅在 `main` 的自动任务中创建标签和 GitHub Release，并上传 APK 与校验文件。

任何验证失败都不得创建标签或 Release。Release 标题为
`Codex Mobile vX.Y.Z`，APK 命名为 `CodexMobile-vX.Y.Z.apk`，说明由 GitHub 自动
汇总上个 Release 之后的提交并附本次提交 SHA。

## 应用内更新

### 检测

内置前端在 Android 容器中才能启用应用更新。在普通浏览器、开发服务器和 iOS 中不显示
安装入口。

App 首次启动、从后台回到前台以及用户手动点击“检查更新”时请求公开仓库的 Latest
Release API。自动检测使用本地时间戳限流，短时间内复用最近结果；手动检查绕过限流。

检测逻辑只接受：

- 非草稿、非预发布的 `vX.Y.Z`；
- 名称符合 `CodexMobile-vX.Y.Z.apk` 的 APK；
- 本项目 Release 的下载地址；
- 可用的 SHA-256 摘要。

当前版本由构建时注入前端，同时由原生桥返回实际安装版本。两者不一致时以原生版本为准
并记录错误，避免错误判断可更新状态。

### 用户界面

更新入口放在设备管理 Sheet 的底部，显示当前版本和“检查更新”。检测到新版本时展示
沿用现有视觉语言的底部 Sheet：

- 顶部固定标题、版本号和关闭按钮；
- 中间区域滚动显示 Release 更新说明；
- 底部固定“稍后”和“立即更新”；
- 下载时展示百分比和已下载大小；
- 校验阶段显示“正在验证安装包”；
- 失败时保留错误和“重试”；
- 下载并校验成功后调起 Android 系统安装确认页。

UI 使用现有黑白、圆角、紧凑移动端体系，不增加独立页面或新的视觉风格。

### Android 原生桥

Android 构建继续固定 PakePlus 上游提交，并在生成工程后注入最小更新桥：

- 返回已安装 App 版本；
- 只接受本项目 GitHub Release 的 HTTPS APK 地址；
- 使用系统下载能力保存到 App 缓存；
- 计算并核对 SHA-256；
- 通过 `FileProvider` 暴露只读 APK；
- 请求 `REQUEST_INSTALL_PACKAGES`，并调起系统安装器；
- 通过回调事件把下载、校验、失败状态传回 WebView。

不能静默安装。首次更新时 Android 会要求用户允许 Codex Mobile 安装未知应用，之后每次
覆盖安装仍由系统呈现确认界面。

固定 `applicationId` 和签名材料是覆盖升级的前提。流水线必须验证生成 APK 的包名、
版本和允许权限；除网络、网络状态、动态接收器保护权限和
`REQUEST_INSTALL_PACKAGES` 外，不接受额外敏感权限。

## 安全边界

- APK 不包含局域网地址、网关 Token、GitHub Token 或私有配置。
- GitHub API 使用公开 Release，无需在 App 中嵌入访问令牌。
- 原生下载仅允许 `https://github.com/loock-ai/codex-mobile/releases/download/`
  及 GitHub 资产重定向目标。
- APK 必须通过 Release 摘要校验后才可交给系统安装器。
- Release 使用 GitHub Actions 内置短期令牌，仅发布 Job 获取 `contents: write`。
- 源码检出保持 `persist-credentials: false`。

## 验证

- 单元测试覆盖语义版本解析、补丁递增、版本比较、Release 响应校验、缓存限流和桥接状态。
- 组件测试覆盖无更新、有更新、下载、校验、失败重试和非 Android 隐藏入口。
- CI 测试解析工作流并验证触发路径、权限、并发、自动版本、`versionCode`、APK 摘要和
  Release 发布条件。
- Android 工作流静态测试验证更新桥、`FileProvider`、允许域名和最小权限。
- 执行完整单测、类型检查、生产构建和 YAML 解析。
- 推送后监控 GitHub Actions，下载 Release APK 并核对文件名、版本、SHA-256 和 Release
  页面状态。


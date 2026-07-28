# PakePlus Android 流水线设计

## 目标

在 `codex-web-mobile` 中增加一条可手动触发的 GitHub Actions 流水线，分别把以下两个局域网页面打包成 Android APK：

- `CodexMini`：默认页面 `http://192.168.100.8:4173/`
- `CodexMacBook`：默认页面 `http://192.168.100.35:4173/`

页面已经不需要额外认证，因此构建过程不注入 Token，也不使用 GitHub Secrets。

## 方案选择

已比较三种方案：

1. 复制完整 PakePlus 项目：构建直观，但会在主项目中维护大量上游代码。
2. 使用 Git Submodule：可以锁定版本，但增加本地克隆和 CI 初始化成本。
3. Workflow 直接拉取官方项目：主项目只维护流水线，结构最轻。

采用第三种方案。流水线通过 `actions/checkout` 拉取公开的
`Sjj1024/PakePlus-Android`，并固定到提交
`787b9e5ea2da1b2d959485417ffeee62f0d30960`，避免上游 `main` 更新导致构建漂移。

## 流水线结构

主项目新增 `.github/workflows/build-android.yml`，不增加 Submodule 或永久打包脚本。

`workflow_dispatch` 提供两个页面地址输入，默认值为当前两个局域网地址。矩阵任务保存固定的应用名称、包名和版本；每个任务运行时仅通过 `PAGE_URL` 环境变量接收页面地址。

固定应用身份：

| 应用 | 包名 | 版本 |
| --- | --- | --- |
| CodexMini | `vip.loock.codexmini` | `1.0.0` |
| CodexMacBook | `vip.loock.codexmacbook` | `1.0.0` |

每个矩阵任务依次执行：

1. 拉取固定版本的官方 PakePlus Android 项目。
2. 安装 JDK 17、Android SDK、Node.js、pnpm 和 ImageMagick。
3. 用 YAML 内联的 `jq` 命令写入名称、包名、版本和 `PAGE_URL`。
4. 校验生成配置，并确认官方 Manifest 允许局域网 HTTP 明文访问。
5. 调用官方 `pnpm pp:worker` 和 Gradle 构建 Debug APK。
6. 将两个 APK 分别上传为 GitHub Actions Artifact。

流水线只需要读取公开源码并上传当前运行的 Artifact，因此权限设为
`contents: read`，不创建公开 Release。

## 错误处理与验证

- 页面地址必须以 `http://` 或 `https://` 开头，否则构建立即失败。
- 配置写入后用 `jq -e` 验证名称、包名、版本和页面地址。
- 构建前检查 `android:usesCleartextTraffic="true"`。
- 构建后检查 APK 文件存在且非空，再上传 Artifact。
- 按 TDD 流程，先运行缺失 Workflow 的失败契约，再实现 YAML；实现后执行 YAML 解析、静态契约检查和现有项目测试。

## 边界

- 流水线只负责 Android，不包含 iOS。
- GitHub 托管 Runner 无法访问局域网页面；它只把 URL 写入 APK，不在云端验证页面内容。
- 实际安装后，手机仍需处于能够访问相应 `192.168.100.*` 地址的网络。

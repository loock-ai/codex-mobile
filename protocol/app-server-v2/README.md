# Codex app-server V2 协议快照

本目录同时保存 OpenAI 官方仓库发布的协议文档、Schema 和权威源定义，以及与
本机 Codex CLI 版本严格匹配的生成产物。

## 项目主基准

项目开发直接使用：

```text
codex_app_server_protocol.v2.schemas.json
```

该文件复制自：

```text
/tmp/codex-app-server-schema.30E2y5/codex_app_server_protocol.v2.schemas.json
```

校验信息：

```text
SHA-256  014585709f6c6a260296453783b4f35b1d1d41923ec51fbe314bd57b832cbe3c
definitions  586
JSON  valid
```

它与 `codex-cli 0.144.1 --experimental` 生成的本地 Schema 在规范化 JSON
语义上完全一致，原始文件的差异仅为对象键顺序或格式。因此第一版客户端以这份
Schema 为协议基准。

## 官方快照

来源：

- 仓库：`https://github.com/openai/codex`
- 分支：`main`
- 提交：`322d5b96cfa5c8fd52bd83ecfdb79cd9b330205f`
- 拉取日期：`2026-07-26`

主要入口：

- `official/codex-rs/app-server/README.md`
  - 官方 app-server 协议文档、生命周期、方法、事件和审批流程。
- `official/codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.v2.schemas.json`
  - 官方仓库提交的 V2 JSON Schema bundle。
- `official/codex-rs/app-server-protocol/schema/json/v2/`
  - 按类型拆分的 V2 JSON Schema。
- `official/codex-rs/app-server-protocol/src/protocol/common.rs`
  - 通用请求、响应、通知和协议注册定义。
- `official/codex-rs/app-server-protocol/src/protocol/v2/`
  - V2 协议的权威 Rust 类型定义。

官方 V2 Schema bundle 的 SHA-256：

```text
380e97f5778c40c7fead146c6af5da97e478164b194c0ce1b15edac80d8c8527
```

## 本机生成快照

目录：

```text
generated-local/codex-cli-0.144.1/
├── schema/
└── typescript/
```

生成环境：

```text
codex-cli 0.144.1
```

生成命令：

```bash
codex app-server generate-ts \
  --experimental \
  --out protocol/app-server-v2/generated-local/codex-cli-0.144.1/typescript

codex app-server generate-json-schema \
  --experimental \
  --out protocol/app-server-v2/generated-local/codex-cli-0.144.1/schema
```

## 使用原则

- 阅读协议行为、调用顺序和 UI 建议时，以官方 `app-server/README.md` 为准。
- 跟踪上游当前主分支类型时，以官方 `src/protocol/{common,v2}` 为准。
- 构建当前机器上的客户端时，以对应 CLI 版本生成的 TypeScript 和 JSON Schema
  为准，因为官方文档明确说明生成产物与运行生成命令的 Codex 版本严格匹配。
- 当前项目的直接输入是根目录下的
  `codex_app_server_protocol.v2.schemas.json`；`official/` 用于对照上游文档和
  当前主分支变化。
- `--experimental` 生成的字段和方法需要客户端在 `initialize` 中设置
  `capabilities.experimentalApi: true`。
- 网关保持 app-server 消息透传，不基于 Schema 改写业务消息。

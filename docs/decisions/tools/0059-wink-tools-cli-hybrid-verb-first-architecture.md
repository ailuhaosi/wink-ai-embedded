# ADR-0059：`wink-tools` CLI 混合动词优先命令体系与独立脚本收拢策略

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-08-06 |
| 决策者 | 项目架构师与 CLI 开发团队 |
| 关联计划 | [2026-08-06-wink-tools-architecture-evolution-plan](../../implementation-plans/tools/00-master-architecture-evolution-plan.md) |

---

## 背景（Context）

`wink-tools` 过去平铺了 14 个顶层 CLI 命令，同时存在若干独立的裸 Python 脚本（如 `tools/pack/source.py`、`tools/pack/binary.py`、`tools/i18n_scanner.py`、`tools/wasm_export_codegen.py`）。这导致：
1. 顶层命名空间污染，缺乏统一的分层编排逻辑；
2. 独立脚本分散在 `tools/` 各处，缺乏统一的 `wink` CLI 入口调度；
3. 部分废弃/重命名命令缺乏优雅的向后兼容机制，存在破坏现有 CI/CD 脚本的风险。

## 决策（Decision）

### D1. 采用工业级“混合动词优先”范式 (Hybrid Verb-First Architecture)
- 高频一级动词（如 `wink build`, `wink test`, `wink doctor`）保持最短调用路径。
- 二级及领域操作重构为见名知意的命名层次：
  - `wink gen app-schema` (替代 `frontend-app-device-tree`)
  - `wink gen unisim-plugin-schema` (替代 `gen-peripheral-schema`)
  - `wink build unisim-plugin` (替代 `build-peripheral`)
  - `wink dev unisim-plugin` (替代 `dev-peripheral`)
  - `wink create dal` (替代 `new-dal`)
  - `wink schema migrate` (替代 `migrate-schema`)

### D2. 100% 独立脚本收拢至 CLI 网关
- 原 `tools/pack/source.py` 与 `tools/pack/binary.py` 收拢为 `wink pack source` 与 `wink pack binary`。
- 原 `tools/i18n_scanner.py` 收拢为 `wink i18n scan`。
- 原 `tools/wasm_export_codegen.py` 收拢为 `wink gen wasm-export`。

### D3. 隐藏 Parser 透明重定向与 Deprecation 机制
- 所有遗留顶层命令通过 `help=argparse.SUPPRESS` 注册为隐藏 Parser。
- 隐藏 Parser 精准转发参数至新命令，同时将 `DeprecationWarning` 仅输出到 `stderr`，确保 `stdout`（如 JSON 管道）不受污染，达成 100% 零破坏性向后兼容。

---

## 后果与约束（Consequences & Constraints）

- **正向**：CLI 命名结构化、清晰易读；实现 100% 统一 SDK 网关；现有 CI/CD 流水线与开发者脚本零报错兼容。
- **约束**：重构需在 Dispatcher 中维护隐藏 Parser 的透传规则，并通过 `test_cli_legacy_compatibility_matrix.py` 自动化测试进行保护。


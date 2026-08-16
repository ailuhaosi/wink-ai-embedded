# ADR-0062: Codegen Subsystem 5-Layer Package Structure and DAG Boundary Enforcement

- **Status**: Accepted
- **Date**: 2026-08-06
- **Context**: `wink-tools/tools/codegen/`
- **Deciders**: Wink-AI Architecture Team

---

## 1. Context and Problem Statement (背景与问题)

`wink-tools/tools/codegen/` 承载了 Wink Micro OS 的完整代码生成引擎与 YAML Schema 解析管线。由于历史演演进，22 个 Python 模块平铺在 `tools/codegen/` 根目录下，导致：
1. 模块边界模糊，数据模型（`yaml_schema.py`）、代码发射（`emit_config.py`）、渲染器（`yaml_render.py`）交织在同一层。
2. 部分模块存在隐式逆向依赖（如 `driver_record.py` 依赖 `emit_config` / `yaml_render`）。
3. 无自动化依赖检查机制，后续代码修改容易产生隐式环形依赖。

---

## 2. Decision Outcome (决策事项)

确立 `tools/codegen/` 内部的物理目录与 **5 层单向无环依赖图 (5-Layer Clean DAG)**：

```text
[Level 5] 顶层编排与根加载器: app_codegen.py, roots.py
                 │
                 ▼
[Level 4] 治理与迁移脚本包: tools/codegen/scripts/
                 │
                 ▼
[Level 3] 代码与配置生成器包: tools/codegen/generators/
                 │
                 ▼
[Level 2] 硬件驱动描述插件包: tools/codegen/drivers/
                 │
                 ▼
[Level 1] 数据模型与 Schema 解析包: tools/codegen/schema/
                 │
                 ▼
[Level 0] 基础物理 IO 与 Hook 包: tools/codegen/utils/
```

### 规则约束：
1. **渲染剥离 (Decoupling)**：`schema/driver_record.py` 退化为 100% 纯数据模型与约束求值，C 代码/CMake 渲染推演上提到 `generators/`。
2. **根加载器置顶 (`roots.py`)**：`roots.py` 作为合并角色与驱动 YAML 的加载器，位于 Level 5 顶层，禁止降级至 `utils/`。
3. **命名避免冗余 (`scripts/`)**：管理脚本放置在 `tools/codegen/scripts/`（包含 `list_drivers.py` 与 `migrate_schema.py`），严禁使用 `tools.codegen.tools`。
4. **废弃死代码清理**：清理无外部调用的遗留脚本 `gen_device_tree.py`。
5. **无中转别名 (Hard Refactoring)**：作为仓库内部构建引擎，所有调用点一次性更正为绝对导入 `from tools.codegen.<layer>.<module>`，不保留兼容 shim。
6. **自动化 DAG 门禁**：通过 `test_codegen_dag.py` 在 CI (`wink test`) 中强制校验包间导入，凡违反 DAG 层级顺序者直接阻断构建。

---

## 3. Status and Consequence (效果与影响)

- **物理结构极简**：`tools/codegen/` 根目录仅保留主入口 `app_codegen.py`、`roots.py` 与 `boards/`/`drivers/`/`templates/`/`tests/` 目录。
- **静态安全提升**：层级规则由 AST 测试自动化强制守护，杜绝架构腐坏。

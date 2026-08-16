# Phase 0 — Pre-flight CI Hardening

| 项 | 内容 |
|---|---|
| **文档类型** | 阶段子计划 |
| **所属总纲** | [`00-master-execution-plan.md`](./00-master-execution-plan.md) |
| **阶段前置条件** | 无（本阶段是所有其他阶段的前置依赖） |
| **预计工时** | 0.5 人天 |
| **目标完成日期** | 2026-08-10 |
| **状态** | Draft |
| **关联遗漏项** | M-6：`targets/wasm/` wink lint 盲区 |

> [!IMPORTANT]
> Phase 0 必须在 Phase 1 开始前合入。未完成本阶段，`#ifdef SIMULATION` 漂移进 `dal/` 无 CI 门禁保护，Phase 1 的核心清理目标无法被自动化验证。

---

## 1. 背景与问题

### 现状

`wink-tools` 已经有完整的 Python Lint 框架（`wink lint` CLI），内置 `layering.yaml` / `api.yaml` 等规则，涵盖 `bal/`、`dal/`、`runtime/` 的约束。

但经过摸底：
- `wink lint` 的 `layers` 定义**完全没有覆盖 `targets/wasm/` 和 `osal/wasm/`**
- `clang-tidy.yml` CI 只运行 clang-tidy 静态检查，**没有调用 `wink lint`**，也没有运行 `wink-tools` 自己的 Python 测试

### 风险

| 风险 | 具体后果 |
|---|---|
| `#ifdef SIMULATION\|WASM` 漂移进 `dal/src/` | Phase 1 删除的 Deprecated 代码可能被重新引入，无任何 CI 拦截 |
| `wink lint` 规则更新无测试保护 | `layering.yaml` 规则改动可能静默失效 |
| `wasm_bridge.h` 变更无 C 侧结构性门禁 | 只有 TS 侧的 `cross-repo-contract.test.ts` 保护，C 侧为空白 |

---

## 2. 改动方案

### Task 0.1 — 在 `layering.yaml` 中新增 `WASM-DAL-ISOLATION` 规则

**文件**：[`wink-tools/tools/lint/rules/layering.yaml`](../../../../../wink-tools/tools/lint/rules/layering.yaml)

新增一条 `api_rules` 规则，禁止在 `dal/src/` 目录下出现 `#ifdef SIMULATION` 或 `#ifdef WASM` 条件编译：

```yaml
- id: WASM-DAL-ISOLATION
  in: [dal_src]
  deny_regex:
    - pattern: '#\s*(ifdef|if\s+defined)\s*(SIMULATION|WASM|__EMSCRIPTEN__)'
  context:
    strip_comments: false   # 必须扫描注释，防止注释掩盖真实代码
    strip_strings: true
    scope_by_kind:
      source: full
  except_regex: []
  message: >-
    ADR-0003 §3 red-line: dal/src must not contain any #ifdef SIMULATION/WASM
    conditional. All physical interception MUST happen in targets/wasm/ only.
  severity: error
  immutable: true
  refs: ["ADR-0003"]
```

### Task 0.2 — 将 `wink lint` 和 `pytest wink-tools` 加入 CI

**文件**：[`.github/workflows/clang-tidy.yml`](../../../../../.github/workflows/clang-tidy.yml)

在现有 clang-tidy 步骤后追加两个步骤：

```yaml
- name: Install wink-tools dependencies
  run: |
    pip install -r wink-tools/requirements-lint-dal.txt

- name: Run wink lint (layering + API rules)
  working-directory: wink-micro-os
  run: |
    python ../wink-tools/wink.py lint --strict

- name: Run wink-tools Python tests
  run: |
    python -m pytest wink-tools/tools/tests/ -x -q
```

### Task 0.3 — 为新规则补充单元测试

**文件**：新建 `wink-tools/tools/tests/test_lint_wasm_isolation.py`

```python
"""Tests for WASM-DAL-ISOLATION lint rule (Phase 0 Task 0.3)."""
# 验证在 dal/src/ 中出现 #ifdef SIMULATION 时规则触发
# 验证在 targets/wasm/ 中出现 #ifdef SIMULATION 时规则不触发（不在约束 layer 内）
# 验证正常 dal/src/ 文件不触发误报
```

---

## 3. 任务列表

- [x] **Task 0.1**: 在 `layering.yaml` 中添加 `WASM-DAL-ISOLATION` api_rule
- [x] **Task 0.2**: 在 `clang-tidy.yml` 中追加 `wink lint --strict` 和 `pytest wink-tools/tools/tests/` 步骤
- [x] **Task 0.3**: 编写 `test_lint_wasm_isolation.py` 验证新规则正负用例
- [x] **Task 0.4**: 本地验证 `wink lint --strict` 对现有 `wink-micro-os` 代码无误报

---

## 4. 验证计划

### 本地验证

```bash
# 在 wink-micro-os 根目录运行，确认无误报
python ../wink-tools/wink.py lint --strict

# 运行新增测试
python -m pytest wink-tools/tools/tests/test_lint_wasm_isolation.py -v
```

### 完成门禁（Done Criteria）

- [x] `WASM-DAL-ISOLATION` 规则在 CI 中激活且有单元测试覆盖
- [x] `wink lint --strict` 在 CI 中作为 Required Check
- [x] `pytest wink-tools/tools/tests/` 单元测试通过
- [x] M-6 状态更新为 ☑


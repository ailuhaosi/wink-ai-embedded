# 可配置分层 Lint（`wink lint`）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> Domain skill: 无固件改动时以 Python/TDD 为主；触及分层红线文档时对照 `embedded-best-practice` 与 ADR-0043。

**Goal:** 交付 YAML 驱动的分层/API lint 引擎与 `wink lint` CLI，用 file:line Finding 门禁 App/BAL/DAL/PAL 边界，并迁出 `bal/CMakeLists.txt` 中重复的 include/命名 REGEX 检查。

**Architecture:** `tools/lint/engine` 加载 `tools/lint/rules/*.yaml`，按 layer 分类文件后运行 include/api/path packs；`wink.py lint` 为入口（跳过 toolchain gate）；`python wink-tools/wink.py test` 收敛调用；例外经 `allow_paths` 配置，不改引擎放行。

**Tech Stack:** Python 3.10+、PyYAML（若 SDK 未依赖则用 stdlib 可解析的最小子集 **或** 在 `tools/requirements`/文档中声明 `PyYAML`；优先检查现有依赖——无则 Task 1 引入）、unittest、PowerShell `python wink-tools/wink.py test`。

## Global Constraints

- SSOT：[ADR-0043](../../decisions/tools/0043-yaml-driven-layer-lint.md)、[tech-design](../../tech-designs/tools/2026-07-20-configurable-layer-lint-design.md)。
- Finding **必须**含 `path`；`line` 允许 `None`（`locator=filename` 的 path-only 规则），其余场景强制 1-based。
- Finding 必须携带 `rule_source` 与稳定 `fingerprint`（供 `--baseline` 稳定 diff）。
- SDK 规则可标 `immutable: true`；workspace overlay 对 immutable 规则**只允许追加** `allow_paths`，禁止 disable/降级 severity/改 pattern。
- v1 **禁止** autofix、clang 真 include 图、完整预处理器；`#if 0` 条件块与宏拼接 include 明确非目标。
- `wink lint` **跳过** toolchain `ensure_for`（与 `doctor`/`setup` 同类）。
- 迁 CMake 门禁前：必须通过 **Task 7.5 Parity 双跑门**（fail/pass 集合与 CMake 完全一致）。
- `until` 到期语义：到期前 30 天 emit `info`，7 天内 emit `warning`；`--strict` 才计 fail；`--today` / `$WINK_LINT_TODAY` 可 override。
- Commit message 英文、按 Task 原子提交；不改无关固件逻辑。
- 验收：`python wink-micro-os/tools/wink.py lint` 对 SDK 可跑通；相关 `tools/tests/test_lint_*.py` 全绿；`python wink-tools/wink.py test` 中 lint 段改调 `wink lint` 后全绿；性能预算：cold 全扫 ≤ 3s、`--changed` ≤ 500ms。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260720-LAYER-LINT` |
| **创建日期** | 2026-07-20 |
| **计划状态** | ✅ 已完成（Task 10b 跳过，见 backlog） |
| **优先级** | 🟡 P1 |
| **关联 ADR** | [ADR-0043](../../decisions/tools/0043-yaml-driven-layer-lint.md)（Accepted） |
| **关联技术设计** | [2026-07-20-configurable-layer-lint-design.md](../../tech-designs/tools/2026-07-20-configurable-layer-lint-design.md) |
| **关联活规范（完成后回写）** | [06-bal-layer.md](../../design/02-wink-micro-os/06-bal-layer.md)、[03-directory-architecture.md](../../design/02-wink-micro-os/03-directory-architecture.md)、[tools/README.md](../scripts/README.md) |
| **所需技能** | `writing-plans` 产出；执行用 `subagent-driven-development` / `executing-plans` |

---

## 2. 文件变更总览

| 路径 | 变更 |
|------|------|
| `docs/decisions/tools/0043-yaml-driven-layer-lint.md` | 已建 Proposed；Accepted 时改状态并回写规范 |
| `docs/tech-designs/tools/2026-07-20-configurable-layer-lint-design.md` | 已建 |
| `wink-micro-os/tools/lint/engine/` | 🆕 核心引擎（含 lexer / include extractor） |
| `wink-micro-os/tools/lint/packs/` | 🆕 include / api / path / legacy |
| `wink-micro-os/tools/lint/rules/*.yaml` | 🆕 layering / api 规则包 |
| `wink-micro-os/tools/lint/testdata/` | 🆕 正反例树 + `parity_probe/` |
| `wink-micro-os/tools/lint/__main__.py` 或 `run_lint.py` | 🆕 可被 wink 调用的入口 |
| `wink-micro-os/tools/wink.py` | ✏️ 增加 `lint` 子命令（含 `--paths` / `--changed` / `--today`） |
| `wink-micro-os/tools/tests/test_lint_*.py` | 🆕（含 `test_lint_parity.py`） |
| `wink-micro-os/bal/CMakeLists.txt` | ✏️ 删除已迁出的 REGEX 门禁（保留 INTERFACE include 检查） |
| `python wink-tools/wink.py test` | ✏️ lint 段改调 `wink lint` |
| `wink-micro-os/tools/README.md` | ✏️ 文档 |
| `.claude/rules/c-code.md` | ✏️ 提示 AI 生成 C 代码前先自查分层红线 |
| `CLAUDE.md` | ✏️ Critical Patterns 增加「分层门禁：`wink lint`（ADR-0043）」 |
| `docs/design/02-wink-micro-os/06-bal-layer.md` / `03-directory-architecture.md` | ✏️ CI 门禁改为 `wink lint`（Task 10c 回写） |

**依赖探测（执行 Task 1 前）：**

```powershell
# 若无 PyYAML，计划采用 stdlib-only：限制 YAML 子集用自研最小 loader，或添加 PyYAML。
# 推荐：使用 PyYAML（与多数 Python CI 一致）。检查：
python -c "import yaml; print(yaml.__version__)"
```

若 import 失败：在 `wink-micro-os/tools/requirements-lint.txt` 写 `PyYAML>=6`，并在 `tools/README.md` / `preinstall.md` 注明；CI/`run-tests` 安装或文档要求预装。

---

## 3. 背景与验收

### 3.1 问题

分层红线散落在 CMake 与多个 lint 脚本；例外无法配置化；缺少统一 `file:line` 报告与 `wink` 入口。

### 3.2 成功指标

| 指标 | 通过标准 |
|------|----------|
| 引擎单测 | `python -m unittest discover -s wink-micro-os/tools/tests -p "test_lint_*.py" -v` 全绿 |
| CLI | `python wink-micro-os/tools/wink.py lint --pack layering` 对当前树 exit 码符合规则（已知债用 allowlist/warning） |
| 等价迁出 | 删除 BAL CMake include/命名 REGEX 后，同违规仍被 `wink lint` 抓住 |
| CI | `python wink-tools/wink.py test` lint 段只调 `wink lint`（arduino/symbols 可暂 `--pack` 分列） |
| 报告 | 故意植入 `#include "pal_hal.h"` 于测试 fixture → 输出含路径与行号 |

---

## Task 0: 确认 ADR-0043 并锁定 Schema

**Files:**
- Modify: `docs/decisions/tools/0043-yaml-driven-layer-lint.md`（状态 → Accepted，若 Owner 批准）
- Verify: tech-design schema 与下文 Task 代码字段名一致

**Interfaces:**
- Produces: Accepted ADR；冻结 `version: 1` 字段名（`layers` / `include_rules` / `api_rules` / `path_rules` / `ignore`）

- [x] **Step 1:** Owner 确认 ADR-0043 Accepted；若有措辞修改，同步 tech-design。
- [x] **Step 2:** 在本计划元数据将状态改为 🔄 执行中。
- [x] **Step 3: Commit（仅文档）**

```bash
git add docs/decisions/tools/0043-yaml-driven-layer-lint.md docs/tech-designs/tools/2026-07-20-configurable-layer-lint-design.md docs/implementation-plans/tools/2026-07-20-configurable-layer-lint-plan.md
git commit -m "$(cat <<'EOF'
docs: accept ADR-0043 YAML layer lint and lock plan

EOF
)"
```

---

## Task 1: Finding 模型 + 最小引擎骨架（TDD）

**Files:**
- Create: `wink-micro-os/tools/lint/engine/__init__.py`
- Create: `wink-micro-os/tools/lint/engine/models.py`
- Create: `wink-micro-os/tools/lint/engine/classify.py`
- Create: `wink-micro-os/tools/lint/engine/runner.py`
- Create: `wink-micro-os/tools/tests/test_lint_models.py`
- Create: `wink-micro-os/tools/tests/test_lint_classify.py`

**Interfaces:**
- Produces:
  - `Finding(rule_id, severity, path, line, column, message, snippet, help, refs, allowlisted, rule_source, fingerprint)`
    - `line: int | None`（`None` 表示 path-only / `locator=filename`）
    - `rule_source: str = "sdk"`（sdk | workspace | cli）
    - `fingerprint: str`（sha1 of `rule_id|path|line|snippet_norm`；构造后自动计算）
  - `classify_file(rel_path: str, layers: dict, ignore: list) -> tuple[str, str] | None`  # (layer_id, kind)；ignore.scope=classify 命中返回 None
  - `LintConfig` dataclass loaded later in Task 2

- [ ] **Step 1: Write failing tests**

```python
# tools/tests/test_lint_models.py
from tools.lint.engine.models import Finding

def test_finding_allows_none_line_for_path_only():
    f = Finding(
        rule_id="BAL-NAME-1", severity="error", path="bal/include/x_helper.h",
        line=None, column=None, message="m", snippet=None,
        help=None, refs=("ADR-0038",), allowlisted=False,
        rule_source="sdk",
    )
    assert f.line is None
    assert f.fingerprint  # 非空

def test_finding_fingerprint_stable_under_whitespace():
    f1 = Finding(rule_id="X", severity="error", path="a.h", line=7,
                 column=1, message="m", snippet='  #include  "pal_hal.h"  ',
                 help=None, refs=(), allowlisted=False, rule_source="sdk")
    f2 = Finding(rule_id="X", severity="error", path="a.h", line=7,
                 column=1, message="m", snippet='#include "pal_hal.h"',
                 help=None, refs=(), allowlisted=False, rule_source="sdk")
    assert f1.fingerprint == f2.fingerprint
```

```python
# tools/tests/test_lint_classify.py
from tools.lint.engine.classify import classify_file

LAYERS = {
    "bal_public": {"roots": ["bal/include"], "kind": "public_header"},
    "bal_src": {"roots": ["bal/src"], "kind": "source"},
}

def test_classify_bal_public_header():
    assert classify_file("bal/include/input/wink_button_events.h", LAYERS, []) == (
        "bal_public", "public_header"
    )

def test_classify_longest_prefix_wins():
    layers = {
        "bal_public": {"roots": ["bal/include"], "kind": "public_header"},
        "bal_math": {"roots": ["bal/include/math"], "kind": "public_header"},
    }
    assert classify_file("bal/include/math/wink_pid.h", layers, [])[0] == "bal_math"

def test_classify_ignore_scope_classify():
    ignore = [{"path": "third_party/**", "scope": ["classify"]}]
    assert classify_file("third_party/foo/bar.h", LAYERS, ignore) is None
```

- [ ] **Step 2: Run tests — expect FAIL (import error)**

```powershell
cd wink-micro-os
python -m unittest tools.tests.test_lint_models tools.tests.test_lint_classify -v
```

- [ ] **Step 3: Implement `models.py` + `classify.py`（纯函数，无 I/O）**
- [ ] **Step 4: Re-run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add wink-micro-os/tools/lint/engine wink-micro-os/tools/tests/test_lint_models.py wink-micro-os/tools/tests/test_lint_classify.py
git commit -m "$(cat <<'EOF'
feat(lint): add Finding model and layer path classifier

EOF
)"
```

---

## Task 2: YAML 加载 + schema 校验

**Files:**
- Create: `wink-micro-os/tools/lint/engine/config.py`
- Create: `wink-micro-os/tools/lint/rules/layering.yaml`（先最小 stub：`version/id/metadata` + layers + 1 条 include_rule）
- Create: `wink-micro-os/tools/tests/test_lint_config.py`
- Create: `wink-micro-os/tools/requirements-lint.txt`（若需 PyYAML）

**Interfaces:**
- Produces: `load_configs(paths: list[Path]) -> LintConfig`
- `LintConfig.layers`, `.include_rules`, `.api_rules`, `.path_rules`, `.ignore`, `.packs`（pack id → 起源）
- 每条规则内部保留 `rule_source` 与 `immutable` 属性；合并冲突时按 tech-design §3.6 消解

- [ ] **Step 1: Failing test — load stub YAML with version/id/metadata**

```python
def test_load_layering_stub(tmp_path):
    p = tmp_path / "layering.yaml"
    p.write_text(
        "version: 1\nid: layering\n"
        "metadata: {owner: 'wink-arch', adr: ['ADR-0043']}\n"
        "layers:\n  bal_public:\n"
        "    roots: ['bal/include']\n    kind: public_header\n"
        "include_rules: []\napi_rules: []\npath_rules: []\nignore: []\n",
        encoding="utf-8",
    )
    from tools.lint.engine.config import load_configs
    cfg = load_configs([p])
    assert "bal_public" in cfg.layers
    assert cfg.packs["layering"].source == "sdk"

def test_load_unknown_top_key_raises(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("version: 1\nid: x\nlayers: {}\nunknown_field: 1\n",
                 encoding="utf-8")
    from tools.lint.engine.config import load_configs, LintConfigError
    import pytest
    with pytest.raises(LintConfigError):
        load_configs([p])

def test_workspace_overlay_cannot_disable_immutable(tmp_path):
    # 见 tech-design §3.6：workspace disable immutable rule → LintConfigError
    ...
```

- [ ] **Step 2: Implement loader；未知顶层键 → raise `LintConfigError`；version != 1 → raise**
- [ ] **Step 3: Write real `rules/layering.yaml` 最小内容（`version/id/metadata`+ layers 定义，规则可空列表）**
- [ ] **Step 4: Tests PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(lint): load and validate YAML rule packs with schema v1

EOF
)"
```

---

## Task 3: include 抽取 + include_graph pack

**Files:**
- Create: `wink-micro-os/tools/lint/engine/lexer.py`  # 共享的注释/字符串剥离
- Create: `wink-micro-os/tools/lint/engine/includes.py`
- Create: `wink-micro-os/tools/lint/packs/include_graph.py`
- Create: `wink-micro-os/tools/lint/testdata/bal_hdr_ok/bal/include/x.h`
- Create: `wink-micro-os/tools/lint/testdata/bal_hdr_bad/bal/include/x.h`
- Create: `wink-micro-os/tools/tests/test_lint_lexer.py`
- Create: `wink-micro-os/tools/tests/test_lint_include_graph.py`

**Interfaces:**
- Produces:
  - `strip_comments_and_strings(text: str) -> str`  # 状态机剥离 //, /* */, "…", '…'（保留行号占位）
  - `join_continuations(text: str) -> str`          # 反斜杠续行合并
  - `extract_includes(text: str) -> list[tuple[int, str, str]]`  # (line, header, form: 'quote'|'angle')
  - `check_includes(file_path, text, layer_id, cfg) -> list[Finding]`  # 支持 match=basename/literal/resolved

**词法处理契约（tech-design §5.1）：**
1. 剥离 UTF-8 BOM；
2. 状态机剥离行/块注释与字符串字面量（保留行号占位）；
3. 合并 `\\\n` 续行；
4. `^\s*#\s*include\s+(?:<([^>]+)>|"([^"]+)")` 匹配（允许 `#` 与 `include` 之间空白）；
5. **不处理**：`#if 0` 条件块、宏拼接 include（v1 非目标，由 `allow_paths` 处理）。

- [ ] **Step 1: Lexer tests**

```python
def test_lexer_strips_line_comment_keeps_line_no():
    from tools.lint.engine.lexer import strip_comments_and_strings
    out = strip_comments_and_strings('a // #include "pal_hal.h"\nb\n')
    assert '#include "pal_hal.h"' not in out
    assert out.count('\n') == 2

def test_lexer_strips_block_comment_multiline():
    from tools.lint.engine.lexer import strip_comments_and_strings
    src = '/* #include "pal_hal.h"\n */\n#include "wink_status.h"\n'
    out = strip_comments_and_strings(src)
    assert '"pal_hal.h"' not in out
    assert '"wink_status.h"' in out

def test_extract_include_with_spaces_and_continuation():
    from tools.lint.engine.includes import extract_includes
    text = '#  include \\\n "pal_hal.h"\n'
    incs = extract_includes(text)
    assert incs and incs[0][1] == "pal_hal.h"
```

- [ ] **Step 2: include_graph tests（含 match 语义矩阵）**

```python
def test_bal_public_denies_pal_hal_basename(tmp_path):
    # cfg: bal_public deny match=basename pattern=pal_.*\.h except_basename=[pal_log.h]
    # 代码 #include "pal/pal_hal.h" → Finding line==1 rule_id=BAL-HDR-NO-PAL
    ...

def test_bal_public_allows_pal_log_via_except_basename():
    # #include "pal_log.h" → 无 Finding
    ...

def test_include_forms_quote_only_skips_angle():
    # rule include_forms=[quote]，代码 #include <pal_hal.h> → 不触发
    ...
```

- [ ] **Step 3: Implement lexer / extract / pack；`match=resolved` 若解析失败退化为 literal**
- [ ] **Step 4: 在 `layering.yaml` 加入 `BAL-HDR-NO-PAL`（与 CMake 等价）**
- [ ] **Step 5: PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(lint): include_graph pack with lexical extraction and BAL-HDR-NO-PAL

EOF
)"
```

---

## Task 4: allow_paths / until + runner 编排

**Files:**
- Modify: `wink-micro-os/tools/lint/engine/runner.py`
- Modify: `wink-micro-os/tools/lint/packs/include_graph.py`
- Create: `wink-micro-os/tools/lint/engine/allowlist.py`  # until 分级：过期 / 7 天内 / 30 天内 / 有效
- Create: `wink-micro-os/tools/tests/test_lint_allowlist.py`

**Interfaces:**
- Produces:
  - `run_lint(root: Path, cfg: LintConfig, packs: list[str] | None, paths: list[Path] | None, today: date | None) -> list[Finding]`
  - `evaluate_until(entry, today) -> Literal["active", "expiring_soon", "expiring_notice", "expired"]`
- 语义：
  - `active`：Finding.allowlisted=True，不计 fail
  - `expiring_notice`（≤30 天）：allowlisted=True，附加 severity=`info` 的伴随 Finding
  - `expiring_soon`（≤7 天）：allowlisted=True，附加 severity=`warning`；`--strict` 时计 fail
  - `expired`：allowlisted=False（放行失效），原 error 照常触发；额外 message 前缀 `[allowlist expired]`
- `--today` / `$WINK_LINT_TODAY` 支持 override

- [ ] **Step 1: Tests**

```python
def test_allow_path_active_suppresses(tmp_path):
    # until: today+60, allow_paths 命中 → allowlisted=True，无 error
    ...

def test_expiring_notice_emits_info(tmp_path):
    # until: today+15 → 除原规则 allowlisted 外，产生 info 伴随 Finding
    ...

def test_expiring_soon_emits_warning_strict_fails(tmp_path):
    # until: today+3 → warning 伴随；非 strict exit 0；strict exit 1
    ...

def test_expired_until_still_errors(tmp_path):
    # until: today-1 → allowlisted=False，原 error 产生，message 含 "allowlist expired"
    ...

def test_today_env_override(monkeypatch):
    monkeypatch.setenv("WINK_LINT_TODAY", "2027-01-01")
    ...
```

- [ ] **Step 2: Implement path glob match（相对 SDK root，`**` 用 `pathlib.PurePosixPath.match` + `fnmatch` 补齐）**
- [ ] **Step 3: Implement `evaluate_until` 与伴随 Finding 生成**
- [ ] **Step 4: PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(lint): allow_paths with graded until expiry (info/warning/error)

EOF
)"
```

---

## Task 5: 文本报告 + `wink lint` CLI

**Files:**
- Create: `wink-micro-os/tools/lint/engine/report.py`
- Create: `wink-micro-os/tools/lint/cli.py`
- Modify: `wink-micro-os/tools/wink.py`（`lint` subparser；`command not in ("doctor", "setup", "lint")`）
- Create: `wink-micro-os/tools/tests/test_lint_cli.py`
- Modify: `wink-micro-os/tools/tests/test_toolchain_cli.py`（若断言子命令列表则追加 `lint`）

**Interfaces:**
- Produces: `format_text(findings) -> str`；`handle_lint(args)`；exit code 映射

- [ ] **Step 1: Test text format contains `-->` path:line**

```python
def test_text_report_has_location():
    from tools.lint.engine.report import format_text
    from tools.lint.engine.models import Finding
    f = Finding(..., path="dal/include/actuator/dal_motor.h", line=7, ...)
    out = format_text([f])
    assert "dal/include/actuator/dal_motor.h:7" in out
    assert "error[" in out or "error[" in out.lower() or "DAL-" in out
```

- [ ] **Step 2: Implement `format_text`；json 可先最小 `json.dumps` 列表**
- [ ] **Step 3: Wire `wink.py`**

```python
p_lint = sub.add_parser("lint", parents=[global_parent], help="Run YAML layer/API lints")
p_lint.add_argument("--root", default=None)
p_lint.add_argument("--config", action="append", default=[])
p_lint.add_argument("--pack", action="append", default=None)
p_lint.add_argument("--rule", default=None)
p_lint.add_argument("--paths", nargs="*", default=None)          # 增量扫描
p_lint.add_argument("--changed", nargs="?", const="HEAD", default=None)  # git diff --name-only
p_lint.add_argument("--format", choices=["text", "json", "sarif"], default="text")
p_lint.add_argument("--output", default=None)
p_lint.add_argument("--strict", action="store_true")
p_lint.add_argument("--explain", metavar="RULE_ID", default=None)
p_lint.add_argument("--report-allowlist", action="store_true")
p_lint.add_argument("--baseline", default=None)
p_lint.add_argument("--today", default=None)                     # 也读 $WINK_LINT_TODAY
p_lint.set_defaults(handler=handle_lint)

# gate:
if args.command not in ("doctor", "setup", "lint"):
    ...
```

- [ ] **Step 4: Subprocess smoke**

```powershell
python wink-micro-os/tools/wink.py lint --help
python wink-micro-os/tools/wink.py lint --pack layering
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(lint): add wink lint CLI with file:line text report

EOF
)"
```

---

## Task 6: 补全 layering 规则至与 BAL CMake 等价 + DAL-HDR-NO-HAL

**Files:**
- Modify: `wink-micro-os/tools/lint/rules/layering.yaml`
- Create: `wink-micro-os/tools/lint/packs/path_name.py`（BAL-NAME-1 filenames）
- Create: `wink-micro-os/tools/tests/test_lint_layering_parity.py`

**规则清单（必须全部落地）：**

| rule_id | 来源 | locator | 要点 |
|---------|------|---------|------|
| `BAL-HDR-NO-PAL` | CMake ADR-0023 | line | `include_rules` deny `pal_*.h` except_basename=`pal_log.h` on `bal_public` |
| `BAL-NAME-1` | CMake | `filename` | `path_rules` forbid `*_helper.h` / `*_controller.h` under `bal/include` |
| `BAL-MATH-1` | CMake | `first_content_hit` | `bal/include/math/*.h` 禁 `dal_` / `pal_` / runtime 符号；定位到首次命中行 |
| `BAL-NAME-2` | CMake | `first_content_hit` | 公共头禁 `\bsonar\b`（定位到首次出现行） |
| `DAL-HDR-NO-HAL` | 架构评审 | line | `dal_public` deny `pal_hal.h`；**首发 severity: warning + allow_paths(motor/encoder, until)**，Task 10c 升 error |
| `BAL-SRC-HAL-ALLOWLIST` | 架构评审 | line | `bal_src` deny `pal_hal.h`；allow `bal/src/input/wink_button_events_irq.c` |

**注意：** 详细的 fail/pass parity 验证在 **Task 7.5** 完成；本 Task 只需保证规则 YAML 表达完整。

- [ ] **Step 1: 写规则单元测试——对 `testdata/` 最小正反例断言 rule_id 与 line 正确**
- [ ] **Step 2: 填满 YAML + `path_name` / `regex_ban` pack（`first_content_hit` locator）**
- [ ] **Step 3: `wink lint --pack layering` 对干净树：仅允许已知 DAL warning/allowlist**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(lint): parity layering rules for BAL gates and DAL HAL leak

EOF
)"
```

---

## Task 7: api pack（NO-OPS / NO-MALLOC / bool warning）

**Files:**
- Create: `wink-micro-os/tools/lint/rules/api.yaml`
- Create: `wink-micro-os/tools/lint/packs/api_surface.py`
- Create: `wink-micro-os/tools/tests/test_lint_api_surface.py`

**规则：**

| rule_id | severity | 范围 | context |
|---------|----------|------|---------|
| `NO-OPS-VTABLE` | error | bal/dal 公/私源 | `strip_comments+strings`；`context.scope_by_kind.public_header=declarations_only` |
| `NO-MALLOC-HOTPATH` | **warning（首发）** | bal_src、dal_src、runtime src | 剥离注释与字符串；`except_regex` 允许常见命名冲突；观察后由后续 ADR 升 error |
| `STATUS-NOT-BOOL-PUBLIC` | warning | dal_public | 逻辑行合并后匹配 `^(?:__\w+\([^)]*\)\s*)*\bbool\s+dal_\w+\s*\(`；已知漏检在 message 声明 |

**注意事项：**
- `NO-MALLOC-HOTPATH` 首发 warning 避免 CI 全红；升 error 需单独 ADR 或补充说明。
- 所有 api 规则默认 `strip_comments+strings=true`，测试须覆盖"注释里的 malloc 不触发"。

- [ ] **Step 1: Tests（含注释/字符串剥离误报防护）**

```python
def test_no_malloc_ignores_comments():
    # 头文件里 // malloc(...) 说明 -> 无 Finding
    ...

def test_no_malloc_ignores_string_literal():
    # const char* s = "malloc"; -> 无 Finding
    ...

def test_no_malloc_ignores_named_free_slot():
    # static void free_slot(...) 命中 except_regex -> 无 Finding
    ...

def test_no_ops_declarations_only_in_public_header():
    # public header 函数体内 _ops 局部变量不触发；结构体定义触发
    ...
```

- [ ] **Step 2–4: TDD 实现 + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(lint): api_surface pack for ops, malloc (warn), and bool DAL APIs

EOF
)"
```

---

## Task 7.5: Parity 双跑门（迁 CMake 的硬凭据）

**Purpose:** 在 Task 8 删除 `bal/CMakeLists.txt` 分层 REGEX 门禁**之前**，用可重复的证据证明 `wink lint` 与 CMake 检查在同一 fixture 上产生**完全一致**的 fail/pass 集合。这是 tech-design §8.1 的 hard gate。

**Files:**
- Create: `wink-micro-os/tools/lint/testdata/parity_probe/bad/` — 每条规则一个违规最小样本
- Create: `wink-micro-os/tools/lint/testdata/parity_probe/good/` — 每条规则一个合法边缘样本
- Create: `wink-micro-os/tools/lint/testdata/parity_probe/cmake_replay.py` — 从 `bal/CMakeLists.txt` 提取 REGEX 常量并在 Python 端重放
- Create: `wink-micro-os/tools/tests/test_lint_parity.py`

**Interfaces:**
- Produces:
  - `run_cmake_replay(root: Path) -> dict[str, set[str]]`（按 path 归组的 rule_id 集合）
  - `run_wink_lint_for_parity(root: Path) -> dict[str, set[str]]`

**违规样本清单（bad/）：**
- `bal/include/motion/bad_include_pal_hal.h` → `BAL-HDR-NO-PAL`
- `bal/include/motion/motion_helper.h` → `BAL-NAME-1`
- `bal/include/motion/motion_controller.h` → `BAL-NAME-1`
- `bal/include/math/leaky.h` 内含 `#include "dal_motor.h"` → `BAL-MATH-1`
- `bal/include/motion/sonar_probe.h` → `BAL-NAME-2`
- `dal/include/actuator/dal_leaky.h` 内含 `#include "pal_hal.h"` → `DAL-HDR-NO-HAL`

**合法边缘清单（good/）：**
- `bal/include/motion/wink_button_events.h`（含 `#include "pal_log.h"`，符合 `except_basename`）
- `bal/src/input/wink_button_events_irq.c`（命中 `BAL-SRC-HAL-ALLOWLIST` allow）
- `bal/include/math/wink_pid.h`（纯数学，无禁词）
- `dal/src/actuator/dal_motor.c`（DAL src 用 HAL 合法）

- [ ] **Step 1: 抽取 CMake REGEX 到 `cmake_replay.py`（`_BAL_FORBIDDEN_INCLUDE_REGEX` / `_BAL_MATH_FORBIDDEN_REGEXES` / `BAL-NAME-1` glob / `\bsonar\b`）**
- [ ] **Step 2: parity_probe 双侧运行断言**

```python
def test_parity_bad_tree_matches():
    cmake_fails = run_cmake_replay(BAD_ROOT)
    lint_fails = run_wink_lint_for_parity(BAD_ROOT)
    assert cmake_fails == lint_fails, f"diff: {cmake_fails ^ lint_fails}"

def test_parity_good_tree_matches():
    assert run_cmake_replay(GOOD_ROOT) == {}
    assert run_wink_lint_for_parity(GOOD_ROOT) == {}
```

- [ ] **Step 3: 若不一致，补规则或调整 `cmake_replay`，直到集合一致**
- [ ] **Step 4: Commit（本步骤只落"证据"，不改 CMake / run-tests）**

```bash
git commit -m "$(cat <<'EOF'
test(lint): parity probe proving wink lint matches CMake gates

EOF
)"
```

---

## Task 8: 迁出 BAL CMake 重复门禁 + 接入 run-tests

**Files:**
- Modify: `wink-micro-os/bal/CMakeLists.txt` — 删除 `_BAL_FORBIDDEN_INCLUDE_REGEX` 循环、`BAL-NAME-1/2`、`BAL-MATH-1` 的 `file(READ)` 检查；**保留** `BAL-INC-2`（INTERFACE include）与 `BAL-SRC-1`（镜像）——二者属链接/布局，留 CMake。
- Modify: `python wink-tools/wink.py test` — 在现有 lint 段增加或替换：

```powershell
Write-Host "[lint] wink layer lint (ADR-0043)..." -ForegroundColor Cyan
& python (Join-Path $PSScriptRoot 'tools/wink.py') lint --pack layering --pack api
if ($LASTEXITCODE -ne 0) {
    Write-Error "[lint] wink lint failed"
    ...
}
```

- Modify: `wink-micro-os/tools/README.md` — 文档 `wink lint`
- Modify: `docs/design/02-wink-micro-os/06-bal-layer.md` — CI 门禁改为指向 `wink lint`

- [ ] **Step 1: 确认 Task 7.5 parity 双跑门通过（fail/pass 集合完全一致）；确认 `wink lint --pack layering` 在删除 CMake 检查前对干净树 PASS（或仅已知 warning）**
- [ ] **Step 2: 删除 CMake 重复块**
- [ ] **Step 3: `python wink-tools/wink.py test`（或至少 host configure + lint 段）**
- [ ] **Step 4: Commit（parity 证据 commit 与本 CMake 删除 commit 应处于同一 PR）**

```bash
git commit -m "$(cat <<'EOF'
refactor: move BAL layering gates from CMake to wink lint

EOF
)"
```

---

## Task 9: Legacy pack 适配（Arduino isolation）

**Files:**
- Create: `wink-micro-os/tools/lint/packs/legacy_arduino.py`（调用或内联现有 `check_arduino_isolation` 逻辑，输出 `Finding`）
- Modify: `python wink-tools/wink.py test` — Arduino isolation 段改为 `wink lint --pack arduino`（symbols 审计仍可保留独立脚本，因其依赖 build_dir）

- [x] **Step 1: Adapter 保持与 `check_arduino_isolation.py` 相同 fail 集合**
- [x] **Step 2: run-tests 接线**
- [x] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(lint): wrap Arduino isolation as wink lint pack

EOF
)"
```

---

## Task 10a: SARIF 输出 + `--explain` 命令

**Files:**
- Modify: `wink-micro-os/tools/lint/engine/report.py` — `format_sarif`
- Modify: `wink-micro-os/tools/lint/cli.py` — `--explain`、`--output`
- Create: `wink-micro-os/tools/tests/test_lint_sarif.py`
- Create: `wink-micro-os/tools/tests/test_lint_explain.py`

**Interfaces:**
- SARIF 2.1.0 最小可用子集：`runs[].results[].locations[].physicalLocation.artifactLocation.uri` + `region.startLine`；path-only 规则输出 `region.startLine=1` 且 `properties.locator="filename"`。
- `--explain RULE_ID` 打印 tech-design §8.2 模板并 exit 0。

- [x] **Step 1: SARIF 结构 & `--explain` 输出模板测试**

```python
def test_sarif_has_physical_location_region():
    ...

def test_sarif_path_only_rule_marks_locator():
    # BAL-NAME-1 结果 properties.locator == "filename"
    ...

def test_explain_prints_template_and_exits_zero():
    ...
```

- [x] **Step 2: 实现 + 通过**
- [x] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(lint): SARIF output and --explain command

EOF
)"
```

---

## Task 10b: 修复 DAL 头文件 HAL 泄露（motor / encoder）

> **前置：** 本 Task 触及固件代码；若 `wink_pin_t` 迁移面过大，可**跳过本 Task**直接进入 10c 保留 allowlist + until，作为 backlog 单独开 issue。

**Files:**
- Modify: `wink-micro-os/dal/include/actuator/dal_motor.h` — 去除 `#include "pal_hal.h"`
- Modify: `wink-micro-os/dal/include/actuator/dal_encoder.h` — 去除 `#include "pal_hal.h"`
- Modify: 相关 typedef 承接头（如 `wink_types.h` 或 `wink_pin_t` 独立头，最小改动）
- Verify: 双 target 编译（Wasm + ESP32）通过；所有依赖此二头的 `.c` 正常构建

**Interfaces:**
- Produces: DAL 公共头不再依赖 HAL；`wink_pin_t` 通过前向声明或独立 typedef 头暴露

- [x] **Step 1: 决定承接位置** — **SKIPPED**（`pal_gpio_mode_t` 抽取面过大；保留 allowlist + until）
- [ ] **Step 2: 修改 2 个 dal 头，替换 include** — skipped
- [ ] **Step 3: 全量 host + esp32 构建验证** — skipped
- [ ] **Step 4: Commit** — skipped（backlog）

```bash
git commit -m "$(cat <<'EOF'
refactor(dal): remove pal_hal.h from motor/encoder public headers

EOF
)"
```

---

## Task 10c: 升 `DAL-HDR-NO-HAL` 为 error + 文档回写

**Files:**
- Modify: `wink-micro-os/tools/lint/rules/layering.yaml` — `DAL-HDR-NO-HAL` severity: warning → error；若 10b 未执行则保留 `allow_paths` 加 `until` 与 open issue
- Modify: `docs/decisions/tools/0043-yaml-driven-layer-lint.md` — 状态 Proposed → Accepted；Compliance 打勾
- Modify: `docs/design/02-wink-micro-os/06-bal-layer.md` — CI 门禁改指向 `wink lint`
- Modify: `docs/design/02-wink-micro-os/03-directory-architecture.md` — 分层检查入口指向 `wink lint`
- Modify: `wink-micro-os/tools/README.md` — `wink lint` 用法文档
- Modify: `.claude/rules/c-code.md` — 提示 AI 生成的 C 代码需先自查分层红线
- Modify: `CLAUDE.md` — Critical Patterns 增加「分层门禁：`wink lint`（ADR-0043）」

- [x] **Step 1: 升 severity**
- [x] **Step 2: 全量 `python wink-tools/wink.py test` + unittest**
- [x] **Step 3: 文档回写（ADR / 活规范 / tools README / CLAUDE 与 .claude/rules）**
- [x] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs+lint: harden DAL-HDR-NO-HAL and back-write ADR-0043 targets

EOF
)"
```

---

## 4. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 真树存量违规导致 CI 全红 | Task 6–7 用 warning/allowlist；`NO-MALLOC-HOTPATH` 首发 warning；Task 10c 再收紧 |
| PyYAML 缺失 | Task 2 明确 requirements-lint.txt |
| 与 CMake 双源 | **Task 7.5 parity 双跑门 + Task 8 同 PR 删除** |
| 宏 include / `#if 0` 漏检 | ADR §非目标；`extract_includes` 明示，文档在 explain 输出附注 |
| `wink lint` 误触发 toolchain | Task 5 显式加入 skip 列表 |
| 注释/字符串误报（malloc / _ops） | `strip_comments+strings` 默认开；Task 7 测试覆盖 |
| `until` 到期造成 CI 突然红 | 分级 warning：30 天前 info、7 天前 warning；`--strict` 才计 fail |
| DAL 头泄露修复面大 | Task 10 拆成 10a/10b/10c，10b 可跳过 |
| `--baseline` 稳定性 | Finding 携带 `fingerprint`（sha1 规范化 snippet） |

---

## 5. 非目标（本计划不做）

- clang-tidy / IWYU 真依赖图
- Autofix
- `check_headers_self_contained` / `check_log_format_literals` 全量 YAML 化（可后续 pack）
- `#if 0` 条件块与宏拼接 `#include` 解析
- App 产品面全面禁 PAL 且清掉所有 smoke 例外（可先 allow smoke 路径）

---

## 6. Self-Review（计划作者）

| Spec 项 | 对应 Task |
|---------|-----------|
| YAML 引擎（schema v1，含 workspace overlay） | 1–2 |
| include 词法抽取 + match 语义矩阵 | 3 |
| allow_paths + until 分级 | 4 |
| file:line 报告 + rule_source/fingerprint | 5, 10a |
| `wink lint` CLI（含 --paths/--changed/--today） | 5 |
| layering 规则完整落地 | 6 |
| API 形态（含误报防护） | 7 |
| **Parity 双跑硬凭据** | **7.5** |
| 迁 CMake / run-tests | 8–9 |
| SARIF / explain | 10a |
| DAL 头修复（可选） | 10b |
| 升 error + 文档回写 | 10c |
| ADR + tech-design 一致性 | 已建；Task 0 Accepted；10c 状态更新 |

无 TBD 占位；字段名与 tech-design 对齐。

---

## 7. 执行交接

Plan 已保存至 `docs/implementation-plans/tools/2026-07-20-configurable-layer-lint-plan.md`。

**执行方式二选一：**

1. **Subagent-Driven（推荐）** — 每 Task 新开子代理，Task 间评审  
2. **Inline Execution** — 本会话按 `executing-plans` 连续推进并设检查点  

确认 ADR-0043 采纳后即可开工 Task 1。


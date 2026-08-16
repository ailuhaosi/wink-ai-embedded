# 可配置分层 Lint（`wink lint`）技术设计

| 项 | 内容 |
|----|------|
| 创建日期 | 2026-07-20 |
| 状态 | 稳定草案（ADR-0043 Accepted；schema v1 字段已冻结） |
| 关联 ADR | [ADR-0043](../../decisions/tools/0043-yaml-driven-layer-lint.md)（Accepted） |
| 关联计划 | [2026-07-20-configurable-layer-lint-plan.md](../../implementation-plans/tools/2026-07-20-configurable-layer-lint-plan.md) |

---

## 1. 目标

将 App/BAL/DAL/PAL 分层红线、API 形态约束与带理由的例外，收敛为 **YAML 声明 + 统一 Python 引擎 + `wink lint` CLI**，违规以 **file:line Finding** 输出，供本地与 CI 使用。

---

## 2. 架构

```text
wink lint
   │
   ├─ load configs (ordered merge)
   │     tools/lint/rules/*.yaml
   │     wink-workspace.json → lint overlay（可选）
   │     --config（可重复）
   │
   ├─ discover + classify files → {layer_id, kind}
   │
   ├─ rule packs
   │     include_graph | api_surface | path_name | regex_ban | legacy adapters
   │
   └─ Findings → text | json | sarif → exit 0|1
```

### 2.1 职责边界

| 组件 | 职责 |
|------|------|
| `tools/lint/engine/` | 加载、分类、调度、报告（无业务规则硬编码） |
| `tools/lint/rules/*.yaml` | 规则 SSOT |
| `tools/lint/packs/` | 规则解释器（include / api / path / regex） |
| `wink.py lint` | CLI 入口；**跳过 toolchain gate**（与 doctor/setup 同类诊断命令） |
| CMake | 仅保留链接面 / INTERFACE include 硬约束 |

---

## 3. 配置 Schema（version: 1）

### 3.0 文件头部（每个 rule pack 必备）

```yaml
version: 1
id: layering                     # pack id，与 --pack 名一致
extends: []                      # 可选：其他 pack 的相对/绝对路径，仅覆盖 allow_paths
metadata:
  owner: "wink-arch"
  adr: ["ADR-0043", "ADR-0038"]
```

- `version` 缺失或 !=1 → `LintConfigError`。
- `id` 用于 `--pack` 过滤与 Finding 归属。
- `extends` 仅允许**追加 allow_paths**、**追加 refs/message**；禁止修改 `deny.pattern` / `severity`（除非源规则 `immutable: false`）。

### 3.1 Layer

```yaml
layers:
  bal_public:
    roots: ["bal/include"]
    kind: public_header   # public_header | private_header | source | mixed
```

- 路径相对 SDK root（`wink-micro-os/`），可用 glob。
- 多 layer 命中同一文件：取**最长非通配前缀**（如 `bal/include/math` > `bal/include`）；仍冲突则引擎 error。
- 分类阶段（classify）在 `ignore.scope: [classify]` 命中时**直接跳过**，不进入任何 pack。

### 3.2 include_rules

```yaml
include_rules:
  - id: BAL-HDR-NO-PAL
    in: [bal_public]
    deny:
      - match: basename         # basename | literal | resolved（默认 basename）
        pattern: 'pal_.*\.h'
        except_basename: ['pal_log.h']
        except_literal: []      # 可选：完整 include 字面串白名单
        include_forms: [quote]  # quote | angle | both（默认 both）
    allow_paths:
      - path: "bal/src/input/wink_button_events_irq.c"  # 仅当 in 含该层文件时生效
        reason: "…"
        until: "2026-12-31"     # 可选 ISO date；到期前 30 天 emit info，7 天 emit warning
    message: "…"
    severity: error             # error | warning | info
    immutable: true             # workspace 不可 disable / 降级；仅可追加 allow
    refs: ["ADR-0023"]
```

**匹配语义矩阵：**

| `match` | 匹配对象 | 例子（`#include "pal/pal_log.h"`） |
|---------|----------|-------------------------------------|
| `basename` | 剥离目录后的头文件名 | `pal_log.h` |
| `literal`  | 引号/尖括号中的字面字符串 | `pal/pal_log.h` |
| `resolved` | 尝试相对 SDK root 解析（失败退化 literal） | `pal/include/pal_log.h` 或原字面 |

`include_forms`：
- `quote` 只匹配 `#include "…"`
- `angle` 只匹配 `#include <…>`
- `both` 两者皆扫（默认）

### 3.3 api_rules

```yaml
api_rules:
  - id: NO-OPS-VTABLE
    in: [bal_public, bal_src, dal_public, dal_src]
    deny_regex:
      - pattern: '\b\w+_ops\s*\{'
      - pattern: '\bcontainer_of\s*\('
    context:
      strip_comments: true        # 默认 true：先剥离 //、/* */ 与字符串字面量
      strip_strings: true
      scope_by_kind:
        public_header: declarations_only  # 只扫「疑似声明/宏行」
        private_header: full
        source: full
    except_regex: []               # 命中即豁免
    severity: error
```

- **默认剥离注释与字符串**，避免误报（R5）。
- 多行签名场景：引擎先做**逻辑行合并**（处理续行 `\`、`__attribute__((…))` 前缀、换行后返回类型），再做匹配。
- `except_regex` 与 `allow_paths` 均可作为逃生舱：前者按内容匹配（用于误报），后者按路径匹配（用于历史债）。

### 3.4 path_rules

```yaml
path_rules:
  - id: BAL-NAME-1
    in: [bal_public]
    deny_filename: ["*_helper.h", "*_controller.h"]
    locator: filename        # filename | first_content_hit
    severity: error
```

- `locator: filename` → Finding 无行号，报告器渲染为 `<path>` 而非 `<path>:1`；SARIF 使用 `physicalLocation` 无 `region` 或 `region.startLine=1` 但附 `properties.locator="filename"`。
- `locator: first_content_hit` → 用 `deny_content_regex` 在文件内定位首次出现的行（例如 `BAL-NAME-2 \bsonar\b`）。

### 3.5 ignore

```yaml
ignore:
  - path: "third_party/**"
    scope: [classify, rules]      # 默认 [classify, rules]（等价历史行为）
  - path: "**/golden_expected/**"
  - path: "frameworks/arduino/**"
    scope: [rules]                # 仅免 layering pack，允许 arduino pack 单独接管
```

- `scope: classify`：文件在**分类阶段**即被丢弃，不出现在任何 layer；
- `scope: rules`：文件仍参与分类，但**不执行任何规则**；
- 数组合并按 pack 加载顺序（`extends` 与 workspace overlay 均**只能追加**，不可撤销）。

### 3.6 Workspace overlay 与冲突消解

```yaml
# wink-workspace.json → lint 字段（或 --config workspace-lint.yaml）
version: 1
id: workspace
overrides:
  BAL-HDR-NO-PAL:
    add_allow_paths:
      - path: "vendor_sdk/**"
        reason: "third-party"
        until: "2027-01-01"
    # 禁：修改 pattern / severity 降级（除非 SDK 规则 immutable=false）
disable_rules: []                  # 仅对非 immutable 规则生效；命中 immutable → error
```

**合并顺序（后覆盖前，但受 immutable 保护）：**
1. `tools/lint/rules/*.yaml`（SDK SSOT）
2. `wink-workspace.json` overlay
3. `--config` CLI 参数（可重复）

**冲突消解规则：**
- `deny` 具吸收性：任意一处 `deny` 命中 → 违规
- `allow_paths` / `except_*` 求**并集**
- `severity` 只能**上调**（除非 `immutable: false`）
- 每条 Finding 附加 `rule_source: sdk|workspace|cli`

---

## 4. Finding 模型

```python
@dataclass(frozen=True)
class Finding:
    rule_id: str
    severity: str          # error|warning|info
    path: str              # repo-relative preferred
    line: int | None       # 1-based; None 表示 path-only（locator=filename）
    column: int | None
    message: str
    snippet: str | None
    help: str | None
    refs: tuple[str, ...]
    allowlisted: bool = False
    rule_source: str = "sdk"   # sdk | workspace | cli
    fingerprint: str = ""      # sha1(rule_id|path|line|snippet_norm)，供 baseline diff 稳定
```

- `fingerprint` 计算：对 `snippet` 先规范化空白与制表符再 sha1，避免琐碎编辑打乱 baseline。
- `path` 一律 POSIX 分隔符（`/`），跨平台 diff 稳定。

Text 示例（含行号）：

```text
error[DAL-HDR-NO-HAL]: DAL public headers must not leak HAL
  --> dal/include/actuator/dal_motor.h:7:1
   |
 7 | #include "pal_hal.h"
   | ^^^^^^^^^^^^^^^^^^^^
   = help: keep HAL includes in .c only
   = source: sdk (immutable)
```

Text 示例（path-only，`locator=filename`）：

```text
error[BAL-NAME-1]: forbidden helper/controller header name
  --> bal/include/motion/motion_controller.h
   = help: BAL public headers must not use *_helper.h / *_controller.h suffix
```

Exit：存在未豁免的 `error` → 1；`--strict` 时 `warning` 也计 fail。`until` 到期前 30 天 emit `info`，7 天内 emit `warning`（不计 fail，除非 `--strict`）。

---

## 5. CLI

```text
wink lint
  --root PATH
  --config PATH            # repeatable
  --pack NAME              # layering | api | arduino | …
  --rule ID
  --paths PATH...          # 仅扫指定路径（可与 --changed 互斥）
  --changed [REV]          # 从 git diff --name-only [REV] 派生 --paths（默认 HEAD）
  --format text|json|sarif
  --output FILE            # 与 --format 配套；默认 stdout
  --strict
  --explain ID
  --report-allowlist       # 汇总有效 allow_paths（含即将过期）
  --baseline FILE          # optional migration；按 fingerprint 差量比对
  --today YYYY-MM-DD       # override 当前日期（用于测试 until 到期语义）；亦读 $WINK_LINT_TODAY
```

`lint` **不**跑 `ensure_for` toolchain gate。

### 5.1 include 词法抽取规则（v1）

`extract_includes(text) -> list[(line, header, form)]`，`form ∈ {quote, angle}`。抽取顺序：

1. 剥离 UTF-8 BOM，逻辑行索引以原文行号为准；
2. 状态机式剥离 `//` 行注释与 `/* … */` 块注释（**跨行**），同时保留字符串字面量原文（避免注释吞掉 `"…//…"`）；
3. 合并续行反斜杠 `\\\n` → 单逻辑行；
4. 匹配 `^\s*#\s*include\s+(?:<([^>]+)>|"([^"]+)")`（允许 `#` 与 `include` 之间空白）；
5. **不处理**：`#if 0 … #endif` 条件块、宏拼接 include（v1 非目标，报告 header 会打印 "note: lint does not evaluate preprocessor conditions"）。

### 5.2 api_rules 上下文剥离

`api_surface` pack 在应用 `deny_regex` 前：
1. 复用 §5.1 的注释与字符串剥离；
2. 对 `public_header`（`scope_by_kind=declarations_only`）：只保留形如 `^(\s*(?:__\w+\(.*?\)\s*)*)\s*[A-Za-z_][\w\s*]*\s+\w+\s*\(` 的逻辑行；
3. 逻辑行合并跨行签名（返回类型独占一行、`__attribute__` 前缀等）。

### 5.3 性能预算与增量

| 场景 | 目标 |
|------|------|
| Cold full scan（约 1k C/H） | ≤ 3s（Windows / 机械盘） |
| Warm cache | ≤ 1s |
| `--changed` / `--paths` | ≤ 500ms |

策略：
- `path_rules` 不读文件内容；
- `include_rules` / `api_rules` 按需 `read_text(errors='replace')`，并按 pack 共享文件缓存；
- `--changed` 走 `git diff --name-only`，自动 union 到 `--paths`。

---

## 6. Pack 清单（分期）

| Pack | 内容 | 里程碑 |
|------|------|--------|
| `layering` | BAL/DAL/App include 矩阵 + HAL 白名单 | M1–M2 |
| `api` | NO-OPS、NO-MALLOC、bool 公开 API warning | M2 |
| `arduino` | 适配现有 isolation/symbols | M3 |
| `headers` / `log_fmt` | 适配现有 self-contained / log literal | M3 |

---

## 7. 非目标（v1）

- Autofix
- 宏拼接 `#include` 解析
- clang / IWYU 真依赖图（预留 pack 扩展点）

---

## 8. 测试策略

- 引擎单测：`tools/tests/test_lint_*.py`，用临时目录 fixture 构造违规/合规树。
- 黄金用例：`tools/lint/testdata/` 最小正/反例。
- 回归：`wink lint` 对真实 `bal/include` 在迁出 CMake 门禁后行为等价。

### 8.1 Parity 双跑门（CMake 迁出前置）

删除 `bal/CMakeLists.txt` 中重复门禁前，**必须**通过以下双跑证据：

1. `tools/lint/testdata/parity_probe/`：为每条待迁移规则同时提供
   - **违规样本**（`bad/` 树）：`pal_hal.h` in `bal_public`、`sonar` 关键字、`*_helper.h`、`bal/include/math/` 中 `dal_` / `pal_` / runtime 符号泄露、DAL public 直含 `pal_hal.h`；
   - **合法边缘**（`good/` 树）：`pal_log.h`、`bal/src/input/*_irq.c` 读 GPIO、`bal/include/math/*.h` 纯数学、DAL private 头引 HAL。
2. `tools/tests/test_lint_parity.py`：
   - 对 `bad/` 断言 `wink lint --pack layering` 与"模拟 CMake 检查器（复用 CMake 中的 REGEX 常量，Python 端重放）"**fail 集合完全一致**；
   - 对 `good/` 断言两者**pass 集合完全一致**。
3. 通过后，Task 8 才允许删除 CMake 门禁；同 PR 内两个变更**同时提交**，避免"半迁出"窗口。

### 8.2 `--explain` 输出模板

```text
Rule: DAL-HDR-NO-HAL       [severity: error | source: sdk | immutable: true]
Message: DAL public headers must not leak HAL

Rationale:
  ADR-0004 静态分发；HAL 类型不应出现在 DAL 公共 API 上
  ADR-0023 BAL 语义抽象；HAL 属于底层实现细节

References: ADR-0004, ADR-0023, 06-bal-layer.md#dal

Examples:
  BAD:  dal/include/actuator/dal_motor.h  #include "pal_hal.h"
  GOOD: 在 dal_motor.h 用前向声明或 wink_types.h 中的 typedef

Allowlist policy:
  必须包含 reason；建议 until ≤ 90 天；到期前 30 天自动 emit info。

Active allowlist:
  - dal/include/actuator/dal_motor.h    until 2026-09-30 (60 days left)
  - dal/include/actuator/dal_encoder.h  until 2026-09-30 (60 days left)
```

---

## 9. 合规回写（Accepted 后必做）

- `docs/design/02-wink-micro-os/06-bal-layer.md` — CI 门禁改指向 `wink lint`
- `docs/design/02-wink-micro-os/03-directory-architecture.md` — 分层检查入口
- `wink-tools/README.md` — `wink lint` 用法与 pack 清单
- `.claude/rules/c-code.md` — 提示 AI 生成的 C 代码需先自查分层红线
- `CLAUDE.md` — Critical Patterns 补一条「分层门禁：`wink lint`（ADR-0043）」


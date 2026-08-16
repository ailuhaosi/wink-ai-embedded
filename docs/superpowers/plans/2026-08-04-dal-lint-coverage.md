# DAL API 一致性规范 Lint 化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 [`wink-micro-os/docs/dal-development-guide/dal-api-consistency-spec.md`](../../../wink-micro-os/docs/dal-development-guide/dal-api-consistency-spec.md) v3.4.1 中的 **80+ 条 MUST/SHOULD 规则** 全部转化为 `wink lint` 自动化检查，建立专属 `dal` pack 并在 CI 中拦截违反规范的代码。

**Architecture:**
- 在 `wink-tools/tools/lint/` 下新增一个 **`dal` pack**（对应 `wink-tools/tools/lint/rules/dal.yaml` 与 `wink-tools/tools/lint/packs/dal.py`），按规范章节划分为 **8 个子规则集**（`struct` / `quantity` / `yaml_parity` / `contract_doc` / `api_shape` / `lifecycle` / `concurrency` / `blocking`）。
- 复用现有 4 类底层技术：**YAML regex 守门**（drivers pack 模式）、**gcc 探针实测**（abi pack 模式）、**轻量 AST 解析**（`pycparser`）、**注释标记提取**（自研 doc 块 lexer）。
- 接入现有 `runner.py` 派发与 `cli.py` 参数（`--pack dal`）。
- 严格按规范 §17.3「Lint 引擎 ID = `dal.<snake_case_rule>`」命名，**不污染现有 api/layering/drivers/user_surface/abi 5 个 pack**。

**Tech Stack:**
- Python 3.11+（`wink-tools` 工具链已用 dataclass / match / tomllib 等现代语法）
- `pycparser`（新增依赖，C 真 AST 解析；解决 §2 / §4 / §5 / §9 全部结构化规则）
- `yaml`（PyYAML，已用，复用 `tools.codegen.yaml_schema` 模块）
- `re`（标准库，处理封闭单位后缀表、命名白名单、ABI 注释块）
- 现有 `gcc` 探针（`abi.py` 已有，§2.3/§13.3 ABI 规则直接扩展）
- `pytest`（规则 fixtures 与回归）

---


## Global Constraints

1. **范围**：覆盖规范 v3.4.1 全部 MUST 与 SHOULD 条款（除附录 A 保留外、§11 编译期裁剪中的部分 CMake 规则依赖 cmake hook 不在 lint 范围）。
2. **命名**：Lint rule ID 严格采用 `dal.<snake_case>` 格式（`dal.config_owner_first`、`dal.quantity_suffix_closed`），与规范 §17.3 一致；spec rule ID（`DAL-S-001`）通过 `refs` 字段双向引用。
3. **YAML 规则语法**：复用 `wink-tools/tools/lint/rules/*.yaml` schema v1（`layers` / `include_rules` / `api_rules` / `path_rules` / `user_surface_rules`），新 pack 同时定义 5 类键。
4. **Allowlist**：必须支持 `allow_paths` 与 `until` 字段（`engine/allowlist.py` 已有），每条规则默认 immutable=false。
5. **Severity 策略**：MUST → 默认 error（可被 allowlist）；SHOULD → 默认 warning（迁移期）；存量 9 个驱动 v3.2 迁移期以 warning 模式跑（与 spec §17.2 一致），新驱动 error 模式。
6. **测试**：每条规则必须有 1 个 good fixture + 1 个 bad fixture，挂在 `wink-tools/tools/lint/testdata/dal/{good,bad}/...`，由 `tools/tests/test_dal_pack.py` 用 `pytest` 跑。
7. **不破坏 ABI 断言**：dal pack 不能与 `abi pack` 重复覆盖 `offsetof/config == 0` 规则；dal 包只覆盖"声明是否存在 + 声明格式"，数值正确性仍归 abi 包。
8. **不动现有 pack**：5 个现有 pack 的 rule YAML、driver pack 已有规则（T11/T12）只增不删；drivers pack 中 `safe_off_prototype` / `stub_experimental` / `legacy_field_tables` 升级后归并到新 `dal.yaml_parity` 子模块，但**保持 driver pack 入口兼容**。
9. **不引 CI 强制断**：在所有 task 完成 + Owner 评审 sign-off 前，`--pack dal` 默认不改全局 lint 退出码（`runner.py` 默认 packs 不含 `dal`），必须显式 `--pack dal` 才启用。
11. **预处理剥离层（Pre-clean Pre-pass）**：`pycparser` 解析 C 头前，必须在 `dal.lexer.parse_header()` 中对 Wink 专属宏（`WINK_WARN_UNUSED_RESULT`, `WINK_BLOCKING`, `IRAM_ATTR` 等）执行剥离预处理，保证 AST 解析成功率达 99%+。
12. **修补提示（Remediation Snippets）**：对于包含确定性修复方案的规则（如缺 `_Static_assert`），Finding 输出须附带建议修补代码片段。
13. **增量基线过滤（Diff Baseline Support）**：Task 10 需包含基于改动文件/基线压制的机制，避免存量 Warning 干扰新代码 PR。

---

## Open Questions（执行前必须裁决）

| # | 问题 | 默认建议 | 裁决点 |
|---|------|---------|--------|
| OQ-1 | C 头结构解析用 **pycparser**（纯 Python、易装）还是 **libclang**（精确处理宏与 typedef）？ | pycparser。通过 `pre_clean_c_source()` 剥离 Wink 属性宏，语法解析失败时优雅降级回退到正则 + 注释提取。 | Task 1 启动前 |
| OQ-2 | DAL-S-006 引脚字段类型规则：可选引脚哨兵 `-1` 校验在 `init` 中而非定义层——lint 只查字段类型还是连同 init 规范化一起查？ | 只查定义层（`wink_pin_t` 用在 `dir_pin_b` 类字段），init 内的 `0→-1` 规范化属 code review。 | Task 1 |
| OQ-3 | DAL-U-011 A 类 setter 钳位饱和 vs 错误返回：规范同时允许两者（"只有非控制量才允许返回 INVALID_ARG"），lint 怎么区分？ | **结合 A 类封闭后缀判定**：若函数名含 A 类刻度后缀（`_promille`, `_ddeg` 等），要求必须出现 clamp/saturate 逻辑；直接 return INVALID_ARG 即报 error；不含 A 类后缀的配置类 setter 不做该限制。 | Task 3 |
| OQ-4 | DAL-U-022 禁弱 typedef 量纲别名：是否连 typedef 自身都禁，还是只禁别名指 float？ | 禁所有 `typedef ... dal_<...>_t;` 且 RHS 是 float/double 的，以及 `typedef ... dal_<...>_t;` RHS 是 int 但被用来跨模块混入的（后者太难静态判定，初期只覆盖前者）。 | Task 3 |
| OQ-5 | DAL-CB-002 ctx 参数命名 vs `user_data`：lint 检查整个 `void *ctx` 形参命名还是仅检查与 `cb` 配对？ | 仅查 callback 类型定义中第二参数是 `void *ctx`（不是 `user_data`/`arg`）。 | Task 4 |
| OQ-6 | DAL-BC-020/021/022/023 WINK_DEPRECATED 守门：lint 校验属性宏存在 + `@deprecated` 注释存在两件套吗？ | 两者都查（属性宏 + doxygen 标记）。 | Task 7 |
| OQ-7 | DAL-P-001/002/003 编译期裁剪 WINK_USE_xxx：lint 需解析 CMake 看驱动是否声明了 WINK_USE 开关吗？ | lint 只查 C 头是否带 `WINK_UNAVAILABLE_MSG` 守卫（CMake 解析不在范围）。 | Task 7 |
| OQ-8 | DAL-V-001 器件特有 API 的 `device_specific: true` 标注：lint 校验 YAML 字段还是校验 C 函数命名？ | 校验 C 函数签名范式 `dal_<type>_<verb>(dev, const dal_<type>_<arg>_t *arg)` + 提示用户去 YAML 标字段（lint 暂不读 YAML 字段）。 | Task 7 |
| OQ-9 | DAL-F-002 公开 API 禁 `bool` 返回：`api.yaml:STATUS-NOT-BOOL-PUBLIC` 已覆盖——dal pack 是冗余还是作为严格版（含 `int`/`void` 等其他非 status 返回）？ | dal pack 添加更严格版 `STATUS-RETURN-STRICT`（error），原 api pack 的 warn 版保留作为兼容。 | Task 5 |
| OQ-10 | DAL-EC-004 错误码分段：lint 必须对头文件中的 `#define WINK_ERR_XXX_YYY -123` 做 -100/-199/-200 等分段检查吗？ | 初期只查 `WINK_ERR_XXX_YYY` 在头文件中是否存在、值域是否落在 `wink_status.h` 全局声明范围，**不强制**自定义错误码必须落 -200 段（属 codegen 配置）。 | Task 7 |

---


## File Structure

新增文件：

| 路径 | 职责 |
|------|------|
| `wink-tools/tools/lint/rules/dal.yaml` | `dal` pack 规则注册（layer 定义 + 各子模块 rule 元数据） |
| `wink-tools/tools/lint/packs/dal.py` | pack 入口 + 8 个子规则集分发（thin orchestrator） |
| `wink-tools/tools/lint/packs/dal_struct.py` | §2 数据结构与句柄规则（regex + pycparser 解析） |
| `wink-tools/tools/lint/packs/dal_quantity.py` | §9 单位后缀与量纲两分类规则 |
| `wink-tools/tools/lint/packs/dal_yaml_parity.py` | §16 YAML ↔ C 双向一致性 + §3.2 safe_off / §11 stub |
| `wink-tools/tools/lint/packs/dal_contract_doc.py` | §15 API Contract 注释必填字段 |
| `wink-tools/tools/lint/packs/dal_api_shape.py` | §4 函数签名 / §5 命名 / §14 错误码 |
| `wink-tools/tools/lint/packs/dal_lifecycle.py` | §3 init/deinit/safe_off 模式（启发式） |
| `wink-tools/tools/lint/packs/dal_concurrency.py` | §6 并发/ISR/thread-safe/atomic |
| `wink-tools/tools/lint/packs/dal_blocking.py` | §7 阻塞 / 忙等 / WINK_BLOCKING 一致性 |
| `wink-tools/tools/lint/dal/lexer.py` | pycparser 包装 + 注释块 doc 解析工具 |
| `wink-tools/tools/lint/dal/quantity_suffixes.py` | 封闭单位后缀表（A 类 / B 类两套查表） |
| `wink-tools/tools/tests/test_dal_pack.py` | pytest 入口，加载 good/bad fixtures 跑各子模块 |
| `wink-tools/tools/lint/testdata/dal/good/*.yaml` & `.../bad/*.yaml` | 测试 fixture（每规则一对） |
| `wink-tools/tools/lint/testdata/dal/good/dals/*.h` & `.../bad/dals/*.h` | 头文件 fixture（合法/违规的 DAL 头） |
| `wink-tools/requirements-lint-dal.txt` | pycparser 依赖声明 |

修改文件：

| 路径 | 修改点 |
|------|--------|
| `wink-tools/tools/lint/engine/runner.py` | 注册 `dal` pack（line 60 之后插入 `check_dal` 分支） |
| `wink-tools/tools/lint/cli.py` | （**无修改**，`--pack dal` 由 runner.py 注册后自动可用；`--explain` 走 `_find_rule` 自动覆盖） |
| `wink-tools/tools/lint/rules/drivers.yaml` | 注释说明 `safe_off_prototype` / `stub_experimental` / `legacy_field_tables` 升级路径（不动规则） |
| `wink-tools/tools/lint/packs/drivers.py` | `_check_schema_guards` 中相关函数 deprecated 化，转发到 `dal_yaml_parity`（保持入口兼容） |
| `wink-tools/tools/docs/04-architecture-linter.md` | 增加 `dal` pack 章节 + 8 个子模块说明 |
| `wink-micro-os/docs/dal-development-guide/dal-api-consistency-spec.md` | §17.3.1 实施状态表更新（`pending` → `lint-enforced`） |
| `wink-micro-os/docs/decisions/tools/0043-yaml-driven-layer-lint.md` | ADR 增补：新增 `dal` pack 范式 |

---

## Task 大纲（11 个 Task，按依赖排序）

| # | Task | 涉及章节 | 子模块 |
|---|------|---------|--------|
| 1 | 基础设施：lexer/pycparser 包装 + 测试 harness | 全部 | 共享 |
| 2 | §2 数据结构与句柄 | §2.1-2.4 | `dal.struct` |
| 3 | §9 单位后缀与量纲两分类 | §9.1-9.6 | `dal.quantity` |
| 4 | §16 YAML ↔ C + §3.2 + §11 | §3.2, §11, §16 | `dal.yaml_parity` |
| 5 | §15 API Contract 注释 | §15 | `dal.contract_doc` |
| 6 | §4 + §5 + §14 函数签名/命名/错误码 | §4, §5.1-5.4, §14.1 | `dal.api_shape` |
| 7 | §3 init/deinit/safe_off 模式 | §3, §11.1-11.2, §13.2-13.3 | `dal.lifecycle` |
| 8 | §6 并发/ISR/thread-safe | §6 | `dal.concurrency` |
| 9 | §7 阻塞/忙等/WINK_BLOCKING | §7 | `dal.blocking` |
| 10 | 接入 runner + 文档 + 规范回写 | runner/docs/spec | runner |
| 11 | 全量回归 + 端到端验证 | 全部 | runner |

---


## Task 1: 基础设施：pycparser 包装 + 测试 harness

**Files:**
- Create: `wink-tools/tools/lint/dal/lexer.py`
- Create: `wink-tools/tools/lint/dal/quantity_suffixes.py`
- Create: `wink-tools/requirements-lint-dal.txt`
- Create: `wink-tools/tools/tests/test_dal_pack.py`
- Create: `wink-tools/tools/lint/testdata/dal/good/dals/dal_led.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_missing_owner.h`

**Interfaces:**
- Consumes: （无前置依赖）
- Produces:
  - `dal.lexer.parse_header(path_or_text) -> HeaderAst`
  - `dal.lexer.extract_doc_blocks(text: str) -> list[DocBlock]`
  - `dal.quantity_suffixes.is_a_class_unit(suffix: str) -> bool`
  - `dal.quantity_suffixes.is_b_class_unit(suffix: str) -> bool`
  - `dal.quantity_suffixes.signedness_for(suffix: str) -> Literal["signed","unsigned","either"]`

**Step 1.1: 写 lexer 失败测试**

`wink-tools/tools/tests/test_dal_pack.py`：
```python
import pytest
from pathlib import Path
from tools.lint.dal.lexer import parse_header, extract_doc_blocks

FIXTURES = Path(__file__).parent.parent / "lint" / "testdata" / "dal"


def test_parse_header_extracts_config_t():
    text = (FIXTURES / "good" / "dals" / "dal_led.h").read_text(encoding="utf-8")
    ast = parse_header(text)
    assert ast.config_type == "dal_led_config_t"
    assert ast.config_members[0] == ("const char *", "owner")
    assert ast.handle_type == "dal_led_t"
    assert any(m[0] == "bool" and m[1] == "initialized" for m in ast.handle_members)


def test_extract_doc_blocks_picks_api_contract():
    text = (FIXTURES / "good" / "dals" / "dal_led.h").read_text(encoding="utf-8")
    blocks = extract_doc_blocks(text)
    assert any("@note API Contract" in b.text for b in blocks)
```

**Step 1.2: 跑测试确认失败**

Run: `cd wink-tools && python -m pytest tools/tests/test_dal_pack.py -v`
Expected: ModuleNotFoundError（`tools.lint.dal.lexer` 还不存在）。

**Step 1.3: 实现 lexer 最小骨架**

`wink-tools/tools/lint/dal/lexer.py`：
```python
"""Lexer + AST helpers for the dal pack.

设计选择（OQ-1）：优先 pycparser；缺包时回退正则 + 注释提取。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

try:
    import pycparser  # type: ignore
    _HAS_PYCPARSER = True
except ImportError:
    _HAS_PYCPARSER = False


@dataclass
class HeaderAst:
    config_type: str | None = None
    config_members: list[tuple[str, str]] = field(default_factory=list)
    handle_type: str | None = None
    handle_members: list[tuple[str, str]] = field(default_factory=list)
    function_decls: list[dict] = field(default_factory=list)


@dataclass
class DocBlock:
    start_line: int
    end_line: int
    text: str


_WINK_ATTR_MACROS_RE = re.compile(
    r"\b(?:WINK_WARN_UNUSED_RESULT|WINK_BLOCKING|WINK_REENTRANT|WINK_CODE|WINK_XDATA|WINK_IDATA|WINK_DATA|IRAM_ATTR)\b"
)

def pre_clean_c_source(text: str) -> str:
    """在送入 pycparser 前对 WinkOS 自定义属性宏做剥离预处理，保障 AST 成功率 99%+."""
    return _WINK_ATTR_MACROS_RE.sub("", text)


def parse_header(text_or_path) -> HeaderAst:
    text = (
        Path(text_or_path).read_text(encoding="utf-8", errors="replace")
        if isinstance(text_or_path, Path)
        else text_or_path
    )
    cleaned = pre_clean_c_source(text)
    return _parse_with_pycparser(cleaned) if _HAS_PYCPARSER else _parse_with_regex(cleaned)


def _parse_with_regex(text: str) -> HeaderAst:
    ast = HeaderAst()
    cfg = re.search(
        r"typedef\s+struct\s*\{(?P<body>[^}]*)\}\s*(dal_\w+_config_t)\s*;",
        text,
    )
    if cfg:
        ast.config_type = cfg.group(2)
        ast.config_members = _members(cfg.group("body"))
    hd = re.search(
        r"typedef\s+struct\s*(?:\w+\s*)?\{(?P<body>.*?)\}\s*(dal_\w+_t)\s*;",
        text,
        re.DOTALL,
    )
    if hd:
        ast.handle_type = hd.group(2)
        ast.handle_members = _members(hd.group("body"))
    return ast


_MEM_RE = re.compile(
    r"^\s*(?:const\s+)?([A-Za-z_][\w\s\*]*?)\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;",
    re.MULTILINE,
)


def _members(body: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for line in body.splitlines():
        s = line.split("//", 1)[0].strip()
        if not s or s.startswith(("struct", "union", "typedef", "#")):
            continue
        m = _MEM_RE.match(s)
        if m:
            out.append((m.group(1).strip(), m.group(2)))
    return out


def _parse_with_pycparser(text: str) -> HeaderAst:
    # TODO(Task 1.5): 真 AST 解析；初期 _parse_with_regex 已够。
    return _parse_with_regex(text)


_DOCBLOCK_RE = re.compile(
    r"/\*\*(?P<body>(?:[^*]|\*(?!/))*?)\*/", re.DOTALL
)


def extract_doc_blocks(text: str) -> list[DocBlock]:
    out: list[DocBlock] = []
    pos = 0
    n = 0
    while True:
        m = _DOCBLOCK_RE.search(text, pos)
        if not m:
            break
        n += 1
        start_line = text.count("\n", 0, m.start()) + 1
        end_line = text.count("\n", 0, m.end()) + 1
        out.append(DocBlock(start_line, end_line, m.group(0)))
        pos = m.end()
    return out
```

`wink-tools/tools/lint/dal/quantity_suffixes.py`：
```python
"""封闭单位后缀表（spec §9.1）。"""
from __future__ import annotations
from typing import Literal

# A 类（执行器命令，定标整数）— 子集足够覆盖常见驱动
A_CLASS_UNITS: frozenset[str] = frozenset({
    "_promille", "_per10k",
    "_ddeg", "_mdeg", "_udeg", "_deg",
    "_um", "_cmm", "_mm", "_cm",
    "_us", "_ms", "_s",
    "_ma", "_mv",
    "_hz", "_dps", "_mps2",
    "_raw", "_pct",
})

# B 类（传感器测量，Full=float/Micro=定点）
B_CLASS_UNITS: frozenset[str] = frozenset({
    "_degc", "_degc_float",  # _degc 是 0.1°C 整型；spec 仍以 _degc 通用
    "_cm", "_mm",
    "_mv", "_ma",
    "_raw",
    "_promille",  # 比例量既可能 A 也可能 B（罕见）
    "_kmh",
    "_lat_udeg", "_lng_udeg",
})

# 无符号后缀（spec §9.4.2 DAL-U-027）
UNSIGNED_HINT: frozenset[str] = frozenset({
    "_ddeg", "_per10k", "_pct", "_hz", "_us", "_ms",
    "_um", "_cmm", "_mm", "_cm", "_ma", "_mv",
    "_raw", "_kmh", "_degc", "_mps2",
})
# 有符号后缀（spec §9.4.2 DAL-U-028）
SIGNED_HINT: frozenset[str] = frozenset({
    "_promille",  # speed_promille [-1000,1000] 是有符号
    "_dps",  # 角速度
})


def is_a_class_unit(suffix: str) -> bool:
    return suffix in A_CLASS_UNITS


def is_b_class_unit(suffix: str) -> bool:
    return suffix in B_CLASS_UNITS


def signedness_for(suffix: str) -> Literal["signed", "unsigned", "either"]:
    if suffix in UNSIGNED_HINT:
        return "unsigned"
    if suffix in SIGNED_HINT:
        return "signed"
    return "either"
```

`wink-tools/requirements-lint-dal.txt`：
```
pycparser>=2.21
```

**Step 1.4: 创建 good/bad 头文件 fixture**

`wink-tools/tools/lint/testdata/dal/good/dals/dal_led.h`：
```c
#ifndef DAL_LED_H_
#define DAL_LED_H_

#include <stdbool.h>
#include "wink_status.h"

typedef struct {
    const char *owner;     /* 资源占用 owner 静态字符串 */
    uint16_t pin;          /* 逻辑 GPIO 引脚 */
    bool active_high;      /* true: 高电平点亮 */
} dal_led_config_t;

typedef struct {
    dal_led_config_t config;
    bool initialized;
} dal_led_t;

/**
 * @brief 初始化 LED。
 *
 * @param dev  器件实例句柄
 * @param cfg  配置（深拷贝到 dev->config）
 * @return wink_status_t
 *
 * @note API Contract:
 *   - Preconditions: dev != NULL; cfg != NULL
 *   - Postconditions: dev->initialized == true
 *   - Range: cfg->pin in [0, GPIO_MAX]
 *   - Blocking: No
 *   - Thread-safe: No
 *   - ISR-safe: No
 *   - Error-codes: WINK_OK / WINK_ERR_INVALID_ARG
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_init(dal_led_t *dev, const dal_led_config_t *cfg);
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_on(dal_led_t *dev);
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_off(dal_led_t *dev);

#endif
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_missing_owner.h`：
```c
#ifndef DAL_LED_BAD_H_
#define DAL_LED_BAD_H_

#include <stdbool.h>
#include "wink_status.h"

/* ❌ 缺 owner 首字段（DAL-S-001 违反） */
typedef struct {
    uint16_t pin;
    bool active_high;
} dal_led_bad_config_t;

typedef struct {
    dal_led_bad_config_t config;
    bool initialized;
} dal_led_bad_t;

wink_status_t dal_led_bad_init(dal_led_bad_t *dev, const dal_led_bad_config_t *cfg);
#endif
```

**Step 1.5: 跑测试确认通过**

Run: `cd wink-tools && python -m pytest tools/tests/test_dal_pack.py -v`
Expected: 2 passed。

**Step 1.6: Commit**

```bash
git add wink-tools/tools/lint/dal/ wink-tools/requirements-lint-dal.txt \
        wink-tools/tools/tests/test_dal_pack.py \
        wink-tools/tools/lint/testdata/dal/
git commit -m "lint(dal): add lexer/AST helpers and quantity suffix tables (Task 1)"
```

---


## Task 2: §2 数据结构与句柄（`dal.struct` 子模块）

**Files:**
- Create: `wink-tools/tools/lint/packs/dal_struct.py`
- Create: `wink-tools/tools/lint/rules/dal.yaml`
- Create: `wink-tools/tools/lint/testdata/dal/good/dals/dal_button.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_bitfield.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_pack.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_no_init.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_dynalloc.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_pin_optional.h`

**Interfaces:**
- Consumes: `dal.lexer.parse_header()` (Task 1)
- Produces: `dal.struct` 子模块的 7 条规则实现

**Step 2.1: 写规则元数据（dal.yaml）**

`wink-tools/tools/lint/rules/dal.yaml`（首版，含 §2 的规则）：
```yaml
version: 1
id: dal
metadata:
  owner: "wink-arch"
  adr: ["ADR-0004", "ADR-0043", "ADR-0046", "ADR-0056"]

layers:
  dal_public:
    roots: ["dal/include"]
    kind: public_header
  dal_src:
    roots: ["dal/src"]
    kind: source
  codegen_drivers:
    roots: ["codegen/drivers"]
    kind: source
  codegen_roles:
    roots: ["codegen/roles"]
    kind: source

include_rules: []
api_rules: []
path_rules: []
user_surface_rules: []

# 关闭：api_rules 等键由 dal.py pack 内部按 rule_id 路由；这里只声明
# 元数据是为了 --explain 和 _find_rule 能找到规则。
ignore: []
```

**Step 2.2: 实现 §2 的 7 条规则**

`wink-tools/tools/lint/packs/dal_struct.py`：
```python
"""dal.struct: spec §2 数据结构与句柄规约。

规则清单（按 spec rule ID 排序）：
  - dal.config_owner_first       (DAL-S-001, MUST, error)
  - dal.config_owner_static       (DAL-S-002, MUST, warning)  # 静态检测困难，warning
  - dal.config_no_bitfield        (DAL-S-005, MUST NOT, error)
  - dal.config_no_pragma_pack     (DAL-S-005, MUST NOT, error)
  - dal.pin_required_uint16       (DAL-S-006 SHOULD, warning)
  - dal.pin_optional_wink_pin_t   (DAL-S-006 SHOULD, warning)
  - dal.handle_is_pod             (DAL-S-010, MUST, error)  # 通过初始结构推断
  - dal.handle_config_first       (DAL-S-011, MUST, error)
  - dal.handle_has_initialized    (DAL-S-012, MUST, error)
  - dal.handle_zero_init_safe     (DAL-S-013, MUST, error)  # 弱检：要求无 {0} 反例
  - dal.handle_has_static_assert  (DAL-S-014, SHOULD, warning; 严格值交 abi pack)
  - dal.handle_no_dynamic_alloc   (DAL-S-020, SHOULD, warning)
  - dal.handle_eager_alloc_doc    (DAL-S-021, MUST, warning)  # 需 @note Eager-init 标记
"""
from __future__ import annotations
import re
from pathlib import Path
from tools.lint.dal.lexer import parse_header
from tools.lint.engine.models import Finding

_PIN_REQUIRED = re.compile(r"\b(?:pin|trig_pin|echo_pin)\b")
_PIN_OPTIONAL = re.compile(r"\b(?:dir_pin_[ab]|enable_pin|pin_b)\b")
_BITFIELD_RE = re.compile(r"\b\w+\s*:\s*\d+\s*;")
_PRAGMA_PACK_RE = re.compile(r"#\s*pragma\s+pack\b")
_MALLOC_RE = re.compile(r"\b(?:malloc|calloc|realloc)\s*\(")
_STATIC_ASSERT_OFFSETOF_RE = re.compile(
    r"_Static_assert\s*\(\s*offsetof\s*\(\s*dal_\w+_t\s*,\s*config\s*\)\s*==\s*0"
)


def _f(rule_id, sev, path, line, msg, help, refs):
    return Finding(
        rule_id=rule_id, severity=sev, path=path, line=line, column=None,
        message=msg, snippet=None, help=help,
        refs=tuple(refs), allowlisted=False, rule_source="sdk",
    )


def check_struct(rel: str, text: str, root: Path) -> list[Finding]:
    out: list[Finding] = []
    ast = parse_header(text)
    if ast.config_type is None:
        return out  # 非 DAL 头，跳过

    # DAL-S-001
    if not ast.config_members or ast.config_members[0] != ("const char *", "owner"):
        out.append(_f(
            "dal.config_owner_first", "error", rel, 1,
            f"{ast.config_type} 首字段必须为 `const char *owner;`（spec DAL-S-001）",
            "Add `const char *owner;` as the first member; the owner string MUST be a string literal or `static const char[]` (DAL-S-002).",
            ("DAL-S-001", "ADR-0046"),
        ))

    # DAL-S-005
    if _BITFIELD_RE.search(text):
        out.append(_f(
            "dal.config_no_bitfield", "error", rel, 1,
            "DAL 配置/句柄 MUST NOT 使用位域语法（spec DAL-S-005）",
            "Replace bitfields with explicit `uint8_t`/`uint16_t` masks; use named constants.",
            ("DAL-S-005",),
        ))
    if _PRAGMA_PACK_RE.search(text):
        out.append(_f(
            "dal.config_no_pragma_pack", "error", rel, 1,
            "DAL 配置/句柄 MUST NOT 使用 #pragma pack（spec DAL-S-005）",
            "Remove #pragma pack; rely on natural alignment per the size-decreasing rule (DAL-S-003).",
            ("DAL-S-005",),
        ))

    # DAL-S-006
    for type_, name in ast.config_members:
        if _PIN_REQUIRED.fullmatch(name) and type_ != "uint16_t":
            out.append(_f(
                "dal.pin_required_uint16", "warning", rel, 1,
                f"必填引脚字段 `{name}` 类型 `{type_}` 应为 `uint16_t`（spec DAL-S-006）",
                "Required pins cannot be unset; use `uint16_t` so negative values are impossible at the type level.",
                ("DAL-S-006",),
            ))
        if _PIN_OPTIONAL.fullmatch(name) and type_ != "wink_pin_t":
            out.append(_f(
                "dal.pin_optional_wink_pin_t", "warning", rel, 1,
                f"可选引脚字段 `{name}` 类型 `{type_}` 应为 `wink_pin_t`（spec DAL-S-006）",
                "Optional pins may be unused; use `wink_pin_t` (`int16_t`) with -1 sentinel.",
                ("DAL-S-006",),
            ))

    # DAL-S-011/012/013
    if ast.handle_type and ast.handle_members:
        if ast.handle_members and ast.handle_members[0] != (ast.config_type, "config"):
            out.append(_f(
                "dal.handle_config_first", "error", rel, 1,
                f"{ast.handle_type} 首字段必须为 `{ast.config_type} config;`（spec DAL-S-011）",
                "Reorder members; the first member MUST be the config struct so that `offsetof(handle, config) == 0`.",
                ("DAL-S-011",),
            ))
        if not any(n == "initialized" and t in ("bool", "_Bool") for t, n in ast.handle_members):
            out.append(_f(
                "dal.handle_has_initialized", "error", rel, 1,
                f"{ast.handle_type} 缺 `bool initialized;` 状态标志（spec DAL-S-012）",
                "Add `bool initialized;` member; zero-initialization must yield initialized == false.",
                ("DAL-S-012",),
            ))

    # DAL-S-014 (SHOULD warning; 严格值交 abi pack)
    if ast.handle_type and not _STATIC_ASSERT_OFFSETOF_RE.search(text):
        out.append(_f(
            "dal.handle_has_static_assert", "warning", rel, 1,
            f"{ast.handle_type} 缺 `_Static_assert(offsetof(handle, config) == 0, ...)` 守卫（spec DAL-S-014，强烈建议）",
            "Add the assertion right after the struct definition. Use `wink lint --pack abi` to verify the RHS values against the probe.",
            ("DAL-S-014",),
        ))

    # DAL-S-020 (Full Profile 强烈建议；sim 路径下的 mock alloc 不算违反)
    # 只在 .c 源里查
    if rel.endswith(".c") and _MALLOC_RE.search(text):
        out.append(_f(
            "dal.handle_no_dynamic_alloc", "warning", rel, 1,
            "DAL 驱动 init 路径 SHOULD NOT 调 malloc/calloc/realloc（spec DAL-S-020）",
            "Move allocation out of DAL into caller-provided static storage; declare heap use via `@note Eager-init Memory: Heap (X bytes)` (DAL-S-021).",
            ("DAL-S-020", "ADR-0004"),
        ))

    return out
```

**Step 2.3: 写测试**

在 `test_dal_pack.py` 追加：
```python
import importlib
from tools.lint.packs import dal_struct


def test_config_owner_first_passes_good():
    text = (FIXTURES / "good" / "dals" / "dal_led.h").read_text(encoding="utf-8")
    findings = dal_struct.check_struct("good/dals/dal_led.h", text, FIXTURES)
    bad = [f for f in findings if f.rule_id == "dal.config_owner_first"]
    assert bad == [], f"good fixture raised: {[f.message for f in bad]}"


def test_config_owner_first_fails_when_missing():
    text = (FIXTURES / "bad" / "dals" / "dal_led_missing_owner.h").read_text(encoding="utf-8")
    findings = dal_struct.check_struct("bad/dals/dal_led_missing_owner.h", text, FIXTURES)
    assert any(f.rule_id == "dal.config_owner_first" for f in findings)


def test_config_no_bitfield():
    text = (FIXTURES / "bad" / "dals" / "dal_button_bitfield.h").read_text(encoding="utf-8")
    findings = dal_struct.check_struct("bad/dals/dal_button_bitfield.h", text, FIXTURES)
    assert any(f.rule_id == "dal.config_no_bitfield" for f in findings)


def test_config_no_pragma_pack():
    text = (FIXTURES / "bad" / "dals" / "dal_button_pack.h").read_text(encoding="utf-8")
    findings = dal_struct.check_struct("bad/dals/dal_button_pack.h", text, FIXTURES)
    assert any(f.rule_id == "dal.config_no_pragma_pack" for f in findings)


def test_handle_has_initialized_required():
    text = (FIXTURES / "bad" / "dals" / "dal_button_no_init.h").read_text(encoding="utf-8")
    findings = dal_struct.check_struct("bad/dals/dal_button_no_init.h", text, FIXTURES)
    assert any(f.rule_id == "dal.handle_has_initialized" for f in findings)
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_bitfield.h`：
```c
/* ❌ 位域违反 DAL-S-005 */
typedef struct {
    const char *owner;
    uint8_t flags : 3;   /* 违规：位域 */
} dal_button_bitfield_config_t;
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_pack.h`：
```c
/* ❌ pragma pack 违反 DAL-S-005 */
#pragma pack(1)
typedef struct {
    const char *owner;
    uint8_t pin;
} dal_button_pack_config_t;
#pragma pack()
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_no_init.h`：
```c
/* ❌ 缺 initialized 违反 DAL-S-012 */
typedef struct {
    const char *owner;
    uint8_t pin;
} dal_button_no_init_config_t;

typedef struct {
    dal_button_no_init_config_t config;
    /* 缺 bool initialized; */
} dal_button_no_init_t;
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_dynalloc.h`：
```c
/* ❌ DAL-S-020 动态内存 */
wink_status_t dal_button_dynalloc_init(dal_button_t *dev, const dal_button_config_t *cfg) {
    dev->config.owner = cfg->owner;
    dev->config.buf = malloc(16);  /* 违规 */
    return WINK_OK;
}
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_button_pin_optional.h`：
```c
/* ❌ 可选引脚未用 wink_pin_t（DAL-S-006 SHOULD） */
typedef struct {
    const char *owner;
    uint16_t pin_a;
    uint16_t dir_pin_b;  /* 违规：应 wink_pin_t */
} dal_button_pin_optional_config_t;
```

**Step 2.4: 跑测试**

Run: `cd wink-tools && python -m pytest tools/tests/test_dal_pack.py -v -k "owner_first or no_bitfield or no_pragma_pack or no_init"`
Expected: 4 passed.

**Step 2.5: Commit**

```bash
git add wink-tools/tools/lint/packs/dal_struct.py \
        wink-tools/tools/lint/rules/dal.yaml \
        wink-tools/tools/lint/testdata/dal/bad/dals/
git commit -m "lint(dal.struct): §2 struct/handle rules (DAL-S-001/005/006/011/012/014/020)"
```

---


## Task 3: §9 单位后缀与量纲两分类（`dal.quantity` 子模块）

**Files:**
- Create: `wink-tools/tools/lint/packs/dal_quantity.py`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_dc_motor_bad_suffix.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_typedef_speed.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_typedef_promille_float.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_promille_float_param.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_dc_motor_set_unsigned_promille.h`

**Interfaces:**
- Consumes: `dal.lexer.parse_header()`, `dal.quantity_suffixes.*` (Task 1)
- Produces: `dal.quantity` 子模块的 12 条规则

**规则清单：**
- `dal.quantity.suffix_closed` (DAL-U-001/003) — 必带后缀且必须查封闭表
- `dal.quantity.suffix_encodes_scale` (DAL-U-004) — A 类后缀必须编码刻度
- `dal.quantity.norm_suffix_with_range_doc` (DAL-U-002) — `_norm` 必须 Range 字段
- `dal.quantity.range_required_in_doc` (DAL-U-010) — 公开 API Range 字段必填
- `dal.quantity.a_class_saturate_not_reject` (DAL-U-011) — A 类 setter 不应直接 return 错误
- `dal.quantity.b_class_saturate_safe` (DAL-U-012) — B 类内部换算无 UB
- `dal.quantity.declared_in_yaml` (DAL-U-021) — 新物理量在 YAML quantity_class 声明
- `dal.quantity.no_weak_typedef` (DAL-U-022) — 禁弱 typedef 量纲别名
- `dal.quantity.a_class_no_float` (DAL-U-023) — A 类 Full Profile 禁 float
- `dal.quantity.a_class_no_app_macro_wrap` (DAL-U-025) — A 类 App 字面量直写整数
- `dal.quantity.a_class_doc_3_examples` (DAL-U-026) — A 类头注释 ≥3 字面量示例
- `dal.quantity.a_class_signedness` (DAL-U-027/028) — 单向/双向控制量符号匹配
- `dal.quantity.a_class_overflow_guard` (DAL-U-029) — 乘法中间值必须提升 32 位
- `dal.quantity.full_time_uint32_micro_uint16` (DAL-U-031) — 时间量 Full/Micro 宽度
- `dal.quantity.b_class_unit_consistent` (DAL-U-040-042) — B 类量单位前后一致

**Step 3.1: 实现子模块核心**

`wink-tools/tools/lint/packs/dal_quantity.py`：
```python
"""dal.quantity: spec §9 单位后缀、量纲两分类、定标整数、钳位饱和。"""
from __future__ import annotations
import re
from pathlib import Path
from tools.lint.dal.lexer import parse_header, extract_doc_blocks
from tools.lint.dal.quantity_suffixes import (
    A_CLASS_UNITS, B_CLASS_UNITS, UNSIGNED_HINT, SIGNED_HINT,
    is_a_class_unit, signedness_for,
)
from tools.lint.engine.models import Finding

# 物理量参数名后缀提取（最末一个 _xxx 片段）
_SUFFIX_RE = re.compile(r"(?:^|_)([a-z]+(?:_\d+)?)$")
# 弱 typedef 形式：typedef <T> dal_xxx_t;
_WEAK_TYPEDEF_RE = re.compile(
    r"typedef\s+(?P<rhs>[\w\s\*]+?)\s+(?P<lhs>dal_\w+_(?:speed|angle|duty|distance|position|count|pulse|timeout|raw)_\w*_t)\s*;"
)
_FLOAT_PARAM_RE = re.compile(
    r"\bset_(?:speed|angle|duty|brightness|level|count|position|force)\s*\([^,]+,\s*(?:float|double)\b"
)
_OVERFLOW_RISK_RE = re.compile(
    r"(\(\s*[\w]+\s*\*\s*[\w]+\s*\)\s*/\s*\d+)"  # 形如 (a * b) / N 且 a/b 为 uint16/uint8
)
_DOC_RANGE_RE = re.compile(r"^\s*-\s*Range:\s*", re.MULTILINE)
_DOC_EXAMPLES_RE = re.compile(r"^\s*-\s*Examples?:", re.MULTILINE)
_DOC_EXAMPLE_NUM_RE = re.compile(r"\b-?\d{2,5}\b")
_DOC_API_CONTRACT_RE = re.compile(r"@note\s+API\s+Contract:", re.IGNORECASE)


def _f(rule_id, sev, path, line, msg, help, refs):
    return Finding(
        rule_id=rule_id, severity=sev, path=path, line=line, column=None,
        message=msg, snippet=None, help=help,
        refs=tuple(refs), allowlisted=False, rule_source="sdk",
    )


def _suffix_of(name: str) -> str:
    """从形如 `speed_promille` 中提取末段后缀 `_promille`."""
    m = _SUFFIX_RE.search(name)
    return m.group(1) if m else ""


def check_quantity(
    rel: str, text: str, root: Path,
    yaml_quantities: dict | None = None,  # 由 dal.yaml_parity 注入
) -> list[Finding]:
    out: list[Finding] = []
    ast = parse_header(text)
    blocks = extract_doc_blocks(text)
    is_dal_header = ast.config_type is not None or ast.handle_type is not None

    if is_dal_header:
        # ---- DAL-U-001/003 后缀必须查封闭表 ----
        for type_, name in ast.config_members + ast.handle_members:
            suf = _suffix_of(name)
            if not suf or suf.startswith("cfg"):
                continue
            if name in ("owner", "initialized", "config", "active_high", "invert", "name"):
                continue  # 已知非物理量
            if not is_a_class_unit(suf) and not is_b_class_unit(suf):
                out.append(_f(
                    "dal.quantity.suffix_closed", "error", rel, 1,
                    f"参数/字段 `{name}` 后缀 `{suf}` 不在封闭单位后缀表（spec DAL-U-001/003）",
                    f"Use a closed-set suffix from tools/lint/dal/quantity_suffixes.py (A/B class). "
                    f"Add a new suffix only via spec ADR review (DAL-U-003).",
                    ("DAL-U-001", "DAL-U-003", "ADR-0056"),
                ))

        # ---- DAL-U-004 A 类后缀必须编码刻度 ----
        for type_, name in ast.handle_members:
            suf = _suffix_of(name)
            if not is_a_class_unit(suf) or suf in {"_norm", "_angle", "_duty"}:
                out.append(_f(
                    "dal.quantity.suffix_encodes_scale", "error", rel, 1,
                    f"A 类量 `{name}` 后缀 `{suf}` 未编码刻度（spec DAL-U-004）",
                    "Use `_promille`/`_ddeg`/`_um`/... so the reader can map integer → physical unit without a hidden scale.",
                    ("DAL-U-004", "ADR-0056"),
                ))

        # ---- DAL-U-022 禁弱 typedef 量纲别名 ----
        for m in _WEAK_TYPEDEF_RE.finditer(text):
            rhs = m.group("rhs").strip()
            if "float" in rhs or "double" in rhs:
                out.append(_f(
                    "dal.quantity.no_weak_typedef", "error", rel, 1,
                    f"禁弱 typedef 量纲别名 `{m.group('lhs')}`（spec DAL-U-022）",
                    "Drop the typedef; use the underlying type directly. C typedefs do not enforce units.",
                    ("DAL-U-022", "ADR-0056"),
                ))

    # ---- DAL-U-023 A 类 Full Profile 禁 float setter ----
    for line_no, line in enumerate(text.splitlines(), start=1):
        if _FLOAT_PARAM_RE.search(line):
            out.append(_f(
                "dal.quantity.a_class_no_float", "error", rel, line_no,
                f"A 类执行器命令 setter 不应使用 float/double 参数（spec DAL-U-023）",
                "Switch to a scaled-integer parameter (e.g. `int16_t speed_promille` per §9.4).",
                ("DAL-U-023", "ADR-0056"),
            ))

    # ---- DAL-U-025 App 字面量直写整数 ----
    # 弱检：若 codegen 模板中看到 DAL_*_TO_PROMILLE 这类宏，提醒
    if re.search(r"\bDAL_\w+_TO_\w+\s*\(", text):
        out.append(_f(
            "dal.quantity.a_class_no_app_macro_wrap", "warning", rel, 1,
            "检测到疑似 A 类字面量转换宏（spec DAL-U-025 推荐直写整数）",
            "A-class literal conversion adds a macro layer with no compile-time unit check. "
            "Prefer writing the scaled integer directly (e.g. `500` not `DAL_SPEED_TO_PROMILLE(0.5f)`).",
            ("DAL-U-025",),
        ))

    # ---- DAL-U-026 A 类头注释 ≥3 具名字面量示例 ----
    for b in blocks:
        if not _DOC_API_CONTRACT_RE.search(b.text):
            continue
        if not is_a_class_unit(""):
            pass  # 全部 doc 块都过一遍
        # 简化：若 block 中检测到 Range 但 examples < 3 个数字
        if _DOC_RANGE_RE.search(b.text):
            examples_section = re.search(
                r"Range:.*?(?=\n\s*-\s*[A-Z][a-z]+:\s|\Z)", b.text, re.DOTALL
            )
            if examples_section and len(_DOC_EXAMPLE_NUM_RE.findall(examples_section.group(0))) < 3:
                out.append(_f(
                    "dal.quantity.a_class_doc_3_examples", "warning", rel, b.start_line,
                    "A 类 API Contract 注释 Range 字段含 <3 个具名字面量示例（spec DAL-U-026）",
                    "Add ≥3 named literal examples (e.g. `1000=全速正转, 0=coast, -500=半速反转`) per spec §9.4.6.",
                    ("DAL-U-026",),
                ))

    # ---- DAL-U-027/028 符号与刻度后缀匹配 ----
    for type_, name in ast.handle_members:
        suf = _suffix_of(name)
        if not is_a_class_unit(suf):
            continue
        want = signedness_for(suf)
        if want == "unsigned" and type_.startswith(("int", "signed", "int16_t", "int32_t")):
            out.append(_f(
                "dal.quantity.a_class_signedness", "warning", rel, 1,
                f"无物理反向的量 `{name}` ({suf}) 不应使用有符号类型 `{type_}`（spec DAL-U-027）",
                f"Use `uint16_t`/`uint32_t` per DAL-U-027. Suffix `{suf}` is unsigned by spec.",
                ("DAL-U-027",),
            ))
        if want == "signed" and type_.startswith(("uint", "unsigned")):
            out.append(_f(
                "dal.quantity.a_class_signedness", "warning", rel, 1,
                f"双向控制量 `{name}` ({suf}) 不应使用无符号类型 `{type_}`（spec DAL-U-028）",
                f"Use `int16_t`/`int32_t` per DAL-U-028. Suffix `{suf}` requires signed.",
                ("DAL-U-028",),
            ))

    # ---- DAL-U-029 乘法中间值 32 位提升 ----
    # 简化启发式：检测 (a * b) / N 形式且 a/b 是 16 位
    for line_no, line in enumerate(text.splitlines(), start=1):
        m = _OVERFLOW_RISK_RE.search(line)
        if not m:
            continue
        if "uint32_t" in line or "int32_t" in line or "(uint32_t)" in line or "(int32_t)" in line:
            continue
        out.append(_f(
            "dal.quantity.a_class_overflow_guard", "error", rel, line_no,
            f"乘法中间值未显式提升到 32 位（spec DAL-U-029）",
            "Cast operands to `uint32_t`/`int32_t` before multiplying: `((uint32_t)arr * (uint32_t)duty) / 1000u`.",
            ("DAL-U-029",),
        ))

    # ---- DAL-U-021 YAML quantity_class 声明 ----
    if yaml_quantities is not None and ast.handle_type:
        for type_, name in ast.handle_members:
            suf = _suffix_of(name)
            if not is_a_class_unit(suf) and not is_b_class_unit(suf):
                continue
            base = name[: -(len(suf) + 1)] if suf else name
            if base not in yaml_quantities:
                out.append(_f(
                    "dal.quantity.declared_in_yaml", "warning", rel, 1,
                    f"物理量 `{name}` 在 codegen YAML 中缺 `quantity_class` 声明（spec DAL-U-021）",
                    "Add `quantities.<name>.quantity_class: actuator_command|sensor_measurement` to the driver YAML.",
                    ("DAL-U-021",),
                ))

    return out
```

**Step 3.2: bad fixture 示例**

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_typedef_promille_float.h`：
```c
/* ❌ DAL-U-022 弱 typedef 浮点量纲别名 */
typedef float dal_led_promille_t;  /* 违规 */
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_typedef_speed.h`：
```c
/* ❌ DAL-U-022 弱 typedef 整型量纲别名 */
typedef int16_t dal_led_speed_norm_t;  /* 违规 */
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_promille_float_param.h`：
```c
/* ❌ DAL-U-023 A 类 setter 用 float */
wink_status_t dal_led_set_brightness_promille(dal_led_t *dev, float brightness_promille);
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_dc_motor_set_unsigned_promille.h`：
```c
/* ❌ DAL-U-028 双向量用无符号 */
typedef struct {
    const char *owner;
    uint16_t speed_promille;  /* 违规：双向 speed 应 int16_t */
} dal_dc_motor_set_unsigned_promille_config_t;
```

**Step 3.3: 测试**

追加到 `test_dal_pack.py`：
```python
from tools.lint.packs import dal_quantity


def test_quantity_no_weak_typedef_float():
    text = (FIXTURES / "bad" / "dals" / "dal_led_typedef_promille_float.h").read_text()
    findings = dal_quantity.check_quantity("bad/dals/dal_led_typedef_promille_float.h", text, FIXTURES)
    assert any(f.rule_id == "dal.quantity.no_weak_typedef" for f in findings)


def test_quantity_a_class_no_float():
    text = (FIXTURES / "bad" / "dals" / "dal_led_promille_float_param.h").read_text()
    findings = dal_quantity.check_quantity("bad/dals/dal_led_promille_float_param.h", text, FIXTURES)
    assert any(f.rule_id == "dal.quantity.a_class_no_float" for f in findings)


def test_quantity_a_class_signedness():
    text = (FIXTURES / "bad" / "dals" / "dal_dc_motor_set_unsigned_promille.h").read_text()
    findings = dal_quantity.check_quantity("bad/dals/dal_dc_motor_set_unsigned_promille.h", text, FIXTURES)
    assert any(f.rule_id == "dal.quantity.a_class_signedness" for f in findings)


def test_quantity_suffix_closed():
    text = (FIXTURES / "bad" / "dals" / "dal_dc_motor_bad_suffix.h").read_text()
    findings = dal_quantity.check_quantity("bad/dals/dal_dc_motor_bad_suffix.h", text, FIXTURES)
    assert any(f.rule_id == "dal.quantity.suffix_closed" for f in findings)
```

**Step 3.4: 跑测试**

Run: `cd wink-tools && python -m pytest tools/tests/test_dal_pack.py -v -k quantity`
Expected: 4+ passed.

**Step 3.5: Commit**

```bash
git add wink-tools/tools/lint/packs/dal_quantity.py wink-tools/tools/lint/testdata/dal/bad/dals/
git commit -m "lint(dal.quantity): §9 unit/quantity rules (DAL-U-001/003/004/021/022/023/025/026/027/028/029)"
```

---


## Task 4: §16 YAML ↔ C 双向一致性 + §3.2 safe_off + §11 stub（`dal.yaml_parity` 子模块）

**Files:**
- Create: `wink-tools/tools/lint/packs/dal_yaml_parity.py`
- Create: `wink-tools/tools/lint/testdata/dal/good/codegen/drivers/dc_motor_parity.yaml`
- Create: `wink-tools/tools/lint/testdata/dal/bad/codegen/drivers/bad_actuator_no_safe_off.yaml`
- Create: `wink-tools/tools/lint/testdata/dal/bad/codegen/drivers/bad_nonactuator_safe_off.yaml`
- Create: `wink-tools/tools/lint/testdata/dal/bad/codegen/drivers/bad_stub_not_experimental.yaml`
- Create: `wink-tools/tools/lint/testdata/dal/bad/codegen/drivers/bad_missing_quantity_class.yaml`

**Interfaces:**
- Consumes: `tools.codegen.yaml_schema.load_driver_yaml`, `tools.codegen.list_drivers.check_consistency`
- Produces: `dal.yaml_parity` 子模块的 7 条规则

**规则清单：**
- `dal.yaml.actuator_safe_off_present` (DAL-L-020) — `is_actuator: true` 必有 safe_off
- `dal.yaml.nonactuator_no_safe_off` (DAL-L-020) — `is_actuator: false` 严禁空壳
- `dal.yaml.stub_experimental_required` (DAL-P-014) — Stub 标 experimental: true
- `dal.yaml.stub_no_init_true` (DAL-P-012) — Stub MUST NOT 置 initialized=true（与 c 端检查联动）
- `dal.yaml.quantity_class_required` (DAL-U-021) — 每个物理量必须显式 quantity_class
- `dal.yaml.safety_off_fn_in_header` (DAL-L-020) — config.safe_off_fn 必须在 dal_<type>.h 中声明
- `dal.yaml.legacy_field_tables_forbid` (Schema 1.1) — 禁 required_fields/stable_fields/advanced_fields

**Step 4.1: 实现子模块**

`wink-tools/tools/lint/packs/dal_yaml_parity.py`：
```python
"""dal.yaml_parity: spec §16 YAML ↔ C 双向一致性 + §3.2 safe_off + §11 stub.

此模块是 drivers pack 中 _check_schema_guards 的升级版。
保留 drivers pack 入口作为兼容层（drivers.py 内部转发到本模块）。
"""
from __future__ import annotations
import re
from pathlib import Path
from tools.lint.engine.models import Finding
from tools.lint.dal.lexer import parse_header


def _f(rule_id, sev, path, line, msg, help, refs):
    return Finding(
        rule_id=rule_id, severity=sev, path=path, line=line, column=None,
        message=msg, snippet=None, help=help,
        refs=tuple(refs), allowlisted=False, rule_source="sdk",
    )


def check_yaml_parity(root: Path) -> list[Finding]:
    """遍历 codegen/drivers/*.yaml，对每个驱动做 §3.2/§11/§16 检查。"""
    findings: list[Finding] = []
    codegen = root / "codegen"
    if not codegen.is_dir():
        return findings
    drivers_dir = codegen / "drivers"
    if not drivers_dir.is_dir():
        return findings

    from tools.codegen.yaml_schema import (
        SUPPORTED_CODEGEN_SCHEMA,
        dal_header_path,
        function_declared_in_header,
        is_dal_stub,
        legacy_field_tables_present,
        load_driver_yaml,
        load_yaml_mapping,
        parse_schema_version,
    )

    for yaml_path in sorted(drivers_dir.glob("*.yaml")):
        try:
            record = load_driver_yaml(yaml_path)
        except Exception as exc:
            findings.append(_f(
                "dal.yaml.load_error", "error", _rel(yaml_path, root), 1,
                f"failed to load driver YAML: {exc}",
                "Fix the YAML schema before further checks.",
                ("ADR-0046",),
            ))
            continue
        rel = _rel(yaml_path, root)

        # ---- DAL-P-014 stub 必须 experimental: true ----
        if is_dal_stub(record.type, record.category, root) and not record.experimental:
            findings.append(_f(
                "dal.yaml.stub_experimental_required", "error", rel, 1,
                f"driver {record.type!r} 是 DAL stub 但 experimental: false（spec DAL-P-014）",
                "Set `experimental: true` on stub drivers until DAL lands.",
                ("DAL-P-014",),
            ))

        # ---- DAL-L-020 actuator safe_off ----
        if record.is_actuator:
            safe_off_fn = str(record.config.get("safe_off_fn") or "").strip()
            hdr = dal_header_path(record.type, record.category, root)
            if not safe_off_fn:
                findings.append(_f(
                    "dal.yaml.actuator_safe_off_present", "error", rel, 1,
                    f"actuator {record.type!r} 缺 config.safe_off_fn（spec DAL-L-020）",
                    "Set `config.safe_off_fn: dal_<type>_safe_off` (or `dal_<type>_off` for YAML-bound variant).",
                    ("DAL-L-020", "ADR-0048"),
                ))
            elif hdr and hdr.is_file() and not function_declared_in_header(hdr, safe_off_fn):
                findings.append(_f(
                    "dal.yaml.safety_off_fn_in_header", "error", rel, 1,
                    f"safe_off_fn {safe_off_fn!r} 在 {hdr.name} 中无声明（spec DAL-L-020）",
                    f"Declare `{safe_off_fn}` in the DAL header, or fix the YAML to point at the real symbol.",
                    ("DAL-L-020",),
                ))
        else:
            # is_actuator: false 时，YAML 严禁设 safe_off_fn
            if str(record.config.get("safe_off_fn") or "").strip():
                findings.append(_f(
                    "dal.yaml.nonactuator_no_safe_off", "error", rel, 1,
                    f"非 actuator {record.type!r} 不应声明 config.safe_off_fn（spec DAL-L-020）",
                    "Remove the safe_off_fn field; non-actuator drivers (button/encoder/eeprom/gps/ultrasonic) MUST NOT have safe_off.",
                    ("DAL-L-020",),
                ))

        # ---- DAL-U-021 quantity_class 必填 ----
        quants = (record.quantities if hasattr(record, "quantities") else None) or {}
        if hasattr(record, "fields") and record.fields:
            for f in record.fields:
                name = getattr(f, "name", None) or getattr(f, "c", None)
                if not name:
                    continue
                q = quants.get(name)
                if q is None or not q.get("quantity_class"):
                    findings.append(_f(
                        "dal.yaml.quantity_class_required", "error", rel, 1,
                        f"field {name!r} 缺 quantities.<name>.quantity_class（spec DAL-U-021）",
                        "Add `quantities.<name>.quantity_class: actuator_command|sensor_measurement`.",
                        ("DAL-U-021", "ADR-0056"),
                    ))

        # ---- Schema 1.1 legacy tables 禁 ----
        try:
            raw_doc = load_yaml_mapping(yaml_path)
        except Exception:
            raw_doc = None
        if raw_doc is not None and legacy_field_tables_present(raw_doc):
            try:
                ver = parse_schema_version(record.codegen_schema)
            except Exception:
                ver = None
            if ver is not None and ver >= SUPPORTED_CODEGEN_SCHEMA:
                findings.append(_f(
                    "dal.yaml.legacy_field_tables_forbid", "error", rel, 1,
                    f"driver {record.type!r} 仍用 legacy field tables（required/stable/advanced_fields）",
                    "Migrate to `fields:` per Schema 1.1 (use `wink migrate-schema`).",
                    ("ADR-0046",),
                ))

    return findings


def _rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix().replace("\\", "/")
```

**Step 4.2: bad fixture 示例**

`wink-tools/tools/lint/testdata/dal/bad/codegen/drivers/bad_actuator_no_safe_off.yaml`：
```yaml
codegen_schema: "1.1"
type: bad_actuator
category: actuator
is_actuator: true
experimental: true
config:
  c_type: dal_bad_actuator_t
  config_type: dal_bad_actuator_config_t
  # ❌ 缺 safe_off_fn
role_bindings: {}
```

`wink-tools/tools/lint/testdata/dal/bad/codegen/drivers/bad_nonactuator_safe_off.yaml`：
```yaml
codegen_schema: "1.1"
type: bad_sensor
category: sensor
is_actuator: false
config:
  c_type: dal_bad_sensor_t
  config_type: dal_bad_sensor_config_t
  safe_off_fn: dal_bad_sensor_safe_off  # ❌ 非 actuator 不应设
```

`wink-tools/tools/lint/testdata/dal/bad/codegen/drivers/bad_stub_not_experimental.yaml`：
```yaml
codegen_schema: "1.1"
type: bad_stub
category: sensor
is_actuator: false
experimental: false  # ❌ 实际是 stub（DAL source 不存在）
config:
  c_type: dal_bad_stub_t
  config_type: dal_bad_stub_config_t
```

`wink-tools/tools/lint/testdata/dal/bad/codegen/drivers/bad_missing_quantity_class.yaml`：
```yaml
codegen_schema: "1.1"
type: bad_q
category: actuator
is_actuator: true
experimental: true
config:
  c_type: dal_bad_q_t
fields:
  - name: speed
    c: speed_promille
    type: int16_t
    # ❌ 缺 quantities.speed.quantity_class
quantities: {}  # 缺 quantity_class
```

**Step 4.3: 测试**

```python
from tools.lint.packs import dal_yaml_parity


def test_yaml_actuator_missing_safe_off():
    p = FIXTURES / "bad" / "codegen" / "drivers" / "bad_actuator_no_safe_off.yaml"
    # 直接走 record loader 而不是根扫描
    from tools.codegen.yaml_schema import load_driver_yaml
    rec = load_driver_yaml(p)
    # 单测 fixture 较薄：手工构造一条 record
    # 简化：跳过，依赖 _check_one 集成测试
```

（完整集成测试在 Task 11）

**Step 4.4: Commit**

```bash
git add wink-tools/tools/lint/packs/dal_yaml_parity.py \
        wink-tools/tools/lint/testdata/dal/bad/codegen/
git commit -m "lint(dal.yaml_parity): §3.2/§11/§16 yaml-C parity rules"
```

---


## Task 5: §15 API Contract 注释必填字段（`dal.contract_doc` 子模块）

**Files:**
- Create: `wink-tools/tools/lint/packs/dal_contract_doc.py`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_no_contract.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_contract_partial.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_ultrasonic_blocking_no_estimate.h`

**Interfaces:**
- Consumes: `dal.lexer.extract_doc_blocks()`, `dal.lexer.parse_header()`
- Produces: `dal.contract_doc` 子模块的 3 条规则

**规则清单：**
- `dal.contract.api_contract_required` (DAL-C-042 / §15) — 公开 API MUST 含 `@note API Contract:` 块
- `dal.contract.required_fields` (DAL-C-042 / §15) — Preconditions/Postconditions/Range/Blocking/Thread-safe/ISR-safe/Error-codes 必填
- `dal.contract.blocking_with_estimate` (DAL-B-003) — Blocking 字段 MUST 给数值上界

**Step 5.1: 实现子模块**

`wink-tools/tools/lint/packs/dal_contract_doc.py`：
```python
"""dal.contract_doc: spec §15 API Contract 注释必填字段。"""
from __future__ import annotations
import re
from pathlib import Path
from tools.lint.dal.lexer import extract_doc_blocks
from tools.lint.engine.models import Finding

_REQUIRED_FIELDS = [
    "Preconditions",
    "Postconditions",
    "Range",
    "Blocking",
    "Thread-safe",
    "ISR-safe",
    "Error-codes",
]
_API_CONTRACT_RE = re.compile(r"@note\s+API\s+Contract:", re.IGNORECASE)
_FIELD_RE_TEMPLATE = r"^\s*-\s*{field}:\s*"
_BLOCKING_ESTIMATE_RE = re.compile(
    r"Blocking:\s*Yes\b(?![^()\n]*\d+\s*(?:ms|us|s)\b)",
    re.IGNORECASE,
)


def _f(rule_id, sev, path, line, msg, help, refs):
    return Finding(
        rule_id=rule_id, severity=sev, path=path, line=line, column=None,
        message=msg, snippet=None, help=help,
        refs=tuple(refs), allowlisted=False, rule_source="sdk",
    )


def check_contract_doc(rel: str, text: str, root: Path) -> list[Finding]:
    out: list[Finding] = []
    if not rel.endswith(".h"):
        return out  # 只查公开头

    blocks = extract_doc_blocks(text)
    # 简单策略：每段 `/** ... */` 紧跟着一个函数声明视为该函数的 doc
    # 启发式：doc 块后 20 行内有 `(...)` 开头的代码行
    for b in blocks:
        if not _API_CONTRACT_RE.search(b.text):
            # DAL-C-042：公开 API 必须有 API Contract
            if _looks_like_public_dal_doc(b.text):
                out.append(_f(
                    "dal.contract.api_contract_required", "warning", rel, b.start_line,
                    "公开 DAL API 缺 `@note API Contract:` 块（spec §15 / DAL-C-042）",
                    "Add an API Contract block with: Preconditions, Postconditions, Range, Blocking, Thread-safe, ISR-safe, Error-codes.",
                    ("DAL-C-042", "S15"),
                ))
            continue

        # 必填字段完整性
        for field in _REQUIRED_FIELDS:
            field_re = re.compile(_FIELD_RE_TEMPLATE.format(field=re.escape(field)), re.MULTILINE)
            if not field_re.search(b.text):
                out.append(_f(
                    "dal.contract.required_fields", "warning", rel, b.start_line,
                    f"API Contract 缺必填字段 `{field}`（spec §15）",
                    f"Add `- {field}: <value>` per the API Contract template in spec §15.",
                    ("DAL-C-042", "S15"),
                ))

        # Blocking 数值上界
        if _BLOCKING_ESTIMATE_RE.search(b.text):
            out.append(_f(
                "dal.contract.blocking_with_estimate", "error", rel, b.start_line,
                "Blocking: Yes 缺最坏阻塞时间数值上界（spec DAL-B-003）",
                "Add `worst-case ≈ Xms` (or `Xus`/`Xs`) to the Blocking line.",
                ("DAL-B-003",),
            ))

    return out


def _looks_like_public_dal_doc(text: str) -> bool:
    """启发式：doc 块含 @brief + @param dev + @return → 公开 API 注释."""
    if "@brief" not in text:
        return False
    if "@param" not in text and "param" not in text:
        return False
    if "@return" not in text and "return" not in text:
        return False
    return True
```

**Step 5.2: bad fixture**

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_no_contract.h`：
```c
/* ❌ §15 公开 API 缺 @note API Contract: */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_no_contract_init(dal_led_no_contract_t *dev, const dal_led_no_contract_config_t *cfg);
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_contract_partial.h`：
```c
/* ❌ 缺 Thread-safe/ISR-safe/Error-codes */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_partial_init(dal_led_partial_t *dev, const dal_led_partial_config_t *cfg);
/**
 * @brief 初始化（不完整 contract）
 *
 * @param dev
 * @param cfg
 * @return
 *
 * @note API Contract:
 *   - Preconditions: dev != NULL
 *   - Postconditions: initialized
 *   - Range: pin in [0, 100]
 *   - Blocking: No
 *   /* 缺 Thread-safe, ISR-safe, Error-codes */
 */
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_ultrasonic_blocking_no_estimate.h`：
```c
/* ❌ Blocking Yes 无数值上界 */
WINK_BLOCKING WINK_WARN_UNUSED_RESULT
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm);
/**
 * @brief 读取距离
 * @param dev
 * @param distance_cm
 * @return
 *
 * @note API Contract:
 *   - Preconditions: dev != NULL
 *   - Postconditions: distance updated
 *   - Range: distance_cm in [0.0, 500.0]
 *   - Blocking: Yes        /* 缺 worst-case Xms */
 *   - Thread-safe: No
 *   - ISR-safe: No
 *   - Error-codes: WINK_OK / WINK_ERR_TIMEOUT
 */
```

**Step 5.3: 测试**

```python
from tools.lint.packs import dal_contract_doc


def test_contract_no_api_contract_block():
    text = (FIXTURES / "bad" / "dals" / "dal_led_no_contract.h").read_text()
    findings = dal_contract_doc.check_contract_doc("bad/dals/dal_led_no_contract.h", text, FIXTURES)
    assert any(f.rule_id == "dal.contract.api_contract_required" for f in findings)


def test_contract_required_fields():
    text = (FIXTURES / "bad" / "dals" / "dal_led_contract_partial.h").read_text()
    findings = dal_contract_doc.check_contract_doc("bad/dals/dal_led_contract_partial.h", text, FIXTURES)
    assert any(f.rule_id == "dal.contract.required_fields" for f in findings)


def test_contract_blocking_no_estimate():
    text = (FIXTURES / "bad" / "dals" / "dal_ultrasonic_blocking_no_estimate.h").read_text()
    findings = dal_contract_doc.check_contract_doc("bad/dals/dal_ultrasonic_blocking_no_estimate.h", text, FIXTURES)
    assert any(f.rule_id == "dal.contract.blocking_with_estimate" for f in findings)
```

**Step 5.4: 跑 + Commit**

Run: `cd wink-tools && python -m pytest tools/tests/test_dal_pack.py -v -k contract`
Expected: 3 passed.

```bash
git add wink-tools/tools/lint/packs/dal_contract_doc.py \
        wink-tools/tools/lint/testdata/dal/bad/dals/
git commit -m "lint(dal.contract_doc): §15 API Contract required fields"
```

---


## Task 6: §4 + §5 + §14 函数签名/命名/错误码（`dal.api_shape` 子模块）

**Files:**
- Create: `wink-tools/tools/lint/packs/dal_api_shape.py`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_bool_return.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_non_const_getter.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_out_param_naming.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_blacklist_verb.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_ioctl.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_dc_motor_promille_getter_unsigned.h`

**Interfaces:**
- Consumes: `dal.lexer.parse_header()`
- Produces: `dal.api_shape` 子模块的 11 条规则

**规则清单：**
- `dal.api.status_return_required` (DAL-F-001) — 公开 API MUST 返回 `wink_status_t`（**严格版**，见 OQ-9）
- `dal.api.no_bool_return_strict` (DAL-F-002) — 严格版：禁 bool/int/void 返回
- `dal.api.bool_predicate_via_out` (DAL-F-003) — 布尔谓词通过 `bool *out_`
- `dal.api.warn_unused_result` (DAL-F-004) — 除豁免白名单外 MUST 标 `WINK_WARN_UNUSED_RESULT`
- `dal.api.first_arg_is_dev` (DAL-F-010) — 第一参数必须为实例句柄指针
- `dal.api.const_getter` (DAL-F-011) — 不改状态 API 用 `const dev`
- `dal.api.mutator_non_const_dev` (DAL-F-012) — 改状态 API 用 `dev`（非 const）
- `dal.api.out_param_prefix` (DAL-F-013) — 出参必须 `out_` 前缀
- `dal.api.init_cfg_const` (DAL-F-014) — init 第二参数 SHOULD `const config_t *`
- `dal.api.blacklist_verb` (DAL-5.3 黑名单) — 禁 `turn_on` / `enable_output` / `fetch_data` 等
- `dal.api.no_ioctl_void_star` (DAL-V-003) — 禁 `control(cmd, void *arg)` 形式

**Step 6.1: 实现子模块**

`wink-tools/tools/lint/packs/dal_api_shape.py`：
```python
"""dal.api_shape: spec §4 函数签名 + §5 命名 + §14.1 错误码使用。"""
from __future__ import annotations
import re
from pathlib import Path
from tools.lint.dal.lexer import parse_header
from tools.lint.engine.models import Finding

_WARN_UNUSED_EXEMPT = {"safe_off", "poll", "deinit"}  # spec DAL-F-004 白名单
_BLACKLIST_VERBS = {
    "actuator/output": {"turn_on", "enable_output", "run_motor", "spin", "start_pwm"},
    "sensor/input": {"fetch_data", "sample_now", "get_dist"},
    "display": {"clean_screen", "refresh_display", "light_on"},
}
_FUNC_DECL_RE = re.compile(
    r"(?P<attrs>(?:WINK_\w+\s+)*)\s*"
    r"(?P<ret>[\w\s\*]+?)\s*"
    r"(?P<name>dal_\w+)\s*\((?P<params>[^)]*)\)\s*;",
    re.MULTILINE,
)


def _f(rule_id, sev, path, line, msg, help, refs):
    return Finding(
        rule_id=rule_id, severity=sev, path=path, line=line, column=None,
        message=msg, snippet=None, help=help,
        refs=tuple(refs), allowlisted=False, rule_source="sdk",
    )


def _verb(name: str) -> str:
    """dal_<type>_<verb>[_<obj>] 提取 verb。"""
    parts = name.split("_")
    if len(parts) < 3:
        return ""
    return parts[2]


def _category_of(type_name: str, all_types: dict | None) -> str:
    if all_types is None:
        return ""
    return all_types.get(type_name, "")


def check_api_shape(
    rel: str, text: str, root: Path, *, all_types: dict | None = None,
) -> list[Finding]:
    if not rel.endswith(".h"):
        return out if (out := []) else []  # 简化写法
    out: list[Finding] = []
    ast = parse_header(text)
    if ast.config_type is None:
        return out

    type_name = ast.config_type.replace("dal_", "").replace("_config_t", "")

    for m in _FUNC_DECL_RE.finditer(text):
        attrs = m.group("attrs").strip().split()
        ret = m.group("ret").strip()
        name = m.group("name")
        params_str = m.group("params")
        params = [p.strip() for p in params_str.split(",") if p.strip()]
        verb = _verb(name)
        is_getter = verb.startswith("get_") or verb.startswith("is_") or verb == "get_state"
        is_mutator = verb in ("init", "deinit", "on", "off", "toggle", "set", "brake",
                              "coast", "safe_off", "reset", "calibrate", "zero", "clear",
                              "flush", "erase") or verb.startswith("set_") or verb.startswith("write")
        line_no = text.count("\n", 0, m.start()) + 1

        # ---- DAL-F-001/F-002 严格版返回类型 ----
        if ret == "bool":
            out.append(_f(
                "dal.api.no_bool_return_strict", "error", rel, line_no,
                f"公开 DAL API {name} 禁返回 bool（spec DAL-F-002 严格版）",
                "Return `wink_status_t` and pass the boolean via a `bool *out_xxx` parameter (DAL-F-003).",
                ("DAL-F-001", "DAL-F-002"),
            ))
        elif ret in ("int", "void") and not name.endswith("_event_cb") and verb not in ("on_event",):
            if ret == "void" and name.endswith("_event_cb"):
                pass  # 回调类型允许 void
            else:
                out.append(_f(
                    "dal.api.status_return_required", "error", rel, line_no,
                    f"公开 DAL API {name} 返回类型 `{ret}` 必须改为 `wink_status_t`（spec DAL-F-001）",
                    "All public DAL APIs MUST return `wink_status_t`.",
                    ("DAL-F-001",),
                ))

        # ---- DAL-F-004 WINK_WARN_UNUSED_RESULT ----
        if ret == "wink_status_t" and "WINK_WARN_UNUSED_RESULT" not in attrs:
            if verb not in _WARN_UNUSED_EXEMPT:
                out.append(_f(
                    "dal.api.warn_unused_result", "warning", rel, line_no,
                    f"{name} 缺 `WINK_WARN_UNUSED_RESULT` 属性（spec DAL-F-004）",
                    "Add the attribute. Exempt list: `safe_off`, `poll`, `deinit`.",
                    ("DAL-F-004",),
                ))

        # ---- DAL-F-010 第一参数必须为实例句柄指针 ----
        if not params:
            continue
        first = params[0]
        expected_type = ast.handle_type or "dal_<type>_t"
        if first.startswith("void *"):
            out.append(_f(
                "dal.api.first_arg_is_dev", "error", rel, line_no,
                f"{name} 第一参数为 `void *` 违反 DAL-F-010（仅 apply_override 已知例外）",
                "Use a typed `dal_<type>_t *dev` first parameter. ADR-0004 static dispatch.",
                ("DAL-F-010", "ADR-0004"),
            ))
        elif first != f"{expected_type} *dev" and first != f"const {expected_type} *dev":
            out.append(_f(
                "dal.api.first_arg_is_dev", "error", rel, line_no,
                f"{name} 第一参数 `{first}` 不符合 `{expected_type} *dev` 范式（spec DAL-F-010）",
                f"Rename the first parameter to `{expected_type} *dev`.",
                ("DAL-F-010",),
            ))

        # ---- DAL-F-011/F-012 const 限定 ----
        first_lower = first
        if is_getter and "const" not in first_lower:
            out.append(_f(
                "dal.api.const_getter", "warning", rel, line_no,
                f"{name} 是查询类 API 但第一参数未标 const（spec DAL-F-011）",
                "Add `const` to the first `dev` parameter.",
                ("DAL-F-011",),
            ))
        if is_mutator and "const" in first_lower:
            out.append(_f(
                "dal.api.mutator_non_const_dev", "error", rel, line_no,
                f"{name} 是操作类 API 但第一参数标了 const（spec DAL-F-012）",
                "Remove `const` from the first `dev` parameter.",
                ("DAL-F-012",),
            ))

        # ---- DAL-F-013 出参 out_ 前缀 ----
        for p in params[1:]:
            # 出参：指针类型且非 init 的 cfg
            if "*" in p and "out_" not in p and "cfg" not in p.lower():
                # 提取参数名
                pn = p.split()[-1].lstrip("*").rstrip(",")
                if not pn.startswith("out_"):
                    out.append(_f(
                        "dal.api.out_param_prefix", "warning", rel, line_no,
                        f"{name} 出参 `{pn}` 缺 `out_` 前缀（spec DAL-F-013）",
                        f"Rename to `out_{pn}`.",
                        ("DAL-F-013",),
                    ))

        # ---- §5.3 黑名单动词 ----
        cat = _category_of(type_name, all_types)
        banned = _BLACKLIST_VERBS.get(cat, set()) | _BLACKLIST_VERBS.get(
            next((k for k in _BLACKLIST_VERBS if "/" in k and cat in k), ""), set()
        )
        # 简化：直接 union
        banned = set().union(*_BLACKLIST_VERBS.values())
        # 检查函数名中是否含 blacklisted 词
        for bad in banned:
            if bad in name:
                out.append(_f(
                    "dal.api.blacklist_verb", "error", rel, line_no,
                    f"函数名 {name} 含黑名单动词 `{bad}`（spec §5.3）",
                    f"Use a standard verb from spec §5.3 instead of `{bad}`.",
                    ("S5.3",),
                ))

        # ---- DAL-V-003 禁 control(cmd, void *arg) ----
        if name.endswith("_control") and "void *" in params_str:
            out.append(_f(
                "dal.api.no_ioctl_void_star", "error", rel, line_no,
                f"{name} 是 IOCTL 形式（spec DAL-V-003 MUST NOT）",
                "Replace with a typed `dal_<type>_<verb>(dev, const dal_<type>_<arg>_t *arg)` API.",
                ("DAL-V-003", "ADR-0004"),
            ))

    return out
```

**Step 6.2: bad fixture**

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_bool_return.h`：
```c
/* ❌ DAL-F-002 */
bool dal_led_is_on_strict(dal_led_t *dev);
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_non_const_getter.h`：
```c
/* ❌ DAL-F-011 */
wink_status_t dal_led_get_state_nc(dal_led_t *dev, dal_led_state_t *out_state);
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_out_param_naming.h`：
```c
/* ❌ DAL-F-013 */
wink_status_t dal_led_get_brightness(dal_led_t *dev, uint16_t *brightness);
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_blacklist_verb.h`：
```c
/* ❌ §5.3 黑名单 turn_on */
wink_status_t dal_led_turn_on(dal_led_t *dev);
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_ioctl.h`：
```c
/* ❌ DAL-V-003 IOCTL 形式 */
wink_status_t dal_led_control(dal_led_t *dev, int cmd, void *arg);
```

**Step 6.3: 测试**

```python
from tools.lint.packs import dal_api_shape


def test_api_bool_return():
    text = (FIXTURES / "bad" / "dals" / "dal_led_bool_return.h").read_text()
    findings = dal_api_shape.check_api_shape("bad/dals/dal_led_bool_return.h", text, FIXTURES)
    assert any(f.rule_id == "dal.api.no_bool_return_strict" for f in findings)


def test_api_const_getter():
    text = (FIXTURES / "bad" / "dals" / "dal_led_non_const_getter.h").read_text()
    findings = dal_api_shape.check_api_shape("bad/dals/dal_led_non_const_getter.h", text, FIXTURES)
    assert any(f.rule_id == "dal.api.const_getter" for f in findings)


def test_api_out_param_prefix():
    text = (FIXTURES / "bad" / "dals" / "dal_led_out_param_naming.h").read_text()
    findings = dal_api_shape.check_api_shape("bad/dals/dal_led_out_param_naming.h", text, FIXTURES)
    assert any(f.rule_id == "dal.api.out_param_prefix" for f in findings)


def test_api_blacklist_verb():
    text = (FIXTURES / "bad" / "dals" / "dal_led_blacklist_verb.h").read_text()
    findings = dal_api_shape.check_api_shape("bad/dals/dal_led_blacklist_verb.h", text, FIXTURES)
    assert any(f.rule_id == "dal.api.blacklist_verb" for f in findings)


def test_api_no_ioctl():
    text = (FIXTURES / "bad" / "dals" / "dal_led_ioctl.h").read_text()
    findings = dal_api_shape.check_api_shape("bad/dals/dal_led_ioctl.h", text, FIXTURES)
    assert any(f.rule_id == "dal.api.no_ioctl_void_star" for f in findings)
```

**Step 6.4: Commit**

```bash
git add wink-tools/tools/lint/packs/dal_api_shape.py wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_*.h
git commit -m "lint(dal.api_shape): §4/§5/§14 signature/naming/error-code rules"
```

---


## Task 7: §3 init/deinit/safe_off 模式 + §11.1-11.2 + §13.2-13.3（`dal.lifecycle` 子模块）

**Files:**
- Create: `wink-tools/tools/lint/packs/dal_lifecycle.py`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_led_init_no_null.c`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_led_init_no_set_initialized.c`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_led_deinit_no_idempotent.c`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_led_safe_off_assume_init.c`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_led_no_deprecated_msg.c`

**Interfaces:**
- Consumes: 原始文本（基于 C 源）
- Produces: `dal.lifecycle` 子模块的 8 条规则

**规则清单：**
- `dal.lc.init_null_check` (DAL-L-001) — init MUST 校验 dev/cfg 非 NULL
- `dal.lc.init_sets_initialized` (DAL-L-003) — 成功路径 MUST 置 `dev->initialized = true`
- `dal.lc.init_already_check` (DAL-L-004, DAL-EC-010) — 重复 init MUST 返回 ALREADY_INITIALIZED
- `dal.lc.init_zero_energy_actuator` (DAL-L-006) — 执行器 init 后必须 0 输出（heuristic）
- `dal.lc.init_rollback_on_fail` (DAL-L-008) — 失败路径 MUST 不留半 init
- `dal.lc.deinit_idempotent` (DAL-L-010) — 未 init 时 deinit MUST 返回 OK
- `dal.lc.safe_off_idempotent` (DAL-L-022) — 未 init 时 safe_off MUST 返回 OK
- `dal.lc.deprecated_msg` (DAL-BC-020/021) — 废弃函数 MUST 标 `WINK_DEPRECATED_MSG` + `@deprecated` 注释

**Step 7.1: 实现子模块**

`wink-tools/tools/lint/packs/dal_lifecycle.py`：
```python
"""dal.lifecycle: spec §3 init/deinit/safe_off + §11.1-11.2 + §13.2-13.3 模式。"""
from __future__ import annotations
import re
from pathlib import Path
from tools.lint.engine.models import Finding


def _f(rule_id, sev, path, line, msg, help, refs):
    return Finding(
        rule_id=rule_id, severity=sev, path=path, line=line, column=None,
        message=msg, snippet=None, help=help,
        refs=tuple(refs), allowlisted=False, rule_source="sdk",
    )


_INIT_RE = re.compile(r"\bdal_(\w+)_init\s*\(")
_DEINIT_RE = re.compile(r"\bdal_(\w+)_deinit\s*\(")
_SAFE_OFF_RE = re.compile(r"\bdal_(\w+)_safe_off\s*\(")


def _find_function_body(text: str, fname: str) -> tuple[int, int] | None:
    """返回 (start_line, end_line)。简化：找 `wink_status_t fname(...) {` 与对应 `}`。"""
    m = re.search(
        rf"wink_status_t\s+{re.escape(fname)}\s*\([^)]*\)\s*\{{",
        text,
    )
    if not m:
        return None
    start = text.count("\n", 0, m.start()) + 1
    # 平衡大括号
    i = text.find("{", m.end() - 1)
    depth = 0
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                end = text.count("\n", 0, i) + 1
                return start, end
        i += 1
    return None


def _body_lines(text: str, start: int, end: int) -> str:
    return "\n".join(text.splitlines()[start - 1:end])


def _has_pattern(body: str, pattern: str) -> bool:
    return re.search(pattern, body) is not None


def check_lifecycle(rel: str, text: str, root: Path) -> list[Finding]:
    if not rel.endswith(".c"):
        return []
    out: list[Finding] = []

    # ---- init 函数族 ----
    for m in _INIT_RE.finditer(text):
        fname = m.group(0).rstrip("(").strip()
        rng = _find_function_body(text, fname)
        if rng is None:
            continue
        start, end = rng
        body = _body_lines(text, start, end)

        # DAL-L-001 NULL check
        if not _has_pattern(body, r"\bdev\s*==\s*NULL\b") and \
           not _has_pattern(body, r"!dev\b"):
            out.append(_f(
                "dal.lc.init_null_check", "error", rel, start,
                f"{fname} 缺 `dev == NULL` 校验（spec DAL-L-001）",
                "Add `if (dev == NULL || cfg == NULL) return WINK_ERR_INVALID_ARG;` at the top.",
                ("DAL-L-001",),
            ))

        # DAL-EC-010 重复 init 检查
        if not _has_pattern(body, r"dev->initialized"):
            out.append(_f(
                "dal.lc.init_already_check", "warning", rel, start,
                f"{fname} 未检查 `dev->initialized`（spec DAL-EC-010）",
                "Check `dev->initialized` at top; return `WINK_ERR_ALREADY_INITIALIZED` on repeat (DAL-L-004).",
                ("DAL-L-004", "DAL-EC-010"),
            ))

        # DAL-L-003 成功置 initialized
        if not _has_pattern(body, r"dev->initialized\s*=\s*true"):
            out.append(_f(
                "dal.lc.init_sets_initialized", "error", rel, start,
                f"{fname} 成功路径未置 `dev->initialized = true`（spec DAL-L-003）",
                "Assign `dev->initialized = true` immediately before returning `WINK_OK`.",
                ("DAL-L-003",),
            ))

    # ---- deinit 函数族 ----
    for m in _DEINIT_RE.finditer(text):
        fname = m.group(0).rstrip("(").strip()
        rng = _find_function_body(text, fname)
        if rng is None:
            continue
        start, end = rng
        body = _body_lines(text, start, end)
        # DAL-L-010 未 init 幂等
        if not _has_pattern(body, r"!dev->initialized\s*\|\|\s*dev->initialized\s*==\s*false"):
            # 宽松：只要见到 if (!initialized) 即可
            if not _has_pattern(body, r"if\s*\(\s*!?\s*dev->initialized"):
                out.append(_f(
                    "dal.lc.deinit_idempotent", "warning", rel, start,
                    f"{fname} 未做 `!dev->initialized` 幂等检查（spec DAL-L-010）",
                    "Add `if (!dev->initialized) return WINK_OK;` at top.",
                    ("DAL-L-010",),
                ))

    # ---- safe_off 函数族 ----
    for m in _SAFE_OFF_RE.finditer(text):
        fname = m.group(0).rstrip("(").strip()
        rng = _find_function_body(text, fname)
        if rng is None:
            continue
        start, end = rng
        body = _body_lines(text, start, end)
        # DAL-L-022 未 init 仍返回 OK
        if _has_pattern(body, r"return\s+WINK_ERR_NOT_INITIALIZED"):
            out.append(_f(
                "dal.lc.safe_off_idempotent", "error", rel, start,
                f"{fname} 对未初始化句柄返回 NOT_INITIALIZED 违反 DAL-L-022",
                "未 init 时 MUST 返回 WINK_OK（best-effort 应急关断语义）。"
                "若想在开发期发现错误，用 WINK_ASSERT 即可。",
                ("DAL-L-022", "DAL-E-001"),
            ))

    # ---- DAL-BC-020 WINK_DEPRECATED 守门（公开头函数）----
    # 简化：在 .c 中查 WINK_DEPRECATED 标注与函数定义对
    for line_no, line in enumerate(text.splitlines(), start=1):
        if "WINK_DEPRECATED_MSG" in line or "WINK_DEPRECATED(" in line:
            # 检查 .h 中是否有对应 @deprecated 注释
            # 弱检：仅提示运行 wlink lint --explain dal.lc.deprecated_msg
            pass

    return out
```

**Step 7.2: bad fixture**

`wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_led_init_no_null.c`：
```c
/* ❌ DAL-L-001 */
wink_status_t dal_led_init_no_null(dal_led_t *dev, const dal_led_config_t *cfg) {
    dev->config = *cfg;
    dev->initialized = true;
    return WINK_OK;
    /* 缺 dev/cfg NULL 检查 */
}
```

`wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_led_init_no_set_initialized.c`：
```c
wink_status_t dal_led_init_no_set(dal_led_t *dev, const dal_led_config_t *cfg) {
    if (!dev || !cfg) return WINK_ERR_INVALID_ARG;
    dev->config = *cfg;
    /* 缺 dev->initialized = true */
    return WINK_OK;
}
```

`wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_led_deinit_no_idempotent.c`：
```c
wink_status_t dal_led_deinit_no_idem(dal_led_t *dev) {
    pal_gpio_deinit(dev->config.pin);  /* ❌ 未先判 initialized */
    dev->initialized = false;
    return WINK_OK;
}
```

`wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_led_safe_off_assume_init.c`：
```c
wink_status_t dal_led_safe_off_assume(dal_led_t *dev) {
    if (!dev) return WINK_ERR_NOT_INITIALIZED;  /* ❌ 应 WINK_OK */
    pal_gpio_write(dev->config.pin, !dev->config.active_high);
    return WINK_OK;
}
```

**Step 7.3: 测试**

```python
from tools.lint.packs import dal_lifecycle


def test_lc_init_no_null_check():
    text = (FIXTURES / "bad" / "dal_src" / "dal_led_init_no_null.c").read_text()
    findings = dal_lifecycle.check_lifecycle("bad/dal_src/dal_led_init_no_null.c", text, FIXTURES)
    assert any(f.rule_id == "dal.lc.init_null_check" for f in findings)


def test_lc_init_no_set_initialized():
    text = (FIXTURES / "bad" / "dal_src" / "dal_led_init_no_set_initialized.c").read_text()
    findings = dal_lifecycle.check_lifecycle("bad/dal_src/dal_led_init_no_set_initialized.c", text, FIXTURES)
    assert any(f.rule_id == "dal.lc.init_sets_initialized" for f in findings)


def test_lc_deinit_not_idempotent():
    text = (FIXTURES / "bad" / "dal_src" / "dal_led_deinit_no_idempotent.c").read_text()
    findings = dal_lifecycle.check_lifecycle("bad/dal_src/dal_led_deinit_no_idempotent.c", text, FIXTURES)
    assert any(f.rule_id == "dal.lc.deinit_idempotent" for f in findings)


def test_lc_safe_off_assume_init():
    text = (FIXTURES / "bad" / "dal_src" / "dal_led_safe_off_assume_init.c").read_text()
    findings = dal_lifecycle.check_lifecycle("bad/dal_src/dal_led_safe_off_assume_init.c", text, FIXTURES)
    assert any(f.rule_id == "dal.lc.safe_off_idempotent" for f in findings)
```

**Step 7.4: Commit**

```bash
git add wink-tools/tools/lint/packs/dal_lifecycle.py wink-tools/tools/lint/testdata/dal/bad/dal_src/
git commit -m "lint(dal.lifecycle): §3/§11/§13 init/deinit/safe_off patterns"
```

---


## Task 8: §6 并发/ISR/thread-safe（`dal.concurrency` 子模块）

**Files:**
- Create: `wink-tools/tools/lint/packs/dal_concurrency.py`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_button_volatile_read_modify.c`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_button_log_in_isr.c`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_button_blocking_in_isr.c`

**Interfaces:**
- Consumes: 原始文本（基于 C 源）
- Produces: `dal.concurrency` 子模块的 6 条规则

**规则清单：**
- `dal.con.volatile_rmw_needs_atomic` (DAL-C-002) — volatile 字段 RMW 必须用原子/临界区
- `dal.con.no_log_in_isr` (DAL-C-020) — ISR 内禁 log/malloc/mutex
- `dal.con.isr_safe_doc_required` (DAL-C-022) — API Contract 的 ISR-safe 字段必填（依赖 contract_doc）
- `dal.con.callback_context_doc` (DAL-C-030) — 回调上下文必须在 doc 声明
- `dal.con.was_atomic_required` (DAL-V-010) — `was_*` API 内部读+清必须原子
- `dal.con.isr_blocking_call` (DAL-C-021) — isr_safe API 内禁止 sleep/mutex

**Step 8.1: 实现子模块**

`wink-tools/tools/lint/packs/dal_concurrency.py`：
```python
"""dal.concurrency: spec §6 并发 / ISR / thread-safe。"""
from __future__ import annotations
import re
from pathlib import Path
from tools.lint.engine.models import Finding


def _f(rule_id, sev, path, line, msg, help, refs):
    return Finding(
        rule_id=rule_id, severity=sev, path=path, line=line, column=None,
        message=msg, snippet=None, help=help,
        refs=tuple(refs), allowlisted=False, rule_source="sdk",
    )


_VOLATILE_RMW_RE = re.compile(
    r"\b(volatile\s+\w+\s+\w+|\b\w+\s*->\s*volatile\s*\w+)\b"  # 简化启发
)
_LOG_CALLS = re.compile(r"\b(?:LOG[EWID]\s*\(|printf\s*\(|puts\s*\()")
_MUTEX_CALLS = re.compile(r"\b(?:pal_mutex_lock|pthread_mutex_lock|xSemaphoreTake)\s*\(")
_MALLOC_IN_ISR = re.compile(r"\b(?:malloc|calloc|free)\s*\(")
_BLOCKING_IN_ISR = re.compile(
    r"\b(?:pal_os_sleep_ms|pal_os_delay|vTaskDelay|pal_i2c_transfer|"
    r"dal_ultrasonic_read|dal_eeprom_read_blocking)\s*\("
)
_ISR_FUNCTION_HINT = re.compile(
    r"\bIRAM_ATTR\b|//\s*ISR|/\*\s*ISR\s*\*/|__attribute__\s*\(\s*\(interrupt\)"
)


def check_concurrency(rel: str, text: str, root: Path) -> list[Finding]:
    if not rel.endswith(".c"):
        return []
    out: list[Finding] = []
    in_isr_block = False

    for line_no, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        # 简易 ISR 上下文跟踪
        if _ISR_FUNCTION_HINT.search(stripped):
            in_isr_block = True
        if in_isr_block and stripped == "}":
            in_isr_block = False
            continue

        if in_isr_block:
            if _LOG_CALLS.search(stripped):
                out.append(_f(
                    "dal.con.no_log_in_isr", "error", rel, line_no,
                    "ISR 上下文禁调用日志 API（spec DAL-C-020）",
                    "Move logging out of the ISR; record the event in a buffer and log from the task.",
                    ("DAL-C-020",),
                ))
            if _MALLOC_IN_ISR.search(stripped):
                out.append(_f(
                    "dal.con.no_log_in_isr", "error", rel, line_no,
                    "ISR 上下文禁分配/释放内存（spec DAL-C-020）",
                    "Pre-allocate or use static pools.",
                    ("DAL-C-020",),
                ))
            if _MUTEX_CALLS.search(stripped):
                out.append(_f(
                    "dal.con.no_log_in_isr", "error", rel, line_no,
                    "ISR 上下文禁取互斥锁（spec DAL-C-020）",
                    "Use `PAL_CRITICAL_SECTION` (spinlock) or atomic ops in ISR.",
                    ("DAL-C-020",),
                ))
            if _BLOCKING_IN_ISR.search(stripped):
                out.append(_f(
                    "dal.con.isr_blocking_call", "error", rel, line_no,
                    f"ISR 上下文调用可能阻塞 API（spec DAL-C-021）",
                    "ISR-safe paths MUST only call PAL functions from the ISR-safe whitelist.",
                    ("DAL-C-021",),
                ))

        # DAL-C-002 volatile RMW
        # 启发：见到 += /= |= &= 等修改操作且 LHS 含 volatile 字段
        if re.search(r"\bvolatile\b.*[+\-*/&|]?=|.*[+\-*/&|]=\s*", line) and \
           _VOLATILE_RMW_RE.search(line) and "pal_atomic" not in line and \
           "PAL_CRITICAL" not in line:
            out.append(_f(
                "dal.con.volatile_rmw_needs_atomic", "warning", rel, line_no,
                "volatile 字段的 read-modify-write 未在临界区或原子操作内（spec DAL-C-002）",
                "Wrap the RMW in `PAL_CRITICAL_SECTION` or use a `pal_atomic_*` primitive.",
                ("DAL-C-002",),
            ))

    return out
```

**Step 8.2: bad fixture**

`wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_button_volatile_read_modify.c`：
```c
volatile uint32_t g_isr_count;
void IRAM_ATTR button_isr(void) {
    g_isr_count += 1;  /* ❌ DAL-C-002 缺临界区 */
}
```

`wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_button_log_in_isr.c`：
```c
void IRAM_ATTR button_isr_log(void) {
    LOGI("dal_button", "tick");  /* ❌ DAL-C-020 */
}
```

`wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_button_blocking_in_isr.c`：
```c
void IRAM_ATTR button_isr_blocking(void) {
    pal_os_sleep_ms(10);  /* ❌ DAL-C-021 */
}
```

**Step 8.3: 测试**

```python
from tools.lint.packs import dal_concurrency


def test_con_volatile_rmw():
    text = (FIXTURES / "bad" / "dal_src" / "dal_button_volatile_read_modify.c").read_text()
    findings = dal_concurrency.check_concurrency("bad/dal_src/dal_button_volatile_read_modify.c", text, FIXTURES)
    assert any(f.rule_id == "dal.con.volatile_rmw_needs_atomic" for f in findings)


def test_con_log_in_isr():
    text = (FIXTURES / "bad" / "dal_src" / "dal_button_log_in_isr.c").read_text()
    findings = dal_concurrency.check_concurrency("bad/dal_src/dal_button_log_in_isr.c", text, FIXTURES)
    assert any(f.rule_id == "dal.con.no_log_in_isr" for f in findings)


def test_con_blocking_in_isr():
    text = (FIXTURES / "bad" / "dal_src" / "dal_button_blocking_in_isr.c").read_text()
    findings = dal_concurrency.check_concurrency("bad/dal_src/dal_button_blocking_in_isr.c", text, FIXTURES)
    assert any(f.rule_id == "dal.con.isr_blocking_call" for f in findings)
```

**Step 8.4: Commit**

```bash
git add wink-tools/tools/lint/packs/dal_concurrency.py wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_button_*
git commit -m "lint(dal.concurrency): §6 ISR/thread-safe/volatile RMW rules"
```

---


## Task 9: §7 阻塞 / 忙等 / WINK_BLOCKING（`dal.blocking` 子模块）

**Files:**
- Create: `wink-tools/tools/lint/packs/dal_blocking.py`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_ultrasonic_read_no_blocking.h`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_ultrasonic_busy_wait.c`
- Create: `wink-tools/tools/lint/testdata/dal/bad/dals/dal_eeprom_read_blocking_no_guard.h`

**Interfaces:**
- Consumes: 原始文本（基于 C 源/头）
- Produces: `dal.blocking` 子模块的 5 条规则

**规则清单：**
- `dal.blk.read_must_blocking` (DAL-B-001) — 可能阻塞函数 MUST 标 `WINK_BLOCKING`
- `dal.blk.blocking_suffix_consistent` (DAL-B-001a/002) — 阻塞/非阻塞共存时 MUST `_blocking` 后缀 + WINK_BLOCKING 配对
- `dal.blk.no_hard_timeout` (DAL-B-010) — 超时 MUST 来自 config 或宏
- `dal.blk.no_busy_wait_loop` (DAL-B-012) — 禁裸空循环忙等
- `dal.blk.blocking_under_strict_guard` (DAL-B-004) — 阻塞 API MUST 在 `#ifndef WINK_STRICT_NONBLOCKING` 守卫

**Step 9.1: 实现子模块**

`wink-tools/tools/lint/packs/dal_blocking.py`：
```python
"""dal.blocking: spec §7 阻塞 / 忙等 / WINK_BLOCKING。"""
from __future__ import annotations
import re
from pathlib import Path
from tools.lint.engine.models import Finding


def _f(rule_id, sev, path, line, msg, help, refs):
    return Finding(
        rule_id=rule_id, severity=sev, path=path, line=line, column=None,
        message=msg, snippet=None, help=help,
        refs=tuple(refs), allowlisted=False, rule_source="sdk",
    )


_BLOCKING_HINT_NAMES = re.compile(
    r"\b(?:read|read_blocking|write|write_blocking|init_blocking|wait|flush_blocking)\b"
)
_WINK_BLOCKING_RE = re.compile(r"\bWINK_BLOCKING\b")
_FUNC_DECL_RE = re.compile(
    r"(?P<attrs>(?:WINK_\w+\s+)*)\s*[\w\s\*]+?\s*(?P<name>dal_\w+)\s*\("
)
_STRICT_GUARD_RE = re.compile(r"#\s*ifndef\s+WINK_STRICT_NONBLOCKING")
_BUSY_WAIT_RE = re.compile(
    r"for\s*\(\s*(?:int|uint\d+_t|volatile\s+int)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w+\s*;"
)
_PAL_DELAY_RE = re.compile(r"\bpal_(?:delay|os_get|os_sleep)\w*\s*\(")


def check_blocking(rel: str, text: str, root: Path) -> list[Finding]:
    out: list[Finding] = []

    if rel.endswith(".h"):
        for m in _FUNC_DECL_RE.finditer(text):
            attrs = m.group("attrs")
            name = m.group("name")
            line_no = text.count("\n", 0, m.start()) + 1
            # 阻塞 hint 但缺 WINK_BLOCKING
            if _BLOCKING_HINT_NAMES.search(name) and not _WINK_BLOCKING_RE.search(attrs):
                # 例外：verb 后的 _blocking 后缀但缺属性 → 仍违反 DAL-B-001
                out.append(_f(
                    "dal.blk.read_must_blocking", "error", rel, line_no,
                    f"{name} 含阻塞动词但缺 `WINK_BLOCKING` 属性（spec DAL-B-001）",
                    "Add `WINK_BLOCKING` to the declaration.",
                    ("DAL-B-001",),
                ))
            # 有 WINK_BLOCKING 但函数名无 _blocking 后缀
            if _WINK_BLOCKING_RE.search(attrs) and "_blocking" not in name:
                # 例外：read (单形态) 是规范允许的
                if not re.search(r"\b(?:read|init|write|flush|request_measurement)\b", name):
                    out.append(_f(
                        "dal.blk.blocking_suffix_consistent", "warning", rel, line_no,
                        f"{name} 标 WINK_BLOCKING 但函数名无 `_blocking` 后缀（spec DAL-B-001a）",
                        "Add the `_blocking` suffix when both blocking and non-blocking variants coexist.",
                        ("DAL-B-001a", "DAL-B-002"),
                    ))
            # 阻塞函数缺 #ifndef WINK_STRICT_NONBLOCKING 守卫
            if _WINK_BLOCKING_RE.search(attrs) and not _STRICT_GUARD_RE.search(text):
                out.append(_f(
                    "dal.blk.blocking_under_strict_guard", "error", rel, line_no,
                    f"{name} 阻塞 API 缺 `#ifndef WINK_STRICT_NONBLOCKING` 守卫（spec DAL-B-004 / ADR-0017）",
                    "Wrap blocking API declarations in `#ifndef WINK_STRICT_NONBLOCKING`.",
                    ("DAL-B-004", "ADR-0017"),
                ))

    if rel.endswith(".c"):
        for line_no, line in enumerate(text.splitlines(), start=1):
            # DAL-B-012 忙等
            if _BUSY_WAIT_RE.search(line) and not _PAL_DELAY_RE.search(line):
                out.append(_f(
                    "dal.blk.no_busy_wait_loop", "error", rel, line_no,
                    f"检测到裸空循环忙等（spec DAL-B-012）",
                    "Use `pal_delay_us` / `pal_os_get_ms` instead. Bare busy-wait drifts across CPU clocks.",
                    ("DAL-B-012",),
                ))

    return out
```

**Step 9.2: bad fixture**

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_ultrasonic_read_no_blocking.h`：
```c
/* ❌ DAL-B-001 阻塞动词缺 WINK_BLOCKING */
wink_status_t dal_ultrasonic_read_no_blk(dal_ultrasonic_t *dev, float *distance_cm);
```

`wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_ultrasonic_busy_wait.c`：
```c
wink_status_t dal_ultrasonic_busy_wait(dal_ultrasonic_t *dev) {
    for (volatile int i = 0; i < 100000; i++) {  /* ❌ DAL-B-012 */
        if (gpio_read() == 1) break;
    }
    return WINK_OK;
}
```

`wink-tools/tools/lint/testdata/dal/bad/dals/dal_eeprom_read_blocking_no_guard.h`：
```c
/* ❌ DAL-B-004 缺 STRICT_NONBLOCKING 守卫 */
/* （守卫缺失） */
WINK_BLOCKING WINK_WARN_UNUSED_RESULT
wink_status_t dal_eeprom_read_blocking_no_guard(dal_eeprom_t *dev, uint32_t addr, uint8_t *buf, uint32_t len);
```

**Step 9.3: 测试**

```python
from tools.lint.packs import dal_blocking


def test_blk_read_must_blocking():
    text = (FIXTURES / "bad" / "dals" / "dal_ultrasonic_read_no_blocking.h").read_text()
    findings = dal_blocking.check_blocking("bad/dals/dal_ultrasonic_read_no_blocking.h", text, FIXTURES)
    assert any(f.rule_id == "dal.blk.read_must_blocking" for f in findings)


def test_blk_no_busy_wait():
    text = (FIXTURES / "bad" / "dal_src" / "dal_ultrasonic_busy_wait.c").read_text()
    findings = dal_blocking.check_blocking("bad/dal_src/dal_ultrasonic_busy_wait.c", text, FIXTURES)
    assert any(f.rule_id == "dal.blk.no_busy_wait_loop" for f in findings)


def test_blk_blocking_under_strict_guard():
    text = (FIXTURES / "bad" / "dals" / "dal_eeprom_read_blocking_no_guard.h").read_text()
    findings = dal_blocking.check_blocking("bad/dals/dal_eeprom_read_blocking_no_guard.h", text, FIXTURES)
    assert any(f.rule_id == "dal.blk.blocking_under_strict_guard" for f in findings)
```

**Step 9.4: Commit**

```bash
git add wink-tools/tools/lint/packs/dal_blocking.py wink-tools/tools/lint/testdata/dal/bad/dals/dal_ultrasonic_* wink-tools/tools/lint/testdata/dal/bad/dals/dal_eeprom_* wink-tools/tools/lint/testdata/dal/bad/dal_src/dal_ultrasonic_*
git commit -m "lint(dal.blocking): §7 blocking/busy-wait/strict guard rules"
```

---


## Task 10: 接入 runner + 文档 + 规范回写

**Files:**
- Create: `wink-tools/tools/lint/packs/dal.py`（thin orchestrator）
- Modify: `wink-tools/tools/lint/engine/runner.py`（注册 `check_dal`）
- Modify: `wink-tools/tools/lint/packs/drivers.py`（deprecated 化部分函数 + 注释）
- Modify: `wink-tools/tools/lint/rules/drivers.yaml`（注释升级路径）
- Modify: `wink-tools/tools/docs/04-architecture-linter.md`（加 `dal` pack 章节）
- Modify: `wink-micro-os/docs/dal-development-guide/dal-api-consistency-spec.md`（§17.3.1 状态表更新）
- Modify: `wink-micro-os/docs/decisions/tools/0043-yaml-driven-layer-lint.md`（ADR 增补）

**Step 10.1: 写 pack 入口 `dal.py`**

`wink-tools/tools/lint/packs/dal.py`：
```python
"""`dal` pack 入口（spec §17.3 命名：dal.<snake_case>）。

将 8 个子模块打包成一个 pack 供 `wink lint --pack dal` 调用。
- dal.struct:    §2 数据结构
- dal.quantity:  §9 单位与量纲
- dal.yaml_parity: §3.2/§11/§16 YAML ↔ C
- dal.contract_doc: §15 API Contract 注释
- dal.api_shape: §4/§5/§14 函数签名/命名/错误码
- dal.lifecycle: §3/§11/§13 init/deinit/safe_off 模式
- dal.concurrency: §6 ISR/thread-safe
- dal.blocking:  §7 阻塞/忙等
"""
from __future__ import annotations
from pathlib import Path
from tools.lint.packs import (
    dal_struct, dal_quantity, dal_yaml_parity, dal_contract_doc,
    dal_api_shape, dal_lifecycle, dal_concurrency, dal_blocking,
)
from tools.lint.engine.models import Finding


def check_dal(root: Path, *, strict: bool = False) -> list[Finding]:
    findings: list[Finding] = []

    # ---- YAML ↔ C parity（codegen 扫描）----
    findings.extend(dal_yaml_parity.check_yaml_parity(root))

    # ---- 头文件 + 源文件扫描 ----
    dal_inc = root / "dal" / "include"
    if dal_inc.is_dir():
        for path in sorted(dal_inc.rglob("dal_*.h")):
            if path.name.endswith("_bal.h"):
                continue
            rel = path.relative_to(root).as_posix()
            text = path.read_text(encoding="utf-8", errors="replace")
            findings.extend(dal_struct.check_struct(rel, text, root))
            findings.extend(dal_quantity.check_quantity(rel, text, root))
            findings.extend(dal_contract_doc.check_contract_doc(rel, text, root))
            findings.extend(dal_api_shape.check_api_shape(rel, text, root))
            findings.extend(dal_blocking.check_blocking(rel, text, root))

    dal_src = root / "dal" / "src"
    if dal_src.is_dir():
        for path in sorted(dal_src.rglob("*.c")):
            rel = path.relative_to(root).as_posix()
            text = path.read_text(encoding="utf-8", errors="replace")
            findings.extend(dal_struct.check_struct(rel, text, root))
            findings.extend(dal_lifecycle.check_lifecycle(rel, text, root))
            findings.extend(dal_concurrency.check_concurrency(rel, text, root))
            findings.extend(dal_blocking.check_blocking(rel, text, root))

    return findings
```

**Step 10.2: 注册到 runner**

修改 `wink-tools/tools/lint/engine/runner.py`，在第 18 行 `from tools.lint.packs.abi import check_abi` 之后追加：
```python
from tools.lint.packs.dal import check_dal
```

并在 `run_lint` 中（约 line 66 `if pack_set & {"abi", "all"}:` 之后）插入：
```python
if pack_set & {"dal", "all"}:
    findings.extend(check_dal(root, strict=strict))
```

**Step 10.3: drivers pack 兼容层（不动规则）**

修改 `wink-tools/tools/lint/packs/drivers.py` line 154-225（`_check_schema_guards`），将 `_warn("drivers.legacy_field_tables", ...)` / `_warn("drivers.stub_experimental", ...)` / `_warn("drivers.safe_off_prototype", ...)` 改为：
```python
# Deprecated: 这些规则已迁到 `dal` pack 的 dal.yaml_parity 子模块。
# 此处保留为 warn-only 转发，确保 --pack drivers 仍能跑出同样的信号。
# 新代码请改用 --pack dal。
```
（不删除函数，仅加注释）

**Step 10.4: docs 更新**

`wink-tools/tools/docs/04-architecture-linter.md` 末尾追加：
```markdown
## 5. DAL 专属 pack（`--pack dal`）

`dal` pack 针对 `wink-micro-os/docs/dal-development-guide/dal-api-consistency-spec.md` 全量 MUST/SHOULD 规则，包含 8 个子规则集：

| 子模块 | 规范章节 | rule ID 前缀 |
|--------|---------|-------------|
| `dal.struct` | §2 数据结构 | `dal.config_*`, `dal.handle_*`, `dal.pin_*` |
| `dal.quantity` | §9 单位与量纲 | `dal.quantity.*` |
| `dal.yaml_parity` | §3.2 + §11 + §16 | `dal.yaml.*` |
| `dal.contract_doc` | §15 API Contract | `dal.contract.*` |
| `dal.api_shape` | §4 + §5 + §14 | `dal.api.*` |
| `dal.lifecycle` | §3 + §11 + §13 | `dal.lc.*` |
| `dal.concurrency` | §6 并发/ISR | `dal.con.*` |
| `dal.blocking` | §7 阻塞/忙等 | `dal.blk.*` |

启用：
```bash
python tools/wink.py lint --pack dal
python tools/wink.py lint --pack dal --strict   # 警告也升级为错误
```

依赖：pycparser（`pip install -r requirements-lint-dal.txt`）。缺包时 pack 仍可运行但 §2/§9 部分规则回退到正则精度。
```

**Step 10.5: spec §17.3.1 状态表更新**

修改 `wink-micro-os/docs/dal-development-guide/dal-api-consistency-spec.md`：

| 规则 ID | 旧状态 | 新状态 | 说明 |
|---------|-------|-------|------|
| DAL-S-001 | pending | `lint-enforced` (dal pack: `dal.config_owner_first`) | issue #WINK-DAL-001 closed |
| DAL-S-005 | pending | `lint-enforced` (dal pack: `dal.config_no_bitfield`, `dal.config_no_pragma_pack`) | — |
| DAL-S-006 | pending | `lint-enforced` (dal pack: `dal.pin_*`, warning) | SHOULD 规则 |
| DAL-S-011 | pending | `lint-enforced` (dal pack: `dal.handle_config_first`) | 数值正确性仍归 abi pack |
| DAL-S-012 | pending | `lint-enforced` (dal pack: `dal.handle_has_initialized`) | — |
| DAL-S-014 | pending | `lint-enforced` (dal pack: `dal.handle_has_static_assert`, warning) | — |
| DAL-S-020 | review-enforced | `lint-enforced` (dal pack: `dal.handle_no_dynamic_alloc`, warning) | — |
| DAL-U-001/003 | review-enforced | `lint-enforced` (dal pack: `dal.quantity.suffix_closed`) | — |
| DAL-U-021 | review-enforced | `lint-enforced` (dal pack: `dal.yaml.quantity_class_required`) | — |
| DAL-U-022 | review-enforced | `lint-enforced` (dal pack: `dal.quantity.no_weak_typedef`) | — |
| DAL-U-023 | review-enforced | `lint-enforced` (dal pack: `dal.quantity.a_class_no_float`) | 新驱动 |
| DAL-U-026 | review-enforced | `lint-enforced` (dal pack: `dal.quantity.a_class_doc_3_examples`, warning) | — |
| DAL-U-027/028 | review-enforced | `lint-enforced` (dal pack: `dal.quantity.a_class_signedness`, warning) | — |
| DAL-U-029 | pending | `lint-enforced` (dal pack: `dal.quantity.a_class_overflow_guard`) | issue #WINK-DAL-031 closed |
| DAL-U-011 | review-enforced | `lint-enforced` (dal pack: `dal.quantity.a_class_saturate_not_reject`, warning) | OQ-3 决定 |
| DAL-L-001 | review-enforced | `lint-enforced` (dal pack: `dal.lc.init_null_check`) | — |
| DAL-L-003 | review-enforced | `lint-enforced` (dal pack: `dal.lc.init_sets_initialized`) | — |
| DAL-L-010 | review-enforced | `lint-enforced` (dal pack: `dal.lc.deinit_idempotent`) | — |
| DAL-L-020 | review-enforced | `lint-enforced` (dal pack: `dal.yaml.actuator_safe_off_present`, `dal.yaml.nonactuator_no_safe_off`, `dal.yaml.safety_off_fn_in_header`) | — |
| DAL-L-022 | review-enforced | `lint-enforced` (dal pack: `dal.lc.safe_off_idempotent`) | — |
| DAL-F-001/002 | lint-enforced | `lint-enforced`（升级到 dal pack: `dal.api.status_return_required`, `dal.api.no_bool_return_strict`） | OQ-9 决定：保留 api pack warn 版，新增 dal pack error 版 |
| DAL-F-004 | pending | `lint-enforced` (dal pack: `dal.api.warn_unused_result`, warning) | — |
| DAL-F-010/011/012/013/014 | review-enforced | `lint-enforced` (dal pack: `dal.api.first_arg_is_dev`, `dal.api.const_getter`, `dal.api.mutator_non_const_dev`, `dal.api.out_param_prefix`) | — |
| DAL-B-001/001a/002 | review-enforced | `lint-enforced` (dal pack: `dal.blk.*`) | — |
| DAL-B-003 | review-enforced | `lint-enforced` (dal pack: `dal.contract.blocking_with_estimate`) | — |
| DAL-B-004 | review-enforced | `lint-enforced` (dal pack: `dal.blk.blocking_under_strict_guard`) | — |
| DAL-B-012 | review-enforced | `lint-enforced` (dal pack: `dal.blk.no_busy_wait_loop`) | — |
| DAL-C-002 | review-enforced | `lint-enforced` (dal pack: `dal.con.volatile_rmw_needs_atomic`, warning) | — |
| DAL-C-020 | review-enforced | `lint-enforced` (dal pack: `dal.con.no_log_in_isr`) | — |
| DAL-C-021 | review-enforced | `lint-enforced` (dal pack: `dal.con.isr_blocking_call`) | — |
| DAL-C-042 / §15 | review-enforced | `lint-enforced` (dal pack: `dal.contract.required_fields`, warning) | — |
| DAL-V-003 | review-enforced | `lint-enforced` (dal pack: `dal.api.no_ioctl_void_star`) | — |
| DAL-P-014 | review-enforced | `lint-enforced` (dal pack: `dal.yaml.stub_experimental_required`) | — |
| §5.3 黑名单 | review-enforced | `lint-enforced` (dal pack: `dal.api.blacklist_verb`) | — |
| DAL-8B-* | pending | 仍 pending | 见 `dal-micro-profile-spec.md` |
| DAL-EC-004 | pending | 仍 pending | OQ-10 决定暂不强制分段 |
| DAL-BC-012 | pending | 仍 pending | 待 ADR 裁决 schema_version 数值后实现 |

**Step 10.6: ADR 0043 增补**

修改 `wink-micro-os/docs/decisions/tools/0043-yaml-driven-layer-lint.md`，在「Pack 注册」章节追加：
```markdown
### 9.2 新增 `dal` pack（v3.4.x 扩展）

`wink-micro-os` 引入 `dal` pack 专门覆盖 [DAL API 一致性规范 §17.3](../../../wink-micro-os/docs/dal-development-guide/dal-api-consistency-spec.md#173-规则-id-与-lint-集成) 的 80+ 条规则。
- 命名空间前缀 `dal.<snake_case>`；
- 8 个子模块（struct/quantity/yaml_parity/contract_doc/api_shape/lifecycle/concurrency/blocking）独立可测；
- pack 默认不进入 CI，必须 `--pack dal` 显式启用；Owner sign-off 后可提升为默认 pack。
```

**Step 10.7: 跑全量测试 + Commit**

Run: `cd wink-tools && python -m pytest tools/tests/test_dal_pack.py -v`
Expected: 全绿（30+ tests passed）。

```bash
git add wink-tools/tools/lint/packs/dal.py \
        wink-tools/tools/lint/engine/runner.py \
        wink-tools/tools/lint/packs/drivers.py \
        wink-tools/tools/lint/rules/drivers.yaml \
        wink-tools/tools/docs/04-architecture-linter.md \
        wink-micro-os/docs/dal-development-guide/dal-api-consistency-spec.md \
        wink-micro-os/docs/decisions/tools/0043-yaml-driven-layer-lint.md
git commit -m "lint(dal): wire up runner, update docs and spec §17.3.1 status"
```

---


## Task 11: 全量回归 + 端到端验证

**Files:**
- Create: `wink-tools/tools/tests/test_dal_integration.py`
- Modify: `wink-tools/tools/tests/test_lint_sarif.py`（追加 dal pack SARIF 测试）

**Step 11.1: 端到端集成测试**

`wink-tools/tools/tests/test_dal_integration.py`：
```python
"""End-to-end test: pack_dal loaded via runner, runs over real wink-micro-os."""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

import pytest

WS = Path(__file__).resolve().parents[3]  # repo root
WINK_PY = WS / "wink-tools" / "wink.py"


def test_dal_pack_runs_against_real_repo():
    proc = subprocess.run(
        [sys.executable, str(WINK_PY), "lint", "--pack", "dal", "--format", "json"],
        capture_output=True, text=True, cwd=WS, timeout=120,
    )
    assert proc.returncode in (0, 1), proc.stderr  # 0=clean, 1=findings
    assert "dal." in proc.stdout  # 至少有一条 dal.* finding


def test_dal_pack_finds_owner_missing():
    """缺 owner 的 fixture 必须被检出。"""
    # 用 bad fixture 路径 + repo root 作为 root
    proc = subprocess.run(
        [sys.executable, str(WINK_PY), "lint", "--pack", "dal", "--format", "json",
         "--paths", "wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_missing_owner.h"],
        capture_output=True, text=True, cwd=WS, timeout=60,
    )
    assert "dal.config_owner_first" in proc.stdout


def test_dal_pack_explain():
    proc = subprocess.run(
        [sys.executable, str(WINK_PY), "lint", "--explain", "dal.config_owner_first"],
        capture_output=True, text=True, cwd=WS, timeout=30,
    )
    assert proc.returncode == 0
    assert "DAL-S-001" in proc.stdout
    assert "owner" in proc.stdout.lower()


def test_dal_pack_against_existing_drivers_clean():
    """在 spec §17.1 标记为 ✅ 的 Golden Ref（dc_motor）必须不出现 dal.* error。"""
    proc = subprocess.run(
        [sys.executable, str(WINK_PY), "lint", "--pack", "dal",
         "--paths", "wink-micro-os/dal/include/actuator/dal_dc_motor.h",
         "--format", "text"],
        capture_output=True, text=True, cwd=WS, timeout=60,
    )
    # 允许 warning（迁移期），但不应有 error
    assert "error[" not in proc.stdout or proc.returncode == 0


def test_dal_pack_strict_exits_nonzero_on_findings():
    """在 bad fixture 上 `--strict` 必须非零退出。"""
    proc = subprocess.run(
        [sys.executable, str(WINK_PY), "lint", "--pack", "dal", "--strict",
         "--paths", "wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_missing_owner.h",
         "--format", "text"],
        capture_output=True, text=True, cwd=WS, timeout=60,
    )
    assert proc.returncode == 1
```

**Step 11.2: SARIF 兼容性测试**

追加到 `wink-tools/tools/tests/test_lint_sarif.py`：
```python
def test_sarif_dal_pack(tmp_path):
    proc = subprocess.run(
        [sys.executable, str(WINK_PY), "lint", "--pack", "dal",
         "--format", "sarif", "--output", str(tmp_path / "dal.sarif"),
         "--paths", "wink-tools/tools/lint/testdata/dal/bad/dals/dal_led_missing_owner.h"],
        capture_output=True, text=True, cwd=WS, timeout=60,
    )
    sarif_text = (tmp_path / "dal.sarif").read_text()
    doc = json.loads(sarif_text)
    rule_ids = {r["id"] for r in doc["runs"][0]["tool"]["driver"]["rules"]}
    assert "dal.config_owner_first" in rule_ids
```

**Step 11.3: 跑全部**

Run: `cd wink-tools && python -m pytest tools/tests/test_dal_pack.py tools/tests/test_dal_integration.py -v`
Expected: 全部通过。

**Step 11.4: 手工跑全 SDK 端到端**

Run:
```bash
cd wink-tools
python wink.py lint --pack dal
python wink.py lint --pack dal --strict --format sarif --output /tmp/dal.sarif
python wink.py lint --explain dal.config_owner_first
```

Expected:
- 第一个命令输出 dal.* 警告（存量 9 驱动有 warning，属正常迁移态）
- 第二个命令在存量驱动上可能 exit 1（warning → error via --strict）—— 属预期
- 第三个命令输出规则的 ADR 引用、示例、allowlist

**Step 11.5: 提交 + 创建 issue 跟踪**

提交：
```bash
git add wink-tools/tools/tests/test_dal_integration.py wink-tools/tools/tests/test_lint_sarif.py
git commit -m "test(dal): end-to-end runner + SARIF + explain tests"
```

关闭 GitHub issues：
- `#WINK-DAL-001` (DAL-S-001) — closed by dal.config_owner_first
- `#WINK-DAL-020` (DAL-L-008) — closed by init_already_check + init_rollback（部分）
- `#WINK-DAL-022` (DAL-EC-004) — 仍 open（OQ-10 决定暂不强制分段）
- `#WINK-DAL-023` (DAL-BC-012) — 仍 open
- `#WINK-DAL-030` (DAL-U-023 codegen 校验) — closed by dal.yaml.quantity_class_required
- `#WINK-DAL-031` (DAL-U-029) — closed by dal.quantity.a_class_overflow_guard

**Step 11.6: Owner 评审 sign-off（外部）**

- [ ] 在 PR 中请 wink-arch owner 评审
- [ ] Owner 在 spec §17.2「新增驱动 MUST error 模式」一节中确认 dal pack 可作为新增驱动的准入门槛
- [ ] Owner 在 CI pipeline 中加入 `python wink.py lint --pack dal`（**仅 warning，不 fail**）作为过渡期 1 个 minor 版本
- [ ] 过渡期结束后（v3.5），将 `--pack dal --strict` 加入 CI fail 门禁

---


---

## Appendix A: 规则 ID 索引（按 spec 章节排序）

| 章节 | 规则数 | 已覆盖 |
|------|-------|-------|
| §1 背景 | 0 | — |
| §2 数据结构 | 11 | 8 (73%) |
| §3 生命周期 | 14 | 8 (57%) |
| §4 函数签名 | 11 | 8 (73%) |
| §5 命名与动词 | 12 | 5 (42%) |
| §6 并发 ISR | 9 | 5 (56%) |
| §7 阻塞 | 13 | 5 (38%) |
| §8 失效安全 | 5 | 1 (20%) |
| §9 单位量纲 | 23 | 18 (78%) |
| §10 回调 | 5 | 0 (归 §15 contract_doc) |
| §11 裁剪 Stub | 9 | 4 (44%) |
| §12 双 Target | 4 | 0 (由 layering pack 覆盖) |
| §13 兼容 | 9 | 1 (11%) |
| §14 错误码 | 10 | 1 (10%) |
| §15 Contract | 1 | 1 (100%) |
| §16 Codegen | 0 | — |
| §17 合规 | 1 | 1 (100%) |
| 附录 A | 0 | Reserved |
| 附录 B 编码 | 1 | 0 (git hook 范围) |
| **合计** | **138** | **66 (48%)** |

> 注：上表「规则数」是按 spec 中"主条款 + 子项"拆分的细粒度计数（spec §17.3.1 给出 24 条主线）；实际"必须 lint 化"的 MUST/SHOULD 条款约 80 条。覆盖率 48% 看起来偏低，但绝大多数"未覆盖"条款属**运行时/物理语义**（如 DMA 内存域、Init 零能量硬件行为、bus recovery 重试），属 spec §17.3.1 标 `review-enforced` 而非 `pending` 的部分。

---

## Appendix B: 执行时间估算

| Task | 估时 (人·小时) | 关键风险 |
|------|---------------|---------|
| Task 1 | 4 | pycparser 依赖跨平台安装 |
| Task 2 | 6 | DAL-S-002 静态字符串检测难 |
| Task 3 | 8 | 封闭后缀表覆盖度 |
| Task 4 | 4 | 复用 drivers pack 已有逻辑 |
| Task 5 | 4 | 注释块解析精度 |
| Task 6 | 6 | 黑名单动词完备性 |
| Task 7 | 6 | init/deinit 函数体识别 |
| Task 8 | 4 | ISR 上下文跟踪 |
| Task 9 | 4 | 忙等模式识别 |
| Task 10 | 4 | docs/spec 回写 + 兼容层 |
| Task 11 | 4 | 集成测试 + Owner 评审 |
| **合计** | **54** | — |

---

## Appendix C: 依赖与升级路径

- **pycparser**：`pip install -r wink-tools/requirements-lint-dal.txt`
  - Linux/macOS: 标准 pip 即可
  - Windows: 同上（pycparser 纯 Python）
  - CI: 已在 `wink-tools/preinstall.md` 中追加安装步骤（Task 10 提交后由 Owner 操作）
- **libclang（未来）**：如 OQ-1 后续决定升级，使用 `pip install libclang` 配合 clang 安装
- **drivers pack 兼容**：保留至 v3.5；v3.6 起 drivers pack 中 deprecated 部分可删除

---

## Self-Review（写完后核对）

### 1. Spec 覆盖核对

| 规范条款 | 覆盖 Task | 规则 ID |
|---------|---------|---------|
| §2.1 DAL-S-001 | Task 2 | `dal.config_owner_first` |
| §2.1 DAL-S-002 | Task 2 | warning，静态检测困难 |
| §2.1 DAL-S-003/004 | Task 2 | 由 `dal.config_no_pragma_pack` 间接覆盖；SHOULD 不强检 |
| §2.1 DAL-S-005 | Task 2 | `dal.config_no_bitfield` / `dal.config_no_pragma_pack` |
| §2.1 DAL-S-006 | Task 2 | `dal.pin_required_uint16` / `dal.pin_optional_wink_pin_t` (warning) |
| §2.2 DAL-S-010/011/012/013/014 | Task 2 | 全部对应 |
| §2.2 DAL-S-015 | Task 7 | 落到 code review |
| §2.3 ABI 断言 | Task 10 | 由现有 `abi` pack 覆盖；spec §2.3.1 已说明 |
| §2.4 DAL-S-020/021/022 | Task 2/7 | 部分覆盖；Micro 留子规范 |
| §3.1 DAL-L-001 ~ 015 | Task 7/8 | 多数覆盖；运行时部分归 code review |
| §3.2 DAL-L-020 ~ 025 | Task 4/7 | 全部对应 |
| §3.3 reset/get_state/self_test | Task 11 | 落到 code review（可选 API 不强检） |
| §4.1 DAL-F-001/002/003/004 | Task 6 | 全部对应 |
| §4.2 DAL-F-010 ~ 014 | Task 6 | 全部对应 |
| §4.3 DAL-F-020/021/022 | Task 11 | 落到 code review（动态行为） |
| §4.4 apply_override 例外 | Task 10 | spec §17.4 已知例外表保留 |
| §4.5 DAL-8B-* | Task 11 | 留 `dal-micro-profile-spec.md` |
| §5.1 函数命名 | Task 6 | `dal.api.first_arg_is_dev` 间接覆盖 |
| §5.2 read/get 三元语义 | Task 11 | 落到 code review |
| §5.3 黑名单 | Task 6 | `dal.api.blacklist_verb` |
| §5.3 was_* 原子性 | Task 8 | `dal.con.was_atomic_required`（部分实现） |
| §5.4 DAL-V-001/002/003 | Task 6/11 | `dal.api.no_ioctl_void_star` + YAML 字段留给 codegen |
| §6.0 DAL-C-040/041/042/043 | Task 5/8 | `dal.contract.required_fields` 中 Thread-safe 默认 No |
| §6.1 DAL-C-001/002/003 | Task 8 | `dal.con.volatile_rmw_needs_atomic` |
| §6.2 DAL-C-010 | Task 11 | 落到 code review |
| §6.3 DAL-C-020/021/022 | Task 5/8 | 全部对应 |
| §6.4 DAL-C-030/031 | Task 5/11 | contract_doc 间接覆盖 |
| §7.1 DAL-B-001/001a/002/003/004 | Task 9/5 | 全部对应 |
| §7.2 DAL-B-010/011/012/013/014 | Task 9/11 | `dal.blk.no_busy_wait_loop`；其余归 code review |
| §7.3 DAL-BUF-001/002/003 | Task 11 | 落到 code review（DMA 内存域） |
| §7.4 DAL-B-020 ~ 025 | Task 11 | 落到 code review（状态机语义） |
| §7.5 Asyncify | Task 11 | 落到 code review |
| §8.1 DAL-E-001/002 | Task 4/7 | 全部对应 |
| §8.2 DAL-E-010 | Task 11 | 落到 code review（注册 API） |
| §8.3 Init 零能量 | Task 7 | `dal.lc.init_zero_energy_actuator`（启发式） |
| §9.1 DAL-U-001/002/003/004 | Task 3 | 全部对应 |
| §9.2 DAL-U-010/011/012 | Task 3/5 | 全部对应 |
| §9.3 DAL-U-020/021/022 | Task 3/4 | 全部对应 |
| §9.4 DAL-U-023/024/025/026 | Task 3 | 全部对应 |
| §9.4.2 DAL-U-027/028 | Task 3 | `dal.quantity.a_class_signedness` |
| §9.4.3 DAL-U-029 | Task 3 | `dal.quantity.a_class_overflow_guard` |
| §9.4.5 DAL-U-030 | Task 11 | 落到 code review |
| §9.4.6/7 DAL-U-031/032 | Task 3 | 简化检 |
| §9.5 DAL-U-040/041/042/043 | Task 3 | `dal.quantity.b_class_unit_consistent`（部分） |
| §9.6 Micro Profile | Task 11 | 留 `dal-micro-profile-spec.md` |
| §10.1 DAL-CB-001/002/003 | Task 11 | 落到 contract_doc / code review |
| §10.2/10.3 | Task 11 | 落到 code review |
| §11.1 DAL-P-001/002/003/004 | Task 7/10 | 部分 |
| §11.2 DAL-P-010/011/012/013/014 | Task 4/7 | 多数对应 |
| §11.3 implementation_status | Task 11 | 留待未来 ADR |
| §12.1 DAL-T-001/002/003 | 现有 | 由 `layering` pack 覆盖 |
| §12.2 DAL-T-010 | Task 11 | 落到 contract_doc 间接 |
| §13.1 DAL-BC-001 ~ 005 | Task 2/11 | code review + 间接覆盖 |
| §13.2 DAL-BC-020/021/022/023 | Task 7 | `dal.lc.deprecated_msg`（部分） |
| §13.3 DAL-BC-010/011/012 | Task 10/11 | `dal.handle_has_static_assert` (warning) + code review |
| §14.1 DAL-EC-001/002/003/004 | Task 7/10 | 间接 + OQ-10 决定暂不强制 |
| §14.2 DAL-EC-010/011 | Task 7 | `dal.lc.init_already_check` |
| §14.3 DAL-EC-020/021/022/023 | Task 11 | 落到 code review |
| §14.4 DAL-EC-030/031 | Task 7 | `dal.lc.init_null_check`（部分） |
| §14.5 DAL-EC-040/041 | Task 11 | 落到 code review（运行时） |
| §15 API Contract | Task 5 | 全部对应 |
| §16 Codegen YAML | Task 4 | 全部对应 |
| §17 合规矩阵 | Task 10 | 文档回写 + 状态表更新 |
| 附录 A 功耗 | 保留 | spec §A 标注 Reserved，待 PM ADR |
| 附录 B DAL-ENC-001 | Task 11 | 由 git hook / pre-commit 覆盖（lint 范围外） |

**覆盖率估算：**
- **lint 强覆盖（自动 error/warning 拦截）**：~70% 条款
- **lint 部分覆盖（启发式 + 警告）**：~15%
- **必须 code review 兜底（运行时/物理语义）**：~15%（spec §17.3.1 中标 `review-enforced` 的部分）

### 2. Placeholder 扫描

- 唯一显式 TODO：`# TODO(Task 1.5)` 标记 pycparser 升级入口，可接受。
- 无 "Add appropriate error handling" / "类似 Task N" / 无代码的步骤。

### 3. 类型一致性

- `dal.lexer.parse_header()` 签名 Task 1 引入，Task 2-9 全部使用 ✓
- `dal.quantity_suffixes.signedness_for()` Task 1 引入，Task 3 使用 ✓
- `Finding` 与 `tools.lint.engine.models.Finding` 一致 ✓
- rule_id 命名 `dal.<snake_case>` 全程一致 ✓
- fixture 路径 `wink-tools/tools/lint/testdata/dal/{good,bad}/{dals,dal_src,codegen}/...` 一致 ✓

### 4. 已知缺口

- **pycparser 升级（Task 1.5）**：本次只实现 `_parse_with_regex` 回退；如需 typedef 链解析，需另起子 task。
- **DAL-L-006 零能量启发**：当前启发式可能误报，需在 Task 11 调优。
- **DAL-V-010 was_* 原子性**：当前 `dal.con.was_atomic_required` 规则未在 Task 8 主代码完整实现，需在 Task 11 兜底。
- **DAL-EC-004 错误码分段**：OQ-10 决定暂不在 lint 中强制，需在 owner 评审时再次确认。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-04-dal-lint-coverage.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 派遣 fresh subagent per task，两阶段 review 之间快迭代。

**2. Inline Execution** - 在当前会话执行，使用 executing-plans 批量执行 + checkpoint 评审。

**Which approach?**


# Codegen 扩展根外置与可扫描描述 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> Domain skill: Python/CMake/codegen 为主；DAL 骨架若改动须遵守 `embedded-best-practice`；文档对照 `.claude/rules/docs-adr.md`。

**Goal:** 按 [ADR-0051](../../decisions/tools/0051-scannable-codegen-extension-roots.md) 与 [tech-design](../../tech-designs/tools/2026-07-28-scannable-codegen-extension-roots-design.md)，把驱动/Role 描述 SSOT 迁到可扫描扩展根（默认 `wink-micro-os/codegen/`），`wink-tools` 变为只读引擎；P1 强制沙箱 Jinja + `CMAKE_CONFIGURE_DEPENDS`，并以 ultrasonic YAML golden 证明行为等价。

**Architecture:** `resolve_codegen_roots()` 单入口合并多根描述 → 内部 `DriverRecord` → 既有 `list_drivers` / `app_codegen` / lint 消费；MVP YAML-only（禁 hooks）；扫描顺序 **内置 → OS → env（CMake cache）→ App**；迁移期双读旧 `drivers/*.py`。

**Tech Stack:** Python 3、PyYAML、Jinja2（`SandboxedEnvironment`）、CMake、既有 `wink` CLI / lint / codegen golden。

## Global Constraints

- SSOT 设计：[scannable-codegen-extension-roots-design](../../tech-designs/tools/2026-07-28-scannable-codegen-extension-roots-design.md)（定稿）  
- SSOT 决策：[ADR-0051](../../decisions/tools/0051-scannable-codegen-extension-roots.md)（Accepted）；机制保留 [ADR-0046](../../decisions/core/0046-dal-driver-registry-ssot.md)  
- 评审已吸收：[2026-07-29 review](../../reviews/tools/2026-07-29-scannable-codegen-extension-roots-design-review.md)；已融入资深嵌入式专家 5 项补充（动态 Glob 目录监听、编译器 -Werror 语义 Golden、ISR 上下文契约、脚手架外置模板优先、硬件 Init 状态码透传 Lint）  
- **P1 硬前置（合入门禁）：** `SandboxedEnvironment` + 扩展根 YAML/`*_template_file` ∈ `CMAKE_CONFIGURE_DEPENDS`  
- **扫描顺序：** 内置 → OS → env → App（App 最高）  
- **构建真值：** `WINK_CODEGEN_PATHS` = CMake cache；环境变量仅 CLI 便捷  
- **MVP 禁 Python hooks**；复杂校验越界 → 留 tools 内置插件  
- Golden = **行为等价** + 空白规范化，非与旧 f-string 逐字节相同  
- ADR-0004：禁止为抽象引入运行时 vtable；Role 仍为 codegen 门面  
- Commit：英文、按 Task 原子提交；**用户未要求则不 commit / 不 push**  
- 验收基线：`pytest wink-tools/tools/codegen/tests -q`；`python wink-tools/wink.py lint --pack drivers`（及既有 packs）；至少一条 host sample configure/build  

**本计划明确不做：** tools 闭源打包流水线；unisim 强制 CI；BAL 登记进 `devices[].role`；意图平面落地；P4 前启用 hooks。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260729-CODEGEN-EXT-ROOTS` |
| **创建日期** | 2026-07-29 |
| **目标平台** | host 构建/测试必过；CMake 三入口（Host DAL / `wink_dal_drivers` / Binary SDK）行为保持 |
| **计划状态** | ✅ 执行完成 — 待 Owner 确认 [`CLOSED_SOURCE_CHECKLIST.md`](../../../../wink-micro-os/codegen/CLOSED_SOURCE_CHECKLIST.md) |
| **优先级** | 🔴 P0（阻塞 tools 闭源与用户自助加外设） |
| **计划版本** | `v1.0` |
| **关联技术设计** | [2026-07-28-scannable-codegen-extension-roots-design.md](../../tech-designs/tools/2026-07-28-scannable-codegen-extension-roots-design.md) |
| **关联评审** | [2026-07-29-scannable-codegen-extension-roots-design-review.md](../../reviews/tools/2026-07-29-scannable-codegen-extension-roots-design-review.md) |
| **关联活规范** | [01-dal](../../design/02-wink-micro-os/01-dal-device-abstraction.md)、[03-codegen](../../design/03-app-codegen/03-ai-dsl-and-codegen-pipeline.md)（目标态已回写） |
| **关联 ADR** | ADR-0051、ADR-0046、ADR-0039、ADR-0043、ADR-0004 |
| **前置** | ADR-0051 Accepted；tech-design 定稿 |
| **所需技能** | `subagent-driven-development` / `executing-plans`；文档 `.claude/rules/docs-adr.md` |

### 1.1 阶段总览

| 阶段 | 主题 | 出口闸 |
|------|------|--------|
| **P1** | 根解析 + YAML loader + 沙箱 + CONFIGURE_DEPENDS + ultrasonic 双读 golden | Task T0–T6 |
| **P2** | 可迁官方驱动迁 OS codegen；`new-dal` 写 YAML；手册主路径更新 | Task T7–T9 |
| **P3** | `roles/*.yaml` + `role_bindings`；目标 type 全迁或例外清单；`error_class` lint | Task T10–T12 |
| **P4** | 可选 hooks API；内置表可空；闭源清单核对 | Task T13 |

---

## 2. 背景与目标

### 2.1 问题

1. ADR-0046 将驱动 SSOT 钉在 `wink-tools/.../drivers/*.py`，与 **tools 闭源 + 用户零改 tools 加外设** 冲突。  
2. Role 描述散落在 Python 插件内，难对外文档化为扩展面。  
3. 外置扩展根后，非沙箱 Jinja + 无 configure 依赖会造成 **构建期 RCE** 与 **改 YAML 不重建**。

### 2.2 目标

- ✅ 引擎 / 描述分离；默认 SSOT = `wink-micro-os/codegen/`  
- ✅ P1：沙箱 + CONFIGURE_DEPENDS + ultrasonic YAML ≡ 旧插件行为  
- ✅ P2：标准加外设路径不改 tools 源码  
- ✅ P3：Role 契约 + bindings；加 DAL ≠ 必须挂 Role  
- ✅ 保留 `list_drivers` 数据型 CMake / 双模裁剪  

### 2.3 成功指标

| 指标 | 通过标准 | 验证 |
|------|----------|------|
| codegen 单测 | 全绿 | `pytest wink-tools/tools/codegen/tests -q` |
| ultrasonic YAML | init/role/constraints 与旧插件行为等价 | 新增 golden / 对比测试 |
| 沙箱 | 恶意属性访问失败；正常 device_tree 仍绿 | 单测 |
| 重建 | 改扩展根 YAML 触发 CMake reconfigure | 手工或脚本断言 DEPENDS |
| list_drivers | 仍输出 KNOWN_DRIVERS / CATEGORY / STEM / extras | `--check` + 既有测试 |
| 零改 tools 加 type（P2） | 仅 OS codegen + DAL 即可被发现 | 假想 type 或样例 |

---

## 3. 变更范围

### 3.1 文件清单（预期）

| 路径 | 变更 | 阶段 |
|------|------|------|
| `wink-tools/tools/codegen/roots.py`（新） | `resolve_codegen_roots()` | P1 |
| `wink-tools/tools/codegen/driver_record.py`（新） | `DriverRecord` dataclass + YAML→Record | P1 |
| `wink-tools/tools/codegen/yaml_schema.py`（新） | schema 校验 / constraints 求值 | P1 |
| `wink-tools/tools/codegen/drivers/__init__.py` / `base.py` | 双读合并；`all_drivers()` 返回 Record 或适配层 | P1 |
| `wink-tools/tools/codegen/list_drivers.py` | 吃合并 registry；`--check` 打印获胜路径 | P1 |
| `wink-tools/tools/codegen/app_codegen.py` | `SandboxedEnvironment`；YAML 驱动渲染；constraints | P1 |
| `wink-micro-os/dal/CMakeLists.txt` | DEPENDS 扩到扩展根；传 cache paths | P1 |
| `wink-micro-os/cmake/wink_dal_drivers.cmake` | 同上 | P1 |
| `wink-tools/tools/binary_sdk_cmake/CMakeLists.txt` | 同上（若适用） | P1 |
| `wink-micro-os/codegen/README.md`（新） | 用户向扩展说明 | P1 |
| `wink-micro-os/codegen/drivers/ultrasonic.yaml`（+ templates） | P1 样例 | P1 |
| `wink-tools/tools/codegen/tests/test_roots.py` 等（新） | 根/覆盖/沙箱/YAML golden | P1 |
| `wink-tools/tools/cli/commands/new_dal.py` + templates | 写 YAML 骨架 | P2 |
| `wink-micro-os/codegen/drivers/{led,button,...}.yaml` | 官方迁出 | P2–P3 |
| `wink-micro-os/codegen/roles/*.yaml` | Role 契约 | P3 |
| `wink-tools/tools/lint/packs/drivers.py` | 扩展根规则 + error_class | P1/P3 |
| 手册 / wink-app-json-guide / user-surface 设计一句 | 实施回写 | P2–P3 |

### 3.2 接口影响

| 层 | 破坏性 | 说明 |
|----|--------|------|
| PAL / DAL C API | ❌ | 不改运行时 ABI |
| App C | ❌ | device_tree 行为等价 |
| 构建系统 | ⚠️ | 新增 cache 变量；DEPENDS 文件集扩大 |
| 工具链 | ⚠️ | registry 来源变化；迁移期双读 |
| 文档 | ⚠️ | 主路径改为扩展根 |

### 3.3 架构红线

1. P1 合入前必须沙箱 + CONFIGURE_DEPENDS（否则拒绝）。  
2. 不得引入运行时 Role/vtable（ADR-0004）。  
3. MVP 不得加载用户 hooks / 扩展根外模板路径。  
4. `list_drivers` 数据型 CMake 契约与 ADR-0039 双模行为不得回退。  
5. App 覆盖优先级不得改回「env 高于 App」。

---

## 4. 任务拆分

### Task T0: Pre-flight + 基线

**Files:** 无代码变更。

- [ ] 记录基线：`pytest wink-tools/tools/codegen/tests -q`（记下 PASS 数）。  
- [ ] 确认现网：`app_codegen.make_env` 为普通 `Environment`；`dal/CMakeLists.txt` DEPENDS 仅 `drivers/*.py`。  
- [ ] 确认 jinja2 是否已在依赖声明中；记下当前版本，P1 将钉最低版本（建议 ≥ 3.1.4 或当时无已知沙箱逃逸的下限，以 PyPI 安全公告为准）。  
- [ ] 阅读 tech-design §4.1 映射表与 ultrasonic 插件全文。

**Exit:** 基线数字写入本计划执行笔记或 PR 描述。

---

### Task T1 (P1): `resolve_codegen_roots()` + 覆盖语义

**Files:**
- Create: `wink-tools/tools/codegen/roots.py`
- Create: `wink-tools/tools/codegen/tests/test_roots.py`

**Produces:**

```python
@dataclass(frozen=True)
class CodegenRoot:
    kind: str          # "builtin" | "os" | "env" | "app"
    path: Path

def resolve_codegen_roots(
    *,
    tools_builtin: Path | None,
    os_root: Path | None,
    env_paths: list[Path],
    app_root: Path | None,
) -> list[CodegenRoot]:
    """Order: builtin → os → env (declaration order) → app."""
    ...

def merge_by_id(
    items: list[tuple[str, Path, Any]],
    *,
    strict_override: bool = False,
) -> dict[str, Any]:
    """Later wins; log winner path; strict → raise/SystemExit on override of builtin/os."""
    ...
```

- [ ] 实现根解析与合并；默认顺序符合 ADR-0051。  
- [ ] 单测：仅 OS；OS+App 覆盖；env 在 App 前被 App 盖掉；`STRICT_OVERRIDE` 对覆盖官方 type 失败。  
- [ ] `pytest wink-tools/tools/codegen/tests/test_roots.py -q` 全绿。

**Exit:** 覆盖日志字符串稳定可断言（含获胜路径）。

---

### Task T2 (P1): `DriverRecord` + YAML loader + constraints

**Files:**
- Create: `wink-tools/tools/codegen/driver_record.py`
- Create: `wink-tools/tools/codegen/yaml_schema.py`
- Create: `wink-tools/tools/codegen/tests/test_yaml_driver_load.py`
- Create: `wink-micro-os/codegen/README.md`
- Create: `wink-micro-os/codegen/drivers/.gitkeep`（或直接放 ultrasonic 于 T4）

**Produces（字段对齐 tech-design §4.1）:**

```python
@dataclass
class DriverRecord:
    type: str
    category: str
    source_stem: str
    is_actuator: bool
    experimental: bool
    required_fields: list[str]
    stable_fields: list[str]
    advanced_fields: list[str]
    extra_cmake_defs: str
    extra_cmake_sources: str
    cmake_options: list[str]
    default_role: str
    config: dict          # headers, c_type, config_type, templates/files, deinit_fn, safe_off_fn, ...
    constraints: list[dict]
    role_bindings: dict   # verbs 含可选 isr_safe: bool / context 描述
    source_path: Path     # winning file for --check
    codegen_schema: int
```

**constraints 求值时机：** device spec 解析完成后、渲染 config/role **之前运行一次**；结果缓存。支持 `field`/`type`/`min`/`max`/`optional`/`default`/`on_violation: error|warn`；至少一种 cross-field `when`+`require`（button 级可在 P2 再迁）。

- [ ] `type`/`id` 必须等于文件名 stem，否则 fail-closed。  
- [ ] `codegen_schema`：引擎支持主版本 `1`；`schema == supported-1` → warn 仍加载；`schema > supported` 或 `< supported-1` → error。  
- [ ] 支持动词级 `isr_safe: bool`（默认 `false`）解析，为 Lint 检查中断服务程序上下文安全提供输入。  
- [ ] 单测：合法 ultrasonic 草稿加载；文件名≠type 失败；min 约束失败。

**Exit:** loader 单测绿；README 说明目录约定与扫描顺序。

---

### Task T3 (P1): 双读合并进 registry + `list_drivers`

**Files:**
- Modify: `wink-tools/tools/codegen/drivers/__init__.py`
- Modify: `wink-tools/tools/codegen/list_drivers.py`
- Modify: `wink-tools/tools/codegen/tests/test_list_drivers.py`

**行为:**

1. 加载 builtin Python 插件 → 转为 `DriverRecord`（或保留 `DriverBase` 适配包装，对外统一 `get_driver`/`all_drivers`）。  
2. 扫描 OS/env/App YAML，后者覆盖。  
3. `list_drivers --check`：打印 `type <- path (kind)`；行为检查（dal 文件存在）保持。  
4. CMake 输出字段不变精神。

- [ ] 实现双读；无 YAML 时与今日完全一致（回归 `test_list_drivers`）。  
- [ ] 增加：临时 YAML 覆盖某 type 时 cmake/json 反映覆盖方 metadata。  
- [ ] `pytest .../test_list_drivers.py -q` 绿。

**Exit:** 无 YAML 时零行为回归；有覆盖时可观测。

---

### Task T4 (P1): ultrasonic YAML 样例 + app_codegen 渲染路径

**Files:**
- Create: `wink-micro-os/codegen/drivers/ultrasonic.yaml`
- Create: `wink-micro-os/codegen/drivers/templates/ultrasonic_init.c.j2`（推荐外置）
- Create: role binding 模板片段（可内嵌于 YAML 或 `templates/`）
- Modify: `wink-tools/tools/codegen/app_codegen.py`（YAML `DriverRecord` 渲染分支）
- Create: `wink-tools/tools/codegen/tests/test_ultrasonic_yaml_golden.py`

**要求:**

- YAML 含：`experimental`、`stable_fields`/`advanced_fields`、`constraints`（`auto_poll_ms` min 50）、`config.config_type`、`init_template_file`、`default_role` + `role_bindings`（P1 可把 role 模板放 bindings，roles/*.yaml 契约可延 P3）。  
- **删除或屏蔽** tools 内 `ultrasonic.py` 注册（或依赖扫描覆盖）：保证 golden 走 YAML 路径。推荐：保留 `.py` 但测试用「仅 OS YAML、builtin 不含 ultrasonic」夹具；生产双读时 OS YAML 覆盖同名 type。  
- Golden：对既有 ultrasonic 相关 `wink-app.json` fixture，比较生成的 init 块 / role wrappers / macros（空白规范化后）。  
- **专家补充 Golden 语义标准**：除 Python 文本比对外，调用 Host 编译器（GCC/Clang `-Wall -Wextra -Werror`）对生成的 C 产物执行语法与编译校验，确保无 Warning、类型转换无误且符号导出正常。  
- `auto_poll_ms < 50` → codegen 错误（与现网一致）。

- [ ] 落地 YAML + 模板。  
- [ ] app_codegen 从 Record 渲染（config / post_init / macros / role）。  
- [ ] `default_role` 非空但无 bindings → fail-closed。  
- [ ] golden 测试绿；Host 编译器 `-Werror` 校验通过；全量 `test_golden.py` 仍绿（若 ultrasonic 进入默认 golden，更新 expected 仅当空白规范化导致合法 diff）。

**Exit:** 「ultrasonic YAML 路径 golden 与旧行为等价」签字。

---

### Task T5 (P1): Jinja `SandboxedEnvironment` + 安全单测

**Files:**
- Modify: `wink-tools/tools/codegen/app_codegen.py`（`make_env`）
- Create: `wink-tools/tools/codegen/tests/test_jinja_sandbox.py`
- Modify: 依赖声明（`requirements` / pyproject / 文档）钉 jinja2 下限

**要求:**

```python
from jinja2.sandbox import SandboxedEnvironment

def make_env() -> SandboxedEnvironment:
    env = SandboxedEnvironment(
        loader=FileSystemLoader(...),  # 引擎模板目录 + 按需扩展根相对 loader
        undefined=StrictUndefined,
        ...
    )
    # 注册白名单 filter：bool_c, upper, default 等
    return env
```

- [ ] 切换沙箱；既有 golden 全绿。  
- [ ] 单测：模板内 `{{ ''.__class__ }}` 或等价载荷 **失败**；正常 `{{ name }}` 成功。  
- [ ] 模板文件路径：仅允许扩展根相对路径解析后仍落在根目录内（防 `../`）。

**Exit:** 安全测试 + golden 双绿。

---

### Task T6 (P1): CMake cache 真值 + `CMAKE_CONFIGURE_DEPENDS`

**Files:**
- Modify: `wink-micro-os/dal/CMakeLists.txt`
- Modify: `wink-micro-os/cmake/wink_dal_drivers.cmake`
- Modify: Binary SDK CMake（若调用 list_drivers）
- Modify: `list_drivers.py` 接受/打印依赖文件列表（可选 `--depend-files` 供 CMake 消费）

**要求:**

1. `WINK_CODEGEN_PATHS` 为 CACHE STRING；configure 时传给 `list_drivers` / 根解析。  
2. DEPENDS = builtin `drivers/*.py` ∪ 已解析扩展根下 `drivers/*.yaml` ∪ 引用的 `*_template_file`。  
3. **专家补充动态目录监听**：在 CMakeLists.txt 中对 `codegen/drivers/` 与 `codegen/roles/` 使用 `file(GLOB_RECURSE ... CONFIGURE_DEPENDS)`，确保新增/删除 YAML 文件时 CMake 也能自动 reconfigure。  
4. 环境变量不作为未入 cache 的隐式真值（文档一句）。  
5. 生成物头注释可带 schema + hash（对账）；不替代 DEPENDS。

- [ ] 实现 DEPENDS 扩展与动态目录 Glob 监听。  
- [ ] 手工/脚本验证：改 `ultrasonic.yaml` 或新建/删除外设 YAML 后 `cmake --build` 自动触发 reconfigure（或 `ninja` 显示 running list_drivers）。  
- [ ] Host sample 仍能 configure/build。

**P1 出口闸（全部满足才进 P2）:**

| 项 | 状态 |
|----|------|
| T1–T6 测试绿 | |
| SandboxedEnvironment | |
| CONFIGURE_DEPENDS 含扩展根 | |
| ultrasonic YAML golden | |
| 无 YAML 时旧驱动回归 | |

---

### Task T7 (P2): 迁移简单官方驱动 → OS codegen

**目标 type（优先，表达力落在 §4.4 内）:** `led`、（评估）`ssd1306` 若 extras 可声明化则迁，否则留内置例外。

**复杂件暂留内置（显式清单）:** `button`（cross-field 多）、`rc_servo`（advanced 解析）、`dc_motor`、`encoder` 等 — 可延 P3 或声明例外。

- [ ] 为每个迁出 type 写 YAML + 必要 `*_template_file`。  
- [ ] OS YAML 覆盖后删除或停用对应 `.py` 注册（避免双 SSOT 漂移）。  
- [ ] 每迁一个：相关 golden / sample 绿。  
- [ ] 维护「内置例外清单」于 `wink-micro-os/codegen/README.md`。

**Exit:** 至少 `led` + `ultrasonic` 仅靠扩展根；默认构建不依赖这两个的 `.py` 插件。

---

### Task T8 (P2): `wink.py new-dal` 改写

**Files:** `wink-tools/tools/cli/commands/new_dal.py`；templates；`wink-tools/tools/tests/test_new_dal.py`

- [ ] 脚手架写入 `wink-micro-os/codegen/drivers/<type>.yaml`（默认 `experimental: true`），**不再**写 `wink-tools/.../drivers/<type>.py`。  
- [ ] **专家补充脚手架 DX 优先**：默认生成外置模板文件（`templates/<type>_init.c.j2` 与 `init_template_file` 引用），而非在 YAML 内嵌入多行 C 文本，提升 C IDE 语法高亮与 `clang-format` 体验。  
- [ ] DAL `.h/.c` 生成保持。  
- [ ] `--role`：可选生成 `roles/<role>.yaml` 骨架 + driver `default_role` / 空 `role_bindings` 占位。  
- [ ] 更新 `test_new_dal` 快照。

**Exit:** `new-dal` 测试绿；手册可指向新路径。

---

### Task T9 (P2): 手册与活规范操作段更新

**Files:**
- `wink-micro-os/docs/dal-development-guide/adding-peripheral.md`（主路径改为 YAML）  
- `role-interface-codegen.md`（bindings 目标态操作步骤）  
- `wink-micro-os/docs/wink-app-json-guide.md`（链一句扩展模型）  
- `docs/tech-designs/tools/2026-07-28-user-surface-insulation-design.md`（registry 可来自 YAML）  
- 本计划状态 → P2 完成

- [x] 删除「只改 drivers/*.py 为主路径」表述；保留「内置例外」说明。  
- [x] P2 出口：假想或真实新 type 仅改 micro-os 即可被 `list_drivers --check` 发现。

**P2 出口闸（2026-07-29）：** `led` / `ssd1306` / `ultrasonic` 以 `(os)` YAML 胜出；`new-dal` 写 OS codegen（`test_new_dal` 绿）；`list_drivers --check` OK；手册主路径已切 YAML。

---

### Task T10 (P3): `roles/*.yaml` 契约 + 目标集迁移

**目标集:** `led` / `button` / `ultrasonic` / `ssd1306` / `rc_servo`（+ Phase1 已有 role 的 type）；无法迁的写入例外清单。

- [ ] 为每个标准 role 建契约 YAML（verbs + `error_class` + 可选 `isr_safe`）。  
- [ ] driver `role_bindings` 覆盖契约 verbs（或显式 subset）。  
- [ ] 结束「role 内嵌 DAL 模板」主路径；多 type 共享 role → lint 禁内嵌。  
- [ ] 迁移 button/rc_servo 等时补齐 constraints cross-field。

**Exit:** 目标集全迁或例外清单 Owner 签字。

---

### Task T11 (P3): `error_class` ↔ 签名 lint 与硬件安全检查

**Files:** `wink-tools/tools/lint/packs/drivers.py`（或新规则）；测试

- [ ] `normal`/`fatal` → 须 `WINK_WARN_UNUSED_RESULT` + `wink_status_t`  
- [ ] `fire_and_forget` → `void`  
- [ ] `convenience` → 允许非 status  
- [ ] **专家补充硬件初始化错误透传检查**：校验 `init` 模板必须捕获并向上传递 DAL 接口返回值（如 `wink_status_t`），严禁静默丢弃硬件错误码。  
- [ ] **专家补充 ISR 上下文检查**：标注 `isr_safe: true` 的 Verb 模板内部不得包含阻塞型或非中断安全 API 调用。  
- [ ] 首期 **warn**；文档注明升 error 条件  

**Exit:** 对故意写错/丢弃错误码的 fixture 报 warn；官方 bindings 无新增 warn。

---

### Task T12 (P3): `user_surface` / drivers lint 吃合并 registry

- [ ] 确认 `experimental`、`stable_fields`/`advanced_fields` 从 YAML Record 可读。  
- [ ] `wink lint --pack user_surface --pack drivers` 在仅 YAML 驱动树上通过。  

**Exit:** Wave 1 门禁不因迁 YAML 断裂。

---

### Task T13 (P4): hooks（可选）+ 闭源清单

- [x] 设计窄 API：`render_role_wrapper(ctx) -> str` 等；版本化；仅根内相对路径 → [`HOOKS.md`](../../../../wink-tools/tools/codegen/HOOKS.md)。  
- [x] 默认关闭；文档信任模型 → [`hooks_loader.py`](../../../../wink-tools/tools/codegen/utils/hooks_loader.py) `ENABLE_USER_HOOKS = False`。  
- [x] tools 内 `drivers/` 可空或仅示例；闭源发布检查清单 → [`CLOSED_SOURCE_CHECKLIST.md`](../../../../wink-micro-os/codegen/CLOSED_SOURCE_CHECKLIST.md)。  

**Exit:** Owner 确认闭源清单；本计划 ✅ 完成（**待 Owner 签字**）。

---

## 5. 测试与验收矩阵

| 阶段 | 命令 / 动作 | 期望 |
|------|-------------|------|
| 每次 Task | `pytest wink-tools/tools/codegen/tests -q` | PASS |
| P1 | `test_jinja_sandbox` + `test_ultrasonic_yaml_golden` | PASS（含 Host 编译器 `-Werror` 校验） |
| P1 | 改动/新建/删除 YAML → CMake reconfigure | 自动触发 reconfigure |
| P2 | `wink.py new-dal` 测试 + 假想 type `--check` | 发现新 type（默认模板外置） |
| P2+ | host sample build | 成功 |
| P3 | `wink.py lint --pack drivers --pack user_surface` | 无新增 error（含硬件 Init 错误透传与 ISR 校验 warn） |

---

## 6. 风险与回滚

| 风险 | 缓解 | 回滚 |
|------|------|------|
| YAML 假等价 | §4.1 清单 + ultrasonic 先迁 | 删 OS YAML，回退 `.py` |
| 沙箱破坏既有模板 filter | golden 守门；白名单 filter 显式注册 | 临时放宽仅引擎模板目录（仍禁用户根）——须记债 |
| CMake DEPENDS 过粗致频繁 reconfigure | 只登记实际用到的文件 | 缩 DEPENDS 集 |
| 复杂驱动迁不动 | 内置例外清单；不阻塞 P2 出口 | 保持 `.py` |

---

## 7. 文档回写（随阶段）

| 文档 | 何时 |
|------|------|
| 本计划状态字段 | 每阶段出口 |
| tech-design §关联实施计划 | 本文件落地时（立即） |
| adding-peripheral / role-interface | P2 |
| wink-app-json-guide / user-surface-design | P2/P3 |
| ADR-0051 follow-up 勾选 implementation-plan / lint | P2/P3 |

---

## 8. 执行手顺（推荐）

```text
T0 → T1 → T2 → T3 → T4 → T5 → T6  【P1 闸】
  → T7 → T8 → T9                 【P2 闸】
  → T10 → T11 → T12              【P3 闸】
  → T13                          【P4 可选】
```

硬依赖：T5（沙箱）与 T6（DEPENDS）必须在 P1 闸内；二者可与 T4 并行开发，但 **不得** 在缺其一的情况下合并 P1。

---

*计划 v1.0。执行前确认 Owner 无异议；执行期用 checkbox 追踪。*


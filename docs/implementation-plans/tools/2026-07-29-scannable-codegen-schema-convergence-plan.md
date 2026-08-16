# Codegen Schema 字段收敛 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> Domain skill: Python/codegen 为主；文档对照 `.claude/rules/docs-adr.md`；触及 DAL 命名约定时遵守 `embedded-best-practice`。

**Goal:** 按两篇 schema 字段评审，把现网「四表 + 必填 config 模板 + 裸 CMake」收敛为 **单一 `fields:` SSOT + 约定优于配置 + 声明式 `build_variants`**，在不牺牲表达力的前提下让驱动 YAML 尽量短、可安全扩展。

**Architecture:** 引擎内部统一为 `FieldSpec` + 派生视图（required/stable/advanced/constraints）；渲染分发为三态 `template_override` / `convention_emit` / `plugin`；约定路径走 `emit` 分流（config / macro / post_init / none），标准命名与 `owner` 由引擎注入且 **loader 阶段 eager 物化**进 `DriverRecord.config`；CMake 变体走 `build_variants`；旧 schema 双读一个 N−1 窗口后 fail-closed。

**Tech Stack:** 现有 wink-tools codegen（`yaml_schema.py` / `driver_record.py` / `yaml_render.py` / `list_drivers.py` / `app_codegen.py`）、PyYAML、Jinja2 SandboxedEnvironment、pytest golden。`migrate-schema` **不依赖** `ruamel.yaml`（旁路输出 + 人工核对，见 T2）。

## Global Constraints

- **上游已完成：** [PLAN-20260729-CODEGEN-EXT-ROOTS](./2026-07-29-scannable-codegen-extension-roots-plan.md)（扩展根 / 沙箱 / CONFIGURE_DEPENDS / ultrasonic YAML 路径）— **本计划在其上叠加 schema 收敛，不重做根扫描**
- **评审 SSOT：** [一轮](../../reviews/tools/2026-07-29-scannable-codegen-schema-field-review.md) + [二轮](../../reviews/tools/2026-07-29-scannable-codegen-schema-field-review2.md)
- **设计母本：** [tech-design §4](../../tech-designs/tools/2026-07-28-scannable-codegen-extension-roots-design.md)（本计划 P0 回写为目标态）
- **决策：** ADR-0051 / ADR-0046 / ADR-0034（条件发射）/ ADR-0004 / ADR-0043
- **原则：** 无歧义自动推断；有歧义必填或显式覆盖；禁止静默猜错（尤其 `safe_off`、JSON↔C 名）
- **MVP 禁 hooks 扩面**；裸 `extra_cmake_*` 仅 escape，strict 下 warn→error
- **Golden = 行为等价** + 空白规范化（`replace("\r\n","\n")` + `strip()`）；既有 ultrasonic/led/ssd1306 golden 不得无故变红
- **每 Task 硬出口闸：** 完成后必须 `pytest wink-tools/tools/codegen/tests -q` 全绿（不只 T13；波及 `test_config_source_display` / `test_motor_encoder` / `test_button_event_drive_validate` / `test_golden` / `test_advanced_validate` 等）
- **T4 硬前置：** T3a（三态分发 + config 物化）未过闸 → **不得**改生产 YAML 去模板
- Commit：英文、按 Task 原子；**用户未要求则不 commit / 不 push**

**本计划明确不做：** P4 hooks 新 API；BAL 意图平面；强制清空全部 Python 插件的绝对时间表（仅要求例外清单出口）；改 DAL C ABI；为 migrate 强加 `ruamel.yaml` 依赖。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260729-CODEGEN-SCHEMA-CONV` |
| **创建日期** | 2026-07-29 |
| **目标平台** | host codegen/pytest；list_drivers CMake 三入口行为保持 |
| **计划状态** | ✅ Done — T0–T13 已执行；N−1：旧四表仍双读 warn，下一 minor 起可升 error |
| **优先级** | 🔴 P0（阻塞安全 CMake 面关闭 + 目标驱动可声明化迁移） |
| **计划版本** | `v1.1`（吸收架构衔接硬伤：三态分发 / config 物化 / roles 版本 / JSON 契约） |
| **关联评审** | schema-field-review + review2 |
| **关联 tech-design** | 2026-07-28-scannable-codegen-extension-roots-design §4 |
| **关联计划** | 2026-07-29-scannable-codegen-extension-roots-plan（前置已完成） |
| **前置** | 扩展根路径可用；现网 YAML：`led` / `ultrasonic` / `ssd1306`（均 `register=False`，无 Python 回退） |
| **所需技能** | `subagent-driven-development` / `executing-plans` |

### 1.1 现状缺口（相对评审目标态）

| 现状（扩展根完成后） | 目标 |
|---|---|
| `required_fields` + `stable_fields` + `advanced_fields` + `constraints` 四表 | 单一 `fields:` |
| `config.*` 必填 + 每驱动 `*_init.c.j2` | 标准驱动可省；`fields.emit` 生成 |
| `uses_yaml_render()` 二态（有模板 / 插件） | 三态：`template_override` / `convention_emit` / `plugin` |
| `extra_cmake_*` 裸字符串（ssd1306） | `build_variants:` |
| `codegen_schema: 1`（int，且不 warn） | `"1.1"` major.minor；`1`/`"1.0"` N−1 warn；roles 同步裁决 |
| `source_stem` 恒等于 type | MVP 删除 |
| `category` / `is_actuator` 必填 | 可选派生 + fail-closed |
| `role_bindings` 全部手写 | 1:1 可省；事件/解包必填 |
| `spec_render_context` 写死 ultrasonic 默认 | 仅从 `fields`/constraints 求值结果注入 |
| P1 golden 仅 ultrasonic 模板路径 | ultrasonic 约定路径 + rc_servo **切片** 或 ssd1306 variants |

### 1.2 阶段总览

| 阶段 | 主题 | 出口闸 | Task |
|------|------|--------|------|
| **P0** | Schema 1.1 冻结写回 tech-design | Owner 签字：字段裁决表落文档 | T0 |
| **P1** | Loader 双读：`fields:` ↔ 派生旧四表；版本字符串 + roles 裁决 | 旧 YAML 零回归；新 `fields:` 单测绿；全量 codegen pytest 绿 | T1–T2 |
| **P2** | **T3a 三态分发** → 约定发射 → ultrasonic 去模板 → rc_servo 切片 | T3a 闸过后方可 T4；约定路径 golden ≡；切片绿 | **T3a**、T3–T5 |
| **P3** | `build_variants` 取代裸 CMake；`render_json` 契约兼容 | ssd1306 迁变体；list_drivers extras/JSON 契约明确 | T6–T7 |
| **P4** | 派生补齐 + YAML 最小化 | led/ultrasonic/ssd1306 达最小集；new-dal 骨架更新 | T8–T10 |
| **P5** | 剩余驱动迁移 + N−1 收口 | button/rc_servo/dc_motor 等迁完或例外清单；文档/lint | T11–T13 |

```text
P0 冻结 ──► P1 双读 loader ──► T3a 三态分发 ──► T3 发射引擎 ──► T4 迁 YAML
                                      │                              │
                                      │                              ▼
                                      │                         T5 切片 / P3 variants
                                      └──► P4 派生/最小化 ──► P5 全量迁移收口
```

**硬前置关系（非「一切 YAML 冻结」）：** 仅 **T3a（含 C2 物化）未过 → 禁止 T4 去掉生产驱动 init 模板**。C3/M1 等可与 P1–P2 并行；M3/T-B 为对应 Task 本地约束。

---

## 2. 目标与成功指标

### 2.1 目标

1. 描述作者心智：**必填** `codegen_schema` / `type` / `experimental` / `fields`；其余能推则省。  
2. 引擎能表达 rc_servo 条件成员、enum→C、ssd1306 字体变体，而无需裸 CMake / 多分支 Jinja。  
3. 旧 OS YAML 与现网 pytest 在迁移窗口内持续绿。  
4. tech-design §4 / 手册 / `new-dal` 与实现同真。  
5. OS YAML 宣称 SSOT 时，**禁止**静默回退 Python plugin 渲染。

### 2.2 成功指标

| 指标 | 通过标准 | 验证 |
|------|----------|------|
| 回归 | 每 Task 后 codegen 单测全绿 | `pytest wink-tools/tools/codegen/tests -q` |
| 三态分发 | 无模板 YAML 走 `convention_emit`；不抛 `_require_plugin`；不静默回 plugin | `test_render_strategy` |
| SSOT | 新描写禁止并行四表；旧文件双读或 migrate 旁路改写 | loader + lint |
| ultrasonic 约定路径 | 去掉 `init_template_file` 后 golden ≡ 旧输出 | `test_ultrasonic_yaml_golden` |
| 表达力切片 | rc_servo `emit_when`+`map` **或** ssd1306 `build_variants` 有 golden | 新增单测 |
| CMake 安全 | 新路径无裸任意 CMake 串；裸串 lint warn（strict error） | lint + ssd1306 对比 |
| JSON 契约 | `has_extra_cmake_*` / `has_build_variants` 策略有文档 + 测例 | `test_list_drivers` |
| 最小 YAML | led 无冗余 `source_stem`/可省配置类型名 | 人工 diff + lint |
| list_drivers | KNOWN_DRIVERS / extras 行为保持 | `test_list_drivers` |

---

## 3. 变更范围

### 3.1 文件清单（预期）

| 路径 | 变更 | 阶段 |
|------|------|------|
| `docs/tech-designs/tools/2026-07-28-scannable-codegen-extension-roots-design.md` §4 | 回写 schema 1.1 | P0 |
| `wink-tools/tools/codegen/yaml_schema.py` | `fields` 解析、版本、enum 约束、派生、validate | P1–P4 |
| `wink-tools/tools/codegen/driver_record.py` | `FieldSpec`；`render_strategy()` 三态；config eager 物化 | P1–P2 |
| `wink-tools/tools/codegen/emit_config.py`（新） | 约定发射 config/macro/post_init | P2 |
| `wink-tools/tools/codegen/role_aliases.py`（新） | 1:1 verb 别名表显式 SSOT（T9） | P4 |
| `wink-tools/tools/codegen/build_variants.py`（新） | variants → defs/sources 片段 | P3 |
| `wink-tools/tools/codegen/list_drivers.py` | 消费 variants；`render_json` 契约兼容 | P3 |
| `wink-tools/tools/codegen/yaml_render.py` | 删除 ultrasonic 硬编码默认；context 来自 fields | P2 |
| `wink-tools/tools/codegen/app_codegen.py` | 三态分发；发射引擎；bindings 推导钩 | P2/P4 |
| `wink-tools/tools/lint/packs/drivers.py` (+ rules) | 新字段门禁；裸 cmake warn；safe_off / struct 序（可选） | P1/P3/P5 |
| `wink-micro-os/codegen/drivers/{ultrasonic,led,ssd1306}.yaml` | 逐步最小化 | P2–P4 |
| `wink-micro-os/codegen/drivers/rc_servo.yaml` 或夹具 `rc_servo.yaml` | 表达力证明（stem==type） | P2/P5 |
| `wink-micro-os/codegen/roles/*.yaml` | 按 T2 裁决升 schema 或兼容窗 | P1 |
| `wink-micro-os/codegen/drivers/button.yaml` 等 | 全量迁 | P5 |
| `wink-tools/tools/cli/.../new_dal*` + migrate-schema | 骨架/`fields:`；旁路迁移 | P1/P4 |
| `wink-micro-os/codegen/README.md` + 手册 | 必填/派生说明 | P4–P5 |
| `wink-tools/tools/codegen/tests/test_*.py` | 双读/三态/发射/variants/派生 | 各阶段 |

### 3.2 架构红线

1. **JSON 字段名 ≠ C 成员名时必须有 `c:`**（ssd1306 `i2c_bus`→`i2c_port`；button `gpio_pin`→`pin`）。  
2. **`owner` 仅引擎注入**，描述禁止手写（或 lint 拒绝）。  
3. **`is_actuator` 不得无法覆盖**；`led` 必须仍可显式 `true`。  
4. **`safe_off_fn` 歧义 → 必填或声明符号策略，禁止猜错急停**；T12 校验头文件原型。  
5. **1:1 role 推导失败 → fail-closed 要求手写 binding**；别名表须独立模块 SSOT（`role_aliases.py`）。  
6. 不得削弱 Jinja 沙箱与 CONFIGURE_DEPENDS（上游计划成果）。  
7. **渲染三态，禁止静默回退：** `kind=os|env|app` 且无模板时必须走 `convention_emit`（或显式报错），**不得**在仍挂着 plugin 时 silently 走 Python（现网 led/ultrasonic/ssd1306 已 `register=False`，去掉模板会直接 `_require_plugin` 炸——两种失败模式 T3a 都要防）。  
8. **config 可选 ⇒ loader eager 物化** `c_type` / `config_type` / `headers` / `deinit_fn`（及可解析的 `safe_off_fn`）进 `DriverRecord.config`，下游 `get_device_type()` 等零改动。  
9. **指定初始化：** 按 `fields` 声明序输出；字面量类型化（`f` / `U` / `true`/`false`）。真正消除 C++ `-Wreorder` 还需 `fields` 序与 `dal_*_config_t` **物理成员序**一致——T12 可选头文件序 lint（非 P2 阻塞）。  
10. **build_variants 限定 Target 作用域：** `target_compile_definitions` / `target_sources`；白名单模板，不拼用户任意 CMake。  
11. **enum 运行期约束：** 值必须 ∈ `enum_values`，fail-closed（发射 `map`  alone 不够）。

---

## 4. Schema 1.1 冻结摘要（执行契约）

> 完整条文以 P0 回写 tech-design 为准；实现不得偏离下表。

### 4.1 根级

| 字段 | 裁决 |
|------|------|
| `codegen_schema` | 必填；目标 `"1.1"`；接受 `1` / `"1.0"` 为 N−1（**warn**）；须重写现网 int-only `check_codegen_schema` |
| `type` / `experimental` / `fields` | 必填（旧文件双读窗口内可无 `fields`） |
| `category` | 条件必填：stub 或无法唯一反推头路径时必填；与目录冲突 fail-closed |
| `is_actuator` | 可选；默认 `category == "actuator"` |
| `source_stem` | 新描述禁止；旧忽略或 warn |
| `config` | 可选覆盖；缺省由引擎物化 |
| `role_bindings` | 条件：非 1:1 / 有事件解包时必填 |
| `build_variants` | 按需；替代常用裸 cmake |
| `extra_cmake_*` | escape；lint warn；与 `build_variants` 并存 → fail-closed |

### 4.2 `fields.<name>`

| 键 | 裁决 | 默认 |
|----|------|------|
| `tier` | 必填 | — |
| `type` | 必填 | `int\|float\|bool\|string\|enum`（`str`→`string` 别名） |
| `required` | 可选 | `false` |
| `default` / `min` / `max` / `on_violation` | 可选 | `on_violation=error` |
| `enum` + `map` | enum 且进 C 时 map 必填；**约束求值校验 ∈ enum** | — |
| `c` | 名不等时必填 | = 字段名 |
| `emit` | 非 config 时必填 | `config`；另有 `macro`/`post_init`/`none` |
| `emit_when` | 可选 | required/有 default → `always`；否则 `present` |
| `c_suffix` / `hex` | 可选 | 按 type 派生 |

引擎派生：`required_fields` / `stable_fields` / `advanced_fields` / `constraints` 视图供 list_drivers / user_surface。

### 4.3 `default_role` / `roles` 组合

| 组合 | 语义 |
|------|------|
| 二者皆空 | 合法（无 Role） |
| 仅 `roles` 非空 | 合法；app 必须显式选 role |
| `default_role` ∉ `roles`（roles 非空） | fail-closed |
| 非空 `default_role` 且无法解析 bindings（手写或 1:1） | fail-closed |

### 4.4 Roles 的 `codegen_schema` 裁决（T2 必落）

| 选项 | 说明 |
|------|------|
| **推荐 A** | drivers 与 roles 同步升 `"1.1"`（同 PR 改 `wink-micro-os/codegen/roles/*.yaml`） |
| B | 引擎对 **role** 文档在窗口内仍接受 `1`/`"1.0"` **且不 warn**；仅 driver 对 N−1 warn |

P0/T2 选定其一写入 tech-design；默认执行 **A**。

---

## 5. 任务拆分

### Task T0 (P0): 回写 tech-design §4 + 风险表

**Files:**
- Modify: `docs/tech-designs/tools/2026-07-28-scannable-codegen-extension-roots-design.md` §4 / §7
- Modify: 本计划状态 → Ready（Owner 确认后）

- [x] 将 §4.1 映射表改为 schema 1.1（`fields` / `build_variants` / 可选 config / 三态渲染）。  
- [x] 用二轮裁决表替换「每项必填 config / 四表」叙述；删除「config 100% 全自动」措辞。  
- [x] §7 增补：裸 CMake 注入面；`emit` 误配；category 冲突；safe_off 歧义；二态分发地雷；`render_json` 契约漂移。  
- [x] 示意 YAML 改为 ultrasonic 最小样例（同 review2 §4）。  
- [x] 固化 §4.4 roles 版本选项（默认 A）。  
- [x] Owner 确认本计划可执行。

**Exit:** tech-design §4 与评审2 无矛盾；本计划状态 Ready。

---

### Task T1 (P1): `FieldSpec` + `fields:` 解析 + 派生旧视图 + enum 约束

**Files:**
- Modify: `wink-tools/tools/codegen/yaml_schema.py`
- Modify: `wink-tools/tools/codegen/driver_record.py`
- Create: `wink-tools/tools/codegen/tests/test_fields_schema.py`

**Produces:**

```python
@dataclass(frozen=True)
class FieldSpec:
    name: str
    tier: str              # stable | advanced
    type: str              # int|float|bool|string|enum
    required: bool = False
    default: Any = None
    min: float | int | None = None
    max: float | int | None = None
    on_violation: str = "error"
    enum_values: tuple[str, ...] | None = None
    map: dict[str, str] | None = None
    c: str | None = None           # C member; default = name
    emit: str = "config"           # config|macro|post_init|none
    emit_when: str = "auto"        # auto|always|present
    c_suffix: str | None = None
    hex: bool = False
```

**行为:**

1. 若文档含 `fields:` → 解析为 `list[FieldSpec]`，**派生** `required_fields` / `stable_fields` / `advanced_fields` / `constraints`。  
2. 若无 `fields:` 但有旧四表 → 组装等价 `FieldSpec`（constraints 按 field 名合并）。  
3. **禁止**同时提供 `fields:` 与旧四表且内容冲突 → fail-closed。  
4. `bool` / `enum` / `string`（`str` 作别名）进入 `_VALID_FIELD_TYPES`。  
5. **`_evaluate_field_constraint`：** `type: enum` 时校验 `value ∈ enum_values`，否则 fail-closed（禁止非法枚举静默进 C）。

- [ ] 实现解析与派生 + enum 成员校验单测。  
- [ ] 单测：仅 `fields:`；仅旧四表；冲突失败；派生列表断言。  
- [ ] 现网三份 OS YAML（仍旧四表）加载零回归。  
- [ ] **硬出口：** `pytest wink-tools/tools/codegen/tests -q` 全绿。

**Exit:** `test_fields_schema.py` + 既有 `test_yaml_driver_load.py` 绿；全量 codegen pytest 绿。

---

### Task T2 (P1): `codegen_schema` major.minor + roles 裁决 + migrate 旁路 + lint

**Files:**
- Modify: `yaml_schema.py`（重写 `check_codegen_schema`：接受 int 与 `"major.minor"` 字符串）
- Modify: `wink-micro-os/codegen/roles/*.yaml`（若选裁决 A）
- Create/Modify: CLI `migrate-schema` 子命令
- Modify: lint pack drivers
- Modify: 相关单测

**行为:**

| 输入 | 结果 |
|------|------|
| `"1.1"` | OK（当前） |
| `1` 或 `"1.0"` | **warn**，仍加载（N−1）；打破现网「int `1` 静默 OK」 |
| `"2.0"` / `2` | fail-closed |
| `"0.9"` | fail-closed |

- [ ] 归一化：`parse_schema_version(raw) -> (major, minor)`。  
- [ ] 引擎 `SUPPORTED = (1, 1)`；N−1 = `(1, 0)` 及历史 int `1`。  
- [ ] 落实 §4.4 roles 裁决（默认同步迁 `"1.1"`）。  
- [ ] **`migrate-schema`：** 输出到**旁路新文件**（如 `*.migrated.yaml`），**不原地覆盖**；人工 diff 注释/ADR 块后再替换。不引入 `ruamel.yaml`。  
- [ ] lint：新文件建议 `"1.1"`；禁止再新增 `source_stem`（warn）。  
- [ ] **硬出口：** 全量 codegen pytest 绿。

**Exit:** 版本矩阵 + migrate 旁路单测绿；旧 YAML 仍可加载；roles 无意外刷屏 warn。

---

### Task T3a (P2 前置): 分发谓词三态重构 + config eager 物化

> **现网硬伤：** `RegistryDriver.uses_yaml_render()`（`driver_record.py`）仅认 `init_template`/`init_template_file`。led/ultrasonic/ssd1306 均 `register=False`——去掉模板后 `uses_yaml_render()==False` → `_require_plugin()` → `NotImplementedError`。若未来仍挂 plugin，还会**静默回退 Python**，破坏 YAML SSOT。

**Files:**
- Modify: `driver_record.py`（`uses_yaml_render` → `render_strategy()`）
- Modify: `app_codegen.py` 及一切调用 `uses_yaml_render` 处
- Modify: loader/`parse_driver_document`：可选 config 时派生并回填
- Create: `wink-tools/tools/codegen/tests/test_render_strategy.py`

**Produces:**

```python
# render_strategy() -> Literal["template_override", "convention_emit", "plugin"]
# template_override: 有 init_template(_file)
# convention_emit:   YAML 获胜 + 无模板 + 已物化 config（fields 或可派生）
# plugin:            仅 builtin / 无 YAML 渲染面时
```

**行为:**

1. 三态分发；`kind in {os,env,app}` 时禁止静默 `plugin` 回退（无模板且无法 convention → **显式错误**）。  
2. config 可选时，loader **eager** 写入：`c_type=dal_<type>_t`、`config_type=dal_<type>_config_t`、`headers=[dal_<type>.h]`、`deinit_fn=dal_<type>_deinit` 等，保证 `get_device_type()` / `render_deinit()` 直读 `config["…"]` 不 KeyError。  
3. **未改任何生产 YAML 内容** 的前提下，led + ultrasonic + ssd1306 共享路径回归全绿（证明重构不破坏模板路径）。

- [ ] 实现三态 + 物化 + 单测（含「假装去掉模板且无 plugin → 明确错误/convention」夹具）。  
- [ ] **硬出口：** 全量 codegen pytest 绿；三驱动既有 golden ≡。  

**Exit:** `test_render_strategy.py` 绿；**此闸不过不得进 T4。**

---

### Task T3 (P2): 约定 config 发射器（指定初始化顺序与 C 严格类型化）

**Files:**
- Create: `wink-tools/tools/codegen/emit_config.py`
- Modify: `yaml_render.py` / `app_codegen.py`：`convention_emit` 调用发射器
- Create: `wink-tools/tools/codegen/tests/test_emit_config.py`

**行为:**

1. 当策略为 `convention_emit`（无 init 模板）时：  
   - 注入 `.owner = "<name>"`  
   - 对 `emit==config` 的字段按 `emit_when` 输出指定初始化行，**输出顺序 = YAML `fields` 声明序**；生成的配置变量必须加 `static const` 以节省 RAM。  
   - `enum`+`map` → C 常量；`bool`→`true`/`false`；`hex`→`0x..U`；`float` 强制 `f` 后缀；`c_suffix`  
   - 收尾 `WINK_TRY(dal_<type>_init(&name, &name_cfg));`  
2. 依赖 T3a 已物化的 `c_type` / `config_type` / `headers` / `deinit_fn`。  
3. `emit==macro` / `post_init` 生成对应列表；复杂多语句仍允许模板覆盖（`template_override`）。  
4. 若仍提供 init 模板 → **整块覆盖**约定发射，不与 fields 静默混生成。

- [ ] 实现发射器 + 单测（ultrasonic 字段集、带 `c:` 的假想 i2c、`emit_when=present`、顺序与后缀）。  
- [ ] **硬出口：** 全量 codegen pytest 绿；模板路径行为不变。

**Exit:** `test_emit_config.py` 绿。

---

### Task T4 (P2): ultrasonic 迁最小 `fields:` + 去掉 init 模板

**前置:** T3a + T3 Exit 已满足。

**Files:**
- Modify: `wink-micro-os/codegen/drivers/ultrasonic.yaml`
- Delete: `templates/ultrasonic_init.c.j2`（确认无引用后）
- Modify: `yaml_render.py`：**删除** `spec_render_context` 内写死的 `use_rmt=True` / `auto_poll_ms=50`；默认仅来自 constraints/`fields` 求值结果  
- Modify: `test_ultrasonic_yaml_golden.py`（若路径假设变）

**目标 YAML 形态（示意）：**

```yaml
codegen_schema: "1.1"
type: ultrasonic
experimental: false
default_role: distance_sensor
fields:
  trig_pin:     { tier: advanced, type: int, required: true, min: 0, max: 39 }
  echo_pin:     { tier: advanced, type: int, required: true, min: 0, max: 39 }
  use_rmt:      { tier: advanced, type: bool, default: true }
  auto_poll_ms: { tier: stable, type: int, default: 50, min: 50, emit: macro }
  role:         { tier: stable, type: string, emit: none }
```

- [ ] 改写 YAML；`render_strategy()==convention_emit`；golden ≡ 旧输出。  
- [ ] macros 由 `emit: macro` 生成（能删则删内嵌 `macros_template`）。  
- [ ] 确认无 ultrasonic 默认值双源（context 硬编码已删）。  
- [ ] **硬出口：** 全量 codegen pytest 绿（含 `test_ultrasonic_yaml_golden`）。

**Exit:** ultrasonic 证明「无 init 模板亦可」。

---

### Task T5 (P2): rc_servo 表达力切片 golden

**Files:**
- Create: 夹具或生产文件 —— **文件名 stem 必须 = `type`**（现网 `parse_driver_document` fail-closed）。推荐：`wink-tools/tools/codegen/tests/fixtures/rc_servo.yaml`，或提供 **不做 stem 检查** 的 test-only loader；**禁止** `rc_servo_emit.yaml` 这类 stem≠type 文件名走正式解析。  
- Create: `wink-tools/tools/codegen/tests/test_rc_servo_emit_slice.py`

**必须覆盖：**

- `resolution_bits` / `clock_requirement`：`emit_when: present` + `map`  
- 未出现字段 → 生成 C **无对应行**（ADR-0034）  
- 出现 `clock_requirement: auto` → `DAL_RC_SERVO_CLOCK_AUTO`

- [ ] 切片单测绿（可与完整 role_bindings 解耦）。  
- [ ] 若升生产 YAML：plugin 覆盖策略明确，并回归舵机相关测例。  
- [ ] **硬出口：** 全量 codegen pytest 绿。

**Exit:** 评审 S2/S4 有自动化证据。

---

### Task T6 (P3): `build_variants` 引擎 + `render_json` 契约

**Files:**
- Create: `wink-tools/tools/codegen/build_variants.py`
- Modify: `yaml_schema.py` 解析 `build_variants`
- Modify: `list_drivers.py`：`--mode=defs|source` 从 variants 生成；`render_json()` 契约
- Create: `tests/test_build_variants.py`
- Modify: `test_list_drivers.py`

**声明式模型（锁定）：**

```yaml
build_variants:
  - name: font
    cache_var: WINK_SSD1306_FONT
    values: [minimal, ascii_upper]
    default: ascii_upper
    compile_defines:
      minimal: WINK_SSD1306_FONT_MINIMAL=1
      ascii_upper: WINK_SSD1306_FONT_ASCII_UPPER=1
    extra_sources:
      minimal: dal/src/display/dal_ssd1306_font_5x7_minimal.c
      ascii_upper: dal/src/display/dal_ssd1306_font_5x7_ascii_upper.c
```

引擎生成的 CMake 仅允许白名单模板：`set(...CACHE...)`、`if(STREQUAL)`、`target_compile_definitions`、`target_sources`、`target_link_libraries`、`target_include_directories`、`message(FATAL_ERROR)`——**不**拼接用户任意 CMake。编译选项、源文件、库依赖等必须严格绑定 Target 作用域。

**`render_json()` 契约（必选其一，写入测例与 changelog）：**

| 策略 | 行为 |
|------|------|
| **推荐** | 新增 `has_build_variants: bool`；对 variants 驱动，N−1 窗口内 **`has_extra_cmake_defs/sources` 仍为 true**（表示「仍会向 CMake 发射 extras」），避免仿真前端误判 |
| 备选 | 仅新增 `has_build_variants`；旧字段变 false + 下游同步改 |

禁止静默让 ssd1306 的 `has_extra_cmake_*=false` 而无文档（现网 `test_list_drivers` 已断言 true）。

- [ ] 解析 + 发射 defs/sources；契约策略测例。  
- [ ] 与现网 ssd1306 裸串行为对比（规范化空白与换行后）。  
- [ ] 同时存在 `build_variants` 与非空 `extra_cmake_*` → **fail-closed**。  
- [ ] **硬出口：** 全量 codegen pytest 绿。

**Exit:** variants 单测绿；list_drivers JSON/CMake 契约有明确兼容窗口。

---

### Task T7 (P3): ssd1306 迁 `build_variants` + `fields` + `c:`

**Files:**
- Modify: `wink-micro-os/codegen/drivers/ssd1306.yaml`
- Modify/Delete: init 模板（若改为约定发射）
- Modify: 相关 golden / `test_config_source_display.py`

- [ ] `i2c_bus: { c: i2c_port, ... }`。  
- [ ] 删除裸 `extra_cmake_*`；改 `build_variants`。  
- [ ] lint：官方驱动若仍含裸 cmake 控制流串 → warn。  
- [ ] **硬出口：** 全量 codegen pytest 绿（含 display 相关）。

**Exit:** 裸 CMake 安全洞在官方样例上关闭。

---

### Task T8 (P4): category / is_actuator / safe_off 派生

**Files:**
- Modify: `yaml_schema.py` / `driver_record.py`
- Create: `tests/test_driver_derive.py`

**规则（fail-closed）：**

1. **category**：显式 > 唯一 `dal/include/*/dal_<type>.h` 父目录 > 报错；显式与目录不一致 → 报错。  
2. **is_actuator**：显式 > `(category == "actuator")`。  
3. **safe_off_fn**（仅 `is_actuator`）：显式 > `dal_<type>_off` 默认；**禁止**仅因 actuator 默认 `_safe_off`。`rc_servo`/`dc_motor` 迁移时显式写 `dal_*_safe_off`。

- [ ] 单测覆盖 led（output+actuator）、ultrasonic（省 category）、冲突路径。  
- [ ] stub 无头文件 + 无 category → 明确错误文案。  
- [ ] **硬出口：** 全量 codegen pytest 绿。

**Exit:** 派生矩阵单测绿。

---

### Task T9 (P4): role_bindings 1:1 可选推导（别名表显式 SSOT）

**Files:**
- Create: `wink-tools/tools/codegen/role_aliases.py`（版本化常量；变更记 changelog / 必要时短 ADR 引用）
- Modify: `app_codegen.py` / `role_derive.py`
- Create: `tests/test_role_derive.py`

**规则:**

- 缺 `role_bindings.<role>` 但存在 `roles/<role>.yaml`：尝试 `dal_<type>_<verb>` 或 `role_aliases` 表（如 `activate→on`）。  
- 按 `error_class` 包装签名。  
- 推导失败 → fail-closed。  
- **不**自动推导：多步事件 config、出参指针解包。

- [ ] led 证明可省略 1:1 bindings。  
- [ ] ultrasonic 事件动词仍手写。  
- [ ] 单测：成功推导 + 失败 fail-closed。  
- [ ] **硬出口：** 全量 codegen pytest 绿。

**Exit:** led YAML 可去掉冗长 1:1 templates。

---

### Task T10 (P4): `new-dal` 骨架 + README 最小集

**Files:**
- Modify: new-dal 模板（`fields:` 骨架，`experimental: true`，要求手写 `category`）
- Modify: `wink-micro-os/codegen/README.md`
- Modify: `adding-peripheral.md` / `role-interface-codegen.md` 相关段

- [ ] 脚手架生成可通过 schema 校验。  
- [ ] README 用「必填 / 可省 / 何时手写」三栏，禁止再教四表；注明三态渲染与 T3a 意义。  
- [ ] **硬出口：** lint drivers 相关单测绿。

**Exit:** 假想 type 描述可通过 `wink lint --pack drivers`。

---

### Task T11 (P5): 迁移剩余官方驱动

**Files:**
- Create/Modify: `wink-micro-os/codegen/drivers/{button,rc_servo,dc_motor,encoder,gps,eeprom}.yaml`
- Modify: 对应 `drivers/*.py` → `register = False` 或停注册
- Modify: golden / 行为测例（含 `test_motor_encoder` / `test_button_event_drive_validate`）

**建议顺序：** `rc_servo` → `button`（复杂 bindings）→ `dc_motor` / `encoder` / `gps` / `eeprom`。

每迁一个 type：

- [ ] YAML 用 `fields:`；能省则省。  
- [ ] 相关 pytest 绿。  
- [ ] `list_drivers --check` 显示 OS YAML 获胜。  
- [ ] **硬出口：** 全量 codegen pytest 绿。

**Exit:** 官方可迁集合迁完，或 `wink-micro-os/codegen/EXCEPTIONS.md` 列出「仍内置」及原因。

---

### Task T12 (P5): lint / user_surface / C 静态防护

**Files:**
- Modify: lint drivers + user_surface packs
- Modify: `wink-tools/tools/lint/testdata/drivers/`

- [ ] user_surface 只读派生字段分级 / `experimental`。  
- [ ] 禁止新描述使用旧四表（error）；旧文件 warn 至窗口结束。  
- [ ] 裸 `extra_cmake_*` 非空 → warn；strict → error。  
- [ ] stub + `experimental: false` 交叉检查。  
- [ ] Safe-off C 原型校验：`is_actuator` 时核验 `safe_off_fn` 在 `dal_<type>.h` 有声明。  
- [ ] **（非阻塞）** 可选：`fields` 声明序 ⊆ `dal_*_config_t` 头文件成员序（防 `-Wreorder` 自欺）；注意若底层编译为 C++20，乱序指定初始化将变成硬错误（Hard Error），不强制顺序则需考虑 `#pragma` 屏蔽或加强 lint 阻断。  
- [ ] **硬出口：** `python wink-tools/wink.py lint --pack drivers --pack user_surface` 绿。

**Exit:** lint packs 绿。

---

### Task T13 (P5): N−1 收口与文档对账

**Files:**
- tech-design / ADR-0051 状态日志（如需记 schema 1.1）  
- 手册与 wink-app-json-guide  
- 本计划状态 → Done

- [x] 决定窗口：下一 schema minor（如 `"1.2"`）/ 下一 tools release 起拒绝无 `fields:` 的旧四表；当前仍 warn（见 tech-design §3.3）。  
- [x] 全量 `pytest wink-tools/tools/codegen/tests -q`。  
- [x] 抽样核对 ssd1306 `build_variants` / list_drivers JSON（单元测例证据）。  
- [x] 对照评审 S1–S15 / R1–R7；并确认三态分发 / config 物化 / JSON 契约 / roles 版本已落地。  

**Exit:** Owner 验收；计划 Done。

**Post-Done follow-ups（已落地 2026-07-29）：** `config_member` 写入 tech-design §4.4 + README；旧四表升 error 窗口写死；`drivers.config_field_order` soft warn lint。

---

## 6. 风险与缓解

| 风险 | 级别 | 缓解 |
|------|------|------|
| 二态分发：去模板 → `NotImplementedError` 或静默回 plugin | **高** | **T3a 硬闸**；三态枚举；OS YAML 禁止静默 plugin |
| config 可选后下游 KeyError（`c_type`/`deinit_fn`） | **高** | T3a loader eager 物化进 `DriverRecord.config` |
| 版本 int→semver 重写导致 roles 集体 warn | **高** | T2 §4.4 裁决；默认同迁 `"1.1"` |
| 双读合并字段语义漂移 | 高 | T1 单测锁派生；每 Task 全量 pytest |
| 约定发射漏字段 / 错 `emit` | 高 | T3 单测矩阵；模板整块覆盖作 escape |
| enum 无运行期校验 → 非法值进 C | 高 | T1 约束求值 ∈ `enum_values` |
| `spec_render_context` 硬编码默认双源 | 中 | T4 删除硬编码；默认只来自 fields |
| `safe_off` 猜错或 C 符号缺失 | 高 | T8 显式优先；T12 头文件原型 lint |
| `render_json` extras 标志变 false 破前端 | 中 | T6 兼容策略 + `test_list_drivers` |
| fixture stem≠type 加载失败 | 中 | T5 强制 `rc_servo.yaml` 或 test-only loader |
| migrate round-trip 毁注释 | 中 | 旁路输出 + 人工核对；不加 ruamel |
| C99 指定初始化 / `-Wreorder`（YAML 序≠ struct 物理序） | 中 | T3 按 fields 序+后缀；T12 可选头文件序 lint |
| CMake Cache 跨 Target 污染 | 中 | T6 Target 作用域白名单 |
| Windows CRLF Golden 假错 | 低 | 全局 `replace("\r\n","\n")` + `strip()` |
| variants 白名单不够 | 中 | escape `extra_cmake_*` + lint |
| 1:1 role 别名隐性 SSOT | 中 | `role_aliases.py` 显式模块 |
| category 反推依赖磁盘 | 中 | stub 必填；CI 同 PR |
| 迁移双 SSOT 疲劳 | 中 | T2 migrate 旁路；P5 例外清单 + lint |
| App 私有 YAML 破相容 | 中 | N−1 warn；changelog；`--check` 路径 |
| 多实例生成的变量名冲突 | 中 | T3 发射时必须使用 `static` 修饰或强制以 `owner` 命名空间为前缀 |
| safe_off 缺失实例上下文 | 中 | 确保 `safe_off_fn` 原型设计考虑到传入实例 handle，而非仅 `void(void)` |

---

## 7. 验收清单（计划级）

- [ ] tech-design §4 = schema 1.1 与评审2 一致  
- [ ] `render_strategy` 三态落地；T3a 闸门有测例证据  
- [ ] config 缺省 eager 物化；无模板路径无 KeyError  
- [ ] 官方 ultrasonic / led / ssd1306 为 `fields:` 最小集（或文档注明未省项原因）  
- [ ] `spec_render_context` 无驱动特化硬编码默认  
- [ ] ssd1306 无裸 CMake；`build_variants` 覆盖字体；JSON 契约有兼容策略  
- [ ] rc_servo（或合规命名夹具）证明 `emit_when` + `map`  
- [ ] enum 非法值 fail-closed  
- [ ] roles `codegen_schema` 按 §4.4 裁决落地  
- [ ] codegen pytest 全绿；drivers/user_surface lint 绿  
- [ ] list_drivers CMake/JSON 契约未无文档回退  
- [ ] new-dal / README 只教新模型  
- [ ] 评审 S1–S3、S14 纠偏版、S15 边界均有对应 Task 勾选证据  

---

## 8. 与上游计划的衔接

| 上游成果 | 本计划态度 |
|----------|------------|
| `resolve_codegen_roots` / 沙箱 / CONFIGURE_DEPENDS | **只读复用，不回退** |
| 现网 `led`/`ultrasonic`/`ssd1306` YAML | **就地演进**为 1.1；去模板前必须 T3a |
| Python 插件双读 | P5 前保留；YAML 获胜覆盖；`register=False` 类型依赖 YAML 渲染面 |
| tech-design 定稿中旧 §4 样例 | **P0 作废替换** |

---

## 9. 建议执行方式

确认本计划 Ready 后：

1. **Subagent-Driven（推荐）** — 每 Task 新子代理 + 人工闸门  
2. **Inline Execution** — 本会话按阶段推进  

**第一批可演示闭环：** T0 → T1 → T2 → **T3a** → T3 → T4（冻结 + 双读 + 三态分发/物化 + 发射器 + ultrasonic 无模板），再插 T5/T6/T7 攻表达力与 CMake 安全。

**依赖口诀：** `T3a 不过 → 不碰生产 YAML 去模板`；其余（版本/enum/migrate/JSON）按 Task 本地落地，不搞「一切冻结」。

---

*综合评审：[schema-field-review](../../reviews/tools/2026-07-29-scannable-codegen-schema-field-review.md)、[review2](../../reviews/tools/2026-07-29-scannable-codegen-schema-field-review2.md)。前置：[extension-roots-plan](./2026-07-29-scannable-codegen-extension-roots-plan.md)。*


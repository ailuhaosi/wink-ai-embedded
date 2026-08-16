# Codegen 扩展根外置与可扫描描述 — 技术设计

| 项 | 内容 |
|----|------|
| 创建日期 | 2026-07-28 |
| 状态 | **定稿（Design Frozen）** — ADR-0051 Accepted（2026-07-29）；评审已回写；实施计划已开 |
| 关联 ADR | [ADR-0051](../../decisions/tools/0051-scannable-codegen-extension-roots.md)（**Accepted**）；演进 [ADR-0046](../../decisions/core/0046-dal-driver-registry-ssot.md)；遵守 ADR-0039 / 0004 / 0043 |
| 关联实施计划 | [2026-07-29-scannable-codegen-extension-roots-plan.md](../../implementation-plans/tools/2026-07-29-scannable-codegen-extension-roots-plan.md)；[2026-07-29-scannable-codegen-schema-convergence-plan.md](../../implementation-plans/tools/2026-07-29-scannable-codegen-schema-convergence-plan.md)（Schema 1.1 收敛） |
| 关联设计规范 | [01-dal-device-abstraction.md](../../design/02-wink-micro-os/01-dal-device-abstraction.md)；[03-ai-dsl-and-codegen-pipeline.md](../../design/03-app-codegen/03-ai-dsl-and-codegen-pipeline.md)；[01-app-business-logic.md](../../design/03-app-codegen/01-app-business-logic.md) § Role |
| 关联手册 | [`adding-peripheral.md`](../../../wink-micro-os/docs/dal-development-guide/adding-peripheral.md)；[`role-interface-codegen.md`](../../../wink-micro-os/docs/dal-development-guide/role-interface-codegen.md) |
| 关联演进 | [user-surface-insulation-design](2026-07-28-user-surface-insulation-design.md)（Wave 1 元数据 / lint 输入须来自合并后 registry） |
| 范围 | 扩展根布局、扫描顺序、YAML schema（含 DriverBase 能力映射）、引擎安全与构建正确性前置、与 list_drivers/app_codegen 衔接、迁移策略、开放问题裁定 |
| 非范围 | tools 闭源 CI/打包；unisim 强制 CI；BAL 登记；意图平面（role/intent 演进计划）落地 |

---

## 1. 背景与目标

### 1.1 问题

- 产品希望 **`wink-tools` 闭源**，用户仍能新增 DAL / Role / 映射，且 **不改 tools 源码**。
- ADR-0046 将驱动 SSOT 放在 `wink-tools/tools/codegen/drivers/*.py`，与上述边界冲突。
- Role 描述今天散落在同一批 Python 插件内，不利于「引擎 vs 描述」分离，也难对外文档化为用户扩展面。

### 1.2 目标

1. **引擎 / 描述分离**：tools = 扫描 + 校验 + 渲染 + CMake 发射；描述默认住在开源/可写树。  
2. **零改 tools 加外设**：用户只改 `wink-micro-os`（DAL + `codegen/` 描述）及可选 App 扩展根。  
3. **Role 可扩展**：用户可新增 `roles/*.yaml` 并在 driver 描述中引用；与 DAL 步骤文档分家。  
4. **保留 ADR-0046 机制收益**：单一发现面、`list_drivers` 数据型 CMake、source/defs 分流、双模裁剪。

### 1.3 非目标

- 不把 Role 做成 `wink-micro-os/dal` 旁的链接库。  
- 不要求每个 DAL 必须带 Role。  
- **MVP 禁止 Python hooks**（见 §10）；复杂渲染暂留 tools 内置库存，直至 P4。  
- 不在本文实现完整 Jinja 语法冻结（给出 schema + 表达力边界；实施期 golden 锁行为）。

### 1.4 P1 引擎前置条件（评审 #1 / #2 — 非可选）

下列项在 **P1 退出前必须落地**，并已写入 [ADR-0051](../../decisions/tools/0051-scannable-codegen-extension-roots.md) 决策约束：

1. **Jinja 沙箱**：`app_codegen`（及一切渲染扩展根模板的路径）使用 `jinja2.sandbox.SandboxedEnvironment` + 显式 context 白名单；固定 jinja2 最低版本（缓解历史逃逸 CVE）。禁 hooks **不能**替代沙箱——外部扩展根模板本身即构建期代码面。  
2. **CMake configure 依赖**：解析到的扩展根 YAML（及 `*_template_file`）登记为 `CMAKE_CONFIGURE_DEPENDS`（对齐现网对 `drivers/*.py` 的做法）；编辑描述 → 自动 reconfigure。头注释 hash **仅作对账/排障**，不替代触发式重配。

---

## 2. 架构总览

```text
                    ┌─────────────────────────────────────┐
                    │  wink-tools（闭源引擎）               │
                    │  scan → validate → render → emit     │
                    │  list_drivers / app_codegen / lint   │
                    │  SandboxedEnvironment（P1 强制）      │
                    └──────────────▲──────────────────────┘
                                   │ 只读扫描
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
┌────────┴────────┐    ┌───────────┴──────────┐   ┌─────────┴─────────┐
│ tools 内置库存   │    │ wink-micro-os/codegen │   │ app/.../codegen/  │
│ （可选；复杂件   │    │ 【默认 SSOT】         │   │ 覆盖 / 私有        │
│  暂留至可 YAML） │    │  drivers/*.yaml       │   │ （最高优先级）      │
│                 │    │  roles/*.yaml         │   │                   │
└─────────────────┘    └──────────────────────┘   └───────────────────┘
                                   │
                                   ▼
                         wink-micro-os/dal/   （仅运行时 C）
```

**产品口诀**：用户改 **描述 + DAL**；厂商发 **引擎**。

---

## 3. 目录与扫描约定

### 3.1 默认扩展根

| 根 | 路径（相对仓） | 用途 |
|----|----------------|------|
| OS | `wink-micro-os/codegen/` | 官方与社区外设/角色描述默认 SSOT（**必须开源**，见 §10） |
| Env | CMake cache `WINK_CODEGEN_PATHS`（板级/第三方包）；CLI 可用同名环境变量作便捷入口 | 板级包、第三方描述包 |
| App | `wink-micro-app/<app>/codegen/` | 单应用私有 type/role 或覆盖（**最高优先级**） |

子树：

```text
codegen/
  drivers/           # MVP：仅 drivers/<type>.yaml（扁平）
    led.yaml
    ultrasonic.yaml
    templates/       # 可选：外置 C/Jinja 模板（§4.3）
      ultrasonic_init.c.j2
  roles/
    binary_indicator.yaml
    distance_sensor.yaml
  README.md          # 用户向：如何加描述（链手册）
```

> **MVP 目录形态**：只支持 `drivers/<type>.yaml`。`drivers/<type>/driver.yaml` 延后 Phase 2，避免双形态扫描歧义。

### 3.2 扫描顺序与冲突（评审 #4 已裁定）

顺序（**后者覆盖前者**）：

**内置 → OS → env（cache 路径声明顺序）→ App**

| 语义 | 说明 |
|------|------|
| App 最高 | App 最具体、最私有；板级/第三方包不得悄悄盖掉应用自带 type |
| env 介于 OS 与 App | 板级包可改官方默认；App 仍可再改 |
| 运维强制盖一切 | **不**用普通 env 表达；另议 `WINK_CODEGEN_FORCE_PATHS` 或严格模式（本设计非范围） |

同名 `type` / 同名 `role`：整文件替换，不做深合并 MVP。

可观测性（必做）：

1. `list_drivers --check` / lint **打印获胜路径**（来源根 + 文件）。  
2. 覆盖日志须进入 **CI 产物**（可检索）。  
3. 可选严格模式：`WINK_CODEGEN_STRICT_OVERRIDE=1` 时，env/App 覆盖内置或 OS 官方 type → **非零退出**。  
4. 默认：env/App 覆盖官方 type → **warn**（防静默覆盖）；产品若要禁覆盖可升 error。

### 3.3 发现规则与权威键

- Driver：`drivers/<type>.yaml`；**权威键 = 正文 `type:`**（须与文件名 stem 一致，否则 fail-closed）。  
- Role：`roles/<id>.yaml`；**权威键 = 正文 `id:`**（须与文件名 stem 一致，否则 fail-closed）。  
- 禁止灰区：`ultrasonic.yaml` 内写 `type: ultra` 等「文件名 ≠ id」组合。  
- 未知 `codegen_schema` **新于**引擎支持的主版本：**失败**（fail-closed），提示升级引擎。  
- **N−1 兼容窗口**：引擎可读取并 **warn** 兼容 `(1, 0)` 及历史 int `1`；目标 schema 为 `"1.1"`。更旧主版本仍 fail-closed。  
- **旧四表窗口（Schema 1.1 Done 后）**：仅含 `required_fields` / `stable_fields` / `advanced_fields` / `constraints`、尚无 `fields:` 的 N−1 描述 → 当前 **warn**（`drivers.legacy_field_tables`）；**下一 codegen schema minor（如 `"1.2"`）或 Owner 签字的下一 tools release** 起升为 **error**（拒绝无 `fields:` 的四表描述）。App 私有 YAML 须在此窗口内 `wink migrate-schema` 后人工替换。官方 OS `codegen/drivers/*.yaml` 已全部为 `fields:`。

### 3.4 根解析同源与构建真值（评审 #2 / #3）

`list_drivers` 与 `app_codegen`（及 lint pack）**必须**共用同一入口，例如 `resolve_codegen_roots()`：

- 根列表解析只在一处实现。  
- CMake `execute_process` 与 `wink.py` 走同一模块。  
- **构建真值**：`WINK_CODEGEN_PATHS` 以 **CMake cache 变量**（`-DWINK_CODEGEN_PATHS=...`）为准，写入 `CMakeCache.txt`，纳入 reconfigure 触发与可复现记录。  
- **环境变量**仅作 CLI / 本地便捷入口；不得作为「未写入 cache 却影响 configure 产物」的隐式真值。  
- 扩展根 YAML + 引用的 `*_template_file` → `CMAKE_CONFIGURE_DEPENDS`（§1.4）。  
- 生成物头注释可带 `codegen_schema` + 描述指纹（hash）作对账；**不**替代 configure 依赖。

---

## 4. Schema 1.1（字段收敛）

> **Schema 1.1** 将驱动描述收敛为单一 `fields:` SSOT + 约定优于配置 + 声明式 `build_variants`。引擎内部统一为 `FieldSpec` + 派生视图（`required_fields` / `stable_fields` / `advanced_fields` / `constraints`）；描述文件**禁止**再写旧四表。  
> 原则：**无歧义处自动推断；有语义歧义处必填或显式覆盖；禁止静默猜错**（尤其 `safe_off`、JSON↔C 成员名、`category`）。  
> 完整实施见 [schema-convergence-plan](../../implementation-plans/tools/2026-07-29-scannable-codegen-schema-convergence-plan.md)；字段裁决 SSOT 见 [schema-field-review2](../../reviews/tools/2026-07-29-scannable-codegen-schema-field-review2.md)。

### 4.1 用户心智模型

| 类别 | 内容 |
|------|------|
| **必填** | `codegen_schema`、`type`、`experimental`、`fields`（含 `tier` / `type`；有歧义时加 `c` / `emit` / `map`） |
| **能推则省** | `category`、`is_actuator`、命名型 `config.*`、1:1 `role_bindings`、标准 init 模板 |
| **逃逸口显式** | 非标 `safe_off_fn`、复杂 role bindings、引擎表达不了的 CMake（`extra_cmake_*`） |

**不做**：「config 100% 全自动」——JSON 字段名 ≠ C 成员名、非 config 发射面（macro / post_init / none）必须在 `fields` 上声明；无法约定处写 `c:` / `emit` / `config` 覆盖。

### 4.2 `DriverBase` → Schema 1.1 能力映射

P1「golden 与旧行为等价」以本表为检查清单。未映射项不得声称「YAML 可完全替代该插件」。

| 现网 `DriverBase` / 插件能力 | Schema 1.1 字段 / 机制 | 备注 |
|------------------------------|------------------------|------|
| `type` | `type`（权威键） | 必填；须 = 文件名 stem |
| `category` | `category` | **条件必填**；可反推时省略（§4.3） |
| `source_stem` | — | **MVP 删除**；恒 `type` → `dal_<type>.c` |
| `is_actuator` | `is_actuator` | 可选；默认 `category == "actuator"` |
| `experimental` | `experimental` | 必填；与 `user_surface` lint 联动 |
| `required_fields` / `stable_fields` / `advanced_fields` / `constraints` | 单一 `fields:` | 引擎**派生视图**；描述禁止再写四表 |
| `extra_cmake_defs` / `extra_cmake_sources` | `build_variants` **或** `extra_cmake_*`（escape） | 与 `build_variants` 并存 → fail-closed |
| `cmake_options()` 非默认 | `cmake_options`（默认 `[WINK_USE_<TYPE>]`） | 可选 |
| `get_headers` / `get_device_type` | `config.headers` / `config.c_type` **或** loader 物化 | 标准驱动可省 `config`（§4.5） |
| config 结构体名 | `config.config_type` **或** 物化 `dal_<type>_config_t` | golden 核对 |
| `render_config_init` | `fields` + `emit:config` → **约定发射**；或 `config.init_template(_file)` | 三态：`convention_emit` / `template_override`（§4.6） |
| `render_deinit` | `config.deinit_fn` **或** 物化 `dal_<type>_deinit` | loader eager 物化 |
| `get_safe_off_fn` | `config.safe_off_fn` **或** 约定探测（§4.5） | `is_actuator` 时必可解析；禁止猜错 |
| `render_post_init_calls` | `fields` + `emit:post_init`；或 `config.post_init_*` 模板 | 复杂多语句仍允许模板覆盖 |
| `render_config_macros` | `fields` + `emit:macro`；或 `config.macros_*` 模板 | 例：`auto_poll_ms` |
| `_validate_*_spec` | `fields` 内 `min`/`max`/`default`/`on_violation`/`enum` | 求值一次，渲染前 |
| `default_role` / `role_verbs` | `default_role` + `role_bindings`（条件）+ `roles/*.yaml` | 1:1 直通可推导（§4.11） |
| `get_role_headers` / `render_role_wrapper` | `role_bindings.<role>.headers` / `.verbs.*.template` | 事件/解包必须手写 |
| 任意 Python 分支 / 动态逻辑 | **超出边界 → 留 tools 内置**（MVP 无 hooks） | 三态第三路：`plugin` |

### 4.3 根级字段裁决

| 字段 | 裁决 | 推断规则 / 何时手写 |
|------|------|---------------------|
| `codegen_schema` | **必填** | 目标 `"1.1"`；接受 `1` / `"1.0"` 为 N−1（**warn**）；未知新主版本 fail-closed |
| `type` | **必填** | = 文件名 stem |
| `experimental` | **必填** | stub / 非用户稳定面 → `true` |
| `fields` | **必填** | 单一 SSOT；旧文件双读窗口内可无（派生四表） |
| `category` | **条件必填** | 显式 > 唯一 `dal/include/<cat>/dal_<type>.h` > 报错；stub 必填；与目录冲突 **fail-closed** |
| `is_actuator` | **可选** | 默认 `category == "actuator"`；`led` 类须显式 `true` |
| `source_stem` | **新描述禁止** | 旧文件忽略或 warn |
| `default_role` / `roles` | **可选** | 组合语义见 §4.8 |
| `config` | **可选覆盖** | 缺省由 loader **eager 物化**进 `DriverRecord.config`（§4.5） |
| `role_bindings` | **条件必填** | 非 1:1 / 有事件解包时必填；推导失败 fail-closed |
| `build_variants` | **按需** | 替代常用裸 CMake（§4.7） |
| `extra_cmake_*` | **escape** | lint warn；与 `build_variants` 并存 → fail-closed |
| `cmake_options` | **可选** | 默认 `[WINK_USE_<TYPE>]` |

### 4.4 `fields.<name>` 裁决

| 键 | 裁决 | 默认 |
|----|------|------|
| `tier` | **必填** | —（`stable` / `advanced`；影响 UI + user_surface） |
| `type` | **必填** | `int` \| `float` \| `bool` \| `string` \| `enum`（`str`→`string` 别名） |
| `required` | 可选 | `false` |
| `default` / `min` / `max` / `on_violation` | 可选 | `on_violation=error` |
| `enum` + `map` | enum 且进 C 时 **map 必填** | 约束求值校验值 ∈ `enum` |
| `c` | JSON 名 ≠ C 成员时 **必填** | = 字段名 |
| `emit` | 非 config 成员时 **必填** | `config`；另有 `macro` / `post_init` / `none` |
| `config_member` | **可选** | 默认：`emit == config` → 进指定初始化；`emit` 为其它值 → 不进。设为 `true` 时：**即使 `emit: macro|post_init` 仍写入 config 结构体**（双通路：C 成员 + 宏/post_init）。例：`use_rmt` / `i2c_addr` / `active_high` |
| `emit_when` | 可选 | `required` 或有 `default` → `always`；否则 `present`（ADR-0034） |
| `c_suffix` / `hex` | 可选 | 按 `type` 派生 |

引擎从 `fields` 派生 `required_fields` / `stable_fields` / `advanced_fields` / `constraints`，供 `list_drivers` / `user_surface` / 约束求值使用。

**约定发射的 config 成员序** = `fields` 中「将进 config」的字段声明序（含 `emit:config` 与 `config_member: true`）。宜与 `dal_*_config_t` 物理成员序一致；`wink lint --pack drivers` 对序不一致发 **warn**（非合入阻断）。

### 4.5 `config` 可选覆盖（约定 + 物化）

标准驱动可不写整段 `config:`。loader 在解析阶段 **eager 物化**下列缺省，保证下游 `get_device_type()` / `render_deinit()` 等零改动：

| 子段 | 缺省派生 |
|------|----------|
| `c_type` | `dal_<type>_t` |
| `config_type` | `dal_<type>_config_t` |
| `headers` | `[dal_<type>.h]` |
| `deinit_fn` | `dal_<type>_deinit` |
| `init_template(_file)` | 无模板时由 `fields`（`emit:config`）**约定发射**指定初始化 + `WINK_TRY(dal_<type>_init(...))` |
| `post_init_*` / `macros_*` | 由 `emit:post_init` / `emit:macro` 生成；复杂仍可用模板覆盖 |

**`safe_off_fn`（仅 `is_actuator`）** — 必可解析，禁止静默猜错：

1. 显式 `config.safe_off_fn`  
2. 约定探测（实施期定探测规则；**不得**假设 `category==actuator` ⇒ 永远 `_safe_off`）  
3. `dal_<type>_off` 与 `dal_<type>_safe_off` 均无法唯一确定 → **fail-closed**，要求显式配置  

例：`rc_servo` / `dc_motor` 须写 `dal_*_safe_off`；`led` 仍用 `dal_led_off`。

**`owner`**：引擎恒注入 `.owner = "<dev_name>"`；描述**禁止**手写（lint 拒绝）。

### 4.6 渲染三态分发

`render_strategy()` 取代旧二态 `uses_yaml_render()`（「有模板 / 无模板→plugin」）：

| 策略 | 条件 | 行为 |
|------|------|------|
| `template_override` | 存在 `config.init_template` 或 `init_template_file` | 整块 Jinja 覆盖约定发射 |
| `convention_emit` | 扩展根 YAML 获胜、无 init 模板、已物化 `config` | `fields` + `emit` 分流生成 config / macro / post_init |
| `plugin` | 仅 builtin / 无 YAML 渲染面 | Python 插件路径 |

**红线**：`kind ∈ {os, env, app}` 且无模板时**必须**走 `convention_emit`（或显式报错）；**禁止**静默回退 `plugin`。现网 `led` / `ultrasonic` / `ssd1306` 已 `register=False`——去掉模板若仍二态分发会直接 `_require_plugin` 或误回 plugin，破坏 YAML SSOT。

约定发射细则：按 `fields` **声明序**输出指定初始化；`enum`+`map`→C 常量；字面量类型化（`f` / `U` / `true`/`false`）；`emit_when: present` 未出现字段则不生成行（ADR-0034）。

### 4.7 `build_variants` 与 CMake escape

声明式 CMake 变体，替代 ssd1306 类裸 `extra_cmake_*` 字符串：

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

引擎生成的 CMake **仅**允许白名单模板（`set(...CACHE...)`、`if(STREQUAL)`、`target_compile_definitions`、`target_sources` 等）；**不**拼接用户任意 CMake。裸 `extra_cmake_*` 降级为 escape hatch，lint warn（strict → error）。

### 4.8 `default_role` / `roles` 组合

| 组合 | 语义 |
|------|------|
| 二者皆空 | 合法（无 Role） |
| 仅 `roles` 非空 | 合法；`wink-app.json` **必须**显式选 role |
| `default_role` ∉ `roles`（`roles` 非空） | fail-closed |
| 非空 `default_role` 且无法解析 bindings（手写或 1:1 推导） | fail-closed |

### 4.9 示意 YAML — ultrasonic 最小集（Schema 1.1）

无 `config:`、无 `source_stem`、无四表；歧义处靠 `fields`：

```yaml
codegen_schema: "1.1"
type: ultrasonic           # 须 = 文件名 stem
# category: 省略 → dal/include/sensor/dal_ultrasonic.h
# is_actuator: 省略 → false
experimental: false
default_role: distance_sensor

fields:
  trig_pin:     { tier: advanced, type: int,    required: true, min: 0, max: 39 }
  echo_pin:     { tier: advanced, type: int,    required: true, min: 0, max: 39 }
  use_rmt:      { tier: advanced, type: bool,   default: true, emit: macro, config_member: true }
  auto_poll_ms: { tier: stable,   type: int,    default: 50, min: 50, emit: macro }
  role:         { tier: stable,   type: string, emit: none }

# role_bindings: 1:1 直通动词可省略；事件/解包类须手写
```

**Golden 空白**：渲染产物在比对前做 **空白规范化**（`replace("\r\n","\n")` + `strip()`）；约定路径与旧 init 模板 golden 等价。

### 4.10 YAML 表达力边界（无 hooks）

| 允许（MVP） | 禁止（MVP；越界 → 内置库存或等 P4 hooks） |
|-------------|------------------------------------------|
| 字段插值（`{{ name }}`、`{{ spec 字段 }}`） | 任意 Python / 导入 / `|attr` 反射 |
| `fields` + `emit` / `emit_when` / `map` 约定发射 | 多分支复杂控制流、运行时动态组装任意 AST |
| `fields` 内声明式约束（类型、min/max、enum、`on_violation`） | 插件式任意校验函数 |
| `build_variants` 白名单 CMake；模板 `*_template_file` | 裸任意 CMake 串；加载扩展根外路径、网络 I/O |

引擎侧：**必须** `SandboxedEnvironment` + context 白名单（§1.4）；禁止任意 import。

### 4.11 `roles/<role>.yaml` — 契约 SSOT（目标态）

```yaml
codegen_schema: "1.1"
id: distance_sensor        # 须 = 文件名 stem
verbs:
  - id: request_measurement
    error_class: normal    # fire_and_forget | convenience | normal | fatal
  - id: read_distance
    error_class: convenience
  - id: read_distance_status
    error_class: normal
```

活规范 [01-app-business-logic.md](../../design/03-app-codegen/01-app-business-logic.md) 仍为**人读**角色语义 SSOT；机读 `roles/*.yaml` 与之对拍（lint）。

**`error_class` ↔ wrapper 签名 lint（评审 #7）**：

| `error_class` | 期望签名特征（lint） |
|---------------|----------------------|
| `normal` / `fatal` | 须含 `WINK_WARN_UNUSED_RESULT`，返回 `wink_status_t` |
| `fire_and_forget` | 返回 `void` |
| `convenience` | 允许非 status 返回（如 `float`）；不强制 WARN_UNUSED |

1:1 直通 verb 可自动推导 wrapper（别名表引擎内置，如 `activate→on`）；推导失败 → **fail-closed**，要求手写 `role_bindings`。

### 4.12 Roles `codegen_schema` 裁决

| 选项 | 说明 |
|------|------|
| **A（默认）** | drivers 与 roles **同步**升 `"1.1"`（同 PR 改 `wink-micro-os/codegen/roles/*.yaml`） |
| B | 引擎对 role 文档在窗口内仍接受 `1`/`"1.0"` **且不 warn**；仅 driver 对 N−1 warn |

**P0 裁定：选项 A。** 避免 roles 集体 warn 与版本语义分裂。

### 4.13 过渡态：role 内嵌模板（限时）

| 规则 | 说明 |
|------|------|
| 允许窗口 | **仅 P3 出口前** 的迁移双轨；1:1 官方外设可暂用 |
| 强制 | **多 type 共享同一 role** → 必须 `role_bindings`；lint **禁止** role 内嵌 DAL 模板 |
| P3 出口 | 删除「role 内嵌 DAL」为主路径；文档与脚手架只教 bindings |

### 4.14 `default_role` 无 bindings（评审 #9）

- 声明了非空 `default_role` 却既无 `role_bindings.<role>`、又无法 1:1 推导、且不在限时过渡形态 → **fail-closed**。  
- 无 `default_role` 且无 role → 合法（加 DAL ≠ 必须挂 Role）。

---

## 5. 引擎行为（tools）

### 5.1 `list_drivers`

- 输入：经 `resolve_codegen_roots()` 扫描合并后的 driver 描述集。  
- 输出：不变精神 — `WINK_KNOWN_DRIVERS`、CATEGORY/STEM、option、`--mode=source|defs` extras。  
- 实现可从「import DriverBase 子类」改为「load YAML → 内部 `DriverRecord`」（字段对齐 §4.2）；`fields` 派生旧四表视图；消费 `build_variants` 与 `render_json` 兼容契约（§7）。  
- `--check`：打印每 type 的获胜路径；支持 `WINK_CODEGEN_STRICT_OVERRIDE`。

### 5.2 `app_codegen`

- 解析 `wink-app.json`；`type` ∈ 合并后的 known drivers。  
- `role`：缺省 `default_role`；若显式指定则校验 ∈ 该 driver 允许角色，且 bindings/verbs 可生成（§4.8 / §4.14）。  
- `fields` 约束在 spec 解析后、渲染前运行一次（§4.4）。  
- 渲染按 **三态分发**（§4.6）：`template_override` / `convention_emit` / `plugin`；OS YAML 禁止静默回 plugin。  
- 生成物头注释：`codegen_schema` + 描述指纹（对账）；重建靠 configure 依赖。

### 5.3 `wink.py new-dal`

- 生成 `dal/include|src/...`（同今）。  
- **改写**：在 `wink-micro-os/codegen/drivers/<type>.yaml` 写 **Schema 1.1** 骨架（`fields:`），**不再**写入 `wink-tools/.../drivers/<type>.py`（迁移完成后）。  
- 骨架默认 **`experimental: true`**。  
- `--role`：可选生成/引用 `roles/<role>.yaml` 骨架 + driver `default_role` / `role_bindings` 占位。

### 5.4 Lint

- `wink lint --pack drivers`：Schema 1.1 校验、必填/派生字段、`type`/文件名一致、role 动词覆盖、`error_class`↔签名（warn→error）、裸 `extra_cmake_*` warn、`build_variants` 与裸串并存 fail-closed。  
- 未知/过旧 schema、非法 category、`category` 与目录冲突、执行器 `safe_off_fn` 不可解析、越界模板路径：错误。  
- **`wink lint --pack user_surface`**：输入为**合并后的 registry**（含 `experimental`、由 `fields.tier` 派生的字段分级）。

### 5.5 Python hooks（P4，非 MVP）

- MVP：**关闭**；见 §10。  
- P4：YAML `hooks:`；API 稳定、窄、版本化；仅扩展根相对路径。  
- hooks 就绪前，复杂外设留 tools 内置库存。

---

## 6. 迁移策略

| 阶段 | 内容 | 退出标准 |
|------|------|----------|
| **P0** | ADR-0051 Accepted；本 tech-design 定稿；实施计划 | Owner 签字（本步已完成 Accepted + 定稿） |
| **P1** | `resolve_codegen_roots` + YAML driver（Schema 1.1 双读）；**沙箱 + CMAKE_CONFIGURE_DEPENDS**；并行可读旧 `drivers/*.py`；三态分发 + config 物化 | **ultrasonic** 约定路径 golden 与旧行为等价（§4.2）；至少一切片 rc_servo `emit_when`/`map` 或 ssd1306 `build_variants` |
| **P2** | 官方可 YAML 化描述迁到 `wink-micro-os/codegen/`；`new-dal` 改写；文档手册更新 | 默认可 YAML 路径不再依赖 tools 内用户可写插件；复杂件可仍内置 |
| **P3** | `roles/*.yaml` + `role_bindings`；结束 role 内嵌模板主路径；`error_class` lint | led/button/ultrasonic/ssd1306/rc_servo 等目标集全迁或明确内置例外清单 |
| **P4** | 可选 hooks；tools 内驱动表可空或仅示例 | 闭源发布清单就绪 |

兼容：P1–P2 双读期间，同名 type 以 §3.2 扫描顺序为准；CI 打印来源路径。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 扩展根模板 = 构建期 RCE（禁 hooks 不够） | **P1 强制** `SandboxedEnvironment` + 白名单 context；固定 jinja2 下限；模板仅扩展根相对路径（§1.4） |
| 改 YAML 后 make 静默用旧产物 | **P1 强制** `CMAKE_CONFIGURE_DEPENDS`；hash 仅对账（§1.4 / §3.4） |
| `WINK_CODEGEN_PATHS` 纯 env 破坏可复现 | 构建真值走 CMake cache；env 仅 CLI 便捷入口（§3.4） |
| env 盖掉 App 私有描述 | 扫描顺序 App 最高（§3.2） |
| Schema 破坏用户描述 | `"1.1"` 主版本 + N−1 warn 窗口（`1`/`"1.0"`）；更旧 fail-closed |
| YAML 漏迁 `DriverBase` 能力 → 假等价 | §4.2 检查清单；缺字段不得标完成 |
| 表达力不足却强迁 YAML | §4.10；越界留内置；ultrasonic / rc_servo 切片 / ssd1306 variants 作 P1 证据 |
| 大段 C 嵌 YAML 难维护 / golden 脆弱 | 约定发射 + `*_template_file` escape；空白规范化（§4.9） |
| Role 模板与 DAL 耦合 / 契约无约束 | `role_bindings`；`error_class` 签名 lint warn→error |
| `default_role` 无实现 | fail-closed（§4.14） |
| 用户 hooks 任意代码 | MVP 禁用；P4 白名单 |
| 迁移期双 SSOT / 静默覆盖 | 获胜路径日志；`STRICT_OVERRIDE` |
| CMake 与 CLI 两套根发现 | `resolve_codegen_roots()` 单入口 |
| 与 user-surface 门禁断层 | `fields.tier` 派生分级 + `experimental` |
| 文档漂移 | §9 Accepted 回写清单 |
| **裸 CMake 注入面**（`extra_cmake_*` 任意串） | 主推 `build_variants` 白名单模板；裸串降级 escape + lint warn（strict → error）；与 variants 并存 fail-closed（§4.7） |
| **`emit` 误配**（字段进错发射面或漏发射） | `fields.emit` / `emit_when` / `c:` 显式声明；T3 单测矩阵；init 模板整块覆盖作 escape |
| **`category` 冲突**（YAML vs 头文件目录） | 显式 > 唯一反推 > 报错；stub 必填；冲突 fail-closed（§4.3） |
| **`safe_off` 歧义**（`_off` vs `_safe_off`） | 显式 `config.safe_off_fn` 优先；禁止 actuator 默认永远 `_safe_off`；T12 头文件原型 lint（§4.5） |
| **二态分发地雷**（去模板 → `_require_plugin` 或静默回 plugin） | **三态** `render_strategy()`；OS YAML 无模板必须 `convention_emit` 或显式报错（§4.6） |
| **`render_json` 契约漂移**（`has_extra_cmake_*` 变 false 破前端） | variants 驱动 N−1 窗口内保持 extras 标志语义；新增 `has_build_variants`；测例 + changelog 锁定 |

---

## 8. 验收标准（设计层）

- [ ] 在**不修改 wink-tools 源码**的前提下，于 `wink-micro-os/codegen/` 新增假想 type 描述 + DAL，host 构建能发现 `WINK_USE_*` 并完成 device_tree 生成（P2 后）。  
- [ ] 用户新增 role 契约文件并在 driver 上绑定后，生成 `{name}_{verb}`（P3）。  
- [ ] `list_drivers --check` / lint 覆盖扩展根，且打印获胜路径。  
- [ ] ADR-0046 机制（数据型 CMake、双模裁剪）行为保持。  
- [ ] P1：SandboxedEnvironment 生效；扩展根 YAML 进入 `CMAKE_CONFIGURE_DEPENDS`；ultrasonic 约定发射 golden 等价。  
- [ ] §4.2 映射表所列能力可从 Schema 1.1 YAML 加载；`user_surface` lint 可读派生字段分级 / `experimental`。  
- [ ] 手册明确：加 DAL ≠ 必须挂 Role；Role ≠ BAL；官方描述 SSOT 在 `wink-micro-os/codegen/`。

---

## 9. 文档回写清单（Accepted + 实施后）

| 文档 | 动作 | 状态 |
|------|------|------|
| ADR-0051 | Accepted + P1 引擎约束 | **本步完成** |
| ADR-0046 | 状态日志：SSOT 路径由 ADR-0051 演进 | **本步完成** |
| 01-dal / 03-codegen | 扩展根 + 扫描 | **本步完成**（目标态；代码迁移随 implementation-plan） |
| adding-peripheral / role-interface-codegen | 链 ADR-0051 目标路径；注明迁移期双读 | **本步完成**（操作细节随实施更新） |
| wink-app-json-guide | 链新扩展模型一句 | 实施期 |
| user-surface-insulation-design | registry 可来自扩展根 YAML | 实施期 |

---

## 10. 开放问题裁定

| # | 问题 | 裁定 | 备注 |
|---|------|------|------|
| 1 | MVP 是否禁止 Python hooks？ | **禁止（仅 YAML）** | 复杂件留内置至可声明化或 P4；§4.4 / §5.5 |
| 2 | 官方描述是否必须开源在 `wink-micro-os/codegen/`？ | **必须** | 闭源的是引擎，不是外设表 |
| 3 | App 级扩展根是否首期就做？ | **P1 做路径解析与覆盖日志；P2 再鼓励业务使用** | §3.2 / §6 |
| 4 | `role_bindings` 与「role 内嵌模板」双轨？ | **限时双轨，P3 出口结束内嵌主路径** | 多 type 共享 → 立即强制 bindings |
| 5 | 扫描顺序 App vs env？（评审 #4） | **内置 → OS → env → App（App 最高）** | §3.2 |
| 6 | 构建路径真值？ | **CMake cache；env 仅 CLI 便捷** | §3.4 |
| 7 | Jinja / 重建？ | **P1 强制沙箱 + CONFIGURE_DEPENDS** | §1.4 |

---

## 11. 评审处置追溯

详见 [2026-07-29-scannable-codegen-extension-roots-design-review.md](../../reviews/tools/2026-07-29-scannable-codegen-extension-roots-design-review.md)。#1–#11 已回写本文对应章节；#1/#2 升入 ADR-0051。

---

*定稿（Schema 1.1 §4 已回写）。实施见 [extension-roots-plan](../../implementation-plans/tools/2026-07-29-scannable-codegen-extension-roots-plan.md) 与 [schema-convergence-plan](../../implementation-plans/tools/2026-07-29-scannable-codegen-schema-convergence-plan.md)。*


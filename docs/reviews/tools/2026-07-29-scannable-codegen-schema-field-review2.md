# Codegen Schema 字段评审二轮 — 必填 / 派生切分与过度声称纠偏

| 项 | 内容 |
|---|---|
| **评审日期** | 2026-07-29 |
| **评审对象** | [2026-07-29-scannable-codegen-schema-field-review.md](./2026-07-29-scannable-codegen-schema-field-review.md)（一轮）+ tech-design §4 |
| **原则** | 尽量简洁配置；不牺牲功能与扩展性；无歧义处一律自动推断；有语义歧义处必填/显式覆盖 |
| **对照现网** | `base.py`、`button.py`、`ssd1306.py`、`rc_servo.py`、`led.py`、`dc_motor.py`、`eeprom.py` |
| **结论** | 一轮方向正确且应采纳 S1/S2/S3；但 **S14「config 全自动」与 S13「category 目录反推」过度声称**。应改为「约定默认 + 字段级 `c:`/`emit` 声明 + 冲突 fail-closed」。 |

---

## 1. 对一轮的裁定

| 一轮建议 | 本轮裁定 | 一句话理由 |
|---|---|---|
| S1 `build_variants` | **采纳，升 P1** | 裸 CMake 是真安全洞；ssd1306 字体二选一可完整声明化 |
| S2 条件发射 `emit_when` | **采纳，升 P1** | rc_servo / button ADR-0034 活在此；无此则 P3 迁不动 |
| S3 合并 `fields:` | **采纳，升 P1** | 四表 SSOT 裂缝属实 |
| S4 enum + map + bool | **采纳** | `_CLOCK_TO_C` / `_PULL_TO_C` 现网硬编码 |
| S5/S6/S7/S9–S11 | **采纳** | 理由成立 |
| S12 `is_actuator` 可选派生 | **采纳（细则见 §3）** | `led` = `output` + `is_actuator:true` 证明不能只靠 category |
| S13 `category` 目录反推 | **有条件采纳** | 见 §2.1；stub / 冲突必须有手写与 fail-closed |
| S14 `config:` 整块可选、全自动 | **部分采纳，纠偏** | 见 §2.2；JSON≠C 名、非 config 字段会打穿「纯约定」 |
| S15 `role_bindings` 可选 | **采纳（边界保持）** | 1:1 直通可推导；事件/解包必须手写 |

---

## 2. 纠偏：两处过度声称

### 2.1 `category` 目录反推有歧义窗口

可行，但不能当唯一真值：

1. **Stub / `new-dal` 早期**：头文件尚未落盘 → 无法反推；骨架 YAML **必须手写 `category`**（或脚手架一步写出目录+YAML）。
2. **冲突**：`dal/include/sensor/dal_foo.h` 与 YAML `category: actuator` 不一致 → **fail-closed**，禁止静默以目录为准。
3. **权威序**：显式 `category` > 唯一匹配的 `dal/include/<cat>/dal_<type>.h` > 报错。不得用「猜」。

**裁定**：`category` 对生产驱动建议省略（能唯一反推时）；对 stub **必填**。引擎实现「反推」即可，文档勿写「永远可缺」。

### 2.2 `config:` 不能仅靠 `type` + 裸 `fields` 名猜测

现网反例（一轮 §2.7「100% 可行」不成立）：

| JSON 字段 | C 成员 | 去向 |
|---|---|---|
| `i2c_bus` (ssd1306/eeprom) | `.i2c_port` | config |
| `gpio_pin` (button) | `.pin` | config |
| `auto_poll_ms` (button/ultrasonic) | — | macros / role wrapper，**不进** config |
| `long_press_ms` / `isr_counter` | — | **post_init** |
| `role` | — | codegen 元数据，不发射 C |

另：`safe_off` 命名不是纯约定——`base.get_safe_off_fn` 默认 `dal_<type>_off`，而 `rc_servo`/`dc_motor` 覆盖为 `*_safe_off`，`led` 作为 actuator 仍用 `dal_led_off`。

**裁定**：保留「标准驱动可不写整段 `init_template`」，但必须在 `fields:` 上声明发射面；无法约定处显式写 `c:` / `emit` / `safe_off_fn`。

---

## 3. 必填 / 派生 / 可选覆盖 — 裁决表

原则：**用户手写 = 产品语义或命名歧义**；其余引擎派生。

### 3.1 Driver YAML 根级

| 字段 | 裁决 | 推断规则 / 何时手写 |
|---|---|---|
| `codegen_schema` | **必填** | `"1.0"`（major.minor）；未知新主版本 fail-closed |
| `type` | **必填** | = 文件名 stem |
| `experimental` | **必填** | 稳定面门禁；stub↔false 交叉 lint |
| `fields` | **必填** | 单一 SSOT（合并 required/stable/advanced/constraints） |
| `category` | **条件必填** | 头路径唯一可反推时可省；stub / 歧义必填；与目录冲突 fail-closed |
| `is_actuator` | **可选** | 默认 `category == "actuator"`；`led` 类须显式 `true` |
| `source_stem` | **MVP 删除** | 现网零覆盖；真有需求再加 |
| `default_role` | **可选** | 有则 P3 要求 bindings 可解析（或过渡态） |
| `roles` | **可选** | 显式白名单；与 `default_role` 空/非空语义写死（见 §4） |
| `build_variants` | **按需** | 替代裸 `extra_cmake_*`；表达不清才 escape hatch |
| `extra_cmake_*` | **降级 escape** | lint warn；§7 入风险表 |
| `cmake_options` | **可选** | 默认 `[WINK_USE_<TYPE>]` |
| `config` 块 | **多数可省** | 仅覆盖非约定命名 / 自定义模板 |
| `role_bindings` | **条件必填** | 有 `default_role` 且非 1:1 直通时必填；纯直通可省 |

### 3.2 `fields.<name>`（必填属性 vs 派生默认）

| 属性 | 裁决 | 默认 |
|---|---|---|
| `tier` | **必填** | —（`stable` / `advanced`；影响 UI + user_surface） |
| `type` | **必填** | `int` \| `float` \| `bool` \| `string` \| `enum` |
| `required` | **可选** | `false` |
| `default` | **可选** | 无则缺省不补 |
| `min` / `max` | **可选** | — |
| `enum` + `map` | **enum 时必填 map（若进 C）** | 用户字符串 → C 常量 |
| `on_violation` | **可选** | `error`；`warn` = 警告，仅 `--strict` / `STRICT_OVERRIDE` 非零 |
| `c` | **名称不等时必填** | 默认 = 字段名；例：`i2c_bus: { c: i2c_port }` |
| `emit` | **非 config 成员时必填** | 默认 `config`；取值 `config` \| `macro` \| `post_init` \| `none` |
| `emit_when` | **可选** | 默认：`required`/`有 default` → `always`；否则 `present`（对齐 ADR-0034） |
| `c_suffix` | **可选** | 按 `type` 派生：`int`→可空、`float`→`f`、字面量 bool→`true`/`false` |
| `hex` | **可选** | 地址类（`i2c_addr`）显式 `true` |

`required_fields` / `stable_fields` / `advanced_fields` / `constraints`：**引擎派生视图**，描述文件禁止再写。

### 3.3 `config` 覆盖（仅非标）

| 子段 | 裁决 | 默认派生 |
|---|---|---|
| `c_type` / `config_type` / `headers` / `deinit_fn` | 可省 | `dal_<type>_t` / `dal_<type>_config_t` / `[dal_<type>.h]` / `dal_<type>_deinit` |
| `safe_off_fn` | **`is_actuator` 时必可解析** | 优先探测约定：`dal_<type>_safe_off` 若描述/头约定声明，否则 `dal_<type>_off`；**两端都不清则必填**（禁止猜错急停符号） |
| `owner` | **禁止手写** | 引擎恒注入 `.owner = "<dev_name>"` |
| `init_template(_file)` | 可省 | 由 `fields`（`emit:config`）生成指定初始化 + `WINK_TRY(dal_<type>_init(...))` |
| `post_init_*` / `macros_*` | 可省 | 由 `emit:post_init` / `emit:macro` 生成；复杂多语句仍允许模板覆盖 |

### 3.4 Role

| 字段 | 裁决 |
|---|---|
| `roles/<id>.yaml` 的 `id` / `verbs[].id` / `error_class` | **必填** |
| `verbs[].params` | **P1 不进 schema**；要做就整语法冻结，禁止半成品 |
| 1:1 直通 verb | **可自动推导** wrapper；别名表引擎内置（`activate→on` 等），版本化 |
| 多步/事件/出参解包 | **必须手写** `role_bindings` 模板 |

---

## 4. 目标态最小样例（标准 ultrasonic）

无 `config:`、无 `source_stem`、无四表重复；歧义处靠 `fields`：

```yaml
codegen_schema: "1.0"
type: ultrasonic
# category: 省略 → dal/include/sensor/dal_ultrasonic.h
# is_actuator: 省略 → false（非 actuator）
experimental: false
default_role: distance_sensor

fields:
  trig_pin:     { tier: advanced, type: int,  required: true, min: 0, max: 39 }
  echo_pin:     { tier: advanced, type: int,  required: true, min: 0, max: 39 }
  use_rmt:      { tier: advanced, type: bool, default: true }
  auto_poll_ms: { tier: stable,   type: int,  default: 50, min: 50, emit: macro }
  role:         { tier: stable,   type: string, emit: none }

# role_bindings: 若 request_measurement 等为 1:1 直通可省略；
# enable_events 类必须保留 bindings（本驱动若挂事件则手写）
```

ssd1306 名称映射 + 构建变体：

```yaml
fields:
  i2c_bus:  { tier: advanced, type: int, required: true, c: i2c_port }
  i2c_addr: { tier: advanced, type: int, default: 0x3C, hex: true }
  width:    { tier: stable, type: int, default: 128 }
  height:   { tier: stable, type: int, default: 64 }

build_variants:
  - name: font
    values: [minimal, ascii_upper]
    default: ascii_upper
    compile_defines:
      minimal: WINK_SSD1306_FONT_MINIMAL=1
      ascii_upper: WINK_SSD1306_FONT_ASCII_UPPER=1
    extra_sources:
      minimal: dal/src/display/dal_ssd1306_font_5x7_minimal.c
      ascii_upper: dal/src/display/dal_ssd1306_font_5x7_ascii_upper.c
```

rc_servo 条件发射 + enum map：

```yaml
fields:
  pwm_channel:        { tier: advanced, type: int, required: true }
  resolution_bits:    { tier: advanced, type: int, min: 1, max: 20, emit_when: present, c_suffix: u }
  clock_requirement:  { tier: advanced, type: enum, emit_when: present,
                        enum: [auto, stable_required],
                        map: { auto: DAL_RC_SERVO_CLOCK_AUTO,
                               stable_required: DAL_RC_SERVO_CLOCK_STABLE_REQUIRED } }
  min_pulse_ms:       { tier: stable, type: float, default: 0.5 }
  max_pulse_ms:       { tier: stable, type: float, default: 2.5 }
  max_angle:          { tier: stable, type: float, emit_when: present }  # 0/180 哨兵语义保留在约束层
is_actuator: true   # 与 category 一致时可省
config:
  safe_off_fn: dal_rc_servo_safe_off   # 与默认 _off 歧义 → 必填或约定探测
```

---

## 5. 补充规范（一轮未钉死）

1. **`default_role` / `roles` 空组合**  
   - 二者皆空：合法（无 Role）。  
   - 仅 `roles` 非空、`default_role` 空：合法，用户 wink-app.json **必须**显式选 role。  
   - `default_role` ∉ `roles`（当 `roles` 非空）：fail-closed。

2. **`safe_off_fn` 探测顺序**（写进 schema / lint）  
   `显式配置` → `dal_<type>_safe_off`（仅当 `is_actuator` 且驱动描述声明 `safe_off_symbol: safe_off` 或同类一等字段）→ `dal_<type>_off` → 否则 `is_actuator` 报错。  
   **不要**用「category==actuator ⇒ 永远 `_safe_off`」——`led` 证伪。

3. **`emit` 分流是表达力核心**，比整块 Jinja init 更符合 §4.4「禁多分支」。一轮的 `struct_fields` 可折叠进 `fields.*`，避免第三张表。

4. **P1 golden 驱动选择**：ultrasonic（同源字段）+ **至少切一片** rc_servo 的 `emit_when`/`map` 或 ssd1306 的 `c:`/`build_variants`，否则「可迁 actuator/display」仍是空头支票。

5. **角色 1:1 推导失败策略**：动词在 `roles/*.yaml` 有、且引擎无法唯一映射到 `dal_<type>_<verb>` / 别名表 → **fail-closed，要求手写 binding**，禁止静默生成错误 wrapper。

---

## 6. 建议回写 tech-design 的增量（按优先级）

| # | 动作 | 优先级 |
|---|---|---|
| R1 | §4 改为单一 `fields:` + `emit`/`c`/`emit_when`/`map` | **高** |
| R2 | 裸 `extra_cmake_*` → `build_variants`；裸串退 escape + §7 | **高** |
| R3 | 删掉「config 100% 全自动」叙述；改为「约定生成 + 字段发射声明」 | **高** |
| R4 | `owner` 引擎注入；`source_stem` MVP 删除；`codegen_schema: "1.0"` | 中 |
| R5 | `category`/`is_actuator`/`safe_off_fn` 按本表写推断与 fail-closed | 中 |
| R6 | `role_bindings` 可选 + 失败 fail-closed；`params`/cross-field 半成品移出 P1 | 中 |
| R7 | P1 golden：ultrasonic +（rc_servo 切片 **或** ssd1306 `build_variants`） | 中 |

---

## 7. 结论

一轮把正确压力打在了冗余字段与裸 CMake 上——**S1–S3 应进 P1**。本轮在「简洁配置」原则上再收一层，同时钉死：**不能无歧义推断的，就不推断**。

用户描述的最终心智模型应是：

> **必填**：`codegen_schema`、`type`、`experimental`、`fields`（含 tier/type，及有歧义时的 `c`/`emit`/`map`）。  
> **能推则省**：`category`、命名型 `config.*`、1:1 `role_bindings`、默认 `is_actuator`。  
> **逃逸口显式**：非标 `safe_off`、复杂 bindings、真正引擎表达不了的 CMake。

以此收敛后，YAML 短、引擎边界清、P3 目标集才迁得动。

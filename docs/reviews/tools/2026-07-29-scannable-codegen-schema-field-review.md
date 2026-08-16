# Codegen 扩展根 Schema 字段评审 — 逐字段必要性、表达力缺口与结构性建议

| 项 | 内容 |
|---|---|
| **评审日期** | 2026-07-29 |
| **评审范围** | 技术设计 [2026-07-28-scannable-codegen-extension-roots-design.md](../../tech-designs/tools/2026-07-28-scannable-codegen-extension-roots-design.md) **§4 Schema 补全**（§4.1–§4.7） |
| **关联 ADR** | [ADR-0051](../../decisions/tools/0051-scannable-codegen-extension-roots.md)（Accepted）；[ADR-0046](../../decisions/core/0046-dal-driver-registry-ssot.md) |
| **对照现网** | `base.py`、`ultrasonic.py`、`rc_servo.py`、`ssd1306.py`、`dc_motor.py`、`led.py`、`button.py` 等 |
| **评审人** | 资深嵌入式架构师（外部评审） |
| **结论** | §4 方向正确，但 schema 存在 3 类问题：① **字段冗余**（`source_stem`、`config.config_type` 应派生而非强填）；② **能力缺口**（条件字段发射、裸 CMake 安全、`owner` 内建、enum→C 映射）；③ **结构性缺陷**（`required_fields`/`stable_fields`/`advanced_fields`/`constraints` 四表未合并为单一 `fields:`，违反 SSOT 精神）。 |

---

## 1. 逐字段评审表

依 §4.3 示意 YAML 与 §4.1 映射表逐字段评审。「必要」列取值：必填 / 可选 / 建议删除 / 建议派生。

### 1.1 公共头

| 字段 | 必要 | 作用 | 评审 |
|------|------|------|------|
| `codegen_schema` | 必填 | 引擎识别 schema 主版本 | 应用 `"major.minor"` 字符串而非整数。§3.3 承诺 N−1 兼容窗口，但整数无法区分「向后兼容的加字段」与「破坏性变更」。建议 `codegen_schema: 1` → `"1.0"`。 |

### 1.2 `drivers/<type>.yaml` 根级字段

| 字段 | 必要 | 作用 | 评审 |
|------|------|------|------|
| `type` | 必填 | 权威键，= wink-app.json type，须 = 文件名 stem | 状态正确。 |
| `category` | **建议可选/派生** | 决定 DAL 源/头子目录、list_drivers 分类 | 建议降为可选（未填时由引擎根据 `dal/include/*/{dal_<type>.h,dal_<stem>.c}` 的父目录自动反向推导）。仅在 C 文件尚未创建的 Stub 阶段或非标准目录时显式指定。见 §2.6。 |
| `source_stem` | **建议删除** | `dal_<stem>.c` 的 stem，默认 = type | 现网 12 个驱动**全部用默认值**，零覆盖。为不存在的用例保留字段，使每份 YAML 多一个恒等样板、golden 与文档都要解释它。建议 MVP 移除，确需 `dal_xxx.c ≠ type` 时再加。 |
| `is_actuator` | **建议可选** | 决定 safe-off thunk + actuator 注册 | 建议降为可选（默认按 `category == "actuator"` 派生），保留逃生口以便 `category: output` 的驱动（如 `led.yaml`）显式接入 safe-off。见 §2.5。 |
| `experimental` | 必填 | stub / 非稳定面标记，与 user_surface lint 联动 | 正确。补充：lint 应交叉检查「stub 但误标 `experimental: false`」的组合，避免未成熟驱动进入用户稳定面。 |
| `required_fields` | 必填（可空） | wink-app.json 必填字段名 | 用法正确，但与 `constraints`、`advanced_fields` 重叠（`trig_pin` 同时在 3 处出现）。见 §3 合并建议。 |
| `stable_fields` | 必填 | 用户面稳定字段（changelog 敏感） | 正确，但无法在此绑定默认值（`auto_poll_ms` 默认 50 写在 `constraints`，字段分级写在这里，两处真值）。 |
| `advanced_fields` | 必填 | 接线/驱动面字段（GPIO/PWM/I2C…） | 同上。 |
| `default_role` | P3 按需 | 缺省绑定角色 | 正确。§4.7 fail-closed（非空但无 bindings→报错）是正确约束。 |
| `roles` | 可选（P3） | 显式允许角色列表 | 注释说「默认允许 default_role」，但未定义「`default_role` 为空而 `roles` 非空」时的语义（报错 / 忽略 / 允许？）。需明确。 |
| `extra_cmake_defs` | **建议改声明式** | 裸 CMake：CACHE/编译定义 | 安全洞，见 §2.1。 |
| `extra_cmake_sources` | **建议改声明式** | 裸 CMake：target_sources | 同上，见 §2.1。 |
| `cmake_options` | 可选 | 该驱动需要的 CMake option | 默认 `[WINK_USE_<TYPE>]`，现网零覆盖。作为 escape hatch 保留合理，但不应在 golden 示意中突出。 |

### 1.3 `constraints:` 字段

| 字段 | 必要 | 作用 | 评审 |
|------|------|------|------|
| `constraints`（整体） | 必填能力 | 声明式校验，替代插件内 `_validate_*` | 方向正确。但未定义与 `required_fields` 的关系——`required` 和取值域是两套并列机制。见 §3。 |
| `.field` | 必填 | 目标字段名 | 正确。 |
| `.tier` | 必填（合并后） | 字段分级 (stable / advanced) | 替代原 `stable_fields` 与 `advanced_fields`。用于低代码 UI 折叠与 CI 变更防破坏检测（user_surface lint）。 |
| `.type` | 必填 | int/…… | **缺 `bool`**（`use_rmt` 为 bool）；应补 int/float/bool/string/enum 全集。 |
| `.optional` | 可选 | 是否可缺省 | 未定义默认值（假定 false 但未写明）。 |
| `.default` | 可选 | 缺省值 | 正确。 |
| `.min` / `.max` | 可选 | 数值域 | 正确。 |
| `.on_violation` | 可选（默认 error） | error / warn | `warn` 的后续行为未定义：lint 是否非零退出？建议明确：warn = 报警告，非零仅在 `--strict` / `STRICT_OVERRIDE`。 |
| `.enum` | **缺失** | 枚举值 + 值→C 常量映射 | §4.4 声称支持 enum 但 schema 无样例，且缺 enum→C 常量映射（`clock_requirement: auto` → `DAL_RC_SERVO_CLOCK_AUTO`）。高频刚需，见 §2.2。 |
| cross-field `when/require` | **缺失且无语法** | 跨字段依赖 | 正文仅注释示例。若实施期才定语法，则 P1 golden 无法验证。建议 P1 定义完整语法，或明确 P1 不支持并从示意删除。 |

### 1.4 `config:` 块

| 字段 | 必要 | 作用 | 评审 |
|------|------|------|------|
| `config`（整体） | **建议可选（整体派生）** | 设备 C 结构体与初始化生成配置 | 建议降为可选。引擎根据 `type` 与 `fields:` 遵循“约定优于配置”全自动派生 `c_type` (`dal_<type>_t`)、`config_type` (`dal_<type>_config_t`)、`headers` (`[dal_<type>.h]`)、`deinit_fn` (`dal_<type>_deinit`)，并从 `fields:` 自动生成 C99 指定初始化代码。仅非标特殊驱动需要手写 `config:` 覆盖。见 §2.7。 |
| `config.c_type` | **建议派生** | 设备实例 C 类型 | 默认由 `type` 派生为 `dal_<type>_t`。 |
| `config.config_type` | **建议派生** | config 结构体名 | 默认由 `c_type` 派生（去 `_t` 加 `_config_t`）。 |
| `config.headers` | **建议派生** | #include 头 | 默认由 `type` 派生为 `[dal_<type>.h]`。 |
| `config.init_template` / `_file` | **建议派生** | config 结构体 + init 块 | 建议由 `fields:` 自动生成 C99 指定初始化代码，无需手动手写 Jinja/C 模板。 |
| `config.deinit_fn` | **建议派生** | deinit 函数名 | 默认派生为 `dal_<type>_deinit`。 |
| `config.safe_off_fn` | **建议派生** | safe-off 函数名 | 默认派生为 `dal_<type>_off`（或 `dal_<type>_safe_off`）。 |
| `config.post_init_template` / `_file` | 可选 | 主 init 后附加调用 | 正确。 |
| `config.macros_template` / `_file` | 可选 | device_tree.h 宏 | 正确，但注意评估时机耦合：现网 `rc_servo.py:140-142` 的 `render_config_macros` 会**再次**调用约束校验（副作用）。声明式下 macros 需消费 constraints 求值结果，此依赖 schema 未显式定义（对齐 §4.3「运行一次、缓存复用」）。 |

### 1.5 `role_bindings:` 块

| 字段 | 必要 | 作用 | 评审 |
|------|------|------|------|
| `role_bindings`（整体） | **建议可选（标准推导）** | 角色→wrapper 绑定 | 建议降为可选。引擎根据 `default_role` 找到 `roles/<role>.yaml`，按 1:1 规范契约（如 `dal_<type>_<verb>` 或常见别名字典 `activate -> on`）自动推导 C wrapper 绑定。仅非标动词映射或复杂多步骤 wrapper 需要手写 `role_bindings:` 覆盖。见 §2.8。 |
| `.<role>.headers` | **建议派生** | 角色 wrapper 所需头 | 默认由 `default_role` 派生（如 `sensor/wink_<type>_<role>_events.h`）。 |
| `.<role>.verbs` | P3 必填 | 动词→模板 | 正确，但模板硬编码 C 与 `error_class` 签名 lint 的联动未定义（如 `read_distance` 返回 `float` 对应 `convenience`，是否 lint 验证签名？）。 |
| `.<role>.verbs.<verb>.template` / `_file` | 必填其一 | wrapper C 模板 | 正确，同上。 |

### 1.6 `roles/<role>.yaml` 字段

| 字段 | 必要 | 作用 | 评审 |
|------|------|------|------|
| `codegen_schema` | 必填 | 版本 | 同 §1.1。 |
| `id` | 必填 | 角色 id，须 = 文件名 stem | 正确。 |
| `verbs[].id` | 必填 | 动词 id | 正确。 |
| `verbs[].error_class` | 必填 | fire_and_forget / convenience / normal / fatal | 划分合理。但签名 lint 只能检查 `WINK_WARN_UNUSED_RESULT` 与返回类型模式，**无法验证是否真正处理了 status**——应入风险表。 |
| `verbs[].params` | 可选 | 动词签名 | 注释「实施期定语法」。与 cross-field 同问题：要么 P1 定义，要么从 schema 删除直到实施，避免半成品字段。 |

---

## 2. 能力缺口（三处关键）

### 2.1 裸 CMake 字符串是未被 §7 覆盖的安全洞

`extra_cmake_defs` / `extra_cmake_sources` 为**无条件字符串**，无沙箱、无白名单、无路径限制。ssd1306 现网把 `set(...CACHE...)` + `if/elseif/FATAL_ERROR` 整段 CMake 塞入字符串，等于扩展根 YAML 可在 configure 期执行任意 CMake（含 `execute_process` 调任意命令）。这比 §1.4 花大力气上沙箱的 Jinja 危险得多，且 §7 风险表未覆盖此面。

**建议**：吸收 ssd1306「字体二选一」模式，改声明式 `build_variants:`：

```yaml
build_variants:
  - name: font
    type: enum
    values: [minimal, ascii_upper]
    default: ascii_upper
    compile_defines:
      minimal: WINK_SSD1306_FONT_MINIMAL=1
      ascii_upper: WINK_SSD1306_FONT_ASCII_UPPER=1
    extra_sources:
      minimal: dal/src/display/dal_ssd1306_font_5x7_minimal.c
      ascii_upper: dal/src/display/dal_ssd1306_font_5x7_ascii_upper.c
```

裸 CMake 退化为极少数「引擎无法表达」的 escape hatch；引擎不再需要防御 CMake 注入面。

### 2.2 enum→C 常量映射缺失

`clock_requirement: auto` → `DAL_RC_SERVO_CLOCK_AUTO`、ssd1306 字体等都是「用户填字符串枚举、生成侧转 C 常量」的高频模式（现网 `rc_servo.py:12` `_CLOCK_TO_C`）。§4.4 声称支持 enum，但 §4.3 只给了 int min/max。应在 `constraints`（或合并后的 `fields`）中一等公民支持 `enum` + `map`。

### 2.3 条件字段发射（rc_servo 活在切片里）

`rc_servo.py:120-124` 的核心逻辑：**仅当 spec 显式设置时才发射 `.resolution_bits` / `.clock_requirement` 结构体成员行**（0 = AUTO，不产出该行）。当前 `config.init_template` 是固定块标量，无法表达「字段缺省则整行消失」。若用 Jinja `{% if %}` 又撞上 §4.4「禁止多分支控制流」。

这暴露了 P1 只选 ultrasonic 作样例的隐患：**rc_servo / ssd1306 的表达力问题被推给了「留内置」**，但 P3 目标集又明确列了它们。建议 schema 增加声明式可选字段发射：

```yaml
config:
  struct_fields:
    - c_name: resolution_bits
      from: resolution_bits
      emit_when: present        # present | always
      c_suffix: u
    - c_name: clock_requirement
      from: clock_requirement
      emit_when: present
      map: { auto: DAL_RC_SERVO_CLOCK_AUTO, stable_required: DAL_RC_SERVO_CLOCK_STABLE_REQUIRED }
```

如此 rc_servo 的 config 发射完全声明式，无需「留内置」，反而能验证 schema 真实表达力。

### 2.4 `.owner = "<dev_name>"` 框架契约未内建

所有驱动（`ultrasonic.py:113`、`ssd1306.py:78`、`rc_servo.py:117`）的 config 都含 `.owner = "{dev_name}"`。这是框架契约，不应在每份 YAML 的 `init_template` 里重复手写（易漏易错）。建议 `init_template` 默认注入 `owner`，或 schema 内建约定。

### 2.5 `is_actuator` 降为可选派生与工程判定黄金法则

**降级方案**：
`is_actuator` 不应作为必填项强加给每份 YAML，但也不宜彻底删除：
- **引擎默认派生**：当 YAML 未声明 `is_actuator` 时，由引擎根据 `category == "actuator"` 自动推导为 `true`；
- **保留 Escape Hatch**：允许非 `actuator` 分类的设备（如 `category: output` 的 `led.yaml` 或蜂鸣器）显式声明 `is_actuator: true`，以接入 Safe-Off 注册。

**架构师总结：`is_actuator` 的工程判定黄金法则**：
在为 DAL 驱动编写描述时，可按以下 3 步决策树判断是否需要启用 `is_actuator`：
1. **控制方向**：MCU 是否向它发送控制信号？（输出类外设）
2. **物理影响**：它是否直接控制物理世界的动能 / 热能 / 光能 / 大电流 / 流体？
3. **安全准则（Golden Rule）**：当系统死机、崩溃、Panic 或按下急停按钮时，这个外设如果不强制复位/关断（Safe-Off），**是否可能引发事故、损坏硬件、浪费能源或伤害用户？** 只要符合第 3 条，即必须确保 `is_actuator` 为 `true`。

**常见设备归类示例**：
- **电机类（直流电机、步进电机、舵机）** ➔ **是 Actuator**（强物理动能控制）。
- **开关与电力控制类（继电器、电磁阀）** ➔ **是 Actuator**（控制强电/高压/水气流通断）。
- **高危能量类（加热棒、抽水泵、高功率激光器）** ➔ **是 Actuator**（不关断极易发生火灾/淹水/设备烧毁事故）。
- **普通状态指示灯（如板载小 LED）** ➔ 一般算 `output`，不需要复杂 safe-off（但标为 `is_actuator: true` 也不影响安全，只是多生成一小段注册逻辑）。

### 2.6 `category` 降为基于 DAL 目录自动反向派生

**痛点与冗余**：
现网所有 DAL 驱动的 C 头文件/源文件路径规范为 `dal/include/<category>/dal_<type>.h`（例如 `dal/include/sensor/dal_ultrasonic.h`）。在 YAML 中强制要求手写 `category: sensor` 形成了“磁盘目录路径”与“YAML 字段”两处真值（信息冗余）。

**建议方案**：
- **降为可选**：YAML 默认可省略 `category` 字段。
- **引擎自动反向推导**：引擎解析 YAML 时，若 `category` 为空，自动扫描 `dal/include/*/{dal_<type>.h,dal_<stem>.c}`，取其父目录名称（如 `sensor`）作为 `category`。
- **兜底支持**：仅当 C 文件尚未创建（纯 Stub 阶段）或属于第三方非标准路径时，允许/要求显式填写 `category` 进行覆盖。

### 2.7 `config:` 块降为可选：推行“约定优于配置”（Convention Over Configuration）与全自动 C 初始化生成

**可行性分析（100% 完全可行）**：
Wink OS 的 DAL 驱动在 C 语言层有着极度严格、统一的命名契约：
1. 设备类型：`dal_<type>_t`
2. 配置结构体：`dal_<type>_config_t`
3. C 头文件：`dal_<type>.h`
4. 初始化 API：`WINK_TRY(dal_<type>_init(&<dev_name>, &<dev_name>_cfg))`
5. 反初始化 API：`dal_<type>_deinit`
6. 安全关断 API：`dal_<type>_off`

当合并为单一 `fields:` 字典表（见 §3）后，CodeGen 引擎**已经完全掌握了每个字段的 C 成员名、数据类型、默认值与发射条件**。引擎完全有能力根据 `type` + `fields:` 自动生成 100% 标准的 C99 指定初始化结构体（Designated Initializers）及初始化调用代码，开发者**根本不需要编写任何 `config.init_template` 或 `config` 块代码**。

**架构建议**：
- **`config:` 块整体降为可选**：标准 DAL 驱动（占 80%~90%）在 YAML 中**完全不需要手写 `config:` 块**。
- **保留 Override 接口**：仅当驱动包含非标 C API 命名或复杂的 `post_init` 钩子时，才需要在 YAML 中显式声明 `config:` 块覆盖。

### 2.8 `role_bindings:` 块能力边界：简单动词自动推导与复杂适配动词手写

**边界分析（精准区分两类动词）**：

1. **基础直通动词（可全自动推导，占 ~60%）**：
   - 动词签名与底层 C 函数 1:1 对应（如 `set_speed` ➔ `dal_dc_motor_set_speed(&dev, speed)`）。
   - 常见语义别名（如 `activate -> on`, `deactivate -> off`）。
   - 引擎读取 `roles/<role>.yaml` 动词列表后，可由通用规则全自动推导生成 C wrapper，驱动 YAML 中可省略 `role_bindings:`。

2. **复杂适配与事件构造动词（无法自动推导，必须手写 `role_bindings:`）**：
   - **多步骤/事件配置构造**：如 `button.py` 和 `ultrasonic.py` 的 `enable_events`，需要从设备 spec 读取参数（如 `event_drive`、`debounce_ms`），构造 `wink_button_event_config_t` 静态结构体后再调用底层 API。
   - **C 参数解包/指针转换**：如 `button.py` 的 `is_active`（将 C API 的输出指针参数 `dal_button_is_pressed(&dev, &p)` 解包转换直接返回 `bool`）。
   - 此类复杂逻辑无法凭简单命名规则推算，**必须在驱动 YAML 的 `role_bindings:` 中手写 C 模板（或外置 `.c.j2` 模板）**。

**架构建议**：
- **`role_bindings:` 降为可选，但必须保留**：简单驱动可享受零手写推导；复杂驱动（如带事件总线挂钩的按键/超声波）通过手写 `role_bindings:` 进行精准表达。

---

## 3. 结构性建议：合并 `*_fields` 为单一 `fields:`

### 3.1 问题

字段属性目前分散在四个列表：`required_fields`（必填）、`stable_fields`（用户面分级）、`advanced_fields`（同）、`constraints`（类型/域/默认）。`auto_poll_ms` 出现在 2 处、`trig_pin` 出现在 3 处。加一个字段或改一个属性要改多处，违反本设计 §3.4 自己强调的「单入口 SSOT」精神。

### 3.2 方案

合并为单一 `fields:` 表，其余列表由引擎派生：

```yaml
fields:
  trig_pin:     { tier: advanced, type: int,    required: true,  min: 0, max: 39 }
  echo_pin:     { tier: advanced, type: int,    required: true }
  auto_poll_ms: { tier: stable,   type: int,    default: 50, min: 50, on_violation: error }
  role:         { tier: stable,   type: string, optional: true }
  use_rmt:      { tier: advanced, type: bool,   default: true }
```

引擎派生：`required_fields`/`stable_fields`/`advanced_fields`/`constraints` 全部从 `fields:` 生成，供 `list_drivers` 与 `user_surface` lint 消费。

### 3.3 收益

1. **SSOT**：每字段属性定义在一处。
2. **一致性**：不会出现「`required_fields` 有某字段但 `constraints` 漏了它」的裂缝。
3. **可读性**：一眼看清每字段的分级、类型、默认、约束。

---

## 4. 汇总建议清单

| # | 建议 | 优先级 | 关联 §4 |
|---|------|--------|---------|
| S1 | 裸 `extra_cmake_*` 改声明式 `build_variants:`，补 §7 风险表 | **高** | §4.1 / §4.3 |
| S2 | 增加声明式条件字段发射（`struct_fields[].emit_when`），使 rc_servo/ssd1306 可迁 | **高** | §4.3 |
| S3 | 合并 `required/stable/advanced_fields` + `constraints` 为单一 `fields:` | **高** | §4.1 / §4.3 |
| S4 | `constraints` 补 `enum` + 值→C 常量 `map`；补 `bool` 类型 | 中 | §4.3 / §4.4 |
| S5 | `config.config_type` 降为可选（默认从 `c_type` 派生） | 中 | §4.3 |
| S6 | 删除 `source_stem`（现网零覆盖），需要时再加 | 中 | §4.1 |
| S7 | `codegen_schema` 改 `"major.minor"` 字符串以支持 N−1 窗口 | 中 | §4.2 |
| S8 | `config.safe_off_fn` 空值默认派生规则写入 schema | 低 | §4.3 |
| S9 | 明确 `on_violation: warn` 的 CI 退出语义 | 低 | §4.3 |
| S10 | cross-field / `verbs[].params` 语法：P1 定义或删除，勿留半成品 | 低 | §4.3 / §4.5 |
| S11 | `error_class`↔签名 lint 的能力边界（无法验证 status 是否被处理）入风险表 | 低 | §4.5 |
| S12 | `is_actuator` 降为可选（默认由 `category == "actuator"` 派生），写入工程判定黄金法则 | 中 | §1.2 / §2.5 |
| S13 | `category` 降为可选（未填时根据 `dal/include/<cat>/` 目录自动反向派生） | 中 | §1.2 / §2.6 |
| S14 | `config:` 块整体降为可选：引擎基于 `type` + `fields:` 遵循“约定优于配置”全自动生成 C 初始化代码 | **高** | §1.4 / §2.7 |
| S15 | `role_bindings:` 降为可选：引擎基于 `roles/<role>.yaml` 动词列表与别名字典自动推导 1:1 C Wrapper | 中 | §1.5 / §2.8 |

---

## 5. 结论

Schema 骨架方向正确（POD + 声明式，符合 ADR-0004/0046），但**当前 ultrasonic 样例证明不了它对 rc_servo/ssd1306 的表达力**。优先落地 S1–S3：① 裸 CMake 收进声明式 `build_variants`；② 声明式条件字段发射；③ 四表合并为单一 `fields:`。这三项完成后，schema 才达到「最佳化」，且 P3 actuator/display 目标集才迁得动。


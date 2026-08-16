# 评审记录：Wokwi-Elements ↔ DAL 外设三级分类 SSOT (v2.3.1)

| 项 | 内容 |
|---|---|
| **评审对象** | `docs/implementation-plans/frontend/00.1-category-type-variant-wokwi-ssot.md` (v2.3.1，2026-08-07，"全量物理拓扑纠偏、Wokwi@1.9.2 严丝合缝与 C 枚举规范化终态版") |
| **评审日期** | 2026-08-07 |
| **评审人** | Claude Code (Wink-AI embedded session) |
| **评审方法** | ① 逐项读取 vendored 源码 `D:\workspaces\open-source\embedded\wokwi-elements\src`（v1.9.2），以 `@customElement` 注册名与 `pinInfo` 数组为元件名/引脚的唯一事实源；② 全量核对 `wink-micro-os/dal/include/` 下真实头文件的 variant 枚举与 config 字段；③ 检查文档内部不变量自洽性与 ADR-0004 静态分发范式一致性；④ 与前序评审 [`2026-08-07-wokwi-dal-ssot-review.md`](2026-08-07-wokwi-dal-ssot-review.md)（针对 v2.2.0）对账 |
| **关联文档** | 上级主计划 `00-master-execution-plan.md`；技术设计 `2026-08-07-bare-component-driver-module-synthetic-netlist-design.md`；ADR-0004 静态分发、ADR-0056 跨 Profile 量纲 |
| **总体结论** | 架构骨架（三级分类、6 维度变体、边界 A/B/C/D、§4.5 复合件拆解、§4.6 拓扑/配置分离）扎实，多数 native tag 与逻辑引脚角色核对无误。但"严丝合缝/终态版"的宣称与代码/元件真相存在多处**实质性矛盾**：状态矩阵对多个已落地 Type 谎称 ✅ Completed、多处引脚拓扑硬错、计数错误、v1.9.2 原生裸件盘点遗漏，且一处基础设施"虚表"用词违反 ADR-0004。建议按 P0 清单出 v2.3.2 errata。 |

---

## 0. 事实核查结论速览

- **最关键问题：§3 状态矩阵诚信失真。** `button`、`mono_oled`、`relay` 三个标 ✅ Completed 的 Type，其 C 代码与 SSOT 描述的 variant 模型**不一致**；`ultrasonic`/`gps`/`eeprom` 的审计栏以完成时口吻描述了代码里根本不存在的 variant 枚举/字段。
- **引脚拓扑硬错 4 处**：`led_bar`（实为 20 脚非 11 脚）、`seg_display`（4-digit 实为 14 脚非 12 脚）、`mpu6050`（漏 XCL/XDA，实为 8 脚非 6 脚）、`dht22`（4 脚含 NC 非 3 脚）。
- **计数错误**：标题/§2/§3 均称"全量 30 个 DAL Type"，实际编号去重后为 32 个（1–27 + 5b + 18b + 28–30）。
- **原生元件盘点遗漏**：§1.3 称 v1.9.2 "完全缺失 relay"，但 `wokwi-ks2e-m-dc5`（DPDT 信号继电器）原生存在；`wokwi-resistor`、`wokwi-pushbutton-6mm` 也未被纳入 synthetic netlist / alias 视野。
- **架构冲突 2 处**：`biaxial-stepper` 新建 8 脚 variant 违反 §4.5 自身的复合件拆解契约；`rotary-dialer` 无法拆为 encoder+button（无 A/B 正交相）；基础设施"虚表"用词违反 ADR-0004。
- **门禁薄弱**：§5.1 的 `_Static_assert` 模板只能抓"末尾追加变体"，抓不到"中间插入"，给虚假安全感。
- **文档分层违规**：自命"活文档/SSOT"却放在 `implementation-plans/`（一次性 ③ 层），按 CLAUDE.md 应提升至 ① 设计规范目录。

---

## 1. P0 — 事实性错误（与代码/元件直接矛盾，必须改）

### P0-1 `led_bar` 引脚拓扑错误（§2.2 #8）

**SSOT 写**：`[PIN_0..PIN_9, COM]` (11Pin)，"接公共端后 10 控制脚"。

**源码真相**（`wokwi-elements/src/led-bar-graph-element.ts:30-51`）：`pinInfo` 是 **20 脚** —— `A1..A10` + `C1..C10`，内部是 10 颗独立 LED，**没有公共 COM**。所谓 11 脚是"把 10 个 C 在外部短接到 GND"后的合成节点，并非元件物理脚。

**后果**：既然文档宣称"严丝合缝对齐 v1.9.2 pinInfo"，就必须显式写明这是 20→11 的 synthetic tie-down（由 Codegen 按 §4.6 合成 C 短接网表），否则引脚数是硬错，且会让 `variant_fields` 的 `-1` 哨兵推导基于错误基线。

---

### P0-2 `button` "变体完全规范对齐 ✅" 与代码矛盾（§2.1 #1 / §3）

**SSOT 写**：`toggle_switch` = `[COM, NC, NO]` 3Pin，`tilt_switch` = `[VCC, GND, OUT]` 3Pin，状态 ✅ Completed。

**代码真相**（`dal/include/input/dal_button.h:48-53`）：
```c
typedef struct {
    const char *owner;
    uint16_t pin;            // 单脚
    bool active_low;
    dal_button_pull_t pull;
} dal_button_config_t;
```
config 只有单个 `pin`，**无法表达 SPDT 的 COM/NC/NO 三脚，也无法表达 tilt 模块的 VCC/GND/OUT 有源三脚输出**。C 侧目前是"单脚开关"抽象。

**结论**：这两个变体要么扩 config（增加 `pin2`/拓扑角色），要么把状态从 ✅ Completed 改为 🚧/🆕。不能在 C 代码只有单脚的情况下宣称已对齐。

---

### P0-3 `mono_oled` 变体枚举与代码完全不一致（§2.5 #19 / §3）

**SSOT 写**：变体为 `ssd1306_i2c` / `ssd1306_spi`；审计栏称 "`sh1106` 下沉至 `config.panel_ic` (`DAL_MONO_OLED_IC_SH1106`)"。

**代码真相**（`dal/include/display/dal_mono_oled.h:24-28`）：
```c
typedef uint8_t dal_mono_oled_variant_t;
enum {
    DAL_MONO_OLED_VARIANT_SSD1306 = 0,  /* SSD1306 (default) */
    DAL_MONO_OLED_VARIANT_SH1106  = 1,  /* SH1106 */
};
```
**sh1106 仍是 variant，根本没有下沉；代码里不存在 `ssd1306_i2c`/`ssd1306_spi` 这两个枚举值，也没有 `panel_ic` 字段。** SSOT 描述的是计划态而非代码态。且该文件有 `sizeof(dal_mono_oled_variant_t)==1` 的 ABI 锁（第 32、35 行），改动需 ADR 级评审。状态标 🚧 In Progress 可接受，但审计文字必须改为"待迁移"而非"已更正"。

---

### P0-4 `relay` "ssr 降为 alias" 未落地（§2.2 #7 / §3）

**SSOT 写**：`direct_gpio`，"(`ssr` 降为 alias)"，状态 ✅ Completed。

**代码真相**（`dal/include/output/dal_relay.h:23-27`）：
```c
typedef enum {
    DAL_RELAY_VARIANT_DIRECT_GPIO       = 0,
    DAL_RELAY_VARIANT_SSR               = 1,  // 仍是独立枚举值
    DAL_RELAY_VARIANT_LATCHING_DUAL_PIN = 2,
} dal_relay_variant_t;
```
SSR 仍是独立枚举值 = 1，不是 alias。要么真的合并为 `direct_gpio` 的 alias（删枚举值并处理 ABI/已有配置），要么把状态降级。

---

### P0-5 `gps` / `eeprom` / `ultrasonic` 缺 variant 字段（§3 #13/#24/#25）

- **gps**（`dal/include/comm/dal_gps.h:34-39`）：`dal_gps_config_t` 只有 `owner/uart_port/baudrate/rx_buffer_size`，**无 `variant` 字段**，不存在 `dal_gps_variant_t`。
- **eeprom**（`dal/include/storage/dal_eeprom.h:27-34`）：`dal_eeprom_config_t` 有 `capacity_bytes/i2c_addr/page_size/write_time_ms/i2c_port`，**无 `variant` 字段**。
- **ultrasonic**（`dal/include/sensor/dal_ultrasonic.h:26-31`）：只有 `trig_pin/echo_pin/bool use_rmt`，**没有 `dal_ultrasonic_variant_t` 枚举，也没有 variant 字段**。

SSOT 对 gps/eeprom 用 ⚠️ In Progress + "预留 nmea_i2c/spi_eeprom" 口吻尚可，但 **ultrasonic 审计栏写"新设 `dal_ultrasonic_variant_t` 枚举（hcsr04/single_pin_ping/uart_stream/i2c）"是完成时陈述，实际一行未落地**。按 §4.1 / 边界 D，这三个 Type 要么补 variant 占位枚举 + config 字段，要么如实写"当前为单配置、variant 待引入"。当前 `use_rmt` 还停留在 bool，未按边界 C 下沉为 `config.backend`。

---

### P0-6 "全量 30 个 DAL Type" 计数错误

§2 标题、§2 引言、§3 引言均写 "30 个 DAL Type"。编号去重后实际为 **32 个**：1–27（27 个）+ 5b `rgb_led` + 18b `load_cell` + 28/29/30 infra = 32。需全局更正。

---

### P0-7 "v1.9.2 无 relay" 遗漏原生 `wokwi-ks2e-m-dc5`

§1.3 把 relay 列为 "v1.9.2 完全缺失对应的驱动模块或器件"。源码真相（`ks2e-m-dc5-element.ts:12-23`）：存在 `wokwi-ks2e-m-dc5`（DPDT 信号继电器，8 脚：NO1/NC1/P1/COIL1 + NO2/NC2/P2/COIL2）。

它确实不是 3 脚继电器*模块*（无驱动三极管/续流二极管），但是 v1.9.2 自带的原生继电器裸件。在技术方案 `bare-component-driver-module-synthetic-netlist-design.md` 的"方案 B（Codegen Synthetic Netlist）"路径下，`direct_gpio` 完全可以用 `ks2e-m-dc5` + 合成驱动三极管网表实现，而非全 Custom。文档对原生裸件清单盘点不完整 —— `wokwi-resistor` 也存在但未被任何 synthetic netlist 引用。建议 §1.3 区分"无模块级元件"与"有裸件可合成"。

---

## 2. P1 — 内部矛盾 / 架构冲突 / 门禁薄弱

### P1-1 `stepper dual_axis_four_wire` 违反 §4.5 复合件拆解契约（§2.3 #11）

`wokwi-biaxial-stepper` 是两个独立 4 线步进（`A1±/B1±` + `A2±/B2±`，`biaxial-stepper-element.ts:48-`）。按 §4.5 明文规定"复合硬件必须拆解"（摇杆 → 2× `analog_knob` + 1× `button`；KY-040 → `encoder` + `button`），双轴步进应拆为 **2× `stepper four_wire`**，而不是新建一个 8 脚 `dual_axis_four_wire` variant。文档在同一节里自相矛盾，需二选一：要么拆解（与 §4.5 一致），要么显式给双轴步进开一个"巨型复合驱动"例外并说明理由。

### P1-2 `rotary_dialer` 无法拆成 encoder + button（§2.1 表第 95 行）

`wokwi-rotary-dialer` 脚为 `[GND, DIAL, PULSE]`（`rotary-dialer-element.ts:13-15`）。PULSE 是拨号簧片产生的断通脉冲计数，DIAL 是选通信号 —— **没有 A/B 正交相**，无法喂给 `dal_encoder` 的 x1/x2/x4 正交解码状态机。拆解契约在电学上不成立。它更接近"脉冲计数 + 选通"语义，需要独立的 pulse-counter 处理或归为 Custom，不能写成 encoder+button。

### P1-3 基础设施"虚表"用词违反 ADR-0004（§2.7 注 + §4.7）

项目核心范式是编译期静态分发，明确禁止 vtable / `container_of`（CLAUDE.md + ADR-0004）。但文档写"向系统注册虚拟 `dal_gpio_provider_t` / `dal_i2c_bus_provider_t` **虚表**"。Provider 接口可以用 init 时绑定的 config 函数指针或静态命名 API 实现，但**不能叫"虚表"，也不能暗示运行期多态**。这是会误导实现者生成 ops 结构体的架构性用词错误，需改为"静态分发的 provider 接口/回调集合"之类表述。

### P1-4 `mpu6050` 漏脚（§2.4 #18）

SSOT 写 6 脚 `[VCC, GND, SCL, SDA, AD0, INT]`。源码真相（`mpu6050-element.ts:10-18`）是 **8 脚**：还含 `XCL`、`XDA`（辅助 I2C，用于外挂磁力计）。多数应用不用，但"严丝合缝"版不能漏；应列入完整 8 脚并注明 XCL/XDA 非活跃、Codegen 赋 `-1`。

### P1-5 `seg_display direct_gpio` 脚数错误（§2.5 #23）

SSOT 写 12 脚 `[A-G, DP, DIG1-DIG4]`。源码真相（`7segment-element.ts:52-69`，`digits=4` / KW4-56NALB）实际返回 **14 脚**：A-G + DP + DIG1-4 + **COM**（公共端，必接）+ **CLN**（冒号，时钟模式）。12 脚不对。且 `digits=1/2/4` 三种配置脚数/角色不同（`7segment-element.ts:52-116`），按 §4.1"零歧义"原则需说明 `digits` 如何进 config 以及非 4-digit 时的 pin map。

### P1-6 §5.1 门禁 2 的 `_Static_assert` 模板抓不到中间插入

```c
_Static_assert(DAL_<TYPE>_VARIANT_<LAST> == <N-1>, ...);
```
只能抓"追加变体忘改 N"，抓不到"在中间插入新变体并把 LAST 顺延"（末值仍为 N-1）。必须同时断言计数：
```c
_Static_assert(DAL_<TYPE>_VARIANT_<LAST> + 1 == <N>, "...");
// 或显式定义 DAL_<TYPE>_VARIANT_COUNT == <N>
```
当前模板给了虚假的安全感。建议在所有已有 variant 枚举上补齐 count 断言。

### P1-7 文档放置违反四层文档体系

文件自命"唯一真理源 / 活文档"，却放在 `implementation-plans/2026-08-05-.../`（③ 一次性计划层）。按 CLAUDE.md，SSOT 属 ① 设计规范（应落在 `02-wink-micro-os/` 或 `03-app-codegen/`）。建议：把 SSOT 正文（§1/§2/§4/§5）提升到设计规范目录，plan 目录只留任务拆分与状态矩阵（§3），并在两处互相交叉引用。

### P1-8 §5.1 门禁 3 混淆行级 / Type 级 `affects_pins`

§1.1 定义 `affects_pins` 是变体行级布尔，§4.3 说 YAML 字段级是"该 Type 任一行的 OR"。但门禁 3 写"`affects_pins: true` 时不同 Variant 的 `variant_fields` 必须至少有一个引脚字段集合不同"，未说明是"行级 true 的变体两两比对"还是"type 级 OR=true 时全量比对"。像 `analog_knob` 4 个变体全是 `affects_pins=false`（taper 算法不同、引脚集合相同），门禁不应要求它们字段不同。语义需澄清，否则 lint 规则会误判。

---

## 3. P2 — 补充与改进建议

### P2-1 `heart_rate_ao` 归类存疑（§2.4 #14）
`wokwi-heart-beat-sensor` 是 `[GND, VCC, OUT]` 3 脚，OUT 的 signals 为 `[]`（`heart-beat-sensor-element.ts:8-10`），**没有 `analog()` 标注**。心率模块通常输出数字脉冲而非模拟电压。把它塞进 `analog_sensor` 的 `_ao` 变体可能归类错误，至少需核对元件行为模型再定。

### P2-2 `digital_sensor threshold_do` 漏 `photoresistor`（§2.4 #15）
`wokwi-photoresistor-sensor` 同时有 `DO` 和 `AO`（`photoresistor-sensor-element.ts:12-15`）。SSOT 在 analog 侧列了它，`threshold_do` 行却只列 flame/gas/big-sound/small-sound，漏掉 photoresistor。AO/DO 对称性不完整（与近期 commit `ed0f6a2` 补 flame/sound/gas/heart_rate 对称的方向也不一致）。

### P2-3 `dht22` 漏标 NC 脚
`dht22-element.ts:8-11` 是 4 脚 `[VCC, SDA, NC, GND]`，SSOT 写 3 脚。NC 逻辑上可忽略，但既然宣称物理拓扑全量，应注明第 3 脚 NC 由 Codegen 留空。

### P2-4 `lcd_char parallel_4bit` 应显式列出合成脚清单
`wokwi-lcd1602` full 模式 16 脚含 `V0`（对比度）、`RW`（常接 GND）、`A/K`（背光）。SSOT 只列 6 个逻辑脚符合"逻辑角色优先"，但 §4.6 应给出"电源/常控脚由 Codegen 合成"的显式清单（RW→GND、V0→电位器/GND、A/K→背光），否则生成 `diagram.json` 时会漏线。

### P2-5 `analog_knob` 滑杆共享 4 种 taper 需说明
旋转 `wokwi-potentiometer` 与滑杆 `wokwi-slide-potentiometer` 两行都列了全部 4 种 taper。但 taper 是 BAL 算法维度（`affects_pins=false`），元件物理上是线性的，曲线由软件校正。应点明"slide 行复用全部 taper 是因为 taper 属算法变体而非元件物理属性"，避免误读为滑杆物理上有 log 型。

### P2-6 DS1307 是 5V 器件，需电平注意
`ds1307-element.ts:9` 标 `VCC(5)`。在 ESP32 3.3V 系统中，SDA/SCL 开漏可承受但上拉电压影响电平；建议在 §4.4 aliases 或新增"工作电压/电平注意"列注明，避免真机集成踩坑。

### P2-7 `dc_motor` Custom element 渲染语义未定义
三个变体（in_in / phase_enable / pwm_on_in）都指向 `wink-custom-dc-motor`，但未说明 custom element 渲染的是"驱动板+电机"还是仅电机本体。L298N/TB6612/DRV8833 是驱动板，DAL 控制的是驱动输入；仿真里电机本体可无模型。应在技术设计里明确 custom element 的视觉边界（板级 vs 纯电机），否则前端元件不一致。

### P2-8 `pushbutton-6mm` 未纳入
v1.9.2 还有 `wokwi-pushbutton-6mm`（不同封装视觉、同电学）。可作为 `push_button` 的 alias 或外观参数，目前完全没提。

### P2-9 复合件拆 8×button 的合成约束未写（§4.5 / dip_switch_8）
`wokwi-dip-switch-8` 每路是 SPST 两脚（`1a/1b .. 8a/8b`），不是单脚到 GND。拆成 8×button 时需把每路一端合成到 GND/VCC，这个 tie-down 规则应进 §4.5/§4.6。`wokwi-pushbutton` 的 4 脚（`1.l/2.l/1.r/2.r`）→ 2 节点合成同理。

---

## 4. 扎实、值得保留的部分

- **三级模型与边界判定**：Category→Type→Variant + 边界 A/B/C/D 整体清晰。边界 C（SOC 解调引擎如 RMT/DMA 下沉 `config.backend`）、边界 D（单值 Type 预留第二变体扩展位以让 `_Static_assert` 有演进价值）是正确的工程判断。
- **§4.2 配置隔离**：variant 只进 `dal_<type>_config_t`、公开 API 保持 `init/read/set`、禁止按 variant 派生子函数，与 ADR-0004 静态分发一致。
- **§4.6 职责切分干净**：前端外设包独占物理拓扑（element 绑定、relX/relY、默认 wire net），Codegen YAML 只管 C config 与 `-1` 哨兵裁剪。已验证 `wink-tools/tools/codegen/` 下无 `wokwi_binding` 残留（grep 零命中），落地到位。
- **ABI 纪律**：`-1` 哨兵裁剪非活跃脚 + config 平铺，配合代码里已有的 `_Static_assert(sizeof... )` 尺寸守卫（ultrasonic/button/gps/eeprom/mono_oled 均有 ILP32/LP64 双档断言），是高水准嵌入式 ABI 工程。
- **多数 native 元件核对无误**：servo、hc-sr04、hx711、pir、ssd1306、ili9341、microsd、dht22（主体）、mpu6050（主体）、buzzer、ir-receiver 等 tag 名与逻辑引脚角色正确。

---

## 5. 建议修订优先级

1. **先修 P0-2/3/4/5（状态矩阵诚信问题）**：重新核对 button/mono_oled/relay/ultrasonic/gps/eeprom 的真实代码状态，把谎称 Completed 的降级，把完成时口吻改为计划态。这是会误导排期的根本问题。
2. **修 P0-1/6/7 + P1-4/5（引脚/计数/盘点硬错）**：发 v2.3.2 errata，逐条对齐 `pinInfo`。
3. **P1-1/2/3 架构一致性**：biaxial-stepper 拆解、rotary-dialer 语义、provider"虚表"用词，应在动工前定调，必要时补 ADR。
4. **P1-6 强化 `_Static_assert`**：补 count 断言模板并回灌到已有 variant 枚举。
5. **P1-7 文档分层搬迁**：SSOT 正文提升至 ① 设计规范目录，单独 commit。
6. P2 按需补充。

---

*本评审为时间点快照，针对 v2.3.1。后续版本修订请另起评审记录，不回填本文件。*

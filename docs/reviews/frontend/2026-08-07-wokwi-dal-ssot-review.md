# 评审记录：Wokwi-Elements ↔ DAL 外设三级分类 SSOT (v2.2.0)

| 项 | 内容 |
|---|---|
| **评审对象** | `docs/implementation-plans/frontend/00.1-category-type-variant-wokwi-ssot.md` (v2.2.0, 2026-08-07) |
| **评审日期** | 2026-08-07（v2：同日修订，更正元件存在性判定）|
| **评审人** | Claude Code (Wink-AI embedded session) |
| **评审方法** | ① **直接读取 vendored 源码** `D:\workspaces\open-source\embedded\wokwi-elements\src`（**v1.9.2，50 个 `*-element.ts`**），以每个文件的 `@customElement('wokwi-xxx')` 注册名和 `pinInfo` 数组为元件名/引脚的唯一事实源；② 全量核对 `wink-micro-os/dal/include/`、`dal/src/` 与 `codegen/drivers/*.yaml`；③ 检查文档内部不变量自洽性；④ 与前序评审 [`2026-07-29-wokwi-elements-dal-type-coverage-review.md`](2026-07-29-wokwi-elements-dal-type-coverage-review.md) 对账 |
| **总体结论** | 架构骨架（三级分类 / 6 维度 / 2 边界不变量 / 复合件拆解）质量高、可作终态基线；但作为宣称"唯一真理源/绝不妥协"的 SSOT，存在：**元件版本基线未钉死（最关键）**、若干引脚拓扑错误、3 处虚构 tag、§3 审计 3 项与代码相反、表格与自身不变量矛盾。建议按 P0 清单修订。 |

> **v2 修订说明（2026-08-07）**：v1 评审错误地以 docs.wokwi.com（较新版本，58 元件）为权威，把本地源码里**真实存在**的 `wokwi-neopixel-matrix`、`wokwi-rotary-dialer`、`wokwi-flame-sensor`、`wokwi-big/small-sound-sensor` 等判为"404 不存在"。v2 改为以 vendored 源码 **v1.9.2** 为准，并相应撤回了基于新版元件（relay-module/a4988/tm1637-7segment/74hc595/led-strip）的修改建议。详见 §1.0。

---

## 0. 事实核查结论速览

- **最关键问题：元件版本基线未钉死。** 本地参考源码是 **wokwi-elements v1.9.2（50 元件，43 个外设）**，而 SSOT 混用了 docs.wokwi.com 新版（58 元件）才有的元件（`wokwi-relay-module` 隐含、`wokwi-max7219-matrix` 等）。Wink 仓库当前**没有任何 package.json/锁文件/bridge 代码引用 wokwi-elements**，"仿真跑哪一版"未被清单钉死。
- 30 个 DAL type 中，**仅 14 个在代码中真实存在**（button / analog_knob / keypad / led / buzzer / relay / dc_motor / rc_servo / encoder / ultrasonic / mono_oled / gps / eeprom），其余 16 个尚未落地——可接受（SSOT 是终态），但文档需明确三态。
- §3 审计 13 项中，**#7 / #8 / #9 三项描述与代码相反**（已完成的工作被标为"待修"）。
- 确属虚构/拼错的 tag（v1.9.2 与新版都没有或拼错）：`wokwi-sht30`、`wokwi-gps`、`wokwi-24c02`、`wokwi-ntc`（应为 `wokwi-ntc-temperature-sensor`）、`wokwi-sound-sensor`（应为 `wokwi-big-sound-sensor` / `wokwi-small-sound-sensor`）。
- 引脚拓扑错误（直接来自源码 `pinInfo`，与版本无关）：relay 用的裸 DPDT 不是 3 脚模块、stepper 是双极线圈不是 IN1–IN4、ssd1306 功能仅 I2C、neopixel 是单颗不是灯条。
- C 枚举列命名风格三制并存，与代码已统一的 `DAL_<TYPE>_VARIANT_<NAME>` 约定不符，无法支撑 §5.1.2 的 `_Static_assert` 门禁。

---

## 1. Wokwi 元件问题

### 1.0 【P0｜最关键】元件版本基线未钉死，SSOT 两版混用

**事实**：
- 本地 vendored 源码 `D:\workspaces\open-source\embedded\wokwi-elements` 为 **v1.9.2**（`package.json` version 1.9.2，git `v1.9.2-14-g2007dd5`，2026-06-20），`src/` 下共 **50 个 `*-element.ts`**，去掉 6 块开发板（arduino-uno/nano/mega、esp32-devkit-v1、franzininho、nano-rp2040-connect）+ `resistor` = **43 个外设元件**。
- docs.wokwi.com 是**更新版本**，含 58 个 `wokwi-*` 元件，比 v1.9.2 多出至少：`wokwi-relay-module`、`wokwi-a4988`、`wokwi-74hc595`、`wokwi-74hc165`、`wokwi-tm1637-7segment`、`wokwi-max7219-matrix`、`wokwi-led-strip`、`wokwi-led-matrix`、`wokwi-nokia-5110-screen`、`wokwi-ds18b20`、`wokwi-nlsf595`、`wokwi-clock-generator`、`wokwi-logic-analyzer`、`wokwi-pushbutton`（新版拆分）等。
- 在 wink-ai-embedded 仓库内 `grep` 未发现任何 `package.json` / 锁文件 / TS bridge 代码引用 `wokwi-elements`，即实际打包版本未被任何清单钉死。

**问题**：SSOT 的元件引用两版混用：
- 多数 tag 取自 v1.9.2（正确，可运行）；
- 但隐含依赖了新版才有的元件（如把继电器当 3 脚模块、`wokwi-max7219-matrix`），这些在 v1.9.2 基线下**跑不起来**。

**建议**：SSOT 头部增加一行权威基线声明，例如：
> **Wokwi 元件基线**：`wokwi-elements@1.9.2`（源码 `D:\workspaces\open-source\embedded\wokwi-elements`）。白名单以该版本 `src/*-element.ts` 的 `@customElement` 注册名为准；引用该版本不存在的元件一律标 🔴 Custom；若要引入新版元件（relay-module / a4988 / 74hc595 / tm1637-7segment / max7219-matrix / led-strip / led-matrix …），须先升级依赖、更新 vendored 源码与版本号，再在本表登记。

同时 §5.1 第 3 条的白名单必须建立在这份 vendored 源码的 `@customElement` 注册表上，而非 docs 站。

### 1.1 【P0】确属虚构 / 拼错的 tag（源码中不存在或名称错误）

直接核对 v1.9.2 每个 `@customElement('wokwi-xxx')`：

| 行 | SSOT 写法 | 源码事实 | 应改为 |
|---|---|---|---|
| 14 analog_sensor (NTC) | `wokwi-ntc` | 注册名是 **`wokwi-ntc-temperature-sensor`**（`ntc-temperature-sensor-element.ts:5`），引脚 GND/VCC/OUT(analog) | 改 tag |
| 15 digital_sensor | `wokwi-sound-sensor` | 无此 tag；源码是两个独立元件 **`wokwi-big-sound-sensor`** 与 **`wokwi-small-sound-sensor`**（均有 AOUT/DOUT） | 用 `wokwi-big-sound-sensor`（或 small），或写自定义 |
| 16 temp_humidity | `wokwi-sht30` | **v1.9.2 与新版均无此元件** | SHT3x 须 🔴 Custom |
| 24 gps | `wokwi-gps` | **两版均无** | 🔴 Custom（NMEA UART 源）|
| 25 eeprom | `wokwi-24c02` | **两版均无** | 🔴 Custom / Synthetic |

> **v1 评审更正**：`wokwi-neopixel-matrix`、`wokwi-rotary-dialer`、`wokwi-flame-sensor` 在 v1.9.2 源码中**确实存在**（`neopixel-matrix-element.ts`/`rotary-dialer-element.ts`/`flame-sensor-element.ts`），SSOT 引用正确。v1 评审据 docs 站 404 判定其"不存在"是**错误的**，现已撤回。

### 1.2 【P0】元件存在，但引脚 / 拓扑映射错误（依据源码 `pinInfo`）

**① 行 7 relay — 用的是裸 DPDT 继电器，不是 3 脚模块（确定错误）**
- 源码 `ks2e-m-dc5-element.ts` 的 `pinInfo`：`NO2, NC2, P2, COIL2, NO1, NC1, P1, COIL1`，共 8 脚，**没有 VCC/GND/IN**。这是一个双刀双掷裸继电器。
- SSOT 写引脚 `[VCC, GND, IN]`（3 脚模块，带三极管驱动）与该元件不符。
- 关键：v1.9.2 **没有** `wokwi-relay-module`（那是新版元件，见 §1.0），因此不能像 v1 评审建议的那样"换 relay-module"。
- **正解（v1.9.2 基线下）**：详见技术设计方案 [`2026-08-07-bare-component-driver-module-synthetic-netlist-design.md`](../../tech-designs/frontend/2026-08-07-bare-component-driver-module-synthetic-netlist-design.md)。DAL C 驱动与 SSOT 保持标准逻辑控制脚 `[VCC, GND, IN]` 不变，在 SSOT 标注 **🔴 Custom** (`wink-custom-relay-module`)。功率/线圈回路驱动属于前端 Custom Element 或 Codegen 虚拟网表合成层的职责，**不属于 DAL C 驱动层的改动范围**。
- 另：`direct_gpio` 与 `ssr` 在 MCU 侧都是 GPIO 单脚控制、拓扑/API 一致，按边界 B，`ssr` 更适合降为 alias（见 §4.3）。

**② 行 11 stepper — 两个 variant 映射均错，且 v1.9.2 无驱动板元件**
- 源码 `stepper-motor-element.ts` 的 `pinInfo`：`A-, A+, B+, B-`——这是 4 线**双极步进电机本体**（线圈极），不是 `IN1–IN4` 逻辑输入。
- `step_dir`（STEP/DIR/EN）是 A4988/DRV8825 **驱动板**的接口；v1.9.2 **没有 `wokwi-a4988`**（新版才有）。
- `four_wire` 标注 `IN1–IN4`（ULN2003/28BYJ-48 风格，单极）映射到双极电机本体也不匹配；v1.9.2 无 ULN2003 元件。
- **正解**：`step_dir` 与 `four_wire` 在 v1.9.2 下均无 🟢 Native 载体，须 🔴 Custom（如 `wink-custom-a4988` / `wink-custom-uln2003`），DAL 保持逻辑引脚 `[STEP, DIR, EN]` 与 `[IN1, IN2, IN3, IN4]`。源码另有 `wokwi-biaxial-stepper`（A1-/A1+/B1+/B1-/A2-/A2+/B2+/B2-，8 脚双轴），SSOT 未覆盖。

**③ 行 19 mono_oled 的 `ssd1306_spi` — 源码功能上只有 I2C**
- 源码 `ssd1306-element.ts` 的 `pinInfo`：`DATA→i2c('SDA')`、`CLK→i2c('SCL')`，而 `DC/RST/CS` 的 `signals: []` 为**空**（引脚画了但不参与仿真）。
- 因此 `ssd1306_spi` 变体在该元件上无法仿真，不能标 🟢 Native，也无法 🟡 Parametric（无属性切 SPI）。
- 这直接影响 §3 审计 #1 的整改方案：把变体改成 `ssd1306_i2c`/`ssd1306_spi` 后，SPI 变体在 v1.9.2 下无仿真载体，须 🔴 Custom 或注明"仅真机目标"。

**④ 行 22 led_matrix — strip 元件映射错；matrix 正确**
- `wokwi-neopixel`（`neopixel-element.ts`）的 `pinInfo`：`VDD, DOUT, VSS, DIN`，仅 `r/g/b` 三个属性、**无 `leds` 数量属性**——它是**单颗** WS2812，不是灯条。SSOT 把 `ws2812_strip` 映射到它做 🟢 Native 不准确（仿真单颗≠灯条）。
- `wokwi-neopixel-matrix`（`neopixel-matrix-element.ts`）**确实存在**，引脚 GND/VCC/DIN/DOUT，有 `rows`/`cols`/`rowSpacing`/`colSpacing`/`blurLight` 属性——SSOT 映射 `ws2812_matrix` 到它是**正确的**（v1 评审此处误判，已撤回）。但注意该元件**没有 `layout=serpentine` 属性**（蛇形映射需驱动层/Custom 处理）。
- v1.9.2 **没有 `wokwi-led-strip` 或 `wokwi-led-matrix`**（新版才有，注意新版 `wokwi-led-matrix` 与 v1.9.2 的 `wokwi-neopixel-matrix` 是不同元件）。
- 另有 `wokwi-led-ring`（环，存在）SSOT 未覆盖；`max7219_spi` 引用的 `wokwi-max7219-matrix` 在 v1.9.2 **不存在**，须 🔴 或升级。

**⑤ 行 23 seg_display 的 `tm1637_two_wire` — v1.9.2 无原生 TM1637 元件，🟡 合理但元件写错**
- v1.9.2 **没有 `wokwi-tm1637-7segment`**（新版才有），所以 v1 评审"改用原生 tm1637"的建议对 v1.9.2 无效。
- `wokwi-7segment`（`7segment-element.ts`）引脚为段脚 `A–G/DP/CLN` + 位脚 `COM/DIG1–DIG4`，是**直驱 GPIO**元件，与 TM1637 两线协议完全不同。
- 因此 `tm1637_two_wire` 在 v1.9.2 下不能映射到 `wokwi-7segment` 做 🟡 Parametric（协议不通），应 🔴 Custom，或升级到含 tm1637 的新版。

**⑥ 行 1 button 的 `toggle_switch` — 元件与引脚错（确定）**
- 源码 `pushbutton-element.ts`：`@property` 只有 `color/pressed/label/xray`；`sticky` 是 **private** 字段，仅由 Ctrl-click 触发（UI 辅助），**无 latching/toggle 变体属性**——即纯点动。
- 3 脚 SPDT 拨动开关在 v1.9.2 中对应 **`wokwi-slide-switch`**（`slide-switch-element.ts`，引脚 `1/2/3`），且另有 **`wokwi-tilt-switch`**（GND/VCC/OUT，3 脚倾斜开关）。
- `toggle_switch` 不能与 `push_button` 共用 `[PIN,GND]` 和同一元件；若选 SPDT，`affects_pins` 应为 `true`（2 脚 vs 3 脚）。07-29 评审把 `slide-switch`/`tilt-switch` 都归入 `button` type 是对的，但 SSOT 未体现。

**⑦ 行 8 led_bar 的 `shift_reg_74hc595` — v1.9.2 无 74hc595，不是 Parametric**
- v1.9.2 **没有 `wokwi-74hc595`**（新版才有）。
- `wokwi-led-bar-graph`（`led-bar-graph-element.ts`）是 10 段独立 LED（每段独立驱动，非 595 接口）。
- 因此 `shift_reg_74hc595` 拓扑在 v1.9.2 下须 🔴 Custom（或 Codegen Synthetic，但缺 595 元件），不是 🟡。

**⑧ 行 13 ultrasonic `single_pin_ping` — 无法用 hc-sr04 仿真单脚**
- `wokwi-hc-sr04` 引脚固定 VCC/GND/TRIG/ECHO（`hc-sr04-element.ts`），无法仿真 Parallax PING))) 的单脚双向 SIG。标 🟡 不准确（无属性可切），应 🔴 Custom/Synthetic。（此条与版本无关，两版 hc-sr04 均为 4 脚。）

**⑨ 行 20 lcd_char — 违反 §1.2 行实体不变量**
- `wokwi-lcd1602` 与 `wokwi-lcd2004` 是两个不同元件，SSOT 把它们写进同一单元格违反 §1.2"一行 = 一个 Wokwi Element + Pinout"。
- 1602/2004 协议、引脚一致，仅 cols×rows 不同——按边界 B 应下沉为 `config_t.cols/rows`，元件由 codegen 按 config 选择。建议拆两行或明确"几何进 config，元件 codegen 选"。
- 注：v1.9.2 的 `wokwi-lcd1602` 是否支持 I2C（PCF8574 backpack）需另行读源码确认；SSOT 的 `i2c_pcf8574` variant 须以此为准（不要假设它有新版的 `"pins":"i2c"` 属性）。

**⑩ 行 6 buzzer — 引脚名与 passive/active 仿真能力需注明**
- 源码 `buzzer-element.ts`：引脚名为数字 `1`、`2`（2 脚），`@property` 只有 `hasSignal`（v1.9.2）；新版才有 `mode=smooth/accurate`。
### 1.3 【架构解耦与职责边界】裸芯片 vs 驱动模块的层级界定与 DAL 改动职责

针对 §1.2 中提出来的裸继电器（`ks2e`）与裸步进电机（`stepper-motor`）在 Wokwi v1.9.2 下缺少驱动模块组件的问题，已在设计方案 [`2026-08-07-bare-component-driver-module-synthetic-netlist-design.md`](../../tech-designs/frontend/2026-08-07-bare-component-driver-module-synthetic-netlist-design.md) 中完成了专门的层级解耦定义。

**核心原则：功率驱动回路/网表合成属于前端与 Codegen 任务，不属于 DAL C 驱动层的改动范围。**

#### 1. 明确非 DAL 层的任务（无需 DAL/C 代码改动）：
- **前端外置插件 (Custom Elements)**：由 `embedded-frontend` 编写 `<wink-relay-module>` (3脚 VCC/GND/IN) 或 `<wink-a4988>` 自定义 Web-Component 组件，实现逻辑引脚信号捕获与 UI 渲染。
- **仿真虚拟网表合成 (Synthetic Netlist Generator)**：由 Codegen 网表生成器在生成 Wokwi `diagram.json` 时，自动将逻辑引脚 `[IN]` 映射绑定到 Wokwi 裸件的线圈引脚回路（如 `COIL1/COIL2`）。

#### 2. 明确 DAL C 驱动层及 SSOT 规范的改动内容：
- **保持纯净的逻辑引脚抽象**：DAL C API 与 Codegen YAML 必须保持高层控制逻辑引脚定义（如 `relay` 的 `[VCC, GND, IN]`，`stepper` 的 `[STEP, DIR, EN]`），**坚决禁止为了适配 Wokwi 裸件而倒退修改 C 驱动代码或膨胀线圈引脚 API**。
- **SSOT 标记对齐**：当 Wokwi v1.9.2 缺少对应的原生驱动模块时，在 SSOT 的“适配模式”一列显式标注为 **🔴 Custom** (`wink-custom-relay-module` / `wink-custom-a4988`)，告知上层仿真工具链需通过前端插件或网表合成来接入。
- **Variant 纠偏**：`ultrasonic` 变体删除 `gpio_hcsr04`/`rmt_hcsr04` 并合一为物理拓扑变体 `hcsr04`；`rc_servo` 角度量程保留为 `config.max_angle_ddeg` 不膨胀为 Variant。

---

## 2. §3 审计表与现网代码脱节（P1，审计已过期）

直接核对 `dal/include/`、`dal/src/`、`codegen/drivers/*.yaml`。

| 审计 # | 文档说法 | 代码实际 | 应修正为 |
|---|---|---|---|
| **#7 button** | "5 个 BAL 内部函数泄漏到公开头 `dal_button.h`" | **不成立**。5 函数已在 `dal/include/input/dal_button_bal.h`（头注释明确"NOT part of public DAL frozen surface"）。公开头泄漏的是**结构体字段/类型**（`event_backend`/`gpio_isr_registered`/`irq_pending` 字段、`dal_button_backend_t`、`dal_button_irq_notify_hook_t`），不是函数声明 | 改写：目标是把 BAL 状态字段从公开 handle 剥离（不透明 `_bal` 结构），而非"迁出 5 函数" |
| **#8 gps** | "经纬度仍为 float" | **已修复**。`dal_gps.h` 用 `int32_t lat_udeg/lon_udeg/alt_mm`（微度/毫米），仅 `speed_kmh/course_deg` 用 float，符合 ADR-0056 | 删除"改微度"，仅剩 STRICT symbol 丢失 / 非阻塞 init 生命周期 |
| **#9 eeprom** | "16-bit 寻址限制大容量器件" | **已修复**。C API 全用 `uint32_t addr`；config 有 `capacity_bytes`/`page_size`/`write_time_ms`。真正缺的是"1 字节 vs 2 字节片内地址指针"器件模型未抽象（at24c02 vs at24c32 协议差异） | 改写为"补器件地址宽度状态机（1-byte/2-byte addressing）"，不是"寻址升 uint32" |
| **#5 encoder** | "仅锁 x1，x4 标 UNSUPPORTED；解除限制" | enum 实为 `X1_RISING=0, X2=1, X4=2`，**x2 和 x4 在 `dal_encoder.c:72-74` 都 `return WINK_ERR_UNSUPPORTED`**；codegen YAML 用 `x1_rising/x2/x4`，不是表格里的 `quadrature_x1/quadrature_x4` | 审计覆盖 x2+x4；variant 命名在 `quadrature_x1`（文档）vs `x1_rising`（代码）间二选一并全局归一 |
| **#6 dc_motor** | 变体 `in_in`/`phase_enable`，`affects_pins: false` | 实际有**三个**变体：`in_in`/`phase_enable`/`pwm_on_in`（后两个 Reserved）；codegen YAML 标 `affects_pins: true`（`in_in` 用 dir_pin_a+dir_pin_b，另两个仅一个 dir 脚，引脚数确不同） | 表格补 `pwm_on_in`；`affects_pins` 改 `true` |
| **#3 keypad** | 缺 `adc_ladder` | 代码现状为 `matrix_4x4/matrix_3x4/custom`——有文档未列的 **`custom`** 变体（带 `custom_keymap`），无 `adc_ladder` | 表格与审计同时登记 `custom` 去留（保留还是被 adc_ladder 替代） |

**宏观问题**：30 个 type 中仅 14 个在代码中真实存在。未落地的 16 个：`ir_receiver / led_bar / stepper / analog_sensor / digital_sensor / temp_humidity / motion / imu / lcd_char / tft / led_matrix / seg_display / sdcard / rtc / io_expander / multiplexer / i2c_mux`。

这本身可接受（SSOT 是终态基线），但应明确区分"已对齐 / 待建 / 待重构"三态。§3 仅 13 行且把"未建"与"需重构"混在 Planned，易让人误以为其余 type 已就绪。建议 §3 扩为全量 30 行状态矩阵（exists / variant-aligned / element-verified 三列布尔）。

**已与代码对齐的审计项（确认无误）**：#2 relay（`direct_gpio/ssr/latching_dual_pin` 已落地）、#4 buzzer（`passive_pwm/active_gpio` 已落地，C 枚举命名正确）。

---

## 3. 文档内部不变量与表格矛盾（P1）

### 3.1 §1.1 维度 4 举例与 §2.1 表格不一致
- §1.1 维度 4 举例"button 的 normally_open vs normally_closed"，又把"momentary vs latching"归给 digital_sensor。
- §2.1 行 1 实际列 `push_button` / `toggle_switch`（即 momentary vs latching）。
- 按维度 4 自己的注："纯电气高低电平有效极性收入 `config.active_level`"——NO/NC 本质就是 active_level，不该当 variant。所以表格（push/toggle）比 §1.1 例子更正确。
- 修正：§1.1 维度 4 的 button 例子改为"momentary(push) vs latching(toggle)"；NO/NC 明确归入 active_level config，从 variant 维度举例删除。

### 3.2 `affects_pins` 粒度混淆
- §1.1 把 `affects_pins` 定义在**每个 variant** 上；§4.3 说在"Codegen YAML 的 `fields.variant` 中标注"——这是**字段级单 bool**（任一 variant 改引脚就标 true，见 `relay.yaml:33`、`dc_motor.yaml:38`）。
- §2 表格是**逐行**标 true/false（relay：direct/ssr=false，latching=true）。
- 两个粒度都合理（字段级供 codegen 决定是否触发重排；行级供人读），但文档未说明关系。建议：表格保留行级，§4.3 补一句"YAML 字段级 `affects_pins` = 该 type 任一行的逻辑或"。

### 3.3 §4.1"引脚数绝对静态"与 keypad 现状冲突
- §4.1 要求同一 variant 内引脚数静态唯一，严禁 if-else 切 2/4 脚。
- `keypad` 把 4x4/3x4 拆成两个 variant（符合 §4.1），可 C config 却是固定 `row_pins[4]/col_pins[4]` + `num_rows/num_cols` 标量——3x4 仍分配 8 槽只用 7 个，处于"变体拆分"与"config 标量"中间态。
- 建议明确：4x4/3x4 既已是独立 variant，`num_rows/num_cols` 应由 variant 锁死（从 variant_fields 移除或设为 emit:none 派生值），否则 §4.1 静态性在 C 层未真正兑现。

### 3.4 标题数量错误
- 标题与 §2 开头写"全量 **28** 个 DAL Type"，但 # 列从 1 编到 **30**，去重后也是 30 个 distinct type。改 28→30。

### 3.5 C 枚举列命名不统一（违反 §5.1 第 2 条门禁）
代码事实约定统一为 **`DAL_<TYPE>_VARIANT_<NAME>`**（如 `DAL_BUZZER_VARIANT_PASSIVE_PWM`、`DAL_KEYPAD_VARIANT_MATRIX_4X4`、`DAL_RELAY_VARIANT_LATCHING_DUAL_PIN`）。但文档"Aliases"列混用三种风格：
- 正确：`DAL_BUZZER_VARIANT_*`、`DAL_RELAY_VARIANT_*`、`DAL_KEYPAD_VARIANT_*`；
- 旧式缩写：`BUTTON_VAR_PUSH`、`LED_VAR_SINGLE/RGB_*`、`SERVO_VAR_180`、`STEPPER_VAR_*`、`IR_VAR_NEC`、`GPS_VAR_*`、`EEPROM_VAR_*`、`RTC_VAR_*`；
- 裸写：`SSR`、`X4`。

作为要驱动 `_Static_assert` 0-indexed 门禁的 SSOT，此列必须全部归一为 `DAL_<TYPE>_VARIANT_<NAME>`，否则 §5.1.2 无法机械校验。

---

## 4. Variant / Type / Config 边界的设计性质疑（P2，需有意识决策）

以下不是错误，而是文档一边倒、未给比选理由的边界判断：

1. **`rc_servo` 180°/270° — 确立【连续标量 (Config) vs 行为变体 (Variant)】硬裁决准则**
   - **硬裁决准则**：凡是连续/离散物理标量参数（如 180°/270° 机械角度量程、NTC/LDR 阻值曲线、PWM 采样频率），**坚决归入 `config_t` 结构体，禁止膨胀 Variant**。现网代码已使用 `config.max_angle_ddeg`（默认 1800 = 180.0°），符合**边界 B**。
   - **提炼 Variant 的唯一条件**：只有当 **API 语义/控制状态机发生本质改变**（例如 360° 连续旋转舵机的控制语义从“位置控制 `set_angle`”退化为“速度/方向控制 `set_speed`”），或物理引脚拓扑改变（`affects_pins: true`）时，才允许提炼为 Variant 或新 Type。
   - **裁决**：`rc_servo` 保持单个默认 Variant，180°/270° 归入 `config.max_angle_ddeg`，SG90/MG996R 作为 alias 归一展开。

2. **`ultrasonic` 的 `gpio_hcsr04` / `rmt_hcsr04`（行 13）— 确定为架构错误，须合并为 `hcsr04`**
   把 GPIO vs RMT 解调引擎区分提升为 Variant 是**明确的架构错误（把 MCU/SOC 驱动实现泄漏到了 DAL 变体层）**：
   - **物理协议一致**：HC-SR04 物理引脚（`[VCC, GND, TRIG, ECHO]`）与高电平脉宽协议 100% 相同，传感器本身不知道也不关心 MCU 是用 RMT 还是 Timer 还是 GPIO 软轮询测量。
   - **跨平台/仿真断层**：若保留 `rmt_hcsr04` 变体，在 Host (x86/Mac 单元测试)、WASM (Wokwi 仿真) 或 STM32/RP2040 平台下将因无 ESP32 RMT 外设而导致 DAL 类型断层与 Variant 组合爆炸。
   - **正解**：Variant 必须统一为物理拓扑 **`hcsr04`** (或 `standard_4pin`) 与 **`single_pin_ping`** (3脚 SIG)；RMT / GPIO 选择下沉至 C 代码配置结构体 `config.backend` (例如 `dal_ultrasonic_backend_t`) 或 Target Codegen HAL 策略注入。

3. **`relay` 的 `ssr`（行 7）**
   SSR 与电磁继电器从 MCU 看都是 GPIO 驱动、引脚拓扑一致、C API 一致。按边界 B，更像 alias（如 SG90）而非 variant。建议 `ssr` 降为 alias，不占 variant 槽。

4. **`infrastructure` 三型 — 确立【总线/引脚提供者 (Bus / Pin Provider)】代理架构（§2.7）**
   - **架构裁决**：`io_expander / multiplexer / i2c_mux` (#28–#30) **绝对不是业务级 DAL Type**（应用层绝不直接调用 `dal_io_expander_set_pin` 这种非业务 API）。
   - **代理定位**：它们在系统中属于 **Hardware Bus/Pin Provider**。它们向系统注册为虚拟 GPIO 或 I2C 总线抽象接口（如 `dal_gpio_provider_t` / `dal_i2c_bus_provider_t`）。上层 `dal_button` 或 `dal_led` 句柄挂载在由它们派生的虚拟引脚上。
   - **SSOT 规范**：必须在 §2.7 明确标注三者为纯硬件拓扑/Netlist 代理，无上层传感器/执行器业务 C API 驱动。

5. **`analog_sensor` / `digital_sensor` 的 AO+DO 双输出拆解（与 07-29 评审硬伤 2 对齐）**
   源码显示 `wokwi-flame-sensor`、`wokwi-gas-sensor`、`wokwi-big/small-sound-sensor` **都同时引出 AOUT 和 DOUT**。07-29 评审的裁决正确：接 AO → `analog_sensor`，接 DO → `digital_sensor`。SSOT 行 15 仅列 `threshold_do`（DO），行 14 列了 NTC/LDR/gas(AO)，但**漏了 flame/sound 的 AO 也可入 analog_sensor**。建议在别名/覆盖说明里补全这一对称关系，并确保 codegen 按实际连线选 type。

---

## 5. 覆盖缺口（P3，既然声称"全量"）

**v1.9.2 中存在、SSOT 未覆盖的元件**（这是当前基线下真实可仿真的元件，比 docs 新版清单更应优先登记）：

- **`wokwi-dip-switch-8`** — 8 位拨码开关；07-29 已裁决由 Codegen 拆解为 8× `button`，SSOT §2 表格无此复合件登记行（§4.5 只提了 KY-040/joystick）。
- **`wokwi-analog-joystick`** — §4.5 已提拆解为 2×analog_knob + 1×button，但 §2 无登记行。
- **`wokwi-tilt-switch`** — 3 脚倾斜开关（GND/VCC/OUT），应入 `button` type（与 toggle 并列），SSOT 未列。
- **`wokwi-heart-beat-sensor`** — 3 脚模拟心率传感器（GND/VCC/OUT），07-29 规划为 `sensor/heart_rate`，SSOT 未列。
- **`wokwi-hx711`** — 24-bit 称重 AFE，07-29 规划为 `sensor/load_cell`，SSOT 未列。
- **`wokwi-biaxial-stepper`** — 双轴步进（8 脚），SSOT 行 11 只提单轴 stepper。
- **`wokwi-led-ring`** — WS2812 环形灯，属 `led_matrix` 的几何变体（维度 6 举了 strip/matrix 漏 ring）。
- **`wokwi-pushbutton-6mm`** — 6mm 按钮，是 `pushbutton` 的尺寸别名，建议入 alias。
- **`wokwi-ir-remote`** — 行 4 ir_receiver 别名列已提"配对"，但它是独立发射元件，如需红外发射需新 type/role。

**docs 新版才有、v1.9.2 不存在（须先升级才能用）**：ds18b20、nokia-5110、74hc165、a4988、74hc595、tm1637-7segment、max7219-matrix、led-strip、led-matrix、relay-module、nlsf595 等。SSOT 若要引用，须按 §1.0 先升级基线。

---

## 6. 文档定位与流程问题

1. **SSOT 放错文档层级。** 按 CLAUDE.md 四层规则，`implementation-plans/` 是"一次性可执行任务计划"，而本文档自封"唯一真理源 / 活的终态基线"。SSOT 应晋升到 **① 设计规范**（建议 `03-app-codegen/` 或 `04-wasm-simulation/`，因其同时约束 codegen 与 Wokwi bridge），日期目录只留执行跟踪计划。否则 plan 归档时 SSOT 会被一起冻成只读历史，与"活文档"自相矛盾。

2. **§3 状态标记缺"已验证于代码 `<sha>`"。** 建议每项加一列"核验 commit / 文件:行"，避免审计再次过期。本次即发现 #7/#8/#9 三条与代码相反。

3. **§5.1 门禁可补三条机械规则**：
   - Wokwi element tag 必须存在于 **vendored v1.9.2 源码** `src/*-element.ts` 的 `@customElement` 注册表（直接拦住虚构 tag 与版本混用）；
   - variant 枚举名必须匹配 `^DAL_[A-Z0-9]+_VARIANT_[A-Z0-9_]+$`，且在 codegen YAML `map` 与 C 头 `_Static_assert` 三处一致；
   - `affects_pins: true` 时，不同 variant 的 `variant_fields` 必须至少有一个引脚字段集合不同（防止 flag 误报）。

4. **确立【Wokwi Attribute / Pin ↔ C `config_t` 双向 Schema 映射契约】。**
   例如 `wokwi-lcd1602` 的 `i2cAddress`、`wokwi-neopixel-matrix` 的 `rows/cols`、`wokwi-7segment` 的 `digits/common` 等。必须在 Codegen Driver YAML 中建立显式的契约 Schema（如 `wokwi_binding.attribute_map` 和 `pin_map`），使得编译期 Python AST / YAML Linter 能够自动校验 Wokwi JSON 图纸属性与 C `config_t` 结构体默认初始化的双向完全对齐，从机制上防止仿真图纸与 C 驱动代码参数漂移。

5. **codegen `variant_fields` 校验器已就位，可作为 SSOT 落地抓手。** `wink-tools/tools/codegen/schema/yaml_schema.py`（commit 8451d80）已强制：多变体必须有 `variant_fields`、key 必须与 `variant.enum` 集合一致、引用字段必须存在。但 `affects_pins` 仅做 bool 类型检查，未与 `variant_fields` 引脚差异交叉验证（见上条第 3 点）。

---

## 7. 修订清单（按优先级）

**P0 — 事实硬伤，不修则 SSOT 不可用：**
1. 【新增】在文档头部钉死 Wokwi 元件基线 = `wokwi-elements@1.9.2`（vendored 源码路径），白名单以 `@customElement` 注册名为准；引用新版元件须先升级。
2. 修正虚构/拼错 tag：`wokwi-ntc`→`wokwi-ntc-temperature-sensor`；`wokwi-sound-sensor`→`wokwi-big/small-sound-sensor`；删除 `wokwi-sht30`/`wokwi-gps`/`wokwi-24c02`（改 🔴 Custom）。
3. relay：明确 `wokwi-ks2e-m-dc5` 是裸 DPDT（COIL1/COIL2…），3 脚模块在 v1.9.2 无原生元件 → 🔴 `wink-custom-relay-module`（不要建议换 relay-module，那是新版）。
4. stepper：`wokwi-stepper-motor` 是双极线圈 A-/A+/B+/B-；step_dir/four_wire 在 v1.9.2 均无 🟢 载体（无 a4988/ULN2003）→ 🔴 Custom 或升级基线。
5. ssd1306_spi：源码 DC/RST/CS 的 signals 为空，功能仅 I2C → SPI 变体须 🔴 或注明仅真机。
6. led_matrix：strip 不能用单颗 `wokwi-neopixel` 表示（无 leds 属性）；`wokwi-neopixel-matrix` 正确但无 serpentine 属性；`wokwi-max7219-matrix` v1.9.2 不存在。
7. seg_display tm1637：v1.9.2 无 tm1637 元件，不能映射到直驱的 `wokwi-7segment` → 🔴 或升级。
8. button toggle_switch：`wokwi-pushbutton` 纯点动（sticky 是 private UI 态）；应映射 `wokwi-slide-switch`（3 脚，affects_pins=true）或 `wokwi-tilt-switch`。
9. led_bar 595：v1.9.2 无 74hc595 → 🔴，不是 🟡。
10. 标题 28→30；C 枚举列全部归一为 `DAL_<TYPE>_VARIANT_<NAME>`。

**P1 — 与代码对齐：**
11. 重写 §3 #7/#8/#9；补 #5 的 x2、#6 的 pwm_on_in、#3 的 custom 变体。
12. dc_motor affects_pins 改 true。
13. §3 扩为全量 30 type 的 exists/aligned/verified 状态矩阵。
14. 修正 §1.1 维度 4 举例；补 affects_pins 字段级/行级关系说明。

**P2 — 架构决策补强：**
15. 架构决策落地：rc_servo 量程归入 config；ultrasonic 变体合并为 `hcsr04` (物理4脚)，GPIO/RMT 必须下沉至 `config.backend` (绝不泄漏 SOC 驱动至 Variant)；ssr 降为 alias；明确 infra 三型仅为 Netlist/Bus Provider（无上层业务 C 驱动）。
16. 补"Wokwi Attribute/Pin ↔ config_t 映射契约"一节。
17. 将 SSOT 晋升至 ① 设计规范目录。
18. 补全 flame/sound/gas 的 AO↔analog_sensor、DO↔digital_sensor 对称映射说明。

**P3 — 覆盖度：**
19. 按 v1.9.2 实际元件登记 dip-switch-8 / analog-joystick / tilt-switch / heart-beat-sensor / hx711 / biaxial-stepper / led-ring 的拆解或归类。

---

## 8. 值得肯定的部分

- **三级分类语义清晰**：category（功能意图）/ type（控制量+API 护城河）/ variant（同族变异避风港）的切分，与 ADR-0004 静态分发、ADR-0056 跨 Profile 量纲规范一致。
- **6 类 variant 维度**（引脚拓扑 / 总线 / 算法曲线 / 触点形态 / 解调状态机 / 几何映射）覆盖面到位，且明确把"纯极性"赶入 config，边界感好。
- **两条边界不变量**（A: 控制量/API 变 → 新建 type；B: 连续标量进 config，仅状态机/引脚表/UI Element 变才提炼 variant）可机械判断，是后续 codegen lint 的好基础。
- **§1.3 三阶降级策略**（Native / Parametric / Custom+Synthetic）与 §4.5 复合件拆解契约（KY-040 = encoder+button、joystick = 2×knob+button）方向正确，避免了"巨型复合驱动"反模式。
- **§4.4 芯片别名自动归一化公式**（SG90 → type+variant+默认脉冲宽度）把选型数据库与驱动枚举解耦，是正确的分层。
- buzzer、relay 两型的代码已与 SSOT 对齐且命名规范，可作为其余 type 的落地范本。
- 与 07-29 评审相比，v2.2.0 在 variant 维度细化、复合件拆解、C 枚举规范化上有明显进步。

---

## 附录 A：v1.9.2 元件全集与 tag 名（核查基准，来自源码 `@customElement`）

`D:\workspaces\open-source\embedded\wokwi-elements\src`，v1.9.2，共 50 个 `*-element.ts`：

```
=== 开发板/控制器（6，不映射 DAL type）===
wokwi-arduino-mega      wokwi-arduino-nano      wokwi-arduino-uno
wokwi-esp32-devkit-v1   wokwi-franzininho       wokwi-nano-rp2040-connect

=== 无源件（1，不映射）===
wokwi-resistor

=== 外设元件（43）===
wokwi-7segment              wokwi-analog-joystick      wokwi-biaxial-stepper
wokwi-big-sound-sensor      wokwi-buzzer               wokwi-dht22
wokwi-dip-switch-8          wokwi-ds1307               wokwi-flame-sensor
wokwi-gas-sensor            wokwi-hc-sr04              wokwi-heart-beat-sensor
wokwi-hx711                 wokwi-ili9341              wokwi-ir-receiver
wokwi-ir-remote             wokwi-ks2e-m-dc5           wokwi-ky-040
wokwi-lcd1602               wokwi-lcd2004              wokwi-led-bar-graph
wokwi-led                   wokwi-led-ring             wokwi-membrane-keypad
wokwi-microsd-card          wokwi-mpu6050              wokwi-neopixel
wokwi-neopixel-matrix       wokwi-ntc-temperature-sensor
wokwi-photoresistor-sensor  wokwi-pir-motion-sensor    wokwi-potentiometer
wokwi-pushbutton-6mm        wokwi-pushbutton           wokwi-rgb-led
wokwi-rotary-dialer         wokwi-servo                wokwi-slide-potentiometer
wokwi-slide-switch          wokwi-small-sound-sensor   wokwi-ssd1306
wokwi-stepper-motor         wokwi-tilt-switch
```

**SSOT 引用但不在上述集合中的 tag（须修正）**：
- 拼错：`wokwi-ntc`（→ `wokwi-ntc-temperature-sensor`）、`wokwi-sound-sensor`（→ `wokwi-big/small-sound-sensor`）；
- 两版均无：`wokwi-sht30`、`wokwi-gps`、`wokwi-24c02`；
- 仅 docs 新版有、v1.9.2 无（须先升级基线）：`wokwi-relay-module`、`wokwi-a4988`、`wokwi-74hc595`、`wokwi-74hc165`、`wokwi-tm1637-7segment`、`wokwi-max7219-matrix`、`wokwi-led-strip`、`wokwi-led-matrix`、`wokwi-ds18b20`、`wokwi-nokia-5110-screen`、`wokwi-nlsf595`。

**关键元件引脚（来自源码 `pinInfo`）**：

| 元件 | 引脚（源码原名） | 备注 |
|---|---|---|
| `wokwi-ks2e-m-dc5` | NO2, NC2, P2, COIL2, NO1, NC1, P1, COIL1 | 裸 DPDT 继电器，**无 VCC/GND/IN** |
| `wokwi-stepper-motor` | A-, A+, B+, B- | 双极电机本体，**非 IN1–IN4** |
| `wokwi-biaxial-stepper` | A1-, A1+, B1+, B1-, A2-, A2+, B2+, B2- | 双轴 |
| `wokwi-ssd1306` | DATA(i2c SDA), CLK(i2c SCL), DC, RST, CS, 3V3, VIN, GND | DC/RST/CS 的 signals 为空，功能仅 I2C |
| `wokwi-neopixel` | VDD, DOUT, VSS, DIN | 单颗，仅 r/g/b 属性，无 leds |
| `wokwi-neopixel-matrix` | GND, VCC, DIN, DOUT | rows/cols/rowSpacing/colSpacing，无 serpentine |
| `wokwi-7segment` | A,B,C,D,E,F,G,DP,CLN, COM, DIG1–DIG4 | 直驱 GPIO |
| `wokwi-pushbutton` | （2 接触脚）| color/pressed/label/xray；sticky 为 private（Ctrl-click），纯点动 |
| `wokwi-slide-switch` | 1, 2, 3 | SPDT 拨动 |
| `wokwi-tilt-switch` | GND, VCC, OUT | 3 脚倾斜 |
| `wokwi-buzzer` | 1, 2 | v1.9.2 属性 hasSignal；被动压电，无 passive/active 模式 |
| `wokwi-servo` | GND, V+, PWM | 无角度档位属性 |
| `wokwi-flame-sensor` | VCC, GND, DOUT, AOUT | AO+DO 双输出 |
| `wokwi-gas-sensor` | AOUT, DOUT, GND, VCC | AO+DO 双输出 |
| `wokwi-big/small-sound-sensor` | AOUT, GND, VCC, DOUT | AO+DO 双输出 |
| `wokwi-heart-beat-sensor` | GND, VCC, OUT | 模拟输出 |
| `wokwi-ntc-temperature-sensor` | GND, VCC, OUT(analog) | — |
| `wokwi-hc-sr04` | VCC, TRIG, ECHO, GND | 固定 4 脚 |
| `wokwi-mpu6050` | VCC,GND,SCL,SDA,XDA,XCL,AD0,INT | — |
| `wokwi-microsd-card` | CD, DO(MISO), GND, SCK, VCC, DI(MOSI), CS | — |
| `wokwi-ds1307` | GND, 5V, SDA, SCL, SQW | — |

---

## 附录 B：现网代码状态快照（评审时点）

| type | C 头文件 | codegen YAML | variant 枚举（代码实际） |
|---|---|---|---|
| button | ✅ `input/dal_button.h` | ✅ | 无 variant（BAL 已拆 `_bal.h`）|
| analog_knob | ✅ `input/dal_analog_knob.h` | ✅ | standard / logarithmic / anti_logarithmic / center_detent |
| keypad | ✅ `input/dal_keypad.h` | ✅ | matrix_4x4 / matrix_3x4 / **custom**（无 adc_ladder）|
| ir_receiver | ❌ | ❌ | — |
| led | ✅ `output/dal_led.h` | ✅ | 无 variant（无 RGB）|
| buzzer | ✅ `output/dal_buzzer.h` | ✅ | passive_pwm / active_gpio |
| relay | ✅ `output/dal_relay.h` | ✅ | direct_gpio / ssr / latching_dual_pin |
| led_bar | ❌ | ❌ | — |
| dc_motor | ✅ `actuator/dal_dc_motor.h` | ✅ | in_in / phase_enable / **pwm_on_in**（后两个 Reserved）|
| rc_servo | ✅ `actuator/dal_rc_servo.h` | ✅ | 无 variant（`max_angle_ddeg` config，experimental）|
| stepper | ❌ | ❌ | — |
| encoder | ✅ `sensor/dal_encoder.h` | ✅ | x1_rising / x2 / x4（x2/x4 init 返 UNSUPPORTED）|
| ultrasonic | ✅ `sensor/dal_ultrasonic.h` | ✅ | 无 variant（`use_rmt` bool；无 single_pin）|
| analog_sensor | ❌ | ❌ | — |
| digital_sensor | ❌ | ❌ | — |
| temp_humidity | ❌ | ❌ | — |
| motion | ❌ | ❌ | — |
| imu | ❌ | ❌ | — |
| mono_oled | ✅ `display/dal_mono_oled.h` | ✅ | ssd1306 / sh1106（sh1106 init 返 UNSUPPORTED）|
| lcd_char | ❌ | ❌ | — |
| tft | ❌ | ❌ | — |
| led_matrix | ❌ | ❌ | — |
| seg_display | ❌ | ❌ | — |
| gps | ✅ `comm/dal_gps.h` | ✅ | 无 variant（lat/lon 已微度 int；experimental）|
| eeprom | ✅ `storage/dal_eeprom.h` | ✅ | 无 variant（addr 已 uint32；缺 1/2 字节地址宽度模型；experimental）|
| sdcard | ❌ | ❌ | — |
| rtc | ❌ | ❌ | — |
| io_expander / multiplexer / i2c_mux | ❌ | ❌ | — |

命名约定：统一 `DAL_<TYPE>_VARIANT_<NAME>`，字段为 `dal_<type>_config_t.variant`。
codegen 多变体强制 `variant_fields`（校验器 `wink-tools/tools/codegen/schema/yaml_schema.py`，commit 8451d80）。

---

## 附录 C：与 07-29 评审的对账结论

| 维度 | 07-29 评审（v1.9.2 源码，50 元件）| 08-07 v1 评审（误用 docs 新版）| 08-07 v2（本版）|
|---|---|---|---|
| 元件是否存在 | ✅ 准确 | ❌ 4 处误判（neopixel-matrix/rotary-dialer/flame-sensor/sound-sensor）| ✅ 以 v1.9.2 源码为准，撤回误判 |
| 元件引脚拓扑 | ⚠️ 未深挖（ks2e/stepper/ssd1306 引脚问题没抓到）| ✅ 准确（读 pinInfo）| ✅ 保留并补全 |
| 版本基线 | 隐含 v1.9.2（读源码），未显式声明 | ❌ 误用 docs 新版 | ✅ 显式钉死 v1.9.2 为 P0 |
| variant/type/config 架构 | 旧词 `drive_mode`，无 6 维度 | ✅ 边界分析到位 | ✅ 保留 |
| 与现网 C 代码对账 | 当时 9 个 type，已过期 | ✅ 准确（14 type）| ✅ 保留 |
| 覆盖缺口 | 列了 load_cell/heart_rate 等 | 列了 ds18b20/nokia5110 等（多为新版元件）| ✅ 以 v1.9.2 实际可仿真元件为准（dip-switch/tilt/heart/hx711/biaxial/ring）|

**一句话结论**：元件存在性以 07-29 + v1.9.2 源码为准；引脚拓扑和代码对账以本评审为准，但已撤回 v1 中基于 docs 新版元件的 4 处误判和修改建议。两份评审互补，不矛盾。


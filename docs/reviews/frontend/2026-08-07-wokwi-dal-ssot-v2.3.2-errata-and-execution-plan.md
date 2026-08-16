# Wokwi-Elements ↔ DAL 外设三级分类 SSOT (v2.3.2) 勘误修补与分阶段落地计划

| 项 | 内容 |
|---|---|
| **计划对象** | `docs/implementation-plans/frontend/00.1-category-type-variant-wokwi-ssot.md` |
| **制定日期** | 2026-08-07 (v2.3.2 最终完备版) |
| **关联评审** | [`2026-08-07-wokwi-dal-ssot-v2.3.1-review.md`](2026-08-07-wokwi-dal-ssot-v2.3.1-review.md) |
| **执行目标** | 消除 v2.3.1 评审指出的所有硬错、架构冲突与用词疏漏，实现 100% 严丝合缝与真理源自洽 |

---

## 1. 事实核验与处置状态说明 (Verification & Status Tracking)

### 1.1 代码与状态矩阵真实性补齐 (P0-2~P0-5 跟踪)
在 Commit `956fa68` 中，**§3 状态矩阵的时态失真已彻底纠正**：
- `button`, `mono_oled`, `relay`, `ultrasonic` 的状态均更正为 **`🚧 Refactor Planned`**。
- `gps` 与 `eeprom` 同样确认代码中暂缺 `variant` 字段/枚举，已标为 `🚧 In Progress`，与 `ultrasonic` 一起归入 C 驱动重构计划并列跟踪。
- `relay` 的 `ssr` 降为 alias 明确制定 ABI 迁移规程：保留 `DAL_RELAY_VARIANT_SSR = DAL_RELAY_VARIANT_DIRECT_GPIO` 别名常量，维持 2 个 minor 版本过渡期以防持久化配置错位。

### 1.2 延期与澄清项处置说明 (P1-7 & P2-1)
1. **P1-7 (SSOT 文档分层搬迁)**：
   * **处置**：由于当前正处于 `05-mono_oled`, `06-ultrasonic`, `07-led` 重构计划推进期，SSOT 暂留于 `implementation-plans/` 方便计划交叉引用。在所有重构计划执行完毕并达到稳定终态后，将在 **v2.4.0** 整体提升至设计规范目录 `docs/design/specs/`。
2. **P2-1 (`heart_rate_ao` 模拟心率归类)**：
   * **处置**：查验 `heart-beat-sensor-element.ts:7-11` 确认其 OUT 脚 signals 无 `analog()` 标注（Wokwi 源码无模拟输出）。在 SSOT 增加说明：该元件在 Wokwi 为数字脉冲输出；`heart_rate_ao` 变体保留为 DAL 软件拟合接口，真机硬件与标准仿真推荐绑定 `threshold_do`。

---

## 2. 核心硬伤二次订正：`seg_display` 物理引脚映射矩阵 (P1-5 & P1-6)

### 2.1 `seg_display` `direct_gpio_n_digit` 物理引脚受限兜底契约
结合 `wokwi-elements@1.9.2` 源码 (`7segment-element.ts:41-119`) 源码真相：
- `digits=1`: 10 脚 `[COM.1, COM.2, A..G, DP]` (无 DIGn)
- `digits=2`: 10 脚 `[DIG1, DIG2, A..G, DP]` (无 CLN, 无 COM)
- `digits=3`: 11 脚 `[DIG1..DIG3, A..G, DP]` (无 COM/CLN)
- `digits=4`: 14 脚 `[A..G, DP, DIG1..DIG4, COM, CLN]` (必含 COM 脚 pin 7)
- `digits=5..8`: Wokwi v1.9.2 源码 fallback 到 1 位脚表，物理引脚无法多路复用。

**更正方案**：
1. `digits=2..4` 标记为 🟢 Native Match；`digits=5..8` 标记为 🔴 Custom/Synthetic。
2. 在 SSOT §4.6 显式建立 **Per-N 物理引脚映射对照表**：

| 位数 ($N$) | 真实物理脚数 | 物理引脚集合 | 哨兵/网表 tie 说明 |
|:---:|:---:|---|---|
| **$N=1$** | 10Pin | `[A..G, DP, COM.1, COM.2]` | 属于 `direct_gpio_1d` 变体，无扫描直驱；**注意**：源码脚名含点号（`COM.1`/`COM.2`），Codegen 网表连线必须使用含点号形式 |
| **$N=2$** | 10Pin | `[A..G, DP, DIG1, DIG2]` | 无 `CLN`，无独立 `COM`；`dig_pins[2..7]` 与 `colon_pin` 赋 `-1` 哨兵 |
| **$N=3$** | 11Pin | `[A..G, DP, DIG1, DIG2, DIG3]` | 无 `CLN`，无独立 `COM`；`dig_pins[3..7]` 与 `colon_pin` 赋 `-1` 哨兵 |
| **$N=4$** | 14Pin | `[A..G, DP, DIG1..DIG4, COM, CLN]` | `COM` 脚 (pin 7) 必须在 4 位多路复用中落位为活跃/合成脚；`dig_pins[4..7]` 赋 `-1` 哨兵 |

---

## 3. 确切修补文案 (Comprehensive Errata List)

### 3.1 架构与专业用词类
1. **P1-1 (`stepper` 撤销 `dual_axis_four_wire` 8脚变体)**：
   在 §2.3 删除 8脚变体；在 §2.3 尾部新建 `*(复合件)*` 区域：
   `| * | (复合件) | biaxial_stepper | — | 8Pin (两组四线) | wokwi-biaxial-stepper | 🟢 Native | 复合合成件：按 §4.5 拆解为 2× stepper four_wire 实例 (C 侧零新增；单/双极相位序列进 config) |`
2. **P1-2 (`rotary-dialer` 消除悬空行，并删除错误拆解描述)**：
   在 §2.1 `*(复合件)*` 明确标为 `🔴 Custom`，**同时删除原 Alias 列中"拆解为 1× encoder + 1× button"的错误描述**（该拆解在电学上不成立：`wokwi-rotary-dialer` 仅输出 `[GND, DIAL, PULSE]` 单路脉冲与选通信号，无 A/B 正交相，无法驱动 `dal_encoder` 的正交解码状态机）。更正后的行文案：
   `| * | (复合件) | rotary_dialer | — | [GND, DIAL, PULSE] | wokwi-rotary-dialer | 🔴 Custom | 独立脉冲选通件：输出单路脉冲与选通（无 AB 正交相，不可拆为 encoder+button）；C 侧属于 custom/待规划 pulse_counter 驱动，暂不支持全自动 DAL 绑定 |`
3. **P1-3 ( Provider “虚表”用词更正)**：
   引用 **ADR-0004 §演进路径 §3**（允许配置期绑定的回调函数指针）：将“向系统注册虚拟接口/虚表”更正为“向系统提供配置期静态绑定的 Provider 接口/回调集合”。注明 `dal_gpio_provider_t` / `dal_i2c_bus_provider_t` 目前为规划态，随 28-30 型落地引入。
4. **P1-8 (`affects_pins` 门禁比对范畴)**：
   在 §5.1 门禁 3 澄清：`affects_pins` 断言仅在 `affects_pins: true` 的变体行之间比对；补充 Type 级 OR=true 时前端触发重排。

### 3.2 物理脚逻辑化与网表短接规则类
5. **P0-7 (`relay` 裸件 `ks2e-m-dc5` 盘点)**：
   在 §1.3 说明：`ks2e-m-dc5` 为 v1.9.2 原生 DPDT 裸继电器。**注意**：在 v1.9.2 中为纯 SVG 视觉壳（无物理动作仿真）；线圈 `COIL1` 经三极管驱动、`COIL2` 接地；触点组只取 P1/NO1/NC1 单极（另一极 P2 触点悬空）；Codegen Synthetic Netlist BOM 包含 `wokwi-resistor` 限流电阻与续流二极管。`ks2e` 仅服务 `direct_gpio`，不服务 `latching`。
6. **P2-2 (`digital_sensor threshold_do` 补全 `photoresistor`)**：
   在 §2.4 `#15` `digital_sensor` 匹配组件列加入 `wokwi-photoresistor-sensor`。
7. **P2-3 (`dht22` 坚守逻辑列口径与 SDA 误称澄清)**：
   主表 Pinout 写 `[VCC, DATA]` (**2Pin 逻辑脚**；NC 脚不参与逻辑，不计入逻辑脚数)；Alias 备注：`Wokwi 源码脚名误标注为 SDA，实为单总线 DATA；物理 4 脚 [VCC, SDA, NC, GND] 中第 3 脚 NC 由 Codegen 自动留空（不接线）`。
8. **P2-4 (`lcd_char parallel_4bit` tie-down 范畴)**：
   在 §2.5 `#20` Alias 备注：`仅在 parallel 模式下 V0/RW/A/K 电源与常控脚由 Codegen 合成 tie-down 到 GND/背光回路；I2C 背板模式已在模块内部封装`。
9. **P2-9 (`pushbutton` 内部等电位与 `dip_switch` 短接规则)**：
   在 §4.5 补充：`wokwi-dip-switch-8（16脚）拆解为 8× button 时每一路 1b..8b 短接到 GND/VCC；wokwi-pushbutton（4脚）由 Codegen 自动将内部等电位脚 (1.l=1.r, 2.l=2.r) 合并为逻辑节点 A/B 后再进行接地短接。`

### 3.3 硬件别名与细节提示类
10. **P2-5 (`analog_knob` 滑杆 taper 说明)**：在 §2.1 `#2` 滑杆 Alias 说明 taper 响应曲线属于 BAL 软件校正算法，物理传感器线形不变。
11. **P2-6 (DS1307 5V 电平提醒)**：在 §2.6 `#27` Alias 补充 DS1307 工作于 5V，3.3V MCU 上拉需注意电平。
12. **P2-7 (`dc_motor` Custom 视觉分化说明)**：在 §2.3 `#9` Alias 补充 Custom Element 当前统一渲染为板级+电机视觉表象，后续按变体分化外观。
13. **P2-8 (`pushbutton-6mm` 4脚别名补充)**：在 §2.1 `#1` Alias 补充支持 `wokwi-pushbutton-6mm` 视觉封装别名。

### 3.4 静态断言门禁强化类
14. **P1-6 (彻底替换弱 `_Static_assert` 模板)**：
   在 §5.1 彻底替换弱模板，改为双重断言：`_Static_assert(DAL_<TYPE>_VARIANT_COUNT == <N>)` + `_Static_assert(DAL_<TYPE>_VARIANT_<LAST> + 1 == DAL_<TYPE>_VARIANT_COUNT)`，两条共同才能同时抓住"追加未更新 N"与"中间插入顺延末值"两类静默错误。
   **`uint8_t` 变体的特别实现注意**（针对 `mono_oled` 等使用 `typedef uint8_t dal_<type>_variant_t` 而非 `enum` 的类型）：
   - `uint8_t` 类型本身无法追加枚举哨兵成员；VARIANT_COUNT 必须以**独立 `#define`** 方式定义（例：`#define DAL_MONO_OLED_VARIANT_COUNT 2`），不可写成枚举成员。
   - `_Static_assert` 仍可正常适用：`_Static_assert(DAL_MONO_OLED_VARIANT_SH1106 + 1 == DAL_MONO_OLED_VARIANT_COUNT, "...");`
   - 回灌时需区分两种路径：`enum` 类型追加 `_COUNT` 哨兵枚举成员；`uint8_t` 类型补充独立 `#define` 并在头文件同一位置补双重 `_Static_assert`。

---

## 4. 四分步 Commit 落地计划 (4-Step Execution Plan)

按 CLAUDE.md “按逻辑模块聚合”要求，划分为 4 个独立 commit 依次执行：

### Step 1: 架构自洽、 Provider 用词与断言门禁 (Commit 1)
* 修补 P1-1 (`biaxial_stepper` §2.3 复合行，注明单/双极相位)
* 修补 P1-2 (`rotary_dialer` 标 🔴 Custom，消灭悬空行)
* 修补 P1-3 ( Provider 静态绑定用词纠偏与 ADR-0004 §3 引用)
* 修补 P1-8 (`affects_pins` 比对范畴澄清)
* 修补 P1-6 (在 §5.1 彻底替换 `_Static_assert` 为 `VARIANT_COUNT` 断言模板)

### Step 2: 物理脚逻辑化与网表短接规则 (Commit 2)
* 修补 P0-7 (`relay` `ks2e` 原生裸件视觉壳说明、触点悬空与 BOM 限流电阻/二极管)
* 修补 P2-2 (`digital_sensor` 补全 `photoresistor`)
* 修补 P2-3 (`dht22` 主表写 **2Pin 逻辑脚** `[VCC, DATA]`，备注注明 SDA 误称与 NC 脚由 Codegen 留空)
* 修补 P2-4 (`lcd_char` tie-down 限定 `parallel_4bit`)
* 修补 P2-9 (`pushbutton` 内部等电位节点合并与 `dip_switch` 短接规则)

### Step 3: 硬件别名与细节提示补全 (Commit 3)
* 修补 P2-5 (滑杆 taper 算法 BAL 说明)
* 修补 P2-6 (DS1307 5V 电平提醒)
* 修补 P2-7 (`dc_motor` Custom 视觉分化说明)
* 修补 P2-8 (`pushbutton-6mm` 别名补充)

### Step 4: `seg_display` 物理引脚对照表与处置说明补全 (Commit 4)
* 修补 P1-5 (`seg_display` 在 §4.6 补充 Per-N 物理引脚对照表，明确 `COM` 脚 (pin 7) 属于 4 位模式活跃脚，`digits=5..8` 标 🔴 Custom)
* 补充 P1-7 (SSOT v2.4.0 搬迁处置说明) 与 P2-1 (心率传感器 AOUT 拟合处置说明)

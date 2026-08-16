# 评审记录：Wokwi-Elements ↔ DAL 外设三级分类 SSOT (v2.3.2 深度专家复盘与 v2.3.3 勘误计划)

| 项 | 内容 |
|---|---|
| **文档名称** | DAL 外设三级分类 SSOT (v2.3.2) 专家深度评审复盘与 v2.3.3 勘误落地计划 |
| **文档路径** | `docs/reviews/frontend/2026-08-08-wokwi-dal-ssot-v2.3.3-review-and-errata.md` |
| **评审对象** | [`00.1-category-type-variant-wokwi-ssot.md`](../../implementation-plans/frontend/00.1-category-type-variant-wokwi-ssot.md) (v2.3.2 完备版) |
| **评审日期** | 2026-08-08 |
| **评审参与人** | AI 嵌入式助手 & 人工资深嵌入式架构师 |
| **关联文档** | 前序勘误 [`2026-08-07-wokwi-dal-ssot-v2.3.2-errata-and-execution-plan.md`](2026-08-07-wokwi-dal-ssot-v2.3.2-errata-and-execution-plan.md) |

---

## 1. 评审背景与核心原则

在 v2.3.2 勘误落地后，针对 SSOT 当前文本与物理嵌入式硬件、通信协议及 Wokwi 数字行为级仿真机制进行了二次深度交叉审计。

本轮评审达成了一项**关键架构共识**：

> **严格区分“现有 32 个 Type 的 SSOT 勘误纠偏”与“未来新 Type/Variant 的器件扩表提案”。**
> 勘误计划（errata plan）的职责是消除已收录 32 个 Type 的硬伤与边界张力，不得将涉及 API 控制语义改变（违反 Boundary A）的新硬件盲目强行塞入现有 Type。

---

## 2. 评审结论分档明细

### 2.1 ✅ 采纳与强化项 (P1 / P2 勘误入库)

#### 1. IR 接收头 vs 协议解调层的边界澄清 (P1 架构修正)
* **事实厘清**：TSOP1838 / VS1838 硬件仅做 38kHz 载波包络解调，输出原始脉冲串；真正的协议解码（NEC / RC5 / Sony）由 MCU 侧（RMT / 定时器捕获）完成。
* **边界对齐**：
  - 变体名 `DAL_IR_RECEIVER_VARIANT_NEC_STANDARD` 予以保留，明确其含义为**绑定 Wokwi `<wokwi-ir-receiver>` 配套遥控器组件的仿真默认输出格式**；
  - 补充说明：若 DAL C 驱动支持多协议扩展，解码协议归入 `dal_ir_receiver_config_t.protocol` 标量枚举，严禁因增加 RC5/Sony 协议而新建变体（严格恪守 Boundary B）。

#### 2. DHT11/DHT22 `model` 标量进 Config (P2 补充)
* **事实厘清**：DHT11 与 DHT22 引脚拓扑完全一致（单总线 DATA），数据帧同为 40-bit 脉冲，区别仅在于起始脉宽（≥18ms vs ≥1ms）与数据译码位宽（8-bit 整数 vs 16-bit 0.1℃ 缩放）。
* **边界对齐与工程取舍 (Boundary B Border Case)**：
  - *临界判读*：按 Boundary B 字面“引起状态机/驱动逻辑分支变化提炼变体”，DHT11 确实改变了时序与译码状态机；但鉴于引脚拓扑与 40-bit 物理帧结构完全一致，且业界主流 C 驱动（Adafruit DHT、ESP-IDF）均通用 `model` 枚举消化差异。
  - *抉择*：选取“降低变体枚举 churn”的工程取舍，保持变体名 `dht22_single_wire` 不变；
  - 在 Alias 备注中显式补充：*“DHT11 型号通过 `dal_temp_humidity_config_t.model` 标量参数传递，时序与译码差异由驱动内部按 model 分支处理”*，使架构取舍完全透明化。

#### 3. SPI 显示屏 `-1` 哨兵与工程 Caveats (P2 补充)
* **事实厘清**：SSOT 已建立 `-1` 哨兵机制（如 `ssd1306_spi`、`mpu6050` XCL/XDA 脚）。本项在 §2.5 备注中对 SPI 显示屏各引脚点名强调并补充两个嵌入式工程 Caveats：
  1. **CS 不能无脑 `-1`**：`-1`（硬接 GND）仅适用于该 SPI 总线上**只有单一显示屏**的场景；若总线挂载多个 SPI 器件，CS 必须由 MCU 逻辑控制，否则引发总线冲突；
  2. **MISO `-1` 仅限纯写屏**：仅在无需读取 GRAM 或 Panel ID 的单向写屏模式下 MISO 赋 `-1`；需回读数据时必须绑定 MISO。

#### 4. Header 版本号 Bump 至 v2.3.3 (P2 修正)
* 修正 SSOT Header 第 7 行，版本号提升至 `v2.3.3`。

---

### 2.2 ⚠️ 归位项 (移出勘误，记入新 Type 扩展 Proposal)

#### 1. 单脚 PWM 直流负载 (`pwm_load` / `dimmable_output`)
* **归位理由**：
  - **违反 Boundary A**：H 桥 `dc_motor` 的 C API 语义是 `set(speed, direction)`（双控量）；而 MOS 管/三极管驱动的单脚风扇/水泵只有 `set_duty(power)`（单控量）。强行塞入 `dc_motor` 会导致 `direction` 参数变为无意义的 dummy 占位，破坏 API 签名一致性。
  - **违反 §4.1 零歧义**：在 `in_in` 变体中允许 `IN2=-1` 动态变脚数属于明令禁止行为。
* **处置**：不在 v2.3.2/v2.3.3 勘误中强行修改 `dc_motor`。记为未来扩展的**新 Type 提案**（Category: `output`, Type: `pwm_load`）。

#### 2. DS18B20 单总线数字温度传感器 (`temp_sensor`)
* **归位理由**：
  - **违反 Boundary A**：`temp_humidity` 的 C API 签名是 `read(temp, humidity)`，而 DS18B20 只有温度，`humidity` 字段悬空；且 Maxim 1-Wire 协议（ROM 寻址/CRC8/时隙）与 DHT 单总线（毫秒级自定义脉冲）在物理层和状态机上完全不同。
* **处置**：不在 v2.3.2/v2.3.3 勘误中强行塞入 `temp_humidity`。记为未来扩展的**新 Type 提案**（Category: `sensor`, Type: `temp_sensor`）。

---

### 2.3 ❌ 撤回与剥离项

#### 1. I2C / 1-Wire 自动合成上拉电阻 (撤回)
* **撤回理由**：Wokwi 是 JavaScript/Wasm 数字行为级仿真引擎，不是 SPICE 物理电路仿真。Wokwi 原生元件（如 `wokwi-ssd1306`）在逻辑层已处理电平驱动，无需外部 `wokwi-resistor` 上拉即可正常通信。自动合成上拉电阻会严重污染 Codegen `diagram.json` 画布的可读性。

#### 2. §4.2 非阻塞与超时规则 (剥离至 C Code Style ADR)
* **剥离理由**：§4.2 规定的是 POD Config 与 Variant 的解耦，非阻塞/超时属于驱动并发模型范畴；且微秒级 bit-banging（如 DHT22 响应、SW-SPI）必须依赖有界忙等，一刀切禁止 `while` 忙等会导致微秒级时序崩溃。该规则剥离至 C 代码规范 ADR 处理。

---

## 3. v2.3.3 勘误落地 Step 计划

我们将上述收敛后的 P1/P2 勘误项按逻辑 Commit 落地至 [`00.1-category-type-variant-wokwi-ssot.md`](../../implementation-plans/frontend/00.1-category-type-variant-wokwi-ssot.md)：

### Step 1: IR 协议层与 Wokwi 遥控器绑定澄清 (P1)
* 在 §2.1 #4 `ir_receiver` Alias 备注补充 Wokwi 遥控器仿真输出绑定说明与 `config.protocol` 澄清。

### Step 2: DHT11 Config 标量与 SPI 显示屏 `-1` 哨兵强化 (P2)
* 在 §2.4 #16 `temp_humidity` 补充 DHT11 经 `config.model` 扩展说明；
* 在 §2.5 #19/#21 补充 SPI 显示屏 CS 独占/多设备争用与 MISO 纯写 Caveats。

### Step 3: SSOT Header Bump 至 v2.3.3 (P2)
* 将 SSOT 第 7 行版本号更新为 `v2.3.3 (IR与显示屏协议契约强化及 DHT11 config 标量终态版)`。

---

## 4. 新器件扩展 Proposals 归档 (Proposal Backlog)

| 提案序号 | 建议 DAL `type` | 建议 `category` | 匹配硬件与协议 | 拟定义变体 | Wokwi 元件基线状态 |
|:---:|---|---|---|---|:---:|
| **PROP-01** | `pwm_load` | `output` | 单 MOS 管/三极管驱动的 DC 风扇、水泵、单向 PWM 电机 | `single_pin_pwm` | 🔴 Custom (待规划) |
| **PROP-02** | `temp_sensor` | `sensor` | Maxim 1-Wire 单总线数字温度传感器 (DS18B20) | `ds18b20_one_wire` | 🔴 Custom (待规划) |


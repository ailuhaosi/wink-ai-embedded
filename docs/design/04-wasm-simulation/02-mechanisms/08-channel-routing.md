# 多通道路由与外设仿真选型

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Partial**：通道 1/1b/2 **Landed**；超声波沿注入 **Partial**（P0 捷径 **Deprecated**）；通道 3/4 **Planned**。选型表「状态」列使用根 [00 §3.2](../00-README.md) 词表 |
| 支撑轴 | **A（primary，数据面）**；PWM 通道 1b **路由**（硬件 behave → [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)） |
| 关联代码 | `wink-micro-os/targets/wasm/`、`wink-micro-os/targets/wasm/devices/wasm_dev_*.c`、`wink-micro-os/targets/wasm/wasm_bridge.h`、`wink-micro-os/targets/wasm/pal_hal_wasm.c`、`@wink-ai/unisim` (SimBridge 模块) |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | 0002、0003、0040、0042、0045、0047 |
| 迁自 | `04-wasm-simulation-2.0/09-channel-routing.md`（**剥离** §1.4 / §5.3 定时器语义至 `09-timer-…`） |

> 本文件覆盖轴 A（外设物理源）的**数据面**：物理量从哪条通道进入固件、如何选型、Plugin Channel 红线。配置面（注册表 / PinArbiter）见 [`07-peripheral-registry.md`](./07-peripheral-registry.md)。
>
> **硬件定时器 / PWM 周期 / capture / `pal_hwtimer` / FOC 软步进** 的行为语义 → [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)。轴 B/C/D/E/F 定义与上限缩略见 [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md)；生产口径见 [`../01-overview/03-production-contract.md`](../01-overview/03-production-contract.md)。本篇**不重定义** A~F，**不复制**生产口径长文。

---

## 1. 核心架构原则

### 1.1 分层同源契约（Homology Boundary）

```text
App / BAL / DAL（API + 实现）  ← 无仿真业务特例；目标：零 #ifdef SIMULATION
        │
PAL / HAL API（双 target 同签名）
        │
PAL Wasm 实现 / wasm_dev_*     ← 唯一合法的平台旁路落点（可仿真特化）
        │
JS Plugin / ProductWorld       ← 只产出"物理量来源"，禁止替换 DAL 逻辑
```

传统在 µs/ns 级翻电平（115200 UART、400kHz I2C）= 每秒几十万次 JS↔Wasm 交叉，会冻结主线程。早期在 DAL 内用 `#ifdef SIMULATION` 直接返回 cm/°C 的业务捷径，被工程证明会撕裂 sim/real 驱动路径——协议换算/超时/错误恢复从未被仿真验证。

### 1.2 三条铁律

1. **只替换物理量来源**（引脚电平、脉冲边沿、总线从机响应字节、ADC 原值、缓冲内容）；**永不替换** DAL 单位换算、CRC/校验、超时、重试/错误恢复。
2. **旁路落平台层**：所有拦截/路由沉到 PAL/HAL（及 Wasm target 实现）；禁止 DAL 业务捷径。
3. **Fail-Loud（ADR-0040）**：新外设必须映射到某个通道；无法映射时不得私自加 DAL `#ifdef`——扩展 PAL 抽象或提交通道契约 ADR。

### 1.3 Accuracy Mode 与保真门禁

> **SSOT**：Accuracy Mode 定义、与 Execution Mode 正交关系、观测证据效力 → **[`11-accuracy-observation-lifecycle.md`](./11-accuracy-observation-lifecycle.md)**。本节仅保留选型门禁摘要，**禁止**在此膨胀第二份全文。

| 模式 | 支持 | 禁止作为证据 | 降级契约 |
|---|---|---|---|
| `behavioral` | L1 状态机 + L2 payload/StateChannel 语义 | 边沿触发 IRQ、脉宽捕获、去抖时序 | **能力降级**：必须保留脉宽/测距信息量（经 VirtualClock 延迟双沿或高层 payload），**严禁**折叠为终态电平导致信息灭失 |
| `timing` | L2 边沿因果 + 受限 L3 虚拟时钟脉宽/边沿近似 | cycle/电气级结论 | 完整微秒级事件队列调度 |
| `cycle` | Planned（I2C 边沿等） | — | 逐周期/电气级模拟 |

> **门禁**：任何「脉冲器件（如超声波）高一致」主张**必须**在 `timing` 下验证；behavioral 结果不得作为脉冲/中断一致性证据。**降级铁律**：任何模式下的降级都是时间分辨率的分级（Capability-based），**绝对不得改变或丢弃信号携带的信息量**。

**Accuracy Mode ≠ 执行模式**：前者是保真主张分级（behavioral/timing/cycle），后者是 INTERACTIVE/HEADLESS（ADR-0042，见 [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md)）。两者正交。

---

## 2. 四通道 + PWM / 定时调制通道

```text
Wasm 固件（App/BAL/DAL 同源）
   │
   ├─ 通道 1  电平/边沿级 pal_gpio_*      → PinArbiter（按键/LED/超声波脉冲/输入捕获）
   ├─ 通道 1b 定时调制级 pal_pwm_set_duty → notifyDutyChange（舵机/电机占空比/定时比较）
   ├─ 通道 2  协议总线级 pal_i2c/spi/uart → I2CBus/SPIBus/UARTBus（OLED/总线传感器/串口）
   ├─ 通道 3  模拟信号级 pal_adc_read     → ADC 源（NTC/LDR/摇杆/电位器）
   └─ 通道 4  缓冲区帧级 pal_ws2812_write → FrameBuffer/SAB（WS2812/摄像头）
        │
        ▼
   SimWorker + SimulationPluginHost → ControlHub / World UI / ProductWorld(3D)
```

> 命名说明：PWM 走 GPIO 物理引脚，属于定时器输出比较 (Output Compare) 调制语义，非字节协议总线，故列为 **通道 1b**（合称「数据面四通道 + 通道 1b 定时调制」）。PWM **载波/周期/硬件 behave / FOC** → [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)。

### 2.1 通道 1：电平级（Pin-Level）

- **保留同源**：DAL 触发时序、`pulse_in`/捕获、超时与错误处理；
- **旁路**：引脚电平源（PinArbiter 上的驱动电平 + 边沿时间）；
- **PAL 锚点**：`pal_gpio_read`/`pal_gpio_write`/`pal_gpio_pulse_in`（或等价捕获）；
- 固件 GPIO 映射到 PinArbiter（多源驱动仲裁 + 阻抗/浮空）；插件用 `writePin` 注入，UI 可用 ideal driver 注入。旋转编码器在 timing 模式下走定时器输入捕获 (Input Capture) 硬件抽象。

**超声波目标形态**：ProductWorld/ControlHub → UltrasonicPlugin（持 distanceCm）→ 按 VirtualClock 把 ECHO 高/低边沿注入 PinArbiter → C `pal_gpio_write(TRIG)` + `pal_gpio_pulse_in(ECHO)`（测量路径同源）→ DAL 脉冲→距离换算/超时/错误码（业务路径同源）。落地机制是 Pin Event Queue 零 Yield 快进（见 [`02-virtual-clock.md`](./02-virtual-clock.md)）。

### 2.2 通道 1b：PWM 占空比（Modulation Semantic）

- **保留同源**：DAL 角度/速度→占空比换算、使能与 clamp 逻辑；
- **旁路**：µs 级载波边沿 → 仅旁路 duty 变更事件（`notifyDutyChange`），不逐边沿仿真；
- **PAL 锚点**：`pal_pwm_set_duty(channel, duty_cycle_percent)`（duty 量程 `[0.0, 100.0]`，clamp 由 DAL 保证）→ `notifyDutyChange` → 插件状态/3D 关节；
- 保真度默认 L2（duty 语义）；不显式 `timing` 契约不宣称载波周期 L3。FOC 快环 / `pal_hwtimer` 属轴 C（见 [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)）。
- **输入捕获（Input Capture）**：旋转编码器/脉冲计在 timing 模式下走定时器硬件捕获，旁路锚点为 `pal_hwtimer` capture 通道（与 PWM output compare 共享 [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md) 定时器基准，但数据流方向相反：PWM 是固件→物理输出，capture 是物理→固件输入）。behavioral 模式下仍可退化到通道 1 GPIO 边沿队列。

### 2.3 通道 2：协议总线（Bus Protocol）

- **保留同源**：DAL/BAL 寄存器打包、地址解析、CRC/校验、超时重试、帧状态机；
- **旁路**：字节级总线事务（起止条件、ACK、位时序）折叠为 payload 传输；
- **PAL 锚点**：
  - I2C：`pal_i2c_transfer` → I2CBus / 虚拟从机寄存器镜像；
  - SPI：`pal_spi_transfer` → SPIBus；
  - UART：`pal_uart_write`/`pal_uart_read` → UARTBus（异步 RX/RX IRQ 见 ADR-0054）；
- 固件经总线 PAL 访问从机；插件注册虚拟从机（`registerI2CDevice`/`registerSpiDevice`/UART 端口绑定）响应寄存器读写；
- 保真度默认 behavioral（事务/寄存器语义）；不宣称位时序 L3；
- 状态：I2C/SPI **Landed**；UART TX **Partial**，异步 RX **Planned**（ADR-0054）。

### 2.4 通道 3：模拟量（Analog Signal）

- **保留同源**：DAL 原始值校准、滤波、阈值、错误码；raw↔mv↔归一化换算在同源 C 路径（`pal_wasm_adc.c`），DAL/BAL 可复用、可单测；
- **旁路**：仅 ADC 通道的**归一化物理源** `[0,1]`；
- **PAL 锚点**：`pal_adc_read_raw/mv(channel)`（公共 API 见 [ADR-0057](../../../decisions/core/0057-pal-adc-subsystem-and-channel-3-analog-contract.md)；DAC 对称留待将来）；
- **Wasm 数据路径（ADR-0057 决策 2）**：导入 `extern float js_pal_adc_read_norm(uint16_t pin)`，JS 侧读 `PinArbiter.readAnalog(pin)`（电位器等经 `setAnalogDriver` 写入，见 [`07`](./07-peripheral-registry.md) §4.3）。**不新增 `js_pal_adc_read_mv`**——JS 不做 mV 换算、不知满量程；C 侧 `raw = norm × ((1<<bits)-1)`、`mv = norm × full_scale_mv`，并经退化引擎叠加 RC 低通 + 高斯噪声 + 预热/采样间隔判定（复用 `wink_phys_rc_lowpass`/`wink_phys_warmup_check`）。
- **禁止**直接 `return temperature_c`（那是 DAL 业务返回）；温度/光照/BPM/重量由上层（App/BAL 或 `environment_sensor`/`motion_sensor` 等 role）基于 `read_mv` 解释。
- **PRNG 隔离**：ADC 噪声用 per-channel 独立种子（`seed = hash(pin)`），不消费 ADR-0009 的全局 `s_prng`，故不扰动非模拟外设 golden。这是 ADR-0009 §7 预留的"per-id 子流派生"演进的首次落地。
- 状态：**Partial**（契约与 PAL/wasm 路径由 ADR-0057 定稿；首批 DAL 消费者 `analog_knob`/`analog_sensor` 随 P0 子计划落地后升 Landed）。

### 2.5 通道 4：缓冲区（Buffer Payload）

- **保留同源**：App/DAL framebuffer/RGB 数组填充与消费算法；
- **旁路**：非标极高频位时序（WS2812 0.4µs NRZ）或海量帧逐脚翻转；
- **PAL 锚点**：`pal_ws2812_write(buf,len)`/`pal_camera_capture`/（规划中）`SharedArrayBuffer`；
- 必须仍走**具名 PAL buffer API**；不得退化为 DAL `#ifdef` 直接画 UI。
- 状态：**Planned**。与 ADR-0045 固定堆（`-sALLOW_MEMORY_GROWTH=0`，待落地）的 SAB 协作方式需在落地时另行设计。

### 2.6 控制面三线 (Control Plane Anchors)

数据面五通道（1 / 1b / 2 / 3 / 4）传递物理信号，控制面三线提供时序同步与中断驱动：

1. **🔴 中断线 (IRQ Line)**：JS 将中断事件 enqueue 到 `InterruptQueue`，C 侧在安全点经 `js_pal_poll_interrupt` 取出并 dispatch（pull 模型，详见 [`04-interrupt-model.md`](./04-interrupt-model.md)）；支持 MPU6050 数据就绪、按键双沿、UART RX；不在 JS→C 方向引入异步 push 调用；
2. **⏱️ 定时器基准 (HW Timer Anchor)**：输入捕获 (Input Capture)、输出比较 (Output Compare) 统一时间基准（见 [`09`](./09-timer-and-pwm-semantics.md)）；
3. **📦 DMA / 帧传输背压 (DMA Backpressure)**：WS2812 / 摄像头帧缓冲区完成信号与背压控制。SAB 所有权/seqlock/Atomics/COOP-COEP/溢出策略**尚未设计**，随通道 4 落地时补独立契约（见 §2.5 Planned 状态），本节仅登记锚点不定义协议。

---

## 3. 外设选型决策

### 3.1 选型表

「状态」列使用根 [00 §3.2](../00-README.md) 成熟度词表（Landed / Partial / Planned / Deprecated）。表格包含 **业务功能外设**（7 大原生分类）与 **基础设施/拓扑外设**（5 大拓扑范式）。

| 类别 (Category) | 示例 | 判定特征与关键字段 (Key Fields) | 仿真通道 | PAL 锚点 | 状态 | 推荐 Accuracy | 保留/旁路 |
|---|---|---|---|---|---|---|---|
| **【业务功能外设】** | | | | | | | |
| 开关/指示 (`input`/`output`) | 按键 / LED / 继电器 | 开关电平、GPIO 边沿、`gpio_pin` / `active_high` | 1 Pin | `pal_gpio_*`/PinArbiter | Landed | behavioral（IRQ 用 timing） | 保留读/写/中断订阅；旁路引脚电平源 |
| 脉冲时序传感器 (`sensor`) | HC-SR04 | 脉冲宽度测量、微秒级 capture/pulse_in、`trig_pin` / `echo_pin` | 1 Pin | `gpio`+`pulse_in`/捕获 | **Partial**（测量捷径 **Deprecated**） | **timing（强制）** | 保留捕获+换算；旁路 ECHO 边沿源（见 §5.1） |
| 脉冲编码传感器 (`sensor`) | 旋转编码器 | A/B 相正交脉冲、软件计数/硬件输入捕获、`phase_a_pin`/`phase_b_pin` | 1 Pin（behavioral）/ 1b 定时捕获（timing） | `gpio`+边沿 / `pal_hwtimer` capture | Planned | behavioral（高频计数用 timing） | behavioral 保留正交状态机旁路边沿源；timing 旁路硬件捕获计数 |
| 总线显示 (`display`) | SSD1306 | 帧缓冲 Framebuffer、图形/文本渲染、`i2c_bus` / `i2c_addr` | 2 Bus | `pal_i2c/spi_transfer` | Landed | behavioral | 保留协议打包；旁路位时序到 payload |
| 总线传感器 (`sensor`) | MPU6050 / AHT20 | 寄存器读写、周期轮询采样、`i2c_bus` / `i2c_addr` | 2 Bus | 同上 | Partial（MPU6050 Landed；AHT20 Planned） | behavioral | 保留寄存器逻辑；插件虚拟从机 |
| 通信模块 (`comm`) | GPS NMEA / AT modem | **UART 串口、波特率、协议帧/AT流、`uart_port` / `baudrate`** | 2 Bus | `pal_uart_*` | **Partial**（TX/事务级）；异步 RX/RX IRQ **Planned** | behavioral（RX 时序勿用 timing 宣称） | 保留帧解析；旁路电气波形；**非**「UI 少」——是模型缺口 |
| 舵机/电机 PWM (`actuator`) | SG90 / H 桥 | 占空比调制、频率/周期、`pwm_channel` / `max_angle` | 1b PWM | `pal_pwm_set_duty` | Landed（duty） | behavioral（边沿用 timing） | 保留 duty 语义；不仿真载波边沿 |
| 模拟传感器 (`sensor`) | NTC / LDR / 摇杆 | 模拟电压量、ADC 采样转换、`adc_channel` / `raw_val` | 3 Analog | `pal_adc_read_raw/mv` | **Partial**（契约 ADR-0057；首批 DAL 随 P0 落地） | behavioral | 保留校准/阈值；旁路归一化源 `js_pal_adc_read_norm`（见 §2.4） |
| 系统存储 (`storage`) | AT24C02 / W25Q64 | **非易失存储、页/字节读写、`capacity_bytes` / `i2c_addr`** | 2 Bus | `pal_i2c/spi_transfer` | Landed/Partial | behavioral | 保留读写算法；旁路存储物理介质到 payload |
| 高频 LED / 媒体 | WS2812 / 摄像头 | 极高频 NRZ 时序、RGB 缓冲区、`pal_ws2812_write` / capture | 4 Buffer | `pal_ws2812_write` / capture / SAB | Planned | behavioral | 保留 RGB 缓冲语义；不仿真 NRZ / 逐脚翻转 |
| **【基础设施/拓扑外设】** | | | | | | | |
| IO 扩展 (`infrastructure`) | PCF8574 / 74HC595 | **总线接入但无业务Role、提供逻辑GPIO、`gpio_pin: "provider:P0"`** | 物理 2 Bus ➔ 逻辑 1 Pin | `pal_gpio_*` / Provider | Planned | behavioral | 保留链路解算；旁路总线扩展转换到虚拟 Pin |
| 选通/译码 (`infrastructure`) | 74HC138 / CD4051 | **地址线/使能线复用选通、`parent` / `channel` 挂载** | 物理 1 Pin ➔ 选通路由 | `pal_gpio_*` / Pin Mux | Planned | behavioral | 保留使能/地址逻辑；旁路译码切换电平 |
| 总线开关 (`infrastructure`) | TCA9548A | **解选同地址从机冲突、`i2c_bus: "switch:ch0"` 挂载** | 物理 2 Bus ➔ 虚拟总线 | `pal_i2c_transfer` / Bus Switch | Planned | behavioral | 保留通道切片逻辑；旁路多路总线路由 |
| 资源扩展 (`infrastructure`) | PCA9685 / ADS1115 | **扩展PWM/ADC资源、`pwm_channel: "provider:ch0"` 挂载** | 物理 2 Bus ➔ 逻辑 1b/3 | `pal_pwm_*` / `pal_adc_*` | Planned | behavioral | 保留资源绑卡；旁路总线协议到资源通知 |

### 3.2 决策树

```text
新外设
 ├─ 无业务 Role / 纯拓扑扩展 (GPIO扩展/译码器/总线开关)？ → 基础设施模式 (infrastructure)
 ├─ 标准数字总线字节事务 (传感器/显示/存储/串口)？   → 通道 2 Bus
 ├─ PWM 占空/电机调制？                              → 通道 1b PWM
 ├─ 纯模拟 ADC/DAC？                                 → 通道 3 Analog
 ├─ GPIO/脉冲捕获？                                  → 通道 1 Pin
 ├─ 高吞吐/非标超高频？                              → 通道 4 Buffer
 └─ 都不是 → Fail-Loud：扩展 PAL 或提 ADR，禁止 DAL 业务 #ifdef
```

---

## 4. Plugin Channel 保真红线

`js_sim_get_plugin_channel(instance_id, channel_name)`（C 侧签名 `extern float js_sim_get_plugin_channel(const char*, const char*)`，如 instance `"ultrasonic:0"`、channel `"distanceCm"`）/ ControlHub / `stateChannels` 是插件与宿主之间**物理语义 SSOT**，**不是 DAL 业务旁路 API**。

| 允许 | 禁止 |
|---|---|
| UI/3D → 插件注入 distanceCm/电压/寄存器镜像 | DAL 直接读业务语义 channel 并 `return` 给 app |
| 插件经 channel 计算后写 Pin/Bus 从机/ADC 源 | 用 channel 跳过 `pulse_in`/总线事务/ADC 采样路径且不标注 |
| 观测/Trace/UI 绑定读 channel | DAL `#ifdef SIMULATION` 调 channel 等价物 |

超声波收敛：channel 只喂插件；测量路径必须回到通道 1 边沿注入（§2.1）。C 侧 `wasm_dev_*` 「读 cm 再换算成 μs」仅允许作为 **Deprecated 捷径**，禁止复制到新器件模板。

---

## 5. 架构现状与保真收敛

1. **PinArbiter 是 GPIO 电气 SSOT**（取代旧名 PinManager；配置面细节见 [`07-peripheral-registry.md`](./07-peripheral-registry.md)）。
2. **总线传输**：同 Worker 同步 Heap 切片 → I2C/SPI/UART Bus；非跨线程 SAB 零拷贝。
3. **OLED**：Scheme-A 地址短路由已淘汰；统一 `js_pal_i2c_transfer` → `MonoOledPlugin`。
4. **旧专用导入已淘汰**：`js_sim_trigger_ultrasonic`/`js_sim_measure_echo_pulse_us` 不存在，新设计不得使用。
   > 注：`wasm_bridge.h` 顶部历史注释曾提到「Plan 4 会追加」这两个符号——该注释已过期（与本节冲突），文档以本节为准。
5. **Trace**：DAL/PAL 不直接 trace；`pal.transfer` 类摘要由 Worker 在 `js_pal_*` 返回时记录。
6. **ProductWorld/Raycaster**：3D 碰撞是表现层；距离注入插件，**严禁**作为 C DAL 返回值。

### 5.1 已知保真缺口（须收敛）

| 优先级 | 缺口 | 现状 | 目标 |
|---|---|---|---|
| **P0** | 超声波测量捷径 | `wasm_dev_ultrasonic_get_pulse_us` 优先 `js_sim_get_plugin_channel(..., "distanceCm")` 并在 C 内 cm→μs | 插件注 ECHO 边沿 + 同源 `pulse_in`；删除/降级 C 内换算捷径 |
| P1 | DAL 注释过期 | `dal_ultrasonic.c` 仍提已淘汰的 `js_sim_trigger/measure` | 对齐 ADR-0003 演进后的 PAL 路径 |
| P1 | UART 异步 RX | 仅有 `js_pal_uart_write`；无按虚拟时间的字节注入/RX IRQ | [ADR-0054](../../../decisions/unisim/0054-sim-uart-async-rx-model-boundary.md)（契约 Accepted；实现 Planned） |
| P2 | 通道 4（Buffer） | 架构预留 | 落地时补 PAL buffer API + 插件 |
| P0→P2 | 通道 3（Analog） | 契约已由 ADR-0057 定稿（`js_pal_adc_read_norm` + PinArbiter + C 侧 raw/mv 换算） | 首批 DAL（`analog_knob`/`analog_sensor`）随 P0 落地后选型表升 Landed；通道 4 仍 Planned |
| P2 | UART/SPI UI | 前端渲染消费者少 | 逐器件补 World/Hub；**不**替代 UART 异步 RX 模型 |

### 5.2 新增外设/改旁路自检清单

1. DAL/App 无仿真业务分支（无 `#ifdef SIMULATION` 返回物理语义捷径）；
2. 旁路锚点落在 PAL API 或 Wasm PAL 实现，能命名通道 1/1b/2/3/4；
3. 选型表填齐（保留/旁路、状态、Accuracy Mode）；
4. 脉冲/边沿/超时用例在 `timing` 下可复现（不得用 behavioral 冒充 timing 证据）；
5. Plugin Channel 只做物理源或观测，测量路径可 Trace 到对应 `js_pal_*`；
6. 无法映射 → Fail-Loud（扩展 PAL 或 ADR），无私有 DAL 捷径。

---

## 6. 淘汰与迁移

| 项 | 状态 | 原因 |
|---|---|---|
| DAL 业务直通（整驱动 `#ifdef` 返回业务量） | 淘汰 | 撕裂同源路径，假测试覆盖 |
| 驱动内嵌 3D Raycaster / 直接 `js_sim_get_distance` | 淘汰 | 表现层穿透 DAL |
| 每器件专用 `js_sim_trigger_*`/`js_sim_measure_*` 长期 ABI | 淘汰 | 统一为 Pin/Bus/ADC/Buffer + Plugin Channel |
| C `wasm_dev_*` 读 distanceCm 本地换算脉宽 | 过渡期 Deprecated | 收敛到 §2.1 边沿注入 |

**演进注记**：相对 ADR-0003 决策 2 原文，「只替换物理量来源」仍成立；落点从「DAL 最底层 `#ifdef`」进一步下沉到 **PAL Wasm 实现 + Plugin**；DAL 目标为零仿真宏。


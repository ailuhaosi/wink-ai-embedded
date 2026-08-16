# 双向闭环高保真仿真架构规范

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-11 部署；UniSim 双向闭环高保真 SSOT） |
| **落地** | **Landed**（波形批量注入 / C 驱动 SSOT / `js_pal_notify_pin_edge` 反向回调 / PinArbiter 电气仲裁 / 外设插件双向演算法） |
| 支撑轴 | Axis A（外设源）、Axis B（时间基准）、Axis E（调度并发） |
| 关联代码 | `@wink-ai/unisim` (PluginContext, PinArbiter, UnisimBridgeFactory)、`wink-micro-os/targets/wasm/wasm_bridge.h` |

> 本规范是 UniSim 3.0 关于**双向闭环高保真仿真（Bidirectional High-Fidelity Closed-Loop Simulation）**的权威设计文档。
> 澄清了“外设 $\rightarrow$ MCU 输入高保真”、“MCU $\rightarrow$ 外设 输出高保真”、“外设插件物理-电气演算法体系”以及“PinArbiter 电气仲裁与非目标（Non-Goals）边界”。

---

## 1. 架构愿景与双向闭环总览 (Closed-Loop Overview)

真实嵌入式控制系统（Control Systems & Actuators）在物理世界中永远是**双向闭环（Hardware-in-the-Loop）**的：
- **输入方向（外设 $\rightarrow$ MCU）**：物理环境量 $\rightarrow$ 电气/数字信号（传感器 Sensor）；
- **输出方向（MCU $\rightarrow$ 外设）**：电信号 $\rightarrow$ 物理动作/声/光/热（执行器 Actuator）；
- **闭环系统**：MCU 的输出改变执行器动作，执行器动作改变物理环境，环境变化再次被传感器捕获送回 MCU。

```mermaid
graph TD
    subgraph 物理与环境层 (Physical & Environment Domain)
        Env[环境物理量: 距离/温度/角度/光照]
        Act[执行器动作: 声波/转速/热量/光通量]
    end

    subgraph 外设插件层 (Peripheral Plugin Domain)
        P_In[输入插件演算法: 物理量 -> 电信号]
        P_Out[输出插件演算法: 电信号 -> 物理动作/感官]
    end

    subgraph UniSim 3.0 仿真内核 (Kernel Domain)
        Queue[C 侧 Pin-Event 队列 & SSOT]
        Arbiter[PinArbiter 电气仲裁]
        Callback[js_pal_notify_pin_edge 反向通知]
        WASM[WASM C 固件 & ISR 中断]
    end

    Env -->|物理变化| P_In
    P_In -->|injectWaveform| Queue
    Queue -->|精确 tUs 触发| WASM
    WASM -->|writePin / PWM| Callback
    Callback -->|同步打断| Arbiter
    Arbiter -->|observePin| P_Out
    P_Out -->|闭环渲染与物理推算| Act
    Act -->|物理反馈| Env
```

### 1.1 内核与插件的职责划分界面 (Kernel vs Plugin Boundary)

为了保证主循环极轻、极快且 100% 确定性，UniSim 严格划分了内核与插件的职责：

| 领域 (Domain) | UniSim 仿真内核 (Kernel) | 外设插件 (Peripheral Plugins) |
|---|---|---|
| **核心职责** | 纯数字与微秒级时间步进、C 事件队列、`PinArbiter` 电气仲裁、`js_pal_notify_pin_edge` 反向通知。 | 物理-电气双向演算法、Web Audio 声波合成、二阶运动学微分方程、UI 画布渲染。 |
| **数据形态** | 逻辑 0/1、微秒绝对时间戳 (`tUs: bigint`)、归一化模拟量 (`0.0 ~ 1.0`)。 | 物理量 (cm, °C, RPM, Lux, dBA)、物理几何与微分状态。 |
| **重构稳定性** | 核心 ABI 已锁定，不随具体传感器型号变更。 | 插件高度自治，可任意插拔与升级算法精度。 |

---

## 2. 输入高保真机制 (Input High-Fidelity: Peripheral -> MCU)

针对超声波回声 (HC-SR04)、红外 NEC 解码、脉冲计数等依赖微秒级捕获的外设，传统“定时器实时拉高拉低”存在 1~10ms 物理抖动与 ±1ms 量化误差。输入高保真通过**波形序列预加载 + C 驱动 SSOT** 解决。

### 2.1 基于 WaveformPreload 的波形批量注入
外设插件不通过实时 `setTimeout` 翻转，而是一次性将波形序列预排期：

```typescript
export interface WaveformEdge {
  tUs: bigint;      // 绝对虚拟时间戳（基于 VirtualClock.getUs()）
  level: 0 | 1;     // 目标电平
}

export interface Waveform {
  pin: number;
  edges: WaveformEdge[];   // 按 tUs 严格升序
  generation?: number;     // 世代令牌，用于覆盖/取消旧波形
}
```

### 2.2 绝对时间戳 (`bigint`) 与 0 抖动保障
- 放弃 `number` 浮点数与相对 `durationUs`，采用绝对 `bigint tUs`。
- **声波传播延迟**：准确表达声波往返的前置传播延迟 $t_{\text{prop}} = \frac{2D}{v}$，首边边沿触发时刻精确定位至虚拟时间坐标系。

### 2.3 C 驱动单一数据源 (C-Driven SSOT)
- 当插件调用 `PluginContext.injectWaveform` 时，仅调用 `push_pin_event` 压入 C 事件队列。
- JS 侧保持“失忆”，不建立平行队列，彻底消除 WASM `s_virtual_us` 与 JS `VirtualClock` 的双状态失配与微观竞态。

### 2.4 输入高保真代码仓与文件修改矩阵 (Input High-Fidelity Code Modification Matrix)

| 对应代码仓 (Repo) | 模块 / 契约描述 (Module Contract) | 具体代码修改职责 |
| :--- | :--- | :--- |
| **`wink-micro-os`**<br>*(C PAL 驱动层)* | `targets/wasm/wasm_bridge.c`<br>`targets/wasm/wasm_bridge.h` | 1. **新增专有 Ring-Buffer**：建立 512 深度的 C 侧 `pin-event` 队列，解耦 16 深度的通用中断队列。<br>2. **µs 精确触发**：在 `pal_wasm_advance_virtual_clock`（1ms 量子步进）内按精确 µs 时刻弹出边沿并触发固件 ISR。<br>3. **世代取消**：实现 `generation` 令牌，收到新波形时失效旧边沿。 |
| **`wink-ai` (`@wink-ai/unisim`)**<br>*(TS 仿真内核层)* | Waveform Engine<br>PluginContext<br>WasmPhysicalBridge | 1. **类型定义**：在 Waveform 规范中定义 `WaveformEdge{tUs:bigint}` 绝对时间戳契约。<br>2. **一等公民 API**：在 `PluginContext` 暴露 `injectWaveform(pin, waveform)`，将绝对 `tUs` 转为相对 `delayUs`。<br>3. **WASM 压栈代理**：在 `WasmPhysicalBridge` 代理调用 WASM `exports.pal_wasm_push_pin_event`。<br>4. **模式降级**：在 `PluginContext` 实现 Behavioral 模式直接施加终态电平降级逻辑。 |
| **外置/内置外设插件仓**<br>*(外设实现层)* | `peripherals/builtin/ultrasonic/1.0.0/src/simulation.ts`<br>*(以及红外/脉冲外设插件)* | 1. **废弃旧手法**：彻底删除 `deferUs(() => writePin(...))` 旁路翻转。<br>2. **物理-电气演算法**：根据声速公式 $v = 331.4 + 0.61T$ 计算前置传播延时与脉宽。<br>3. **批量注入**：收到 Trig 后，一次性构建 `Waveform` 数组调用 `this.ctx.injectWaveform`。 |

---

## 3. 输出高保真机制 (Output High-Fidelity: MCU -> Peripheral)

当 MCU 固件向外设输出信号（如 GPIO 翻转、PWM 调光、蜂鸣器音频）时，必须保障外设插件能毫微秒不差地捕获固件输出。

### 3.1 `js_pal_notify_pin_edge` C-to-JS 同步反向通知
当 C 固件执行 `gpio_set_level` 或在精确 `tUs` 触发 Pin 事件时，C 引擎**同步阻塞发起导入函数回调**：
`js_pal_notify_pin_edge(pin: uint8_t, level: uint8_t, current_virtual_us: uint64_t)`

### 3.2 高频波形 Jitter-Free 录制与 `PinArbiter` 瞬间响应
JS 侧在被该回调打断时：
1. **原位翻转 PinArbiter**：在同一虚拟时刻刷新引脚状态；
2. **直投 SessionRecorder**：生成逐字节一致（Byte-identical）的 Channel 录制数据。

### 3.3 超高频 PWM 窗口化平滑 (Duty Cycle Windowing)
针对 20kHz+ 超高频 PWM（如电机调速），若每个 50µs 边沿均触发 UI 渲染会导致无谓性能消耗：
- 框架提供 `onDutyChange` 占空比窗口化平滑机制，在保留高频 Pulse 逻辑特性的同时，提取滑动窗口内的占空比百分比 ($0.0 \sim 1.0$) 供前端平滑渲染。

### 3.4 输出高保真代码仓与文件修改矩阵 (Output High-Fidelity Code Modification Matrix)

| 对应代码仓 (Repo) | 模块 / 契约描述 (Module Contract) | 具体代码修改职责 |
| :--- | :--- | :--- |
| **`wink-micro-os`**<br>*(C PAL 驱动层)* | `targets/wasm/wasm_bridge.h`<br>`targets/wasm/wasm_bridge.c` | 1. **声明反向 C-to-JS 函数**：在 `wasm_bridge.h` 声明 `extern void js_pal_notify_pin_edge(uint8_t pin, uint8_t level, uint64_t current_virtual_us);`。<br>2. **同步打断触发**：在 `pal_gpio_set_level()` 或 C 侧 `pin-event` 触发时刻，同步阻塞调用 `js_pal_notify_pin_edge`。 |
| **`wink-ai` (`@wink-ai/unisim`)**<br>*(TS 仿真内核层)* | ABI Imports<br>Bridge Factory<br>PinArbiter | 1. **TS ABI 声明**：在 `WasmImports` 接口中增加 `js_pal_notify_pin_edge` 签名。<br>2. **反向通知处理器**：在 `Bridge Factory` 中实现回调，在微秒点原位更新 `PinArbiter.setDriver('wasm', pin, level)` 并投递给 `SessionRecorder`。<br>3. **电气仲裁**：在 `PinArbiter` 结算 Push-Pull / Open-Drain 电路逻辑与短路冲突警告。 |
| **外置/内置外设插件仓**<br>*(外设实现层)* | `peripherals/builtin/buzzer/`<br>`peripherals/builtin/rc_servo/`<br>`peripherals/builtin/led/` | 1. **监听引脚**：在插件构造或启动时通过 `this.ctx.observePin('IN', listener)` 订阅 Pin 状态。<br>2. **电气-物理演算法与感官渲染**：<br>   * 蜂鸣器：收到 PWM 频率 $\rightarrow$ Web Audio API 动态合成声波波形。<br>   * 舵机：收到 PWM 占空比 $\rightarrow$ 二阶运动学计算实时转轴角度。<br>   * RGB LED：收到占空比 $\rightarrow$ 计算光通量与视觉余晖在 Canvas 上发光。 |

---

## 4. 外设插件演算法体系 (Plugin Physical-Electrical Math Models)

插件层通过数学公式实现物理与电气量的双向高保真转换：

### 4.1 物理 $\rightarrow$ 电气建模范式 (Physical-to-Electrical)
- **声波物理模型 (HC-SR04)**：
  $$v_{\text{sound}} = 331.4 + 0.61 \times T \text{ (m/s)}, \quad t_{\text{echo}} = \frac{2 \cdot D}{v_{\text{sound}}}$$
- **热敏电阻非线性曲线 (NTC Thermistor)**：
  $$R(T) = R_0 \cdot e^{B (\frac{1}{T} - \frac{1}{T_0})}, \quad V_{\text{out}} = V_{\text{cc}} \cdot \frac{R_{\text{pull}}}{R(T) + R_{\text{pull}}}$$

### 4.2 电气 $\rightarrow$ 物理/感官建模范式 (Electrical-to-Physical)
- **蜂鸣器音频合成 (Piezo Buzzer)**：
  接收 PWM 频率 $\rightarrow$ Web Audio API 动态合成基波与物理谐波：
  $$y(t) = A_1 \sin(2\pi f t) + \frac{A_1}{3} \sin(6\pi f t) + \frac{A_1}{5} \sin(10\pi f t)$$
- **舵机/电机二阶动力学模型 (RC Servo Kinematics)**：
  $$\frac{d^2\theta}{dt^2} + 2\zeta\omega_n \frac{d\theta}{dt} + \omega_n^2 \theta = \omega_n^2 \theta_{\text{target}}$$
  求解转轴实时角速度、加速度上限与物理超调 (Overshoot)。

---

## 5. 电气仲裁与工程非目标 (PinArbiter & Architectural Non-Goals)

### 5.1 `PinArbiter` 电气仲裁能力
UniSim 的 `PinArbiter` 提供基础电路级的多驱动源仲裁：
- **逻辑模式**：Push-Pull（推挽）、Open-Drain（开漏）、Weak-PullUp/Down（上下拉）；
- **冲突检测 (Contention)**：当多个 Strong Driver 强行输出相反电平（如 0 与 1）时，触发 `PinContentionCallback` 并抛出短路保护警告。

### 5.2 明确工程非目标 (Non-Goals & Architectural Boundaries)
为了保持仿真内核的高效与轻量，UniSim 明确界定以下非目标：
1. **不模拟 SPICE 级欧姆电压塌陷 (Dynamic Voltage Sag)**：
   不建立基尔霍夫网格求解器计算引脚 MOS 管内阻与大电流负载导致的动态压降（如 3.3V 塌陷至 2.1V）。
2. **不模拟模拟电路波形过冲与寄生电容 (Slew Rate & Overshoot)**：
   引脚跳变保持干净的数字逻辑沿与标量模拟量，不计算高频物理寄生参数。
3. **不模拟芯片 Cycle-Accurate 级指令消耗**：
   WASM 固件直接编译运行，不逐条解释 CPU 汇编指令周期。时间推进依赖 `busy_wait_us` / Asyncify。

---

## 6. 总结与落地规范

UniSim 3.0 通过 **C 驱动 SSOT + `js_pal_notify_pin_edge` 反向通知 + 插件双向演算法 + PinArbiter 仲裁**，构建了完整的双向闭环高保真体系。

外设插件开发者应遵循本规范：**在插件中精细化建模物理演算法，将时间调度与引脚翻转全权交由内核进行 0 抖动处理。**

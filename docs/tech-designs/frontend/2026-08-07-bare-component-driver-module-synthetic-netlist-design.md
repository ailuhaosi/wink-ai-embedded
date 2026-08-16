# 架构设计方案：裸芯片-驱动模块解耦与虚拟网表合成 (v1.0.0)

| 项 | 内容 |
|---|---|
| **文档名称** | 裸芯片 (Bare Component) 与驱动模块 (Driver Module) 的解耦及虚拟网表合成设计方案 |
| **创建日期** | 2026-08-07 |
| **作者/专家** | Wink-AI Embedded Architecture Team |
| **状态** | Approved / Design Benchmark |
| **关联评审** | [`docs/reviews/frontend/2026-08-07-wokwi-dal-ssot-review.md`](../../reviews/frontend/2026-08-07-wokwi-dal-ssot-review.md) |

---

## 1. 背景与问题定义

### 1.1 物理现实：裸硬件 vs 驱动模块
在物理嵌入式电路中，MCU 芯片的 GPIO 引脚仅能提供微弱的数字逻辑信号（$3.3\text{V}/5\text{V}$, $\le 20\text{mA}$）。物理外设可分为两类：
1. **裸芯片/裸器件 (Bare Components)**：如双极步进电机线圈 (`A+, A-, B+, B-`)、DPDT 继电器线圈 (`COIL1, COIL2`)。它们需要大电流或特定 H 桥时序，**物理上绝不能直连 MCU GPIO**。
2. **驱动模块/适配器 (Driver Modules/Adapters)**：如 A4988/DRV8825 步进驱动板、3 脚继电器驱动模块 (带三极管/光耦/续流二极管)、ULN2003 达林顿管阵列板。开发板 GPIO 连接的是驱动模块的**逻辑控制输入脚**（`STEP, DIR, EN` 或 `IN`）。

### 1.2 仿真冲突：Wokwi v1.9.2 的元件局限
- Wink 当前绑定的仿真基线 **`wokwi-elements@1.9.2` 仅包含裸件**（`wokwi-ks2e-m-dc5` 8脚继电器、`wokwi-stepper-motor` 4线电机），缺乏 `wokwi-relay-module` 与 `wokwi-a4988`。
- 如果将 DAL C 驱动逼退去适配裸件引脚（例如把 `dal_relay` 改成控制 `COIL1/COIL2`），会导致 DAL 接口污染、业务代码极其冗余，彻底违背 DAL 设备抽象的初衷。

---

## 2. 职责边界划分 (Separation of Concerns)

为彻底解决该矛盾，系统明确划分为 **DAL 逻辑抽象层** 与 **仿真网表/前端插件层** 两个互不污染的视角：

```
+------------------------------------------------────────────────────────+
|                   1. App 业务代码 & DAL C 驱动层                        |
|   - 只感知逻辑控制语义: dal_relay_set(IN, HIGH), dal_stepper_step()   |
|   - 物理引脚抽象仅包含逻辑输入脚: [IN] / [STEP, DIR, EN]                 |
+-----------------------------------┬------------------------------------+
                                    | Codegen 生成匹配
+-----------------------------------▼------------------------------------+
|               2. Codegen YAML & SSOT 分类 (规范层)                      |
|   - SSOT 标注逻辑引脚拓扑 (如 [VCC, GND, IN])                            |
|   - 当 Wokwi 缺失原生驱动模块时，标记 🔴 Custom                         |
+-----------------------------------┬------------------------------------+
                                    | 网表渲染 / 拓扑桥接
+-----------------------------------▼------------------------------------+
|             3. 仿真网表合成 & 前端 Custom Element 插件层                |
|   - 前端 (embedded-frontend) 提供 <wink-relay-module> Web-Component   |
|   - 或者 Codegen Netlist Generator 自动合成 [IN] ──> [COIL1/COIL2] 驱动 |
+------------------------------------------------------------------------+
```

---

## 3. DAL C 驱动层与 SSOT 的明确职责与改造指南

### 3.1 DAL 层“不做”什么（Non-Goals）
1. **DAL 层坚决不做功率驱动电路的建模**：DAL 不关心物理上线圈的电阻、三极管放大倍数或 H 桥上拉下拉逻辑。
2. **DAL 层坚决不为 Wokwi 裸件妥协 C API**：`dal_relay` 绝不能要求开发者传入 `coil_plus_pin` 和 `coil_minus_pin`；`dal_stepper` 绝不能要求开发者传入 4 线线圈极性脚。
3. **DAL 层坚决不包含 MCU 外设解调引擎变体**：如超声波的 RMT vs GPIO 选择，不属于外设物理拓扑，禁止膨胀为 DAL Variant。

### 3.2 DAL 层与 SSOT 规范“对应怎么改”（Action Items）

#### ① 继电器 (`relay`)
* **DAL C API**：保持单脚逻辑控制 `dal_relay_open(handle)` / `dal_relay_close(handle)`。
* **SSOT 引脚拓扑**：定义为逻辑引脚 `[VCC, GND, IN]` (3-pin)。
* **SSOT 适配模式**：因 v1.9.2 仅有裸继电器，标记为 **🔴 Custom** (`wink-custom-relay-module`)，指引前端或网表生成器提供驱动包装。

#### ② 步进电机 (`stepper`)
* **DAL C API**：
  - Variant `step_dir`：暴露 `[STEP, DIR, EN]` (3-pin 逻辑脚)。
  - Variant `four_wire`：暴露 `[IN1, IN2, IN3, IN4]` (4-pin 达林顿逻辑脚)。
* **SSOT 适配模式**：因 v1.9.2 仅有裸双极电机，标记为 **🔴 Custom** (`wink-custom-a4988` / `wink-custom-uln2003`)。

#### ③ 超声波 (`ultrasonic`)
* **DAL C API**：
  - 变体合并为 **`hcsr04`**（物理 4 脚 `[VCC, GND, TRIG, ECHO]`）与 **`single_pin_ping`**（3 脚 `[VCC, GND, SIG]`）。
  - **彻底移除 `gpio_hcsr04` / `rmt_hcsr04` 变体**。
  - ESP32 RMT 硬件捕获与软件 GPIO 捕获差异下沉至 `config.backend` (如 `dal_ultrasonic_backend_t`) 或 Target Codegen HAL。

---

## 4. 仿真网表合成与前端外置插件实现方案

### 4.1 方案 A：前端 Custom Element 插件（推荐长效方案）
前端 `embedded-frontend` 基于 Wokwi Custom Element 机制，注册 `wink-` 前缀外置组件：
1. **`<wink-relay-module>`**：对外引脚 `['VCC', 'GND', 'IN']`，内置 UI 触点动画与电路闭合逻辑。
2. **`<wink-a4988>`**：对外引脚 `['VDD', 'GND', 'STEP', 'DIR', 'ENABLE', '1A', '1B', '2A', '2B']`，内置脉冲计数与 H 桥换向驱动逻辑。

### 4.2 方案 B：Codegen 虚拟网表合成 (Synthetic Netlist Generator)
当不需要新增 UI 组件、直接重用 Wokwi 裸件动画时，由 Codegen WASM/Netlist 生成器在输出 `diagram.json` 时做中间网表合成：
* 开发板引脚 `GPIO 15` $\rightarrow$ 连接虚拟节点 `Logic_IN`；
* 自动补全回路：`5V` $\rightarrow$ `ks2e:COIL1`；`Logic_IN` (经过虚拟三极管电路) $\rightarrow$ `ks2e:COIL2`。

---

## 5. 总结与判决原则

> **架构黄金准则**：
> **“DAL 负责业务逻辑语义，前端与 Codegen 负责物理网表合成与仿真表现。”**
>
> 物理硬件的功率驱动模块与基础设施选通芯片，属于仿真层和硬件部署层的连线/拓扑映射问题，**绝不应倒灌污染 DAL 外设抽象层的纯洁性**。


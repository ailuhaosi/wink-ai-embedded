# 仿真数据面分层（输出观测 + 输入注入）— 技术设计规格

| 项 | 内容 |
|----|------|
| 状态 | **Accepted（已采纳）** |
| 创建日期 | 2026-07-12 |
| 范围层级 | ② 技术设计规格（`docs/tech-designs/`） |
| 关联设计规范 | [`../05-frontend-workbench/01-frontend-workbench-architecture.md`](../../design/05-frontend-workbench/01-frontend-workbench-architecture.md)、[`../05-frontend-workbench/03-dual-viewport-phased-design/04-phase-w3b-physics-actuators.md`](../../design/05-frontend-workbench/03-dual-viewport-phased-design/04-phase-w3b-physics-actuators.md)、[`../05-frontend-workbench/03-dual-viewport-phased-design/05-phase-w3c-sensors-env-bridge.md`](../../design/05-frontend-workbench/03-dual-viewport-phased-design/05-phase-w3c-sensors-env-bridge.md) |
| 关联实施计划 | Phase 1 已交付：[`../../implementation-plans/core/2026-07-11-avoidance-car-phase1-servo-observe-plan.md`](../../implementation-plans/core/2026-07-11-avoidance-car-phase1-servo-observe-plan.md)；本规格重构套件：[`../../implementation-plans/unisim/00-roadmap.md`](../../implementation-plans/unisim/00-roadmap.md)（M0–M6） |
| 关联评审 | [`../../reviews/core/2026-07-12-avoidance-car-phase1-servo-observe-review.md`](../../reviews/core/2026-07-12-avoidance-car-phase1-servo-observe-review.md)（Phase 1 舵机观测）、[`../../reviews/unisim/2026-07-12-sim-observation-layers-review.md`](../../reviews/unisim/2026-07-12-sim-observation-layers-review.md)（本规格，Accepted，综合评分 9.2/10） |
| 关联 ADR | [`ADR-0027`](../../decisions/unisim/0027-sim-observation-data-planes.md)（Accepted，2026-07-12） |
| 负责人 | TBD |

---

## 0. TL;DR

### 计数口径（全文统一，勿混用）

| 口径 | 数量 | 包含 |
|------|------|------|
| **输出观测通道** | **3** | ① Pin Mirror · ② Display Payload · ③ Actuator Observation |
| **输入注入通道** | **1** | ④ Ideal Inject（与输出正交，**不是**第四种观测） |
| **与 wink-micro-os 对接的数据面合计** | **4** | ① + ② + ③ + ④ |

> **一句话：** 输出观测 **3** 种；整条仿真数据面 **4** 条（3 出 + 1 入）。说「3 种」时只指输出；说「4 条」时包含输入。下文凡写「通道」均带编号，避免歧义。

Workbench 与 `wink-micro-os` Wasm **底层共用** Worker + `STATE_UPDATE`，但数据面必须分层，禁止用单一抽象硬塞所有外设。

### 四条数据面一览

**输出（Wasm → UI）— 3 通道：**

| 通道 | 数据形态 | 典型消费方 | 现状 |
|------|----------|------------|------|
| **① Digital Pin Mirror** | `pinStates: Record<pin, bool>` | 电路视窗、LED 亮灭、逻辑调试 | ✅ OLED Demo 在用 |
| **② Display Payload** | `oledFb: Uint8Array`（及未来 display batch） | OLED / 点阵 / 屏类 UI | ✅ OLED Demo 在用 |
| **③ Actuator Observation** | `ActuatorObservation[]`（物理量语义） | 执行器面板、3D ActuatorMirror、动力学 | ✅ 舵机 Phase 1 在用 |

**输入（UI → Wasm）— 1 通道（正交，非观测）：**

| 通道 | 数据形态 | 典型用途 | 现状 |
|------|----------|----------|------|
| **④ Ideal Inject** | `SET_PIN_IDEAL` / `SET_ULTRASONIC_*` → 未来 `setIdealInputs` | 按钮、超声、环境量灌进固件 | ✅ 在用；W3c 拟统一 API |

**推荐结论（供评审）：分层统一，而非通道合并。**

- 执行器语义 SSOT → **③ Observation**
- 电路脚级真相 SSOT → **① pinStates**
- 显示设备真相 SSOT → **② Display Payload**
- 传感器/人机输入 SSOT → **④ Ideal Inject**（输入面，不与 ①②③ 争「观测」名义）

---

## 1. 背景与问题

### 1.1 现状：两套输出路径并存

| Demo | 闭环 | 输出消费 |
|------|------|----------|
| `oled_dashboard` | 按钮按下 → 固件写 LED / 刷 OLED | UI 直接读 `pinStates` / `oledFb`（① + ②） |
| `avoidance_car` Phase 1 | 超声距离 → 固件控舵 → PWM duty | Mapper → `ActuatorObservation`（③） |

两者都经同一 Worker / Wasm / `STATE_UPDATE`，但**前端输出语义契约不同**。按钮/超声走的是 **④ 输入**，不要算成「第五种输出观测」。

### 1.2 若不规范的风险

1. 新外设插件随意绑 `pinStates` 或 Observation，3D / 面板出现双绑定或漏绑定。
2. 把 OLED framebuffer 硬塞进 Observation → 类型膨胀为杂物袋。
3. 废除 `pinStates`「为了干净」→ 电路调试、PinArbiter、故障可视化失去脚级真相。
4. LED 永远只读 `pinStates`、舵机只读 Observation → ActuatorMirror 无法统一驱动「灯 + 轮 + 舵」。
5. 文档把 ④ 说成「第四种观测」→ 与「输出 3 种」口径冲突，评审与实现各说各话。

### 1.3 设计目标

1. 用**固定计数口径**写清：输出观测 **3** 通道、输入注入 **1** 通道、数据面合计 **4** 条，以及各自适用场景。
2. 给出外设作者与 UI 作者的**强制纪律**（读什么、禁止读什么）。
3. 与 W3b（执行器/物理）/ W3c（传感器注入）路线对齐，可渐进迁移。
4. **本规格不要求立刻改代码**；评审 Accepted 后再拆实施计划 / ADR。

---

## 2. 概念澄清：输入 vs 输出

```text
        ┌─────────────────────────────────────────┐
        │              主线程 / UI                 │
        └───────────────┬─────────────────────────┘
                        │
     ④ Ideal Inject      │      ①②③ 输出观测（仅此 3 种）
     (UI → Worker → Wasm)│      (Wasm → Worker → UI)
                        │
        ┌───────────────▼─────────────────────────┐
        │     wasm-simulation.worker + wink-OS    │
        └─────────────────────────────────────────┘
```

| 方向 | 数量 | 问题 | 本规格覆盖 |
|------|------|------|------------|
| **输出观测** | **3**（①②③） | 固件驱动结果如何回到 UI / 3D？ | §3（主体） |
| **输入注入** | **1**（④） | 用户/环境如何把物理量灌进固件？ | §4（简述）；细节见 W3c |
| **数据面合计** | **4** | 与 OS 对接的完整 I/O 面 | §0 / §7 |

**禁止混谈：**

- 「按钮怎么进 Wasm」（④）与「LED 怎么亮」（① 或 ③）是不同方向。
- 统一输入 API（W3c）≠ 统一输出 Observation（W3b）。
- **勿说「有 4 种观测」**；正确说法是「3 种输出观测 + 1 种输入注入」。

---

## 2.1 Raw 是什么（传输层中间值）

> 评审讨论共识：先统一「Raw」词汇，再谈 ①②③，避免与 Ideal Inject、Observation 混淆。

### 定义

**Raw** = Worker 从 `wink-micro-os` Wasm **采集并打包**后的传输层数据——尚未（或不需要）变成业务物理量语义。

常见形态：

| Raw 形态 | 含义 | 典型载体（今日） |
|----------|------|------------------|
| **`gpio`** | 脚电平 HIGH/LOW | `pinStates`；亦可进 `ActuatorOutputBatch.gpio` |
| **`pwm`** | PWM 通道 → 占空比 % | `ActuatorOutputBatch.pwm` |
| **`fb`** | 显示帧缓冲字节 | `oledFb` |
| **`semantic`** | DAL/设备已算好的语义快照（仍属传输批的一栏） | `ActuatorOutputBatch.semantic?`（预留） |

### Raw 与三通道的关系（易混点）

```text
Raw（传输）                         输出通道（消费形态）
─────────                         ──────────────────
gpio  ──常直接──► ① Pin Mirror（pinStates；电路 UI 终点）
      └─可选经 Mapper──► ③ Observation（如 LED state）

fb    ──常直接──► ② Display Payload（oledFb；屏 UI 终点）

pwm   ──经 Mapper──► ③ Actuator Observation（如舵机角度）
semantic ──优先透传/轻映射──► ③ Actuator Observation
```

| 说法 | 对不对 |
|------|--------|
| 「Raw 是 ③ 的中间过渡值」 | ✅ 对：③ 必经 Raw → Mapper → Observation |
| 「Raw 也是 ①② 的中间过渡值」 | ⚠️ 不严谨：①② 上 Raw **常常就是 UI 终点**，不再换一层语义 |
| 「①=gpio，②=fb，③=semantic+pwm」 | ⚠️ 半对：③ 是 **Semantic 结果**；其原材料主要是 `pwm`/`semantic`，**也可含 `gpio`** |
| 「Ideal Inject = 把输出 Raw 写回 OS」 | ❌ 错：Inject 是 **输入激励**（见 §2.2 / §4），方向相反 |

**一句话：** Raw = OS 侧状态经 Worker 打包后的传输值；**③ 必经它再映射，①② 常常它就是最终给 UI 的值。**

### 谁负责 Raw（代码职责）

| 环节 | 负责方 | 做什么 | 代码锚点（当前） |
|------|--------|--------|------------------|
| 1. 产生/存放 | `wink-micro-os` Wasm | 固件写脚/PWM/刷屏后，C 设备模型保留状态 | `targets/wasm/devices/wasm_dev_servo.c`、GPIO/`pal_hal_wasm`、`wasm_dev_ssd1306.c` |
| 2. 导出给 JS | 同上 + export | `pal_wasm_get_pwm_duty_percent`、读 GPIO、`pal_wasm_get_ssd1306_fb` 等 | `wasm_bridge.h`、各 `wasm_dev_*.c` |
| 3. 采集成批 | **Worker** | 每仿真步调 export，填入 `STATE_UPDATE` | `../../../../wink-ai/packages/embedded-frontend/src/workers/wasm-simulation.worker.ts` → `pinStates` / `oledFb` / `actuatorOutputs` |
| 4. 落数据面（①②） | 主线程 runtime | `applyStateUpdate` 写入 ref | `simulation-runtime.ts` |
| 5. 映射为语义（仅 ③） | **Mapper + converter** | `ActuatorOutputBatch` → `ActuatorObservation` | `actuator-observation.mapper.ts`、`peripherals/servo/index.ts` 等 |

**纪律（与 §13.1 P5 一致）：** 新外设优先挂靠既有 Raw 形态（`pwm`/`gpio`/`fb`/`semantic`）；仅当现有 export 表达不了时，才扩展新的 Wasm 导出 / Worker 字段。

---

## 2.2 Ideal Inject ≠ 写输出 Raw

Ideal Inject（④）是 **UI → Worker → Wasm** 的**输入激励**：让固件 `read` 到理想世界（按键电平、超声距离等）。

| | Ideal Inject（④） | 输出 Raw → ①②③ |
|--|-------------------|-----------------|
| 方向 | 写入仿真 | 从仿真读出 |
| 目的 | 喂传感器/人机 **输入** | 看执行器/脚/屏 **输出** |
| GPIO 易混点 | `pal_wasm_set_gpio_input`（固件 **读** 到的理想输入） | 采固件 **写**/仲裁后的脚电平 → `pinStates` |

两边都可能碰到 GPIO，但角色相反，**禁止**说成「Inject 就是把 Raw 写进 OS」。

---

## 3. 输出观测：恰好三种（①②③）

> 本节只定义**输出**。长期共存 **3** 种，差异在语义层级与消费契约，不在「能不能连上 wink-micro-os」。  
> **④ 不在本节**——它是输入，见 §4。  
> Raw 词汇与职责见 **§2.1**。

### 3.0 通道 ↔ Raw 对照（速查）

| 输出通道 | 主要 Raw | Raw 之后还要不要映射 |
|----------|----------|----------------------|
| ① Digital Pin Mirror | `gpio` | 通常否（直接 `pinStates`） |
| ② Display Payload | `fb` | 通常否（直接 `oledFb`） |
| ③ Actuator Observation | `pwm` / `semantic` /（可选）`gpio` | **要**（Mapper → Observation） |

### 3.1 通道 ① — Digital Pin Mirror（数字脚镜像）

#### 定义

Worker 每仿真步采集已观察 GPIO 的逻辑电平，写入 `STATE_UPDATE.payload.pinStates`，主线程 `applyStateUpdate` 更新 `simulation-runtime.pinStates`。UI 按**引脚号**绑定布尔值。

#### 与 wink-micro-os 对接

```text
固件 pal_gpio_write / PinArbiter
  → Worker READ_GPIO_DEGRADED（或等价读口）
  → pinStates[pin] = HIGH|LOW
  → LED CanvasGlyph / WorldWidget 读 pinStates[comp.pinConnections.A]
```

输入侧常配合：`SET_PIN_IDEAL` → `pal_wasm_set_gpio_input`（按钮等）。

#### 数据契约（概念）

```typescript
pinStates: Record<number, boolean | PinSignalState>; // GPIO 号 → 电平/多态信号（未来扩展）

// 未来支持 ADC/高阻等精细电路诊断时，可扩展为：
interface PinSignalState {
  level: boolean;   // 逻辑高低
  voltage?: number; // 模拟电压 (V)
  mode: 'input' | 'output' | 'high_z' | 'analog';
  pull: 'none' | 'up' | 'down';
}
```

> **多态电平兼容设计：** 现阶段 `pinStates` 以 `boolean` 传输以保证传输效率，但消费侧（如 LED 或电路视窗）在读取时应使用封装好的 Helper 函数（如 `isPinHigh(state)`) 解析，以备后续平滑升级到 `PinSignalState` 结构。

#### 适合场景

| 场景 | 说明 |
|------|------|
| 电路视窗即时反馈 | 看某脚现在是高还是低 |
| 简单数字执行器 | LED 亮灭、继电器触点示意（电路层） |
| 调试 / 因果诊断 | 与 traces、故障注入、线断联动 |
| PinArbiter 多驱动冲突 | 需要脚级仲裁结果，而非业务语义 |
| 逻辑分析 / 示意波形 | 脚级时间序列（配合 traces） |

#### 不适合场景

| 场景 | 原因 |
|------|------|
| 舵机角度、电机 RPM | 不是 bool；需 PWM/语义换算 |
| 3D 关节驱动力 | ActuatorMirror 应消费物理量，不该解析 pin map |
| 跨驱动类型统一面板 | FOC/VESC 无法用 bool 表达 |
| OLED 像素 | 不是单脚电平 |

#### 优缺点

| 优点 | 缺点 |
|------|------|
| 与「读脚/写脚」心智一致 | UI 泄漏硬件（pin 号） |
| 实现简单、开销低 | 无法表达连续物理量 |
| 调试与故障模型贴合 | 消费层易分叉（各组件自己解 pin） |
| 已有完整路径 | 单独不足以支撑 W3b 物理引擎 |

#### 纪律

- **电路视窗允许**直接读 `pinStates`。
- **3D ActuatorMirror / 执行器语义面板禁止**以 `pinStates` 作为唯一 SSOT（若需要灯也进 3D，应走 ③ 或 ①→③ 映射）。
- LED 插件**可以**暂只绑 `pinStates`（现状允许）；若要进统一执行器面板，须同时或改为声明 `actuatorObserve`（见 §6）。

---

### 3.2 通道 ② — Display Payload（显示载荷）

#### 定义

面向「整块显示缓冲 / 结构化显示内容」的专用通道。当前实现：`oledFb: Uint8Array`（SSD1306 虚拟帧缓冲）。未来可扩展为 display batch（多屏、分辨率元数据），但**不并入** `ActuatorObservation.value`。

#### 与 wink-micro-os 对接

```text
固件 I2C 写虚拟 SSD1306
  → C 侧 s_virtual_fb
  → Worker pal_wasm_get_ssd1306_fb → oledFb
  → OLED CanvasGlyph / World 纹理读 oledFb
```

外设声明：`simulation.observe` → `watchI2C` → ObserveBuilder 置 `oled: true`。

#### 数据契约（概念）

```typescript
oledFb: Uint8Array | null; // Phase 现状
// 规范化多屏扩展定义：
displays?: Record<string, DisplayPayload>; // key = deviceComponentId

interface DisplayPayload {
  width: number;
  height: number;
  format: 'mono_vertical' | 'rgb565' | 'rgb888';
  framebuffer: Uint8Array;
}
```

> **传输层性能优化（Transferable Objects）：** 为避免多屏或高分辨率显示器下高频 `postMessage` 序列化开销，Worker 发送 `STATE_UPDATE` 时应将各 display framebuffer 对应的 `ArrayBuffer` 作为可转移对象（Transferables）传递，实现零拷贝。

#### 适合场景

| 场景 | 说明 |
|------|------|
| OLED / LCD / 电子墨水等像素屏 | 连续 2D 缓冲 |
| 点阵 / 七段若以 framebuffer 建模 | 整块 payload 更自然 |
| 3D 外壳窗贴屏纹理 | 直接上传 GPU 纹理 |

#### 不适合场景

| 场景 | 原因 |
|------|------|
| LED 单点亮灭 | 用 ① 或 ③ 的 `state` 即可 |
| 舵机/电机 | 非显示 |
| 「屏上显示了什么字符串」的业务断言 | 若需要语义，应另开 OCR/文本抽取或固件侧 text export；默认仍是像素真相 |

#### 优缺点

| 优点 | 缺点 |
|------|------|
| 与设备模型同构（虚拟屏就是一块 FB） | 与执行器语义模型异构，不能硬统一 |
| UI/3D 消费简单 | 大缓冲带宽需注意（已有帧率控制） |
| 协议级 I2C 旁路可演进 | 多屏时需升级为 batch（未来） |

#### 纪律

- **禁止**把 framebuffer 塞进 `ActuatorObservation.value: any[]` 作为长期方案。
- Display 插件**只读** Display Payload；不读 Observation 冒充像素。
- 若未来需要「屏内容语义」（如 UI 自动化断言），另开 **Display Semantic** 子通道或工具链，不污染执行器 Observation。

---

### 3.3 通道 ③ — Actuator Observation（执行器语义观测）

#### 定义

双层模型：

1. **Raw**：`ActuatorOutputBatch`（`pwm` / `gpio` / 可选 `semantic`）— 传输层，对齐硬件通道。
2. **Semantic**：`ActuatorObservation[]` — 统一物理量（角度、转速、状态、颜色阵列等）。

Worker 只负责 Raw；主线程 `mapActuatorOutputs(batch, actuatorSources, components)` + 外设 `actuatorObserve.profile` / converter（及未来 manifest bindings）产出 Observation。

#### 与 wink-micro-os 对接

```text
固件 dal_servo / dal_motor → pal_pwm_set_duty（或未来 DAL semantic export）
  → Worker pal_wasm_get_pwm_duty_percent → actuatorOutputs.pwm
  → Mapper + sg90_from_duty(ctx.props) → ActuatorObservation
  → SimActuatorPanel / 未来 ActuatorMirror 只读 Observation
```

#### 数据契约（概念）

```typescript
interface ActuatorObservation {
  deviceComponentId: string;      // = CircuitComponentInstance.id
  quantity: ActuatorQuantity;     // angular_position | angular_velocity | state | ...
  value: number | string | /* 收敛后的数组类型 */;
  unit: 'deg' | 'rpm' | 'percent' | 'bool' | ...;
  role: 'command' | 'feedback';
  simTimeUs: string;
  quality?: 'valid' | 'extrapolated' | 'fault';
}
```

Mapper **三输入契约**（不可省略）：`batch` + `actuatorSources` + `components`。

#### 适合场景

| 场景 | 说明 |
|------|------|
| 舵机角度、云台 | `angular_position` + deg |
| 电机 / 轮速 / FOC / VESC | `angular_velocity` + rpm；Raw 可为 pwm 或 `batch.semantic` |
| 统一执行器面板 | 多器件列表只消费 Observation |
| 3D ActuatorMirror / Rapier | 关节速度、驱动力来自语义量 |
| 动力学平滑 | `quality` + `simTimeUs` delta |
| 可配置执行器参数 | converter 读 `comp.props`（如 pulse range） |

#### 不适合场景

| 场景 | 原因 |
|------|------|
| 电路脚级调试 | 应保留 ① |
| OLED 像素 FB | 应保留 ② |
| 按钮输入 | 属 **④ 输入注入**，不是输出观测 |

#### 优缺点

| 优点 | 缺点 |
|------|------|
| UI/3D 零硬件知识 | 多一层类型与 mapper |
| 插件化 converter / binding | 简单 LED 略重（可接受） |
| 多驱动类型可演进 | C 模型与 JS converter 需测试防漂移 |
| 与 W3b 设计一致 | 尚未覆盖全部外设（LED 未迁） |

#### 纪律

- **SimActuatorPanel / ActuatorMirror 只读** `actuatorObservations`。
- **禁止** UI 直接依赖 `pal_wasm_get_*`、PWM channel 号、`ActuatorOutputBatch`（架构单测护栏已有）。
- 新「运动/驱动类」外设必须提供 `actuatorObserve` + `watchActuatorSource`。
- `deviceComponentId` SSOT = `CircuitComponentInstance.id`。

---

## 4. 输入注入：恰好一种（④）— 不是第四种「观测」

> **口径提醒：** ④ 与 ①②③ **方向相反**。可以说「数据面有 4 条」，**不可**说「观测有 4 种」。  
> **与 Raw 的关系：** ④ 写入的是**理想输入激励**，不是把输出 Raw（`pwm`/`gpio`/`fb`/`semantic`）写回 OS。详见 §2.2。

### 4.1 通道 ④ — Ideal Inject（理想输入注入）

#### 定义

主线程把「理想物理量或理想电平」注入 Worker，再写入 Wasm PAL，供固件 `pal_gpio_read` / 超声模型等读取。

#### 现状 API

| API | 用途 |
|-----|------|
| `SET_PIN_IDEAL` / `setPinIdeal` | 按钮等 GPIO 输入 |
| `SET_ULTRASONIC_DISTANCE` | HC-SR04 距离 |
| `SET_FAULTS` | 故障/降级参数 |

#### 未来（W3c）

统一为 `setIdealInputs({ sensors: [...] })`，旧 API 过渡期双写。

#### 仿真时间确定性（Temporal Determinism）与队列化约束

为支持确定性仿真测试与回放（Deterministic Playback），输入注入不能依赖异步的主线程 JS 事件循环延迟：
1. **注入包时间戳化**：`setIdealInputs` 的 payload 支持可选的 `timestampUs?: string`，指定该输入在仿真的哪一微秒时刻生效。
2. **Worker 事件队列**：Worker 在接收到 `SET_PIN_IDEAL` 或 `setIdealInputs` 时，不应立即修改 Wasm 状态，而是压入事件队列。
3. **步进同步（Tick Sync）**：在 Worker 的 `step()` 循环中，根据当前 `simTimeUs` 弹出符合时间戳的注入事件并写入 Wasm，确保相同注入序列在重放时产生完全一致的传感器读取时序。

#### 适合场景

按钮、开关、超声距离、温湿度理想值、拖拽火源→温度等**环境/人机输入**。

#### 纪律

- 输入通道**不**产出 `ActuatorObservation`。
- 按钮插件只做 inject，不做 `actuatorObserve`。
- 输出 LED/舵机仍分别走 ①/③。

---

## 5. 方案比选：要不要「统一成一套」？

### 5.1 备选方案

| 方案 | 描述 |
|------|------|
| **S0 维持现状、无规范** | 两套路径并存，文档不约束 | ❌ 不可接受 |
| **S1 全部并入 Observation** | 废除 pinStates/oledFb，万物皆 Observation | ❌ 过统一 |
| **S2 全部退回 pinStates** | 舵机也用脚电平 + UI 猜角度 | ❌ 无法支撑 W3b |
| **S3 分层统一（推荐）** | **输出 3 通道**（①②③）长期共存 + **输入 1 通道**（④）；消费纪律按层；执行器语义以 ③ 为 SSOT | ✅ |
| **S4 仅文档、永不迁 LED** | ③ 只服务舵机/电机；灯永远只 ① | ⚠️ 可作过渡，3D 灯会痛 |

### 5.2 推荐：S3 分层统一

**理由摘要：**

1. **输出观测恰好 3 种**，对应三种信息形态（脚电平 / 显示块 / 物理量）；另有 **1 种输入注入**；合计 **4 条数据面**。强行把输出并成一种会损失表达力或调试力。
2. W3b 已选定 Observation（③）驱动 ActuatorMirror；① 仍是电路 SSOT；④ 由 W3c 演进，不并入观测。
3. 「统一」指**纪律与演进方向**，不是删除通道，也不是把 ④ 改名叫「第四种观测」。

### 5.3 「统一」的正确含义

| 统一什么 | 不统一什么 |
|----------|------------|
| 执行器面板 / 3D 的消费契约 → ③ Observation | 传输层仍可有 pwm/gpio/fb 多种 Raw |
| 外设声明方式（observe / actuatorObserve / inject） | OLED 不必装成执行器；④ 不必装成观测 |
| `deviceComponentId` / `simTimeUs` 等横切约定 | 输入与输出的生命周期与方向 |

---

## 6. 场景决策矩阵（外设作者速查）

先分方向，再选通道：

1. **灌进固件**（用户/环境）→ 只用 **④**（可附带 ① 做脚电平调试显示）。
2. **固件结果回到 UI** → 在 **①②③** 中选主输出通道（下表）。

| 外设类型 | 方向 | 主通道 | 可否额外绑 pinStates | 备注 |
|----------|------|--------|----------------------|------|
| LED（数字） | 输出 | ① 现状；③ 可选增强（`state`） | ① 为主时可 | 进 3D/统一面板时补 ③ |
| 按钮 / 开关 | **输入** | **④** | 可显示脚电平作调试 | **不是** Observation |
| OLED / 像素屏 | 输出 | ② | 否（除非调试 I2C 脚） | 禁止塞 Observation |
| 舵机 | 输出 | ③ | 可选看 SIG 脚调试 | 面板必须 Observation |
| 直流电机 / 编码电机 | 输出 | ③ | 可选 | binding 公式 Phase 2 |
| 蜂鸣器（频率） | 输出 | ③（`sound_frequency`） | 可选 | |
| 灯带（语义色） | 输出 | ③（`pixel_colors`） | 否 | **语义色 ≠ OLED FB（②）** |
| 继电器 | 输出 | ① 或 ③（`state`） | 可 | 电路层用 ①；面板用 ③ |
| HC-SR04 | **输入** | **④** | 回波脚可进 ① 调试 | 距离理想值走 ④ |

### 6.1 决策流程图

```text
是「用户/环境 → 固件」吗？
  ├─ 是 → 通道 ④ Ideal Inject（输入；到此结束，不是观测）
  └─ 否（固件 → UI）→ 输出观测三选一：
        是「整块显示缓冲」吗？
          ├─ 是 → 通道 ② Display Payload
          └─ 否 → 需要角度/转速/频率/语义色，或要进 3D ActuatorMirror？
                    ├─ 是 → 通道 ③ Actuator Observation
                    └─ 否 → 仅脚电平（亮灭/通断）且主要在电路视窗
                              → 通道 ① Pin Mirror
```

---

## 7. 目标架构图（3 出 + 1 入 = 4 条数据面）

```text
┌─ UI / 3D / 面板 ─────────────────────────────────────────────┐
│  【输出观测 ×3】                                              │
│  电路视窗 ──读──► ① pinStates                                 │
│  OLED/屏  ──读──► ② oledFb / displayOutputs                   │
│  执行器面板 / ActuatorMirror ──只读──► ③ actuatorObservations │
│  【输入注入 ×1】                                              │
│  按钮/滑块/环境 ──写──► ④ Ideal Inject                        │
└────────────────────────────┬──────────────────────────────────┘
                             │
┌─ 主线程服务 ───────────────▼──────────────────────────────────┐
│  applyStateUpdate ← pinStates, oledFb                         │
│  mapActuatorOutputs(batch, sources, components) → Observations│
│  setPinIdeal / setUltrasonic… / (未来 setIdealInputs)         │
└────────────────────────────┬──────────────────────────────────┘
                             │ STATE_UPDATE / SET_*
┌─ Worker + wink-micro-os Wasm ─────────────────────────────────┐
│  GPIO 采集 → pinStates (+ 可镜像入 actuatorOutputs.gpio)      │
│  OLED export → oledFb                                         │
│  PWM/语义 export → actuatorOutputs                            │
│  pal_wasm_set_gpio_input / ultrasonic model ← Ideal Inject    │
└───────────────────────────────────────────────────────────────┘
```

**说明：** `actuatorOutputs.gpio` 与 `pinStates` 在 Worker 侧可能同源复制；**LED UI 今日读 pinStates（①）** 合法。未来若 LED 声明 `actuatorObserve`，Mapper 从 `batch.gpio` 映射 `state`（③），电路视窗仍可读 ①。

---

## 8. 与现有代码 / 文档的映射

| 规格通道 | 角色 | 代码锚点（当前） |
|----------|------|------------------|
| ① | 输出观测 | `simulation-runtime.pinStates`；`bindWorldProps`；`led/CanvasGlyph` |
| ② | 输出观测 | `simulation-runtime.oledFb`；`oled/definition` `watchI2C`；`wasm_dev_ssd1306.c` |
| ③ | 输出观测 | `types/actuator-observation.ts`；`actuator-observation.mapper.ts`；`servo/*`；`SimActuatorPanel.vue` |
| ④ | 输入注入 | `simulation-pin-api.setPinIdeal`；`SET_ULTRASONIC_DISTANCE`；button WorldWidget |

| 文档 | 关系 |
|------|------|
| W3b `04-phase-w3b-physics-actuators.md` | ③ 的物理/ActuatorMirror 消费者 |
| W3c `05-phase-w3c-sensors-env-bridge.md` | ④ 的统一注入演进 |
| `04-adding-a-peripheral.md` | 评审通过后应增补「选通道」一节 |
| Phase 1 舵机计划 | ③ 的首个完整落地 |

---

## 9. 非目标（本规格明确不做）

1. 不在本规格实施期内删除 `pinStates` 或 `oledFb`。
2. 不要求 OLED Demo 立刻迁到 Observation。
3. 不规定 C 侧动力学保真度（见 ADR-0003）；Observation 是行为级语义。
4. 不展开 I2C 总线引擎 / 多屏 display batch 的完整 API（可后续子规格）。
5. 不把 `ActuatorObservation.value` 的 `any[]` 收敛细节写死（Phase 2 前 TODO，见舵机计划 §10.4）。

---

## 10. 迁移与演进建议（评审通过后的可选路线）

| 阶段 | 动作 | 优先级 |
|------|------|--------|
| R0 | 本规格评审 Accepted → 开 ADR → 回写 `05-frontend-workbench` + `04-adding-a-peripheral` | P0 |
| R1 | 文档 + 架构护栏：ActuatorMirror 禁止 import pinStates 作为驱动源 | P1 |
| R2 | LED 可选：`actuatorObserve` + `gpio_to_state`，统一面板可显示灯 | P2 |
| R3 | W3c：④ 收敛到 `setIdealInputs` | 按 W3c |
| R4 | Display batch 多屏 | 按需 |
| R5 | Observation `value` 类型收紧；`simTimeUs` 单调校验 | Phase 2 |

---

## 11. 验收标准（规范级，非代码任务）

评审 Accepted 时，应能对下列命题明确回答「是」：（**2026-07-12 评审结论：全部为「是」**，详见 [评审报告](../../reviews/unisim/2026-07-12-sim-observation-layers-review.md)）

1. [x] 计数口径是否固定为：**输出观测 3**（①②③）+ **输入注入 1**（④）= **数据面 4**，且全文无「4 种观测」之类歧义说法？—— **是**。
2. [x] 每种通道的适合 / 不适合场景表是否可指导外设选型？—— **是**。
3. [x] 是否明确拒绝 S1（万物 Observation）与 S2（万物 pinStates）？—— **是**。
4. [x] OLED、舵机、LED、按钮四类器件的主通道是否无歧义（按钮明确为 ④ 输入）？—— **是**。
5. [x] 与 W3b / W3c 的衔接是否无矛盾？—— **是**。
6. [x] 「统一」被定义为分层纪律，而非删除通道或把 ④ 并入观测？—— **是**。

---

## 12. 待评审问题（请决策者勾选）

> **评审结论（2026-07-12，Accepted）：** Q1–Q12 全部采纳建议默认值「是」，无否决项。详见 [`../../reviews/unisim/2026-07-12-sim-observation-layers-review.md`](../../reviews/unisim/2026-07-12-sim-observation-layers-review.md)。

| # | 问题 | 建议默认 | 评审结论 |
|---|------|----------|----------|
| Q1 | 是否采纳 S3（输出 3 + 输入 1 分层）作为正式架构方向？ | **是** | ✅ **是（Accepted）** |
| Q2 | LED 是否列为「① 为主、③ 可选增强」，而非强制立刻迁 ③？ | **是** | ✅ **是（Accepted）** |
| Q3 | 灯带 `pixel_colors` 走 ③、OLED FB 走 ② — 是否同意「语义色 ≠ 显示 FB」？ | **是** | ✅ **是（Accepted）** |
| Q4 | 电路视窗是否**永久允许**读 `pinStates`（即使 LED 已有 Observation）？ | **是** | ✅ **是（Accepted）** |
| Q5 | Accepted 后是否需要独立 ADR（建议标题含「数据面分层：3 出 + 1 入」）？ | **是** | ✅ **是（Accepted）**——即 [`ADR-0027`](../../decisions/unisim/0027-sim-observation-data-planes.md) |
| Q6 | 是否在 `04-adding-a-peripheral.md` 增加「通道选择」强制小节（先分入/出，再选 ①②③/④）？ | **是** | ✅ **是（Accepted）** |

---

## 13. 外设可维护性：现状诊断与重构方向

> 本章回答：在 **3 出 + 1 入** 口径下，如何让「新增一种外设」长期可维护。  
> 结合现网 **LED / OLED / 超声波 / 按钮 / 舵机 / 电机 stub** 分析；**不要求本规格 Accepted 前立刻改代码**。  
> **前置阅读：** §2.1（Raw）、§2.2（Inject ≠ 写 Raw）、§3.0（通道 ↔ Raw）、§6（选型矩阵）。

### 13.1 设计原则（长期可维护的硬约束）

| # | 原则 | 含义 |
|---|------|------|
| P1 | **定义即契约** | 通道选择、observe/inject、UI 绑定数全部落在 `peripherals/<type>/`，禁止宿主 `switch(type)` |
| P2 | **宿主只做总线** | Worker / `simulation-client` / `bind*` 只认识通道协议，不认识 `led`/`oled`/`servo` 字符串 |
| P3 | **一外设一包** | `definition` + `index`（注册 converter/injector）+ 视图；加外设 = 新目录 + `peripherals/index.ts` 一行 import |
| P4 | **先选通道再写代码** | 新增前必须标明：方向（入/出）→ 主通道（①/②/③/④）→ Raw 形态（见 P5）；见 §6 |
| P5 | **复用既有 Raw，少扩传输** | 新外设优先挂 `gpio`/`pwm`/`fb`/`semantic`（§2.1）；仅当现有 C export 表达不了才加 Wasm 导出。**注意：** ①② 上 Raw 常即 UI 终点；③ 上 Raw 必经 Mapper |
| P6 | **静态架构护栏** | 引入静态依赖规则（如 ESLint / dependency-cruiser），强制禁止外设包直接导入 `simulation-runtime`，只通过 Context 消费，杜绝架构腐蚀 |

**成功标准（可验收，按通道）：**

| 新增类型 | 成功时零修改的宿主 |
|----------|-------------------|
| 同构执行器（③，如蜂鸣器/单路电机） | Worker、`simulation-client`、`bind*`、`EmbeddedWorkbench` |
| 同构显示（②） | 同上（仅外设包 + 若需新 `observeDisplay.kind` 才扩 Worker 通用分支） |
| 同构输入（④，如新滑块传感器） | `EmbeddedWorkbench` 无新 `type ===`；只走 `syncIdealInputs` |

---

### 13.2 外设对照（通道 + Raw + 现状 vs 目标）

| 外设 | 方向 | 主通道 | 主 Raw | 今日做到哪 | 今日摩擦 | 目标态「加同型只需」 |
|------|------|--------|--------|------------|----------|----------------------|
| **LED** | 出 | ①（③ 可选） | `gpio` | 全局收脚 → `pinStates`；`bind*` `case 'led'` | 无 ③；进面板/3D 要改宿主 | `ui.bind*`；可选 `gpio_to_state` |
| **OLED** | 出 | ② | `fb` | `watchI2C`→`oled:true`；Canvas **直读** `oledFb` | I2C≠显示；双份画 FB | `observeDisplay` + binder 传 FB |
| **超声波** | **入** | **④** | （非输出 Raw）理想距离 | `setUltrasonicDistance` 多处；`watchUltrasonic` Worker 未用 | 假 observe；Workbench 特判 | `inject.apply`；宿主只 `syncIdealInputs` |
| **按钮** | **入** | **④** | （非输出 Raw）理想 GPIO 输入 | `setPinIdeal`；idle 特判 | Workbench/`syncIdleGpio` 认 `type==='button'` | `inject` + `idle`；去掉宿主特判 |
| **舵机** | 出 | ③ | `pwm` → Mapper | sources+converter+Mapper+Panel | Canvas **直读** Observation | binder 传 `angle`；③ 金样板 |
| **电机 stub** | 出 | ③（目标） | `pwm`（左右 ch） | 仅 catalog | 无 observe/converter；接上还可能改 bind* | 抄舵机：双 source + converter + import |

```text
今日真实耦合（摩擦来源）— 叠加 §2.1 职责链

  [OS C] 状态 + export
       ↓
  [Worker] 采集 Raw 批 → pinStates / oledFb / actuatorOutputs   ✅ 总线（但有 hasOled 特例）
       ↓
  definition.observe ──► ObserveBuilder ──► OBSERVE_PINS       ✅ 半插件化
  actuatorObserve    ──► Mapper + converter → ③ Observation    ✅ 舵机已通
  bindCanvas/World   ──► switch(comp.type)                     ❌ 每外设改宿主
  glyph 直读 runtime ──► oledFb / actuatorObservations         ❌ 绕过 binder（且混 Raw/Semantic）
  Ideal Inject（④）  ──► WorldWidget + EmbeddedWorkbench       ❌ 每传感器改宿主（≠ 写输出 Raw）
  Worker 特例        ──► hasOled；ultrasonicConfig 忽略         ❌ 通道语义不纯
```

---

### 13.3 逐外设：通道 / Raw / 优化

#### LED（① 为主，③ 可选）— Raw=`gpio`

| 层 | 现状 | 优化 |
|----|------|------|
| Raw / ① | `pinStates[A]`（Raw 即电路 UI 终点） | 保留电路 SSOT |
| ③ 可选 | 无 | `actuatorObserve` + transport `gpio_pin` + `gpio_to_state` → 面板/3D（Raw 再经 Mapper） |
| UI | `bind*` case | `ui.*` 从 `ctx.pinStates` 取 `level` |

**不要：** 为 LED 新建 Worker 消息；不要把 ① 废掉只留 ③。

#### OLED（②）— Raw=`fb`

| 层 | 现状 | 优化 |
|----|------|------|
| Raw / ② | `oledFb`（Raw 即屏 UI 终点） | 短期全局一块；多屏再 `displayOutputs[]` |
| 声明 | `watchI2C`⇒`oled:true` | `observeDisplay: { kind: 'ssd1306_fb' }` |
| UI | Canvas 直读 runtime | binder 注入 `framebuffer`；共用 `paintFramebuffer` |

**不要：** FB 进 `ActuatorObservation`；不要把 I2C 观察等同于显示通道。

#### 超声波（④）— 输入，不是输出 Raw

| 层 | 现状 | 优化 |
|----|------|------|
| ④ | 多 call site inject | `inject.apply`；`syncIdealInputs` |
| 假 observe | `watchUltrasonic` 被忽略 | 删除或降级为调试脚观察（①） |

**不要：** 距离做成 ③ Observation；不要说「往 Raw pwm/fb 里写距离」。

#### 按钮（④）— 输入理想 GPIO

| 层 | 现状 | 优化 |
|----|------|------|
| ④ | `setPinIdeal` + idle 特判 | `inject`/`idle` 进 definition |
| ① 调试 | 可看脚电平 | 可选，非主路径 |

**不要：** `actuatorObserve` 包装按钮。

#### 舵机（③）— Raw=`pwm` → Observation — 金样板

| 层 | 现状 | 优化（小） |
|----|------|------------|
| Raw | Worker 采 `actuatorOutputs.pwm` | 保持（§2.1 环节 3） |
| Semantic | Mapper + `sg90_from_duty` | Canvas 停止直读 Observation；经 `ui.bind` 传 `angle` |
| UI | Panel 读 ③ OK | Glyph 纯 props |

**新执行器抄这一套（③），不要抄 LED（①）。**

#### 电机（③，待补齐）— Raw=`pwm`（双通道）

| 层 | 现状 | 落地 |
|----|------|------|
| catalog | `pwm_to_angular_velocity` | 保留，Phase 2 可走 binding |
| Raw→③ | 无 | 双 `watchActuatorSource` + converter（或 binding 公式） |
| Worker | — | **同读** `pal_wasm_get_pwm_duty_percent`，零新消息（除非 FOC → `semantic` Raw） |

---

### 13.4 目标插件契约（TypeScript 草图）

将今日分裂的 `simulation.observe` / `actuatorObserve` / 宿主 bind / 散落 inject **收拢到定义**。字段与通道/Raw 对齐：

```typescript
/** 外设仿真 + UI 绑定契约（目标态；评审通过后分阶段落地） */
interface PeripheralSimulationContract {
  /** ① 显式脚观察 → 贡献 gpio Raw / pinStates（可选；无则全局收脚 fallback） */
  observePins?: (comp: CircuitComponentInstance) => number[];

  /** ② 请求 fb Raw（替代 watchI2C→oled 耦合） */
  observeDisplay?: {
    kind: 'ssd1306_fb'; // 未来: display_batch
  };

  /**
   * ③：声明「从哪些 Raw 源映射」+ 语义 profile。
   * Raw 仍由 Worker 采集（pwm/gpio/semantic）；本字段不产生 Raw。
   * Mapper + converter 负责 Raw → ActuatorObservation（§2.1 环节 5）。
   */
  actuatorObserve?: {
    sources: (comp: CircuitComponentInstance) => ActuatorObserveSource[];
    profile: ActuatorObserveProfile; // convert → actuatorConverterRegistry
  };

  /**
   * ④ 理想输入（≠ 写输出 Raw）。
   * 写入 OS 的是输入激励（gpio 理想电平 / 超声距离 / 未来 setIdealInputs）。
   */
  inject?: {
    kind: 'gpio_ideal' | 'ultrasonic_distance' | 'ideal_inputs';
    apply: (comp: CircuitComponentInstance, ctx: InjectContext) => void;
    idle?: (comp: CircuitComponentInstance) => void;
  };
}

interface PeripheralUiBind {
  /** 只应消费 ctx 中与本通道相关的字段；禁止再 import simulation-runtime */
  canvasProps?: (comp: CircuitComponentInstance, ctx: SimViewContext) => Record<string, unknown>;
  worldProps?: (comp: CircuitComponentInstance, ctx: SimViewContext) => Record<string, unknown>;
}

/** 输出侧视图上下文（①②③）。④ 走 InjectContext，不要塞进本结构冒充 Observation。 */
interface SimViewContext {
  pinStates: Record<number, boolean | PinSignalState>; // ① ← gpio Raw 终点（兼容多态信号）
  displayFb: Uint8Array | null;                        // ② ← fb Raw 终点（今日 oledFb，单色单屏过渡）
  displays?: Record<string, DisplayPayload>;           // ② ← 多屏/彩色屏寻址映射（未来扩展）
  actuatorObservations: ActuatorObservation[];         // ③ ← 已映射语义（不是 Raw）
}

interface PinSignalState {
  level: boolean;
  voltage?: number;
  mode: 'input' | 'output' | 'high_z' | 'analog';
  pull: 'none' | 'up' | 'down';
}

interface DisplayPayload {
  width: number;
  height: number;
  format: 'mono_vertical' | 'rgb565' | 'rgb888';
  framebuffer: Uint8Array;
}
```

**注册纪律（`peripherals/<type>/index.ts`）：**

```typescript
registry.register(definition);
// 仅 ③：注册 Raw→Semantic converter
actuatorConverterRegistry.register('sg90_from_duty', ...);
// 仅自定义 ④ kind 时：
// idealInjectAdapters.register('my_sensor', ...);
```

**与今日字段兼容：** 落地时可先把现有 `simulation.observe` + 顶层 `actuatorObserve` **适配**进新契约，再删旧 API；M2/M3/M4 分步，避免大爆炸重构。

---

### 13.5 宿主应变成什么样

| 模块 | 今日 | 目标 |
|------|------|------|
| Worker | 采 Raw；`hasOled` 特例 | 只认 Raw 形态 / `displayKinds[]`；**禁止** per-type 字符串；inject 走既有 SET_* |
| `observePins` / ObserveBuilder | 插件 observe + 全局收脚 | 汇总 `observePins` / `observeDisplay` / `actuatorObserve.sources` |
| `mapActuatorOutputs` | 已通用 | **保持**（③ 唯一 Semantic 入口）；新执行器只加 converter |
| `bindCanvasProps` / `bindWorldProps` | `switch(type)` | `def.ui?.canvasProps?.(comp, ctx) ?? {}` |
| `EmbeddedWorkbench` | button/超声/led 特判 | `runInject` / `runInjectIdle`；无新 `type ===` |
| `SimActuatorPanel` | 读全部 Observation | 可保留；只展示有 `actuatorObserve` 的器件 |

---

### 13.6 「新增外设」目标 Checklist（维护友好版）

```text
1. 分方向：输入（④）还是输出（①②③）？
2. 选主通道 + 标明 Raw：
     ① → gpio（常为 UI 终点）
     ② → fb   （常为 UI 终点）
     ③ → pwm | gpio | semantic（必经 Mapper）
     ④ → 理想输入（不是输出 Raw）
3. 问：现有 C export / Worker 字段够不够？够 → 不改 OS/Worker；不够 → 才扩 Raw（P5）
4. cp _template → peripherals/<type>/
5. 填 pins / props / catalog / canvas|world
6. 按通道填 simulation.* 与 ui.*
7. 若 ③：写 converter 并在 index.ts register
8. peripherals/index.ts 加一行 import
9. npm test（template-contract + 通道契约：禁 glyph 直读 runtime、禁宿主 type 分支）
```

**禁止清单（回归即失败）：**

- 在 `bindWorldProps` / `bindCanvasProps` / `EmbeddedWorkbench` 加 `type === 'xxx'`
- Glyph `import` `simulation-runtime` 的 `pinStates` / `oledFb` / `actuatorObservations`
- 为新外设在 Worker `onmessage` 加专用分支（除非经评审的新 Raw 传输层）
- 把 ④ 传感器包装成 ③ Observation「方便面板展示」
- 把 ② 的 `fb` 塞进 Observation；或把 Inject 说成「写输出 Raw」

---

### 13.7 分阶段重构（建议评审后开实施计划）

| 阶段 | 内容 | 验证外设 | 风险 |
|------|------|----------|------|
| **M1 契约文档化** | 本规格 Accepted；`04-adding-a-peripheral` 增「方向→通道→Raw」；架构测禁 glyph 直读（可先 warn） | — | 低 |
| **M2 UI bind 插件化** | `ui.canvasProps/worldProps`；删 bind* switch；OLED/舵机经 binder | LED、OLED、舵机 | 中 |
| **M3 Inject 插件化** | `simulation.inject`；`syncIdealInputs`；去 Workbench 超声/按钮特判 | 按钮、超声波 | 中 |
| **M4 Observe 语义纯化** | `observeDisplay` 取代 I2C→oled；清理无效 `watchUltrasonic` | OLED、超声 | 低 |
| **M5 电机接 ③** | stub 补 sources+converter（或 binding）；**零改 Worker**（复用 pwm Raw） | 电机 | 中（依赖 App/模板） |
| **M6 LED 可选 ③** | `gpio_to_state`（gpio Raw → Observation）；电路仍用 ① | LED | 低 |

**推荐落地顺序：** M1 → M2 → M3 → M5（电机验证「加 ③ 不改宿主」）→ M4 / M6。

---

### 13.8 速查：做事 → 通道 → Raw → 改哪里

| 你要做的事 | 通道 | Raw / 输入 | 改哪里 | 不改哪里 |
|------------|------|------------|--------|----------|
| 新灯/继电器亮灭 | ①（±③） | `gpio` | 外设包 + 可选 converter | Worker |
| 新像素屏 | ② | `fb` | `observeDisplay` + paint | Observation / Mapper |
| 新舵机/电机/蜂鸣器 | ③ | `pwm`（或日后 `semantic`） | sources + converter + ui.bind | Worker（同 PWM export 时） |
| 新按钮/距离/温度滑块 | ④ | 理想输入（非输出 Raw） | `inject.apply` | Mapper / Observation |

---

### 13.9 本节待评审问题

> **评审结论（2026-07-12，Accepted）：** Q7–Q12 全部采纳建议默认值「是」，评审并逐条给出意见（见 [评审报告](../../reviews/unisim/2026-07-12-sim-observation-layers-review.md) §3）。

| # | 问题 | 建议默认 | 评审意见 | 评审结论 |
|---|------|----------|----------|----------|
| Q7 | 是否认可「按通道的成功标准」（§13.1）：③/②/④ 新增时宿主零 `type` 特判？ | **是** | 强烈同意 | ✅ **是（Accepted）** |
| Q8 | UI bind 是否迁入 `definition.ui.*`（M2）？ | **是** | 同意 | ✅ **是（Accepted）** |
| Q9 | Ideal Inject 是否迁入 `definition.simulation.inject`（M3）？ | **是** | 同意（需注意时序同步，见 §4.1 队列化约束） | ✅ **是（Accepted）** |
| Q10 | 电机作为 M5 验证外设（先于 LED 迁 ③）？ | **是** | 强烈同意 | ✅ **是（Accepted）** |
| Q11 | `watchI2C→oled` 是否在 M4 改为 `observeDisplay`？ | **是** | 同意 | ✅ **是（Accepted）** |
| Q12 | 新增 Checklist 是否强制「方向 → 通道 → Raw」三步（§13.6）？ | **是** | 强烈同意 | ✅ **是（Accepted）** |

---

## 14. 文档变更记录

- 2026-07-12：初稿 Draft（推荐 S3 分层统一）。
- 2026-07-12：口径修订 — 全文统一为 **输出观测 3 通道（①②③）+ 输入注入 1 通道（④）= 数据面 4 条**；禁止「4 种观测」表述；标题改为「仿真数据面分层」。
- 2026-07-12：外设可维护性章 — LED/OLED/超声/舵机/电机现状诊断、目标契约、M1–M6、新增 Checklist。
- 2026-07-12：§2.1 / §2.2 / §3.0 — Raw 定义、与 ①②③ 关系、代码职责链；Ideal Inject ≠ 写输出 Raw。
- 2026-07-12：外设可维护性章修订 — 对齐 Raw 口径；表增 Raw 列与按钮；成功标准按通道；Checklist 强制「方向→通道→Raw」；章节号改为 §13，变更记录 §14；契约注释区分 Raw/Semantic/Inject。
- 2026-07-12：评审意见回写 — 补充多态引脚电平、多屏幕支持、Transferable 传输优化、仿真时间确定性队列化约束与静态依赖护栏（P6）。
- 2026-07-12：关联实施计划套件 — `implementation-plans/2026-07-12-sim-observation-layers/`（roadmap + M0–M6）。
- 2026-07-12：**评审 Accepted**（综合评分 9.2/10，见 [评审报告](../../reviews/unisim/2026-07-12-sim-observation-layers-review.md)）— 状态改为 Accepted（已采纳）；§11 验收标准全部勾选为是；§12 Q1–Q6、§13.9 Q7–Q12 评审结论全部落实为「是」，无否决项；关联 ADR 更新为 `ADR-0027`。

---

*评审结论请批注于本文档头部「状态」字段，或另开 `docs/reviews/YYYY-MM-DD-sim-observation-layers-review.md`。*


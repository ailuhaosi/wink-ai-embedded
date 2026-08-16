# Accuracy Mode、观测平面与生命周期

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | Accuracy Mode 类型与默认值 **Partial**（TS 有；CI 证据链待补强）；观测组件代码 **Partial**；冷/热启动与 reset 语义 **Partial**（机制有，专篇契约至此） |
| 支撑轴 | **F（secondary）** — 观测/证据/复位横切；**B（secondary）** — `timing` Mode 与时间基交叉宣称 |
| 关联代码 | `@wink-ai/unisim` (Accuracy & Observability Suite: PrecisionLevel, PinTracer, VcdExporter, SessionRecorder, DebugController, BusAnalyzer, SimWorker)、`wink-micro-os/targets/wasm/`（`pal_wasm_reset_physical`） |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | 0003、0019、0042 |
| 迁自 | `04-wasm-simulation-2.0/15-accuracy-observation-lifecycle.md` |

> 本文件是下列三块的 **全文 SSOT**：(1) Accuracy Mode；(2) 观测平面与证据效力；(3) 生命周期与复位。使 A～F 在**文档层闭合**证据与复位横切。轴定义仍只在 [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md)。通道选型门禁摘要见 [`08-channel-routing.md`](./08-channel-routing.md)（**不得**再膨胀成第二份 Accuracy 全文）。

---

## 1. Accuracy Mode（保真主张分级）— SSOT

### 1.1 定义（与执行模式正交）

| 名称 | 值 | 回答的问题 |
|---|---|---|
| **Accuracy Mode**（精度模式） | `behavioral` \| `timing` \| `cycle` | 本次运行的结果**允许主张哪一级保真** |
| **Execution Mode**（执行模式） | `INTERACTIVE` \| `HEADLESS`（ADR-0042） | idle 时是否 Asyncify、是否允许动态注入 |

二者独立组合。例：`HEADLESS` + `timing` 用于 CI 脉宽回归；`INTERACTIVE` + `behavioral` 用于画布演示。

- Accuracy Mode **全文**仅在本文件；产品选型摘要 → [`08-channel-routing.md`](./08-channel-routing.md) §1.3。
- Execution Mode 行为与启动契约 → [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md)。
- **禁止**在本篇重定义 A～F；**禁止**复制生产口径长文（→ [`../01-overview/03-production-contract.md`](../01-overview/03-production-contract.md)）。

TS SSOT：`@wink-ai/unisim` 类型定义（`AccuracyMode` / `PrecisionLevel`；`DEFAULT_PRECISION.level = 'timing'`）。

### 1.2 各级允许与禁止

| 模式 | 允许作为证据 | **禁止**作为证据 | 落地 |
|---|---|---|---|
| **behavioral** | L1 状态机、L2 payload / StateChannel、duty 语义观测 | 边沿 IRQ 序、脉宽捕获、去抖时序、临界区插入窗 | Landed（插件可跳过沿级更新） |
| **timing** | L2 沿因果 + 虚拟时钟脉宽/超时近似（C2） | cycle/电气级、抢占嵌套 | Partial（主路径有；门禁未全进 CI） |
| **cycle** | 规划：I2C SCL/SDA 边沿发射等 | — | Planned（Phase 4；SPI/UART cycle 更晚） |

**产品门禁（与 [`08-channel-routing.md`](./08-channel-routing.md) §1.3 摘要一致）**：

- 宣称「脉冲器件（超声波等）高一致」→ **必须**在 `timing`（或更高）下跑，并走沿注入路径。
- `behavioral` 绿灯 **不得**写入发布说明作为时序/中断一致性证据。
- Trace / VCD 导出物必须标注当时 Accuracy Mode；缺失标注则只能当调试参考，不能当 oracle。

### 1.3 谁设置、如何传递（契约）

| 步骤 | 约定 |
|---|---|
| 默认 | 引擎默认 `timing`（与 `DEFAULT_PRECISION` 一致）；演示 UI 可显式降为 `behavioral` |
| 进入 Worker | `INIT` / 配置消息携带 `accuracyMode`（字段名以实现为准）；SimWorker 写入 PluginContext / Bus `setAccuracyMode` |
| 运行中变更 | 允许；必须清空或分段标注观测缓冲，避免混模式 Trace |
| CI | Tier 1 脉宽/去抖类用例固定 `timing`；仅逻辑用例允许 `behavioral`；**另**：yield-heavy 子集须 INTERACTIVE（见 [`01` §3.5](./01-sandbox-and-execution.md)，落地 **Planned**） |

落地缺口（诚实）：前端/CI 是否**强制**校验「用例标签 ⊂ 运行 Mode」仍为 Partial——补齐前靠评审与 [`../04-assurance/02-consistency-checklist.md`](../04-assurance/02-consistency-checklist.md) 人工对照。

**与 ISR 延迟的交叉**：默认调度 tick ≈ 10ms 时，高波特异步 UART RX 等**不得**在 `timing` 下主张中断一致（见 [`04` §8](./04-interrupt-model.md)）。

---

## 2. 观测平面（Observability）

### 2.1 组件与职责

| 组件 | 逻辑功能描述（`@wink-ai/unisim`） | 用途 | 落地 |
|---|---|---|---|
| PinTracer | 引脚追踪器 | 引脚变化时序记录 | Partial |
| VcdExporter | 波形导出器 | VCD 格式输出 | Partial |
| SessionRecorder | 会话录制器 | 会话录制/回放（含 PRNG 状态） | Partial |
| DebugController | 调试控制器 | 断点/步进控制面 | Partial |
| BusAnalyzer | 总线分析器 | I2C/SPI/UART 事务抓包 | Partial |
| Fault 审计环 | C `pal_wasm_physical` + 字段 getter | 退化事件因果链 | Landed |
| `displays[]` / pluginChannels | Worker → UI | OLED 帧、语义通道观测 | Landed～Partial |

### 2.2 证据效力规则

| 观测物 | 在 `behavioral` 下 | 在 `timing` 下 |
|---|---|---|
| StateChannel / duty / framebuffer | 可用于 L1/L2 逻辑验收 | 同左 |
| 引脚沿时间戳 / VCD 边沿距 | **不可**作脉宽/IRQ oracle | 可在 Tolerance Band 内作 C2 证据 |
| 总线 payload 内容 | 可（事务级） | 可；位时序仍非目标 |
| Fault log / 8002 WCET | 可（故障与墙钟兜底） | 同左；注意 HEADLESS 旁路 WCET |

**红线**：观测平面不替代 [`../04-assurance/02-consistency-checklist.md`](../04-assurance/02-consistency-checklist.md) 场景状态；清单中 🚫 场景即使用 VCD「看起来对」也不得升格为可发布一致。

### 2.3 与 Trace 契约

- DAL/PAL 不直接打业务 Trace；`pal.transfer` 类摘要由 Worker 在 `js_pal_*` 返回时记录（见 [`08-channel-routing.md`](./08-channel-routing.md)）。
- Asyncify sleeping 期间禁止读陈旧 `HEAPU8` 当观测快照（[`10-wasm-js-bridge-abi.md`](./10-wasm-js-bridge-abi.md) ABI #6）。

---

## 3. 生命周期与复位

### 3.1 实例边界

| 层级 | 含义 |
|---|---|
| Worker 进程 | 可热复用；**不**等于 MCU 冷启动 |
| Wasm 实例 | `instantiate` → `callMain` → 调度循环；`stop` 销毁 |
| 物理/故障状态 | `pal_wasm_reset_physical()` 清 faults/PRNG/per-pin ctx/故障域/锁存 |
| 器件模型 | `pal_wasm_sim_reset_all_devices()` 复位虚拟器件槽 |
| 应用逻辑 | App 静态/BSS；热复用 Worker 时若未重建 Wasm，可能残留全局状态（C13） |

### 3.2 推荐复位序（仿真侧）

```text
1. 停调度 / 弃用未完成 Promise（避免 Asyncify 悬挂）
2. pal_wasm_reset_physical()          # 含清 fault latch
3. pal_wasm_sim_reset_all_devices()
4. VirtualClock.reset() 与 C 时钟同步（reset_physical 路径约定）
5. 可选：重新 INIT 消息、重新 registerFromDeviceTree
6. 需要真·冷启动语义 → 销毁 Wasm 实例并重新 instantiate（推荐发版回归）
```

Fault / `reset_physical` 细节见 [`05-memory-and-faults.md`](./05-memory-and-faults.md)。

### 3.3 冷启动 vs 热复用

| 目标 | 做法 | 落地 |
|---|---|---|
| CI「上电默认」 | 每用例新 Wasm 实例，或文档化的全量 reset 序 + 断言无残留 | Partial（用例实践不一） |
| UI 快速再跑 | 允许热 reset；不得宣称覆盖 C13 冷启动 | Landed 用法 |
| NVS/Flash 行为 | 见 C23；wasm 存储多为 no-op/内存 | 按场景 |

**Fail-Loud 方向（Planned）**：热复用路径若跳过 `reset_physical` 即 `start`，应告警或拒绝——当前未强制。

### 3.4 多板 / 多 Wasm（灰区收口）

- **MVP 契约**：一个 SimWorker = 一个 Wasm 实例 = 一块逻辑板。
- `sim-project.json` 多 `boards`：画布/拓扑可多板；**第二块板的独立固件实例**为 Planned（非当前引擎承诺）。
- 板间 UART/导线：同实例内可用总线/引脚模型近似；跨 Wasm 时钟域对齐未定义。

---

## 4. 与 A～F / assurance 的交叉

| 主张 | 最少需要 |
|---|---|
| 画布 LED 逻辑对 | 轴 A + behavioral 即可 |
| 超声波脉宽一致 | A + B + **timing** + 沿路径（非 Deprecated 捷径） |
| FOC 算法可复现 | B + C 软步进 + plant；硬实时 → HIL（定时器语义见 [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)） |
| 「复位后无脏状态」 | §3 全量 reset 或新实例；查 C13 |

场景契约与可测状态 → [`../04-assurance/01-consistency-spec.md`](../04-assurance/01-consistency-spec.md)、[`../04-assurance/02-consistency-checklist.md`](../04-assurance/02-consistency-checklist.md)（Wave 4 迁入前可能为 stub）。

---

## 5. 相关文档

- [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md) — Execution Mode  
- [`02-virtual-clock.md`](./02-virtual-clock.md) / [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md) — 时间与定时器  
- [`05-memory-and-faults.md`](./05-memory-and-faults.md) — Fault / reset_physical  
- [`08-channel-routing.md`](./08-channel-routing.md) — 通道与 Accuracy 门禁摘要  
- [`10-wasm-js-bridge-abi.md`](./10-wasm-js-bridge-abi.md) — ABI #6 / HEAPU8  
- [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) — A～F 定义  
- [`../04-assurance/02-consistency-checklist.md`](../04-assurance/02-consistency-checklist.md) — 场景可测性

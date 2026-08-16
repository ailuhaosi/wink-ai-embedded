# Ⅱa 引擎机制（mechanisms）

| 项 | 内容 |
|---|---|
| 层 | Ⅱa 实现载体 SSOT |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| 职责 | 按子系统写清「怎么做」；文首标注落地成熟度（词表见根 [00-README §3.2](../00-README.md)） |
| 上次核对 | 2026-08-02（2A–2D） |

## 排序原则（自底向上）

新机制按下列层级插入，**禁止**无原则 append-only：

```text
1 执行环境 / 沙箱     → 01-sandbox-and-execution     ✅ Wave 2A
2 时间基               → 02-virtual-clock               ✅ Wave 2A
3 并发与调度           → 03-scheduler-and-concurrency   ✅ Wave 2A
4 中断                 → 04-interrupt-model             ✅ Wave 2A
5 故障与资源           → 05-memory-and-faults           ✅ Wave 2B
6 物理退化注入         → 06-physical-degradation        ✅ Wave 2B
7 外设配置面           → 07-peripheral-registry         ✅ Wave 2C
8 外设数据面（通道）   → 08-channel-routing             ✅ Wave 2C
9 定时器硬件语义       → 09-timer-and-pwm-semantics     ✅ Wave 2C（与 08 同批原子拆分）
10 宿主 ABI            → 10-wasm-js-bridge-abi          ✅ Wave 2D
11 观测 / 生命周期     → 11-accuracy-observation-lifecycle ✅ Wave 2D
```

## Wave 2 分期（为何不一次写完）

| 子波 | 文件 | ~源行数 | 原因 |
|---|---|---:|---|
| **2A** | 01–04 | ~395 | 执行脊柱；闭合 STRICT ↔ methodology；无 08/09 拆分风险 |
| **2B** | 05–06 | ~223 | Fault / 物理退化，相对独立 |
| **2C** | 07–09 | ~320 | **最高风险**：通道 vs 定时器语义原子拆分 |
| **2D** | 10–11 | ~245 | ABI + Accuracy SSOT，依赖前几批符号面 |

一次性迁入约 1182 行会掩盖 08/09 双写与路径勘误；故按上表分期。

## 本目录文件

| 文件 | 主要支撑轴 | Wave | 迁自 2.0 |
|---|---|---|---|
| [01-sandbox-and-execution.md](./01-sandbox-and-execution.md) | 横切；STRICT「怎么做」 | **2A ✅** | `02` |
| [02-virtual-clock.md](./02-virtual-clock.md) | B primary | **2A ✅** | `03` |
| [03-scheduler-and-concurrency.md](./03-scheduler-and-concurrency.md) | E primary | **2A ✅** | `04` |
| [04-interrupt-model.md](./04-interrupt-model.md) | D primary | **2A ✅** | `05` |
| [05-memory-and-faults.md](./05-memory-and-faults.md) | F primary | **2B ✅** | `06` |
| [06-physical-degradation.md](./06-physical-degradation.md) | A/F secondary | **2B ✅** | `07` |
| [07-peripheral-registry.md](./07-peripheral-registry.md) | A secondary | **2C ✅** | `08` |
| [08-channel-routing.md](./08-channel-routing.md) | A primary | **2C ✅** | `09`（剥定时器） |
| [09-timer-and-pwm-semantics.md](./09-timer-and-pwm-semantics.md) | **C primary** | **2C ✅** | `09` §1.4/§5.3 |
| [10-wasm-js-bridge-abi.md](./10-wasm-js-bridge-abi.md) | 横切 ABI | **2D ✅** | `10` |
| [11-accuracy-observation-lifecycle.md](./11-accuracy-observation-lifecycle.md) | F secondary | **2D ✅** | `15` |
| [12-bidirectional-high-fidelity-closed-loop.md](./12-bidirectional-high-fidelity-closed-loop.md) | A/B/E primary | **2D ✅** | 新增 |

## SSOT

- **实现正文只在本目录**。`03-axes/*` 与 `01-overview/*` 不得粘贴算法/状态机/ABI 表。
- **通道 vs 定时器**：`08` = 数据从哪来；`09` = 定时器/PWM 硬件怎么 behave（Wave 2C 原子拆分）。
- 文首必填：**落地 / 关联代码 / 上次核对 / 管辖 ADR**（见根 [00 §4](../00-README.md)）。
- UniSim 路径统一使用 `@wink-ai/unisim` 模块级描述，按 SDK 导出组件与 ABI 契约规范，避免跨依赖包硬编码内部源码路径。
- **审阅闭环（文档补丁 + ADR 提案）**：[2026-08-02 mechanisms review closure](../../../implementation-plans/unisim/2026-08-02-unisim3-mechanisms-review-closure-plan.md)（同刻总序 / UART RX / 浮点等）。


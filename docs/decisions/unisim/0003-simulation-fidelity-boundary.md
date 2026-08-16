# ADR-0003：仿真可信度边界声明

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-06-22（Proposed）／ 2026-06-28（Accepted） |
| 触发 | 架构评审 P0 项（见 [2026-06-22 评审报告](../../reviews/core/2026-06-22-architecture-review.md) §三） |
| 影响范围 | README / `01-system-overview` / `04-wasm-simulation` / 对外产品承诺 |
| 决策者 | 产品 + 架构师（措辞收敛已落地） |

---

## 背景（Context）

平台对外宣称"虚实一致 / 完美同步"，但多个技术现实使这个承诺目前**偏乐观**：

| 失真来源 | 现状 | 必然失真的内容 |
|---|---|---|
| **无虚拟时钟** | 全部依赖墙钟 `setTimeout`，受浏览器 throttle / 后台 tab 1Hz 限制 | PID 周期、去抖、超时的绝对时序漂移 |
| **中断是协作式** | `trigger_wasm_interrupt` 在 Asyncify 挂起点同步插入，非抢占、无优先级嵌套 | 中断延迟不可预测，与"微秒响应"宣传矛盾 |
| **DAL Bypass 切 `#ifdef`** | 仿真直通 JS，跑的不是同源 DAL 驱动实现 | 寄存器初始化 / CRC 校验 / 错误恢复路径未经仿真验证 |
| **FreeRTOS 多任务仿真缺位** | 单 Wasm 栈 + Asyncify 如何模拟多任务抢占/队列/信号量，文档未解 | 从"blink demo"到"真业务"的核心鸿沟 |
| **电气特性不仿真** | 暂缓 ngspice；ADC 量化/PWM 周期/电阻特性均不建模 | 模拟电路特性、ADC 量化误差、参考电压漂移 |

`01-system-overview.md §5` 已有"仿真精度边界"表格，方向正确，但：
1. 仅在该节内部声明，未在 README/顶层愿景处前置，用户/评审者可能在看到边界前已形成"高保真=时序保真"的误解。
2. 措辞"行为级高保真"仍可能被解读为时序级。
3. 未明确"行为级仿真能验证什么、不能验证什么"的可操作清单。

---

## 决策（Decision）

### 决策 1：在顶层前置声明可信度边界（不改代码，先管理预期）

在 `README.md`（设计文档库入口）与 `01-system-overview.md §1` 愿景段，显式加入**仿真可信度边界声明**，采用以下推荐措辞（可直接使用）：

> **仿真可信度边界**
>
> Wink-AI 提供**行为级（causal）高保真仿真**：保证业务逻辑的**因果顺序与逻辑正确性**（状态机迁移、传感器语义值、执行器命令、异常处理路径），**不保证 cycle/tick 级时序保真**。
>
> ✅ 仿真**可**验证：业务状态机正确性、传感器语义值、执行器命令、I2C/UART payload 级协议交互、故障/超时/断线的异常处理路径。
>
> ❌ 仿真**不可**验证：实时时序（PID 周期精度、微秒级响应）、中断抢占与优先级嵌套、驱动协议的寄存器/CRC 正确性（DAL Bypass 路径）、模拟电路特性（ADC 量化、阻抗、电源完整性）。
>
> 时序与电气级验证仍需真机进行。

### 决策 2：收窄 `#ifdef SIMULATION` 到最底层（架构调整）

当前 DAL Bypass 把**整个驱动实现**替换为 JS 注入值。应改为**只替换"物理量来源"**，保留协议帧解析 / CRC 校验 / 错误恢复逻辑，让仿真尽量跑同源 DAL 代码。

```
现状（Bypass 整个驱动）:
  dal_ultrasonic_read()  ──#ifdef SIMULATION──►  js_sim_get_distance()  // 整个驱动被替换

建议（只换物理量来源）:
  dal_ultrasonic_read()
    ├─ trigger 时序        ──#ifdef SIMULATION──►  js_sim_trigger()      // 只换底层
    ├─ echo 脉宽测量       ──#ifdef SIMULATION──►  js_sim_measure_echo() // 只换底层
    └─ 距离换算/CRC/超时   ──►  同源代码（两端一致）                      // 保留
```

- **优点**：协议解析/CRC/错误恢复路径在仿真侧也被验证，提升虚实一致性。
- **代价**：仿真性能略降（更多 C 代码执行），但仍在可接受范围。
- **联动**：HC-SR04 等器件的 Registry 模型需明确"哪些层走 bypass、哪些层同源"。

### 决策 3：规划虚拟时钟 + OSAL 多任务仿真作为下阶段核心补强

将以下两项纳入 Phase 1+ 路线（MVP 后），作为"虚实一致从承诺走向可信"的关键补强：

1. **虚拟时钟（virtual clock）**：`js_pal_delay_ms` 推进仿真逻辑时间而非挂墙钟；`pal_get_tick/pal_get_us` 对齐虚拟时钟。这是从"行为级"迈向"时序级"的分水岭。
2. **OSAL 多任务仿真**：解决 FreeRTOS 多任务在 Wasm 单栈下的表达（协程化多任务 / 受限调度模型），打通"blink demo"到"真业务"的鸿沟。

---

## 后果（Consequences）

- **产品承诺措辞收敛**：从"虚实一致/完美同步"降为"行为级高保真，时序电气级需真机"。短期可能影响市场话术，但避免过度承诺导致的信任风险。
- **文档更新**：README + 01-overview 加边界声明；04-wasm-simulation 标注已知限制。
- **架构调整**：决策 2 的 `#ifdef` 收窄需重构现有 DAL bypass 实现（工作量中等）。
- **路线调整**：决策 3 进入下阶段路线，可能影响 Phase 排期。
- **联动**：[ADR-0002](./0002-dual-target-compilation.md) 的 Spike 结论会影响本 ADR 决策 3 的可行性。

## 遵循与后续（Compliance）

- ✅ 决策 1（边界声明前置）：已落地——`README.md` 入口、`01-system-overall/01-system-overview.md §5 仿真精度边界`（级别表 + "避免承诺 100% 替代真实硬件"推荐表述）、`02-mvp-roadmap.md`（"避免笼统宣称 100% 真实硬件仿真"）、`03-product-user-journey.md` 均已前置；措辞统一收敛为"行为级高保真、非电气级"。
- ✅ 决策 1 回写：`04-wasm-simulation/README.md` 顶层已补"已知仿真限制"小节（决策 1 的 ❌ 清单）。
- ✅ 决策 2（`#ifdef SIMULATION` 收窄到最底层）：已落地——`dal/src/dal_ultrasonic.c` 只替换物理量来源（`js_sim_trigger_ultrasonic` + `js_sim_measure_echo_pulse_us`），距离换算 / 超时 / 错误恢复保留同源代码，与决策 2 图示一致。
- ✅ **仿真快环执行模型（R-009，2026-07-28 回写）**：host/wasm 无真 10kHz 硬中断；电机等快环 plant 步进须**虚拟时间驱动、确定性步进**（caller 每虚拟 ms 步进 $N$ 次控制，禁墙钟/rand）。PWM–ADC 硬件同步在仿真端降级为软步进近似。plant 方程归属 `targets/common/wink_sim_physical.*`，DAL `#ifdef SIMULATION` 仅旁路最低物理量（见 [01-dal §8.3](../../design/02-wink-micro-os/01-dal-device-abstraction.md)）。ISR/DI 完整边界见 [ADR-0047](../core/0047-foc-isr-layering-and-pal-hwtimer.md)。
- 📋 决策 3（虚拟时钟 + OSAL 多任务仿真）：
  - ✅ **虚拟时钟（2026-06-29 落地）**：wasm 端通过 ADR-0009 Wave 2 完整实现。
    `targets/wasm/pal_osal_wasm.c` 持有唯一时钟源 `s_virtual_us`（uint64_t 单调递增）；
    `pal_wasm_advance_virtual_clock(us)` 为唯一写入入口（JS Worker 调用；HEADLESS 模式下 C 侧内部主循环跳跃为经过内部单一 Gate `wink_vclock_advance_internal` 的合法第二调用者，见 [ADR-0042](0042-sim-execution-modes.md)）；
    `pal_get_us()` / `pal_get_ms()` 纯内存读出。**SSOT 红线**：`pal_delay_ms/us`
    不主动步进时钟，避免双重步进。JS 侧镜像见
    [`../../../../wink-ai/packages/unisim/src/unisim/core/VirtualClock.ts`](file:///d:/workspaces/ai-coding/wink-ai/wink-ai/packages/unisim/src/unisim/core/VirtualClock.ts)
    （bigint 严格契约，`-s WASM_BIGINT=1`）。
    详细回写见 [`04-wasm-simulation/06-physical-degradation-engine.md`](../../design/04-wasm-simulation/archive/06-physical-degradation-engine.md) §2。
  - 📋 **OSAL 多任务仿真**：转入
    [`04-wasm-simulation/05-simulation-consistency-and-fidelity-spec.md`](../../design/04-wasm-simulation/archive/05-simulation-consistency-and-fidelity-spec.md)。
  - 物理特性与故障注入由 [ADR-0009](./0009-physical-behavior-simulation-fault-injection.md)
    Wave 2 承接并已 Accepted。决策 3 性质为"规划纳入路线"，不阻塞本 ADR 的 Accepted。

---

*本 ADR 状态变更请在此记录：*
- 2026-06-22：Proposed（评审触发）
- 2026-06-28：Accepted。三项决策落地情况（详见 §遵循与后续）：决策 1（边界声明前置）✅、决策 2（DAL bypass 收窄到物理量来源层）✅ 均已落地并回写；决策 3（虚拟时钟 + OSAL 多任务仿真）作为路线项转入 `04-wasm-simulation/05-...roadmap.md`，物理特性部分由 ADR-0009 承接，不阻塞 Accepted。
- 2026-06-29：决策 3 的「虚拟时钟」部分由 ADR-0009 Wave 2 实施完成（wasm 端 SSOT 架构落地，bigint 跨语言契约）。OSAL 多任务仿真仍为路线项。详见 §遵循与后续。
- 2026-07-19：针对 Arduino 兼容层运行于仿真端时可能产生的时序和物理保真泄露风险，确立了 [ADR-0040](./0040-arduino-semantic-sim-json-gate.md) JSON 语义仿真门禁政策，仅在 `wink-app.json` 中配置的外设允许进行 DAL 语义 Bypass 仿真，否则 Fail-Loud。
- 2026-08-02：决策 1 口径回写补强——`04-wasm-simulation/README.md` 引入仿真轴 A～F，并明确 **A～F 完备 = 生产级行为预检，≠ 虚实恒等 / 免真机放行**；原理 SSOT 见 [`05 §0.4`](../../design/04-wasm-simulation/archive/05-simulation-consistency-and-fidelity-spec.md)。旁路落点相对本 ADR 决策 2 原文进一步下沉为 PAL Wasm + Plugin（DAL 目标零仿真宏），见 [`03-multi-channel-sim-routing`](../../design/04-wasm-simulation/archive/03-multi-channel-sim-routing.md)。
- 2026-08-02：浮点 / Golden Trace 容差的**执行细节**收口至 [ADR-0055](./0055-sim-fp-determinism-and-golden-policy.md)（Accepted）；本 ADR 仍管「行为级边界」总口径，不双写 ULP/flag 表。


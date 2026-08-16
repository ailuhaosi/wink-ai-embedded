# ADR-0042：仿真执行模式（INTERACTIVE / HEADLESS）与虚拟时钟推进重构

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-20 |
| 触发 | [仿真并发调度与时序一致性重构方案](../../../brain/03dfb311-63b7-4370-93cf-7bb03d574cee/implementation_plan.md) |
| 影响范围 | targets (wasm/host) / OSAL / 仿真时间管理 / 单元测试 / `@wink-ai/unisim` |
| 决策者 | 产品 + 核心架构师团队 |
| 关联既有 ADR | [ADR-0003 仿真可信度边界](0003-simulation-fidelity-boundary.md), [ADR-0009 物理行为仿真与故障注入](0009-physical-behavior-simulation-fault-injection.md), [ADR-0013 仿真侧协作式确定性调度模型](0013-sim-cooperative-scheduler.md) |

---

## 背景（Context）

在现有的 WASM 仿真执行模式中，当所有任务都处于 sleep 或 block 状态且没有 JS 端待处理事件时，WASM 必须调用 `js_pal_os_sleep_ms` 挂起自身，以交回控制权给 JS 线程。这导致：
1. **Asyncify 性能开销巨大**：即便仅是空转或者简单的 sleep，WASM 也要进入 Asyncify 的 unwind/rewind 流程，这导致在 CI / Node 等无头场景运行 sleep-heavy 测试时的性能非常差（如 10s 仿真时间需要消耗 5s-30s 的物理时间）。
2. **时钟推进因果倒置风险**：原本的虚拟时钟推进完全依赖 JS 侧调用 `pal_wasm_advance_virtual_clock()` 推进，但如果在无头测试（HEADLESS）中，整个 WASM 进程只在同步的主线程运行，频繁的 C <-> JS 桥接极大拖慢了单测速度。

---

## 决策（Decision）

为了解决性能开销并保持行为的一致性，我们做出以下决策：

### 1. 引入双重仿真执行模式（Simulation Execution Modes）
引入 `wink_sim_mode_t` 运行时枚举：
* **INTERACTIVE（交互模式，默认）**：适用于浏览器 UI 及 3D 渲染，保持原样——idle 时仍通过 Asyncify 让出，由 JS 推进时钟并唤醒 WASM，支持动态外部事件注入。
* **HEADLESS（无头模式）**：适用于 Node.js 单测与 CI 运行。当 WASM 发现所有任务都在等待且当前无 READY 任务时，**直接在 C 侧主调度循环内跳跃虚拟时钟**并 `continue` 循环，从而完全绕过 `js_pal_os_sleep_ms` 及 Asyncify 挂起流程，大幅提高测试吞吐量。

### 2. 强化虚拟时钟 SSOT 写入通道（Single Gate Constraint - R-VC-1）
虽然 HEADLESS 模式允许 C 侧在调度器 idle 时直接更新时钟，但为了坚守 [ADR-0003](0003-simulation-fidelity-boundary.md) 中关于“虚拟时钟 SSOT 单一写入入口”的红线，我们：
* 在 C 侧底层抽取静态私有函数 `wink_vclock_advance_internal()` 作为唯一的时钟值写入入口；
* 对外的 `pal_wasm_advance_virtual_clock()` 与 HEADLESS 内部的跳跃都必须调用此内部单一 Gate，严格禁止其他代码直接对 `s_virtual_us` 进行赋值操作。

### 3. WCET（最坏执行时间）阈值 Mode-aware
* 在 HEADLESS 模式下，虚拟时钟是在 tick 之间瞬间跃迁的，物理墙钟的耗时与虚拟时间不具备物理比照意义。
* 因此，在检测到处于 HEADLESS 模式时，自动旁路（bypass）WCET 强占限制（8002 fault），避免在慢速 CI 容器中因运行蒙特卡洛等密集计算单测被误杀。

---

## 后果（Consequences）

* **CI 性能巨大飞跃**：单测运行效率提升 100~1000 倍，测试进程的 Asyncify unwind/rewind 状态次数降至零。
* **宿主事件阻塞约束**：在 HEADLESS 模式下，WASM 调度循环不释放控制权，因此 JS 主线程在此期间完全被阻塞，JS 无法中途动态向 WASM 注入外部输入。测试用例必须采用“预加载事件队列”、“C侧自决物理引擎”或“时间片分片运行”机制来协同。
* **双向对齐维护成本**：TS/JS 桥接模块 `@wink-ai/unisim` 的 ABI 中增加了对 `pal_wasm_set_sim_mode` / `pal_wasm_get_sim_mode` 两个导出函数的支持，需同步维护对齐测试 [ssotAlignment.test.ts](file:///d:/workspaces/ai-coding/wink-ai/wink-ai/packages/unisim/src/unisim/__tests__/ssotAlignment.test.ts)。

---

## 遵循与后续（Compliance）

1. 在 `pal_osal_wasm.c` 和 `pal_osal_host.c` 中实现时钟内部 Gate 以及主调度模式分流。
2. 更新 `unisim` 包的类型定义 `WasmExports` 并添加测试覆盖。
3. 单元测试覆盖 HEADLESS 下虚拟时钟快速跳跃的测试用例 `test_sim_scheduler_headless_jump`。

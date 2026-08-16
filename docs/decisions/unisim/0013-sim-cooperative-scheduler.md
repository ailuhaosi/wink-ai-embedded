# ADR-0013：仿真侧协作式确定性调度模型

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-02 |
| 触发 | [PLAN-20260701-SIM-COOP-SCHED](../../implementation-plans/unisim/2026-07-01-sim-cooperative-scheduler-plan.md) |
| 影响范围 | targets (wasm/host/esp32) / OSAL / 仿真时间管理 / 单元测试 |
| 决策者 | 项目负责人与内核核心架构师团队 |
| 关联既有 ADR | [ADR-0003 仿真保真度边界](0003-simulation-fidelity-boundary.md), [ADR-0007 协作循环执行模型](../core/0007-cooperative-loop-execution-model.md), [ADR-0009 物理行为仿真](0009-physical-behavior-simulation-fault-injection.md), [ADR-0012 契约诚实](../core/0012-contract-honesty-over-silent-degradation.md), [ADR-0014 仿真单虚拟核](0014-sim-single-virtual-core.md) |

---

## 背景（Context）

在当前 WinkOS 仿真实现中（`targets/wasm/pal_osal_wasm.c` 及 `targets/host/pal_osal_host.c`），`pal_os_task_create` 是一个**退化的同步直调实现**（即在创建时立即同步调用任务函数一次）。这在引入复杂的多任务 App 时暴露出严重缺陷：
1. **多任务无法并发运行**：如果任务 A 包含 `while(1) { sleep; }` 循环，调用 `pal_os_task_create` 运行任务 A 后，任务 B 永远不会被调度，使得多任务生产者-消费者架构失效。
2. **时序与真机行为割裂**：真机（ESP32）使用 FreeRTOS 进行抢占式并发调度，而仿真侧退化为只有第一个任务活跃，严重违反了 [ADR-0003 仿真保真度边界](0003-simulation-fidelity-boundary.md)。
3. **IPC（消息队列/信号量/互斥锁）阻塞失效**：没有真正的任务切换上下文，使得跨任务消息传递完全不可用。

---

## 决策（Decision）

为了在不引入多线程安全屏障限制和保持确定性重现的前提下修复该问题，我们决定在 Host 和 WASM 的仿真 Target 中引入 **“协作式确定性调度器模型（Cooperative Deterministic Scheduler）”**：

### 1. 物理协程上下文切换（True Fiber Switch）
我们抛弃“伪协程”或“手动修改函数为非死循环结构”的妥协，在底层通过硬件/平台原生的轻量级协程进行上下文切换：
* **Host 侧 (Windows)**：使用 **Win32 Fibers** (`ConvertThreadToFiber`, `CreateFiber`, `SwitchToFiber`, `DeleteFiber`)。
* **WASM 侧**：使用 Emscripten 官方提供的 **Emscripten Fibers** (`<emscripten/fiber.h>`)。它在内部基于 Asyncify 转换机制，但封装了完善的独立数据栈和 Asyncify 状态栈逻辑，规避了手动操纵 `__asyncify_data` 的不稳定性。
* 统一通过 `sim_ctx_*` 抽象层隔离平台差异，实现三端（真机/Host仿真/WASM仿真）App 任务代码的 100% 同源与逻辑对齐。

### 2. 基于确定性 PRNG 的协作式调度器
* 所有就绪任务保存在调度器内部的状态表中，状态包括 `READY` / `WAITING` (等待时间) / `BLOCKED` (等待资源) / `ZOMBIE` (待回收)。
* 任务切换只发生在明确的 Yield 点（如 `pal_os_sleep_ms`、`pal_os_mutex_lock` 等）。
* 调度器挑选下一个运行的任务时，通过 xorshift32 PRNG 计算随机交错（或根据固定的优先级和轮转算法）。通过 PRNG 种子（Seed）的注入，保障仿真运行轨迹的 **Bit-Exact 确定性可复现**。

### 3. 协程自删的“三段式”Zombie 清理
协程上下文不允许自己在当前运行 the Fiber 内调用 `DeleteFiber` 销毁自身（会直接触发宿主线程终止）。因此，自删必须通过三段式实现：
1. 任务调用 `pal_os_task_delete(NULL)`，或任务函数正常返回（由协程 trampoline 捕获），将任务标记为 `ZOMBIE` 状态。
2. 执行 `sim_ctx_switch(cur_ctx, s_main_ctx)` 强制让出，切回主调度协程（`cur_ctx` 由 `sim_scheduler_current_ctx()` 获取；契约 v2 要求 `from` 非 NULL，见 PLAN-20260702-SIM-COOP-SCHED-FIXUP F1）。
3. 主调度循环在下一轮调度时（Phase 1 GC）扫描 `ZOMBIE` 状态的任务，并在主协程上下文安全地调用 `sim_ctx_destroy` 释放其协程栈空间，然后将 slot 置为 `TERMINATED`（可供后续 register 复用）。

### 4. 仿真栈大小（Stack Depth）安全保障契约
* 仿真侧的 Fiber 需要比真机 FreeRTOS 更大的运行栈。
* 用户传入 `pal_os_task_create` 的 `stack_depth` 会被视为“下限约束”：若小于平台安全下限（Host 32KB / WASM 数据栈 16KB），调度器会**自动 clamp 向上调整至下限并打印 Warning 日志**。

---

## 方案比选（Options）

1. **选项 A：原生多线程 Wasm**
   * 采用 `pthread` 映射 FreeRTOS 任务。
   * **否决原因**：违反浏览器安全沙箱限制（需要特殊的跨域首部 COOP/COEP 以开启 SharedArrayBuffer 从而限制了 GitHub Pages 部署）；多线程并发使时序不可重现，违背 bit-exact 复现红线。
2. **选项 B：手动交换 `__asyncify_data`**
   * 裸手写 WASM 状态栈保存与恢复。
   * **否决原因**：非官方 API，易受 Emscripten 版本更新影响，导致栈损坏及 Sanitizer 报错。
3. **选项 C：协作式确定性调度器 + 官方 Fibers API（采纳）**
   * 采用统一的 `sim_ctx` 接口封装 Win32 Fibers 与 `<emscripten/fiber.h>`。
   * **采纳原因**：完全支持 `while(1)` 结构的同源应用；保障 100% 确定性；零部署限制。

---

## 已知保真度边界与诚实性声明（Simulation Fidelity Boundaries）

为了不误导用户及后续开发，必须在此记录本仿真模型的物理边界：
1. **纯 CPU 计算不可被强制抢占**：
   如果应用层包含大段无 Yield 点（如无 sleep / lock 动作）的 CPU 密集型循环，仿真器不会强制剥夺该任务的运行权。
   * *防卫机制*：调度器在任务每次切入/切出时，用**物理墙钟**度量其实时执行耗时（host 走 `QueryPerformanceCounter`；wasm 走 `emscripten_get_now()`），若单个 slice 超过 **5ms** 阈值，则视为违背 WCET，主动触发 `wink_runtime_fault(callbacks, 8002)` 抛出致命故障——`callbacks` 由 `pal_sim_scheduler_run` 透传自 `wink_runtime_run`，确保 App 的 `on_fault(8002)` 被调用以执行业务级 safe-off（PLAN-20260702-SIM-COOP-SCHED-FIXUP F2 Step 6，红线 16）。
   * *防卫旁路*：若宿主挂载了调试器（如 Windows 上 `IsDebuggerPresent()`）或设置了环境变量 `WINK_SIM_BYPASS_WCET`，则自动屏蔽 8002 错误，以防单步断点调试或 CI 容器抢占时误杀。
2. **微观指令级竞态不可模拟**：
   本模型无法模拟真正的双核物理并发读写冲突（如未加锁的共享内存写覆盖），此类竞态 Bug 需依赖静态分析工具和真机测试拦截。
3. **中断到任务唤醒的延迟放大**：
   仿真侧的 ISR 唤醒被积压到下一个虚拟时钟 tick 边界 poll，而真机上是硬件微秒级响应。

---

## 遵循与后续（Compliance & Follow-up）

1. 在 `wink-micro-os/targets/common/` 落地 target 无关调度算法；
2. 规范回写 `04-wasm-simulation/07-scheduler-model.md`（设计规范；fixup 计划 F6 落地为 07-；SSOT 编号与原 03- 冲突，故沿用 07-）；
3. 单元测试覆盖 deterministic-interleaving 序列对比断言。

---

*本 ADR 状态变更请在此记录：*
- 2026-07-02：Proposed（PLAN-20260701-SIM-COOP-SCHED）
- 2026-07-02：Accepted（PLAN-20260701-SIM-COOP-SCHED v1.4 骨架合入 0e2b087）
- 2026-07-02：回退至 Proposed（原因：C1/C2 Critical Bug + 依赖工件 ADR-0014、
  04-wasm-simulation/07-scheduler-model.md、_wcet_fault 等测试均未落地；
  详见 PLAN-20260702-SIM-COOP-SCHED-FIXUP）
- 2026-07-02：Accepted（依赖工件均已交付：ADR-0014、
  04-wasm-simulation/07-scheduler-model.md、_wcet_fault / _determinism / _stack_clamp /
  _single_task_semantic_regression 测试全部通过；详见 PLAN-20260702-SIM-COOP-SCHED-FIXUP F7）


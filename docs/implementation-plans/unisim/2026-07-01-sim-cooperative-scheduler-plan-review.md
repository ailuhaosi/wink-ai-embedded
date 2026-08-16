# 仿真侧协作式确定性调度器实施计划 - 架构评审意见

**评审人**: wink-ai 资深嵌入式架构师
**评审日期**: 2026-07-01
**目标文件**: `2026-07-01-sim-cooperative-scheduler-plan.md`

## 1. 总体评价

这是一份质量极高、目标明确的实施计划。计划精准识别了当前仿真引擎中 `pal_os_task_create` 退化为同步调用的**功能性缺陷**，并提出了在不破坏 esp32 真机行为、不影响现有单任务 App 的前提下，通过**协作式确定性调度器 (Cooperative Deterministic Scheduler)** 来弥补这一缺陷。

计划的架构红线（Target 无关、单虚拟核、确定性保证）抓住了仿真开发的核心痛点。整体执行路线（从 ADR 到算法再到 Host/Wasm 适配）逻辑严密。

在深入细节后，我提出了以下 **5 点专业架构建议与风险纠偏**，建议在执行前合入原计划。

---

## 2. 关键架构建议与风险纠偏

### 🔴 2.1 [P0] Wasm 侧的协程机制：强烈建议使用 `<emscripten/fiber.h>`
**问题**：计划在 `Task 3` 中提到 "必须为每个 Task 维护独立的 `asyncify_data` 结构... 手动处理多上下文切换与 rewind"。直接操作 Asyncify 底层结构非常容易出错，且生命周期管理复杂。
**架构建议**：
Emscripten 官方其实已经基于 Asyncify 封装了一套专用于 C 语言用户态协程的 API，即 **Emscripten Fibers (`<emscripten/fiber.h>`)**。
它的 API (`emscripten_fiber_init`, `emscripten_fiber_swap`) 与 Windows Fibers (`CreateFiber`, `SwitchToFiber`) 在语义上 **100% 对齐**。
* **收益**：你可以将 Host 和 Wasm 的上下文切换抽象得极其对称（都是 Fiber Swap）。Wasm 侧的 `wink_runtime_run` 作为 Main Fiber，各个 Task 作为 Child Fibers。Task 内部调用 `pal_os_sleep_ms` 时，只需 `emscripten_fiber_swap(&task_fiber, &main_fiber)` 即可切回调度器，调度器再决定切给谁。只有当所有 Task 都在 Sleep 时，Main Fiber 才调用 `emscripten_sleep`（或让出给 JS Event Loop）推进虚拟时钟。
* **行动点**：修改 Task 3，弃用裸写 Asyncify，改用 `emscripten/fiber.h`。

### 🔴 2.2 [P0] 任务自删除的"僵尸状态 (Zombie)"与资源回收陷阱
**问题**：计划在 `Task 2 Step 3` 中提到 `pal_os_task_delete(NULL)` 会 "terminate current，随后永不返回"。但在 Windows Fiber 或 Wasm Fiber 中，**一个正在运行的 Fiber 无法安全地释放它自己的栈内存和句柄**（比如调用 `DeleteFiber` 销毁自己会导致 Crash）。
**架构建议**：
* 调度器状态机 `sim_task_state_t` 需要明确支持 `SIM_TASK_STATE_ZOMBIE` 或 `TERMINATED`。
* 当任务自删除时，它将自己的状态设为 `TERMINATED`，然后 **Yield**（Swap回主调度器）。
* **主调度器**在 `sim_scheduler_pick_next` 循环中，负责扫描状态为 `TERMINATED` 的任务，**安全地调用** `DeleteFiber` / `emscripten_fiber_free` 回收它们的栈和资源，然后将其从 slot 中清空。

### 🟠 2.3 [P1] 栈大小 (Stack Depth) 的跨平台安全适配
**问题**：ESP32 的 FreeRTOS 任务栈通常较小（例如 2048, 4096 字节），但在 Host (Windows x64) 或 Wasm (32位/64位且未优化的栈帧) 上，同样的栈深度极易溢出。
**架构建议**：
在 `pal_osal_host.c` 和 `pal_osal_wasm.c` 的 `pal_os_task_create` 实现中，不能直接将用户传入的 `stack_depth` 喂给 `CreateFiber`。
* **行动点**：引入最小栈深度保证机制。例如 `#define SIM_MIN_FIBER_STACK_SIZE (64 * 1024)`。实际创建 Fiber 时的栈大小应为 `MAX(stack_depth * sizeof(StackType_t), SIM_MIN_FIBER_STACK_SIZE)`，防止仿真跑出 Stack Overflow 导致静默崩溃。

### 🟠 2.4 [P1] `BLOCKED` 状态的超时唤醒语义
**问题**：设计了 `SIM_TASK_STATE_BLOCKED` 用于 IPC 等待（如 Queue/Ringbuf）。但在实际嵌入式开发中，往往是带超时的等待（例如 `queue_receive(..., timeout_ms)`）。
**架构建议**：
* 任务处于 `BLOCKED` 状态时，它的 `sleep_until_us` 也应该保持有效（如果使用了超时时间）。
* 调度器的 `sim_scheduler_pick_next` 扫描逻辑中，如果一个任务是 `BLOCKED` 并且 `now_us >= sleep_until_us`，调度器应将其强制转为 `READY`（超时唤醒）。这样可以让 IPC 模块在被唤醒后检查超时并返回 `WINK_ERR_TIMEOUT`，完美模拟 FreeRTOS 行为。

### 🟡 2.5 [P2] 澄清"虚拟抢占点 (Task 7)" 的技术局限性
**问题**：在 `Task 7` 中计划在 `wink_runtime` 的 tick loop 中强制调用 `sim_scheduler_maybe_preempt()`。但如果用户代码写了一个长耗时的 CPU 密集型循环且不调用任何 PAL API，执行流根本回不到 tick loop，无法被抢占。
**架构建议**：
* 协作式调度的本质决定了纯 CPU 运算是无法被外部强行抢占的（除非使用 OS 线程/信号中断）。
* **行动点**：在 ADR-0013 中必须明确写明这个**保真度边界**：仿真引擎中的"虚拟抢占"**仅发生在使用 PAL API（如 yield/sleep/queue等）调用点**，而非任意 CPU 指令边界。建议不把 Task 7 放在本 Wave 的核心目标中，保持纯协作式调度即可满足绝大多数规范编写的应用。

---

## 3. 结论

该实施计划非常成熟。建议：
1. 采纳上述 **2.1 (Emscripten Fibers)** 和 **2.2 (Zombie 清理)** 作为修改点更新原计划的 Task 2 / Task 3。
2. 更新完毕后即可直接进入执行阶段 (Task 0 -> Task 6)。不需要为了这些修改重新拉长评审周期。

期待看到仿真确定性多任务能力的落地！

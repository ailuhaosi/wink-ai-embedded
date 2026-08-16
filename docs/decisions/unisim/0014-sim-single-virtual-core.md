# ADR-0014：仿真侧单虚拟核执行模型与非对称运行一致性取舍方案

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-02 |
| 触发 | PLAN-20260702-SIM-COOP-SCHED-FIXUP F0；深度剖析真机与 Wasm 仿真在多任务/多核并发下的底层差异与竞态风险（前置 PLAN-20260701 遗漏创建） |
| 影响范围 | targets (wasm/host/esp32) / OSAL / 仿真保真度契约 / AI Codegen 规约 |
| 决策者 | 项目负责人与内核核心架构师团队 |

---

## 背景（Context）

WinkOS 的核心技术承诺是 **“双端同源编译”** 与 **“行为级高保真仿真（Causal Parity）”**。在普通单任务（单 Loop）场景下，Wasm 仿真与 ESP32 真机的执行流完全一致。

然而，随着系统引入了 **OSAL 跨核逃生舱（`pal_os_task_create`）** 和 **跨核无锁环形队列（`pal_os_ringbuf`）**，系统在物理执行层面上出现了本质的分化：
1. **ESP32 真机物理层**：基于 FreeRTOS 实现了**真正的多核抢占式并发**。主控制环钉在 Core 1，后台重计算任务跑在 Core 0，两个核物理级并行执行，中断可随时发生抢占。
2. **Wasm 浏览器仿真层**：运行在**单线程 JavaScript/Wasm 沙箱**中。在当前的退化（Degenerate）实现中，`pal_os_task_create` 采用同步调用（Run-to-Completion），即调用时立即跑完后台任务再返回。

这种“真机多核抢占，仿真单线程同步”的非对称性，带来了严重的一致性逃逸风险（Fidelity Escape），主要体现在：
* **竞态与死锁被掩盖**：在 Wasm 中，后台任务瞬间完成并返回，数据传递是天然顺序一致的。这会导致原本在真机上因“数据尚未算完”或“多线程 Cache 不一致”引发的 Race Condition 在仿真端被 100% 隐藏。
* **时序分叉**：真机后台任务存在运行时间抖动（Jitter），而 Wasm 中被压缩为零时间，破坏了“Golden Trace（黄金轨迹）”对齐契约。
* **卡死隐患**：如果后台任务包含长等待或 `while(1)` 死循环，在 Wasm 中会同步阻塞浏览器主线程，导致整个 3D 工作台页面失去响应。

---

## 方案比选与架构权衡（Options & Trade-offs）

### 方案 A：Wasm 原生多线程化 (SharedArrayBuffer + pthreads)
* **做法**：编译 Wasm 时开启多线程支持，利用浏览器 Web Workers 模拟多核。
* **优点**：能够真实还原多线程物理并发与抢占，暴露真实的竞态 Bug。
* **缺点**：
  1. 现代浏览器出于防范 Spectre 硬件漏洞的安全纪律，只有在服务端配置特殊的跨域安全响应头（COOP/COEP）时才允许使用 `SharedArrayBuffer`，这极大地限制了 WinkOS 仿真工作台在 GitHub Pages 或常规 CDN 等静态托管平台上的低成本部署。
  2. 多线程锁竞争同步开销巨大，极易引发浏览器 3D 渲染画布的卡顿。

### 方案 B：维持现状 (同步退化单线程)
* **做法**：维持退化实现，后台任务同步运行。
* **优点**：零开发成本，环境依赖极低。
* **缺点**：多任务生产者-消费者模型无法工作（消费者任务根本无法并存调度），卡死风险高，存在严重的一致性逃逸风险。

### 方案 C：单虚拟核协作式确定性调度模型 (Fiber/Asyncify)（采纳方案）
* **做法**：在 Wasm/Host 仿真端引入 **“单虚拟核”** 模型。使用 Wasm 的 `<emscripten/fiber.h>`（利用 Asyncify）和 Windows Fibers 抽象出轻量级协程上下文。引入一个**基于时间轮的确定性协作调度器（Wink Sim Scheduler）**。
* **优点**：
  1. **零部署限制**：无需多线程支持，在单线程 Wasm 沙箱中即可完美运行，保证任意静态 Web 托管的零门槛部署。
  2. ** causal 级对齐**：多任务能够真正并存并按 Tick 分时交错运行，完美支持生产者-消费者模型。
  3. **确定性重现**：任务调度交错序列由带 Seed 的 PRNG 决定，同一 Seed 下 5 次运行轨迹 bit-exact 一致，便于 CI 失败排查。
* **缺点**：由于本质上是“单虚拟核协作式分时调度”，它仍然无法完全还原物理双核同时执行一条指令的硬件级竞态。

---

## 决策结论（Decision）

正式采纳 **方案 C（单虚拟核协作式确定性调度模型）** 作为 WinkOS 仿真端的多任务并发基石：

1. **确定性单虚拟核（Single Virtual Core）**：
   在 Wasm/Host 仿真器中，仅虚拟一个 CPU 核心。所有通过 `pal_os_task_create` 创建的任务，都注册进仿真调度器的就绪队列中，以协作式（Cooperative）分时调度的形式，交替占用这个唯一的虚拟核心。
2. **轻量级物理上下文切换**：
   废弃原有的“同步退化调用”，在 Wasm 侧通过 `<emscripten/fiber.h>` 分配独立的 Fiber 数据栈，在 Host 侧通过 Win32 Fiber API，实现真正的非抢占式上下文切换（Context Switch）。
3. **基于非阻塞队列的接口解耦**：
   逃生舱任务与主控制循环之间仅允许通过非阻塞的 `pal_os_ringbuf` 进行单向数据传递，禁止使用任何阻塞式同步锁。

---

## 后果与约束（Consequences & Constraints）

### 1. 开发者的编码硬约束（Gotchas & Lints）
由于单虚拟核是协作式运行，开发者编写任务代码时必须严格遵守以下规范：
* **任务内禁止编写无阻塞死循环**：所有后台任务如果包含 `while(1)`，循环体内部必须显式包含 `pal_os_sleep_ms` 挂起自身，或者主动执行协程 `yield` 让出 CPU。否则，仿真端将因单核饥饿直接锁死。
* **强制非阻塞检查返回值**：从 `pal_os_ringbuf_pop` 中拉取数据时，必须显式判定 `WINK_ERR_EMPTY`。绝不允许在应用层编写同步忙等，必须假定“数据可能在若干 Tick 后才到达”，以应对真机的物理延迟。
* **局部变量 static 化要求**：在 Wasm 仿真使用无栈协程时，跨 Yield 挂起点的局部变量必须声明为 `static`。通过静态代码检查器 `check_pt_variables.py` 在编译前强制拦截此类 Footgun。

### 2. 保真度边界定义（Honesty Bounds）
在设计规范中公开承认并记录单虚拟核仿真的边界，降低期望值：
* **纯 CPU 耗时不可抢占**：若一个后台任务执行了纯 CPU 密集型计算（无 Sleep），仿真调度器在其计算完前不会强行切走 CPU；而真机上会被 RTOS 强制剥夺 CPU 保证 10ms 主控周期（通过 WCET 8002 超时告警机制在仿真端进行拦截惩罚）。
* **微观指令竞态无法模拟**：两个核在同一时刻读写同一片内存的“脏读”行为，在单核仿真中无法自然发生。

### 3. 时间线混沌调度 (Chaos Scheduling - 演进路标)
为了在单虚拟核中激发出并发竞态 bug，调度器将在每个调度 Tick 边界引入基于 Seed 的随机微观抖动。强制让出 CPU，模拟多线程抢断，提高 Race Condition Bug 的暴露率。

---

## 具体不覆盖的 bug 类型（供未来 review 检索）

单虚拟核模型主动放弃对以下真机场景的还原能力——这些属于 [ADR-0003 仿真保真度边界](0003-simulation-fidelity-boundary.md) 划出的"真机 CI + 静态分析" 责任区：

1. **无 mutex 保护的共享 struct 跨核并发写**——写覆盖/撕裂读在单核协作下永不触发。
2. **Pinned-to-core 的时序假设**（例如"Core 0 的定时器抖动 ≠ Core 1"、依赖 `xPortGetCoreID()` 的分支时序）。
3. **跨核 cache flush / DMA 一致性场景**（一致性协议/`Cache_WriteBack_Addr` 相关问题）。
4. **ISR 在 Core X、唤醒的 task 被调度到 Core Y 的时序假设**（wake-up latency 分布差异）。
5. **`portMUX_TYPE` (spinlock) vs task-level mutex 的语义漂移**——单核下二者行为退化为等价。

---

## Compliance & Follow-up

- Round-robin `pick_next` 实现中忽略 `core_id`（PLAN-20260702-SIM-COOP-SCHED-FIXUP F4 Step 2 落地）。
- `04-wasm-simulation/07-scheduler-model.md` 记录本决策（PLAN-20260702-SIM-COOP-SCHED-FIXUP F6）。
- 若未来确需 SMP 仿真（loom 风格 seed 扫描 core interleaving）：**新起 ADR-0015**，本 ADR 保持不变。

---

*本 ADR 状态变更请在此记录：*
- 2026-07-02：Accepted（初次创建，遗漏 Compliance/不覆盖清单）
- 2026-07-02：回退至 Proposed（PLAN-20260702-SIM-COOP-SCHED-FIXUP F0；
  补充"具体不覆盖 bug 类型" 与 "Compliance & Follow-up" 章节；
  待 fixup 计划 F7 交付依赖工件后重新 Accept）
- 2026-07-02：Accepted（依赖工件全部交付：round-robin `pick_next` 落地忽略 core_id、
  `04-wasm-simulation/07-scheduler-model.md` 已回写；详见 PLAN-20260702-SIM-COOP-SCHED-FIXUP F7）

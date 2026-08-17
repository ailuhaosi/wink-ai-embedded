# 协作式调度器、并发模型与阻塞门禁

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Landed**（协作 RR 调度 / Fiber / WCET / HEADLESS 跳跃）；混沌 PRNG 交错 **Planned**（Task 7）；SMP **Planned**（需新 ADR，当前拒绝） |
| 支撑轴 | **E（primary）**；**D（secondary）** — Phase 0 / tick 驱动 Poll、同刻总序 |
| 关联代码 | `wink-micro-os/targets/common/{include,src}/wink_sim_scheduler.*`、`wink-micro-os/targets/common/include/sim_ctx.h`、`wink-micro-os/osal/{wasm,host}/pal_osal_*.c` |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | [0007](../../../decisions/core/0007-cooperative-loop-execution-model.md)、[0012](../../../decisions/core/0012-contract-honesty-over-silent-degradation.md)、[0013](../../../decisions/unisim/0013-sim-cooperative-scheduler.md)、[0014](../../../decisions/unisim/0014-sim-single-virtual-core.md)、[0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md)、[0042](../../../decisions/unisim/0042-sim-execution-modes.md)、[0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md) |
| 迁自 | `04-wasm-simulation-2.0/04-scheduler-and-concurrency.md` |

> 本文件回答：多任务在单 Wasm 栈上如何表达、任务状态机、确定性如何保证、WCET 兜底、同步原语语义、SMP 边界、STRICT_NONBLOCKING 门禁。对应轴 E 与 C3/C5/C9/C16。

---

## 1. 目的与模型

把退化的同步直接调用 `pal_os_task_create` 替换为**协作式确定性调度器**，同时用于 host 与 wasm。目标：

1. 多任务并发（`while(1){sleep;}` + ringbuf 生产/消费）；
2. bit-exact 确定性（同注册序 + 同 yield 模式 → 100% 可复现调度）；
3. 零部署门槛（单线程 Wasm，不需要 SharedArrayBuffer / COOP / COEP）；
4. 与 ESP32 FreeRTOS 在 App 级 API 同源（`pal_os_task_create` / `pal_os_sleep_ms` / `pal_os_ringbuf`）。

**核心取舍**：切换只发生在显式 yield 点（`pal_os_sleep_ms`、`pal_os_mutex_lock` 等）。这不是真抢占；纯 CPU 计算段不可被打断（见 §6 边界）。

---

## 2. 任务状态机

```text
INVALID → READY → WAITING/BLOCKED → READY → ZOMBIE → TERMINATED → (slot 复用) READY
```

| 状态 | 含义 | 写入者 |
|---|---|---|
| `INVALID` | slot 未占用（memset 0） | `sim_scheduler_reset` |
| `READY` | 可被挑选 | register / wakeup_by_time / resume |
| `WAITING` | `sleep_ms` 时间等待，`wakeup_us>0` | `yield_timed` |
| `BLOCKED` | 等 mutex/queue/sem，可带超时；`timeout_fired` 供 `mutex_lock` 返回 TIMEOUT | `block` |
| `ZOMBIE` | 自删已让出，fiber 未释放，等主调度器 GC | `mark_zombie` |
| `TERMINATED` | 已释放，slot 可复用 | `gc_zombies` |

任务结构（`wink_sim_scheduler.h`，`_Static_assert(sizeof <= 96)`）：

```c
typedef struct {
    void   (*func)(void*);
    void*    arg;
    int32_t  priority;
    int32_t  core_id;           /* 记录但不用于调度（ADR-0014） */
    uint64_t wakeup_us;         /* 0=无时间唤醒；>0=到期强制 READY */
    uint32_t blocked_on;        /* 0=未 BLOCKED；>0=等待资源 id */
    bool     timeout_fired;     /* resume 时清零；供 mutex_lock 判 TIMEOUT */
    sim_task_state_t state;
    uint32_t id;                /* 单调分配 */
    char     name[16];
    sim_ctx_t* ctx;             /* target 相关协程句柄 */
} sim_task_t;
```

容量与栈下限：

| 常量 | 值 | 说明 |
|---|---|---|
| `WINK_SIM_MAX_TASKS` | 8 | 最大任务数 |
| `WINK_SIM_TASK_WCET_THRESHOLD_US` | 5000（5ms） | WCET 阈值默认值 |
| `WINK_SIM_STACK_MIN`（wasm/host） | 16 KiB / 32 KiB | 用户 `stack_depth` 是**下限**，低于此值 clamp 上并 WARN |
| `WINK_SIM_ASYNCIFY_MIN`（wasm） | 2 KiB | Asyncify 栈下限 |

---

## 3. 主调度 loop（`pal_sim_scheduler_run`）

```text
loop while (main_task 未 TERMINATED 且未达 max_ticks):
  [Phase 0] wasm: pal_wasm_dispatch_pending_interrupts()   # drain JS IRQ → C 软中断
  [Phase 1] sim_scheduler_gc_zombies()                     # ZOMBIE→TERMINATED，释放 fiber
  [Phase 2] sim_scheduler_wakeup_by_time(now_us)           # 到期 WAITING/BLOCKED → READY
  [Phase 3] next = sim_scheduler_pick_next()
            无 READY:
              INTERACTIVE → js_pal_os_sleep_ms 让出（JS 推进时钟）
              HEADLESS    → 经单 Gate 跳跃 s_virtual_us 到 next_wakeup_us; continue
            有 READY:
  [Phase 4] set_current(next)
            wall_start = host_wall_clock_us()              # 物理墙钟（红线 11）
            sim_ctx_switch(main_ctx, task_ctx)
            set_current(NO_READY)                          # 红线 15
            duration = wall_now - wall_start
            if duration > wcet_threshold: wink_runtime_fault(callbacks, 8002)
            if next == main_task_id: ticks_run++
```

- **Phase 0 中断派发**仅 wasm 有（host 为 no-op），详见 [04-interrupt-model](./04-interrupt-model.md)。
- **HEADLESS 无 READY 时**不走 Asyncify，直接跳跃时钟（ADR-0042），且**旁路 WCET 8002**（虚拟时间瞬跳，墙钟比照无意义）。
- `callbacks`（`struct wink_app_callbacks*`）透传给 `wink_runtime_fault` 以触发 App `on_fault`（ADR-0012 契约诚实）；允许 NULL（测试场景）。PAL 头只做前向声明，禁止 include `wink_app.h`/`wink_runtime.h`，严守 pal < runtime < app 分层。

### 3.1 同一虚拟时刻的事件总序（[ADR-0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md)）

同一 `now_us` 上可能相关的源：

| # | 事件源 | 落点 | 同刻裁决 |
|---|---|---|---|
| 1 | JS `InterruptQueue`（GPIO 边沿） | Phase 0 | **Landed**：外部 IRQ 先于软中断 |
| 2 | C `s_pending_queue[]`（软中断） | Phase 0 级联 | **Landed**：接在外部 IRQ 之后 |
| 3 | Pin Event Queue（`push_pin_event`） | [`02`](./02-virtual-clock.md) pull（`pulse_in` 等） | **Landed（契约）**：不进 Phase 2；快进不派发 ISR；与 wakeup 的可复现性依赖任务调用序 ∪ 本总序 |
| 4 | 调度器 `wakeup_by_time` | Phase 2 | **Landed**：在 Phase 0 之后；同刻多任务 **slot 升序** 置 READY |

**SSOT 相序**：`Phase0(外→软) → GC → wakeup_by_time → pick_next → 任务切片`。

**bit-exact 宣称**：跨「边沿 ISR + 定时唤醒」交叉场景须遵守本总序 + 固定注册序/yield（ADR-0013）；反测 `test_sim_same_timestamp_*` 为 **Planned**（未绿前不得冒充已证明）。Pin Event 并入调度 Phase 0.5 为 **Planned** 增强（ADR-0053 选项 B）。

---

## 4. 三个纯决策函数

| 函数 | 语义 |
|---|---|
| `sim_scheduler_pick_next()` | **Round-Robin**：从 `(last_scheduled+1) mod MAX_TASKS` 起扫描，第一个 READY 中选；更新 `last_scheduled`；无则 `SIM_SCHED_NO_READY`。当前波次**无 PRNG**（`s_prng_state` 仅 seed 初始化，预留给 Task 7 混沌调度）。 |
| `sim_scheduler_wakeup_by_time(now_us)` | 对每个 WAITING/BLOCKED 且 `wakeup_us<=now_us` 置 READY、`wakeup_us=0`；若原 BLOCKED 置 `timeout_fired=true`、`blocked_on=0`；返回唤醒数。 |
| `sim_scheduler_gc_zombies()` | 对每个 ZOMBIE 调 `sim_ctx_destroy`（在 main 上下文安全 DeleteFiber）、ctx 置 NULL、状态 TERMINATED。 |

**已知简化**：slot 复用会让新任务首次派发延迟一轮（R7，接受）。RR 可能"过于公平"而掩盖饿死——由 C5.3 饿死统计 + 未来混沌调度补足。

> ADR-0013 文本曾提"xorshift32 随机交错"；当前实现是 RR，混沌（PRNG 交错）是 Task 7 路标，不是现状。`test_sim_scheduler_determinism` Case 2 未来须翻为 NOT_EQUAL 作反测。

---

## 5. host vs wasm 语义对照

| 维度 | host（Windows） | wasm（Emscripten） |
|---|---|---|
| Fiber API | `ConvertThreadToFiber`/`CreateFiber`/`SwitchToFiber`/`DeleteFiber` | `<emscripten/fiber.h>`（官方 Asyncify fiber，非手工 `__asyncify_data`） |
| 业务时钟 | `host_sim_time_us()`（静态累加；测试用 `host_sim_advance_to`） | `s_virtual_us` + 单 Gate 推进 |
| WCET 时钟 | `host_wall_clock_us()`（QPC） | `emscripten_get_now()*1000` |
| 栈下限 | 32 KiB | 16 KiB 数据栈 + 2 KiB Asyncify |
| 中断派发 | no-op | Phase 0 `pal_wasm_dispatch_pending_interrupts()` |
| idle 行为 | host 时钟跳跃 | INTERACTIVE: Asyncify yield；HEADLESS: C 侧时钟跳跃 |

平台差异藏在 `sim_ctx_*` 之后（`sim_ctx_create/from_current/switch/destroy`）。`sim_ctx_switch` 契约 v2：`from` 必须非空。

---

## 6. 保真度边界（ADR-0013/0014）

1. **纯 CPU 计算不可抢占**：任务无 yield 点且单片超过 5ms，主循环触发 `wink_runtime_fault(callbacks, 8002)`。注意 `busy_wait_us` 只推进虚拟时钟、物理 CPU 实际耗时微秒级，不会误触 8002（`test_sim_scheduler_wcet_fault` 是反测）。
2. **指令级竞态不可仿真**：单虚拟核协作，真双核/任意指令间刺入的撕裂需真机 + 静态分析。
3. **wasm 中断唤醒延迟 O(调度 tick)**：Phase 0 轮询派发；真机是微秒级。
4. **`core_id` 被忽略**：`pick_next` 不按核派发（ADR-0014）。

### 6.1 单虚拟核明确不覆盖的 bug 类型（ADR-0014）

1. 无锁跨核共享结构体写撕裂；
2. 钉核时序假设 / `xPortGetCoreID()` 分支；
3. 跨核 cache flush / DMA 一致性（`Cache_WriteBack_Addr`）；
4. X 核 ISR 唤醒 Y 核任务的延迟；
5. `portMUX_TYPE` 自旋锁与任务信号量的语义漂移（单核退化为等价）。

这些归真机 + 静态分析责任。SMP 仿真被明确拒绝；未来若需要 SMP 须新 ADR（原 ADR 编号 0015）。

### 6.2 硬编码规则（App 侧）

- 禁止无 yield 的 `while(1)`（必须 `pal_os_sleep_ms` 或 yield）；
- `pal_os_ringbuf_pop` 必须检查 `WINK_ERR_EMPTY`，禁止同步忙等；
- wasm 无栈协程中跨 yield 的局部变量**必须 `static`**，由 `check_pt_variables.py` 编译前强制。

---

## 7. `pal_os_task_delete` 语义边界（fixup R10）

| 调用 | 行为 |
|---|---|
| `delete(NULL)`（自删） | 当前任务 → ZOMBIE，路径 `mark_zombie(cur) → sim_ctx_switch(cur_ctx, main_ctx)`，主 loop GC |
| `delete(other)`（目标未运行） | 目标 → ZOMBIE；其 fiber 从未运行或已让出 |
| `delete(self_handle)`（语法是 other 但目标是自己） | 建议加 pal 分支对齐自删路径；当前实现按 other 处理 |
| `delete(other)` 且目标正被主循环切中 | **仿真禁止**——单虚拟核上不可能（其他任务必须已让出给 main）；assert fail 兜底 |

`sim_scheduler_task_count` 统计 READY/WAITING/BLOCKED/ZOMBIE（ZOMBIE 在 GC 前仍可内省其 name/id/priority）；TERMINATED 不计。要"可运行任务数"应另加 `count_by_state(READY)`（Task 7 预留，当前未实现）。

---

## 8. STRICT_NONBLOCKING 编译期门禁（ADR-0025）

仿真（wasm/fiber）target 默认 `-DWINK_STRICT_NONBLOCKING=1`：

- `WINK_BLOCKING` API（如阻塞式 `dal_ultrasonic_read`）在头文件中隐藏，误用 → **链接期 undefined reference**（fail-fast），而非在 Asyncify 下"静默跑起来"；
- bringup/selftest 阻塞工具置于 `runtime/selftest/`，`#ifndef WINK_STRICT_NONBLOCKING` 包裹，严格模式仅留返回 `WINK_ERR_UNSUPPORTED` 的 stub；
- BAL helper 分类驱动 pragma：LIGHT helper（`wink_led_blink_helper` 等）**不得**有阻塞区；MAY_BLOCK helper（`wink_sonar_helper`/`wink_servo_helper`/`wink_telemetry_helper`/`wink_oled_helper`）用文件级 `WINK_INTERNAL_BLOCKING_REGION`；业务回调与 `app_loop()` 禁止任何 pragma；
- LIGHT 上下文断言 `WINK_ASSERT_NONBLOCKING()` 是运行期兜底。

**为什么**（纪律与分层）：见 [`../01-overview/04-methodology.md`](../01-overview/04-methodology.md) §4（STRICT_NONBLOCKING 编译期门禁）。

**怎么做**（CMake/链接/selftest 落地）：见 [`./01-sandbox-and-execution.md`](./01-sandbox-and-execution.md) §5。

详见 [ADR-0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md)。

---

## 9. OS 同步原语语义对齐（C16）

仿真与真机的语义必须逐项钉死（对照表 + 单测），避免"返回值碰巧不同"：

| 原语 | 必须对齐的语义点 | 仿真落地（诚实） |
|---|---|---|
| Mutex | 超时返回码、是否可递归、owner 校验；`timeout_fired` 行为 | **Landed**（`pal_osal_wasm.c` 静态池 + 调度器 `block`/`timeout_fired`） |
| Sem | take/give、ISR give、超时 | **Landed**（同上） |
| Ringbuf | 满策略、空返回码、是否零拷贝 | **Landed**（`osal/common/pal_osal_ringbuf.c`；满拒/空 `WINK_ERR_EMPTY`） |
| Queue（消息队列） | 满策略、空返回码 | **Planned**（非 ringbuf 字节流的独立 Queue API 未作为本表 SSOT） |
| 阻塞+超时胜者 | 事件与超时同时到期时的**胜者** | **Partial**（依赖 `wakeup_by_time` + 同刻总序；跨源总序见 §3.1 Planned） |
| 任务通知/事件组 | 自动清位、wait-multi-bit | **Planned** / 未暴露则勿用 |
| 死锁检测 | wait-for-graph / 锁序 | **Planned** |

优先级反转（C5.5）：是否实现优先级继承须显式声明并检测"高优先级阻塞在低优先级持有的锁超过阈值"；基线**无**继承（**Planned**/非目标视产品口径）。

---

## 10. 验收测试

- `test_sim_scheduler`：pick_next / wakeup_by_time / block-resume / 栈 clamp / zombie（11 例）
- `test_sim_scheduler_e2e`：双任务 ringbuf 生产/消费
- `test_sim_scheduler_zombie_gc`：自删 fiber 释放
- `test_sim_scheduler_wcet_fault`：CPU 忙等触发 8002；`busy_wait_us` 不误触
- `test_sim_scheduler_determinism`：同 seed 一致；RR 语义锁定
- `test_sim_scheduler_stack_clamp`：host fiber 栈下限 clamp
- `test_sim_scheduler_headless_jump`：HEADLESS 时钟快跳跃（ADR-0042）
- `test_single_task_semantic_regression`：avoidance_car 业务字段对齐基线

## 11. 未来演进

- **Task 7 混沌调度**：`pick_next` 引入 PRNG 交错 + `fairness_bound` 激发竞态（C3.1）；确定性靠 seed。
- **抢占式仿真**：若做，仍须 seed 驱动抢占决策以保确定性；性能/复杂度代价大。
- **SMP**：明确拒绝，需新 ADR。
- FOC 快环是"虚拟时间确定性步进"的调度器消费者（ADR-0047），见 [09-timer-and-pwm-semantics.md](./09-timer-and-pwm-semantics.md)。


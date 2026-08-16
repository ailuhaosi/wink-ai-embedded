# 中断模型：Poll 队列、临界区与不可验边界

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Landed**（Poll 队列 / Phase0+unlock 补发 / 双 FIFO）；队列溢出 Fail-Loud 强化为 **Partial**；优先级嵌套不可验（非缺口，是边界） |
| 支撑轴 | **D（primary）** |
| 关联代码 | `wink-micro-os/targets/wasm/pal_irq_wasm.c`、`wink-micro-os/targets/wasm/wasm_bridge.h`、`wink-micro-os/targets/wasm/pal_wasm_internal.h`、`@wink-ai/unisim` (InterruptQueue) |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | 0002、0003、0013、0018（PAL IRQ 收窄） |
| 迁自 | `04-wasm-simulation-2.0/05-interrupt-model.md` |

> 本文件回答：Wasm 里 ISR 何时跑、为什么不能抢占、临界区如何延迟派发、队列溢出怎么办。对应轴 D 与 C4、C15.2、C20。

---

## 1. 模型：协作式 Poll，非抢占

真实 MCU 在任意指令间刺入中断并按优先级嵌套；Wasm 单线程 + Asyncify 做不到任意指令刺入。UniSim 采用 **Poll 模型**：

- JS 侧检测到 GPIO 边沿后**只写 pending 队列**，绝不回调 Wasm；
- C 在确定的 dispatch 点主动拉取并执行 ISR；
- 因此 ISR 延迟是 **O(一个调度 tick / yield 点)**，不是微秒级，也不可验优先级嵌套（C4.3，真机/HIL 兜底）。

**最坏延迟数值（诚实上限）**：协作 Poll 下，未处于临界区时，GPIO 边沿从入队到 ISR 执行的 worst-case 约为 **一个调度 tick**。系统默认 `WINK_RUNTIME_TICK_MS = 10`（`wink-micro-os/pal/include/wink_status.h`）→ **约 10ms** 量级（可经 `wink_app.json`/codegen 配置，但**不是**微秒级硬实时）。临界区内边沿还会再推迟到最外层 `pal_irq_restore`。详见 §8。

dispatch 点有两个（最终都走同一入口）：

1. **调度器 Phase 0**：`pal_sim_scheduler_run` 每 tick 开头在 main 上下文调用 `pal_wasm_dispatch_pending_interrupts()`；
2. **临界区解锁补发**：`pal_irq_restore()` 最外层 unlock（`s_irq_lock_nest_count` 从 1→0）时调用同一入口，保证临界区内累积的 pending 在开中断瞬间立刻兑现（匹配 ESP32 "开中断瞬间 pending IRQ 立刻派发"语义）。

---

## 2. 两条 IRQ 源与统一 drain 顺序

`pal_irq_wasm.c` 维护两个 FIFO，统一入口 drain，顺序固定为**外部 IRQ → 软中断**：

```text
scheduler Phase 0 / pal_irq_restore 最外层 unlock
        │
        ▼
pal_wasm_dispatch_pending_interrupts()
        ├─ 持有 IRQ 锁？→ 直接返回（推迟到 unlock）
        ├─ while js_pal_poll_interrupt(&cb,&arg):   // drain JS InterruptQueue（GPIO 边沿）
        │     ISR(callback_index → 函数指针, arg)
        └─ pal_wasm_dispatch_pending_irqs()         // 级联 drain C 软中断 FIFO
              while sw_dequeue(&irq_num):
                if handler != NULL: ISR(handler, arg)
```

| IRQ 源 | 入队 | 队列 | 溢出策略 |
|---|---|---|---|
| GPIO 边沿（PinArbiter 检测） | JS `InterruptQueue`（FIFO） | JS 侧 | **drop-newest**（边沿是 event-like 离散脉冲，丢新保因果序列） |
| `pal_irq_set_pending()` 软中断 | C `s_pending_queue[]`（环形，`WASM_MAX_PENDING=64`） | C 侧 | **drop-oldest**（软中断 level-like，最新 pending 代表当前需服务状态） |

- 派发时若发现 handler 已被 `pal_irq_disable` 置 NULL，该条目静默丢弃——这就是 `pal_irq_clear_pending` 的实际语义（FIFO 不支持中间删除）。
- `s_pending_overflow_count` 单调累计 C 队列溢出次数，供诊断"WASM_MAX_PENDING 是否需调大"。
- 派发期间用 `pal_os_set_sim_isr_context(true/false)` 标记 ISR 上下文（供 FromISR 误用检测，见 §5）。

---

## 3. 注册表与 Wasm Table 路由

物理 MCU 用中断向量表（函数指针）路由 ISR；Wasm 禁止 JS 跳转到任意内部地址，故用 Wasm Table 索引：

- `pal_gpio_enable_interrupt_ex(pin, intr_type, prio, callback, arg)` 把 `(uint32_t)(uintptr_t)callback` 与 `arg_ptr` 通过 `js_pal_register_interrupt(pin, callback_index, arg_ptr)` 注册到 JS（只存映射，不回调）；
- `js_pal_poll_interrupt(out_callback_index, out_arg_ptr)` 每次从 JS FIFO 取一个 pending，C 把 index 还原为 `pal_gpio_isr_t` 调用；
- `pal_gpio_disable_interrupt` → `js_pal_deregister_interrupt`。

**索引安全**：

- `callback_index` 是不透明 Table 索引，禁止边界外裸 cast；长期用 Emscripten `addFunction` 替代裸 cast；
- 当前 wasm32 用 `(uint32_t)(uintptr_t)` 截断；`pal_irq_wasm.c` 有 `_Static_assert(sizeof(void*)==4)`——开 wasm64 时此断言立刻红，迁移须同步改 ABI #5、JS `writeU32LE→writeU64LE` BigInt 化、去掉截断（见 [10 ABI #5](./10-wasm-js-bridge-abi.md)）。
- GPIO service 首次锁定优先级 `s_gpio_service_prio`（v2.2 G3）：WASM 单线程无需 mutex，一旦锁定生命周期内不再释放；prio 冲突返回 `WINK_ERR_INVALID_ARG`。
- 引脚上限 `WASM_MAX_GPIO_PIN=50`；逻辑中断表 `WASM_MAX_IRQ=32`。

---

## 4. 临界区与嵌套计数

单一 IRQ 锁 `s_irq_lock_nest_count`（GPIO/软中断共用），支持嵌套：

```c
uint32_t pal_irq_save(void) {
    uint32_t was_enabled = (nest == 0) ? 1 : 0;
    nest++;
    return was_enabled;
}
void pal_irq_restore(uint32_t mask) {
    if (nest > 0) {
        nest--;
        if (nest == 0 && mask) {
            pal_wasm_dispatch_pending_interrupts();  // 最外层 unlock 补发
        }
    }
}
```

- `pal_irq_save_rtos_safe()` 在 WASM 单线程下与全屏蔽一致（真机才区分优先级屏蔽）；
- 派发入口开头检查锁：持锁期间直接返回，JS 条目留在 JS 侧，下次 drain 自然拿到；
- 这保证临界区内 pending 不被派发，但**不等价于**真机关全局中断的所有副作用（C4.1 边界）。

---

## 5. FromISR / ISR 安全规则（C4.4、C20.1）

- 仿真提供 `pal_os_set_sim_isr_context` 标记，可在 ISR 内调用阻塞/取锁 API 时检测并 Fault；
- ISR 内禁止调用会 yield 的 DAL（如阻塞读传感器）→ 重入/死锁；
- 规则靠：**A** lint/API 属性（ISR-safe 白名单）+ **C** ISR 上下文调用非安全 API → Fault；
- 第三方闭源回调需人工标注。

`synchronize` 类 API 在 WASM 单线程下是 no-op（disable 返回即保证无 ISR 在执行），仅做参数校验。

---

## 6. 队列容量与 Fail-Loud

- JS pending 队列容量由 `PAL_WASM_INTERRUPT_QUEUE_SIZE`（默认 **16**，`pal_wasm_internal.h`）控制，JS `InterruptQueue` 的 `MAX_PENDING`/`INTERRUPT_QUEUE_CAPACITY` 必须一致（跨仓契约）；
- 可构建期 `target_compile_definitions(... PAL_WASM_INTERRUPT_QUEUE_SIZE=32)` 覆盖；
- **C4.5 要求**：队列满不得静默吞。GPIO 边沿队列溢出须可观测（计数/Fault，不允许假装已处理）；C 软中断队列满为 drop-oldest + `overflow_count` 单调累计。

跨仓验证清单（原 01 §4.5）：

1. `wasm-objdump -x | grep trigger` 无 `_trigger_wasm_interrupt`（Push 模型已永久移除）；
2. sleep 期间 GPIO 事件只入队；
3. wake 后、下次 delay 前 drain FIFO；
4. 无 `RuntimeError: invalid Asyncify state`/abort/栈损坏；
5. 1000 ticks × 4 中断 = ISR 计数匹配（无溢出）；
6. 溢出告警，不静默丢失/崩溃。

---

## 7. 与真机的对称性（ADR-0002）

| | ESP32 | Wasm 仿真 |
|---|---|---|
| 中断延后机制 | ISR 发 FreeRTOS Queue，Bottom-Half task 消费 | JS 写 pending，C 在 tick/yield 边界 drain |
| 派发时机 | 开中断/中断退出即刻 | Phase 0 / `irq_restore` 最外层 unlock |
| 优先级 | NVIC 嵌套 | 单级，不嵌套（边界） |
| 临界区 | 关中断 | nest count + 推迟派发 |

两者都把"中断顶半部"与"任务级消费"解耦，App 层 API 同源。

## 8. 不可验边界（务必诚实）

- ❌ 优先级嵌套 / 高优先级 ISR 抢占低优先级 ISR（C4.3，Phase 4+ 或真机）；
- ❌ 任意指令间刺入（baseline 只在 yield/poll 点插 ISR，C3.2/C4.2）；
- ❌ **微秒级中断延迟**：默认 tick ≈ **10ms**（`WINK_RUNTIME_TICK_MS`）；不得用仿真证明硬实时 IRQ 延迟；
- ❌ 下列器件类在 **`timing` Accuracy Mode 下不得主张「中断/字节时序高一致」**（须 HIL 或降为 behavioral / 改通道模型）：
  - 高波特异步 UART RX（例 115200 ≈ 87µs/字节 ≪ 10ms tick）；
  - 依赖紧周期边沿/多字节帧间隔的协议从机；
  - 任何假设「边沿后 µs 内必进 ISR」的 DAL 状态机；
- 🟡 单级"临界区外可插入"已支持，但不是真抢占；
- 🟡 与 `wakeup_by_time` / Pin Event：[ADR-0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md)（调度总序 **Landed**；跨源 bit-exact 反测 **Planned**）→ [`03` §3.1](./03-scheduler-and-concurrency.md)。

> 产品门禁与证据效力全文见 [`11-accuracy-observation-lifecycle.md`](./11-accuracy-observation-lifecycle.md)；UART 模型边界见 [`08-channel-routing.md`](./08-channel-routing.md)。


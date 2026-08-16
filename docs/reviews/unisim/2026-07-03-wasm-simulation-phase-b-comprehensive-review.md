# 2026-07-03 Wasm 仿真子系统 Phase B 综合评审记录

| 项 | 内容 |
|----|------|
| 评审日期 | 2026-07-03 |
| 评审范围 | Phase B `@wink-ai/unisim` 仿真层全栈代码：<br>• C 侧 Wasm PAL/HAL/调度器（`wink-micro-os/targets/wasm/`、`targets/common/src/wink_sim_scheduler.c`）<br>• JS/TS 侧宿主桥接（`../../../../wink-ai/packages/unisim/src/unisim/` 下 `bridge/`、`core/`、`worker/`）<br>• 编译链配置（`wink-micro-os/CMakeLists.txt` Wasm link flags、`wink_sim_js.js` 库、`wink_sim_stub.js` Node 烟测）<br>• 测试基础设施（`nodeSmoke.test.ts`、`ssotAlignment.test.ts`、C 侧 host 调度器单测、`wink_sim_stub.js` worker-thread 烟测） |
| 评审触发 | 外部评审文档（Antigravity IDE 自动生成）+ Phase B 已合入 master，需对照代码与已 Accepted ADR 做二次审阅 |
| 关联 ADR | [ADR-0002](../../decisions/unisim/0002-dual-target-compilation.md)（双 target 同源编译）<br>[ADR-0003](../../decisions/unisim/0003-simulation-fidelity-boundary.md)（行为级保真边界）<br>[ADR-0013](../../decisions/unisim/0013-sim-cooperative-scheduler.md)（协作式确定性调度器）<br>[ADR-0014](../../decisions/unisim/0014-sim-single-virtual-core.md)（单虚拟核、非抢占）<br>[ADR-0018](../../decisions/core/0018-pal-irq-api-narrowing.md)（PAL IRQ 3 级收窄）<br>[ADR-0019](../../decisions/unisim/0019-wasm-imports-override-and-asyncify-syntax.md)（Wasm import wrapper 模式 + `__async:'auto'`） |
| 关联设计规范 | [04-wasm-simulation/01-wasm-sandbox-lifecycle.md](../../design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md)<br>[04-wasm-simulation/07-scheduler-model.md](../../design/04-wasm-simulation/archive/07-scheduler-model.md) |
| 关联实施计划 | [2026-07-03-frontend-simulation-phase-b-plan.md](../../implementation-plans/frontend/2026-07-03-frontend-simulation-phase-b-plan.md)<br>[2026-07-02-sim-cooperative-scheduler-fixup-plan.md](../../implementation-plans/unisim/2026-07-02-sim-cooperative-scheduler-fixup-plan.md) |
| 关联技术债记录 | [phase-c-inherited-debt.md](../../tech-designs/core/phase-c-inherited-debt.md) |
| 评审员 | Claude Code（架构师角色，对照真实代码核验外部评审意见） |
| 评审结论 | ✅ **PASS WITH DEBT**——Phase B 整体质量极高，核心设计决策（Poll 模型中断、Asyncify `'auto'` 修正、双时钟锁步、VirtualClock 重置拒签、SSOT 自动化对齐）全部落地正确。<br><br>发现 **4 项 P0 集成期问题**（其中 2 项为外部评审完全遗漏的架构级一致性缺陷）、**8 项 P1 防御深度与可观测性改进**、**7 项 P2 清理与增强项**，均不阻塞 master 合入但应纳入 Phase C 排程。外部评审中的 1 项建议（多线程/SharedArrayBuffer 前向兼容）因与 ADR-0014 冲突，建议**明确拒绝**。 |

---

## 一、外部评审文档准确性核验

外部评审文档（Antigravity IDE 生成的 `wasm_simulation_code_review.md`）质量相当高，作者兼具嵌入式 RTOS 直觉与现代 JS/Wasm 工程经验。经逐行对照代码核验，结论如下。

### 1.1 完全准确的判断（无需重复论证）

| # | 外部评审结论 | 代码核验 |
|---|---|---|
| 1 | Asyncify Poll 模型（方案 C）消除 Push 模型的 D1 重入崩溃路径 | ✅ `wink-micro-os/targets/wasm/pal_osal_wasm.c:240` 仅在调度器 Phase 0 调 `js_pal_poll_interrupt`；旧 `_trigger_wasm_interrupt` 导出已移除（`pal_hal_wasm.c` 文件头注释与 `wasm_entry.c` 交叉验证） |
| 2 | ADR-0019 Wrapper 模式 + `__async:'auto'` 修正 emcc 6.x 兼容问题 | ✅ `wink_sim_js.js:86-95` 两个 async descriptor 用字符串 `'auto'`；每个 `js_*` 都有 `if (Module.js_xxx) return Module.js_xxx(...)` wrapper；`wink_sim_stub.js` 含真实 wall-delta 断言验证 Asyncify 确实挂起 |
| 3 | Heap-Growth 防护——每次跨界写前重新获取 `Uint8Array` 视图 | ✅ `createUnisimImports.ts:78/88/104` 每次操作都调 `memoryView()`；88 行在 transfer 后特意重新获取（`freshView`）；文件头 16-21 行明确注释"never cached"契约 |
| 4 | VirtualClock 使用 BigInt 表达 64 位虚拟时间 | ✅ `VirtualClock.ts` 全部时钟状态、`wakeAt`、`advance()` 参数、`sleepUs()` 参数均为 `bigint`；`STEP_CLOCK` handler 有运行时 `typeof msg.us !== 'bigint'` 防御 |
| 5 | `sleepUs(0n)` 被钳位到 `delta = 1n`，防止 zero-tick pump | ✅ `VirtualClock.ts:112` `const delta = us > 0n ? us : 1n;` |
| 6 | `reset()` 对所有 pending Promise 执行 `reject(VirtualClockResetError)` 防 zombie | ✅ `VirtualClock.ts:124-130` |
| 7 | Single-tick-per-sync-block 调用规约 | ✅ `VirtualClock.ts:51-61` doxygen 明确声明 |
| 8 | `>>>` 无符号右移防御 C 侧 `(uint32_t)-1` 跨界为 `-1` 致 BigInt 转换 `RangeError` | ✅ `createUnisimImports.ts` 中 `ms >>> 0`、`us >>> 0` |
| 9 | C 侧静态变量依赖 BSS 零初始化，符合 C11 | ✅ `pal_wasm_physical.c` 全部 BSS 无显式 `memset` |
| 10 | `pal_wasm_get_debounce_ctx` 等接口带 `if (pin >= WASM_SIM_MAX_PINS) return NULL;` 越界检查 | ✅ `pal_wasm_physical.c` 各 accessor 都有边界检查 |
| 11 | SSOT 对齐测试（`ssotAlignment.test.ts`）静态解析 `wasm_bridge.h` 与 TS 接口 diff | ✅ `../../../../wink-ai/packages/unisim/src/unisim/__tests__/ssotAlignment.test.ts` 存在并 green |
| 12 | Phase B 六项延期债务（PWM→PinArbiter、GPIO INPUT 释放、中断溢出 drop-oldest、I2C marshalling 测试缺口、wasm64 指针宽度、`js_pal_os_get_ms/us` 死桩） | ✅ 全部与 `phase-c-inherited-debt.md` 一致，代码核实准确（详见 §三） |

### 1.2 外部评审未识别/误判的项（本次评审新增发现）

| # | 问题 | 严重度 | 外部评审状态 |
|---|---|---|---|
| A | 两套 IRQ 分发机制并存，且 JS Poll 路径不尊重 `pal_irq_save/restore` 临界区语义 | 🔴 P0 | **完全遗漏**——评审只提了溢出策略，未发现 Mechanism A/B 双轨问题 |
| B | `bridge/` 注入层与 `worker/` 驱动层尚未集成（两套平行代码，PinArbiter 零生产 caller） | 🔴 P0 | **完全遗漏**——评审把它们当成一个完整系统 |
| C | Host→C fault 注入入口缺失（无 `pal_wasm_host_fault` 导出），用户 JS 桩抛错会打挂整个 wasm instance | 🔴 P0 | 方向提到（§四.3）但误称存在 `_wink_runtime_fault_from_host`——经核实该符号**不存在** |
| D | `WasmPhysicalBridge.i2cTransfer` 读缓冲未回填（功能缺口，不只是测试缺口） | 🔴 P0 | 评审只识别了测试覆盖缺口，未识别功能缺失 |
| E | Re-entrancy Guard 建议部分错位——当前单 Worker 模型下 Asyncify 挂起期间实际无入口触发重入 | 🟡 P1 | 建议本身可做但风险评估被夸大 |
| F | memoryView 缓存化建议过度夸大 GC 压力；且决定权在宿主 deps 注入层 | 🟡 P1 | 方向可做但成本收益比被高估 |
| G | 多线程/SharedArrayBuffer/Atomics 前向兼容建议与 ADR-0014 直接冲突（GitHub Pages 禁用 COOP/COEP） | 🟢 不做 | 建议违反已 Accepted 决策 |
| H | Asyncify 栈审计建议仅提 `ASYNCIFY_ADVISE`，该选项是编译期静态分析不报告运行时高水位 | 🟡 P1 | 方向正确但落地方案需补充 |
| I | `VirtualClock.advance()` 单同步块规约仅有注释无 dev-mode 运行时强制 | 🟡 P1 | **完全遗漏** |
| J | `InterruptQueue` overflow warn 是 once-per-instance 永久静默（不是 rate-limit）；warn 中 `pin=` 字段指新来的 pin 而非被丢弃的，误导排障 | 🟡 P1 | 评审只提 drop-oldest 不合理 |
| K | 旧 Mechanism A 的 `pal_wasm_gpio_level_changed` 已无任何 caller（dead code） | 🟢 P2 | **完全遗漏** |
| L | `PinArbiter.setDriver` 在生产代码中仅被 `js_pal_gpio_write` 调用一次；`removeDriver` **零生产 caller** | 🟢 P2 | 评审正确指出 GPIO INPUT 未释放 driver，但未量化调用图现状 |

---

## 二、核心架构亮点（经代码核实的设计优势）

本节不再重复外部评审已准确识别的亮点，只补充外部评审未充分展开的**关键设计纪律**。

### 2.1 C 侧"虚拟时钟只进不退、C 不得自推进"红线被严格遵守

`wink-micro-os/targets/wasm/pal_osal_wasm.c:9-13` 文件头明确：

> C 侧严禁在 sleep 函数内推进 `s_virtual_us`；仅 JS Worker 可通过 `pal_wasm_advance_virtual_clock(bigint)` 推进。

经代码核实：
- `pal_os_sleep_ms`（97-112 行）走 `sim_scheduler_yield_timed` + fiber switch，**不触碰** `s_virtual_us`
- `pal_os_get_us/ms`（67-70 行）是 `s_virtual_us` 的**直接内存读**，零 JS 调用（这也解释了 `js_pal_os_get_ms/us` 为何是死桩）
- 调度器 Phase 3 idle-sleep（269 行）通过 `js_pal_os_sleep_ms(sleep_ms)` 让出给 JS，Promise resolve 由 JS 侧 `advanceClock` + `clock.advance` 配对推进时钟

这保证了**虚拟时钟单调性完全由宿主 tick 循环控制**——C 侧代码无法制造时间回退或自激推进，是确定性仿真的基础。

### 2.2 调度器主循环四阶段结构清晰，职责正交

`pal_sim_scheduler_run` 在 `pal_osal_wasm.c:218-297` 的骨架：

| 阶段 | 行 | 动作 | 关键约束 |
|---|---|---|---|
| Phase 0 | 240 | `pal_wasm_dispatch_pending_interrupts()` 拉取 JS 侧 IRQ | 在 switch back to main 后、任何任务运行前 drain |
| Phase 1 | 243 | `sim_scheduler_gc_zombies()` 回收 TERMINATED fiber | 三阶段自删除 GC 的最后一步 |
| Term-check | 246-254 | 检测 main_task TERMINATED 或 max_ticks 耗尽 | 正常退出路径 |
| Phase 2 | 257-258 | `sim_scheduler_wakeup_by_time(now)` 唤醒到期 WAITING 任务 | 纯函数决策 |
| Phase 3 | 261-272 | `sim_scheduler_pick_next()`；无 READY 则计算 `sleep_ms` 调 `js_pal_os_sleep_ms` | idle 时 Asyncify 挂起 |
| Phase 4 | 275-290 | `sim_ctx_switch(main → t)`，前后用 `wasm_wall_clock_us()` 测 host wall-time；超阈值 → `wink_runtime_fault(callbacks, 8002)` | WCET 用 wall-clock（非虚拟时钟），防 fiber 饿死宿主线程 |

**关键纪律**：WCET 测量**故意使用物理挂钟**而非虚拟时钟（见 210-216 行注释）。这是正确的——WCET 防卫的是"AI 生成的 C 代码写了个 100ms 的 busy loop 把浏览器 UI 卡死"，是宿主友好性约束，不是时序保真约束。

### 2.3 Emscripten fiber 包装的栈对齐与自删除 trampoline

`sim_ctx_emscripten_fiber.c`（经探索报告）：
- Fiber 数据栈 16 字节对齐（Emscripten fiber ABI 要求）
- Asyncify 栈独立分配（最小 2KB，`sim_scheduler_register` 有 clamp+warn）
- Trampoline 在任务函数返回后**自动**调 `pal_os_task_delete(NULL)` 标记 ZOMBIE，避免用户代码忘记自删除

配合 `sim_scheduler_gc_zombies`（三阶段：标记 ZOMBIE → switch to main → main 循环 destroy），做到了"无论任务是 self-exit、被 kill、还是 main 返回，都能安全回收"，无 UAF 路径。

### 2.4 Worker 隔离 + postMessage 驱动的单线程消息规约

- `wink_sim_js.js:68-72` 文件头明确："Node 主线程直接 require 本胶水会让 Asyncify unwind→rewind 循环 starve 掉外部 setTimeout；Workbench 前端同理应把 wasm 关进 Web Worker"
- `SimWorker.ts` 的 `handleMessage` 外层（133-166 行）有统一 try/catch，**永远返回恰好一个响应**（Ok 或 Err），不会因未识别命令抛未捕获异常打挂 Worker
- `STEP_CLOCK` handler 配对调用 `bridge.advanceClock(us)` + `clock.advance(us)`，确保 wasm 侧 `s_virtual_us` 与 JS 侧 VirtualClock 镜像**始终在同一消息处理内原子推进**——防止跨 postMessage 时序错位

### 2.5 类型边界 SSOT 双层守护

- **静态层**：`ssotAlignment.test.ts` 解析 `wasm_bridge.h` 的 `extern` 声明，diff 对 `keyof WasmImports/Exports`——任何一侧增减符号未同步另一侧，CI 立刻红
- **运行时层**：`wink_sim_stub.js` 静态解析 `.wasm` 二进制的 import section，diff 对 SSOT 符号集——防止 DCE、误编、或链接错误导致实际导入集合偏离头文件声明
- **ABI 层**：`wasm_bridge.h:74-119` "ABI 契约"附录逐条规定 bigint 转换、out-pointer 写入、指针宽度、指针生命周期（caller-owned/callee-owned）、Asyncify 禁止事项

三层守护显著降低了 C/JS 跨界漂移风险——在一个 C 与 TS 跨语言迭代速度差异很大的项目里，这是极其重要的工程纪律。

---

## 三、🔴 P0 问题（Phase C 早期必须解决）

### P0-1：两套 IRQ 分发机制并存且语义不一致

**位置**：`wink-micro-os/targets/wasm/pal_hal_wasm.c`

**现象**：同一个编译单元内存在两套独立的 IRQ 队列与分发路径：

**Mechanism A（旧，遗留内部队列）**
- 数据：`static wasm_pending_irq_t s_pending_queue[WASM_MAX_PENDING=64]`（`pal_hal_wasm.c:120`）
- 分发函数：`pal_wasm_dispatch_pending_irqs()`（271-309 行）——注意名字是复数"`_irqs`"
- **尊重**临界区：276-278 行 `if (s_irq_lock_nest_count > 0) return;`
- 触发点：`pal_irq_restore()`（388-399 行）最外层 unlock 时调用
- 生产端：`pal_wasm_gpio_level_changed()`（223 行）——**grep 全仓零 caller（仅文档提及）**；`pal_irq_set_pending()`（343 行）逻辑 IRQ 注入入口

**Mechanism B（新，Poll 模型/方案 C）**
- 数据：JS 侧 `InterruptQueue`（16 深度 FIFO，`../../../../wink-ai/packages/unisim/src/unisim/bridge/InterruptQueue.ts`）
- 分发函数：`pal_wasm_dispatch_pending_interrupts()`（410-420 行）——注意名字是复数"`_interrupts`"
- **不尊重**临界区：410-420 行整段无任何 `s_irq_lock_nest_count` 检查
- 触发点：`pal_sim_scheduler_run` Phase 0（`pal_osal_wasm.c:240`）每个 tick 开头**无条件**调用
- 生产端：JS 侧 PinArbiter→InterruptQueue 标准路径

**具体风险**：
1. **临界区穿越**：若某段 C 代码持有 `pal_irq_save()` 获得的锁（`s_irq_lock_nest_count > 0`），且此时发生 scheduler tick（协作式调度下 switch 回 main 上下文），Phase 0 的 `pal_wasm_dispatch_pending_interrupts()` 会无视锁深度直接 drain JS 队列并回调 ISR。虽然当前协作式模型下"任务持有锁期间 switch 回 main"只能发生在任务主动 `pal_os_sleep_ms`/`pal_os_yield` 时（任务不会在持有 IRQ 锁期间 sleep，这是常识），但：
   - `pal_osal_wasm.c` Phase 0 的位置是"main 调度器上下文"，此时**没有任务在运行**，`s_irq_lock_nest_count` 通常为 0——这减轻了问题但不消灭它
   - `pal_irq_save/restore` 是可以在 ISR 上下文嵌套使用的（ADR-0016 任务/ISR 双入口临界区），未来若 ISR 内也触发调度（当前不会），立即踩雷
2. **双轨维护成本**：两个分发器、两个队列、两套优先级/排序语义（Mechanism A 有 Pareto 尾延迟目标 tick 排序，Mechanism B 是纯 FIFO），任何 IRQ 相关改动都要同步两边，回归风险高
3. **Dead code 混淆**：`pal_wasm_gpio_level_changed()` 无 caller，`s_pending_queue` GPIO 路径实际永不入队——但代码仍被编译链接，读代码的人会以为它在工作

**建议（Phase C 早期）**：
1. **删除 Mechanism A 的 GPIO 路径**：移除 `s_pending_queue`、`pal_wasm_gpio_level_changed()`、`pal_wasm_dispatch_pending_irqs()` 中 GPIO 相关逻辑。
2. **评估 Mechanism A 的逻辑 IRQ 路径去留**：`pal_irq_set_pending()` 若仅为内部软件 IRQ（如定时器回调）使用，应重定向到同一 Poll 队列（JS 侧或统一 C 侧 FIFO）；若未使用则一并删除。
3. **给 Mechanism B 加 IRQ 锁检查并支持即时补发**：在 `pal_wasm_dispatch_pending_interrupts()` 开头加上 `s_irq_lock_nest_count` 的安全检查。
   ```c
   if (s_irq_lock_nest_count > 0) return;  // 持有 IRQ 锁时延迟到下次 tick 或 restore
   ```
   并在 `pal_irq_restore()` 最外层 unlock（`s_irq_lock_nest_count == 0 && mask`）时，**不仅**调用原有的 `pal_wasm_dispatch_pending_irqs()`，也**必须同步调用** `pal_wasm_dispatch_pending_interrupts()`。这能确保在临界区内被延迟的中断在锁恢复的瞬间被**立刻补发分发**，而不是被拖延到下一次调度器的 tick，保证高保真临界区响应时序。
4. **统一化方向建议 (Unified Queue)**：长远来看，建议将 JS 侧的 Poll 接口作为 C 侧底层统一 pending 队列的唯一“物理数据输入源”，将拉取的中断直接送入 C 侧的中断管理器进行分发排序，以此消除双轨分发器，保持 C 侧对临界区与优先级的绝对控制。
5. **加测试**：C 侧 host 单测加一个"IRQ save 期间 JS 入队 ISR，restore 后立即兑现"的用例。

---

### P0-2：`bridge/` 注入层与 `worker/` 驱动层尚未集成

**位置**：`../../../../wink-ai/packages/unisim/src/unisim/`

**现象**：`../../../../wink-ai/packages/unisim/src/unisim/` 下有两套几乎平行的子系统，分别可独立运行但彼此**零引用**：

| 子系统 | 路径 | 核心成员 | 是否被谁调用 |
|---|---|---|---|
| **注入层（ADR-0019 wrapper 消费端）** | `bridge/` | `createUnisimImports`、`installUnisimBridge`、`InterruptQueue`、`I2CBus` | `bridge/__tests__/nodeSmoke.test.ts`（主线程 spread 到 Module config）；无生产 caller |
| **驱动层（Worker 消息循环）** | `worker/` | `SimWorker`、`WasmPhysicalBridge` | 为未来 Workbench 前端 Web Worker 准备的驱动骨架；当前**不导入**任何 bridge 成员 |
| **核心层** | `core/` | `VirtualClock`、`PinArbiter` | 被注入层烟测使用；驱动层只用到 `VirtualClock`，**不用 `PinArbiter`** |

**证据**：
- `SimWorker.ts` 构造函数（120-123 行）直接 `new WasmPhysicalBridge(opts.exports, opts.injectGpioIdeal)`，不经过 `createUnisimImports`/`installUnisimBridge`
- `SimWorker.ts` 的 import 块（26-32 行）只导入 `VirtualClock`、`WasmPhysicalBridge`、类型定义——**零 bridge/ 或 PinArbiter 引用**
- `STEP_CLOCK` handler（181-198 行）只 `bridge.advanceClock(us)` + `clock.advance(us)`，**不 drain InterruptQueue、不操作 PinArbiter**
- `nodeSmoke.test.ts` 直接在 Node 主线程把 imports spread 到 Emscripten Module config，绕过 Worker 模型
- `installUnisimBridge.ts`（28-35 行）存在但在整个 simulator 源码树中**零生产 caller**（仅定义，未被任何非测试代码 import）
- `pin-arbiter.ts` 的 `setDriver` 在生产代码中**仅被 `createUnisimImports.ts:65` 调用一次**（`js_pal_gpio_write` 路径）；`removeDriver` **零生产 caller**

**影响**：
- Phase B 的真实状态是"注入层 + 核心层 + Worker 驱动骨架分别完工，但尚未粘合成端到端路径"
- PinArbiter、InterruptQueue、I2CBus 这三个核心抽象目前只在单元测试 + Node smoke 中跑通，真正跑在 Web Worker 里驱动 Workbench 时**IRQ 不会被送达、GPIO 驱动状态不会被仲裁、I2C 不会走物理总线**
- PWM 未接 PinArbiter、GPIO INPUT 不释放 driver 等 Phase B 债务（外部评审识别的）症状上表现为功能缺失，根因是 PinArbiter 本身还没被挂到 Worker 路径——属于集成顺序问题

**建议（Phase C 第一个任务）**：
1. **Integration Task**：让 `SimWorker` 构造时组装完整 deps——创建 `PinArbiter`、`InterruptQueue`、`I2CBus`、`pwmSink`/`ultrasonicEchoUs` 等可选注入点，通过 `createUnisimImports` 生成 imports 对象，调用 `installUnisimBridge` 绑定到 Module
2. **`STEP_CLOCK` 职责扩展**：advanceClock 之后应（a）让 PinArbiter 处理当 tick 内的 pin 变化、（b）把边沿事件推入 InterruptQueue（C 侧 Phase 0 drain 之前 JS 侧已备好）
3. **READ_GPIO_DEGRADED**：当前 `WasmPhysicalBridge.readGpioDegraded` 只读 ideal state，集成后应从 PinArbiter.getResolvedVoltage 取仲裁后电平
4. **删除/迁移 nodeSmoke 的主线程 spread 写法**：统一走 `installUnisimBridge` 单一路径，避免两套绑定方式漂移
5. **加 Worker 层 e2e 烟测**：在 Jest 中用 worker_threads 启动 SimWorker，验证 STEP_CLOCK→GPIO 写→PinArbiter→InterruptQueue→IRQ 交付→ISR 触发全链路

---

### P0-3：Host→C fault 注入入口缺失，用户 JS 桩抛错会打挂整个 Wasm instance

**位置**：跨 C/JS 边界

**现象**：
1. 外部评审§四.3 建议 wrapper 里 try/catch 后调 `module._wink_runtime_fault_from_host(8003)`——但经 grep 全仓，`wink_runtime_fault_from_host` 这个符号**不存在**
2. C 侧 `wink_runtime_fault(const wink_app_callbacks_t *callbacks, uint32_t fault_code)`（`runtime/src/wink_runtime.c:214-220`）是内部函数，未通过 `EMSCRIPTEN_KEEPALIVE` 导出，且签名需要 `callbacks` 指针——JS 侧拿不到这个指针
3. 当前 `createUnisimImports.ts` 所有用户 override 路径都是裸调用：
   - `if (pwmSink) pwmSink(channel, duty);`（75 行）——同步 throw 会传播进 Emscripten import stub
   - `const ok = i2cBus.transfer(port, addr, writeBytes, readBuf);`（81 行）——同步 throw 同上
   - `await clock.sleep(ms >>> 0);`（112 行，在 wrapper 内的 Asyncify sleep 路径）——rejection 会被 Emscripten `handleAsync` 捕获后走 `abort()`
4. `installUnisimBridge.ts` 只是简单的属性拷贝（`module[key] = imports[key]`，33 行），不做任何异常包装
5. JS 侧能访问的 fault 相关导出只有**只读**审计环：`pal_wasm_get_fault_log_count`、`pal_wasm_fault_event_get_*`（`exports.ts:60-66`），**不能反向注入 fault**

**影响**：
- Workbench 用户在自定义 `js_i2c_transfer` 等桩里写了有 bug 的代码（访问 undefined 属性、类型错误、返回 rejected Promise），会直接进入 Emscripten 的 abort 路径，整个 wasm instance 被打死——没有机会执行 `wink_actuator_safe_off_all()` 安全关断，仿真面板只能 reload
- 嵌入式里"外设驱动故障→系统复位"是正常行为，但这里的语义是"宿主插件故障→整个仿真核 panic 且无 safe-off"——违背了 ADR-0009 Wave 2 的物理退化引擎理念（应该降级到物理模型而非 crash）

**建议（Phase C 早期）**：
1. **C 侧新增导出**（在 `pal_hal_wasm.c` 或 `pal_wasm_physical.c`）：
   ```c
   EMSCRIPTEN_KEEPALIVE
   void pal_wasm_host_fault(uint32_t code, const char* msg_cstr) {
       // 1. 将 JS 传入的消息写入 fault ring buffer
       // 2. 调用 wink_runtime_fault 走标准 fault 路径（trace + safe-off + on_fault 回调）
       //    注意：callbacks 由 runtime 内部持有或通过专用访问器取得
       wink_trace_fault(code);
       wink_actuator_safe_off_all();
       // 可选：设置 wasm 全局 g_wasm_faulted = true；后续 export 调用 fast-fail
   }
   ```
2. **C 侧新增 fault 锁存标志**：`static int g_wasm_faulted;`，每个 `pal_wasm_*` 导出入口（以及 Emscripten 自动生成的 wrapper）检查，faulted 后直接返回错误码/默认值，避免 fault 后再入 C 逻辑
3. **TS 侧统一 wrapper 工厂**：在 `createUnisimImports` 内对每个 import 包一层：
   - 同步 import：`try { return impl(...); } catch (e) { reportHostFault(8003, e); return defaultStub(); }`
   - Asyncify import：`return Promise.resolve(impl(...)).catch(e => { reportHostFault(8003, e); return defaultStubAsync(); })` 并确保 catch 路径返回一个 resolve（不要 reject 进 Asyncify）
4. **reportHostFault** 实现：把 JS 错误消息通过 `_malloc` + `stringToUTF8` 写到线性内存，调用 `pal_wasm_host_fault(code, ptr)`，然后 `_free`
5. **错误码分配**：建议 8003 = JS host fault（沿用外部评审建议）；8001 已经是 boot-after-reset，8002 是 WCET，8003 给 host plugin fault 合理

---

### P0-4：`WasmPhysicalBridge.i2cTransfer` 读缓冲未回填（功能缺口）

**位置**：`../../../../wink-ai/packages/unisim/src/unisim/worker/WasmPhysicalBridge.ts:159-188`

**现象**：当前 `i2cTransfer` 实现：
```ts
const ok = this.exports.pal_wasm_i2c_transfer(
  port, devAddr, wbufPtr, wlen, rbufPtr, readLen,
);
// We intentionally do NOT expose the read buffer back to callers here —
// Wave 2 API only asked for success/fail. Phase C will extend the DTO.
return ok;
```
返回值是 `boolean`，C 侧写入 `rbufPtr` 的数据留在 wasm 堆里，JS 调用者拿不到。

**影响**：
- 所有**读型 I2C 事务**（读 RTC 时间、读传感器 WHO_AM_I、读 ADC、读 IMU 加速度等）在物理仿真层完全不可用——模型只能返回"成功"但数据是 malloc 未初始化的堆垃圾（因为 finally 块立即 `_free(rbufPtr)`）
- 这不是测试覆盖问题，是**功能缺席**——Wave 2 只做了"写事务可验证"，读事务连 DTO 都还没设计
- 外部评审§三.4 只识别了"I2C 导出侧 `_malloc`/`HEAPU8.set`/`_free` 没被单测覆盖"，没提核心功能缺失

**建议（Phase C 早期，在集成 Task 之后立刻做）**：
1. **修改返回类型**为 `{ ok: boolean; data?: Uint8Array }`，在 `finally` 之前、ok=true 且 readLen>0 时用 `HEAPU8.slice(rbufPtr, rbufPtr + readLen)` 拷贝出读缓冲
2. **或者**：把 I2C 拆成 `i2cWrite`/`i2cRead` 两个方法，写返 boolean，读返 `Uint8Array | null`（更贴近 HAL 语义）
3. **同步扩展 `I2CBus.transfer` 接口**（`i2c.ts` 类型文件）：当前签名的 `readBuf` 是传入的 `Uint8Array`（C→JS 方向传递），需要确认 I2C 模型侧也支持回填——这是 Wave 2 就有的接口但 WasmPhysicalBridge 没接上
4. **加读路径的单元测试**（真正传一个 rawModule mock，走 _malloc/_free 路径，验证回填数据正确）
5. **注意 slice vs subarray**：必须用 `.slice()` 复制出来，因为 `_free(rbufPtr)` 后那块内存可能被后续 malloc 复用——`subarray` 返回的是 wasm 内存视图，会被踩踏

---

## 四、🟡 P1 改进项（Phase C 中期，防御深度与可观测性）

### P1-1：Asyncify 栈高水位采样（替代单纯 `ASYNCIFY_ADVISE`）

**位置**：`wink-micro-os/CMakeLists.txt:155`

**现状**：`-sASYNCIFY_STACK_SIZE=65536`（64 KB）是起步值，CMakeLists.txt 注释自承"最终须实测最深 AI 生成调用链"。`STACK_OVERFLOW_CHECK=2` 会在溢出时 abort，但不报告峰值使用量。外部评审建议开 `ASYNCIFY_ADVISE`，但这是**编译期静态分析**，只报告"哪些函数可能需要加入 ASYNCIFY_IMPORTS 但没加"，对"64KB 够不够用"这个核心问题帮助有限。

**建议**：
1. 在 `pal_sim_scheduler_run` Phase 4 `sim_ctx_switch` 返回之后，调用 Emscripten 运行时提供的 `Asyncify.getStackSize()`（需要 `-sASYNCIFY_EXPORTS=['_Asyncify_getStackMax']` 或类似链接选项暴露），采样当前 Asyncify 栈使用量，与历史最大值比较更新高水位。
2. 新增导出 `pal_wasm_get_asyncify_stack_highwatermark()` 返回 max usage。
3. **CI 自动化拦截门控**：在 Jest 集成测试 `nodeSmoke.test.ts` 中，跑完 E2E 烟测后读取此高水位值，进行断言限制：
   ```typescript
   const stackHighWater = Module._pal_wasm_get_asyncify_stack_highwatermark();
   expect(Number(stackHighWater)).toBeLessThan(65536 * 0.8); // 80% 安全限额校验，防 CI 静默越界
   ```
   这能强制保证在添加深层次嵌套 Fiber 调用链后，Wasm 的备份栈水位安全，防止发生静默的 Wasm 堆内存踩踏。
4. **运行期安全故障（可选）**：在 Wasm 运行期若采样值超过 80% 阈值，可以直接调用 `wink_runtime_fault(callbacks, 8004)`，在生产环境中提供主动报错和关断能力。
5. `ASYNCIFY_ADVISE` 可以作为 CI nightly 任务开启，但不应依赖它回答"栈够不够"。

---

### P1-2：`VirtualClock.advance()` 单同步块规约加 dev-mode 运行时强制

**位置**：`../../../../wink-ai/packages/unisim/src/unisim/core/VirtualClock.ts:51-61`

**现状**：advance() 的"每同步块仅一次，然后 yield 微任务队列"约束仅靠 doxygen 注释，无运行时检查。宿主集成期（P0-2 接 SimWorker 时）如果有人在同一个 STEP_CLOCK handler 里调两次 advance（例如先推进时钟唤醒 sleep 再处理 microtask 再推进），会导致同一同步块内 pending sleep 被二次 flush，产生虚拟时间因果倒置。

**建议**：
```ts
// DEBUG-only re-entry guard
private _advancing = false;

advance(us: bigint): void {
  if (us < 0n) throw new RangeError(...);
  if (process?.env?.NODE_ENV === 'development' && this._advancing) {
    throw new Error(
      '[VirtualClock] advance() re-entered in same sync block; ' +
      'yield microtask queue (await Promise.resolve()) before next advance()',
    );
  }
  this._advancing = true;
  try {
    this.us += us;
    // ... existing flush+sort+resolve logic ...
  } finally {
    // 注册微任务，在当前宏任务的所有微任务执行完毕后（微任务队列排空），清空重入状态位
    queueMicrotask(() => { this._advancing = false; });
  }
}
```
- **微任务延迟解锁**：利用 `queueMicrotask` 机制，可以在同一个同步调用栈（或宏任务）内多次调用 `advance` 时直接抛错，但又能在其后的 microtask 完成后自动清零，解锁下一次推进。
- 用 `NODE_ENV === 'development'` 守卫，生产构建可通过 bundler tree-shake 消除成本。
- `STEP_CLOCK` 是 postMessage macrotask，天然满足"一次 STEP_CLOCK 调一次 advance"——guard 会 catch 掉误用。

---

### P1-3：InterruptQueue overflow 策略改进（drop-newest + rate-limit warn + 存 pin）

**位置**：`../../../../wink-ai/packages/unisim/src/unisim/bridge/InterruptQueue.ts:44-55`

**现状**：
- 溢出策略：`this.queue.shift()` 丢最老
- Warn：once-per-instance 永久静默（`overflowWarned` 布尔锁存）
- Warn 消息的 `pin=` 字段打印的是**新来的**中断的引脚（参数 `pin`），不是被丢弃的那个——`queue.shift()` 返回的 dropped 元组只有 `cbIdx/argPtr`，没有 pin 信息（队列元素里压根没存 pin）

**问题**：
- 嵌入式场景下，中断队列溢出时"丢最新"通常比"丢最老"安全——最老的中断可能是状态机转移关键事件（引脚上的起始条件 edge），最新的往往是高频抖动 spurious edges。这也是外部评审§三.3 的建议
- 永久静默的 warn 让系统进入"中断风暴"状态后用户毫无感知——首次 warn 之后所有丢中断都沉默
- 误导性的 pin 字段让排障者以为是"新来的那个引脚风暴"，其实风暴源可能是被丢的那个引脚

**建议**：
1. **改策略为 drop-newest**（即直接 return 不 push，或 `this.queue.pop()` 保留最老）
2. **队列元素加 `pin` 字段**，warn 时打印：被丢弃的中断的 pin、cbIdx、当前队列深度
3. **改 once-per-instance 为 rate-limited**：每 N 次（如每 1000 次 enqueue）打印一次聚合统计（"自上次 warn 以来共丢弃 X 次"），或者基于时间窗口（每 1s 最多一次 warn）
4. **考虑加溢出计数器** `overflowCount` 暴露给 bridge，方便 UI 侧做"中断风暴"告警指示
5. **可配置策略**：构造函数 options 接受 `overflowPolicy: 'drop-oldest' | 'drop-newest'` 默认 `'drop-newest'`；某些需要"最新值优先"的电平类中断可保留 drop-oldest 选项

---

### P1-4：Re-entrancy Guard 收窄为 fault-latch 快速失败（评审建议部分错位修正）

**位置**：外部评审§四.2 建议在 `WasmPhysicalBridge` 加 `isWasmYielded` 标志

**分析**：外部评审的风险评估部分夸大了当前威胁面：
1. 当前 Worker 模型下，Asyncify 挂起发生在 `js_pal_os_sleep_ms` 返回 Promise 时，unwind 后控制权回到 JS 的 postMessage 处理循环。在 Promise resolve 之前（即 `clock.advance()` 调用 `p.resolve()` 之前），**没有任何宏任务/微任务会再次进入 wasm**——因为 `STEP_CLOCK` handler 是同步的，不中途 yield event loop
2. 真正的 re-entrancy 窗口有两个：(a) 用户自定义 JS 桩返回了非 Promise 值（同步返回）——这已被 `wink_sim_js.js` 文件头注释警告会触发 Asyncify unwind→rewind 死循环；(b) 用户在自定义桩里发起异步操作（setTimeout/fetch/Microtask），然后在那个异步回调里直接调 `bridge.exports.*`——这是用户 misuse，但确实可能
3. 自行维护 `isWasmYielded` 容易和 Emscripten 内部 Asyncify 状态机不同步（Asyncify 有自己的 state：normal/unwinding/rewinding）

**建议（收窄后的方案）**：
1. **不做** P0 级 re-entrancy guard——当前架构无此迫切需求
2. **做** fault-latch fast-fail（配合 P0-3 的 `g_wasm_faulted` 标志）：一旦 wasm 进入 faulted 状态（host fault、WCET fault、boot fault），bridge 上所有方法调用应 throw 或 return 默认值，禁止再入 C
3. **文档强化**：在 `wasm_bridge.h` ABI 契约 #6（Asyncify sleeping 期间禁调 export）追加一段："用户自定义 js_* override 若返回 Promise，resolve 前不得调用任何 pal_wasm_* 导出"——把约束写进契约层
4. **可选（P2）**：如确实出现用户 misuse 案例，可利用 Emscripten 暴露的 `Asyncify.state`（值为 0=normal/1=unwinding/2=rewinding）做运行时断言，但这依赖私有 API，不建议现在做

---

### P1-5：`pal_osal_wasm.c` 的 WCET 检测缺 debugger-bypass（契约诚实问题）

**位置**：`wink-micro-os/targets/wasm/pal_osal_wasm.c:224-231, 283-286`

**现状**：wasm 侧 WCET bypass 仅检查 `WINK_SIM_BYPASS_WCET` 环境变量，没有浏览器 devtools 断点检测分支。host 侧（`targets/host/`）有 `IsDebuggerPresent()` 分支（参见之前 2026-07-02 fixup 评审 P1-5），但 wasm 侧无法直接调用该 API。

**问题**：浏览器 devtools 断点 resume 后 `emscripten_get_now()` 会跳变（断点停留了 N 秒），立即误报 8002 WCET fault，干扰开发调试。

**建议**：
1. **检查 Emscripten 是否有 `emscripten_is_debugger_present()` 或类似 API**——若有，加和 host 对称的分支
2. **若没有**，至少在 doxygen 和 `07-scheduler-model.md` §5 明确声明"wasm 侧无 debugger 自动 bypass，浏览器下断点请通过 `WINK_SIM_BYPASS_WCET=1` 环境变量手动关闭"——这是 ADR-0012 契约诚实要求
3. **长远**：考虑检测是否在 debug build（`-sASSERTIONS=2` 或 `-g`）下自动放宽 WCET 阈值（如 debug 下 ×100 而非 ×10）

---

### P1-6：wasm 侧 `_wink_runtime_fault` 回调路径验证测试缺口（继承前序评审 P1-4）

**位置**：`wink-micro-os/test/test_sim_scheduler_wcet_fault.c`

**现状**：之前 2026-07-02 fixup 评审 P1-4 就已指出此问题——stub 只记录 fault code，不校验 `cb` 指针是否非 NULL 且指向正确的 `s_test_callbacks`，导致"pal 忘记传 callbacks"这个回归无法被测试抓到。经初步核实，该问题目前仍存在。

**建议**：本评审不再重复描述，只确认该问题在 Phase B 合入后**未被修复**，需要 Phase C 顺手收掉：stub 里加 `s_captured_cb = cb;` 存储，并加 `TEST_ASSERT_EQUAL_PTR(&s_test_callbacks, s_captured_cb);` 断言。

---

### P1-7：ADR-0013/0014/0019 设计规范回写完整性复核

**位置**：`docs/decisions/unisim/0013-sim-cooperative-scheduler.md`、`0014-*.md`、`0019-*.md` 与 `04-wasm-simulation/07-scheduler-model.md`、`01-wasm-sandbox-lifecycle.md`

**现状**：之前 2026-07-02 fixup 评审 P1-1/P1-2/P1-3 指出 ADR-0013 §3 `sim_ctx_switch(NULL, s_main_ctx)` 旧写法、WCET 单参签名、ADR-0014 引用 `03-scheduler-model.md` 坏链三个回写问题。Phase B 合入后新增的 ADR-0019（wrapper 模式 + `__async:'auto'`）需要确认其 Follow-up 是否正确回写到 `01-wasm-sandbox-lifecycle.md`。

**建议**：Phase C 启动前做一次 ADR 回写审计（跑 `python docs/decisions/scripts/list_adrs.py -s Accepted` 过一遍），确保：
1. ADR-0013/0014 之前发现的三个残留旧描述已修复
2. ADR-0019 的决策（wrapper 模式、`'auto'` 语法值）已回写到 `01-wasm-sandbox-lifecycle.md` 的"JS 胶水层"章节
3. ADR-0018（PAL IRQ 收窄）的 `pal_irq_advanced.h` 门控已回写到 `02-wink-micro-os/` PAL 章节

---

### P1-8：异常安全封装统一化（在 P0-3 fault 注入基础上的强化）

**位置**：`../../../../wink-ai/packages/unisim/src/unisim/bridge/createUnisimImports.ts`

**现状**：在 P0-3 修复后（host fault 导出+wrapper 工厂），需要确保**所有**用户可 override 的 import 都被包裹，而不仅仅是 async sleep 路径。当前裸调用点有：
- `js_pal_gpio_write`（64-71 行）中 `arbiter.setDriver(...)`——arbiter 是框架对象不应抛，但理论上 setDriver 可能抛（未来加 pin 冲突检测时）
- `js_pal_pwm_set_duty`（74-76 行）`if (pwmSink) pwmSink(channel, duty);`
- `js_pal_i2c_transfer`（78-92 行）`i2cBus.transfer(...)`
- `js_pal_poll_interrupt`（94-110 行）`interruptQueue.dequeue(...)`
- `js_pal_register_interrupt/deregister_interrupt`
- `js_sim_trigger_ultrasonic`、`js_sim_measure_echo_pulse_us`（138-143 行）`ultrasonicEchoUs?.(trigPin)`

**建议**：P0-3 的 wrapper 工厂应是**系统性的**，由一个 `safeWrap(fn, faultCode, defaultReturn)` 高阶函数统一包，避免在每个 import 体内重复 try/catch 模板代码。Async 路径用 `safeWrapAsync` 返回 Promise.resolve 不 reject。

---

## 五、🟢 P2 清理与增强项

### P2-1：删除死桩 `js_pal_os_get_ms/us`（三侧清理）

**位置**：
- `wink-micro-os/targets/wasm/wasm_bridge.h:129-130`（extern 声明）
- `wink-micro-os/targets/wasm/wink_sim_js.js:106-117`（wrapper + 默认 stub）
- `../../../../wink-ai/packages/unisim/src/unisim/bridge/createUnisimImports.ts:129-134`（TS 侧绑定）
- 连带 `../../../../wink-ai/packages/unisim/src/unisim/types/wasm/imports.ts` 的 `WasmImports` 类型

**现状**：C 侧 `pal_os_get_us/ms` 直接读 `s_virtual_us`（`pal_osal_wasm.c:67-70`），永不调用这两个 JS 导入。DCE 后 wasm 实际只导入 11 个符号（nodeSmoke 注释确认）。三个表面都留着死声明是维护噪音——每次 SSOT 测试都要在 expected list 里写这两个"声明但不导入"的例外。

**建议**：
1. 从 `wasm_bridge.h` 删除两个 extern
2. 从 `wink_sim_js.js` 删除对应 wrapper + stub
3. 从 `createUnisimImports.ts` 和 `WasmImports` 类型删除对应字段
4. 同步更新 `wink_sim_stub.js` 静态 import 检查的 expected count 从 11 改 9（或更准）
5. 同步更新 nodeSmoke `expectedActuallyImported`

注意：如果未来有"让 JS 做时间 SSOT"的需求（例如虚拟时钟需要在 JS 侧做倍率/暂停/回放），届时再重新引入更干净的接口（单一 `js_pal_advance_virtual_clock` 已经够了，不需要反向 get_ms/get_us）。

---

### P2-2：清理 `pal_hal_wasm.c` 中 Mechanism A 的 Dead Code

**现状**：`pal_wasm_gpio_level_changed()`（223 行）grep 全仓零 caller（仅历史文档引用）；`s_pending_queue` GPIO 路径永不入队。

**建议**：P0-1 处理 IRQ 双轨问题时一并删除：
- 删除 `pal_wasm_gpio_level_changed`
- 删除 `s_pending_queue` 中 GPIO 相关字段和 Pareto 排序逻辑（若逻辑 IRQ 保留则简化）
- 删除 `s_gpio_last_level` 等仅 Mechanism A 用的状态
- 在文件头注释里明确"所有 GPIO 边沿中断统一走 JS Poll 模型"

---

### P2-3：memoryView 宿主侧可选缓存化（仅在实际测量到 GC 压力时做）

**位置**：`../../../../wink-ai/packages/unisim/src/unisim/bridge/createUnisimImports.ts:16-21` 契约 + 各处调用点

**现状**：外部评审建议把 `memoryView` 改成 buffer-identity-cached 版。实际情况：
1. `memoryView` 是 **deps 注入的 thunk**——createUnisimImports 本身不决定其实现，宿主可以传缓存版
2. 实际跨边界调用频率是**外设事务级别**（一次 I2C  transfer、一次 GPIO write），不是 bit-bang 内循环——V8 Uint8Array 外壳分配极廉价（新生代小对象，Scavenge GC 成本可忽略）
3. 外部评审自己给的实现存在一个**微妙风险**：若未来加了 Web Worker + SAB（P2-7 明确不做），buffer identity 可能变化但不 detach——缓存实现要小心

**建议**：
- **不**在 `createUnisimImports` 里改——保持"每次调用 memoryView()"契约，这是最安全的默认
- 在 `installUnisimBridge` 或宿主组装层提供一个可选的 `createCachedMemoryView(module)` 工具函数，实现 buffer identity 缓存，供宿主在性能分析证明需要时选用
- 不做预期性能优化；需要时再加（YAGNI）

---

### P2-4：wasm64 指针宽度迁移债务标注强化

**位置**：
- `createUnisimImports.ts:52-57`（`writeU32LE`）
- `pal_hal_wasm.c:196-198`（`(uint32_t)(uintptr_t)` 截断）
- `wasm_bridge.h:110-119`（注释已标注 wasm64 迁移点）

**现状**：`cbIdx` 和 `argPtr` 都以 u32 写入线性内存/函数参数，wasm64 下会截断。注释有标注，但没有任何静态断言或编译期检查会在启用 wasm64 时报错。

**建议**：保持低优先级（wasm64 在 Emscripten 生态仍属实验性，GitHub Pages 等部署场景短期不会切换），但加一个 C 侧编译期断言：
```c
// 确保指针宽度与 wasm_bridge.h 契约一致
_Static_assert(sizeof(void*) == 4, "wasm64 migration required: see wasm_bridge.h ABI 注释");
```
TS 侧暂无编译期 assert 机制，可在 deps 注入层加 runtime 检查（`if (mod.HEAPU8.BYTES_PER_ELEMENT !== 1) throw ...`），但实际意义有限。

---

### P2-5：`determinism` 测试当前是同义反复（PRNG 未被使用）

**位置**：`wink-micro-os/test/test_sim_scheduler_determinism.c`

**现状**：该测试断言"相同 seed → 相同调度序列"，但当前 `pick_next` 是纯 round-robin（`sim_prng_next` 保留但未被调度决策使用），所以相同 seed→相同序列**在任何正确实现下都成立**——测试 green 但验证的是"round-robin 是确定的"这个 trivial 事实，不是 PRNG seeding 正确。

**建议**：
- 当前保留（Phase 4 chaos scheduling 上线后会消费 PRNG，到时测试自动变得有意义）
- 在测试文件头加注释说明现状，避免未来读代码的人误以为 PRNG 已被调度消费
- Phase 4 chaos scheduling 任务里应扩展此断言为"相同 seed → 相同 PRNG 序列 → 相同调度序列"、"不同 seed → 不同序列（概率性）"

---

### P2-6：PinArbiter `recursionCounters` 深度 10 断链是否足够

**位置**：`../../../../wink-ai/packages/unisim/src/unisim/core/pin-arbiter.ts:112-138`

**现状**：PinArbiter 在 pin 变化回调中用 `recursionCounters` Map 跟踪递归深度，深度 >10 时断链（避免互驱振荡——如一个 pin 变化引发另一个 pin 变化形成反馈环）。深度 10 是经验值，无理论依据。

**建议**：保留当前值，Phase C 加入物理模型后若观察到"正常组合逻辑深度 >10 被误断"再调大。考虑把 `MAX_RECURSION_DEPTH` 做成可配置参数（构造选项），方便复杂电路场景调优。

---

### P2-7：多线程/SharedArrayBuffer/Atomics 前向兼容——明确拒绝

**位置**：外部评审§四.5

**现状**：外部评审建议"为未来 Worker + SAB 多线程做 Atomics 无锁队列预留设计"。

**结论：拒绝**。理由：
1. **ADR-0014 明确拒绝 SAB/pthreads 路径**——GitHub Pages 禁用跨-origin isolation（COOP/COEP header），SAB 不可用。这是部署硬约束
2. ADR 规定"未来 SMP 仿真必须走 ADR-0015"——在 ADR-0015 打开之前为 Atomics/SAB 写抽象层是 YAGNI + over-engineering
3. 当前单线程协作式模型已覆盖 ADR-0003 定义的行为级保真边界；Causal Parity 不要求真实多核时序
4. `InterruptQueue` 保持单线程 FIFO 实现即可，不需要抽象层预演

`InterruptQueue` 目前的实现简洁、正确、足够。不要为"未来可能"的需求加抽象——等 ADR-0015 打开时重构即可，代码量很小。

---

## 六、优先级总表

### P0（Phase C 早期必须处理）

| # | 问题 | 阻塞点 |
|---|---|---|
| P0-1 | IRQ 双轨统一 + Mechanism B 尊重 `s_irq_lock_nest_count` | 临界区语义正确性 |
| P0-2 | 集成 `bridge/` 注入层与 `worker/` 驱动层（PinArbiter/InterruptQueue 接入 SimWorker） | 端到端路径断裂，PWM/GPIO/I2C Phase B 债务的根因 |
| P0-3 | Host→C fault 注入导出（`pal_wasm_host_fault`）+ 统一 wrapper 异常安全 | 用户 JS 桩抛错打挂整个 wasm 核，无 safe-off |
| P0-4 | `i2cTransfer` 读缓冲回填（返回 `{ok, data}` 或拆 i2cRead） | 读型 I2C 功能完全不可用 |

### P1（Phase C 中期，防御深度与可观测性）

| # | 问题 |
|---|---|
| P1-1 | Asyncify 栈高水位运行期采样（替代纯 ASYNCIFY_ADVISE）+ CI 安全余量断言 |
| P1-2 | VirtualClock.advance() dev-mode re-entry guard |
| P1-3 | InterruptQueue 改 drop-newest + rate-limit warn + 元素加 pin 字段 |
| P1-4 | Re-entrancy guard 收窄为 fault-latch fast-fail（不做 yielded 状态维护） |
| P1-5 | wasm 侧 WCET debugger-bypass 声明或实现（契约诚实） |
| P1-6 | WCET 测试校验 callbacks 指针非 NULL（继承前序评审 P1-4） |
| P1-7 | ADR-0013/14/19 设计规范回写完整性复核 |
| P1-8 | 所有用户 override 点统一异常包装（safeWrap/safeWrapAsync HOF） |

### P2（Phase C 末或 Phase D，清理与增强）

| # | 问题 |
|---|---|
| P2-1 | 删除 `js_pal_os_get_ms/us` 三侧死桩 |
| P2-2 | 清理 `pal_hal_wasm.c` Mechanism A GPIO 路径 dead code |
| P2-3 | memoryView 缓存化（宿主可选，实测后再做） |
| P2-4 | wasm64 指针宽度加 C 侧 `_Static_assert` 门控 |
| P2-5 | determinism 测试加注释说明当前 PRNG 未被消费 |
| P2-6 | PinArbiter 递归深度做成可配置参数 |
| P2-7 | **拒绝**多线程/SAB/Atomics 预留（违反 ADR-0014） |

### 已正确识别的 Phase B 延期债务（来自 `phase-c-inherited-debt.md`，Phase C 排程）

| # | 债务 | 与本评审的关系 |
|---|---|---|
| D1 | PWM 未接入 PinArbiter | P0-2 集成时同步解决 |
| D2 | GPIO INPUT 未 release driver（`removeDriver` 零 caller） | P0-2 集成时同步解决；需补 `js_pal_gpio_config_mode` 导入 |
| D3 | Interrupt 溢出 drop-oldest | 即 P1-3，已重新设计 |
| D4 | Fault-log ring buffer TS 侧 iterator | P1-8 fault 封装时一并做 |
| D5 | Power model 类型存在但未消费 | Wave 3 范围，本评审不展开 |
| D6 | wasm64 指针宽度 | 即 P2-4 |
| D7 | I2C export marshalling 测试缺口 | P0-4 实现读回填时补测试 |
| D8 | Dead `js_pal_os_get_*` | 即 P2-1 |

---

## 七、总体结论

**Phase B 合入质量极高**。核心架构决策——Asyncify Poll 模型消除重入（方案 C）、ADR-0019 wrapper 模式 + `__async:'auto'` 修正 emcc 6.x、BigInt 虚拟时钟双锁步、VirtualClock reset Zombie 拒签、SSOT 双层守护（静态解析 C 头 + 运行时解析 wasm import section）、三阶段 fiber 自删除 GC、WCET wall-clock 防卫（非虚拟时钟）、Worker postMessage 原子推进——全部落地正确，体现了对 Emscripten/Asyncify 运行时、嵌入式 RTOS 语义、浏览器事件循环三方面的扎实理解。

当前最主要的问题不是任何单个实现有 bug，而是**集成期自然状态**：
1. 注入层（`bridge/`）和驱动层（`worker/`）是两块独立完工的拼片，需要粘起来（P0-2）
2. 旧 IRQ 队列（Mechanism A）与新 Poll 模型（Mechanism B）未完全交接完，导致临界区语义不一致（P0-1）
3. Host→C fault 通道缺失，异常安全网未布（P0-3）
4. I2C 读路径 DTO 未做（P0-4）

这四个 P0 都是"在把碎片粘成完整系统的过程中自然会发现和修复"的问题，**不是设计事故**。建议 Phase C 启动时先做 P0-2（集成）作为"第一刀"，在组装过程中其他三个 P0 会自然暴露并解决，比现在逐点 patch 更高效。

外部评审文档的 5 条专家级优化建议中，3 条方向正确（异常封装、Asyncify 栈审计、memoryView 缓存）但需要落点调整；1 条（重入守护）风险评估被夸大需要收窄；1 条（多线程前向兼容）与已 Accepted ADR 直接冲突，建议明确拒绝。

**最终结论：PASS WITH DEBT**，按本评审 §六优先级表纳入 Phase C 排程。

---

*本评审对照 `master` 分支 commit `fdc6f9f`（docs(phase-b): add implementation plan + sandbox lifecycle update）及相关前序 commit 核验。所有代码引用行号以该版本为准。*


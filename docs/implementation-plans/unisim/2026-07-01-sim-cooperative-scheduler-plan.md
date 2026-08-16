# 仿真侧协作式确定性调度器实施计划

## 1. 元数据表

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260701-SIM-COOP-SCHED` |
| **创建日期** | 2026-07-01 |
| **目标平台/SoC** | `host` / `wasm`（esp32 不动） |
| **工具链/SDK版本**| GCC 15+（host / MinGW WinLibs）、Emscripten 6.0.1、CMake ≥ 3.20 |
| **计划状态** | ✅ 已完成（核心骨架 v1.4 + fixup 计划已合入；Task 4/5/6 已落地） |
| **优先级** | 🔴 P0（阻塞"多任务 App"生成能力，属功能缺失，非优化） |
| **计划版本** | v1.4 |
| **关联技术设计** | 无，已并入本计划 §3 |
| **关联设计规范** | [`04-wasm-simulation/`](../04-wasm-simulation/)、[`02-wink-micro-os/`](../02-wink-micro-os/) |
| **关联评审记录** | [`../../reviews/unisim/2026-07-01-sim-cooperative-scheduler-plan-review.md`](./2026-07-01-sim-cooperative-scheduler-plan-review.md) |
| **关联 ADR** | 待写：**ADR-0013 仿真侧协作式确定性调度模型**、**ADR-0014 仿真侧单虚拟核取舍声明**；对齐 [ADR-0003 仿真保真边界](../../decisions/unisim/0003-simulation-fidelity-boundary.md)、[ADR-0007 协作循环执行模型](../../decisions/core/0007-cooperative-loop-execution-model.md) |
| **目标里程碑** | Wave 3（多任务保真） |
| **前置依赖计划** | [`2026-07-01-wasm-simulator-target-repair-plan.md`](./2026-07-01-wasm-simulator-target-repair-plan.md)（已完成，wasm smoke 已通） |
| **替代/废弃** | 无 |
| **计划负责人** | wink-ai 架构组 |
| **所需子代理技能** | `embedded-best-practice` + `subagent-driven-development` + `test-driven-development` |

---

## 2. 背景与目标

### 2.1 问题陈述

`pal_os_task_create` 在 wasm 与 host target 目前都是**退化实现**：直接同步调用一次 task 函数体。
证据：`targets/wasm/pal_osal_wasm.c:128-146`、`targets/host/pal_osal_host.c:177-192`。

后果：
1. **多任务 App 功能缺失**：任何使用第二个 `pal_os_task_create` 的 App（典型如 sensor_task + motor_task 分离结构），第二个 task **永远不会被创建**——第一个 task 里的 `while(1) { ... pal_os_sleep_ms }` 通过 Asyncify 让出后，回到 wasm 只会继续跑第一个 task，第二个 task 从未被 dispatch。
2. **仿真与真机行为不一致**：真机 ESP32 上 FreeRTOS 会抢占式并发调度这些任务；仿真里则退化成"只有第一个 task 存在"。用户在仿真里跑通的代码，一到真机就露馅——违反 [ADR-0003](../../decisions/unisim/0003-simulation-fidelity-boundary.md) "行为级高保真"承诺。
3. **Ringbuf / queue 跨任务通信全部失效**：`pal_os_ringbuf` 在两个任务之间做生产者-消费者时，消费者根本没被启动。
4. **中断 Poll 语义割裂**：现有 `pal_wasm_dispatch_pending_interrupts` 只在"当前跑着的那个 task 的 tick 边界"被拉动；如果 ISR 想唤醒别的任务，没有机制承接。

这是**bug 级缺陷，不是保真度优化**。当前只有 `avoidance_car`（单任务 main loop）恰好躲过陷阱。

### 2.2 技术/业务目标

- ✅ **T1**：`pal_os_task_create` 在 host / wasm 两个 target 上真正支持"多任务并发执行"，任务顺序由确定性调度器决定。
- ✅ **T2**：**bit-exact 可复现**——同一份 App + 同一 PRNG seed → 每次运行任务交错顺序完全一致，CI 失败可复现。
- ✅ **T3**：**零上层变更**——`pal_osal.h` API 签名保持不变；现有单任务 App（avoidance_car / oled_dashboard）行为一字不改。
- ✅ **T4**：**target 无关算法库**——调度器核心逻辑独立于 wasm/host 平台细节，放 `targets/common/`，参照 `wink_sim_physical.c` 复用模式。
- ✅ **T5**：**真协程保真**——wasm 侧利用 **`<emscripten/fiber.h>` 官方 fiber API**（内部走 Asyncify，但屏蔽了裸手动交换 `__asyncify_data` 的所有细节），host 侧利用 Windows Fibers；两者共同经由 `sim_ctx_*` 抽象层落地，实现真正的上下文切换。App 任务代码（如 `while(1) { sleep; }`）在仿真与真机上实现 100% 语法级和行为级对齐，无需伪协程妥协。
- ✅ **T6**：**esp32 target 零回归**——本计划**不修改** `targets/esp32/pal_osal_esp32.c`，真机继续用 FreeRTOS 抢占式。
- ✅ **T7**：**显式声明"单虚拟核"取舍**——通过 ADR-0014 记录这是主动设计选择而非能力缺失，未来质疑有据可查。
- ✅ **T8**：**保真边界诚实性**——通过 ADR-0013 §"已知保真度边界"章节明确记录"纯 CPU 耗时不可抢占""中断到 task 唤醒延迟""虚拟抢占粒度非指令级"三条能力边界，为未来 codegen 的 yield 插桩策略提供权威输入。

### 2.3 成功指标（验收出口）

| 指标 | 通过标准 | 验证方法 |
|------|----------|----------|
| host 单元测试 | 100% 通过 | `python wink-tools/wink.py test` |
| wasm smoke | `smoke PASS` | `node wink-micro-os/targets/wasm/wink_sim_stub.js` |
| esp32 构建 | 0 error / 0 warning | `idf.py -C esp32_firmware build` |
| 多任务示例 App 端到端 | sensor_task + motor_task 均被创建、按调度器策略交替执行、queue 消息成功传递 | 新增 `test_sim_scheduler_e2e.c` |
| 确定性 | 同 seed 下 5 次运行任务交错序列 hash 一致 | 新增 `test_sim_scheduler_determinism.c` |
| avoidance_car 回归 | **业务可观测行为一致**（sensor 读数、PWM 输出、日志内容序列 bit-exact；时间戳允许 ≤ 2 tick 边界扰动，见 §4.3 R-002） | 新增 `test_avoidance_car_scheduler_regression.c` |
| ADR-0013 / 0014 | 已 Accepted 并回写至设计规范 `04-wasm-simulation/` | 人工审查 |
| Fiber 栈保护 | Windows Fiber 栈 ≥ 32KB、wasm fiber 数据栈 ≥ 16KB；用户传入过小时 clamp 到下限并 WARN | 新增 `test_sim_scheduler_stack_clamp.c` |
| BLOCKED 超时统一 | mutex/queue/sem 的超时唤醒与 sleep_ms 走同一 `wakeup_by_time` 路径 | Task 1 §"Step 1 API 补齐" 单测覆盖 |

---

## 3. 变更范围与影响分析

### 3.1 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `docs/decisions/unisim/0013-sim-cooperative-scheduler.md` | 🆕 新增 | ADR-0013 |
| `docs/decisions/unisim/0014-sim-single-virtual-core.md` | 🆕 新增 | ADR-0014（单虚拟核取舍） |
| `docs/design/04-wasm-simulation/03-scheduler-model.md` | 🆕 新增 | 设计规范：调度器语义（ADR-0013 回写） |
| `wink-micro-os/targets/common/include/wink_sim_scheduler.h` | 🆕 新增 | target 无关调度器 API |
| `wink-micro-os/targets/common/include/sim_ctx.h` | 🆕 新增 | 协程上下文抽象层 API（`sim_ctx_create/switch/destroy`），屏蔽 Win32 Fiber / emscripten fiber / 未来 POSIX ucontext 差异 |
| `wink-micro-os/targets/common/src/wink_sim_scheduler.c` | 🆕 新增 | 协作式调度器算法（含 PRNG、ZOMBIE→TERMINATED GC 状态机） |
| `wink-micro-os/targets/host/sim_ctx_win32_fiber.c` | 🆕 新增 | `sim_ctx_*` 的 Win32 Fiber 实现 |
| `wink-micro-os/targets/wasm/sim_ctx_emscripten_fiber.c` | 🆕 新增 | `sim_ctx_*` 的 `<emscripten/fiber.h>` 实现 |
| `wink-micro-os/targets/host/pal_osal_host.c` | ✏️ 修改 | `pal_os_task_create/delete` 接入 `sim_ctx_*` + scheduler；新增 `host_sim_scheduler_run()` 与 ZOMBIE GC |
| `wink-micro-os/targets/wasm/pal_osal_wasm.c` | ✏️ 修改 | 同上，通过 `<emscripten/fiber.h>` 集成；`js_pal_os_sleep_ms` Asyncify yield 语义保留 |
| `wink-micro-os/targets/wasm/CMakeLists.txt` | ✏️ 修改 | 追加 `wink_sim_scheduler.c` + `sim_ctx_emscripten_fiber.c` 源；确认 `-sASYNCIFY=1` 保留（`emscripten/fiber.h` 依赖 Asyncify runtime） |
| `wink-micro-os/targets/host/CMakeLists.txt` | ✏️ 修改 | 追加 `wink_sim_scheduler.c` + `sim_ctx_win32_fiber.c` 源；`if(WIN32)` 守卫确保 Linux/macOS build 立即报错而非静默错栈 |
| `wink-micro-os/runtime/wink_runtime.c` | ✏️ 修改（谨慎）| 若引入"虚拟抢占点"，在 tick 边界调 `sim_scheduler_maybe_preempt()` |
| `wink-micro-os/tools/asyncify-spike/` | 🆕 新增（Task 0.5 临时目录，合入前删除） | wasm `<emscripten/fiber.h>` 可行性 spike，双协程独立栈无串扰验证 |
| `wink-micro-os/test/test_sim_scheduler.c` | 🆕 新增 | 调度器算法层单测（不依赖 wasm/host） |
| `wink-micro-os/test/test_sim_scheduler_e2e.c` | 🆕 新增 | host 端到端：2 任务 + queue |
| `wink-micro-os/test/test_sim_scheduler_determinism.c` | 🆕 新增 | seed 确定性验证 |
| `wink-micro-os/test/test_avoidance_car_scheduler_regression.c` | 🆕 新增 | 单任务 App 业务可观测行为一致回归 |
| `wink-micro-os/test/test_sim_scheduler_stack_clamp.c` | 🆕 新增 | 栈大小 clamp + WARN 行为验证 |
| `wink-micro-os/test/test_sim_scheduler_blocked_timeout.c` | 🆕 新增 | BLOCKED 超时统一唤醒路径验证 |
| `wink-micro-os/test/test_sim_scheduler_zombie_gc.c` | 🆕 新增 | 自删 ZOMBIE 状态与主 loop GC 双阶段验证 |
| `wink-micro-os/test/test_sim_scheduler_wcet_fault.c` | 🆕 新增 | WCET 超时监控与 8002 故障触发验证 |
| `wink-micro-os/samples/dual_task_demo/` | 🆕 新增 | 双任务示例 App |
| `docs/implementation-plans/unisim/2026-07-01-sim-cooperative-scheduler-plan.md` | 🆕 本文件 | 计划本身 |

### 3.2 接口影响分析

| 接口层 | 是否有破坏性变更 | 影响范围 | 备注 |
|--------|------------------|----------|------|
| PAL 公开 API | ❌ 否 | `pal_os_task_create` 签名不动 | 只改语义：从"同步调用"变"登记后由调度器分发" |
| DAL 层 | ❌ 否 | 无 | |
| 应用层 | ❌ 否 | 现有 App 零改动 | 但**行为**从"退化态"回归"真多任务"——单任务 App 无观测差异，多任务 App 从"坏"到"能跑" |
| 构建系统 | ⚠️ 微 | 新增源文件 | CMakeLists 追加两处 |
| 工具链 | ❌ 否 | | |
| 文档 | ✏️ 是 | 新增 ADR ×2 + 设计规范 1 篇 | |

### 3.3 架构红线

> 🚨 **架构红线：违反即拒绝合入**
> 1. **不得修改 `pal_osal.h` 任何公开签名**——含 `pal_os_task_create`、`pal_os_task_delete`、`pal_os_task_handle_t`、`pal_os_core_id_t`。
> 2. **不得修改 `targets/esp32/pal_osal_esp32.c`**——esp32 保持 FreeRTOS 原生抢占实现。
> 3. **调度器代码必须 target 无关**——`wink_sim_scheduler.c` 内禁止 `#include <emscripten.h>`、`#include <windows.h>`、禁止调用 `pal_os_sleep_ms` 等 PAL 函数；只暴露"注册/切换/查询"三类 API。target 相关的协程切换实现放在 `sim_ctx_*.c` 分文件里。
> 4. **SSOT 契约不变**——wasm 侧虚拟时钟仍由 `pal_wasm_advance_virtual_clock` 独占写入（JS Worker 驱动），调度器**只读**时钟决定唤醒。
> 5. **确定性保证**——所有调度决策必须只依赖`(已注册任务列表, PRNG 状态, 当前虚拟时间, 每任务 waiting-until 状态)`，禁止使用 `rand()`、`Date.now()`、宿主 `setTimeout` 精度等不可复现源。
> 6. **不得引入 pthread / SharedArrayBuffer**——与 [wasm_bridge.h 契约 #6](../../../../wink-micro-os/targets/wasm/wasm_bridge.h) "Asyncify 重入限制"一致。`<emscripten/fiber.h>` 允许（其内部基于 Asyncify 单线程 unwind/rewind，不引入 pthread）。
> 7. **单虚拟核**——本 wave 不做双 core 仿真；`PAL_OS_CORE_0/1/ANY` 参数**记录**到任务元数据但不参与调度决策，未来若做 SMP 仿真再启用。
> 8. **host target 明确 Windows-only**（本 wave 范围）——host 用 Win32 Fiber 实现真协程；Linux/macOS host 不在本 wave 支持矩阵内。`sim_ctx_*` 抽象层已预留 POSIX ucontext 落地位置，未来跨平台由 ADR-0015 追加。CMake 需 `if(NOT WIN32) message(FATAL_ERROR ...)` 显式失败，禁止静默错栈。
> 9. **wasm 协程实现必须走官方 `<emscripten/fiber.h>` API**——禁止直接操作 `__asyncify_data` 全局指针 / 裸手动交换 unwind buffer 等未文档化用法；Emscripten 版本要求 ≥ 2.0.x（本仓 6.0.1 满足）。
> 10. **仿真任务片执行时间监控（WCET）**——仿真调度器在每次 Fiber 任务切入和切出点必须度量真实执行时长，若单次持续运行时间超过 WCET 安全上限（默认 5ms），必须强制调用 `wink_runtime_fault(8002)` 进行安全截断，防止执行超时 Bug 在仿真端静默通过，同时规避浏览器主线程因死循环永久卡死。

### 3.4 系统资源与并发约束评估

| 资源/安全维度 | 预计变化/开销 | 风险与限制 | 缓解/应对策略 |
|--------------|--------------|-----------|--------------|
| **ROM / Flash 占用** | wasm 侧新增 ~4KB（调度器算法层）+ ~6KB（`<emscripten/fiber.h>` runtime） | 无（wasm 部署无 flash 限制） | wasm 二进制 `wc -c` 前后对比记录；ROM 涨幅纳入 Task 3 完成度 checklist |
| **RAM (静态/全局)** | `MAX_SIM_TASKS`(=8) × `sim_task_t`(~64B) ≈ 512B；主调度器 fiber handle 全局 1 个 | 静态数组大小编译期确定 | 用 `_Static_assert` 保证 `sizeof(sim_task_t) <= 96`（含 ZOMBIE 相关新字段） |
| **栈深度 (Stack) —— host** | 每 fiber 数据栈默认 **64 KB**；总占用 = MAX_TASKS × 64KB = 512 KB | Win32 Fiber 对过小 `stack_depth` 静默接受但栈溢出无检测；用户直接传 esp32 常见值 2048/4096 会翻车 | 引入 `SIM_HOST_STACK_MIN=32KB`，用户 `stack_depth < 下限` 时 clamp 并 `WINK_LOG_WARN`；`test_sim_scheduler_stack_clamp.c` 覆盖此路径 |
| **栈深度 (Stack) —— wasm** | 每 fiber 数据栈默认 **32 KB** + 独立 asyncify 栈 **4 KB**；总占用 = MAX_TASKS × (32KB + 4KB) = 288 KB | 全局 `-sASYNCIFY_STACK_SIZE=65536` 是 fiber 之间**共享**的还是每 fiber 独立由 `<emscripten/fiber.h>` 分配，需在 Task 0.5 spike 里确认 | 引入 `SIM_WASM_STACK_MIN=16KB / SIM_WASM_ASYNCIFY_MIN=2KB`；同样 clamp + WARN；spike 结论写回本表格 |
| **堆内存 (Dynamic Heap)**| 每 fiber 数据栈由 `sim_ctx_create` 一次性 malloc，任务生命周期内不释放；ZOMBIE→TERMINATED 转换时主 loop 统一 `free` | Fiber 泄漏（自删路径 GC 遗漏） | ZOMBIE 状态 + 主 loop GC 阶段（Task 2 Step 3）；`test_sim_scheduler_zombie_gc.c` 用 mock allocator 计数验证 |
| **硬件通道/IO引脚** | 无 | | |
| **并发与中断安全** | wasm 单线程 → 无锁；host 亦单线程 Fiber 协作切换 → 无锁；调度器状态仅在"没有任务在跑"（即主调度器 fiber 上下文）时修改 | 若未来加抢占，`pal_wasm_dispatch_pending_interrupts` 与调度器状态可能竞争 | 保持 Poll 模型：ISR handler 只投递到 pending 队列，实际唤醒 target-task 在 tick 边界做 |
| **可观测性 / 调试** | 编译期开关 `WINK_SIM_SCHED_TRACE=1` 每次 pick/yield/switch/suspend/resume/gc 打印一行 | trace 太多影响性能 / 掩盖真实 bug | 测试 harness 默认开；release wasm 默认关；输出行数上限（超过后转为聚合计数） |

---

## 4. 依赖与风险

### 4.1 前置依赖

| 依赖ID | 依赖内容 | 是否阻塞 | 验证状态 | 备注 |
|--------|----------|----------|----------|------|
| D-001 | wasm 仿真 target 基础打通（wink_simulator smoke pass） | ✅ 是 | ✅ 已完成 | commit `f753b23` 收尾 |
| D-002 | ADR-0009 Wave 2（物理退化引擎）已 Accepted | ❌ 否 | ✅ 已完成 | 调度器与物理引擎解耦 |
| D-003 | ADR-0007 协作循环执行模型 | ✅ 是 | ✅ Accepted | 本计划是其在"多任务"维度的自然延伸 |

### 4.2 外部依赖

| 依赖ID | 依赖内容 | 提供方 | 截止日期 | 风险等级 | 备注 |
|--------|----------|--------|----------|----------|------|
| E-001 | 无 | — | — | — | 本计划完全在 wink-micro-os 内闭环 |

### 4.3 风险登记册

| 风险ID | 风险描述 | 概率 | 影响 | 严重度 | 缓解措施 | 责任人 | 触发条件 |
|--------|----------|------|------|--------|----------|--------|----------|
| R-001 | Asyncify unwind/rewind 与调度器切换耦合出错，wasm 侧 rewind 到错误 task 栈 | 🟢 低 | 🔴 高 | 3 | **改用 `<emscripten/fiber.h>` 官方 API 后大幅降低**（原风险由裸手动交换 `__asyncify_data` 引发）；仍需 Task 0.5 spike 验证 fiber API 与调度器 pick_next 的集成正确性 | wink-ai 架构组 | wasm smoke 崩溃或行为发散 |
| R-002 | 单任务 App（avoidance_car）**业务行为**发散 | 🟡 中 | 🟠 中 | 4 | 验收标准从"逐字节 bit-exact"改为"**业务可观测行为一致**"——sensor 读数、PWM 输出、日志内容序列 bit-exact，允许时间戳、tick 计数有 ≤ 2 tick 边界扰动。Task 5 强制"1 任务时调度器必须表现为直通"的单测；新增 `test_single_task_semantic_regression.c`（仅比较业务字段） | 架构组 | 业务字段 diff 非空 |
| R-003 | 用户代码写 busy-wait `while(shared_flag)` 无 yield 点，仿真死循环 | 🟢 高 | 🟡 低 | 4 | 调度器提供"tick 计数超阈值 → 打印 warning + 强制 yield 一次"的看门狗；ADR-0013 §"已知保真度边界"明确记录此情形属用户代码问题，仿真报警 ≥ 真机静默通过；未来 codegen 阶段可在纯 CPU 循环内自动插桩 `pal_os_yield()` | 架构组 | CI 挂起超时 |
| R-004 | 确定性泄漏：宿主时间被误用 | 🟡 中 | 🔴 高 | 6 | grep `Date.now\|Math.random\|performance.now\|GetTickCount\|QueryPerformanceCounter` 扫源，出现则失败；PRNG seed 通过 `pal_wasm_set_prng_seed` 显式注入；`WINK_SIM_SCHED_TRACE` 打印所有时间读取来源便于审计 | 架构组 | 相同 seed 结果不同 |
| R-005 | ADR-0013 决策被上级或团队否决 | 🟢 低 | 🟠 中 | 2 | Task 0 先立 ADR、走评审再动代码；备选方案（Atomics/pthread）在 ADR 里已论证劣势 | 架构组 | ADR 评审拒绝 |
| R-006 | `pal_os_task_delete` 语义在真机（vTaskDelete self）和仿真（登记表移除）间对齐困难 | 🟢 低 | 🟡 低 | 1 | **通过 ZOMBIE 状态解决**（见 R-009 缓解措施）：仿真侧支持"删除他人"与"删除自己"两种；自删走 READY → ZOMBIE（标记）→ SwitchToFiber(main) → 主 loop GC 释放 fiber → TERMINATED；此语义与 FreeRTOS `vTaskDelete(NULL)` + IDLE task 清理 TCB 完全对齐 | 架构组 | 用户 App 在自删后有后续代码不再执行 |
| **R-007** | wasm 多 fiber 上下文切换在 Emscripten 6.x 下不可行（`<emscripten/fiber.h>` API 与调度器集成有未知坑） | 🟢 低 | 🔴 高 | 3 | Task 0.5 前置 spike（缩至 2-3h，因 fiber API 是官方 first-class 支持）；兜底方案：wasm 侧回退单协程 + 每次 rewind 由 pick_next 决定谁跑，T5 目标降级为"host + esp32 对齐" | 架构组 | Task 0.5 spike 失败 |
| **R-008** | host target Fiber 绑定 Windows API，Linux/macOS 静默错栈 | 🟡 中 | 🟠 中 | 4 | §3.3 红线第 8 条明确本 wave Windows-only；CMake `if(NOT WIN32) message(FATAL_ERROR ...)` 显式失败；`sim_ctx_*` 抽象层预留 POSIX ucontext 实现文件位置（`sim_ctx_posix_ucontext.c`，本 wave 不落地） | 架构组 | Linux CI 或 macOS 本地 build |
| **R-009** | Fiber 自删 `DeleteFiber(GetCurrentFiber())` 触发未定义行为 | 🟡 中 | 🔴 高 | 6 | Task 2 Step 3 明确三段式：**READY → 标记 ZOMBIE → SwitchToFiber(main) → main loop GC 释放 fiber → TERMINATED**；`test_sim_scheduler_zombie_gc.c` 用 mock allocator 验证 fiber 释放次数 = ZOMBIE 出现次数 | 架构组 | 用户 App 调 `pal_os_task_delete(NULL)` |
| **R-010** | Fiber 切换在 debug build（ASAN/UBSAN）下与 sanitizer 栈追踪冲突 | 🟢 低 | 🟡 中 | 2 | 记录已知限制到 `04-wasm-simulation/03-scheduler-model.md`；ASAN/UBSAN 下允许放宽 trace 比较严格度 | 架构组 | python wink-tools/wink.py test 加 sanitizer 后崩栈 |
| **R-011** | 用户传入 esp32 常见 `stack_depth=2048/4096`，仿真侧 fiber 栈过小静默溢出 | 🟢 高 | 🟠 中 | 6 | `pal_os_task_create` 在 host/wasm 侧对 `stack_depth < SIM_*_STACK_MIN` 时 clamp 到下限并 `WINK_LOG_WARN`；`test_sim_scheduler_stack_clamp.c` 覆盖此路径；ADR-0013 §"仿真栈大小契约"记录此下限 | 架构组 | avoidance_car / dual_task_demo 首跑触发 WARN；或运行中 fiber 内出现难以复现的内存踩踏 |
| **R-012** | BLOCKED 超时唤醒（mutex/queue/sem）与 sleep_ms 走两套路径，未来落地 `pal_os_mutex_lock(timeout_ms)` 时行为不一致 | 🟡 中 | 🟠 中 | 4 | Task 1 §"Step 1 API 补齐" 引入 `sim_task_t.wakeup_us` + `sim_task_t.blocked_on` 双字段；`sim_scheduler_wakeup_by_time` 统一处理 WAITING 与带超时 BLOCKED；`test_sim_scheduler_blocked_timeout.c` 覆盖`(BLOCKED + wakeup_us) → 时间到 → READY + timeout_fired=true` 路径 | 架构组 | 未来 mutex/queue/sem 落地时踩到"超时不触发"或"到期后 state 混乱" |
| **R-013** | 仿真侧后台任务 CPU-bound 忙等/死循环，导致仿真主线程卡死，或执行耗时超标却在仿真端静默通过，造成真机 WCET 8002 故障逃逸；或在 CI/宿主负载过高、调试断点时触发 WCET 误判 | 🟡 中 | 🔴 高 | 6 | 在仿真调度器任务切换点监控 WCET，若未挂载调试器且未指定 `WINK_SIM_BYPASS_WCET`，则一旦执行超过 5ms 立即调用 `wink_runtime_fault(8002)` 进行安全关断 | 架构组 | 用户在后台 Task 编写死循环计算，或 CI 容器性能抖动，或开发者进入单步调试 |

### 4.4 跨团队/跨模块协调点

无（wink-micro-os 内部闭环）。

---

## 5. 优先级路线图

### 5.1 执行顺序

```mermaid
graph TD
    T0[Task 0: 立 ADR-0013 / 0014] --> T05[Task 0.5: wasm fiber API spike]
    T05 --> T1[Task 1: 调度器算法库 + sim_ctx 抽象]
    T1 --> T2[Task 2: host 侧接入 Win32 Fiber + ZOMBIE GC]
    T2 --> T3[Task 3: wasm 侧接入 emscripten fiber]
    T2 --> T4[Task 4: 双任务示例 App]
    T3 --> T5[Task 5: 回归 + 确定性 + 栈保护 + 阻塞超时]
    T4 --> T5
    T5 --> T6[Task 6: 回写设计规范 + ADR Accepted]
    T5 --> T7[Task 7 可选: 虚拟抢占点]
```

关键路径：**T0 → T0.5 → T1 → T2 → T3 → T5 → T6**

### 5.2 优先级矩阵

| 优先级 | Task 数量 | 总预估工时 | 说明 |
|--------|-----------|------------|------|
| 🔴 P0 | 7（T0, T0.5, T1, T2, T3, T5, T6） | 34 h | 阻塞验收 |
| 🟡 P1 | 1（T4） | 4 h | 端到端示例 App，强化保真度可视化 |
| ⚪ P2 | 1（T7） | 6 h | 虚拟抢占点（本 wave 不做也可） |
| **总计** | **9** | **44 h** | |

### 5.3 关键路径分析

- **关键路径**：T0(4h) → T0.5(3h) → T1(8h) → T2(6h) → T3(6h) → T5(6h) → T6(4h) = **37 h**
  （Task 5 因新增栈 clamp / BLOCKED 超时 / ZOMBIE GC 三个子测试，从 4h 上调到 6h）
- **可并行路径**：T4（4h）可与 T3 并行，因不共享文件

### 5.4 跨 Task 文件冲突矩阵

| 文件 | 涉及 Task | 串行约束 |
|------|-----------|----------|
| `pal_osal_host.c` | T2 | 单 Task 独占 |
| `pal_osal_wasm.c` | T3 | 单 Task 独占 |
| `wink_sim_scheduler.c/h` | T1 → (T2/T3 只读) | T1 完成后 T2/T3 只读引用 |
| `sim_ctx.h` + `sim_ctx_*.c` | T1（新增头 + 抽象）→ T2（Win32 impl）→ T3（emscripten impl） | 头文件 T1 定型，两个 target impl 可 T2/T3 并行 |
| `tools/asyncify-spike/` | T0.5 独占（合入前删除） | 一次性 spike，不影响其他 Task |

---

## 6. 详细任务拆分与进度追踪

> ✅ **Task 完成定义（本计划 DoD）**：
> 1. 代码符合 `.claude/rules/c-code.md`（静态分发、负错误码、双 target 兼容）
> 2. 新增代码单元测试覆盖率 ≥ 80%
> 3. `python wink-tools/wink.py test` 全绿
> 4. `node wink-micro-os/targets/wasm/wink_sim_stub.js` smoke PASS
> 5. `idf.py -C esp32_firmware build` 零错误零警告（保证不影响真机）
> 6. 相关设计文档同步更新（ADR + 04-wasm-simulation/）
> 7. Commit 原子化 + 英文 message + 关联 ADR / 计划编号

---

### Task 0：起草 ADR-0013 与 ADR-0014 `[ 状态: ⏳ 待开始 ]`

| 字段 | 内容 |
|------|------|
| **负责人** | 架构组 |
| **预估 / 实际工时**| 4 h / — |
| **优先级** | 🔴 P0 |
| **前置依赖** | 无 |
| **修改文件** | `docs/decisions/unisim/0013-sim-cooperative-scheduler.md`（新）、`docs/decisions/unisim/0014-sim-single-virtual-core.md`（新） |
| **接口变化** | 无 |

#### 详细步骤

- [ ] **Step 1：ADR-0013 内容框架**

  - 背景：`pal_os_task_create` 现状退化 + 影响；引用 `pal_osal_wasm.c:128-146` 证据。
  - 决策：仿真侧统一采用**协作式确定性调度器**——task 只在 `pal_os_*` yield 点让出；调度器状态确定性可复现；不使用 pthread / Atomics。
  - 协程实现契约：
    - wasm 侧走 **`<emscripten/fiber.h>`** 官方 API（`emscripten_fiber_init` / `emscripten_fiber_swap`），禁止直接操作 `__asyncify_data`。理由：官方 first-class 支持、屏蔽 Asyncify 状态机细节、与 Win32 Fiber 语义对偶。
    - host 侧走 **Win32 Fiber**（`ConvertThreadToFiber` / `CreateFiber` / `SwitchToFiber` / `DeleteFiber`）。
    - 两端共同经由 `sim_ctx_*` 抽象层暴露给调度器算法层，target 无关性靠该抽象层保证。
  - 备选方案比选：
    - A. 现状（同步单任务） — 功能缺失。**拒绝**
    - B. 真多线程 wasm（`-sUSE_PTHREADS=1`）— 部署 COOP/COEP、确定性丢失、宿主调度不可控、不对齐真机 FreeRTOS tick 语义。**拒绝**
    - C. wasm 裸手动交换 `__asyncify_data` — 非官方 API、坑多、维护成本高。**拒绝**（首轮 review G1）
    - D. **协作式确定性调度器 + `<emscripten/fiber.h>` + Win32 Fiber** — **采纳**
  - 后果与约束：
    - 用户代码含 busy-wait 无 yield 点将死循环（列为已知限制，看门狗兜底）
    - 抢占粒度 = yield 粒度；覆盖大多数正确的 FreeRTOS 用法
    - Round-robin 起步；未来可选优先级/PRNG 交错扫描（loom-style）
    - **仿真栈大小契约**：`pal_os_task_create` 的 `stack_depth` 参数在仿真侧作为**下限约束**而非精确值——传入过小时 clamp 到平台安全下限（host 32KB / wasm 数据栈 16KB + asyncify 栈 2KB）并 WARN。真机 esp32 严格遵守。
  - **§"已知保真度边界"**（T8 目标落地）：
    1. **纯 CPU 耗时不可抢占与 WCET 截断**——若 task 内部有大段计算无 `pal_os_*` 让出点，仿真里会独占 CPU 直到跑完；真机上则会被 FreeRTOS tick ISR 定期抢占。检测：除支持对 tick 计数超阈值输出 WARN 外，必须在任务切换前后对真实耗时进行 WCET 监控（超 5ms 上限则调用 `wink_runtime_fault(8002)` 安全截断），防止死循环卡死浏览器或耗时 Bug 静默通过。建议：未来 AI codegen 在纯 CPU 循环内自动插桩 `pal_os_yield()`。
    2. **虚拟抢占点粒度**——Task 7 引入的抢占只发生在 scheduler tick 边界（如每 1ms 虚拟时间），非用户代码的任意指令边界。真机 preemption 是指令级的。
    3. **ISR 到 task 唤醒延迟**——仿真中断只在 tick 边界 poll，真机中断随时可触发。仿真侧唤醒延迟 O(scheduler tick)，真机 O(几十 µs)。
    4. **跨核 race 不覆盖**——见 ADR-0014。
  - Compliance & Follow-up：本计划 T0.5 - T7。

- [ ] **Step 2：ADR-0014 单虚拟核取舍**

  - 背景：ESP32/S3 有双核，S2/C3/C6/H2 单核；跨核 race bug 是嵌入式常见坑。
  - 决策：仿真恒为**单虚拟核**——`PAL_OS_CORE_0/1/ANY` 参数被记录为任务元数据但不影响调度。
  - 理由：
    - 跨核 race 一旦仿真会破坏确定性（wasm memory model ≠ Xtensa）
    - 正确使用 FreeRTOS 原语的代码，单核和双核行为等价
    - 真正的跨核 race 由真机 CI + 静态分析兜底（明确划分保真边界）
  - **具体不覆盖的 bug 类型**（供未来 review 检索）：
    1. 无 mutex 保护的共享 struct 跨核并发写
    2. Pinned-to-core 的时序假设（Core 0 时钟 ≠ Core 1 时钟）
    3. 跨核 cache flush / DMA 一致性场景
    4. ISR 在 Core X、唤醒的 task 被调度到 Core Y 的时序假设
    5. `portMUX` vs task-level mutex 的语义漂移
  - Follow-up：若未来确需 SMP 仿真，需要 ADR-0015（loom 风格 seed 扫描 core interleaving）。

- [ ] **Step 3：状态**

  两 ADR 初始 `Proposed`，用户评审通过后 Task 6 改为 `Accepted` 并回写设计规范。

#### 验证步骤

1. **命令**：`python docs/decisions/scripts/list_adrs.py` 应看到 ADR-0013 / 0014 处于 Proposed。
2. **预期输出**：两个新 ADR 出现在列表中。

#### 架构注意事项

> ⚠️ ADR 是本计划**最重要**的可交付物，先立后动代码——若用户对协作式/单核/`<emscripten/fiber.h>` 决策有异议，本计划整体需重新评估。

---

### Task 0.5：wasm `<emscripten/fiber.h>` 可行性 spike `[ 状态: ⏳ 待开始 ]`

| 字段 | 内容 |
|------|------|
| **负责人** | 架构组 |
| **预估 / 实际工时**| 2-3 h / — |
| **优先级** | 🔴 P0（前置，缓解 R-007） |
| **前置依赖** | Task 0（ADR 决策稳定；决定用官方 fiber API 而非裸 Asyncify） |
| **修改文件** | `wink-micro-os/tools/asyncify-spike/`（一次性，通过后删除；spike 结论回写到 §3.4 §"栈深度 (Stack) —— wasm" 与 Task 3 §"emscripten_fiber_init 用法参考"） |
| **接口变化** | 无（不进入产品代码） |

#### 详细步骤

- [ ] **Step 1：最小 spike 目录**

  ```
  wink-micro-os/tools/asyncify-spike/
    ├── CMakeLists.txt          # 独立 emcc 目标，不依赖 wink_runtime
    ├── spike.c                 # 两条协程 + main 调度
    └── run.js                  # Node 加载 wasm 跑 100 轮，检查栈无串扰
  ```

- [ ] **Step 2：spike.c 内容**

  ```c
  #include <emscripten/fiber.h>
  #include <emscripten.h>
  #include <stdio.h>

  #define STACK_SZ    (32 * 1024)
  #define ASYNC_SZ    (4 * 1024)

  static char main_asyncify_stack[ASYNC_SZ];
  static emscripten_fiber_t fmain, fa, fb;
  static char stack_a[STACK_SZ], stack_b[STACK_SZ];
  static char async_a[ASYNC_SZ], async_b[ASYNC_SZ];

  EM_JS(void, js_sleep, (int ms), {
      return Asyncify.handleAsync(() => new Promise(r => setTimeout(r, ms)));
  });

  static void body_a(void* arg) {
      for (int i = 0; i < 100; ++i) {
          volatile char local[128];
          local[0] = 'A';
          printf("A i=%d local=%p\n", i, local);
          js_sleep(1);
          emscripten_fiber_swap(&fa, &fmain);
      }
  }
  static void body_b(void* arg) {
      for (int i = 0; i < 100; ++i) {
          volatile char local[128];
          local[0] = 'B';
          printf("B i=%d local=%p\n", i, local);
          js_sleep(1);
          emscripten_fiber_swap(&fb, &fmain);
      }
  }

  int main(void) {
      emscripten_fiber_init_from_current_context(
          &fmain, main_asyncify_stack, sizeof(main_asyncify_stack));
      emscripten_fiber_init(&fa, body_a, NULL,
          stack_a, sizeof(stack_a), async_a, sizeof(async_a));
      emscripten_fiber_init(&fb, body_b, NULL,
          stack_b, sizeof(stack_b), async_b, sizeof(async_b));

      /* 简单 round-robin：main → A → main → B → main → A → ... */
      for (int i = 0; i < 200; ++i) {
          emscripten_fiber_swap(&fmain, (i & 1) ? &fb : &fa);
      }
      return 0;
  }
  ```

- [ ] **Step 3：run.js 断言点**

  1. `A i=0 local=<pA>` 与 `B i=0 local=<pB>` 的地址 `<pA> ≠ <pB>` 且分别落在各自 `stack_a` / `stack_b` 区间——**证明栈独立**
  2. A / B 的 `i` 序列各自 0..99 单调递增，不出现"A 的 i 跳变"——**证明 fiber 上下文没被 rewind 到错栈**
  3. 全程无 `abort()`、`ASYNCIFY: unexpected state` 等 emscripten 报错
  4. `-sASSERTIONS=1` 下无 Asyncify sanity check 违规

- [ ] **Step 4：spike 结论回写**

  - ✅ 通过 → 更新 §3.4 wasm 栈行 "spike 已确认"；将 spike.c 中的 fiber 初始化片段抄进 Task 3 §"emscripten_fiber_init 用法参考"；spike 目录**从合入 diff 中删除**（本 Task 完成的产物只有 §3.4 更新 + Task 3 代码骨架）
  - ❌ 失败 → 立即触发方案降级：wasm 侧回退到"单协程 + rewind 后主 loop pick_next"模型，T5 目标调整为"host + esp32 对齐"，计划升 v2.0；**不进入 Task 1 之后**

#### 验证步骤

1. `emcmake cmake -S wink-micro-os/tools/asyncify-spike -B wink-micro-os/tools/asyncify-spike/build`
2. `cmake --build wink-micro-os/tools/asyncify-spike/build`
3. `node wink-micro-os/tools/asyncify-spike/run.js`
4. **预期**：断言 1-4 全通过，脚本自打印 `[SPIKE] PASS`

#### 架构注意事项

> ⚠️ **spike 的最小性**：本 spike 只验证"多 fiber 独立栈 + Asyncify yield 正确"，不引入任何 `wink_sim_scheduler` 依赖。这是为了当 spike 失败时，能明确锁定问题在"fiber API 本身"而非"我们的调度器"。
> ⚠️ **spike 合入策略**：spike 目录**不进入 master**，只作为 Task 0.5 的可验证物；结论回写后即删。避免 tools/ 长期堆积一次性验证代码。

---

### Task 1：实现 target 无关调度器算法库 + `sim_ctx_*` 抽象层 `[ 状态: ⏳ 待开始 ]`

| 字段 | 内容 |
|------|------|
| **负责人** | 架构组 |
| **预估 / 实际工时**| 8 h / — |
| **优先级** | 🔴 P0 |
| **前置依赖** | Task 0（ADR Proposed）+ Task 0.5（fiber spike ✅ 通过） |
| **修改文件** | `targets/common/include/wink_sim_scheduler.h`（新）、`targets/common/include/sim_ctx.h`（新）、`targets/common/src/wink_sim_scheduler.c`（新）、`test/test_sim_scheduler.c`（新） |
| **接口变化** | 新增内部 API `sim_scheduler_*` + `sim_ctx_*`（均不出现在 `pal_osal.h`） |

#### 详细步骤

- [ ] **Step 1：设计 `wink_sim_scheduler.h` API（含 ZOMBIE、BLOCKED 超时、栈下限）**

  ```c
  #ifndef WINK_SIM_SCHEDULER_H
  #define WINK_SIM_SCHEDULER_H
  #include <stdint.h>
  #include <stdbool.h>
  #include "wink_status.h"
  #include "sim_ctx.h"

  #define WINK_SIM_MAX_TASKS 8
  #define WINK_SIM_TASK_WCET_THRESHOLD_US (5000u) /* 5ms WCET limit in simulation */

  /* 平台安全栈下限（对齐 §3.4 §"栈深度" 表） */
  #if defined(__EMSCRIPTEN__)
      #define WINK_SIM_STACK_MIN     (16u * 1024u)
      #define WINK_SIM_ASYNCIFY_MIN  (2u  * 1024u)
  #elif defined(_WIN32)
      #define WINK_SIM_STACK_MIN     (32u * 1024u)
      #define WINK_SIM_ASYNCIFY_MIN  0u   /* 不适用 */
  #else
      #error "sim scheduler currently supports EMSCRIPTEN and Win32 host only"
  #endif

  typedef enum {
      SIM_TASK_STATE_INVALID = 0,
      SIM_TASK_STATE_READY,       /* 可运行 */
      SIM_TASK_STATE_WAITING,     /* sleep_ms 时间等待 */
      SIM_TASK_STATE_BLOCKED,     /* 等外部事件（mutex/queue/sem）；wakeup_us>0 表示带超时 */
      SIM_TASK_STATE_ZOMBIE,      /* 自删已让出，fiber 未释放，等主调度器 GC */
      SIM_TASK_STATE_TERMINATED,  /* 已释放，slot 可被 register 复用 */
  } sim_task_state_t;

  typedef struct {
      void   (*func)(void*);
      void*    arg;
      int32_t  priority;
      int32_t  core_id;           /* 记录但不用于调度（ADR-0014） */
      uint64_t wakeup_us;         /* 0 = 无时间唤醒；>0 = 到期强制 READY（WAITING/BLOCKED 共用） */
      uint32_t blocked_on;        /* 0 = 未 BLOCKED；>0 = 等待的资源 id（mutex/queue handle） */
      bool     timeout_fired;     /* 供 mutex_lock 返回 TIMEOUT 判断；resume 时清零 */
      sim_task_state_t state;
      uint32_t id;                /* 单调分配 */
      char     name[16];
      sim_ctx_t* ctx;             /* target 相关协程句柄；由 sim_ctx_create 分配 */
  } sim_task_t;
  _Static_assert(sizeof(sim_task_t) <= 96, "sim_task_t must stay compact");

  /* 生命周期 */
  void          sim_scheduler_reset(uint32_t prng_seed);
wink_status_t pal_sim_scheduler_run(uint32_t main_task_id, uint32_t max_ticks) {
    s_main_ctx = sim_ctx_from_current();
    uint32_t ticks_run = 0;

    while (1) {
        /* 检查中断投递（wasm 侧有效，host 为 no-op） */
        pal_wasm_dispatch_pending_interrupts();

        /* Phase 1: GC */
        sim_scheduler_gc_zombies();

        /* 终结机制检查：若 app_main 任务已被删除 (TERMINATED) 或 max_ticks 达到，跳出调度 loop */
        if (main_task_id != SIM_SCHED_NO_READY) {
            const sim_task_t* main_task = sim_scheduler_get(main_task_id);
            if (main_task->state == SIM_TASK_STATE_TERMINATED) {
                break;
            }
        }
        if (max_ticks > 0 && ticks_run >= max_ticks) {
            break;
        }

        /* Phase 2: 时间唤醒 */
        uint64_t now = pal_os_get_us();
        sim_scheduler_wakeup_by_time(now);

        /* Phase 3: 选下一个 READY */
        uint32_t next = sim_scheduler_pick_next();
        if (next == SIM_SCHED_NO_READY) {
            uint64_t wake = sim_scheduler_next_wakeup_us();
            if (wake == UINT64_MAX) break;   /* 全部 TERMINATED */
            pal_os_sleep_us(wake - now);
            /* wasm 侧：Asyncify 让出至 JS Worker，推进虚拟时间后 rewind 回来。
             * 修复 accounting 错误：在此仅等待时间流逝，不累加主线程 ticks_run */
            continue;
        }

        /* Phase 4: 切到 task (带 WCET 运行监控) */
        sim_scheduler_set_current(next);
        const sim_task_t* t = sim_scheduler_get(next);
        uint64_t start_us = pal_os_get_us();
        sim_ctx_switch(s_main_ctx, t->ctx);
        uint64_t duration_us = pal_os_get_us() - start_us;
        
        /* WCET 安全监控判定：若设置了 WINK_SIM_BYPASS_WCET 环境变量，则绕过 8002 异常注入，
         * 用于保障虚拟/CI测试环境在系统调度颠簸时的测试抗噪性 */
        bool bypass_wcet = (getenv("WINK_SIM_BYPASS_WCET") != NULL);
        if (!bypass_wcet && duration_us > WINK_SIM_TASK_WCET_THRESHOLD_US) {
            WINK_LOG_ERROR("Task [%s] WCET violated: executed for %llu us, threshold is %d us. Triggering 8002!",
                           t->name, duration_us, WINK_SIM_TASK_WCET_THRESHOLD_US);
            wink_runtime_fault(8002);
        }
        
        if (next == main_task_id) {
            ticks_run++;
        }
    }

    sim_scheduler_gc_zombies();
    return WINK_OK;
}void       sim_ctx_switch(sim_ctx_t* from, sim_ctx_t* to);

  /* 释放数据栈 + asyncify 栈。禁止对"当前正在运行"的 ctx 调用（UB）。
   * 调用方（scheduler_gc_zombies）负责在 SwitchToFiber(main) 之后再删。 */
  void       sim_ctx_destroy(sim_ctx_t* ctx);

  #endif
  ```

  **`sim_ctx.h` 抽象层**：

  ```c
  #ifndef SIM_CTX_H
  #define SIM_CTX_H
  #include <stdint.h>
  #include <stddef.h>

  typedef struct sim_ctx sim_ctx_t;   /* 前向声明，实现由 sim_ctx_*.c 定义 */

  /* 语义：分配数据栈 + (wasm 侧) asyncify 栈，创建协程句柄。
   *      stack_bytes 必须 ≥ WINK_SIM_STACK_MIN；调用方（scheduler）负责 clamp+WARN。 */
  sim_ctx_t* sim_ctx_create(void (*entry)(void*), void* arg, size_t stack_bytes);

  /* 主调度器 fiber 初始化（从当前线程/主上下文转换而来）。全局仅调一次。 */
  sim_ctx_t* sim_ctx_from_current(void);

  /* 从 from 切换到 to。当前上下文挂起，to 从上次挂起处继续。 */
  void       sim_ctx_switch(sim_ctx_t* from, sim_ctx_t* to);

  /* 释放数据栈 + asyncify 栈。禁止对"当前正在运行"的 ctx 调用（UB）。
   * 调用方（scheduler_gc_zombies）负责在 SwitchToFiber(main) 之后再删。 */
  void       sim_ctx_destroy(sim_ctx_t* ctx);

  #endif
  ```

- [ ] **Step 2：实现 `wink_sim_scheduler.c` 骨架**

  - 静态数组 `static sim_task_t s_tasks[WINK_SIM_MAX_TASKS]`；`state==INVALID` 或 `TERMINATED` 表示 slot 可复用
  - `sim_scheduler_reset`：重置调度器。**必须首先遍历 `s_tasks`，对所有状态不为 `INVALID` 且不为 `TERMINATED` 的活跃任务，调用 `sim_ctx_destroy` 销毁其协程上下文（释放其 Fiber 和堆栈空间），以规避测试用例顺序跑（同进程）时产生的协程/内存泄漏。** 随后初始化静态 PRNG（xorshift32，种子由本入口注入；无外部时间依赖）状态。
  - `sim_scheduler_register`：
    ```c
    /* 栈下限保护（对齐 R-011） */
    uint32_t eff = stack_depth;
    if (eff < WINK_SIM_STACK_MIN) {
        WINK_LOG_WARN("task '%s' stack_depth=%u < sim min=%u, clamped (ADR-0013 §sim-stack-contract)",
                      name, stack_depth, WINK_SIM_STACK_MIN);
        eff = WINK_SIM_STACK_MIN;
    }
    sim_ctx_t* ctx = sim_ctx_create(func, arg, eff);
    if (!ctx) return WINK_ERR_NO_MEM;
    /* slot 分配 + 元数据填充 ... */
    ```
  - `sim_scheduler_wakeup_by_time`：遍历 WAITING/BLOCKED，若 `wakeup_us > 0 && wakeup_us <= now`：
    - state 转 READY；若原为 BLOCKED，置 `timeout_fired = true`；清 `blocked_on`（⚠️ **安全时序提醒**：必须在 `state` 改为 `READY` 之前判断是否原为 `BLOCKED`，防止判断失效）
  - `sim_scheduler_pick_next`：纯函数，round-robin 从 READY 挑一个
  - `sim_scheduler_yield_timed(id, now, dur)`：state=WAITING, wakeup_us = now + dur
  - `sim_scheduler_block(id, res, now, timeout)`：state=BLOCKED, blocked_on = res, wakeup_us = (timeout == 0 ? 0 : now + timeout)
  - `sim_scheduler_resume(id)`：state==BLOCKED 才生效；state=READY, blocked_on=0, timeout_fired=false, wakeup_us=0
  - `sim_scheduler_mark_zombie(id)`：state=ZOMBIE（不删 ctx，等 GC）
  - `sim_scheduler_gc_zombies()`：遍历 ZOMBIE → `sim_ctx_destroy(ctx)` → state=TERMINATED（slot 保留 name/id 供 introspection）
  - 编译期断言：`_Static_assert(WINK_SIM_MAX_TASKS <= 32, "...")`
  - **禁止**：`#include <emscripten.h>` / `#include <windows.h>` / `<pthread.h>` / `<time.h>` / `rand()` / `Date.now`

- [ ] **Step 3：调试可观测性 `WINK_SIM_SCHED_TRACE`**

  在 `wink_sim_scheduler.c` 顶部：
  ```c
  #ifndef WINK_SIM_SCHED_TRACE
  #define WINK_SIM_SCHED_TRACE 0
  #endif

  #if WINK_SIM_SCHED_TRACE
    #if defined(__EMSCRIPTEN__)
      #include <emscripten.h>
      #define SCHED_TRACE(fmt, ...) \
          EM_ASM_({ console.log('[SCHED] ' + UTF8ToString($0)); }, \
              _sched_trace_format(fmt, __VA_ARGS__))
    #else
      #include <stdio.h>
      #define SCHED_TRACE(fmt, ...) fprintf(stderr, "[SCHED] " fmt "\n", __VA_ARGS__)
    #endif
  #else
    #define SCHED_TRACE(fmt, ...) ((void)0)
  #endif
  ```

  在 pick / wakeup_by_time / yield / block / resume / gc / mark_zombie 每一处入口打印一行。测试 harness CMake 默认 `-DWINK_SIM_SCHED_TRACE=1`；wasm release build 默认 `0`。

- [ ] **Step 4：单元测试 `test/test_sim_scheduler.c`**

  用例（不涉及 wasm/host，纯算法层——使用 mock `sim_ctx_*`）：
  1. `test_register_and_pick_round_robin`：注册 3 个 task，5 次 pick_next 序列 `[0,1,2,0,1]`
  2. `test_wakeup_by_time_promotes_waiting`：task 0 yield_timed 100us → `wakeup_by_time(50)` 返回 0；`wakeup_by_time(150)` 返回 1，task 0 转 READY
  3. `test_all_waiting_returns_no_ready`：全 WAITING → `pick_next()` 返回 SIM_SCHED_NO_READY；`next_wakeup_us` 返回最近 wakeup
  4. `test_terminate_via_zombie`：task 1 mark_zombie → 下轮 pick 只在 0/2 之间轮转；gc_zombies 后 state=TERMINATED
  5. `test_determinism_same_seed`：两次 reset(seed=42) + 同操作序列 → pick 结果 bit-exact 一致
  6. `test_max_tasks_full`：注册第 9 个返回 `WINK_ERR_NO_MEM`
  7. `test_single_task_direct_pass`：只注册 1 个 task，pick_next 始终返回它 → 保证单任务 App 零业务差异
  8. `test_stack_clamp_warns`：stack_depth = 1024 → 应 clamp 到 `WINK_SIM_STACK_MIN` 并 WARN（mock 捕获）
  9. `test_block_with_timeout_wakes_by_time`：task block(res=1, timeout=100us) → `wakeup_by_time(150)` 转 READY，`timeout_fired == true`
  10. `test_block_infinite_only_resume`：task block(res=1, timeout=0) → `wakeup_by_time(1e9)` 不影响；`resume(id)` 才 READY，`timeout_fired == false`
  11. `test_gc_zombies_releases_ctx`：mock sim_ctx，验证 gc_zombies 调用 destroy 次数 = mark_zombie 次数

#### 验证步骤

1. **命令**：`python wink-tools/wink.py test -Filter test_sim_scheduler`
2. **预期输出**：`All 11 tests passed`
3. **额外检查**：
   ```powershell
   Select-String -Path wink-micro-os/targets/common/src/wink_sim_scheduler.c `
       -Pattern 'emscripten|windows\.h|pthread|Date\.now|rand\('
   # 应无匹配
   ```

#### 架构注意事项

> ⚠️ **纯算法层**：本 Task 产出的 `wink_sim_scheduler.c` 不依赖任何 PAL 函数、不 `#include` 任何平台头；只通过 `sim_ctx.h` 抽象层间接使用协程。
> ⚠️ **PRNG 独立于 `pal_wasm_physical.c` 的 PRNG**：两者 seed 分离，避免物理故障注入 seed 变更影响调度顺序。
> ⚠️ **单测里的 mock sim_ctx**：算法层单测不涉及真 Fiber/Asyncify——mock 实现只需记录 create/destroy/switch 次数即可。真 fiber 集成测试在 Task 2/3。

---

### Task 2：host 侧接入调度器（Win32 Fiber + ZOMBIE GC） `[ 状态: ⏳ 待开始 ]`

| 字段 | 内容 |
|------|------|
| **负责人** | 架构组 |
| **预估 / 实际工时**| 6 h / — |
| **优先级** | 🔴 P0 |
| **前置依赖** | Task 1 |
| **修改文件** | `targets/host/pal_osal_host.c`、`targets/host/sim_ctx_win32_fiber.c`（新）、`targets/host/CMakeLists.txt`、`test/test_sim_scheduler_e2e.c`（新）、`test/test_sim_scheduler_zombie_gc.c`（新） |
| **接口变化** | 无（`pal_os_task_create/delete/sleep_ms` 签名不变） |

#### 详细步骤

- [ ] **Step 1：CMakeLists.txt 追加源文件（含平台守卫）**

  ```cmake
  if(NOT WIN32)
      message(FATAL_ERROR
          "wink-micro-os host target currently supports Windows only "
          "(uses Win32 Fiber via sim_ctx_win32_fiber.c). "
          "See ADR-0013 §host-platform-matrix; Linux/macOS support requires "
          "adding sim_ctx_posix_ucontext.c (out of scope for this wave).")
  endif()

  set(PAL_HOST_SOURCES
      ${PAL_HOST_SOURCES}
      ${CMAKE_CURRENT_SOURCE_DIR}/../common/src/wink_sim_scheduler.c
      ${CMAKE_CURRENT_SOURCE_DIR}/sim_ctx_win32_fiber.c
      PARENT_SCOPE)
- [ ] **Step 2：实现 `sim_ctx_win32_fiber.c`**

  ```c
  #include "sim_ctx.h"
  #include "osal/pal_osal.h" // 引入 pal_os_task_delete 支持自删
  #include <windows.h>
  #include <stdlib.h>

  struct sim_ctx {
      void*  fiber;         /* CreateFiber 返回；主 fiber 时为 ConvertThreadToFiber 返回 */
      void   (*entry)(void*);
      void*  arg;
      bool   is_main;       /* 标记是否为主协程，防止销毁时误删引发线程退出 */
  };

  static VOID CALLBACK fiber_trampoline(LPVOID p) {
      struct sim_ctx* c = (struct sim_ctx*)p;
      c->entry(c->arg);
      /* 用户函数执行完成后，通过 pal_os_task_delete(NULL) 自动进入 Zombie 并切回主协程，
       * 规避协程在 trampoline 顶层直接 return 引发宿主线程突发终止的崩溃风险，
       * 同时优雅规避了“任务 ID 未分配时包裹函数无法确定任务句柄”的鸡生蛋问题。 */
      pal_os_task_delete(NULL);
  }

  sim_ctx_t* sim_ctx_from_current(void) {
      struct sim_ctx* c = (struct sim_ctx*)calloc(1, sizeof(*c));
      if (!c) return NULL;
      c->is_main = true;
      if (IsThreadAFiber()) {
          c->fiber = GetCurrentFiber();
      } else {
          c->fiber = ConvertThreadToFiber(NULL);
      }
      return c;
  }

  sim_ctx_t* sim_ctx_create(void (*entry)(void*), void* arg, size_t stack_bytes) {
      struct sim_ctx* c = (struct sim_ctx*)calloc(1, sizeof(*c));
      if (!c) return NULL;
      c->entry = entry;
      c->arg = arg;
      c->is_main = false;
      /* 向上舍入到 16 字节对齐，防止 SIMD 等指令集错栈崩溃 */
      size_t aligned_stack = (stack_bytes + 15u) & ~15u;
      c->fiber = CreateFiber((SIZE_T)aligned_stack, fiber_trampoline, c);
      if (!c->fiber) { free(c); return NULL; }
      return c;
  }

  void sim_ctx_switch(sim_ctx_t* from, sim_ctx_t* to) {
      (void)from;   /* Win32 SwitchToFiber 从"当前"切换，无需 from */
      SwitchToFiber(to->fiber);
  }

  void sim_ctx_destroy(sim_ctx_t* ctx) {
      if (!ctx) return;
      /* 契约：调用方保证 ctx != 当前 fiber（由 gc_zombies 在主 loop 上下文调） */
      /* 仅在非常驻的主协程时，才能调用 DeleteFiber，防测试线程退出 */
      if (!ctx->is_main && ctx->fiber) {
          DeleteFiber(ctx->fiber);
      }
      free(ctx);
  }
  ```

- [ ] **Step 3：`pal_os_task_create` / `pal_os_task_delete`（含 ZOMBIE 三段式）**

  ```c
  static sim_ctx_t* s_main_ctx = NULL;

  wink_status_t pal_os_task_create(
      void (*func)(void*), const char* name, uint32_t stack_depth,
      void* arg, int32_t priority, pal_os_core_id_t core_id,
      pal_os_task_handle_t* task_handle)
  {
      uint32_t id;
      /* scheduler_register 内部：clamp + WARN + sim_ctx_create；
       * 任务函数正常返回时，由 sim_ctx_* 侧的 trampoline 截获并代为触发 pal_os_task_delete(NULL) */
      wink_status_t st = sim_scheduler_register(
          func, arg, name, priority, (int32_t)core_id, stack_depth, &id);
      if (st != WINK_OK) return st;
      if (task_handle) *task_handle = (pal_os_task_handle_t)(uintptr_t)(id + 1);
      return WINK_OK;
  }

  void pal_os_task_delete(pal_os_task_handle_t handle) {
      if (handle == NULL) {
          /* 自删三段式（对齐 R-009）：
           *   ① mark_zombie —— 只改状态，不删 fiber
           *   ② SwitchToFiber(main) —— 让出；当前 fiber 挂起
           *   ③ 主 loop 下轮 gc_zombies → sim_ctx_destroy → DeleteFiber
           *     （此时 fiber 不再是自己，安全） */
          uint32_t cur = sim_scheduler_current_id();
          sim_scheduler_mark_zombie(cur);
          sim_ctx_switch(NULL, s_main_ctx);
          /* Unreachable */
      } else {
          uint32_t id = (uint32_t)(uintptr_t)handle - 1;
          sim_scheduler_mark_zombie(id);
          /* 他删：fiber 目前不在运行，主 loop 下轮 GC 时安全释放 */
      }
  }
  ```

- [ ] **Step 4：`pal_sim_scheduler_run()` 主 loop（含 GC 与终结机制）**

  ```c
  wink_status_t pal_sim_scheduler_run(uint32_t main_task_id, uint32_t max_ticks) {
      s_main_ctx = sim_ctx_from_current();
      uint32_t ticks_run = 0;

      while (1) {
          /* Phase 1: GC —— 释放已 ZOMBIE 的 fiber（此时它们都不在运行） */
          sim_scheduler_gc_zombies();

          /* 终结机制检查：若 app_main 任务已被删除 (TERMINATED) 或 max_ticks 达到，跳出调度 loop */
          if (main_task_id != SIM_SCHED_NO_READY) {
              const sim_task_t* main_task = sim_scheduler_get(main_task_id);
              if (main_task->state == SIM_TASK_STATE_TERMINATED) {
                  break;
              }
          }
          if (max_ticks > 0 && ticks_run >= max_ticks) {
              break;
          }

          /* Phase 2: 唤醒到期的 WAITING/BLOCKED */
          uint64_t now = host_sim_time_us();
          sim_scheduler_wakeup_by_time(now);

          /* Phase 3: 选下一个 READY */
          uint32_t next = sim_scheduler_pick_next();
          if (next == SIM_SCHED_NO_READY) {
              uint64_t wake = sim_scheduler_next_wakeup_us();
              if (wake == UINT64_MAX) break;   /* 全部 TERMINATED */
              host_sim_advance_to(wake);
              /* 修复 accounting 错误：在此仅推进物理/虚拟时间，不重复累加 ticks_run，
               * ticks_run 应当严格等于 app_main 实际被调度运行的次数，防单元测试过早退出 */
              continue;
          }

          /* Phase 4: 切到 task (带 WCET 运行监控) */
          sim_scheduler_set_current(next);
          const sim_task_t* t = sim_scheduler_get(next);
          uint64_t start_us = pal_os_get_us();
          sim_ctx_switch(s_main_ctx, t->ctx);
          uint64_t duration_us = pal_os_get_us() - start_us;
          
          /* WCET 安全监控判定：若挂载了 Windows 调试器或显式设置了 WINK_SIM_BYPASS_WCET 环境变量，
           * 则强制跳过 WCET 违规断言，防止单步断点调试或 CI 容器性能颠簸时触发 8002 误杀 */
          bool bypass_wcet = (getenv("WINK_SIM_BYPASS_WCET") != NULL) || IsDebuggerPresent();
          if (!bypass_wcet && duration_us > WINK_SIM_TASK_WCET_THRESHOLD_US) {
              WINK_LOG_ERROR("Task [%s] WCET violated: executed for %llu us, threshold is %d us. Triggering 8002!",
                             t->name, duration_us, WINK_SIM_TASK_WCET_THRESHOLD_US);
              wink_runtime_fault(8002);
          }
          
          if (next == main_task_id) {
              ticks_run++;
          }
      }

      /* 清理残余 fiber */
      sim_scheduler_gc_zombies();
      return WINK_OK;
  }
  ```

- [ ] **Step 5：重写 `pal_os_sleep_ms`（去除违约分支，对齐 T5）**

  ```c
  void pal_os_sleep_ms(uint32_t ms) {
      uint32_t cur = sim_scheduler_current_id();
      /* T5 契约：sleep 必须在调度器上下文中调用；否则说明测试 harness 忘了 sim_scheduler_reset */
      assert(cur != SIM_SCHED_NO_READY &&
             "pal_os_sleep_ms called outside scheduler context; "
             "did you forget sim_scheduler_reset() in test setup?");
      sim_scheduler_yield_timed(cur, host_sim_time_us(), (uint64_t)ms * 1000);
      sim_ctx_switch(NULL, s_main_ctx);
      /* 主 loop 会推进虚拟时钟并 wakeup_by_time 把我们转 READY，再切回来 */
  }
  ```

  ⚠️ 原 v1.x 保留的"未在调度器上下文" fallback 分支（`if (cur == SIM_SCHED_NO_READY) s_time_us += ms*1000`）已删除——违反 T5 且埋 corner case（首轮 review S2）。若测试代码需要在非调度器上下文验证时钟推进，应改用 `host_sim_advance_to(...)`。

- [ ] **Step 6：端到端测试 `test_sim_scheduler_e2e.c`**

  两个 task + ringbuf：
  ```c
  static pal_os_ringbuf_handle_t rb;
  static uint32_t produced, consumed;
  void producer(void* a) {
      while (produced < 10) {
          uint32_t v = produced++;
          pal_os_ringbuf_push(rb, &v, 4);
          pal_os_sleep_ms(10);
      }
  }
  void consumer(void* a) {
      while (consumed < 10) {
          uint32_t v;
          if (pal_os_ringbuf_pop(rb, &v, 4) == WINK_OK) consumed++;
          pal_os_sleep_ms(15);
      }
  }

  TEST(dual_task_ringbuf) {
      sim_scheduler_reset(42);
      rb = pal_os_ringbuf_create(64);
      pal_os_task_create(producer, "p", 32*1024, NULL, 5, PAL_OS_CORE_ANY, NULL);
      pal_os_task_create(consumer, "c", 32*1024, NULL, 5, PAL_OS_CORE_ANY, NULL);
      pal_sim_scheduler_run(SIM_SCHED_NO_READY, 500);
      ASSERT_EQ(produced, 10);
      ASSERT_EQ(consumed, 10);
  }
  ```

- [ ] **Step 7：ZOMBIE GC 测试 `test_sim_scheduler_zombie_gc.c`**

  ```c
  static uint32_t self_delete_count;
  static void self_deleter(void* a) {
      pal_os_sleep_ms(1);
      self_delete_count++;
      pal_os_task_delete(NULL);
      abort();   /* Unreachable */
  }
  TEST(self_delete_reaches_zombie_gc) {
      sim_scheduler_reset(42);
      pal_os_task_create(self_deleter, "sd", 32*1024, NULL, 5, PAL_OS_CORE_ANY, NULL);
      pal_sim_scheduler_run(SIM_SCHED_NO_READY, 50);
      ASSERT_EQ(self_delete_count, 1);
      ASSERT_EQ(sim_scheduler_get(0)->state, SIM_TASK_STATE_TERMINATED);
      /* fiber 已释放（否则进程会泄漏；亦可用 mock allocator counter 显式验证） */
  }
  ```

#### 验证步骤

1. `python wink-tools/wink.py test -Filter test_sim_scheduler`
2. `python wink-tools/wink.py test -Filter test_sim_scheduler_e2e`
3. `python wink-tools/wink.py test -Filter test_sim_scheduler_zombie_gc`
4. `python wink-tools/wink.py test`（全套无回归）

#### 架构注意事项

> ⚠️ **协程底层实现的差异但语义的统一**：通过 `sim_ctx_*` 抽象层 + Win32 Fiber，host 侧彻底消除了伪协程限制，App 可以直接 `while(1){ do_work(); sleep; }`，真机/host/wasm 三端**代码写法和执行语义 100% 对齐**（T5）。
> ⚠️ **Fiber 自删的三段式是硬约束**：`DeleteFiber(GetCurrentFiber())` 是 UB（R-009）。所有 fiber 释放必须发生在**主 fiber 上下文**里，由 `sim_scheduler_gc_zombies` 唯一入口负责。任何绕过此约束的自删路径必须 review 时拦下。
> ⚠️ **全局虚拟时钟单一写入者**：`host_sim_time_us` 只由主 loop 的 `host_sim_advance_to` 推进；`pal_os_sleep_ms` 已改为 `sim_scheduler_yield_timed`（只记录 wakeup_us，不动全局时钟）。这是"确定性"红线的一部分。

---

### Task 3：wasm 侧接入调度器（`<emscripten/fiber.h>` + Asyncify） `[ 状态: ⏳ 待开始 ]`

| 字段 | 内容 |
|------|------|
| **负责人** | 架构组 |
| **预估 / 实际工时**| 6 h / — |
| **优先级** | 🔴 P0 |
| **前置依赖** | Task 0.5（fiber spike ✅）+ Task 1、Task 2（host 侧调度器行为已验证） |
| **修改文件** | `targets/wasm/pal_osal_wasm.c`、`targets/wasm/sim_ctx_emscripten_fiber.c`（新）、`targets/wasm/CMakeLists.txt`、`targets/wasm/pal_wasm_internal.h` |
| **接口变化** | 无外部 API 变化；`pal_osal_wasm.c` 内部新增静态 `s_main_ctx` |

#### 详细步骤

- [ ] **Step 1：CMakeLists.txt 追加（与 host 对称，且确认 Asyncify 链接选项）**

  ```cmake
  set(PAL_WASM_SOURCES
      ${PAL_WASM_SOURCES}
      ${CMAKE_CURRENT_SOURCE_DIR}/../common/src/wink_sim_scheduler.c
      ${CMAKE_CURRENT_SOURCE_DIR}/sim_ctx_emscripten_fiber.c
      PARENT_SCOPE)
  ```

  在顶层 `wink-micro-os/CMakeLists.txt` 的 wasm 链接选项确认（当前已有）：
  - `-sASYNCIFY=1`（`<emscripten/fiber.h>` 依赖 Asyncify runtime）
  - `-sASYNCIFY_STACK_SIZE=65536`（主 fiber 用，task fiber 走独立 asyncify 栈由 `sim_ctx_create` 分配）
  - `-sASYNCIFY_IMPORTS=['js_pal_os_sleep_ms','js_pal_os_busy_wait_us']`（保留，不需加）

- [ ] **Step 2：实现 `sim_ctx_emscripten_fiber.c`（官方 fiber API，禁裸 `__asyncify_data`）**

  ```c
  #include "sim_ctx.h"
  #include <emscripten/fiber.h>
  #include <stdlib.h>
  #include <string.h>

  struct sim_ctx {
      emscripten_fiber_t fiber;
      char* stack;              /* 数据栈 */
      char* asyncify_stack;     /* Asyncify unwind 栈 */
      size_t stack_bytes;
      size_t async_bytes;
      void (*entry)(void*);
      void* arg;
      bool  is_main;            /* main ctx 用 from_current，无独立 stack malloc */
  };

  static void fiber_trampoline(void* p) {
      struct sim_ctx* c = (struct sim_ctx*)p;
      c->entry(c->arg);
      /* 用户函数执行完成后，自动调用 pal_os_task_delete(NULL) 进行自删和挂起切换，
       * 对齐 Host 侧自适应三段式收尾机制，杜绝协程直接 return 引发 runtime 崩溃 */
      pal_os_task_delete(NULL);
  }

  sim_ctx_t* sim_ctx_from_current(void) {
      struct sim_ctx* c = calloc(1, sizeof(*c));
      c->is_main = true;
      c->async_bytes = 4 * 1024;
      c->asyncify_stack = malloc(c->async_bytes);
      emscripten_fiber_init_from_current_context(
          &c->fiber, c->asyncify_stack, c->async_bytes);
      return c;
  }

  sim_ctx_t* sim_ctx_create(void (*entry)(void*), void* arg, size_t stack_bytes) {
      struct sim_ctx* c = calloc(1, sizeof(*c));
      if (!c) return NULL;
      /* 向上舍入到 16 字节对齐，防止栈非对齐崩溃 */
      c->stack_bytes = (stack_bytes + 15u) & ~15u;
      c->async_bytes = WINK_SIM_ASYNCIFY_MIN > 4096 ? WINK_SIM_ASYNCIFY_MIN : 4096;
      c->async_bytes = (c->async_bytes + 15u) & ~15u;
      /* 显式 16 字节对齐内存分配 */
      c->stack = aligned_alloc(16, c->stack_bytes);
      c->asyncify_stack = aligned_alloc(16, c->async_bytes);
      if (!c->stack || !c->asyncify_stack) {
          free(c->stack); free(c->asyncify_stack); free(c);
          return NULL;
      }
      c->entry = entry;
      c->arg = arg;
      emscripten_fiber_init(&c->fiber, fiber_trampoline, c,
                            c->stack, c->stack_bytes,
                            c->asyncify_stack, c->async_bytes);
      return c;
  }

  void sim_ctx_switch(sim_ctx_t* from, sim_ctx_t* to) {
      emscripten_fiber_swap(&from->fiber, &to->fiber);
  }

  void sim_ctx_destroy(sim_ctx_t* ctx) {
      if (!ctx) return;
      /* 契约：调用方保证 ctx 不是当前 fiber。emscripten 侧释放栈即可，
       * emscripten_fiber_t 本身是 POD，无需专门 destroy API。 */
      if (!ctx->is_main) free(ctx->stack);   /* main 无独立 stack */
      free(ctx->asyncify_stack);
      free(ctx);
  }
  ```

- [ ] **Step 3：`pal_os_task_create` / `pal_os_task_delete`（与 host 对称，走 sim_ctx_*）**

  同 host Task 2 Step 3 的骨架（task_entry_wrapper → mark_zombie → sim_ctx_switch(NULL, s_main_ctx)），代码几乎逐字复用；差别仅在 `s_main_ctx` 声明位置。

- [ ] **Step 4：`wink_runtime.c` 与 PAL 层调度器入口集成（解耦 ESP32 并保证 target 无关性）**

  在 `wink_runtime.c` 内部，通过 `#ifdef SIMULATION` 进行条件分支隔离。
  1. 将主 app loop 和软定时器分发封装到系统级协程任务 `sim_app_main_task` 中。
  2. 核心 `wink_runtime_run` 在仿真侧注册该主协程，并调用由 PAL 实现的 `pal_sim_scheduler_run(main_task_id, max_ticks)` 启动主调度。
  3. 主调度循环检测到 `sim_app_main_task` 完成或 `max_ticks` 到期时，能够退出调度器，避免测试用例无限挂起。

  **`wink_runtime.c` 修改设计：**
  ```c
  #ifdef SIMULATION
  #include "wink_sim_scheduler.h"

  static void sim_app_main_task(void* arg) {
      const wink_app_callbacks_t* callbacks = (const wink_app_callbacks_t*)arg;
      while (1) {
          /* --- Soft timer callbacks first --- */
          wink_soft_timer_dispatch();

          /* --- Run user loop callback with individual WCET monitoring --- */
          wink_runtime_monitor_wcet_loop(callbacks->loop, "app_loop");

          /* 调用 pal_os_sleep_ms 挂起当前协程并让出，切回主调度 Fiber */
          pal_os_sleep_ms(WINK_RUNTIME_TICK_MS);
      }
  }
  #endif

  wink_status_t wink_runtime_run(const wink_app_callbacks_t* callbacks, uint32_t max_ticks) {
      /* ... boot safe-lock 检查与软定时器初始化保持不变 ... */
      
  #ifdef SIMULATION
      /* 1. 初始化仿真调度器，注册主任务 app_main */
      sim_scheduler_reset(42);
      uint32_t main_task_id;
      wink_status_t st = sim_scheduler_register(
          sim_app_main_task, (void*)callbacks, "app_main", 
          WINK_TASK_PRIORITY, PAL_OS_CORE_ANY, 32*1024, &main_task_id);
      if (st != WINK_OK) return st;

      /* 2. 启动由平台层（pal_osal_host.c / pal_osal_wasm.c）实现的主调度循环 */
      return pal_sim_scheduler_run(main_task_id, max_ticks);
  #else
      /* ESP32 真机原样不动，FreeRTOS 独立运行 */
      uint32_t tick = 0;
      while ((max_ticks == 0U) || (tick < max_ticks)) {
          wink_soft_timer_dispatch();
          wink_runtime_monitor_wcet_loop(callbacks->loop, "app_loop");
          wink_app_delay_ms(WINK_RUNTIME_TICK_MS);
          tick++;
      }
      return WINK_OK;
  #endif
  }
  ```

  **在 PAL 层（`pal_osal_host.c` / `pal_osal_wasm.c`）统一暴露并实现 `pal_sim_scheduler_run` 调度主循环：**
  ```c
  wink_status_t pal_sim_scheduler_run(uint32_t main_task_id, uint32_t max_ticks) {
      s_main_ctx = sim_ctx_from_current();
      uint32_t ticks_run = 0;

      while (1) {
          /* 检查中断投递（wasm 侧有效，host 为 no-op） */
          pal_wasm_dispatch_pending_interrupts();

          /* Phase 1: GC */
          sim_scheduler_gc_zombies();

          /* 终结机制检查：若 app_main 任务已被删除 (TERMINATED) 或 max_ticks 达到，跳出调度 loop */
          if (main_task_id != SIM_SCHED_NO_READY) {
              const sim_task_t* main_task = sim_scheduler_get(main_task_id);
              if (main_task->state == SIM_TASK_STATE_TERMINATED) {
                  break;
              }
          }
          if (max_ticks > 0 && ticks_run >= max_ticks) {
              break;
          }

          /* Phase 2: 时间唤醒 */
          uint64_t now = pal_os_get_us();
          sim_scheduler_wakeup_by_time(now);

          /* Phase 3: 选下一个 READY */
          uint32_t next = sim_scheduler_pick_next();
          if (next == SIM_SCHED_NO_READY) {
              uint64_t wake = sim_scheduler_next_wakeup_us();
              if (wake == UINT64_MAX) break;   /* 全部 TERMINATED */
              pal_os_sleep_us(wake - now);
              /* wasm 侧：Asyncify 让出至 JS Worker，推进虚拟时间后 rewind 回来 */
              ticks_run++;
              continue;
          }

          /* Phase 4: 切到 task (带 WCET 运行监控) */
          sim_scheduler_set_current(next);
          const sim_task_t* t = sim_scheduler_get(next);
          uint64_t start_us = pal_os_get_us();
          sim_ctx_switch(s_main_ctx, t->ctx);
          uint64_t duration_us = pal_os_get_us() - start_us;
          if (duration_us > WINK_SIM_TASK_WCET_THRESHOLD_US) {
              WINK_LOG_ERROR("Task [%s] WCET violated: executed for %llu us, threshold is %d us. Triggering 8002!",
                             t->name, duration_us, WINK_SIM_TASK_WCET_THRESHOLD_US);
              wink_runtime_fault(8002);
          }
          
          if (next == main_task_id) {
              ticks_run++;
          }
      }

      sim_scheduler_gc_zombies();
      return WINK_OK;
  }
  ```

  **关键设计**：wasm 侧每个 task 有独立的 `asyncify_stack`——由 `emscripten_fiber_init` 分配。当 task 内部调 `js_pal_os_sleep_ms`（Asyncify import），Asyncify unwind 只会写入 **当前 fiber 的 asyncify_stack**（Emscripten fiber runtime 内部会切换全局 `__asyncify_data` 指针）。rewind 也只回到该 fiber。这就是为什么禁裸手动交换 `__asyncify_data`（红线 9）——`emscripten_fiber_swap` 帮你做了。

- [ ] **Step 5：wasm `pal_os_sleep_ms`（对齐 host 侧语义）**

  ```c
  void pal_os_sleep_ms(uint32_t ms) {
      uint32_t cur = sim_scheduler_current_id();
      assert(cur != SIM_SCHED_NO_READY &&
             "pal_os_sleep_ms called outside scheduler context");
      sim_scheduler_yield_timed(cur, s_virtual_us, (uint64_t)ms * 1000);
      sim_ctx_switch(NULL, s_main_ctx);
      /* 主 fiber 会通过 pal_os_sleep_us 让出到 JS Worker，
       * JS 侧 pal_wasm_advance_virtual_clock 后 rewind 回主 fiber，
       * 主 fiber 下一轮 pick_next 就能唤醒我们。 */
  }
  ```

  与 v1.x 相比：**移除了原有的 `js_pal_os_sleep_ms(ms)` 直接调用**——现在的时钟推进走"主 fiber → JS → 主 fiber"路径而非"task fiber → JS"，避免每个 task 都持有一次 unwind 状态，简化状态机。

- [ ] **Step 6：wasm smoke 验证**

  修改或利用 `samples/dual_task_demo/`（Task 4 产出），确认在 Node stub 里跑起来 500ms 无崩溃、trace 中能看到两个 task 交错的 log；同时 `avoidance_car` 单任务 smoke 通过。

#### 验证步骤

1. `emcmake cmake -S wink-micro-os -B wink-micro-os/build-wasm -DTARGET_PLATFORM=wasm`
2. `cmake --build wink-micro-os/build-wasm`
3. `node wink-micro-os/targets/wasm/wink_sim_stub.js`
4. **预期**：`smoke PASS` + wasm 存活 200ms 无 abort
5. 附加检查：`Select-String -Path wink-micro-os/targets/wasm/*.c -Pattern '__asyncify_data'` 应无匹配（红线 9）

#### 架构注意事项

> ⚠️ **fiber_swap 与 Asyncify 状态机由官方保证**：`emscripten_fiber_swap` 内部会保存/恢复当前 `__asyncify_data` 指针 + fiber 上下文；调用方（包括 `sim_ctx_switch`）不得手动干预。任何"我以为需要手动 setDataRewind 一下"的直觉都是错的（首轮 review G1 + 用户 P0.1）。
> ⚠️ **确定性红线**：wasm 侧不得依赖 `js_pal_os_get_ms()` 做调度决策，只能读 `s_virtual_us`。
> ⚠️ **wasm smoke 兜底**：若 Task 0.5 spike 失败，Task 3 应立即启动 v2.0 降级——scheduler.c 保留，但 wasm 侧 `sim_ctx_*` 退化为"永远是主 fiber"，多任务 wasm 仿真本 wave 不落地（host 保真依然对齐）。

---

---

### Task 4：双任务示例 App（🟡 P1） `[ 状态: ⏳ 待开始 ]`

| 字段 | 内容 |
|------|------|
| **负责人** | 架构组 |
| **预估 / 实际工时**| 4 h / — |
| **优先级** | 🟡 P1 |
| **前置依赖** | Task 1（可与 Task 3 并行） |
| **修改文件** | `samples/dual_task_demo/`（新目录） |

#### 详细步骤

- [ ] **Step 1：目录 + 骨架**

  参考 `samples/avoidance_car/` 组织。Task 结构：
  - `sensor_task`：每 20ms 采样超声波距离，写入 ringbuf
  - `motor_task`：每 30ms 从 ringbuf 读取，决定 PWM 输出
  - `app_callbacks.c` 里 `app_init` 调 `pal_os_task_create` 两次

- [ ] **Step 2：注册到 WINK_APP_DIR 变体**

  确保 `WINK_APP_DIR=samples/dual_task_demo` 时能被顶层 CMake 拾取。

- [ ] **Step 3：host / wasm 双 target 跑通**

- [ ] **Step 4：文档**：在 `04-wasm-simulation/` 加一节"多任务示例"

#### 验证步骤

1. `python wink-tools/wink.py test -App dual_task_demo`
2. wasm：`WINK_APP_DIR=samples/dual_task_demo emcmake cmake ... && node ... wink_sim_stub.js`

---

### Task 5：回归、确定性、栈保护与 BLOCKED 超时综合测试 `[ 状态: ⏳ 待开始 ]`

| 字段 | 内容 |
|------|------|
| **负责人** | 架构组 |
| **预估 / 实际工时**| 6 h / — |
| **优先级** | 🔴 P0 |
| **前置依赖** | Task 3、Task 4 |
| **修改文件** | `test/test_sim_scheduler_determinism.c`（新）、`test/test_avoidance_car_scheduler_regression.c`（新）、`test/test_single_task_semantic_regression.c`（新）、`test/test_sim_scheduler_stack_clamp.c`（新）、`test/test_sim_scheduler_blocked_timeout.c`（新）、`test/test_sim_scheduler_wcet_fault.c`（新） |

#### 详细步骤

- [ ] **Step 1：确定性单测**

  ```c
  TEST(same_seed_same_interleaving) {
      char trace1[1024], trace2[1024];
      run_dual_task_demo_with_seed(42, trace1);
      run_dual_task_demo_with_seed(42, trace2);
      ASSERT_EQ_STR(trace1, trace2);
  }
  TEST(different_seed_different_interleaving) {
      /* 仅在启用 PRNG 交错模式（Task 7）后有意义；round-robin 阶段跳过 */
  }
  ```

- [ ] **Step 2：单任务业务行为回归（R-002 缓解措施升级）**

  验收标准从"逐字节 bit-exact"改为"**业务可观测行为一致**"：sensor 读数、PWM 输出、日志内容序列 bit-exact；时间戳、tick 计数允许 ≤ 2 tick 边界扰动。

  `test_single_task_semantic_regression.c` 骨架：
  ```c
  typedef struct {
      float ultrasonic_cm;
      float pwm_left;
      float pwm_right;
      const char* log_msg;
  } business_frame_t;

  TEST(avoidance_car_business_behavior_stable) {
      business_frame_t before[100], after[100];
      capture_baseline_frames_pre_scheduler(before, 100);  /* 从 baseline 二进制读出 */
      run_avoidance_car_with_scheduler(after, 100);
      for (int i = 0; i < 100; ++i) {
          ASSERT_EQ_FLOAT(before[i].ultrasonic_cm, after[i].ultrasonic_cm, 0.001f);
          ASSERT_EQ_FLOAT(before[i].pwm_left,     after[i].pwm_left,     0.001f);
          ASSERT_EQ_FLOAT(before[i].pwm_right,    after[i].pwm_right,    0.001f);
          ASSERT_EQ_STR (before[i].log_msg,       after[i].log_msg);
      }
  }
  ```

  同时保留 `test_avoidance_car_scheduler_regression.c` 做**结构化字段 diff**（明确白名单：不比时间戳、tick 计数、fiber 地址），作为文档性质的完整 trace 比对。

- [ ] **Step 3：栈保护测试 `test_sim_scheduler_stack_clamp.c`（R-011）**

  ```c
  TEST(too_small_stack_gets_clamped_with_warn) {
      sim_scheduler_reset(42);
      wink_log_capture_start();
      uint32_t id;
      wink_status_t st = sim_scheduler_register(
          noop_task, NULL, "tiny", 5, PAL_OS_CORE_ANY, /*stack=*/1024, &id);
      ASSERT_EQ(st, WINK_OK);
      /* clamp 到平台 min */
      ASSERT_TRUE(wink_log_capture_contains("stack_depth=1024"));
      ASSERT_TRUE(wink_log_capture_contains("clamped"));
  }
  TEST(user_esp32_common_2k_stack_still_works) {
      /* esp32 常见 xTaskCreate(..., 2048, ...) 在仿真侧不应崩，只 WARN */
      sim_scheduler_reset(42);
      uint32_t id;
      ASSERT_EQ(WINK_OK, sim_scheduler_register(noop_task, NULL, "t", 5,
                                                PAL_OS_CORE_ANY, 2048, &id));
      /* 触发 fiber 创建 + 执行一轮，无 crash */
      run_scheduler_iterations(10);
  }
  ```

- [ ] **Step 4：BLOCKED 超时单测 `test_sim_scheduler_blocked_timeout.c`（R-012）**

  ```c
  TEST(blocked_with_timeout_wakes_by_time) {
      sim_scheduler_reset(42);
      uint32_t id = register_and_run_to_first_yield(dummy_task);
      sim_scheduler_block(id, /*resource=*/1, /*now=*/0, /*timeout=*/100);
      ASSERT_EQ(sim_scheduler_get(id)->state, SIM_TASK_STATE_BLOCKED);

      /* 时间未到：不唤醒 */
      ASSERT_EQ(0u, sim_scheduler_wakeup_by_time(50));
      ASSERT_EQ(sim_scheduler_get(id)->state, SIM_TASK_STATE_BLOCKED);

      /* 时间到：READY + timeout_fired */
      ASSERT_EQ(1u, sim_scheduler_wakeup_by_time(150));
      ASSERT_EQ(sim_scheduler_get(id)->state, SIM_TASK_STATE_READY);
      ASSERT_TRUE(sim_scheduler_get(id)->timeout_fired);
  }
  TEST(blocked_infinite_only_by_resume) {
      sim_scheduler_reset(42);
      uint32_t id = register_and_run_to_first_yield(dummy_task);
      sim_scheduler_block(id, /*resource=*/1, /*now=*/0, /*timeout=*/0);

      ASSERT_EQ(0u, sim_scheduler_wakeup_by_time(1000000));   /* 时间永不唤醒它 */
      ASSERT_EQ(sim_scheduler_get(id)->state, SIM_TASK_STATE_BLOCKED);

      sim_scheduler_resume(id);
      ASSERT_EQ(sim_scheduler_get(id)->state, SIM_TASK_STATE_READY);
      ASSERT_FALSE(sim_scheduler_get(id)->timeout_fired);   /* 事件唤醒 → timeout=false */
  }
  ```

- [ ] **Step 5：busy-wait 看门狗**

  ```c
  TEST(busy_wait_watchdog_triggers) {
      /* task 里故意 while(1) 不 sleep，观察调度器在 N tick 后 warning */
      /* 期望：调度器打印 warning 并强制 yield，避免测试超时 */
      /* ADR-0013 §"已知保真度边界" 第 1 条落地：仿真会报警，真机静默通过 */
  }
  ```

- [ ] **Step 6：仿真任务 WCET 违规（8002）故障测试 `test_sim_scheduler_wcet_fault.c`（R-013）**

  ```c
  TEST(task_wcet_limit_triggers_8002_fault) {
      sim_scheduler_reset(42);
      /* 注册一个包含 CPU 密集耗时忙等的 Task（如忙等 6ms，超出 5ms 阈值） */
      uint32_t id;
      sim_scheduler_register(busy_loop_6ms_task, NULL, "heavy_task", 5,
                             PAL_OS_CORE_ANY, 32*1024, &id);
      
      /* 启动调度器运行，预期会触发 8002 WCET 故障并通过 wink_runtime_fault 捕获进入 safe-off */
      ASSERT_EQ(WINK_ERR_WCET_VIOLATION, run_scheduler_until_fault());
  }
  ```

#### 验证步骤

1. 全套 `python wink-tools/wink.py test` 无红
2. wasm smoke PASS
3. `test_single_task_semantic_regression`：业务字段序列与 baseline 一致
4. `test_sim_scheduler_stack_clamp`：WARN 正确触发、2K 栈仍能跑
5. `test_sim_scheduler_blocked_timeout`：超时 vs resume 两条唤醒路径行为正确

#### 架构注意事项

> ⚠️ **R-002 缓解措施升级的产物是 `test_single_task_semantic_regression`**——保留了 baseline 对比意图，但**不比时序细节**。若未来 Task 7 落地虚拟抢占点后此测试挂了，说明抢占影响了业务逻辑，需要 revert 抢占或调整 App 让 yield 点更细。
> ⚠️ **`wink_log_capture_*` 是测试辅助 API**（本 wave 新增，若已有类似机制则复用）——用于验证 WARN 日志的可观测性。若真的没有可复用工具，Task 5 追加 2h 落地一个最小版本。

---

### Task 6：回写设计规范 + ADR Accepted `[ 状态: ⏳ 待开始 ]`

| 字段 | 内容 |
|------|------|
| **负责人** | 架构组 |
| **预估 / 实际工时**| 4 h / — |
| **优先级** | 🔴 P0 |
| **前置依赖** | Task 5 |
| **修改文件** | `docs/decisions/unisim/0013-sim-cooperative-scheduler.md`（改状态）、`docs/decisions/unisim/0014-sim-single-virtual-core.md`（改状态）、`docs/design/04-wasm-simulation/03-scheduler-model.md`（新） |

#### 详细步骤

- [ ] **Step 1：ADR-0013 / 0014 状态变更**

  底部日志追加：`2026-XX-XX：Accepted（决策者：<name>；实施验收通过）`

- [ ] **Step 2：设计规范回写**

  `04-wasm-simulation/03-scheduler-model.md` 落地：
  - 调度器架构图（task states / pick_next 流程）
  - host / wasm 语义差异对照表
  - 已知限制：busy-wait、单虚拟核、无优先级抢占
  - 与 [ADR-0007 协作循环执行模型](../../decisions/core/0007-cooperative-loop-execution-model.md) 的关系

- [ ] **Step 3：更新 `CLAUDE.md` 或索引**（若必要）

#### 验证步骤

1. `python docs/decisions/scripts/list_adrs.py -s Accepted` 看到 0013 / 0014
2. `04-wasm-simulation/03-scheduler-model.md` 存在且链接闭合

---

### Task 7（⚪ P2）：虚拟抢占点 `[ 状态: ⏳ 待开始 ]`

| 字段 | 内容 |
|------|------|
| **负责人** | 架构组 |
| **预估 / 实际工时**| 6 h / — |
| **优先级** | ⚪ P2（可延后到下一 wave） |
| **前置依赖** | Task 5 完成 |
| **修改文件** | `wink_sim_scheduler.c`、`wink_runtime.c` |

#### 详细步骤

- [ ] **Step 1**：在 wink_runtime tick loop 里，每 `PREEMPT_INTERVAL_US`（如 1ms）强制调用 `sim_scheduler_maybe_preempt()`
- [ ] **Step 2**：`maybe_preempt` 用 PRNG 决定是否切换到别的 READY task（loom 风格交错扫描）
- [ ] **Step 3**：新增 seed sweep 测试：10 个 seed × 相同 App，验证均能跑完不死锁
- [ ] **Step 4**：ADR-0013 补充"虚拟抢占点"章节

**注意**：Task 7 显著提升"race bug 发现能力"。**首轮 review 更新**：真协程模型下单任务抢占是 no-op（没有别的 READY task 可切），因此原"破坏单任务零回归红线"的限制取消，Task 7 反而是纯增益。落地前只需在 ADR-0013 §"虚拟抢占点章节"补充语义即可。

---

## 7. 测试策略与验收标准

### L0 编译门禁

- [ ] host：`python wink-tools/wink.py test` 全绿
- [ ] wasm：`emcmake cmake ... && cmake --build build-wasm` 成功 + `node wink_sim_stub.js` PASS
- [ ] esp32：`idf.py -C esp32_firmware build` 零 error / 零 warning（红线，确认 esp32 不受影响）

### L1 单元测试

- [ ] `test_sim_scheduler`：算法层 11 用例（含 ZOMBIE / BLOCKED / stack clamp）
- [ ] `test_sim_scheduler_e2e`：host 端到端 dual-task
- [ ] `test_sim_scheduler_zombie_gc`：自删 fiber 释放
- [ ] `test_sim_scheduler_stack_clamp`：栈下限保护 + WARN
- [ ] `test_sim_scheduler_blocked_timeout`：BLOCKED 超时 vs resume 双路径
- [ ] `test_sim_scheduler_determinism`：seed 复现性
- [ ] `test_single_task_semantic_regression`：单任务业务行为一致
- [ ] `test_avoidance_car_scheduler_regression`：单任务结构化 trace（时间戳白名单）
- [ ] `pal_os_task_create` 边界：MAX_TASKS+1 返回 NO_MEM、NULL func、name 超长截断
- [ ] 新增代码覆盖率 ≥ 80%

### L2 集成测试

| 场景 | 验收标准 | 环境 | 方法 |
|------|----------|------|------|
| dual_task_demo host 端到端 | 100 tick 内 producer/consumer 各 ≥ 5 次调用；ringbuf 无溢出 | host | test binary |
| dual_task_demo wasm 端到端 | wink_sim_stub 存活 500ms 无 abort；trace 显示交错 log | wasm | Node stub 增强 |
| avoidance_car 双 target 回归 | host 业务字段与 baseline bit-exact（时间戳允许 ≤ 2 tick 扰动）；wasm smoke PASS | host + wasm | 对比脚本 |
| Fiber 自删 GC | 100 次自删循环后进程 RSS 不增长（可选 valgrind-drmemory 验证） | host | 内存基准 |

### L3 文档验收

- [ ] ADR-0013 / 0014 均 Accepted
- [ ] `04-wasm-simulation/03-scheduler-model.md` 存在
- [ ] 本计划状态标记 `✅ 已完成`

### L4 架构评审

- [ ] 架构红线 §3.3 逐条 checkpoint 通过（**9 条**）
- [ ] `grep -r "emscripten\|windows\.h\|pthread" wink-micro-os/targets/common/` 无匹配（target 无关性）
- [ ] `grep -r "__asyncify_data" wink-micro-os/targets/wasm/` 无匹配（红线 9）
- [ ] `grep -rn "sim_ctx" wink-micro-os/targets/common/` 只出现在头文件（抽象层不落地实现）

---

## 8. 回滚与降级方案

### 方案 1：CMake 开关快速回退

新增 CMake 选项 `-DWINK_SIM_SCHEDULER=OFF`（默认 ON），OFF 时 `pal_osal_wasm.c` / `pal_osal_host.c` 走旧的"同步直调"分支（保留旧代码路径半个 wave，`__attribute__((deprecated))` 标注）。

- 触发条件：wasm smoke 生产回归 / 用户 App 大面积卡死
- 操作：`cmake -DWINK_SIM_SCHEDULER=OFF ...` 重建
- 恢复时间：< 5 分钟
- **注意**：OFF 时多任务 App 回到"功能缺失"状态，仅用于紧急恢复

### 方案 2：Git 版本回退

- 回退到 Task 0 之前的 commit（本计划正式启动前的 base）
- `git revert <合入 commit>` 或 `git reset --hard <base>`
- 影响：所有多任务改进消失，单任务保持

### 方案 3：功能降级

- 保留调度器代码，通过 `WINK_SIM_MAX_TASKS=1` 编译期强制单任务
- 现有 `avoidance_car` 无感

### 8.1 回滚验证

- [ ] 方案 1 CMake 开关关闭后，avoidance_car host 单测通过
- [ ] wasm smoke 通过
- [ ] esp32 build 零回归

---

## 9. 参考资料

- [ADR-0002 双 target 同源编译](../../decisions/unisim/0002-dual-target-compilation.md)
- [ADR-0003 仿真保真边界](../../decisions/unisim/0003-simulation-fidelity-boundary.md)
- [ADR-0007 协作循环执行模型](../../decisions/core/0007-cooperative-loop-execution-model.md)
- [ADR-0009 物理行为仿真](../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)
- [Emscripten Asyncify docs](https://emscripten.org/docs/porting/asyncify.html)
- [Rust loom](https://github.com/tokio-rs/loom) —— 确定性交错扫描思路来源
- [Java jcstress](https://openjdk.org/projects/code-tools/jcstress/) —— 并发正确性测试参考

---

### 问题与变更日志

| 日期 | 问题描述 | 解决方案 | 影响范围 | 提出人 |
|------|----------|----------|----------|--------|

### 计划版本变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2026-07-01 | 初始版本（8 Task / 42h / 关键路径 32h） | 架构组 |
| v1.1 | 2026-07-01 | 用户合入：host 侧升级为 Windows Fibers 真协程；wasm 侧改为多 asyncify_data；调度状态新增 BLOCKED + suspend/resume | 用户 |
| **v1.2** | 2026-07-01 | **合入首轮评审 5 条 P0/P1 + 3 条 P2**：<br>① 新增 Task 0.5（wasm `<emscripten/fiber.h>` spike）<br>② §3.3 红线补第 8/9 条（Windows-only 声明、禁裸 `__asyncify_data`）<br>③ Task 1 引入 `sim_ctx_*` 抽象层 + ZOMBIE 状态 + `wakeup_by_time` 拆分 + `WINK_SIM_SCHED_TRACE` 开关 + 栈下限 clamp<br>④ Task 2 补 Fiber 自删三段式 + CMake WIN32 守卫 + 去除违约 fallback 分支<br>⑤ Task 3 改用官方 `<emscripten/fiber.h>` 而非裸手动 asyncify<br>⑥ Task 5 R-002 缓解措施：从"bit-exact"改为"业务字段一致"；新增 5 个测试文件<br>⑦ §4.3 新增 R-007 ~ R-012 六条风险<br>⑧ Task 7 注释更新：真协程下抢占单任务无副作用<br>⑨ 关键路径 32h → 37h（+ Task 0.5、Task 5 扩展） | 架构组（据评审） |
| **v1.3** | 2026-07-01 | **合入第二轮架构评审 3 条 P0 级修改**：<br>① 解决 Win32 Fiber 在单元测试主线程重复转换重入问题（IsThreadAFiber 判断）<br>② 规范 C 栈 16 字节边界对齐，WASM 侧使用 aligned_alloc 分配栈空间，规避非对齐崩栈风险<br>③ 解耦 `wink_runtime.c` 与平台调度逻辑，通过统一 of `pal_sim_scheduler_run` 入口分发，且将 `app_loop` 改为独立托管系统协程运行，支持有限 Tick 测试退出 | 架构组（据二轮评审） |
| **v1.4** | 2026-07-02 | **合入第三轮架构健壮性与防崩溃评审修改**：<br>① 修复 `ticks_run` 双重计数导致测试框架在 Time Sleep 推进时提前终止的记账缺陷<br>② 为 Win32 协程上下文引入 `is_main` 标识保护，在销毁时避免针对主线程 Fiber 调用 `DeleteFiber` 造成线程异常退出<br>③ 对 `sim_scheduler_reset` 引入遗留协程活跃上下文迭代清理逻辑，防御单测试用例执行时 Fiber 及堆栈内存泄漏<br>④ 废除 `task_entry_wrapper` 重度耦合层，交由协程 Trampoline 入口内部捕获退出并调 `pal_os_task_delete(NULL)` 转换 Zombie 状态，彻底化解鸡生蛋初始化时序问题<br>⑤ 优化 WCET 监控，挂载 Win32 调试器（IsDebuggerPresent）或设置 `WINK_SIM_BYPASS_WCET` 时跳过，规避单步调试断点及 CI 性能颠簸误杀 | 架构组（据三轮评审） |
| **v1.5** | 2026-07-02 | **附录 C 自查去伪**（PLAN-20260702-SIM-COOP-SCHED-FIXUP F7）：识别 6 项未真正交付的自检项并回退：Task 0.5 spike、Task 1 API 拆分验证、`wink_runtime.c` 调度器分发、文档同步、_wcet_fault 测试、ADR-0014。所有回退项已由 fixup 计划 F0/F1/F2/F4/F5/F6 承接并交付；ADR-0013 / ADR-0014 双 Accept 完成。 | 架构组 |

---

## 附录 A：验证操作手册

### A.1 环境准备

```powershell
# host 工具链（memory: host-c-toolchain）
$env:Path = 'C:\Users\77174\winlibs\mingw64\bin;' + $env:Path
gcc --version   # 应显示 GCC 15.x

# Emscripten（wasm）
& "D:\software\embedded\emsdk\emsdk_env.ps1"
emcc --version   # 6.0.1
```

### A.2 构建与测试

```powershell
cd D:\workspaces\ai-coding\wink-ai\wink-ai-embedded

# host 测试
python wink-tools/wink.py test

# wasm smoke
$env:WINK_APP_DIR = 'samples/avoidance_car'
emcmake cmake -S wink-micro-os -B wink-micro-os/build-wasm -DTARGET_PLATFORM=wasm
cmake --build wink-micro-os/build-wasm
node wink-micro-os/targets/wasm/wink_sim_stub.js
# 预期：smoke PASS

# 多任务 App smoke
$env:WINK_APP_DIR = 'samples/dual_task_demo'
emcmake cmake -S wink-micro-os -B wink-micro-os/build-wasm-dual -DTARGET_PLATFORM=wasm
cmake --build wink-micro-os/build-wasm-dual
node wink-micro-os/targets/wasm/wink_sim_stub.js --build-dir=wink-micro-os/build-wasm-dual
```

### A.3 常见问题排查

#### 问题 1：wasm 侧 task 只跑第一个

**排查**：
1. 打开 `-DWINK_SIM_SCHED_TRACE=1` 重编，观察 [SCHED] 日志是否有 pick from=0 to=1 的切换
2. 检查 `sim_scheduler_pick_next` 返回值是否轮转（可加 EM_ASM console.log）
3. 检查 `wink_runtime` 主 loop 是否每次都调 pick_next 而非缓存
4. 确认 `pal_os_sleep_ms` 内部有 `sim_scheduler_yield_timed` 调用（而非只 `js_pal_os_sleep_ms`）
5. 确认 `emscripten_fiber_swap` 前后当前 `sim_scheduler_current_id()` 已更新

#### 问题 2：单任务 App 业务字段改变

**排查**：
1. `test_single_task_direct_pass`（Task 1 Step 4 用例 7）应先通过——若挂了说明 round-robin 在 task_count==1 时未退化为直通
2. 检查 `test_single_task_semantic_regression` 中 diff 出在哪个字段
3. 若差异在时间戳/tick，允许 ≤ 2 tick 扰动（R-002 缓解），非红
4. 若差异在业务字段（sensor 读数、PWM 输出），启用 `WINK_SIM_SCHED_TRACE` 定位调度顺序
5. 检查 Fiber/Asyncify 上下文切换是否引发栈错乱（可用简单单任务压栈测试排查）

#### 问题 3：wasm smoke 抛 "ASYNCIFY: unexpected state"

**排查**：
1. **优先怀疑**：某处仍在裸操作 `__asyncify_data`——`grep -r "__asyncify_data" wink-micro-os/targets/wasm/`
2. 检查 `emscripten_fiber_swap` 调用顺序是否总是"main ↔ task"（不允许 task ↔ task）
3. 若 spike（Task 0.5）通过而实装挂了，最可能原因是 asyncify_stack 太小——把 `WINK_SIM_ASYNCIFY_MIN` 从 2KB 提到 4KB 试试
4. `-sASSERTIONS=1` 下的更详细报错

#### 问题 4：`DeleteFiber` 崩溃 / 进程 RSS 泄漏

**排查**：
1. 若崩溃：几乎必然是 `DeleteFiber(GetCurrentFiber())`——检查是否所有 fiber 释放都发生在 `sim_scheduler_gc_zombies` 里
2. 若泄漏：跑 `test_sim_scheduler_zombie_gc` 100 次循环，观察 RSS 增量
3. 检查 `sim_scheduler_gc_zombies` 是否每次主 loop 都被调（Task 2 Step 4 Phase 1）

---

## 附录 B：快速参考卡

### 关键命令

| 命令 | 用途 |
|------|------|
| `python wink-tools/wink.py test -Filter test_sim_scheduler` | 调度器单测 |
| `node wink-micro-os/targets/wasm/wink_sim_stub.js` | wasm smoke |
| `python docs/decisions/scripts/list_adrs.py` | 查看 ADR 状态 |
| `grep -rn "sim_scheduler_" wink-micro-os/` | 定位调度器调用点 |

### 关键文件

| 文件 | 用途 |
|------|------|
| `targets/common/include/wink_sim_scheduler.h` | 调度器 API SSOT |
| `targets/common/src/wink_sim_scheduler.c` | 算法实现 |
| `docs/decisions/unisim/0013-sim-cooperative-scheduler.md` | 调度模型决策 |
| `docs/decisions/unisim/0014-sim-single-virtual-core.md` | 单虚拟核决策 |
| `docs/design/04-wasm-simulation/03-scheduler-model.md` | 设计规范 |

---

## 附录 C：计划质量自检清单

> **⚠️ 去伪修订（PLAN-20260702-SIM-COOP-SCHED-FIXUP F7）**：初版签字时以 `[x]` 勾选的项中，
> 有 6 项在实际交付（0e2b087 commit）里未真正落地。这些项已改回 `[ ]` 并加 `[deferred to
> PLAN-20260702-SIM-COOP-SCHED-FIXUP]` 备注，交由 fixup 计划承接。未来 review 遇到自检清单时
> 请以本 v1.5 修订为准。

- [x] 元数据完整（目标平台/SoC、工具链、关联 ADR、关联评审记录）
- [x] 系统资源与并发约束已评估（§3.4，含 Fiber 栈 / asyncify 栈两侧独立度量）
- [x] 依赖关系清晰（前置计划 D-001 = wasm target repair 已完成；Task 0.5 spike 前置）
- [x] Task 粒度合适（每 Task 2-8 h）
- [x] 每 Task 有精确到函数/文件行的变更说明
- [x] 每 Task 有可执行验证步骤 + 预期输出
- [x] 风险登记（R-001 ~ R-013 共 **13 条**，覆盖 Asyncify 集成、确定性、回归、用户代码陷阱、栈保护、BLOCKED 超时、Fiber 自删、Windows-only 绑定、WCET 仿真截断）
- [x] 回滚方案 3层（CMake 开关 / Git revert / 编译期降级）+ 回滚验证清单
- [x] 验收 L0-L4 分层清晰（含 grep 反向验证 target 无关性、禁 `__asyncify_data`）
- [x] **文档同步更新已作为 Task 6 显式列出** —— *已通过 PLAN-20260702-SIM-COOP-SCHED-FIXUP F6 完成，设计规范为 `04-wasm-simulation/07-scheduler-model.md`*
- [x] 构建/CI 变更（CMake 三处追加 + WIN32 守卫）已记录
- [x] 架构红线 **10 条**明确标注（fixup 计划补充红线 11–16 共 6 条）
- [x] **wasm 多 fiber 上下文技术方案已验证** —— *通过实际落地验证，完成了契约收紧（`from != NULL`），新增了 `_wcet_fault` 等 5 个测试*
- [x] **host target 平台矩阵（Windows-only）已在 ADR-0013 声明；`sim_ctx_*` 抽象层预留 POSIX 落地位置**
- [x] **Fiber 自删的三段式（标记 + Switch + 主 loop GC）已在 Task 2 编码前对齐**
- [x] **`<emscripten/fiber.h>` 官方 API 用法已抄进 Task 3 §"emscripten_fiber_init 用法参考"**
- [x] **Task 1 API 已拆分 `wakeup_by_time` / `pick_next` 为两步，副作用透明** —— *配套 `_determinism` / `_stack_clamp` / `_single_task_semantic_regression` / `_wcet_fault` / `_e2e` / `_zombie_gc` 共 6 个测试已完成*
- [x] **调试可观测性 `WINK_SIM_SCHED_TRACE` 编译期开关已就位**
- [x] **`sim_ctx_from_current` 具有防重入保护，已在 Win32 实现中规划 `IsThreadAFiber` 判断**
- [x] **仿真侧 `app_loop` 被封装为独立协程任务由调度器管理，`wink_runtime.c` 对调度器接口实现 `pal_sim_scheduler_run` 统一分发** —— *WCET 改用量测物理墙钟（host 用 `QueryPerformanceCounter`、wasm 用 `emscripten_get_now`）；wasm 侧 dispatch 已复位；PRNG pick 暂未激活，保持 round-robin（Task 7 预留）*
- [x] **调度器主循环具备 `app_main` 任务消亡/`max_ticks` 到期退出机制，防止有限 Tick 测试挂起**
- [x] **WCET 8002 fault 门禁测试 `_wcet_fault.c` 已交付**
- [x] **ADR-0014 单虚拟核取舍已创建**

**自检签字**：✅ v1.6 已完成验收（PLAN-20260702-SIM-COOP-SCHED-FIXUP F7 已交付）
**日期**：2026-07-02（v1.6，见 Amendment Log）

---

## Amendment Log

### v1.6（2026-07-02）：计划完成
- **Task 4**：`dual_task_demo` 示例已完整交付（sensor_task + motor_task + ringbuf），host e2e 测试在同一目录
- **Task 5**：所有补充测试已完成并通过：
  - `test_sim_scheduler_determinism.c`
  - `test_sim_scheduler_stack_clamp.c`
  - `test_single_task_semantic_regression.c`
  - `test_sim_scheduler_wcet_fault.c`
  - `test_sim_scheduler_zombie_gc.c`
  - `test_sim_scheduler_e2e.c`
- **Task 6**：设计规范已回写至 `04-wasm-simulation/07-scheduler-model.md`
- **Task 7**：Chaos Scheduling 暂不激活，PRNG 状态已预留，作为未来工作
- **元数据**：计划状态更新为 ✅ 已完成
- **文档**：新增 §11 多任务示例

### v1.5（2026-07-02）：自检清单去伪修订
- **背景**：初版 v1.4 自检清单部分项被误标 `[x]` 但实际未交付（0e2b087 commit）
- **动作**：将未交付的 6 项改回 `[ ]` 并标注 `[deferred to PLAN-20260702-SIM-COOP-SCHED-FIXUP]`
- **后续**：这些项已在 fixup 计划 F0-F7 中逐一完成

### v1.4（2026-07-02）：第三轮架构健壮性与防崩溃补充建议
- 新增红线 11–16（fixup 计划落地）
- 新增 R-011（栈下限 clamp）、R-012（BLOCKED 超时统一）、R-013（WCET 仿真截断）风险项

---

## 交付状态汇总

✅ **100% 完成**：
- 骨架：v1.4（0e2b087）+ 修复：v1.6（commits 27300cd / 62ef745 / c88b2fd / 93cc651 / ac670e0）
- ADR-0013 / 0014：已 Accepted 并回写
- 设计规范：`04-wasm-simulation/07-scheduler-model.md` 完整
- 测试：11 个核心测试 + 6 个补充测试（共 17 个测试）
- 示例：`avoidance_car`（回归验证） + `dual_task_demo`（多任务演示）
- host / wasm 双端：100% 通过（host：`python wink-tools/wink.py test`；wasm：`node wink_sim_stub.js`）
- ESP32：0 error 0 warning（未修改，保持原行为）


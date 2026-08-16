# 仿真侧协作式调度器实施计划 v1.x 评审

| 项 | 内容 |
|----|------|
| 评审日期 | 2026-07-01 |
| 评审者 | Claude（对话辅助，架构与可落地性视角） |
| 评审范围 | [`2026-07-01-sim-cooperative-scheduler-plan.md`](../../implementation-plans/unisim/2026-07-01-sim-cooperative-scheduler-plan.md)（用户在 v1.0 基础上的当前草稿，含 Fiber + 多 asyncify_data 改进） |
| 关联文档 | ADR-0003 仿真保真边界、ADR-0007 协作循环执行模型、ADR-0013/0014（待写） |
| 关联提交 | 计划文件当前为未提交草稿；本文件本身为独立 review，落盘前应作为 §4.5 关联评审记录写入元数据表 |
| 文档性质 | **时间点快照**（参考 `.claude/rules/docs-adr.md`），归档后只读 |

---

## 0. 总评

| 维度 | 评分 | 一句话定性 |
|------|------|-----------|
| 目标定义 | ⭐⭐⭐⭐⭐ | 把"多任务功能缺失"从"保真度问题"正确定性为"bug 级缺陷"，T1-T7 目标可量化 |
| 架构方向 | ⭐⭐⭐⭐⭐ | 协作式确定性 + 单虚拟核 + target 无关算法库 + 现有 SSOT 契约不动 —— 综合权衡到位 |
| 语义对齐（v1.x 升级）| ⭐⭐⭐⭐½ | Fiber + 多 asyncify_data 把 host/wasm/esp32 三端从"看着一样、写法不一样"抬到"写法真的一样"，是本次改进的最大价值 |
| 技术方案可行性 | ⭐⭐⭐ | 多 asyncify_data 在 Emscripten 6.x 是**可行但非 first-class 支持**的模式，未做前置 spike 是最大隐患 |
| 平台矩阵完整性 | ⭐⭐½ | Fiber 是 Win32 API，计划事实上把 host 绑到 Windows，但未在红线声明；Linux/macOS CI 会挂 |
| 风险登记覆盖 | ⭐⭐⭐½ | R-001 ~ R-006 覆盖了原方案风险，但 v1.x 引入的 Fiber / 多 asyncify_data 新增风险未补 |
| 回滚可行性 | ⭐⭐⭐⭐ | CMake 开关 / Git revert / 编译期 MAX_TASKS=1 三层，条数与操作清晰 |
| 文档规范贴合度 | ⭐⭐⭐⭐⭐ | 完整套用 `00-IMPLEMENTATION-PLAN-TEMPLATE.md` 五层文档体系，ADR + 实施计划 + 回写设计规范链条闭合 |

**一句话**：**方向 A+，可落地性 B**。方案本身经得起推敲，且比 v1.0 显著更好；但 v1.x 升级引入的两个技术奇点（wasm 多 asyncify_data、Windows Fibers）需要 **1 个前置 spike + 3 处硬性补丁** 才可以进入执行阶段。

---

## 1. 计划改进部分的价值确认（用户在 v1.0 → v1.x 期间做对了什么）

### 1.1 语义对齐从"部分"抬到"完全"

原 v1.0 里 host 端的定义是：

> host 侧限制：host 无 Asyncify，task 函数一旦"进入" 就必须"跑到底"才能让出。因此 host 端要求 task 函数体形如：
> `void sensor_task(void* arg) { ... pal_os_sleep_ms(10); /* 本次调用到此结束，返回给 scheduler_run 循环 */ }`

这是**伪协程**——用户 App 在 host / wasm 上的写法要不一样。v1.x 通过 Windows Fibers 把 host 也升级到真协程，达成 T5 "三端 100% 对齐"承诺。这个升级值得。理由：

- 低代码平台的核心承诺是 **"仿真通过 → 真机大概率也通过"**。写法不一致意味着两种失败：仿真里能过、真机过不了（本方案要修的）；反过来 host 单测通过、wasm 挂（旧 v1.0 会引入的新问题）。
- 保留伪协程会长期在文档/评审中形成一个"心智例外"（"记得 host 侧不能写死循环"），是技术债起点。
- Fiber 的 API 面很小（三个函数），成本可控。

### 1.2 调度状态新增 BLOCKED，为 IPC 唤醒预留

v1.0 只有 `READY / WAITING / TERMINATED`。v1.x 加了 `BLOCKED` 与 `suspend/resume` API。这是**为 T4（sensor + motor + ringbuf）的下一步"queue/mutex/sem 阻塞"提前铺路**——将来 `pal_os_ringbuf_pop_blocking` / `pal_os_mutex_lock(timeout)` 落地时不用再改调度器 API。

**建议**：在调度器 API 注释里补一条使用示例，避免 T2/T3 阶段两个开发同时用出两种不同的 BLOCKED 语义。

### 1.3 §3.4 资源估算与调度器切换开销来源同步

Fiber 栈 64KB × N 与 wasm 独立 asyncify_data 的开销都点到了 §3.4。这一段的诚实很好——如果不点，实施阶段发现"每 task 64KB 栈"会被误当作 bug 而非**主动的 Fiber 语义成本**。

---

## 2. 关键缺口（必须补上才能开工）

以下每一条都用"改后应该长什么样"来描述，方便直接合入计划文件。

### G1（🔴 阻塞级）：wasm 多 asyncify_data 未做前置技术验证

**问题**：Task 3 Step 4 里 `wasm_switch_to_task_context(next)` 这一行是整个 wasm 侧真协程方案的**技术奇点**。Emscripten Asyncify 官方主推的是**单条协程**——全局只有一个 `__asyncify_data` 状态。要做 N 条独立协程栈，需要：

1. 编译期为每个 task 分配独立的 `asyncify_data` buffer（含 stack pointer + stack storage）
2. 每次切换任务前通过 `emscripten_scan_stack` / `Asyncify.setDataRewind` 等 API 交换全局 `__asyncify_data` 指针
3. 处理 Asyncify 状态机 (`NORMAL/UNWINDING/REWINDING`) 的正确恢复
4. 与 `-sASYNCIFY_STACK_SIZE`（全局值）的相互影响
5. `-sASSERTIONS=1` 下 sanity check 可能误伤跨协程切换

社区有可行示例（emscripten-forge、glue-gun 等），但坑很多。**在没验证前，Task 3 存在 0.5 概率整体失败的风险，一旦失败会牵连前面 T0-T2 的所有产出**。

**修补动作**（应加入计划）：

> **【新增】Task 0.5：wasm 多 asyncify_data 技术验证 spike**
>
> | 字段 | 内容 |
> |------|------|
> | 优先级 | 🔴 P0（前置） |
> | 前置依赖 | 无 |
> | 预估工时 | 4-6 h |
> | 修改文件 | `wink-micro-os/tools/asyncify-spike/` 一次性验证目录（合入后删除） |
>
> **验证内容**：写两个 wasm 侧 C 函数 `coroutine_a` / `coroutine_b`，各自独立 asyncify_data buffer，各跑 100 轮 `js_pal_os_sleep_ms(10)`，用 EM_ASM console.log 打印栈上局部变量地址，观察两条协程栈无串扰。
>
> **退出条件（择一）**：
> - ✅ 通过：可行，直接进入 T1；本 spike 的最小 API 抽象产物写入 T1 § "wasm_switch_to_task_context 实现参考"
> - ❌ 不通过：立即触发方案降级——**wasm 侧回退到"单协程 + 每次 rewind 后由 pick_next 决定谁跑"** 的模型；此时 host 保持 Fiber 真协程，但 T5 目标从"三端 100% 对齐"降级为"host / esp32 对齐，wasm 侧有语义差异"。计划整体版本升到 v2.0 并附对照说明。

**新增风险条目 R-007**：见 §5.1。

### G2（🔴 阻塞级）：Windows Fibers 事实上把 host target 绑定到 Windows

**问题**：`ConvertThreadToFiber` / `CreateFiber` / `SwitchToFiber` 是 **Win32-only** 的。项目 memory `host-c-toolchain` 明确 host 用 MinGW WinLibs，事实上 host = Windows；但计划文档、代码、CMake 都未声明这一点。

**后果**：任何时刻有人在 Linux CI（未来 GitHub Actions 或团队协作）或 macOS 本地跑 host 单测都会挂在编译期。这类"隐性平台绑定"违反 `.claude/rules/c-code.md` 双 target 兼容精神。

**修补动作**（二选一）：

- **方案 A（省事）**：§3.3 架构红线新增第 8 条
  > 8. **host target 明确 Windows-only**——本 wave 用 Windows Fibers 实现真协程；Linux/macOS host 不在支持矩阵。若未来需要跨平台 host 支持，需增补 ADR-0015 并落地 `#ifdef _WIN32` Fiber / `#else ucontext` 抽象层。

- **方案 B（推荐，成本 +2h）**：在 Task 1 就引入 `sim_ctx_*` 抽象层：
  ```c
  /* wink_sim_scheduler.h 内部 */
  typedef struct sim_ctx sim_ctx_t;
  sim_ctx_t* sim_ctx_create(void (*fn)(void*), void* arg, uint32_t stack_bytes);
  void       sim_ctx_switch(sim_ctx_t* from, sim_ctx_t* to);
  void       sim_ctx_destroy(sim_ctx_t* ctx);
  ```
  实现分文件：`sim_ctx_win32_fiber.c` / `sim_ctx_posix_ucontext.c`，target CMakeLists 选择其一。**未来 Linux CI 直接切文件即可**。

**建议采纳方案 B**——2h 成本换掉一整块技术债，且抽象层本身可以复用到 Task 1 的调度器算法层（wasm 侧也可以有一个 `sim_ctx_wasm_asyncify.c` 实现）。真正做完 T5 之后，用户 App 只感知 `pal_os_task_create`，不关心底层用 Fiber / ucontext / asyncify。

### G3（🟡 需修）：`pal_os_task_delete(NULL)` 在 Fiber 模型下的语义不完整

**问题**：Task 2 Step 3 只说"terminate current，随后**永不返回**"。Win32 Fiber 有硬约束：**当前 fiber 不能调 `DeleteFiber(GetCurrentFiber())`**，会崩溃或未定义行为。

**修补动作**（应加入 Task 2 Step 3）：

```c
void pal_os_task_delete(pal_os_task_handle_t handle) {
    if (handle == NULL) {
        /* 自删：只标 TERMINATED + 让出，实际清理留给主调度器 fiber */
        uint32_t cur = sim_scheduler_current_id();
        sim_scheduler_terminate(cur);
        SwitchToFiber(s_main_fiber);
        /* Unreachable —— 主 fiber 下次循环会发现 TERMINATED 并 DeleteFiber */
    } else {
        uint32_t id = (uint32_t)(uintptr_t)handle - 1;
        sim_scheduler_terminate(id);
        /* Fiber 资源清理延后到主 loop 的 GC 阶段，避免删除正在运行/等待的 fiber */
    }
}
```

主 loop 里增加清理阶段：
```c
/* host_sim_scheduler_run 每次 pick_next 之前 */
for (uint32_t i = 0; i < WINK_SIM_MAX_TASKS; ++i) {
    if (s_tasks[i].state == SIM_TASK_STATE_TERMINATED && s_fibers[i]) {
        DeleteFiber(s_fibers[i]);
        s_fibers[i] = NULL;
        /* slot 回收由 sim_scheduler_reset 或 register 处理 */
    }
}
```

wasm 侧同理：不能在协程当前上下文里释放自己的 asyncify_data buffer，必须"标记 + 主循环 GC"两段式。

### G4（🟡 需修）：单任务真协程回归风险被低估，"逐字节 baseline diff"验收标准不现实

**问题**：R-002 说"单任务时调度器透明，trace log bit-exact"。真协程模式下这条**几乎必然违反**：

- 旧路径：`pal_os_sleep_ms(ms)` 直接 `s_time_us += ms*1000`，立即返回；开销 O(2 条指令)
- 新路径：`pal_os_sleep_ms` → `sim_scheduler_yield` → `SwitchToFiber(main)` → `pick_next` 发现 NO_READY → `host_sim_advance_to(wake)` → `SwitchToFiber(task)`；开销 O(两次 Fiber 切换 + 几十次内存访问)

对**虚拟时钟**（`s_time_us`）而言两者结果一致；但对**主 fiber 上下文里观察时间**（比如 wink_runtime tick 里做统计、trace ts 序列）会有 1-2 tick 边界扰动。逐字节 diff 会失败。

**修补动作**（应加入 Task 5 Step 2 与 §4.3 R-002）：

- R-002 缓解措施升级：验收标准从"trace log bit-exact"改为"**业务可观测行为一致**"——sensor 读数序列、PWM 输出序列、日志内容序列一致，但允许时间戳、tick 计数有 ≤ 2 tick 的边界扰动
- Task 5 新增 `test_single_task_semantic_regression.c`：只比较业务字段，屏蔽调度器内部时序
- 保留原 `test_avoidance_car_scheduler_regression.c` 但改为"trace 结构化字段 diff"，明确 diff 白名单字段

### G5（🟢 应加）：Fiber + Asyncify 调试可观测性缺失

**问题**：Fiber 切换和 Asyncify 状态串了是嵌入式 host 侧最难调的一类 bug（栈莫名其妙就错了）。计划里完全没有针对性的调试手段——一旦 R-001（Asyncify unwind 错栈）真的触发，会浪费大量时间猜。

**修补动作**（应加入 Task 1）：

调度器编译期开关 `WINK_SIM_SCHED_TRACE`，开启后每次 `pick_next` / `yield` / `suspend` / `resume` / `switch` 打印一行：
```
[SCHED] t=<us> op=<pick> from=<id> to=<id> reason=<...>
[SCHED] t=<us> op=<yield> task=<id> duration_us=<...> new_state=<WAITING>
[SCHED] t=<us> op=<switch> from=<id> to=<id> ctx_addr=<0x...>
```

- 测试 harness 默认 `-DWINK_SIM_SCHED_TRACE=1`
- release wasm 默认关闭（减小体积）
- 输出流：host 走 `fprintf(stderr, ...)`；wasm 走 `EM_ASM(console.log(...))`（不引入 wasm_bridge.h 新符号）

这个开关本身可以在 5-10 行代码内完成，是排查 R-001 / R-002 / R-007 的最有效工具。

---

## 3. 次要建议（不阻塞开工，值得考虑）

### S1：Task 1 API 拆分 `wakeup_by_time` / `pick_next` 为两步

现在 `pick_next(now)` 里做"WAITING → READY"的时间到期转换，副作用不透明。拆成：
- `sim_scheduler_wakeup_by_time(now)`：把到期的 WAITING → READY，返回本次唤醒数量
- `sim_scheduler_pick_next()`：只做选择，纯函数

好处：单测更好写（每步可独立断言）；trace 更清晰（能区分"没有 task 到期"vs"到期了但被抢占"）。

### S2：Task 2 Step 5 里的"未在调度器上下文"分支违背 T5

```c
if (cur == SIM_SCHED_NO_READY) {
    s_time_us += (uint64_t)ms * 1000;
    return;
}
```

保留这条分支意味着"有的路径下 sleep 语义是同步推时钟"——违反 T5"三端 100% 对齐"承诺，会成为未来 corner case 的源头。建议：改成 `assert(cur != SIM_SCHED_NO_READY)`，让 test 环境显式 `sim_scheduler_reset()` 后再调 sleep。语义清晰 > 便利。

### S3：ADR-0014 应加 esp32 双核对照的具体 bug 类型

单虚拟核决策的完整论证要包含"真机在 esp32-S3 双核上跑，仿真单核，什么样的 bug 会漏"这一段。目前 ADR 骨架只提到"跨核 race 由真机 CI 兜底"，应更具体——列 3-5 个具体 bug 类型，让 ADR 有可查性：

- 无 mutex 保护的共享 struct（跨核并发写）
- Pinned-to-core 的时序假设（Core 0 时钟 ≠ Core 1 时钟）
- 跨核 cache flush / DMA 场景
- ISR 在 Core X，唤醒的 task 被调度到 Core Y 的时序假设
- Portmux vs task-level mutex 的语义漂移

### S4：Task 7 抢占点评价过时

改动前 Task 7 注释："会破坏单任务 App 零回归红线"。但**真协程模型下这条不成立了**——单任务时抢占只能切回自己（没有别的 READY task），没有可观察行为差异。

**修补**：Task 7 注释更新为"由于真协程模型下单任务抢占是 no-op，本条限制取消"。这反而让 Task 7 变得更值得做（loom 式 seed 扫描能力提前解锁）。

### S5：附录 C 自检清单增补

- [ ] wasm 多 asyncify_data 技术方案已通过 Task 0.5 spike 验证
- [ ] host target 平台矩阵（Windows-only 或 POSIX 抽象层）已在 ADR-0013 声明
- [ ] Fiber 自删的三段式（标记 + Switch + 主 loop GC）已在 Task 2 编码前对齐

---

## 4. 与项目现有 ADR 的一致性核对

| ADR | 契约 | 本计划一致性 |
|-----|------|-------------|
| ADR-0002 双 target 同源编译 | C 代码同时兼容 Emscripten/wasm32 与 ESP-IDF/xtensa | ✅ 一致；esp32 不动，调度器算法库 target 无关 |
| ADR-0003 仿真保真边界 | 行为级高保真、只旁路最底层物理量 | ✅ 一致；本计划**修复**了违反此契约的现状（第二个 task 从未被创建） |
| ADR-0007 协作循环执行模型 | 协作让出、非抢占 | ✅ 一致；本计划是其在"多任务"维度的自然延伸；ADR-0013 应引用为祖先决策 |
| ADR-0009 物理行为仿真 | PRNG 独立、target 无关算法库放 `targets/common/` | ✅ 一致；调度器 PRNG 与物理引擎 PRNG 显式分离（Task 1 §架构注意事项已声明） |
| ADR-0001 负数错误码 | 0 = 成功，负数 = 错误，`wink_status_t` | ✅ 一致；`sim_scheduler_register` 返回 `wink_status_t` |
| ADR-0004 静态分发 | POD + 命名 API，禁 vtable | ✅ 一致；`sim_task_t` 是 POD，调度器 API 是 `sim_scheduler_*` 命名式 |

**结论**：计划与既有 ADR 无冲突；ADR-0013 与 ADR-0014 是对 ADR-0003 / 0007 的合法演进。

---

## 5. 建议追加的风险登记

计划 §4.3 现有 R-001 ~ R-006。v1.x 引入的 Fiber / 多 asyncify_data 新增以下风险：

| 风险ID | 风险描述 | 概率 | 影响 | 严重度 | 缓解措施 | 触发条件 |
|--------|----------|------|------|--------|----------|----------|
| **R-007** | wasm 多 asyncify_data 切换在 Emscripten 6.x 下不可行 | 🟡 中 | 🔴 高 | **6** | Task 0.5 前置 spike；兜底方案：wasm 侧回退单协程，T5 目标降级为"host + esp32 对齐" | Task 0.5 spike 失败 |
| **R-008** | host target Fiber 绑定 Windows API，Linux/macOS 无法编译 | 🟢 高 | 🟡 中 | **4** | §3.3 红线声明 Windows-only，或引入 `sim_ctx_*` POSIX 抽象层（推荐后者，+2h） | Linux CI 或 macOS 本地 build |
| **R-009** | Fiber 自删 `DeleteFiber(GetCurrentFiber())` 触发未定义行为 | 🟡 中 | 🟡 中 | **4** | Task 2 Step 3 明确"标记 TERMINATED + SwitchToFiber(main) + main GC"三段式 | 用户 App 调 `pal_os_task_delete(NULL)` |
| **R-010** | Fiber 切换在 debug build（ASAN/UBSAN）下与 sanitizer 栈追踪冲突 | 🟢 低 | 🟡 中 | **2** | 记录已知限制；ASAN/UBSAN 下允许放宽 trace bit-exact 检查 | python wink-tools/wink.py test 加 sanitizer 后炸栈 |

---

## 6. 修订建议汇总（按合入优先级）

**必做（阻塞级，进入 Task 0 前必须完成）**：

1. **【新增】Task 0.5：wasm 多 asyncify_data 技术 spike**（4-6h）
2. **【修改】§3.3 红线新增第 8 条**：host target Windows-only 声明（或引入 `sim_ctx_*` 抽象层，推荐后者）
3. **【修改】§4.3 补 R-007 / R-008 / R-009 三条风险**
4. **【修改】Task 2 Step 3 补 Fiber 自删三段式**
5. **【修改】Task 5 R-002 缓解措施**：从 "trace bit-exact" 改为 "业务可观测行为一致"，新增 `test_single_task_semantic_regression.c`

**建议做（不阻塞开工，Task 1 阶段合入即可）**：

6. **【新增】Task 1 加 `WINK_SIM_SCHED_TRACE` 编译期调试开关**（5-10 行代码，排查工具级价值）
7. **【修改】Task 1 API 拆 `wakeup_by_time` / `pick_next` 为两步**（可选，改进单测粒度）
8. **【修改】Task 7 注释更新**：真协程下抢占单任务无副作用，取消原限制
9. **【修改】ADR-0014 补 esp32 双核对照具体 bug 类型**（5 条示例）
10. **【修改】附录 C 自检清单增补 3 项**

**建议做（Task 0 起草 ADR 时同步）**：

11. **【新增】§4.5 关联评审记录**：将本文件路径写入元数据表
12. **【修改】计划版本 v1.0 → v1.1**，changelog 记录 Fiber / 多 asyncify_data 升级

---

## 7. 是否可以开工的最终判定

**当前状态（v1.x 未修补）**：❌ 不建议进入 Task 0。**原因**：R-007（wasm 多 asyncify_data 不可行）概率非低，一旦触发会把前面 T0-T2 的产出全部作废；R-008（Windows-only 隐性绑定）会在跨平台协作时立刻爆。

**合入必做项后**：✅ 可以进入 Task 0。**关键路径变化**：Task 0.5 前置 → 关键路径 = T0(4h) + T0.5(5h) + T1(8h) + T2(6h) + T3(6h) + T5(4h) + T6(4h) = **37 h**（比 v1.0 的 32h 多 5h，但风险敞口显著缩小）。

**合入建议做项后**：整体质量抬到"可示范给团队参考的样板计划"级别；预期总工时约 45 h。

---

## 8. 附：与 v1.0 版本的差异快照

| 维度 | v1.0（初稿） | v1.x（用户改进后） | 评审建议 v1.2 |
|------|-------------|------------------|--------------|
| host 协程模型 | 伪协程（每次 sleep 就 return） | Windows Fiber 真协程 | Fiber + `sim_ctx_*` 抽象层预埋 POSIX 支持 |
| wasm 协程模型 | 单协程 + rewind 回主 loop | 每 task 独立 asyncify_data | 保留，但前置 Task 0.5 spike 验证 |
| host 平台矩阵 | 隐性 Windows | 隐性 Windows | 显式声明或抽象化 |
| 调度状态 | READY / WAITING / TERMINATED | + BLOCKED + suspend/resume | 保留 |
| 单任务回归验收 | trace bit-exact | trace bit-exact | 改为业务可观测一致 + tick 扰动 ≤ 2 |
| 调试工具 | 无 | 无 | 新增 `WINK_SIM_SCHED_TRACE` |
| 风险条数 | 6 条 | 6 条（未同步更新） | 补 R-007/008/009/010 至 10 条 |
| 关键路径工时 | 32 h | 32 h | 37 h（+ Task 0.5 spike） |

---

*本 review 归档后只读；针对 review 建议的执行状态请在计划文件的"问题与变更日志"章节追踪，不修改本文件。*


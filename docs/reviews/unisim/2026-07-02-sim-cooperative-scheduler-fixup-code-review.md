# 2026-07-02 仿真侧协作式调度器 Fixup 代码评审记录

| 项 | 内容 |
|----|------|
| 评审日期 | 2026-07-02 |
| 评审范围 | `feat/sim-scheduler-fixup` 分支合入 master 的 4 个实现 commit：<br>`62ef745`（F1）· `c88b2fd`（F2/F3/F4）· `93cc651`（F5）· `27300cd`（F0/F6/F7）· `ac670e0`（merge） |
| 关联实施计划 | [PLAN-20260702-SIM-COOP-SCHED-FIXUP](../../implementation-plans/unisim/2026-07-02-sim-cooperative-scheduler-fixup-plan.md) |
| 评审员 | code-review subagent（独立审阅，非实施人） |
| 评审结论 | ✅ **可以关账**；无 P0 阻断问题；有 6 项 P1 建议改进 + 6 项 P2 观察，均不阻塞 master |

---

## 综合评价

整体质量较高。F1（C1 修复）与 F2（C2 修复 + callbacks 透传）代码层面到位，红线 12/13/15 都被验证过；分层纪律（pal 头只前向声明 `wink_app_callbacks`）落地干净；主 loop 骨架相较 `0e2b087` 明显更严谨。**没有 P0 阻断问题**，但存在**两处 P1 需要短期收拢**：

1. **ADR-0013 §3 与 ADR-0014 Compliance 段仍保留 fixup 前的旧描述/坏链**，违背 CLAUDE.md "决策结论回写" 硬约束
2. **`test_sim_scheduler_wcet_fault.c` 号称门禁红线 16（callbacks 透传），实际 strong-stub 断开了 `pal → wink_runtime_fault → on_fault` 的观测链**，测试其实只覆盖了"WCET 触发 + fault code == 8002"，无法证伪"pal 传了 NULL"

---

## 🔴 P0 阻断问题

**无**。

---

## 🟠 P1 建议改进项（短期收拢）

### P1-1：ADR-0013 §3 残留旧写法

- **位置**：`docs/decisions/unisim/0013-sim-cooperative-scheduler.md`
- **现象**：仍写 `执行 sim_ctx_switch(NULL, s_main_ctx) 强制让出`，与 F1 修复（引入 `sim_scheduler_current_ctx()` + 契约 v2 `from != NULL`）直接冲突
- **建议**：改为 `sim_ctx_switch(cur_ctx, s_main_ctx)`，与 `07-scheduler-model.md:134` 表格一致

### P1-2：ADR-0013 WCET fault 签名残留

- **位置**：`docs/decisions/unisim/0013-sim-cooperative-scheduler.md`
- **现象**：WCET 防卫机制仍写 `wink_runtime_fault(8002)` 单参形式，F2 Step 6 已改为 `(callbacks, 8002)`
- **建议**：要么全签名，要么明确注为"简写"

### P1-3：ADR-0014 Compliance 坏链

- **位置**：`docs/decisions/unisim/0014-sim-single-virtual-core.md`
- **现象**：引用 `04-wasm-simulation/03-scheduler-model.md`，但 F6 交付的实际文件是 `07-scheduler-model.md`（ADR-0013 §Follow-up 已同步）
- **建议**：改为 `07-`

### P1-4：`_wcet_fault` 测试无法真正验证 callbacks 透传（R2 契约门禁失效）

- **位置**：`wink-micro-os/test/test_sim_scheduler_wcet_fault.c:29-33`
- **现象**：strong-symbol stub 只记录 `s_fault_fired` / `s_fault_code`，**不记录传入的 `cb` 指针，也不调 `cb->on_fault`**。line 110-112 的"验证"是测试独立调用 `invoke_app_on_fault(&s_test_callbacks, ...)` 后自证 `s_app_on_fault_called == true`——这对任何非 NULL `.on_fault` 都恒成立，无法区分 `wink_runtime_fault(NULL, 8002)` 与 `wink_runtime_fault(&s_test_callbacks, 8002)`
- **影响**：R2/红线 16 门禁其实只是空穴，回归时无法拦住"pal 又忘了传 callbacks"
- **建议**：stub 里存 `s_captured_cb = cb;` 并加 `TEST_ASSERT_NOT_NULL(s_captured_cb);` + `TEST_ASSERT_EQUAL_PTR(&s_test_callbacks, s_captured_cb);`

### P1-5：wasm 侧 WCET 缺少 debugger-bypass 分支（契约诚实缺陷）

- **位置**：`wink-micro-os/targets/wasm/pal_osal_wasm.c:229`
- **现象**：wasm 侧 `bypass_wcet` 只看 env var，没有等价于 host `IsDebuggerPresent()` 的分支。浏览器 devtools 断点场景下，`emscripten_get_now()` 会跳变，恢复后极易误报 8002
- **建议**：在 `07-scheduler-model.md` §5 或 `pal_osal_wasm.c` 顶部 doxygen 显式声明为 host/wasm 语义差异（ADR-0012 契约诚实要求）

### P1-6：`__attribute__((weak))` 对 MSVC 不生效

- **位置**：`wink-micro-os/targets/host/pal_osal_host.c:23`
- **现象**：GCC/Clang/MinGW 上可靠；MSVC 不识别（会作为强符号）。当前 CMake 保留 MSVC 分支但主 CI 走 MinGW，无 broken
- **建议**：加 `#if defined(__GNUC__) || defined(__clang__)` 门控或换 CMake link-time 选择

---

## 🟢 P2 观察 / 未来跟进

### P2-7：host_wall_clock.h POSIX 分支 `#error`

- **位置**：`wink-micro-os/test/stubs/host_wall_clock.h:31-33`
- **现象**：POSIX 分支直接 `#error`。未来 host CI 加 Linux 通道时需补齐 `clock_gettime(CLOCK_MONOTONIC)`；不阻塞现在

### P2-8：baseline 白名单口径过窄

- **位置**：`wink-micro-os/test/baseline/avoidance_car_semantic_baseline.h`
- **现象**：只 3 项（two servo angles + trace_count），捕获舵机 90/180 差异 OK，但捕不到 motor PWM duty 漂移、trace 内容变化、多 tick 时序变化（`max_ticks=1`）
- **建议**：wave-4 起扩到 `sim_last_pwm_duty(0..3)` 与 `wink_trace_head_code(0..3)` 一同锁定

### P2-9：`ConvertThreadToFiber` NULL 未检

- **位置**：`wink-micro-os/targets/host/sim_ctx_win32_fiber.c:31`
- **现象**：`ConvertThreadToFiber(NULL)` 返回 NULL 未检；若 wine/受限 desktop 环境失败，后续 `SwitchToFiber(NULL)` UB
- **建议**：加 `assert(c->fiber != NULL)`

### P2-10：round-robin slot-recycle 无单测

- **位置**：`wink-micro-os/targets/common/src/wink_sim_scheduler.c:181-186`
- **现象**：注释里明确 "slot 复用后新 task 首次调度会延迟一轮"，但 R7 只有代码注释，无测试
- **建议**：`test_sim_scheduler_determinism.c` 或 `test_sim_scheduler.c` 加一条 case：register → run → mark_zombie → gc → register-into-same-slot → pick_next → 观察延迟一轮

### P2-11：`count_by_state(READY)` follow-up 需登记

- **位置**：`docs/design/04-wasm-simulation/archive/07-scheduler-model.md:145`
- **现象**：承诺 Task 7 补上；建议在 fixup plan 或 wmos-q3 优化计划里显式登记这条 follow-up，避免遗失

### P2-12：`_putenv("CI=")` 跨编译器兼容性

- **位置**：`wink-micro-os/test/test_sim_scheduler_wcet_fault.c:85-86`
- **现象**：依赖 msvcrt 特定行为（在 MinGW 上删除变量）；若切 clang-cl 或换 CI 平台需重测

---

## 逐点回答评审焦点（Priority 1–4）

### Priority 1（Bug / 契约破裂）

1. **C1 是否修好**：✅ 修好。契约 v2 双端 assert `from != NULL`（`sim_ctx_win32_fiber.c:53`、`sim_ctx_emscripten_fiber.c:70`）；`sim_scheduler_current_ctx()` at `wink_sim_scheduler.c:271-275`；`pal_os_sleep_ms` / `pal_os_task_delete` 让出前用它拿 `cur_ctx`。生产代码 grep `sim_ctx_switch\(\s*NULL` 无命中。**残留问题**：ADR-0013:41 文档层旧写法（P1-1）。

2. **C2 是否修好**：✅ 修好。host `pal_osal_host.c:346, 350` 用 `host_wall_clock_us()`（QPC）；wasm `pal_osal_wasm.c:275, 279` 用 `wasm_wall_clock_us()`。虚拟时钟只服务业务语义。测试双向门禁通过。

3. **F2 Step 6 callbacks 传参改造是否完备**：⚠️ signature 完备，但测试化不到位。所有 `pal_sim_scheduler_run` 调用点传 callbacks；生产 grep `wink_runtime_fault\(\s*NULL` 无命中。**但**测试并未真正验证 `on_fault` 被调（见 P1-4）。

4. **红线 15 反面契约**：✅ 遵守。`s_current_task_id` / `sim_scheduler_set_current` 只在主调度 `pal_sim_scheduler_run` 里出现；`pal_os_sleep_ms` / `pal_os_task_delete` 内部不动。

5. **`sim_scheduler_reset` fiber-context assert**：✅ 到位。`wink_sim_scheduler.c:45-46` 红线 13 assert。

6. **分层纪律**：✅ 通过。`wink_sim_scheduler.h:3-6` 只前向声明 `struct wink_app_callbacks`，未 include `wink_app.h`；`wink_app.h:285` 加了 tag，前向决议一致。RF-007 pal < runtime < app 分层通过。

7. **F3 `s_main_ctx == NULL` fallback 合理性核实**：✅ 合理。host pal_osal_host.c 编译时不定义 `SIMULATION`（pal_host OBJECT 库由 top-level 编译），non-SIM 单任务 e2e 经 `wink_runtime_run` `#else` 分支跑单任务主 loop 用 `pal_os_sleep_ms` 推进虚拟时钟——此路径 `s_main_ctx == NULL` 合法。SIM 编译下总是先 `sim_ctx_from_current()` 设置 `s_main_ctx` 再调 `pal_sim_scheduler_run`，fallback 不可能被 SIM 上下文错误命中。line 174-177 注释清晰。

### Priority 2（正确性与鲁棒性）

8. **`pick_next` round-robin 与 slot recycle**：✅ 实现正确。`wink_sim_scheduler.c:168-192` — `start_id = (last+1) mod N` 当 `last == NO_READY` 从 0 起扫；空 ready 集合返回 `SIM_SCHED_NO_READY`（line 190）。`sim_scheduler_reset` 在 line 62 重置 `s_last_scheduled_task_id`。R7 slot-recycle 一次性延迟由代码注释接受（line 175-176）。**未加单测直接验证 R7**（P2-10）。

9. **WCET 阈值 env 缓存（R9）**：✅ 到位。host `pal_osal_host.c:302-309` 在入口读一次，主 loop 只读 static。wasm 同结构。**但** wasm 侧 `bypass_wcet` 少了 debugger 分支（P1-5）。三个 env 组合语义正确。

10. **Emscripten fiber `aligned_alloc` C11 UB**：✅ 合规。`sim_ctx_emscripten_fiber.c:33, 48, 50` 三处 size 均向上舍入到 16 的倍数；NULL 检查齐全。

11. **host `SwitchToFiber` 是否需 `from`**：✅ 形式契约合理。`SwitchToFiber` 只需 `to`，`(void)from;` 显式丢弃。契约 v2 要求 `from != NULL` 是刻意的对称性设计——若 host 侧允许 NULL，pal_osal_host.c 里的调用点可能被复制到 wasm 而不改，重现 C1。

12. **wasm 主 loop 恢复 dispatch 后 double-dispatch**：✅ 无。`wink_runtime.c:101-103` 已移除 `sim_app_main_task` 内的 dispatch；`pal_wasm_dispatch_pending_interrupts` 现只在 `pal_osal_wasm.c:238` 每轮 tick 顶部调一次。

### Priority 3（测试质量与代码风格）

13. **`__attribute__((weak))` 可靠性**：✅ MinGW 主 CI OK。⚠️ 未来 MSVC 通道会翻车（P1-6）。

14. **baseline `.h` `#error` 门禁**：⚠️ 半严格。测试文件顶部有 `#ifndef HAS_BASELINE_HEADER #error`；CMake 仅在 `file(EXISTS)` 时加入 build，否则 `message(WARNING)`。可接受，因为该测试独立可跳，但 CI 不会因 baseline 缺失而失败。

15. **`host_wall_clock.h` POSIX `#error`**：见 P2-7。

16. **`test_single_task_semantic_regression.c` 白名单窄度**：见 P2-8。

17. **`sim_task_t <= 96` static_assert**：✅ 存在（`wink_sim_scheduler.h:45`）。手算约 72 bytes，符合。

### Priority 4（文档一致性）

18. **ADR 状态与 Follow-up**：✅ 均 Accepted。ADR-0013 Follow-up 三项到位。ADR-0014 Follow-up：round-robin 忽略 core_id ✓；`07-scheduler-model.md` 已回写 ✓；**但坏链 03-（P1-3）**。

19. **`07-scheduler-model.md` 内容完备度**：✅ 齐全。R10 `pal_os_task_delete` 语义表 §7；R11 ZOMBIE 视为活跃 §8；状态机 mermaid §2；host/wasm 语义对照 §5；三个 pure decision functions §4；WCET/中断唤延迟保真度边界 §6。

20. **附录 C 去伪清单**：✅ F7 已执行。`2026-07-01-sim-cooperative-scheduler-plan.md` 有 6 条 `- [ ]` + `[deferred to PLAN-20260702-SIM-COOP-SCHED-FIXUP ...]` 项。

---

## 建议下一步

按优先级：

1. **P1-1/2/3 一次性修**：ADR-0013 line 41 与 line 69、ADR-0014 line 98 的 `03-` → `07-` 三处文档回写。单个 commit，纯 docs，风险 0。**触发时机：本 wave 关账前**
2. **P1-4 修 wcet_fault 测试**：strong stub 里加 `s_captured_cb = cb;`，`test_cpu_hog_triggers_8002` 里 `TEST_ASSERT_EQUAL_PTR(&s_test_callbacks, s_captured_cb);`。**触发时机：wave-3 或 wave-4 起**
3. **P1-5 wasm WCET debugger 契约文档化**：在 `pal_osal_wasm.c` doxygen 或 `07-scheduler-model.md` §5 加一行"wasm 侧无 debugger-bypass"
4. **P2-6/10/11 排入 wmos-q3 计划或 Task 7 计划**：MSVC 弱符号门控、R7 slot-recycle 单测、`count_by_state(READY)` follow-up
5. **Task 7 Chaos Scheduling 启动前**：`test_sim_scheduler_determinism.c` Case 2 需从 `EQUAL` 翻到 `NOT_EQUAL`（测试头注释已明确此计划）

---

## 关账建议

✅ **本次 fixup 可以关账**。P1 项建议以 follow-up 单独 PR 收拢（不阻塞 master）。

推荐立刻做 **P1-1/2/3 三处文档修复**（约 5 分钟）——三处都是低风险的字符串级修改，且直接违反 CLAUDE.md "决策结论回写" 硬约束，不应留到下 wave。P1-4/5 可以进入 wave-4 计划。


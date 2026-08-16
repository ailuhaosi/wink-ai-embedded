# 2026-07-02 · `concurrency_stress` Sample 技术设计评审

| 项 | 内容 |
|----|------|
| 评审日期 | 2026-07-02 |
| 评审对象 | [`tech-designs/2026-07-02-concurrency-stress-sample-design.md`](../../tech-designs/unisim/2026-07-02-concurrency-stress-sample-design.md) v0（Draft） |
| 评审动机 | ADR-0018 删除 `smp_uaf_test` sample 后，需要一个基于收窄后 PAL API 的替代 sample，覆盖 IRQ + task 并发验证。设计文档为 Draft 状态，本次评审在实施前把可能"绿了但没测到"的空断言风险抓出来 |
| 评审基准 | [ADR-0014 sim 单虚拟核](../../decisions/unisim/0014-sim-single-virtual-core.md)、[ADR-0018 PAL IRQ API 收窄](../../decisions/core/0018-pal-irq-api-narrowing.md)、[ADR-0012 契约诚实](../../decisions/core/0012-contract-honesty-over-silent-degradation.md) |
| 关联评审 | [2026-07-02 PAL IRQ API 收窄评审](../core/2026-07-02-pal-irq-api-narrowing-review.md) |
| 关联计划 | `implementation-plans/2026-07-02-concurrency-stress-sample-plan.md`（待写） |
| 评审结论 | ⚠️ **骨架正确，但对 sim 上的检测能力过度承诺**：4 个场景中至少 2 个在 sim 单虚拟核 + host `pal_irq_*` 同步分发语义下退化为空断言。修订 P0/P1 项后可从"看着体面"进阶到"真的能守门" |
| 落地方式 | 本评审的推理链在此归档保存；具体修订以 diff 形式合入原 tech-design |

---

## 1. 评审判据：什么是本 sample 的"真守门"

一个并发验证 sample 的价值取决于它的**检测能力**——即"当被验证对象出问题时，本 sample 会红"。骨架/目录/CMake 集成再干净，如果核心不变量在目标平台上是恒真的（vacuously true），CI 绿只是"我没崩"而已，不代表"我在测什么"。

因此本评审的核心尺子是：**每个不变量在 sim 单虚拟核 + host 同步分发语义下，是否存在能让它变红的具体故障场景？** 若答案是"否"，则要么调整不变量、要么诚实收窄承诺、要么补负测试证明能红。

## 2. 关键背景事实（评审时核对过的代码状态）

- **host `pal_irq_set_pending`**（`targets/host/pal_hal_host.c:287-297`）：无锁时**同步**在调用者栈上跑 ISR；有锁时**静默丢弃**（无 pending 队列）。
- **host `pal_irq_synchronize`**（`targets/host/pal_hal_host.c:304`）：空操作（sim 单线程模型）。
- **sim 调度器**（ADR-0013/0014）：协作式单虚拟核，只有显式让出点（`pal_os_sleep_ms`、`ringbuf` 阻塞等）才切换 task。
- **`pal_irq.h` 现行 API**（ADR-0018 Accepted 后）：3 级优先级 + `PAL_CRITICAL_SECTION` + `pal_irq_advanced.h` 门控。
- **`pal_gpio_enable_interrupt`**（`pal_hal.h:118-132`）：v2.2 首次锁定优先级；实际分发路径未在设计文档中说明是否与 `pal_irq_set_pending(irq_num)` 连通。

## 3. Blocker 级发现——不修订则 sample 价值大幅折损

### B1. Scenario #2 在 sim 上**几乎不存在"任务-ISR 竞争"**

`pal_irq_set_pending` 在 host 上是同步调用。这意味着：

- 无锁时：`trigger_task` 调 `set_pending` → 立即在 trigger_task 的栈上同步跑 `soft_isr` → 返回。这不是"任务-ISR 交叉"，而是"任务里内联函数调用"，`drain_task` 根本没机会与之交错（协作式单核）。
- 有锁时：中断被**静默丢弃**，且**没有 pending 队列记账**。所以 `INV_TI_NO_LOSS`（`isr_fires == N_ITER`）在 host 上"因为都没被丢弃"才通过——但只要有人无意间在触发路径外再加一层 CS 包裹，损失就被吃掉且检测不到。

**结论**：Scenario #2 在 sim 上只在检验"API 编译通过 + happy path"；`INV_TI_ORDERING`/`INV_TI_NO_LOSS` 都是无并发前提下的恒真断言。真实检测价值只在 ESP32 双核。

**建议修订**：
1. 文档 §1.2 与 §4.2 显式声明"Scenario #2 在 sim 上是 API 契约演示（无真并发），真语义靠 ESP32 双核"。
2. 实施计划补一条**负测试**：把 `drain_task` 的 CS 去掉，跑一次，期望能红——如果去掉后依然绿，本 sample 根本没测到该维度，必须回炉。

### B2. Scenario #1 的 `INV_TT_NO_TORN` 在 sim 单虚拟核上**恒真（vacuous）**

sim 协作式单核 + `PAL_CRITICAL_SECTION` = 每个 iteration 原子。任意 64/32 位写入本身也不会 torn。此不变量在 host 上跑通只能证明"编译器没自作聪明地拆开 `uint64_t` 的写"，不能证明"临界区起了保护作用"。

**建议修订**：
- 要么在 §4.1 明确注释为"仅在 ESP32 双核下有非平凡语义；host 上等价于'编译器未 mis-lower `uint64_t`'"。
- 要么加一个**去掉 CS 的负控制变体**（编译期开关 `CONCURRENCY_STRESS_NO_CS=1`），期望其在 ESP32 双核下能红。

### B3. Scenario #4 依赖 ASan 检出 UAF——但 sim 上 `pal_irq_synchronize` 是空操作，`worker_isr` 不会异步执行

`pal_hal_host.c:304`：`pal_irq_synchronize` 空跑。且如 B1，`set_pending` 无锁时同步、有锁时丢弃。因此：

- `pal_irq_disable` 之后 ISR 表被清零；`synchronize()` 空跑；`free(tmp)`——路径上**永远不会**存在"另一核心还在 ISR 里"的情况。
- ASan 在 sim 上**根本没有机会**检出真 UAF；它只是"确认 free 后没被再引用"的兜底。
- 所以本 sample 在 sim 上对 ADR-0018 §synchronize 契约的验证强度 ≈ 0。

诚实的表述应改成：**Scenario #4 在 sim 上验证 API surface 编译过 + 无返回码错误；契约语义验证完全依赖 ESP32 真机双核**。原文档 §4.4 的"已接受"段已经沿着这条线声明，但 §6.1 "Pass 3 是决定性覆盖 scenario #4 UAF 的关键"与 §7 的对应缓解都在暗示"ASan 兜住 UAF 检测"——**过度承诺，需要收回**。

**建议修订**：改写 §6.1 表格里 Pass 3 那一行的注释——ASan 的价值主要在**Scenario #2 的 ring 越界访问、任何 malloc/free 路径的经典越界/UAF、以及 sample 自身代码的 bug**；对 `pal_irq_synchronize` 语义**无检测能力**。

---

## 4. Major 级发现——设计瑕疵，实施前必须解答

### M1. 未定义 `SOFT_IRQ_NUM` / `BTN_GPIO_IRQ_NUM` / `WORKER_IRQ_NUM` 的来源与冲突域

- host 端 `HOST_MAX_IRQ = 32`。三个 IRQ 号必须都 < 32，且不能与 target 内部预占的 IRQ 号冲突。
- Scenario #3 尤其微妙：`pal_gpio_enable_interrupt` 内部会不会真的把某个逻辑 IRQ 号注册到 `s_host_irq_table` 里？还是有独立的 GPIO 分发链路（另开 `s_host_gpio_table`）？若是后者，`pal_irq_set_pending(BTN_GPIO_IRQ_NUM)` **不会**触发 `button_isr`。

**必须补充**："IRQ 号命名空间与 target 分发路径映射表"，说明：

1. 3 个 IRQ 号的具体值 & 分配位置（`device_tree.h` 里 `static const`？还是宏？）。
2. `pal_gpio_enable_interrupt` 与 `pal_irq_set_pending` 的分发路径是否连通（host/wasm/esp32 三处）——若 GPIO 中断走独立分发，Scenario #3 的软触发跑不通，需要专用 `pal_host_trigger_gpio(pin)` 或类似路径。

### M2. Scenarios 之间的状态泄漏未处理

4 个 scenario 都用 file-scoped `static struct` 承载状态，都在 `app_init` 里顺序调用。ISR 注册状态也是全局的。

若 Scenario #2 结束时忘调 `pal_irq_disable(SOFT_IRQ_NUM)`，Scenario #4 里 `set_pending(WORKER_IRQ_NUM)` 虽无影响，但确定性回归的输出可能被前面 scenario 的残留改变。

**建议修订**：§3.1 scenario 统一接口显式规定**进入-退出契约**：
```
每个 scenario 保证：
  (1) 入口清零自己的 static state
  (2) 出口清零 IRQ 注册与所有 pending
  (3) 出口不留下任何未配对的 pal_irq_save
```
§9 DoD 加一条"scenario 独立性检查：任意子集单跑与全跑结果一致"。

### M3. `INV_TI_ORDERING` 引用 `drops`，但 §4.2 的 ISR 里没有 drops 递增逻辑

伪代码只有 `ring[head & 63] = head; head++;`——**没有**"若 head - tail > 64 则 drops++"的判定。这样 `drops` 永远为 0，`INV_TI_ORDERING` vacuously true。

**建议修订**：ISR 内补 `if ((uint32_t)(g_ti.head - g_ti.tail) >= 64u) { g_ti.drops++; return; }` 或删除该不变量。

### M4. `wink_trace_fault(9001u)` 缺一段"trace code 命名空间"说明

`dual_task_demo` 用 7002/7003；本 sample 用 9001。项目是否有集中的 trace code 台账？若无，本 sample 至少应在 `concurrency_stress.h` 定义 9000-9099 的私有空间，并注释"归属：samples/concurrency_stress"，否则日后必然撞码。

### M5. 场景 #2 drain_task 把整条 while-drain 放在同一个 CS 里，ESP32 上会拉高中断延迟

风险表 §7 提到"single-loop 时间 `< N_ITER × 数百 ns`"——但那是 **producer**的循环，不是 drain 的。drain 里 while 最多走 64 个 ring 元素 + 打印/校验就是几十 μs 级；这段时间 syscall 优先级的中断被 mask。ESP32 上通常没问题，但一旦 CI 加入其它高频源可能触发意料外行为。

**建议修订**：drain 的 CS 只包 tail 前进那一步，不包整条 while；校验放 CS 外，保护范围只覆盖真正共享的 head/tail。

### M6. `PAL_DEFINE_ISR` 宏与 raw `pal_isr_t` 混用未加注释解释"何时用哪个"

Scenario #2/#4 用 raw，Scenario #3 用宏。合规，但作为 AI codegen 正例文本，应在示例开头加一行注释："**当 arg 是具体结构指针时用 `PAL_DEFINE_ISR` 获得类型安全；当 arg 为 NULL 或不关心类型时用 raw `pal_isr_t` 签名**"。

---

## 5. Minor 级发现——建议但不阻塞

### m1. 确定性回归 (§6.3) 的 3 次同 seed 同二进制比对，实质在检测什么

给定 sim 单核协作式 + `WINK_SIM_SEED` 固定 + 无外部 I/O，同二进制跑 3 次几乎必然完全一致——**除非**：
- 依赖了 `getpid()`/`time()`/`rand()`（当前没有）
- 依赖了未初始化内存（UBSan/ASan 会先抓到）
- 依赖了 heap 分配的具体地址（`printf("%p", ...)` 或对指针数值运算）

此断言 99% 情况下等价于"sample 代码里没打印过 %p"。仍值得保留（低成本、高信噪），但文档应精确说明它检测的具体故障模式，不要让读者以为它在守护"sim 调度器确定性契约"——那个契约有专门的 `test_single_task_semantic_regression.c` 守。

### m2. Multi-seed 的 3 个 seed 未说明产生方式

`0xC0FFEE / 0xDEADBEEF / 0x12345678`——都是常量彩蛋。可以补一句"这 3 个 seed 是任意选定的、对 uint32_t 空间的粗粒度采样；未来若发生 seed-specific 崩溃再定向增补"。

### m3. `N_ITER=5000` 降载策略与"stress"语义的张力

降载后 ring 容量 64 的边界压力也变小。建议 ring 容量做成 `CONCURRENCY_STRESS_RING_CAPACITY`，降载 profile 里等比例缩到 32，保持 N/capacity 比不变（≈156.25）。

### m4. §5.4 "零 CMake 改动"依赖 `generate_app_sources.ps1` 扫描——扫描规则未在文档中留印

若扫描规则是 `sample_dir/*.c` 排除 `test_*.c`，OK；若按文件名白名单，多 `scenario_*.c` 会漏。应贴一行注释确认扫描规则，或直接引用 `generate_app_sources.ps1:<行号>`。

### m5. 缺失"覆盖分工"矩阵

sample 与既有 `test_pal_irq.c` 的去重矩阵：`test_pal_irq.c` 已覆盖什么？本 sample 增量覆盖什么？没有这个矩阵，未来维护者会问"我加个新场景是加进 test_pal_irq 还是加进 concurrency_stress"。建议 §4 之前插一个 0.5 页的"覆盖分工"表。

### m6. Scenario #1 `pal_os_sleep_ms(0)` 是否触发 sim 调度点未确认

若是 no-op，两个任务会**顺序**跑完（producer 全跑完 → consumer 全跑完），根本没有交错——虽然不变量仍会满足，但"stress"名不副实。应在 §4.1 断言"sim 调度器 policy 保证 `sleep_ms(0)` 触发 yield"，或改用别的强 yield 原语。

---

## 6. 增值建议——可提升本 sample 的复利价值

### v1. 补"negative sample"子目录：`samples/concurrency_stress_broken/`

刻意打破每个不变量（去掉 CS、故意 head 不越界检查等），CI 里对这些 target 用 `add_test(..., WILL_FAIL 1)`。这是把"sample 有检测能力"从**主张**变成**证据**的最直接方式，成本极低（改 6~8 行代码），价值极高——避免"sample 本身回归成空断言"这一元级故障。

强烈建议纳入 §9 DoD。

### v2. 把 4 个 scenario 的**性能预算**写进不变量

例如 Scenario #1 host 上 N=10000 应 < 200ms。这样"调度器某天引入 O(N²) 优化"这类回归也能被抓到——目前的正确性不变量完全无视性能。用 `wink_app_delay_ms` 前后差值断言即可，不需要 QPC/高精时钟。

### v3. 显式覆盖 `pal_irq_advanced.h` 的物理隔离契约

新建 `scenario_smp_sync_negative.c`：**不定义** `WINK_ALLOW_ADVANCED_IRQ_APIS` 就 `#include "pal_irq_advanced.h"`——CMake 里用 `try_compile(... EXPECTED_FAIL)` 断言"编译必须报错"。对 ADR-0018 §142 物理隔离机制的最直接单元验证，极其便宜（≈10 行 CMake）。

### v4. 把"AI codegen 正例参考"这条目标做实

§1.2 目标 4 提到"AI codegen 正例"。建议每个 `scenario_*.c` 头部加一个约 20 行的"codegen 检查表"注释：

```c
/*
 * AI codegen 正例参考——本文件示范了：
 *   ✓ `PAL_CRITICAL_SECTION` 保护共享变量（不用 pal_irq_save()）
 *   ✓ ISR 上下文用 `pal_isr_t` raw 签名 + `PAL_ISR` 修饰
 *   ✗ 反例：不要用 `pal_irq_save()` + 手动 restore（用宏 RAII）
 *   ✗ 反例：不要 include pal_irq_advanced.h（除非系统级驱动）
 */
```

这样本 sample 不只是 CI 门禁，还是 AI 学习语料。

### v5. 把 §10 "Change Blast Radius" 的"不改动"清单固化为 CI 检查

`python wink-tools/wink.py test` 尾部：`git diff --stat HEAD~1 -- wink-micro-os/pal/ wink-micro-os/dal/ wink-micro-os/targets/ | should_be_empty`，只在 concurrency_stress 分支合入 PR 时启用。把"不改动 PAL 表面"从设计承诺变成机械门禁。

---

## 7. 结论与优先级

| 优先级 | 事项 | 建议动作 | 落地位置 |
|-------|------|---------|---------|
| **P0** | B1 / B3：Scenario #2/#4 在 sim 上是空断言 | §1.2 / §4.2 / §4.4 显式收窄承诺；实施计划补"负测试证明能红" | tech-design + plan |
| **P0** | M1：IRQ 号命名空间与 GPIO 分发路径 | 补一节"IRQ 号 & target 映射表" | tech-design |
| **P1** | B2、M3、M5 | 修不变量语义 / 补 drops 递增 / 收窄 drain CS 范围 | tech-design |
| **P1** | v1 negative sample 子目录 | 加入 §9 DoD | tech-design |
| **P2** | M2、M4、M6 | 补 scenario 独立性契约 / trace code 命名空间 / 混用注释 | tech-design |
| **P2** | v3 编译期负测试 `#error` 门控 | 极便宜，收益高 | tech-design |
| **P3** | m1~m6 与 v2/v4/v5 | 视时间加 | tech-design |

**总体判断**：设计的骨架、目录、CMake 集成、CI 三 pass 结构、文档回写清单都非常干净，符合"低价值高 churn"约束和 CLAUDE.md 分层。**唯一实质问题**是几个场景在 sim 上的检测能力被过度承诺——只要按 B1/B3 收窄承诺 + v1/v3 加负测试补强，本 sample 就从"看着体面"进阶到"真的能守门"。

---

*本评审为快照，写入后不再修改。修订与后续实施以 tech-design 与实施计划为准。*


# concurrency_stress Sample —— 技术设计

| 项 | 内容 |
|----|------|
| 创建日期 | 2026-07-02 |
| 类型 | 技术设计规格（Layer ②） |
| 状态 | v1（Draft，评审后修订） |
| 关联 ADR | [ADR-0002](../../decisions/unisim/0002-dual-target-compilation.md) 双 target 同源、[ADR-0004](../../decisions/core/0004-static-dispatch-vs-runtime-ops.md) 静态分发、[ADR-0014](../../decisions/unisim/0014-sim-single-virtual-core.md) sim 单虚拟核、[ADR-0018](../../decisions/core/0018-pal-irq-api-narrowing.md) PAL IRQ API 收窄 |
| 关联实施计划 | `implementation-plans/2026-07-02-concurrency-stress-sample-plan.md`（待写） |
| 关联设计规范 | `02-wink-micro-os/02-pal-platform-abstraction.md`（回写：新增 sample 参考） |
| 关联评审 | [`reviews/2026-07-02-concurrency-stress-sample-design-review.md`](../../reviews/unisim/2026-07-02-concurrency-stress-sample-design-review.md)（v0 Draft 评审，Blocker/Major 项已合入本文档 v1） |
| 替代/补位 | 归档的 `smp_uaf_test` sample（随 ADR-0018 删除，仅覆盖 shared IRQ UAF；本 sample 覆盖更广，用最新收窄后的 PAL API） |
| 决策者 | 用户 |

## 1. 背景与动机

### 1.1 触发

- ADR-0018（2026-07-02 Accepted）删除 `pal_irq_shared_register` 与整套 shared IRQ + RCU 链表实现，同时删除依赖它的 `samples/smp_uaf_test/` 整目录。
- `smp_uaf_test` 的原始职责是验证 shared IRQ 卸载路径的 SMP UAF；底层能力已废，sample 亦废。
- **但**"并发正确性"这一验证维度不能随之丢失——现有 sample（`dual_task_demo` / `resource_conflict`）都不覆盖 IRQ + task 交叉竞争、GPIO ISR 注册路径、`pal_irq_synchronize` 契约。
- 因此需要一个**基于收窄后 PAL API** 的新 sample，重建并**扩大**并发验证覆盖。

### 1.2 目标

在**同源 dual-target**（sim: host+wasm；真机: ESP32）下：

1. 用**最新 API 表面**（`pal_isr_t` 统一签名、3 级优先级、`PAL_CRITICAL_SECTION`、`pal_irq_advanced.h` 门控）演示典型并发场景。
2. 每个场景绑定**明确的不变量**，任何一次回归立刻被 CI 抓住。
3. 集成 sanitizer（UBSan + AddressSanitizer）与 sim 确定性回归，形成对 PAL/sim scheduler 的最强单一 sample 断言。
4. 作为 AI codegen 的正例参考：展示"应该如何用收窄后的 API 写并发代码"。

### 1.3 sim 上的能力边界（诚实分层）

sim 单虚拟核（ADR-0014）+ host `pal_irq_set_pending` **同步分发** + `pal_irq_synchronize` **空操作**——这三条事实决定了：**部分场景在 sim 上只能验证 API 契约与编译通过，真语义验证依赖 ESP32 双核**。本节把每个场景在 sim 上的**实际检测能力**列清楚，避免"绿了但没测到"。

| Scenario | sim 上实际检测的东西 | sim 上**不能**检测的东西（依赖 ESP32 双核） |
|----------|-------------------|--------------------------------------|
| #1 任务-任务 | `PAL_CRITICAL_SECTION` 宏能编译、`producer_count == consumer_count` 计数守恒（无早退）、`sum` 与独立复算相等（证明编译器未 mis-lower `uint64_t` 写入） | 真并发下 torn write 保护（sim 单核 + 协作式调度使 write 天然原子；本场景 sim 下 `INV_TT_NO_TORN` 是 vacuous） |
| #2 任务-ISR | `pal_irq_set_pending` API 与 `PAL_ISR` 修饰能编译、happy path 分发计数正确 | 真"任务持锁时中断被延迟到锁释放后 pending 分发"这一语义；host 上持锁时中断**静默丢弃**、无锁时**同步执行**——本场景 sim 下**无真并发**，`INV_TI_NO_LOSS`/`INV_TI_ORDERING` 在无并发前提下恒真 |
| #3 GPIO ISR | `pal_gpio_enable_interrupt_ex` 首次锁定语义、`PAL_DEFINE_ISR` 宏展开正确、`arg` 上下文指针传递 | 真硬件电平沿触发路径（sim 用软触发替代） |
| #4 SMP 契约 | `disable → synchronize → free` **API 表面能编译过 + 返回码正确 + 顺序被走完**；ASan 检测 sample 自身的 malloc/free 使用是否越界或 UAF | `pal_irq_synchronize` 的**真同步语义**（host 是空跑，没有"另一核心还在 ISR 里"的场景）；ASan 在 sim 上对 synchronize 契约**无检测能力** |

**结论**：本 sample 的"守门强度"分两档——
- **sim（默认 CI 门）**：守 API 表面完整性、宏展开正确性、编译期契约（`pal_irq_advanced.h` `#error` 门控见 §5.5）、sample 自身代码质量（ASan 兜住普通 UAF/越界）。
- **ESP32 真机**：守真并发语义（#1 torn write、#2 任务-ISR 抢占、#4 双核 UAF）。

这一分层与 ADR-0014 sim 单虚拟核决策一致：**sim 不假装并行**。

### 1.4 明确的非目标

- **不**制造假并行：sim 单虚拟核（ADR-0014）下 SMP 场景退化为契约验证，不引入 pthread。
- **不**扩展 PAL 表面积：sample 只消费现有 API；不为 sample 加 debug introspection（如 in-flight counter 读取），避免"低价值高 churn"。
- **不**覆盖动态注册/注销的极端热插拔场景：ADR-0018 已明确"启动 init → 运行到停止"是主用法，热插拔属高级 API `pal_irq_synchronize` 的窄用途。
- **不**跑浏览器端 wasm e2e：wasm 侧仅验证"能编译过 + `WINK_APP_SOURCES` 导出正确"，与 `dual_task_demo` 现状一致。

## 2. 顶层决策摘要

| 维度 | 决策 |
|------|------|
| 打包方式 | 单一 App `concurrency_stress`，内部 4 个 scenario **顺序**执行 |
| 目录位置 | `wink-micro-os/samples/concurrency_stress/` |
| Target 覆盖 | Host（e2e 主体）+ Wasm（编译通过）+ ESP32（真机运行） |
| SMP 处理 | sim 上验契约顺序 + no crash + ASan clean；ESP32 上真双核 |
| GPIO ISR 事件源 | 统一走 `pal_gpio_enable_interrupt` 注册 + `pal_irq_set_pending` 软触发（sim/ESP32 同路径） |
| 不变量强度 | 每场景 1–2 个不变量 + `N_ITER = 10000` stress |
| 验收 | 正向+边界 + stress + 不变量 + UBSan + ASan + sim seed 确定性回归 |

## 3. 目录结构与骨架

### 3.0 IRQ 号命名空间与 target 分发路径

**约束**：host `HOST_MAX_IRQ = 32`（见 `targets/host/pal_hal_host.c` s_host_irq_table），三个 IRQ 号必须都 < 32 且不与 target 内部预占号冲突。

**IRQ 号分配**（集中定义于 `concurrency_stress.h`，避免撞码）：

```c
/* concurrency_stress.h —— 私有 IRQ 号命名空间 [16, 20) */
#define SOFT_IRQ_NUM         16u   /* Scenario #2 软触发 */
#define BTN_GPIO_IRQ_NUM     17u   /* Scenario #3 GPIO 中断（若走 pal_irq 路径） */
#define WORKER_IRQ_NUM       18u   /* Scenario #4 SMP 契约 */
/* 19 预留 */
```

选 [16, 20) 是把 [0, 16) 留给 target 内部占用（如 esp32/wasm 的 systick、GPIO 分发服务的内部 slot），避免撞车。

**Trace code 命名空间**（同上，集中定义）：

```c
#define TRACE_CODE_CONCURRENCY_STRESS_BASE  9000u
#define TRACE_CODE_ALL_SCENARIOS_FAILED     9001u
/* 9000~9099 归属 samples/concurrency_stress */
```

**GPIO 分发路径连通性验证**（M1）：Scenario #3 有两条可选路径，实施前必须**在实际代码中确认**：

| 路径 | 判定问题 | 若成立 | 若不成立 |
|------|---------|-------|---------|
| A：`pal_gpio_enable_interrupt` 内部**注册到** `s_host_irq_table[BTN_GPIO_IRQ_NUM]` | `pal_irq_set_pending(BTN_GPIO_IRQ_NUM)` 能触发 `button_isr` | 直接用 §3.0 分配的 `BTN_GPIO_IRQ_NUM` | —— |
| B：GPIO 中断走**独立分发链路**（如 `s_host_gpio_table[pin]`）| `pal_irq_set_pending` 与 GPIO 分发**不连通** | —— | Scenario #3 改用 target 专用的 `pal_host_trigger_gpio(pin)` 或等价 helper；若不存在，实施前需在 host target 里加最小 helper |

**实施动作**：在写 `scenario_gpio_isr.c` 前先 grep `targets/host/pal_hal_host.c` 中 `pal_gpio_enable_interrupt` 的实现，确认走哪条路径；把结论回填本节，把上表 `—— ` 换成实际选定分支。

**ESP32 侧同样验证**：`targets/esp32/pal_hal_esp32_gpio.c` 里 GPIO ISR 通过 `gpio_isr_handler_add` 注册，不经过 `s_host_irq_table` 类结构；因此**ESP32 上必须走真实电平沿触发**（README 里的 LED→BTN 跳线路径），不能靠 `pal_irq_set_pending` 软触发。

### 3.1 目录结构

```
wink-micro-os/samples/concurrency_stress/
├─ CMakeLists.txt
├─ README.md
├─ device_tree.h                     # 最小设备表（承载 ISR 上下文）
├─ device_tree.c
├─ concurrency_stress.h              # scenario 编号 + 不变量 tag 常量 + IRQ 号 + trace code
├─ app_callbacks.c                   # 编排入口
├─ scenario_task_task.c              # #1
├─ scenario_task_isr.c               # #2
├─ scenario_gpio_isr.c               # #3
├─ scenario_smp_sync.c               # #4（内含 WINK_ALLOW_ADVANCED_IRQ_APIS）
└─ test_concurrency_stress_e2e.c     # host e2e 主
```

**平级新增目录** `wink-micro-os/samples/concurrency_stress_broken/`（negative sample，见 §4.5）：刻意打破每个不变量以证明"sample 有检测能力"，通过 CMake `WILL_FAIL 1` 门禁固化。

### 3.2 Scenario 统一接口

```c
/* concurrency_stress.h */
int concurrency_stress_run_task_task(uint32_t seed);
int concurrency_stress_run_task_isr (uint32_t seed);
int concurrency_stress_run_gpio_isr (uint32_t seed);
int concurrency_stress_run_smp_sync (uint32_t seed);

/* 返回：0 = 通过；负数 = 首个失败的不变量 tag（负数错误码约定，见 ADR-0001） */
```

**Scenario 进入-退出契约**（避免 scenario 间状态泄漏，M2）：每个 `concurrency_stress_run_*` 必须保证：

1. **入口**清零自己的 file-scoped `static struct`（不依赖 zero-init，避免连跑残留）。
2. **出口**成对调 `pal_irq_disable`，清零所有 pending，注销所有 GPIO ISR。
3. **出口**不留下任何未配对的 `pal_irq_save`/`restore`（`pal_host_get_irq_lock_depth()` 应归零，见 §9 DoD）。

DoD 独立性检查：任意子集单跑与全跑输出一致（通过 `CONCURRENCY_STRESS_ENABLED_MASK` 位掩码控制启用 subset，见 §5.3）。

### 3.3 编排入口（app_callbacks.c）

```c
static void app_init(void) {
    device_tree_apply_flash_config();

    #ifndef CONCURRENCY_STRESS_SEED
    #define CONCURRENCY_STRESS_SEED 0xC0FFEEu
    #endif
    uint32_t seed = CONCURRENCY_STRESS_SEED;

    int r1 = concurrency_stress_run_task_task(seed);
    int r2 = concurrency_stress_run_task_isr (seed);
    int r3 = concurrency_stress_run_gpio_isr (seed);
    int r4 = concurrency_stress_run_smp_sync (seed);

    if (r1 || r2 || r3 || r4) {
        wink_trace_fault(TRACE_CODE_ALL_SCENARIOS_FAILED);
    } else {
        puts("SAMPLE PASS: all concurrency scenarios ok");
    }
}
static void app_loop(void) { /* init 阶段已跑完 */ }
```

### 3.4 e2e 主（host）

与 `dual_task_demo/test_dual_task_demo_e2e.c` 同构：`wink_runtime_run(cb, 100)` → 检查 `wink_trace_count() == 0` → `E2E PASS/E2E FAIL`。

### 3.5 失败输出格式（CI grep 友好）

```
SAMPLE FAIL: scenario=<N> invariant=<tag> [ctx=<extra>]
```

- `scenario` ∈ `{1,2,3,4}`
- `tag` 见 §4 各场景表
- CI 从串口/stdout grep `SAMPLE FAIL:` 一行即可定位到具体不变量

## 4. Scenario 详细设计

### 4.0 通用约定

**ISR 定义两种形式的选择规则**（M6，本节作为 AI codegen 学习点）：

- **`PAL_DEFINE_ISR(name, ctx_type, ctx_name)`**：当 ISR `arg` 是**具体结构指针**且 ISR 内需要访问其字段时（如 Scenario #3 的 `button_ctx`）；宏自动生成类型转换 wrapper，消除手动 cast。
- **raw `static PAL_ISR void name(void *arg)`**：当 `arg` **为 NULL 或不关心类型**时（如 Scenario #2/#4 共享 file-scoped `static struct`）；此时 `PAL_DEFINE_ISR` 反而更啰嗦。

两种形式在 ABI 上完全等价（均为 `pal_isr_t`），选择只是**代码风格**。AI codegen 遇到"是否有明确的 per-ISR 上下文结构"这个判据即可决定。

**不变量 tag 常量与 trace code**：均集中在 `concurrency_stress.h` 定义，避免与其他 sample 撞码（trace code 命名空间见 §3.0）。

### 4.1 Scenario #1 — 任务-任务共享数据竞争

**目的**：验证 `PAL_CRITICAL_SECTION` 对纯任务共享变量的保护。

**sim 上的检测能力（诚实标注）**：sim 单虚拟核 + 协作式调度使得单次写入天然原子，`INV_TT_NO_TORN` 在 sim 上是 vacuous——它主要证明"编译器未 mis-lower `uint64_t` 写入"。**真 torn write 保护验证依赖 ESP32 双核**（见 §1.3）。为把"sample 有检测能力"落地成证据，本场景配套一个负控制变体 `scenario_task_task_no_cs.c`（编译期开关 `CONCURRENCY_STRESS_NO_CS=1`，见 §4.5），期望其在 ESP32 双核下**能红**。

**共享状态**：

```c
static struct {
    uint32_t producer_count;
    uint32_t consumer_count;
    uint64_t sum;
    uint32_t last_payload;
} g_shared;
```

**任务**：

- `producer_task`：`N_ITER` 次 `PAL_CRITICAL_SECTION({ producer_count++; sum += payload; last_payload = payload; })`；`payload` 由 `wink_phys_prng_next` 从 seed 派生。
- `consumer_task`：`N_ITER` 次 `PAL_CRITICAL_SECTION({ consumer_count++; })`。

两者同优先级，栈 4KB，`pal_os_sleep_ms(0)` 让出以最大化交错。

⚠️ **sim yield 语义**（m6）：实施前须确认 `pal_os_sleep_ms(0)` 在 sim 调度器下是否触发调度点。若是 no-op，两 task 会顺序跑完，本 sample "stress" 名不副实（虽然不变量仍满足）。若确认 no-op，改用其他强 yield 原语（如 `pal_os_task_yield`）。

**不变量**：

| Tag | 断言 | 意义 | sim 检测能力 |
|-----|------|------|-------------|
| `INV_TT_BALANCE` | `producer_count == consumer_count == N_ITER` | 无丢步、无重入 | ✅ 有（早退/递增遗漏能被抓） |
| `INV_TT_NO_TORN` | `sum` 与从 seed 独立复算的和逐位相等 | 无 torn write | ⚠️ sim 恒真（协作式单核 write 天然原子）；ESP32 双核有实际语义 |

### 4.2 Scenario #2 — 任务-ISR 竞争（软触发）

**目的**：覆盖 `pal_irq_save_rtos_safe/restore` 对任务-ISR 共享状态的保护；覆盖 `pal_irq_set_pending` 的完整分发路径。

**sim 上的检测能力（诚实标注）**：host `pal_irq_set_pending` 无锁时**同步**在调用者栈上跑 ISR、持锁时**静默丢弃**（无 pending 队列）。因此本场景在 sim 上**无真"任务-ISR 抢占"**——`trigger_task` 调 `set_pending` 是内联函数调用，`drain_task` 根本没机会与之交错。`INV_TI_NO_LOSS`/`INV_TI_ORDERING` 在 sim 上是无并发前提下的恒真断言。**真语义验证依赖 ESP32 双核**（见 §1.3）。sim 上本场景的价值收窄为：**API 编译通过 + 分发路径存在 + 计数守恒（happy path）**。

**共享状态**：

```c
static volatile struct {
    uint32_t isr_fires;
    uint32_t task_observed;
    uint32_t drops;
    uint32_t ring[64];       /* 故意小容量，逼近覆盖丢边界 */
    uint32_t head, tail;
} g_ti;
```

**注册**：`pal_irq_enable(SOFT_IRQ_NUM, PAL_IRQ_PRIO_NORMAL, soft_isr, NULL)`

**ISR**（`arg=NULL` 时用 raw `pal_isr_t` 签名，`PAL_ISR` 修饰；`PAL_DEFINE_ISR` 宏需要具体结构类型，不适用 `void` 上下文；混用规则见 §4 头部）：

```c
static PAL_ISR void soft_isr(void *arg) {
    (void)arg;
    /* M3：显式检测 ring 覆盖丢，让 INV_TI_ORDERING 非 vacuous */
    if ((uint32_t)(g_ti.head - g_ti.tail) >= 64u) {
        g_ti.drops++;
        return;
    }
    g_ti.ring[g_ti.head & 63u] = g_ti.head;
    g_ti.head++;
    g_ti.isr_fires++;
}
```

**任务**：

- `trigger_task`：`N_ITER` 次 `pal_irq_set_pending(SOFT_IRQ_NUM)` + 让出
- `drain_task`：循环取 head/tail 快照 → CS **仅**保护 tail 前进那一步 → CS 外做元素校验：

```c
/* M5：CS 只包共享游标更新，校验/递增 task_observed 放 CS 外 */
uint32_t local_head, local_tail;
PAL_CRITICAL_SECTION({ local_head = g_ti.head; local_tail = g_ti.tail; });
while (local_tail != local_head) {
    uint32_t v = g_ti.ring[local_tail & 63u];  /* 校验放 CS 外 */
    if (v != local_tail) { return -INV_TI_ORDERING; }
    local_tail++;
}
PAL_CRITICAL_SECTION({ g_ti.tail = local_tail; g_ti.task_observed += ...; });
```

**不变量**：

| Tag | 断言 | 意义 | sim 检测能力 |
|-----|------|------|-------------|
| `INV_TI_NO_LOSS` | `isr_fires == N_ITER && task_observed == isr_fires` | ISR 未丢发、任务未漏读 | ⚠️ sim 恒真（无真抢占）；ESP32 双核有实际语义 |
| `INV_TI_ORDERING` | `drops == 0` 且 ring 元素严格单调 | 无覆盖丢 | ⚠️ sim 恒真；ESP32 双核有实际语义 |

**边界补充**（各 1 次，不进 stress 循环）：

- 未注册 IRQ 号调 `set_pending` → 期望不崩（或返 error），不做数值断言，只求"跑完不 fault"。
- ISR 上下文里调 `pal_irq_save_rtos_safe/restore` → 期望嵌套 mask 正确恢复（`mask_after_restore == mask_before_save`）。

### 4.3 Scenario #3 — GPIO 硬中断路径

**目的**：覆盖 `pal_gpio_enable_interrupt` 的完整注册链路 + 上下文参数 `arg` 在多次触发下的完整性。

**上下文**：

```c
struct button_ctx {
    uint32_t press_count;
    uint32_t magic;         /* 0xDEADBEEFu，ISR 每次校验 */
    uint32_t arg_corruption;
};
static struct button_ctx g_btn = { .magic = 0xDEADBEEFu };
```

**ISR**：

```c
PAL_DEFINE_ISR(button_isr, struct button_ctx, btn) {
    if (btn->magic != 0xDEADBEEFu) btn->arg_corruption++;
    btn->press_count++;
}
```

**流程**：`pal_gpio_enable_interrupt(BTN_PIN, PAL_GPIO_EDGE_RISING, button_isr, &g_btn)` → `N_ITER` 次 `pal_irq_set_pending(BTN_GPIO_IRQ_NUM)` → `pal_gpio_disable_interrupt(BTN_PIN)`。

**不变量**：

| Tag | 断言 | 意义 |
|-----|------|------|
| `INV_GPIO_DELIVERY` | `press_count == N_ITER` | 每次 pending 都成功分发 |
| `INV_GPIO_ARG_INTEGRITY` | `arg_corruption == 0 && magic == 0xDEADBEEFu` | 上下文指针未错乱、无 UAF |

**ESP32 可选人工验证**（README 提供，不进 CI）：

用一根跳线把 `LED_PIN → BTN_PIN`，用 `dal_led_toggle` 产生真实电平沿，替代 `pal_irq_set_pending` 走完整硬件路径。这是开发者调试链路的加分项，不进任何自动化门禁。

### 4.4 Scenario #4 — SMP 契约（sim = API 表面验证；ESP32 = 真同步）

**目的**：验证 `disable → synchronize → free` 三步顺序在 API 层能正常执行，`synchronize` 返回后释放资源不产生 UAF。

**sim 上的检测能力（诚实标注 —— 关键收窄）**：host `pal_irq_synchronize` 是**空操作**（`targets/host/pal_hal_host.c:304`），且 `pal_irq_disable` 后 ISR 表被清零 → 后续 `set_pending` 无效果 → `synchronize` 空跑 → `free`。这条路径上**永远不会**存在"另一核心还在 ISR 里"的场景，因此 **ASan 在 sim 上对 `pal_irq_synchronize` 契约无检测能力**。

sim 上本场景的实际价值收窄为：

- ✅ 三步 API 编译过、返回码正确、流程走到底不 fault（`INV_SMP_NO_CRASH`）。
- ✅ `WINK_ALLOW_ADVANCED_IRQ_APIS` 门控与 `#include "pal_irq_advanced.h"` 组合能编译（对 ADR-0018 §142 物理隔离机制的正面验证）。
- ❌ `synchronize` 是否真的等 ISR 退出——**不能**在 sim 上检测。
- ❌ 双核 UAF——**不能**在 sim 上检测；ASan 只能兜住 sample 自身代码的普通 malloc/free 越界（有价值但与 synchronize 契约无关）。

**真语义验证完全依赖 ESP32 双核跑**（见 §1.3 表）。ADR-0018 §142 物理隔离契约的编译期证据由 §5.5 的 `try_compile(EXPECTED_FAIL)` 负测试提供。

**头文件门控**：文件顶部 `#define WINK_ALLOW_ADVANCED_IRQ_APIS 1` 后再 `#include "pal_irq_advanced.h"`，符合 ADR-0018 §142 的物理隔离契约。

**共享状态**：

```c
static struct {
    uint8_t *resource;
    uint32_t use_after_free_hit;
} g_smp;
```

**ISR**（同 §4.2，`arg=NULL` 用 raw 签名）：

```c
static PAL_ISR void worker_isr(void *arg) {
    (void)arg;
    if (g_smp.resource == NULL) { g_smp.use_after_free_hit++; return; }
    g_smp.resource[0]++;
}
```

**流程**：

```c
g_smp.resource = pal_os_malloc(64);
pal_irq_enable(WORKER_IRQ_NUM, PAL_IRQ_PRIO_NORMAL, worker_isr, NULL);
for (uint32_t i = 0; i < N_ITER; ++i) {
    pal_irq_set_pending(WORKER_IRQ_NUM);
    if ((i % 128) == 0) pal_os_sleep_ms(0);
}
pal_irq_disable(WORKER_IRQ_NUM);
pal_irq_synchronize(WORKER_IRQ_NUM);   /* 关键契约（ESP32 上有效；sim 上空跑） */
uint8_t *tmp = g_smp.resource;
g_smp.resource = NULL;
pal_os_free(tmp);
```

**不变量**：

| Tag | 断言 | 意义 | sim 检测能力 |
|-----|------|------|-------------|
| `INV_SMP_CONTRACT_ORDER` | `use_after_free_hit == 0` | 顺序正确 = 释放安全 | ⚠️ sim 恒真（无真双核抢占）；ESP32 双核有实际语义 |
| `INV_SMP_NO_CRASH` | 流程跑完不 fault | 契约 API 能正常运行到底 | ✅ 有（sim/ESP32 均有效） |

**明确不加**的不变量：读取 target 内部 in-flight counter 归零——这需要在 PAL 加 debug introspection API，属于低价值高 churn。ASan 只兜住 sample 自身代码的普通 UAF，与 `synchronize` 契约验证无关。

### 4.5 Negative Sample —— 证明"sample 有检测能力"（v1）

单纯写不变量不等于能检测——**必须**能构造出让不变量变红的最小反例，否则 CI 绿只是 vacuous。在 `wink-micro-os/samples/concurrency_stress_broken/` 里维护一组反例：

| 反例文件 | 打破什么 | 期望红的不变量 | 运行 target |
|---------|---------|--------------|------------|
| `broken_task_task_no_cs.c` | Scenario #1 去掉 `PAL_CRITICAL_SECTION` | `INV_TT_BALANCE`（或 `INV_TT_NO_TORN` on ESP32） | ESP32（sim 单核仍会通过——这本身是 §1.3 分层的证据） |
| `broken_task_isr_no_cs.c` | Scenario #2 drain 去掉 CS | `INV_TI_NO_LOSS` | ESP32（sim 同上） |
| `broken_gpio_arg_swap.c` | Scenario #3 注册时传错 `arg` 指针 | `INV_GPIO_ARG_INTEGRITY`（`magic` 校验失败） | sim + ESP32 | 
| `broken_smp_free_before_sync.c` | Scenario #4 颠倒 `disable → free → synchronize` 顺序 | ASan 报告（**仅** ESP32 双核有效） | ESP32 |

CMake 用 `add_test(... PROPERTIES WILL_FAIL 1)` 声明"这些 target 期望不变量红"，若某天负样本反而绿了，CI 会因此红——这是"sample 自身检测能力"的元级门禁。

**sim 上不能证明的**：sim 单核使 #1/#2 的 broken 变体仍会通过，这正是 §1.3"sim 不假装并行"的物质证据；README 应指出"完整 negative 验证需在 ESP32 上跑"，将 sim 侧限定在 #3/#4 编译期与 ASan 可捕获的部分。

## 5. CMake / 构建集成

### 5.1 顶层 CMake（`wink-micro-os/CMakeLists.txt`）

在现有 sample 列表尾部（约 L203 `dual_task_demo` 之后）追加：

```cmake
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/samples/concurrency_stress
                 ${CMAKE_BINARY_DIR}/concurrency_stress_build)
```

**不改**：`WINK_APP_DIR` 默认仍是 `avoidance_car`；本 sample 只作为额外的 host e2e target 存在。

### 5.2 Sample 自身 CMake

`wasm` 分支：`set(WINK_APP_SOURCES ${APP_SOURCES} PARENT_SCOPE)`——把 `device_tree.c` + `app_callbacks.c` + 4 个 `scenario_*.c` 导出，`test_*_e2e.c` **不**导出（e2e 主仅 host）。

`host` 分支（`if(NOT EMSCRIPTEN)`）：构造 `app_concurrency_stress_e2e` 可执行 + `add_test(NAME app_concurrency_stress_e2e ...)`。链接列表与 `dual_task_demo` 同构。

### 5.3 编译期参数化

| CMake 变量 | 缺省 | 覆盖方式 |
|------------|------|----------|
| `CONCURRENCY_STRESS_SEED` | `0xC0FFEEu` | `cmake -DCONCURRENCY_STRESS_SEED=0x1234` |
| `CONCURRENCY_STRESS_N_ITER` | `10000` | `cmake -DCONCURRENCY_STRESS_N_ITER=5000` |
| `CONCURRENCY_STRESS_RING_CAPACITY` | `64` | `cmake -DCONCURRENCY_STRESS_RING_CAPACITY=32`（配合降载，保持 N/capacity 比 ≈156，m3） |
| `CONCURRENCY_STRESS_ENABLED_MASK` | `0xF`（4 scenario 全启） | `cmake -DCONCURRENCY_STRESS_ENABLED_MASK=0x5`（仅 #1 和 #3）——scenario 独立性验证用（M2） |

两者以 `target_compile_definitions(... PRIVATE)` 注入。ESP32 侧走 `idf.py build -DCONCURRENCY_STRESS_SEED=...`（透传到 main 组件编译单元）。

**降载 profile 的等比例约束**（m3）：在 sanitizer 慢跑下降到 `N=5000` 时，`RING_CAPACITY` 也应降到 `32`，保持"边界压力"（N/capacity 比）不变——不然本场景的 ring 覆盖丢边界检测强度会随降载而弱化。

### 5.4 ESP32 集成

**零 CMake 改动**——`esp32_firmware/generate_app_sources.ps1` 自动扫描 `wink-micro-os/samples/concurrency_stress/` 下所有 `.c`（排除 `test_*.c`），生成 `app_sources.cmake` 被 `main/CMakeLists.txt` include。构建命令：

```powershell
idf.py -C D:\workspaces\ai-coding\wink-ai\wink-ai-embedded\esp32_firmware `
       build -DWINK_APP=concurrency_stress
idf.py -C ... flash monitor
```

**扫描规则确认清单**（m4）：实施前 grep `esp32_firmware/generate_app_sources.ps1`，把该脚本实际使用的 include glob（`*.c` 白名单？特定文件名？）在此段注释里贴出行号 + 关键代码片段，确保多 `scenario_*.c` 不会被漏。**若规则是白名单**，则须扩展 sample 部分的白名单枚举。

### 5.5 编译期负测试 —— ADR-0018 §142 物理隔离契约验证（v3）

在 `wink-micro-os/samples/concurrency_stress_broken/CMakeLists.txt` 中：

```cmake
# 期望编译失败：include pal_irq_advanced.h 但不定义 WINK_ALLOW_ADVANCED_IRQ_APIS
try_compile(
    ADV_IRQ_GUARD_HOLDS
    ${CMAKE_BINARY_DIR}/try_compile_adv_irq_guard
    SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/negative_include_advanced_irq.c
    CMAKE_FLAGS "-DINCLUDE_DIRECTORIES=${CMAKE_SOURCE_DIR}/pal/include"
    OUTPUT_VARIABLE _out
)
if(ADV_IRQ_GUARD_HOLDS)
    message(FATAL_ERROR "pal_irq_advanced.h #error guard is broken —— ADR-0018 §142 violated")
endif()
```

`negative_include_advanced_irq.c`：

```c
/* 期望编译失败：#error "Advanced IRQ APIs are restricted..." */
#include "pal_irq_advanced.h"
```

这条负测试把 ADR-0018 §142 的物理隔离机制从**设计承诺**变成**机械门禁**——若未来有人不慎删掉 `#error`，本 sample 立刻红。

## 6. CI / 测试矩阵

### 6.1 三 pass 结构（`python wink-tools/wink.py test` 扩展）

现有 `python wink-tools/wink.py test` 已有 Pass 1（default）+ Pass 2（`-Sanitize` UBSan）。**新增 Pass 3**：

| Pass | 触发 | Build dir | 关键 flags |
|------|------|-----------|------------|
| 1 default | 无 | `build-test/` | 无 sanitize |
| 2 sanitize | `-Sanitize` / `-Full` | `build-test-san/` | `-fsanitize=undefined -fsanitize-undefined-trap-on-error -Wcast-function-type -Werror=cast-function-type` |
| 3 asan（新增） | `-Sanitize` / `-Full` | `build-test-asan/` | `-fsanitize=address -fno-omit-frame-pointer` |

**Pass 3 ASan 的实际检测范围（诚实标注 —— B3）**：

- ✅ Scenario #2 的 ring 越界访问、`ring[head & 63]` 索引错误。
- ✅ 任何 malloc/free 路径的经典越界/UAF（如 sample 自身代码 bug）。
- ✅ Scenario #4 里 `free(tmp)` 后仍持有 `g_smp.resource` 的普通 sample 编码错误。
- ❌ **对 `pal_irq_synchronize` 语义无检测能力**（host 上 synchronize 是空跑，无异步 ISR，ASan 拦不到实际不存在的 UAF）。**双核 UAF 真语义**须靠 ESP32 真机跑覆盖。

因此 Pass 3 的价值定位是"**sample 自身代码质量兜底 + ring 越界 catcher**"，**不是**"决定性覆盖 SMP 契约 UAF"——后者不存在于 sim 上。

### 6.2 Multi-seed 循环（`-Full` 触发）

`python wink-tools/wink.py test --full` 尾部追加：

```powershell
$seeds = @('0xC0FFEEu','0xDEADBEEFu','0x12345678u')
foreach ($s in $seeds) {
    cmake -B build-test-seed-$s -DTARGET_PLATFORM=host `
          -DCONCURRENCY_STRESS_SEED=$s -DCONCURRENCY_STRESS_N_ITER=5000 *> $null
    cmake --build build-test-seed-$s --target app_concurrency_stress_e2e *> $null
    & "build-test-seed-$s/app_concurrency_stress_e2e.exe" | Out-Null
    if ($LASTEXITCODE -ne 0) { $failedSeeds += $s }
}
```

**为什么只在 `-Full`**：日常迭代（`-Sanitize`）已经覆盖单 seed 三 pass；多 seed 属于 CI/pre-PR gate 的加强，成本换收益的分档。

**Seed 选择说明**（m2）：`0xC0FFEE / 0xDEADBEEF / 0x12345678` 是任意选定的、对 `uint32_t` 空间的粗粒度采样（3 个"人类可读常量"，无特殊性质）。未来若发生 seed-specific 崩溃再定向增补——不是经过什么统计学挑选的黄金 seed。

### 6.3 确定性回归断言

`python wink-tools/wink.py test --full` 尾部：

```powershell
1..3 | ForEach-Object {
    & "build-test/app_concurrency_stress_e2e.exe" > "concurrency_run_$_.log"
}
$h = 1..3 | ForEach-Object { (Get-FileHash "concurrency_run_$_.log").Hash }
if (($h | Select-Object -Unique).Count -ne 1) {
    Write-Host "[FAIL] concurrency_stress non-deterministic across runs" -F Red
    exit 1
}
```

**它检测的具体故障模式（诚实标注 —— m1）**：给定 sim 单核协作式 + `WINK_SIM_SEED` 固定 + 无外部 I/O，同二进制跑 3 次几乎必然完全一致。因此本断言实质在守护：

- ✅ sample 代码里没打印过 `%p` 等地址依赖内容。
- ✅ 未依赖未初始化内存（UBSan/ASan 已先兜住）。
- ✅ 未依赖 heap 分配地址的数值。

**它不检测的**：sim 调度器的确定性契约本身——那有专门的 `test_single_task_semantic_regression.c` 等在守。本断言的收益/成本比高（几行 PowerShell + 3 次跑），保留为低成本、高信噪的兜底。

### 6.4 三端覆盖矩阵总表

| Target | 触发 | Scenario | 强度 | 检测语义（诚实标注） |
|--------|------|----------|------|-------------------|
| Host default | `python wink-tools/wink.py test` | 全 4 个 | `N=10000`, seed=default | API 表面 + happy path 计数守恒 |
| Host UBSan | `python wink-tools/wink.py test --sanitize` | 全 4 个 | `N=10000`（sanitize 慢时经 `-DCONCURRENCY_STRESS_N_ITER=5000` + `RING_CAPACITY=32` 等比降载） | + UB 检测 |
| Host ASan | `python wink-tools/wink.py test --sanitize` | 全 4 个 | `N=10000` | + sample 自身 malloc/free 越界（**非** SMP 契约 UAF） |
| Host multi-seed | `python wink-tools/wink.py test --full` | 全 4 个 × 3 seed | `N=5000` 每 seed | + seed-space 粗采样 |
| Host determinism | `python wink-tools/wink.py test --full` | 全 4 个 × 3 run | 输出 hash 比对 | + 无 `%p`/未初始化 |
| Host compile-guard 负测试 | `python wink-tools/wink.py test`（走 §5.5 `try_compile`） | pal_irq_advanced.h `#error` | 编译期 | ADR-0018 §142 物理隔离 |
| Host negative sample（§4.5） | `python wink-tools/wink.py test`（`WILL_FAIL 1`） | broken_gpio_arg_swap | sim 侧证据 | 证明 sample 有检测能力 |
| Wasm 编译 | `python wink-tools/wink.py test --with-wasm` | 编译通过即可（无 e2e） | — | API 跨 target 无平台漂移 |
| ESP32 真机 | `idf.py build flash monitor -DWINK_APP=concurrency_stress` | 全 4 个 + 全部 negative sample | `N=10000`，串口 grep `SAMPLE PASS/FAIL` | **真并发**语义：#1 torn write / #2 任务-ISR 抢占 / #4 双核 UAF |

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Sanitizer 慢跑挂 host CI 时间 | Pass 2/3 可通过 `-DCONCURRENCY_STRESS_N_ITER=5000` + `-DCONCURRENCY_STRESS_RING_CAPACITY=32` 等比降载（保持 N/capacity 比） |
| Scenario #2 ring 覆盖丢误伤（drain 慢于 trigger 是"正常"，但 `INV_TI_ORDERING` 会红） | drain 任务优先级 > trigger 任务；`pal_os_sleep_ms(0)` 让出确保 drain 有窗口。若仍误伤，README 明确 ring 容量与 N_ITER 的比例约束 |
| Scenario #4 sim 上"synchronize is essentially a no-op"，无法验证真语义 | 已接受：sim 只验 API 表面 + 编译过；真语义靠 ESP32 双核跑覆盖（§1.3 明示） |
| Scenario #1/#2 sim 上不变量恒真被误读为"通过 = 并发正确" | §1.3 表格 + §4.1/§4.2 sim 检测能力列显式标注；README 头部明写"sim = API 表面；ESP32 = 真语义" |
| ESP32 上 `PAL_CRITICAL_SECTION` 长时间持有触发 WDT | 每次 stress 循环中的 sleep(0) 让出；drain CS 已收窄至只包游标更新（§4.2 M5）；single-loop 时间 `< N_ITER × 数百 ns` 远低于 WDT 门槛 |
| Wasm build 因为 e2e 主里的 `wink_runtime_run` 断链 | e2e 主文件（`test_*_e2e.c`）**不**加入 `WINK_APP_SOURCES`，仅 host 分支引用；同 `dual_task_demo` 现状 |
| seed 覆盖不足导致假阳性通过 | `-Full` 的 3 seed + 确定性回归双保险 |
| Scenario 间状态泄漏破坏确定性 | §3.2 进入-退出契约；DoD 加"任意 subset 单跑与全跑等价"独立性检查（M2） |
| GPIO ISR 与 pal_irq 分发路径未连通 | §3.0 强制要求实施前 grep 确认 host 侧 `pal_gpio_enable_interrupt` 走哪条路径，把结论回填 §3.0 表格（M1） |

## 8. 决策关联文档更新（回写）

按 CLAUDE.md §2 "决策回写" 规则，本 sample 落地后需要同步：

1. **不写 ADR**：本 sample 不改变任何设计决策，仅是既有 API 的验证载体。
2. **回写活文档 ①**：`02-wink-micro-os/02-pal-platform-abstraction.md` 末尾追加"参考 sample：`samples/concurrency_stress` 演示 IRQ + 任务并发的正确用法"。
3. **写实施计划 ③**：`docs/tech-designs/unisim/2026-07-20-co-simulation-plugin-contract.md`，包含任务拆分（scenario 分别实现→CI 集成→文档回写）、验收标准、时间线。
4. **更新 Skill**：`.claude/skills/burn-firmware-esp32/SKILL.md` 的示例 App 列表加入 `concurrency_stress`。

## 9. 验收标准（DoD）

| 项 | 判据 |
|----|------|
| 4 个 scenario 全部实现 | `scenario_*.c` 各有对应 `concurrency_stress_run_*` 函数 |
| **§3.0 IRQ 号命名空间 + GPIO 分发路径已核对**（M1） | 表格里的 A/B 分支已根据实际代码填实；`concurrency_stress.h` 里的 `SOFT/BTN/WORKER` 号均 < 32 且无撞码 |
| **Scenario 独立性**（M2） | `-DCONCURRENCY_STRESS_ENABLED_MASK=<每个单 bit>` 单跑，每个 scenario 输出与全跑对应段一致；`pal_host_get_irq_lock_depth()` 全程归零 |
| **INV_TI_ORDERING 非 vacuous**（M3） | 手工把 ISR 的 drops 检测改成 `head - tail >= 0`（错误上界），确认 CI 变红——证明该不变量真的能失败 |
| **Negative sample 全部通过 WILL_FAIL 门禁**（v1） | `concurrency_stress_broken/` 下全部 target `WILL_FAIL 1` 达成；若某个负样本反而绿，CI 红 |
| **`pal_irq_advanced.h` #error 门控编译期验证通过**（v3、§5.5） | `try_compile(EXPECTED_FAIL)` 在 negative_include_advanced_irq.c 上返回失败 |
| Host default 通过 | `python wink-tools/wink.py test` 中 `app_concurrency_stress_e2e` `add_test` 绿 |
| Host UBSan 通过 | `python wink-tools/wink.py test --sanitize` Pass 2 绿 |
| Host ASan 通过 | `python wink-tools/wink.py test --sanitize` Pass 3 绿（新增） |
| Host multi-seed 通过 | `python wink-tools/wink.py test --full` 3 seed 全绿 |
| Host determinism 通过 | `python wink-tools/wink.py test --full` 尾部 hash 比对无差 |
| Wasm 构建通过 | `python wink-tools/wink.py test --with-wasm` 无编译错误 |
| ESP32 真机通过 | `idf.py build flash monitor -DWINK_APP=concurrency_stress` 串口输出 `SAMPLE PASS` |
| **ESP32 真机 negative sample 至少一个能红**（v1，ESP32 侧证据） | `broken_task_task_no_cs` 在 ESP32 双核下能拉红 `INV_TT_BALANCE` 或 `INV_TT_NO_TORN` |
| 文档回写完成 | `02-pal-platform-abstraction.md` 追加参考；`burn-firmware-esp32 SKILL.md` 加入 App 列表 |

## 10. 变更影响面（Change Blast Radius）

| 修改类型 | 文件 |
|----------|------|
| **新增** | `wink-micro-os/samples/concurrency_stress/` 全部（≈10 个文件） |
| **新增** | `wink-micro-os/samples/concurrency_stress_broken/` 全部（§4.5 negative sample + §5.5 编译期负测试，≈6 个文件） |
| **新增** | `docs/tech-designs/unisim/2026-07-20-co-simulation-plugin-contract.md` |
| **新增** | `docs/reviews/unisim/2026-07-02-concurrency-stress-sample-design-review.md`（v0 评审归档） |
| **修改（追加 2 行）** | `wink-micro-os/CMakeLists.txt`（+`add_subdirectory` × 2：主 sample + broken sample） |
| **修改（追加数节）** | `python wink-tools/wink.py test`（Pass 3 ASan、`-Full` multi-seed、`-Full` determinism） |
| **修改（回写 1 段）** | `docs/design/02-wink-micro-os/02-pal-platform-abstraction.md` |
| **修改（App 列表）** | `.claude/skills/burn-firmware-esp32/SKILL.md` |
| **不改动** | PAL 头文件、PAL 实现、DAL、targets/*、任何 ADR |

PAL API 表面积**零变动**是本设计的显式设计目标，也是"低价值高 churn"约束的直接体现。**唯一例外**：M1 验证若发现 host `pal_gpio_enable_interrupt` 走独立分发链路（B 路径）且缺少软触发 helper，允许在 `targets/host/` 加最小 helper（`pal_host_trigger_gpio(pin)`），此为 target 内部辅助而非 PAL 表面变动。

---

## 11. 修订日志

- **2026-07-02 v0（Draft）**：初稿，4 场景 + 三 pass CI + multi-seed + 确定性回归。
- **2026-07-02 v1（评审后修订）**：合入 [`reviews/2026-07-02-concurrency-stress-sample-design-review.md`](../../reviews/unisim/2026-07-02-concurrency-stress-sample-design-review.md) 的 P0/P1/P2 项：
    - **B1/B3 + m1**：§1.3 新增"sim 上的能力边界"表格；§4.2/§4.4/§6.1/§6.3 收回 sim 上"检出真并发/UAF"的过度承诺，改为诚实分层。
    - **B2**：§4.1 `INV_TT_NO_TORN` 明确标注 sim 恒真、真语义靠 ESP32。
    - **M1**：新增 §3.0 IRQ 号命名空间 + GPIO 分发路径连通性验证表，实施前必须回填。
    - **M2**：§3.2 加 scenario 进入-退出契约；§5.3 加 `CONCURRENCY_STRESS_ENABLED_MASK` 参数；§9 DoD 加独立性检查。
    - **M3**：§4.2 ISR 补 drops 递增逻辑，使 `INV_TI_ORDERING` 非 vacuous。
    - **M4**：§3.0 集中定义 trace code 9000-9099 命名空间；替换 `wink_trace_fault(9001u)` 为具名常量。
    - **M5**：§4.2 drain_task 的 CS 收窄至只包游标更新。
    - **M6**：§4.0 通用约定新增 `PAL_DEFINE_ISR` vs raw `pal_isr_t` 的选择规则。
    - **v1**：§4.5 新增 negative sample 子目录；§9 DoD 加 `WILL_FAIL` 门禁。
    - **v3**：§5.5 新增 `pal_irq_advanced.h` `#error` 门控的 `try_compile(EXPECTED_FAIL)` 编译期负测试。
    - **m2/m3/m4/m6**：§6.2 补 seed 选择说明；§5.3 加 `RING_CAPACITY` 参数；§5.4 加扫描规则确认清单；§4.1 加 sim yield 语义确认要求。



# 实施计划：ADR-0009 host 试点 Wave 1 — 物理退化算法库 + 按键抖动端到端

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `subagent-driven-development`（推荐）或 `executing-plans` 逐任务实施。步骤用 `- [ ]` 跟踪。

**Goal:** 在 host 端落地 ADR-0009 物理特性退化的可测核心——target 无关算法库（抖动/RC/PRNG/warmup/总线-drop 五算法全单测）+ 按键抖动接 `dal_button` 端到端对照 + 参数化故障配置，为后续 wasm 集成铺路，零新外设。

**Architecture:** ADR-0009 方案 C 双域模型在 host 的映射——host 桩注入理想值 → target 无关退化算法库（`pal/src/wink_sim_physical.c`，虚拟时钟 `pal_get_us` 驱动 + 确定性 PRNG）施加物理有损 → host PAL（`pal_gpio_read`）返回退化值 → DAL（`dal_button_poll` 现有去抖）消费。

**Tech Stack:** C11 / Unity 单测 / CMake host OBJECT 库 / wink-micro-os PAL+DAL（`add_wink_host_test` + `add_wink_test_sim`）。

## 元数据表

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260628-ADR0009-HOST-PILOT-WAVE1` |
| **创建日期** | 2026-06-28 |
| **目标平台/SoC** | `host`（唯一交付）；算法库 target 无关，wasm 复用为 Wave 外 |
| **工具链/SDK版本** | GCC 16.1.0 (MinGW) / cmake / Ninja / MSVC（host 双链 0 warning） |
| **计划状态** | ✅ 已完成（2026-06-28 落地；见 commit `484be28..79fb5fb`，Merge `7faa249`。事后回填状态字段：2026-07-03） |
| **优先级** | 🟡 P1（推进唯一未决 ADR-0009，验证方案 C 机制） |
| **计划版本** | v1.0 |
| **关联技术设计** | 无，已并入本计划 |
| **关联设计规范** | `04-wasm-simulation/`（仿真保真度）、`02-wink-micro-os/`（PAL/DAL） |
| **关联评审记录** | 无 |
| **关联 ADR** | [ADR-0009](../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)（Proposed）。**Wave 1 = 方案 C 机制 PoC，非 Acceptance**：在 host 验证退化算法正确性 + 抖动端到端，并产出对 ADR §3.1 的修订项（抖动模型从 `(now/P)%2` 改为强制交替，消除采样混叠）。ADR Accepted 待 wasm 虚拟时钟（ADR-0003 决策 3）落地。 |
| **目标里程碑** | ADR-0009 host Wave 1（机制闭环） |
| **前置依赖计划** | 无（baseline ctest 全绿） |
| **计划负责人** | 主架构师 |
| **所需子代理技能** | `embedded-best-practice` |

---

## 1. 背景与目标

### 1.1 问题陈述
ADR-0009 解决「仿真一致性逃逸」：仿真端 GPIO/ADC/总线输入是干净理想值，导致按键去抖、传感器预热/采样间隔、ADC 滤波、总线超时退回等防御性代码在 Web 端未经验证，烧录真机后死锁。方案 C（双域混合）已定，§3 有抖动/RC/预热/PRNG 的代码骨架。但 §4.1 确定性守卫要求 Wasm 虚拟时钟，当前 wasm `pal_get_us` 是 JS 墙钟（`pal_osal_wasm.c:18`，虚拟时钟为 ADR-0003 决策 3 路线项未做），故 wasm 全量落地阻塞。**host 端已有虚拟时钟（`s_time_us`）**，可在 host 上先行验证退化算法正确性。

### 1.2 技术/业务目标

> **ROI 分档（评审约束）**：抖动端到端是 Wave 1 **唯一可验证交付主线**；warmup / RC / bus_drop 三算法为「target 无关纯函数，为 wasm 集成铺路」，仅算法层单测、无外设端到端消费（端到端归 Wave 2）。计划不得以「五算法全单测」的体量掩盖主线交付。

- ✅ **【主线】按键抖动端到端 + 负对照**：host GPIO **电平跃变**注入 → `pal_gpio_read` 走抖动退化 → `dal_button_poll` 现有计数去抖吸收；**含负对照**（无去抖裸采样在抖动窗内必跳变）证明 §3.1「不写去抖则误触发」。
- ✅ **【铺路】target 无关退化算法库**：抖动状态机（强制交替）/ RC 低通+噪声 / 确定性 PRNG / warmup+采样间隔 / 总线丢包，五算法 host 全单测。
- ✅ 参数化故障配置 `wink_sim_faults_t`（§4.2 的 C 结构体承载，host 直接填）。
- ✅ 确定性守卫（§4.1）：全 `pal_get_us` 虚拟时钟 + 固定 PRNG seed（噪声/丢包）+ 抖动强制交替（采样周期无关、可硬编码 golden）。
- ✅ 零编译污染（§4.3）：算法库仅进 `pal_host` OBJECT，esp32/baremetal 不链接（CMake **显式枚举**源，已核验非 glob）。
- ✅ 零破坏性变更：不改 DAL 公开 API、不改既有 PAL 签名；无注入时行为等同现状。

### 1.3 成功指标

| 指标 | 通过标准 | 验证方法 |
|------|----------|----------|
| host 算法库单测 | 100% 通过（新增 `test_sim_physical`） | `cmake -B build-test -DTARGET_PLATFORM=host -G Ninja` → `ctest` |
| 既有测试回归 | 0 回归（全量 ctest 全绿） | 同上 |
| 按键端到端 | 抖动期电平跳变、去抖后稳定翻转 | `test_button_debounce_e2e`（`-DSIMULATION`）绿 |
| PAL 契约门禁 | `test_pal_contract` 绿 | ctest |
| 双链 | GCC+MSVC 0 error 0 warning | host 构建 |
| 零编译污染 | esp32/baremetal CMake 不含 `wink_sim_physical.c` | 构建脚本核验 |

---

## 2. 变更范围与影响分析

### 2.1 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `wink-micro-os/pal/include/wink_sim_physical.h` | 🆕 新增 | 故障配置结构 + 5 算法接口 + ctx 类型；顶部钉死确定性守卫契约 |
| `wink-micro-os/pal/src/wink_sim_physical.c` | 🆕 新增 | 5 算法实现（target 无关，纯 C，无 libm 依赖） |
| `wink-micro-os/test/test_sim_physical.c` | 🆕 新增 | 算法库 Unity 单测 + golden vector |
| `wink-micro-os/test/test_button_debounce_e2e.c` | 🆕 新增 | 按键抖动端到端对照（`-DSIMULATION`） |
| `wink-micro-os/test/stubs/host_test_ctrl.h` | ✏️ 修改 | +`sim_set_gpio_ideal`/`sim_clear_gpio_ideal`/`sim_set_faults` 声明 |
| `wink-micro-os/targets/host/pal_osal_host.c` | ✏️ 修改 | +GPIO 理想电平注入表 + per-pin 抖动 ctx + 全局 faults + `host_gpio_read_debounced` 访问器；`sim_reset_time` 清注入表 |
| `wink-micro-os/targets/host/pal_hal_host.c` | ✏️ 修改 | `pal_gpio_read` 顶部加退化路径（注入 pin → 抖动退化；否则现状 echo 逻辑） |
| `wink-micro-os/targets/host/CMakeLists.txt` | ✏️ 修改 | `pal_host` OBJECT 源列表 +`wink_sim_physical.c` |
| `wink-micro-os/test/CMakeLists.txt` | ✏️ 修改 | +`add_wink_host_test(test_sim_physical ...)` + `add_wink_test_sim(test_button_debounce_e2e ...)` |
| `docs/decisions/unisim/0009-physical-behavior-simulation-fault-injection.md` | ✏️ 修改 | §6 追加「Wave 1 host 验证」记录（状态仍 Proposed） |

### 2.2 接口影响分析

| 接口层 | 是否破坏性 | 影响范围 | 备注 |
|--------|-----------|----------|------|
| PAL 公开 API | ❌ 否 | 新增 `wink_sim_physical.*`（纯新增，非 PAL 契约） | 不动既有 PAL 签名 |
| DAL 层 | ❌ 否 | 零改动 | `dal_button` 复用现有去抖，行为对 DAL 透明 |
| host 注入 API | ❌ 否 | 新增 3 个测试控制函数 | 仅 `host_test_ctrl.h`，非 PAL 契约 |
| host PAL 行为 | ⚠️ 行为扩展（非破坏） | `pal_gpio_read` 对「注入了理想电平的 pin」返退化值；未注入 pin 行为不变 | 无注入时等同现状 |
| 构建系统 | ❌ 否 | `pal_host` OBJECT +1 源；esp32/baremetal/wasm 不变 | §4.3 零编译污染 |
| 文档 | ❌ 否 | ADR §6 + 本计划 | — |

### 2.3 架构红线

> 🚨 违反即拒绝合入：
> 1. **确定性守卫（§4.1）**：所有退化算法的时间基准必须由 caller 传入的 `pal_get_us` 虚拟时钟值驱动；**严禁** `rand()`/`Math.random()`/`clock()`/`time()`/墙钟。PRNG 必须种子驱动、可复现。
> 2. **零编译污染（§4.3）**：`wink_sim_physical.c` 仅进 `pal_host` OBJECT；esp32/baremetal/wasm 产物不含抖动/噪声/warmup 代码与静态数据。
> 3. **绝不 brick**：退化是「加噪」，算法不得 Panic/挂起；输入异常（NULL ctx、dt<0、tau<=0）静默降级为理想值。
> 4. **零动态分配**：无 malloc；ctx 与注入表均为静态/栈。
> 5. **无 libm 依赖**：RC 低通用离散一阶近似（`alpha=min(1,dt/tau)`），不用 `expf`，保 host/wasm/esp32 移植性。
> 6. **注入语义契约（防假绿，P1）**：`sim_set_gpio_ideal(pin, level)` 双语义——首次注册 pin 视为「上电态」（`ctx.stable_level = level`，无跃变、**不抖**）；更新已注册 pin 电平视为「用户操作跃变」（**不碰 ctx**，下次采样 `target≠stable` 触发抖动）。**端到端测试必须构造跃变序列**（先稳定释放态、再改按下态）才能观察到抖动；单次 `set` 后直接期望抖动 = 假绿。
> 7. **注入 pin 须避开 echo pin（P1）**：`pal_gpio_read` 顶部先查注入表；若注入 pin == `host_echo_pin()`（默认 `0xFFFF`，常规不冲突）会短路 echo 协作推进，令 ultrasonic blocking-read 测试静默失效。测试注入须用 ≠ echo pin 的引脚。

### 2.4 系统资源约束

| 维度 | 变化 | 风险 | 缓解 |
|------|------|------|------|
| ROM (host) | +算法库(<2KB) | 极小 | host 充裕 |
| RAM (host static) | +注入表(4 槽×~32B) + 全局 faults(~32B) | 极小 | 静态 |
| esp32/baremetal ROM/RAM | 0 | — | 不链接算法库 |
| 栈深度 | +1 层退化调用 | 极小 | 浅函数 |

---

## 3. 关键设计约束（读证所得）

1. **抖动注入点 = `pal_gpio_read`（host）**：`dal_button_poll`（`dal_button.c:27`）每 tick 调 `pal_gpio_read(dev->pin)` 采样。当前 `pal_hal_host.c:49-67` 的 `pal_gpio_read` 对**非 echo pin 一律返 false**——host 上无按键电平注入机制。故 Wave 1 必须新建 GPIO 理想电平注入，并在 `pal_gpio_read` 顶部对注入 pin 走抖动退化路径，echo pin 逻辑（协作推进虚拟时间）原样保留。
2. **dal_button 是 polling 模型，非 ISR**：ADR-0009 §3.1 用 ISR（`trigger_key_isr`），但 `dal_button` 是 tick 轮询 + 计数去抖（`DAL_BUTTON_DEBOUNCE_THRESHOLD=3`）。host 试点映射为「GPIO read 层注入抖动电平 → dal_button 现有去抖吸收」，而非 ISR 模型。这恰是 §3.1「不写去抖则多次误触发」的完美对照靶。
3. **确定性时间源已就位**：host `pal_get_us()`=`s_time_us`（`pal_osal_host.c:77`，单调递增）；`host_sim_advance_to(us)`（`:27`）受控推进；`pal_delay_ms/us`（`:74-75`）累加；`sim_reset_time()`（`:55`）每测试清零。退化算法读 `s_time_us` 即确定性虚拟时钟。
4. **复用资产**：`pal_host` OBJECT（`host/CMakeLists.txt:2-8`）已含 `pal/src/*.c` 先例（`pal_pwm_router.c`/`wink_dev_config.c`），算法库照此加入；`host_test_ctrl.h` 注入 API 范式（`sim_set_echo_pin/timing`）；`add_wink_test_sim`（`test/CMakeLists.txt:117`，`-DSIMULATION` + stub + DAL + `wasm_bridge.h`）供端到端。
5. **active_low 语义**：`dal_button`（`dal_button.c:4-6`）`button_raw_pressed = raw != active_low`。测试注入「按下」时，active_low=true → 注入理想 raw=false。
6. **抖动模型：强制交替（对 ADR §3.1 的修订，P2 升级为设计约束）**：ADR §3.1 骨架用 `(now/1000)%2` 生成抖动电平。演算发现该模型**强依赖采样周期**——系统默认 `WINK_RUNTIME_TICK_MS=10`（`wink_status.h:63`）下，`(now/1000)%2` 的商每 tick 增 10（偶），电平锁死、抖动**静默失效**；改质数 997 亦仅对特定 tick 有效（凡 `Δnow/P` 商增量为偶即混叠，例如 2 ms tick ≈ 2×997）。故 Wave 1 抖动改为**每次采样强制翻转电平**（ctx 内 1 个翻转位）：采样周期无关、100% 确定（可硬编码 golden）、且是最严苛抖动（每次采样必跳），去抖逻辑若能吸收它即可吸收真实抖动。此为对 ADR §3.1 的实质修订，Task 8 回写 ADR。RC 噪声 / 总线丢包仍用 PRNG（§4.1）。

---

## 4. 关键跨边界契约（确定性守卫落地）

> ADR-0009 §4.1「确定性、可复现」的落地依据。**host 单测 golden vector = 权威参考**，前端/wasm 将来对齐。

### PRNG：LCG（§3.3/§4.1）
- 算法：`*seed = (*seed * 1103515245u + 12345u) & 0x7fffffffu`；返回 `(float)*seed / 2147483647.0f` ∈ [0,1)（字面量统一 `f` 后缀，避免中间运算提升为 double，保 host/wasm/esp32 确定性一致）。
- 种子由 caller 持有（`uint32_t *seed`），同种子子序列 100% 可复现。
- golden（seed=1）：调用后 `seed == 1103527590`，返回值 ≈ 0.5138。

### 抖动状态机（§3.1，强制交替模型）
- bounce_us==0 → 直接稳定到 target（禁用抖动）。
- target≠stable 且 `now - bounce_start < bounce_us`（抖动窗内）→ **每次采样强制翻转** `ctx->bounce_flip`，返回 `flip ? target : !target`。采样周期无关、100% 确定（详见 §3 约束 6：为何弃用 `(now/P)%2`）。
- 防御性时间守卫：当 `now < bounce_start` 时，重置 `bounce_start = now`，防止仿真中时钟回拨/重置导致无限抖动（`bounce_flip` 不复位，保持跳变连续性）。
- 超过 bounce_us → stable=target，in_bounce=false，结束抖动。
- golden（bounce_us=30000，target=true，stable 初值=false，bounce_flip 初值=false）：step(now=1000)→flip=true→true；step(2000)→flip=false→false；step(3000)→true；step(4000)→false … 强制交替；step(now≥31000)→稳定 true。

### RC 低通（§3.3，离散一阶近似）
- `alpha = min(1.0, dt/tau)`；`current += (target-current)*alpha`；dt=now-last_us（秒）。
- noise_v>0 → 叠加 `(prng_next-0.5)*2*noise_v`。
- golden（current=0, target=1.0, last_us=0, now=1000us, tau=0.05s）：dt=0.001s, alpha=0.02, current=0.02。

### warmup/采样间隔（§3.2）
- `now - power_on < warmup_us` → `WINK_ERR_BUSY`；`now - last_sample < interval_us` → `WINK_ERR_TIMEOUT`（不更新 last_sample）；否则 OK（更新 last_sample=now）。

### 总线丢包（§4）
- drop_permil==0 → false；≥1000 → true；否则 `prng_next < drop_permil/1000`。

---

## 5. 任务拆分与进度

### Task 1：落 Layer ③ 计划文档 `[ 📋 草稿 ]`
- [x] 本文件即为交付物。

---

### Task 2：TDD 算法库骨架 + 故障配置 + 确定性 PRNG `[ ⏳ 待开始 ]`

**Files:**
- Create: `wink-micro-os/pal/include/wink_sim_physical.h`
- Create: `wink-micro-os/pal/src/wink_sim_physical.c`
- Create: `wink-micro-os/test/test_sim_physical.c`
- Modify: `wink-micro-os/test/CMakeLists.txt`

**Interfaces:**
- Produces: `wink_sim_faults_t`、`WINK_SIM_FAULTS_IDEAL`、`wink_phys_prng_next(uint32_t *seed)`（后续 Task 3-5 消费）。

- [ ] **Step 1: 写头文件 `wink_sim_physical.h`**

```c
/**
 * @file wink_sim_physical.h
 * @brief ADR-0009 物理特性退化算法库（target 无关，host 试点 Wave 1）。
 *
 * 确定性守卫（ADR-0009 §4.1）：所有时间基准由 caller 传入 pal_get_us() 虚拟时钟值；
 *   PRNG 种子驱动，严禁 rand()/Math.random()/clock()/time()/墙钟。
 * 零编译污染（§4.3）：本单元仅进 pal_host OBJECT；esp32/baremetal/wasm 不链接。
 * 无 libm：RC 低通用离散一阶近似，不用 expf。
 */
#ifndef WINK_SIM_PHYSICAL_H
#define WINK_SIM_PHYSICAL_H

#include <stdint.h>
#include <stdbool.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief 故障注入配置（§4.2；host 直接填，wasm 将来从 JS JSON 解析）。全 0 = 理想（无退化）。 */
typedef struct {
    uint32_t bounce_us;          /* 按键抖动时长（§3.1），0=禁用 */
    uint32_t warmup_us;          /* 传感器上电预热（§3.2） */
    uint32_t sample_interval_us; /* 最小采样间隔（§3.2） */
    float    adc_noise_v;        /* ADC 噪声幅度 ±V（§3.3），0=禁用 */
    float    rc_tau_s;           /* RC 低通时间常数（§3.3），<=0=禁用 */
    uint16_t i2c_drop_permil;    /* 总线丢包率千分比（§4），0=禁用 */
    uint32_t prng_seed;          /* 确定性 PRNG 种子（§4.1） */
} wink_sim_faults_t;

extern const wink_sim_faults_t WINK_SIM_FAULTS_IDEAL;

/** @brief 确定性 PRNG（LCG）。推进 *seed 并返回 [0,1)。caller 持有 seed。 */
float wink_phys_prng_next(uint32_t *seed);

/* 其余 4 接口在 Task 3-5 追加 */
wink_status_t wink_phys_warmup_check(uint64_t now_us, uint64_t power_on_us,
                                     uint32_t warmup_us, uint32_t sample_interval_us,
                                     uint64_t *last_sample_us);

#ifdef __cplusplus
}
#endif
#endif /* WINK_SIM_PHYSICAL_H */
```

- [ ] **Step 2: 写失败测试 `test_sim_physical.c`（PRNG golden）**

```c
#include "unity.h"
#include "wink_sim_physical.h"

void setUp(void) {}
void tearDown(void) {}

void test_prng_is_deterministic_and_matches_golden(void) {
    uint32_t s1 = 1, s2 = 1;
    /* golden: seed=1 → 1103527590，返回 ≈0.5138 */
    float r1 = wink_phys_prng_next(&s1);
    TEST_ASSERT_EQUAL_UINT32(1103527590u, s1);
    TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.5138f, r1);
    /* 可复现：同种子同序列 */
    float r2 = wink_phys_prng_next(&s2);
    TEST_ASSERT_EQUAL_UINT32(s1, s2);
    TEST_ASSERT_EQUAL_FLOAT(r1, r2);
}

void test_prng_in_unit_range(void) {
    uint32_t s = 42;
    for (int i = 0; i < 1000; i++) {
        float r = wink_phys_prng_next(&s);
        TEST_ASSERT_TRUE(r >= 0.0f && r < 1.0f);
    }
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_prng_is_deterministic_and_matches_golden);
    RUN_TEST(test_prng_in_unit_range);
    return UNITY_END();
}
```

- [ ] **Step 3: 写最小实现 `wink_sim_physical.c`（仅 PRNG + IDEAL）**

```c
#include "wink_sim_physical.h"

const wink_sim_faults_t WINK_SIM_FAULTS_IDEAL = {0};  /* 全 0 = 理想，无退化 */

float wink_phys_prng_next(uint32_t *seed) {
    if (seed == NULL) { return 0.0f; }
    *seed = (*seed * 1103515245u + 12345u) & 0x7fffffffu;
    return (float)*seed / 2147483647.0f; /* 字面量统一 f 后缀，避免中间运算提升为 double，保 host/wasm/esp32 确定性一致 */
}

/* warmup_check 占位实现在 Task 5；此处先加 stub 让 Task 2 编译通过 */
wink_status_t wink_phys_warmup_check(uint64_t now_us, uint64_t power_on_us,
                                     uint32_t warmup_us, uint32_t sample_interval_us,
                                     uint64_t *last_sample_us) {
    (void)now_us; (void)power_on_us; (void)warmup_us;
    (void)sample_interval_us; (void)last_sample_us;
    return WINK_OK;  /* Task 5 替换 */
}
```

> 注：`wink_phys_warmup_check` 在头里声明了（Task 5 才正式实现），先给 stub 避免 Task 2 链接失败。Task 5 用真实实现替换。

- [ ] **Step 4: 接 CMake，跑测试确认失败→通过**

`test/CMakeLists.txt` 在 `add_wink_host_test(test_pal_storage ...)` 后追加：
```cmake
# ADR-0009 Wave1 物理退化算法库单测（wink_sim_physical.c 经 pal_host OBJECT 链接）
add_wink_host_test(test_sim_physical test_sim_physical.c)
```
但 `wink_sim_physical.c` 尚未进 `pal_host` OBJECT（Task 8 才加）。Task 2 临时直接链源：
```cmake
add_wink_host_test(test_sim_physical test_sim_physical.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../pal/src/wink_sim_physical.c)
```
Run: `cmake -B build-test -DTARGET_PLATFORM=host -G Ninja; cmake --build build-test; ctest --test-dir build-test -R test_sim_physical --output-on-failure`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**
```bash
git add wink-micro-os/pal/include/wink_sim_physical.h wink-micro-os/pal/src/wink_sim_physical.c wink-micro-os/test/test_sim_physical.c wink-micro-os/test/CMakeLists.txt
git commit -m "feat(sim): ADR-0009 Wave1 physical-decay algorithm lib skeleton + deterministic PRNG"
```

---

### Task 3：TDD 按键抖动状态机 `wink_phys_debounce_step`（§3.1） `[ ⏳ 待开始 ]`

**Files:**
- Modify: `wink-micro-os/pal/include/wink_sim_physical.h`（+ctx 类型 + 函数声明）
- Modify: `wink-micro-os/pal/src/wink_sim_physical.c`（+实现）
- Modify: `wink-micro-os/test/test_sim_physical.c`（+用例）

**Interfaces:**
- Produces: `wink_phys_debounce_ctx_t`、`wink_phys_debounce_step(ctx, target, now_us, bounce_us)`（Task 6 的 `pal_gpio_read` 消费）。
- Consumes: 无（纯算法）。

- [ ] **Step 1: 头文件追加（在 `wink_phys_prng_next` 声明后）**

```c
/** @brief 抖动状态机上下文（caller 每 pin 持有一个）。
 *
 * 语义契约（与 host 注入层 sim_set_gpio_ideal 双语义对齐，§2.3 红线 6）：
 *   - 上电态：stable_level = 初始理想电平（无跃变、不抖）。
 *   - 跃变：caller 改变 target_level 使之 ≠ stable_level → 进入抖动窗。
 * 抖动窗内每次采样强制翻转 bounce_flip（采样周期无关、100% 确定，§3 约束 6）。
 */
typedef struct {
    bool     stable_level;      /* 上次已稳定的电平 */
    bool     in_bounce;         /* 是否正处于抖动期 */
    uint64_t bounce_start_us;   /* 当前抖动期起点 */
    bool     bounce_flip;       /* 抖动期电平翻转位（每次采样取反，强制交替） */
} wink_phys_debounce_ctx_t;

/** @brief 按键抖动状态机（§3.1，强制交替模型）。返回当前物理（抖动后）电平。 */
bool wink_phys_debounce_step(wink_phys_debounce_ctx_t *ctx,
                             bool target_level, uint64_t now_us, uint32_t bounce_us);
```

- [ ] **Step 2: 写失败测试（抖动 golden）**

追加到 `test_sim_physical.c`（`RUN_TEST` 同步追加）：
```c
void test_debounce_forced_alternation_within_window(void) {
    /* target=true, stable=false → 抖动。强制交替（bounce_flip 初值 false） */
    wink_phys_debounce_ctx_t ctx = { false, false, 0, false };
    uint32_t bounce = 30000;
    TEST_ASSERT_TRUE (wink_phys_debounce_step(&ctx, true, 1000, bounce));  /* flip false→true → target=true */
    TEST_ASSERT_FALSE(wink_phys_debounce_step(&ctx, true, 2000, bounce));  /* flip true→false → !target=false */
    TEST_ASSERT_TRUE (wink_phys_debounce_step(&ctx, true, 3000, bounce));  /* flip→true */
    TEST_ASSERT_FALSE(wink_phys_debounce_step(&ctx, true, 4000, bounce));  /* flip→false */
    /* 仍在窗内（bounce_start=1000，窗 [1000,31000)） */
    TEST_ASSERT_TRUE(ctx.in_bounce);
}

void test_debounce_settles_after_window(void) {
    wink_phys_debounce_ctx_t ctx = { false, false, 0, false };
    uint32_t bounce = 30000;
    wink_phys_debounce_step(&ctx, true, 1000, bounce);   /* 进入抖动 */
    wink_phys_debounce_step(&ctx, true, 5000, bounce);
    /* now-bounce_start = 30000 >= bounce_us → 出窗稳定 */
    TEST_ASSERT_TRUE(wink_phys_debounce_step(&ctx, true, 31000, bounce));
    TEST_ASSERT_TRUE(ctx.stable_level);
    TEST_ASSERT_FALSE(ctx.in_bounce);
    /* 之后 target==stable → 直接返稳定值 */
    TEST_ASSERT_TRUE(wink_phys_debounce_step(&ctx, true, 50000, bounce));
}

void test_debounce_disabled_when_bounce_zero(void) {
    wink_phys_debounce_ctx_t ctx = { false, false, 0, false };
    TEST_ASSERT_TRUE(wink_phys_debounce_step(&ctx, true, 0, 0));  /* 禁用 → 直接 target */
    TEST_ASSERT_TRUE(ctx.stable_level);
}

void test_debounce_null_ctx_returns_target(void) {
    TEST_ASSERT_TRUE(wink_phys_debounce_step(NULL, true, 0, 30000));  /* 降级 */
}

void test_debounce_time_regression_resets_gracefully(void) {
    wink_phys_debounce_ctx_t ctx = { false, false, 0, false };
    uint32_t bounce = 30000;
    /* 正常启动抖动 */
    TEST_ASSERT_TRUE(wink_phys_debounce_step(&ctx, true, 5000, bounce));   /* flip→true → target */
    TEST_ASSERT_TRUE(ctx.in_bounce);
    TEST_ASSERT_EQUAL_UINT64(5000, ctx.bounce_start_us);
    /* 时钟回拨：bounce_start 重置为 now，抖动窗顺延（不无限抖）；flip 继续翻转 */
    TEST_ASSERT_FALSE(wink_phys_debounce_step(&ctx, true, 0, bounce));     /* flip→false → !target */
    TEST_ASSERT_EQUAL_UINT64(0, ctx.bounce_start_us);
    TEST_ASSERT_TRUE(ctx.in_bounce);
}
```

- [ ] **Step 3: 写实现（追加到 `wink_sim_physical.c`）**

```c
bool wink_phys_debounce_step(wink_phys_debounce_ctx_t *ctx,
                             bool target_level, uint64_t now_us, uint32_t bounce_us) {
    if (ctx == NULL) { return target_level; }              /* 降级 */
    if (bounce_us == 0u) {
        ctx->stable_level = target_level;
        ctx->in_bounce = false;
        return target_level;
    }
    if (target_level != ctx->stable_level) {
        if (!ctx->in_bounce) {
            ctx->bounce_start_us = now_us;
            ctx->in_bounce = true;
        }
        /* 防御时钟回拨/重置 */
        if (now_us < ctx->bounce_start_us) {
            ctx->bounce_start_us = now_us;
        }
        if (now_us - ctx->bounce_start_us < bounce_us) {
            ctx->bounce_flip = !ctx->bounce_flip;          /* 强制交替：每次采样翻转（采样周期无关） */
            return ctx->bounce_flip ? target_level : !target_level;
        }
        ctx->stable_level = target_level;
        ctx->in_bounce = false;
    }
    return ctx->stable_level;
}
```

- [ ] **Step 4: 跑测试通过**

Run: `ctest --test-dir build-test -R test_sim_physical --output-on-failure`
Expected: PASS（含 5 个抖动用例：强制交替 / 出窗稳定 / bounce_us=0 禁用 / NULL ctx 降级 / 时钟回拨）。

- [ ] **Step 5: 提交**
```bash
git add wink-micro-os/pal/include/wink_sim_physical.h wink-micro-os/pal/src/wink_sim_physical.c wink-micro-os/test/test_sim_physical.c
git commit -m "feat(sim): ADR-0009 Wave1 contact-bounce state machine (§3.1)"
```

---

### Task 4：TDD RC 低通 + 噪声 `wink_phys_rc_lowpass`（§3.3） `[ ⏳ 待开始 ]`

**Files:** Modify `wink_sim_physical.h` / `.c` / `test_sim_physical.c`

**Interfaces:**
- Produces: `wink_phys_rc_ctx_t`、`wink_phys_rc_lowpass(ctx, target, now_us, tau_s, noise_v, prng_seed)`。
- Consumes: `wink_phys_prng_next`（Task 2）。

- [ ] **Step 1: 头文件追加**

```c
/** @brief RC 低通上下文（caller 每通道持有一个）。 */
typedef struct {
    float    current;   /* 当前滤波输出 */
    uint64_t last_us;   /* 上次更新时间 */
    bool     is_initialized; /* 是否已初始化 */
} wink_phys_rc_ctx_t;

/** @brief RC 一阶低通 + 噪声（§3.3，离散近似，无 expf）。返回当前含噪输出。 */
float wink_phys_rc_lowpass(wink_phys_rc_ctx_t *ctx, float target, uint64_t now_us,
                           float tau_s, float noise_v, uint32_t *prng_seed);
```

- [ ] **Step 2: 写失败测试**

```c
void test_rc_lowpass_first_step_golden(void) {
    wink_phys_rc_ctx_t rc = { 0.0f, 0, true };
    /* current=0, target=1.0, last=0, now=1000us, tau=0.05s → dt=0.001s, alpha=0.02 → 0.02 */
    float v = wink_phys_rc_lowpass(&rc, 1.0f, 1000, 0.05f, 0.0f, NULL);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.02f, v);
}

void test_rc_lowpass_converges_to_target(void) {
    wink_phys_rc_ctx_t rc = { 0.0f, 0, true };
    uint64_t now = 0;
    for (int i = 0; i < 500; i++) { now += 10000; wink_phys_rc_lowpass(&rc, 1.0f, now, 0.05f, 0.0f, NULL); }
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, rc.current);  /* 收敛到 target */
}

void test_rc_noise_bounded(void) {
    wink_phys_rc_ctx_t rc = { 0.5f, 0, true };
    uint32_t seed = 7;
    for (int i = 0; i < 100; i++) {
        float v = wink_phys_rc_lowpass(&rc, 0.5f, (uint64_t)i * 1000, 0.05f, 0.02f, &seed);
        TEST_ASSERT_TRUE(v >= 0.5f - 0.05f && v <= 0.5f + 0.05f);  /* ±0.02 噪声余量 */
    }
}

void test_rc_null_ctx_returns_target(void) {
    TEST_ASSERT_EQUAL_FLOAT(0.7f, wink_phys_rc_lowpass(NULL, 0.7f, 0, 0.05f, 0.0f, NULL));
}

void test_rc_lowpass_uninitialized_auto_sets_target(void) {
    wink_phys_rc_ctx_t rc = { 0 }; // is_initialized = false
    float v = wink_phys_rc_lowpass(&rc, 1.5f, 1000, 0.05f, 0.0f, NULL);
    TEST_ASSERT_EQUAL_FLOAT(1.5f, v); // 首次运行直接设置为 target
    TEST_ASSERT_TRUE(rc.is_initialized);
    TEST_ASSERT_EQUAL_UINT64(1000, rc.last_us);
}

void test_rc_lowpass_time_regression_resets_gracefully(void) {
    wink_phys_rc_ctx_t rc = { 0.5f, 2000, true };
    // 时钟回拨
    float v = wink_phys_rc_lowpass(&rc, 1.0f, 0, 0.05f, 0.0f, NULL);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, v); // 回拨时直接复位为 target
    TEST_ASSERT_EQUAL_UINT64(0, rc.last_us);
}
```

- [ ] **Step 3: 写实现**

```c
float wink_phys_rc_lowpass(wink_phys_rc_ctx_t *ctx, float target, uint64_t now_us,
                           float tau_s, float noise_v, uint32_t *prng_seed) {
    if (ctx == NULL) { return target; }                    /* 降级 */
    if (!ctx->is_initialized || now_us < ctx->last_us) {
        ctx->current = target;
        ctx->last_us = now_us;
        ctx->is_initialized = true;
        return target;
    }
    float dt = (float)(now_us - ctx->last_us) / 1000000.0f; /* 字面量统一 f 后缀，避免中间 double 提升，保确定性 */
    ctx->last_us = now_us;
    if (tau_s > 0.0f && dt > 0.0f) {
        float alpha = dt / tau_s;
        if (alpha > 1.0f) { alpha = 1.0f; }
        ctx->current += (target - ctx->current) * alpha;
    }
    if (noise_v > 0.0f && prng_seed != NULL) {
        float n = (wink_phys_prng_next(prng_seed) - 0.5f) * 2.0f * noise_v;
        return ctx->current + n;
    }
    return ctx->current;
}
```

- [ ] **Step 4: 跑测试通过** → Expected: PASS。

- [ ] **Step 5: 提交**
```bash
git commit -am "feat(sim): ADR-0009 Wave1 RC lowpass + noise (§3.3, no libm)"
```

---

### Task 5：TDD warmup/采样间隔 + 总线丢包（§3.2/§4） `[ ⏳ 待开始 ]`

**Files:** Modify `wink_sim_physical.h`（+bus_drop 声明）/ `.c`（替换 warmup stub + 加 bus_drop）/ `test_sim_physical.c`

**Interfaces:**
- Produces: `wink_phys_warmup_check`（真实实现替换 stub）、`wink_phys_bus_drop(drop_permil, prng_seed)`。

- [ ] **Step 1: 头文件追加 bus_drop**

```c
/** @brief 总线丢包判定（§4）。drop_permil 千分比；PRNG 驱动确定性。true=丢弃。 */
bool wink_phys_bus_drop(uint16_t drop_permil, uint32_t *prng_seed);
```

- [ ] **Step 2: 写失败测试**

```c
void test_warmup_busy_then_timeout_then_ok(void) {
    uint64_t last = 0;
    TEST_ASSERT_EQUAL(WINK_ERR_BUSY, wink_phys_warmup_check(500000, 0, 1000000, 2000000, &last));  /* 预热内 */
    TEST_ASSERT_EQUAL(WINK_ERR_TIMEOUT, wink_phys_warmup_check(1500000, 0, 1000000, 2000000, &last)); /* 间隔不足，last 不变 */
    TEST_ASSERT_EQUAL_UINT64(0, last);
    TEST_ASSERT_EQUAL(WINK_OK, wink_phys_warmup_check(2500000, 0, 1000000, 2000000, &last));  /* OK，last 更新 */
    TEST_ASSERT_EQUAL_UINT64(2500000, last);
}

void test_warmup_time_regression_resets_gracefully(void) {
    uint64_t last = 50000;
    // 时钟回拨，强制复位并允许读取
    TEST_ASSERT_EQUAL(WINK_OK, wink_phys_warmup_check(1000, 0, 0, 2000, &last));
    TEST_ASSERT_EQUAL_UINT64(1000, last);
}

void test_bus_drop_boundary_and_deterministic(void) {
    uint32_t s0 = 0, s1000 = 0, s500a = 1, s500b = 1;
    TEST_ASSERT_FALSE(wink_phys_bus_drop(0, &s0));      /* 0‰ 永不丢 */
    TEST_ASSERT_TRUE(wink_phys_bus_drop(1000, &s1000)); /* 1000‰ 总丢 */
    /* 500‰ 确定性可复现 */
    bool a = wink_phys_bus_drop(500, &s500a);
    bool b = wink_phys_bus_drop(500, &s500b);
    TEST_ASSERT_EQUAL(a, b);
}

- [ ] **Step 3: 替换 warmup stub + 加 bus_drop（在 `wink_sim_physical.c`）**

```c
wink_status_t wink_phys_warmup_check(uint64_t now_us, uint64_t power_on_us,
                                     uint32_t warmup_us, uint32_t sample_interval_us,
                                     uint64_t *last_sample_us) {
    if (now_us < power_on_us || now_us - power_on_us < warmup_us) { return WINK_ERR_BUSY; }
    if (last_sample_us != NULL && sample_interval_us > 0u) {
        if (now_us < *last_sample_us) {
            *last_sample_us = now_us; /* 时钟回拨：强制复位 */
            return WINK_OK;
        }
        if (now_us - *last_sample_us < sample_interval_us) { return WINK_ERR_TIMEOUT; }
        *last_sample_us = now_us;
    }
    return WINK_OK;
}

bool wink_phys_bus_drop(uint16_t drop_permil, uint32_t *prng_seed) {
    if (drop_permil == 0u || prng_seed == NULL) { return false; }
    if (drop_permil >= 1000u) { return true; }
    return wink_phys_prng_next(prng_seed) < ((float)drop_permil / 1000.0f);
}
```

- [ ] **Step 4: 跑测试通过** → Expected: PASS（算法库 5 算法全绿）。

- [ ] **Step 5: 提交**
```bash
git commit -am "feat(sim): ADR-0009 Wave1 warmup/sample-interval + bus-drop (§3.2/§4)"
```

---

### Task 6：host GPIO 理想电平注入 + `pal_gpio_read` 抖动退化 `[ ⏳ 待开始 ]`

**Files:**
- Modify: `wink-micro-os/test/stubs/host_test_ctrl.h`（+3 注入 API 声明，+include）
- Modify: `wink-micro-os/targets/host/pal_osal_host.c`（+注入表 + per-pin ctx + 全局 faults + 访问器 + reset 清表）
- Modify: `wink-micro-os/targets/host/pal_hal_host.c`（`pal_gpio_read` 顶部加退化路径）

**Interfaces:**
- Consumes: `wink_phys_debounce_step`（Task 3）、`wink_sim_faults_t`（Task 2）。
- Produces: `sim_set_gpio_ideal`/`sim_clear_gpio_ideal`/`sim_set_faults`（测试注入）、`host_gpio_read_debounced`（HAL 内部访问器）。

- [ ] **Step 1: `host_test_ctrl.h` 追加注入 API**

在 `#include "pal_osal.h"` 后加 `#include "wink_sim_physical.h"`，在 i2c 捕获声明后追加：
```c
/* ADR-0009 Wave1：host GPIO 理想电平注入 + 故障配置（仅测试用）。
 * sim_set_gpio_ideal 双语义（§2.3 红线 6）：首次注册=上电态(不抖)；更新电平=跃变(触发抖动)。
 * 注入 pin 须 ≠ echo pin（§2.3 红线 7）。 */
#define SIM_GPIO_IDEAL_SLOTS 4
void sim_set_gpio_ideal(uint16_t pin, bool level);   /* 注册(上电态)/更新(跃变) pin 理想电平 */
void sim_clear_gpio_ideal(void);                      /* 清空所有注入（sim_reset_time 也会调） */
void sim_set_faults(const wink_sim_faults_t *faults); /* 设全局故障配置（退化强度） */
```

- [ ] **Step 2: `pal_osal_host.c` 加注入状态 + 访问器 + reset 清表**

在文件 static 区（`s_i2c_transfer_count` 后）追加：
```c
/* ADR-0009 Wave1：GPIO 理想电平注入 + per-pin 抖动 ctx + 全局 faults。
 * 语义契约（§2.3 红线 6/7）：
 *   - sim_set_gpio_ideal 双语义：首次注册 pin = 上电态（stable=level，不抖）；
 *     更新已注册 pin 电平 = 用户操作跃变（仅改 ideal，不碰 ctx → 下次采样 target≠stable 触发抖动）。
 *   - 注入 pin 须 ≠ host_echo_pin()（默认 0xFFFF），否则短路 echo 协作推进（§2.3 红线 7）。 */
static struct {
    bool     set;
    uint16_t pin;
    bool     ideal;
    wink_phys_debounce_ctx_t ctx;
} s_gpio_ideal[SIM_GPIO_IDEAL_SLOTS];
static wink_sim_faults_t s_faults = {0};

void sim_set_gpio_ideal(uint16_t pin, bool level) {
    /* 跃变分支：pin 已注册 → 仅更新理想电平，不碰 ctx（保留旧 stable → 下次采样 target≠stable 触发抖动） */
    for (int i = 0; i < SIM_GPIO_IDEAL_SLOTS; i++) {
        if (s_gpio_ideal[i].set && s_gpio_ideal[i].pin == pin) {
            s_gpio_ideal[i].ideal = level;
            return;
        }
    }
    /* 注册分支：首次占用空槽 = 上电态（stable=level，无跃变不抖；flip=false） */
    for (int i = 0; i < SIM_GPIO_IDEAL_SLOTS; i++) {
        if (!s_gpio_ideal[i].set) {
            s_gpio_ideal[i].set = true;
            s_gpio_ideal[i].pin = pin;
            s_gpio_ideal[i].ideal = level;
            s_gpio_ideal[i].ctx.stable_level    = level;   /* 上电态 */
            s_gpio_ideal[i].ctx.in_bounce       = false;
            s_gpio_ideal[i].ctx.bounce_start_us = 0;
            s_gpio_ideal[i].ctx.bounce_flip     = false;
            return;
        }
    }
}
void sim_clear_gpio_ideal(void) {
    for (int i = 0; i < SIM_GPIO_IDEAL_SLOTS; i++) { s_gpio_ideal[i].set = false; }
}
void sim_set_faults(const wink_sim_faults_t *faults) {
    s_faults = (faults != NULL) ? *faults : WINK_SIM_FAULTS_IDEAL;
}
/* HAL 侧访问器：命中注入 pin → 走抖动退化；返回 true 表示命中 */
bool host_gpio_read_debounced(uint16_t pin, bool *out_level) {
    for (int i = 0; i < SIM_GPIO_IDEAL_SLOTS; i++) {
        if (s_gpio_ideal[i].set && s_gpio_ideal[i].pin == pin) {
            *out_level = wink_phys_debounce_step(&s_gpio_ideal[i].ctx, s_gpio_ideal[i].ideal,
                                                 s_time_us, s_faults.bounce_us);
            return true;
        }
    }
    return false;
}
```
在 `sim_reset_time()`（`:55`）内追加 `sim_clear_gpio_ideal();`（清注入表，但不清 `s_faults`——配置跨 reset 保留；测试显式 `sim_set_faults`）。需在文件顶部 `#include "wink_sim_physical.h"`。

- [ ] **Step 3: `pal_hal_host.c` 的 `pal_gpio_read` 顶部加退化路径**

在 `bool pal_gpio_read(uint16_t pin) {`（`:49`）函数体最前面插入：
```c
    /* ADR-0009 Wave1：注入了理想电平的 pin → 走抖动退化（§3.1）；否则走原 echo 协作推进逻辑 */
    bool debounced;
    extern bool host_gpio_read_debounced(uint16_t pin, bool *out_level);
    if (host_gpio_read_debounced(pin, &debounced)) { return debounced; }
```
（其后保留原 `if (pin != host_echo_pin()) return false; …` echo 逻辑不变。）

- [ ] **Step 4: 写失败测试（host GPIO 注入 + 退化）——加到 `test_host_pal.c` 或新建**

为聚焦，本步用 `test_sim_physical.c` 末尾加一个链 pal_host 的用例（`add_wink_host_test` 已链 `HOST_PAL_OBJECT`）：
```c
#include "host_test_ctrl.h"
#include "pal_hal.h"

void test_host_gpio_ideal_transition_triggers_bounce(void) {
    sim_reset_time();
    wink_sim_faults_t f = WINK_SIM_FAULTS_IDEAL; f.bounce_us = 30000; f.prng_seed = 1;
    sim_set_faults(&f);
    extern void host_sim_advance_to(uint64_t us);

    /* ① 上电态：pin7=高(释放) → 注册即上电 → stable=high，无跃变、不抖 */
    sim_set_gpio_ideal(7, true);
    TEST_ASSERT_TRUE(pal_gpio_read(7));       /* target==stable → 直接返 true */

    /* ② 跃变：改为低(按下) → ideal=false，ctx.stable 仍=true → target≠stable → 进入抖动窗（强制交替） */
    host_sim_advance_to(1000);
    sim_set_gpio_ideal(7, false);
    TEST_ASSERT_FALSE(pal_gpio_read(7));      /* flip false→true → target=false */
    host_sim_advance_to(2000);
    TEST_ASSERT_TRUE (pal_gpio_read(7));      /* flip true→false → !target=true */
    host_sim_advance_to(3000);
    TEST_ASSERT_FALSE(pal_gpio_read(7));      /* flip→true → target=false */

    /* ③ 出窗（31000-1000=30000 >= bounce_us）→ 稳定到 target=false */
    host_sim_advance_to(31000);
    TEST_ASSERT_FALSE(pal_gpio_read(7));

    /* ④ 未注入、非 echo pin 仍返 false（现状不变） */
    TEST_ASSERT_FALSE(pal_gpio_read(99));
    sim_clear_gpio_ideal();
}
```
同步在 `main` 加 `RUN_TEST(test_host_gpio_ideal_transition_triggers_bounce)`。`test_sim_physical` 当前链 `wink_sim_physical.c` 源，需改链 `HOST_PAL_OBJECT` 以拿到 `pal_gpio_read`/`host_gpio_read_debounced`——见 Task 8 CMake 调整；本步先把 `add_wink_host_test(test_sim_physical test_sim_physical.c)` 改为不显式链源（依赖 Task 8 把 `wink_sim_physical.c` 进 OBJECT）。**临时**：本步测试先注释，Task 8 接线后启用。

> 实施注：Task 6 的 Step 4 测试依赖 Task 8 的 CMake 接线（算法库进 `pal_host` OBJECT）。执行顺序上 Task 6 先改代码（Step 1-3），Task 8 接线后统一启用端到端 + 注入测试。若逐 Task 验证，可在 Task 6 临时保留 `add_wink_host_test(test_sim_physical test_sim_physical.c ../../pal/src/wink_sim_physical.c)` 并把注入用例放一个独立链 pal_host 的测试。

- [ ] **Step 5: 提交**
```bash
git add wink-micro-os/test/stubs/host_test_ctrl.h wink-micro-os/targets/host/pal_osal_host.c wink-micro-os/targets/host/pal_hal_host.c wink-micro-os/test/test_sim_physical.c
git commit -m "feat(host): ADR-0009 Wave1 GPIO ideal injection + pal_gpio_read bounce decay"
```

---

### Task 7：按键抖动端到端对照（`dal_button` × 抖动） `[ ⏳ 待开始 ]`

**Files:**
- Create: `wink-micro-os/test/test_button_debounce_e2e.c`
- Modify: `wink-micro-os/test/CMakeLists.txt`（`add_wink_test_sim`）

**Interfaces:**
- Consumes: `sim_set_gpio_ideal`/`sim_set_faults`（Task 6）、`dal_button`（既有）、`pal_delay_ms`（推进虚拟时钟）。

- [ ] **Step 1: 写端到端测试 `test_button_debounce_e2e.c`**

```c
#include "unity.h"
#include "dal_button.h"
#include "pal_osal.h"          /* pal_delay_ms 推进虚拟时钟 */
#include "host_test_ctrl.h"
#include "wink_sim_physical.h"

void setUp(void) { sim_reset_time(); }
void tearDown(void) {}

/* 场景参数（强制交替模型，采样周期无关）：
 *   TICK_MS=10（对齐系统 WINK_RUNTIME_TICK_MS=10，wink_status.h:63），bounce_us=30000（30ms 抖动窗，窗内 3 个采样点）。
 *   active_low 按键：释放 raw=true，按下 raw=false。dal_button 计数去抖阈值=3（dal_button.h:13）。 */
#define TICK_MS 10
#define BOUNCE_US 30000u

static void run_ticks(dal_button_t *btn, int n) {
    for (int i = 0; i < n; i++) { pal_delay_ms(TICK_MS); dal_button_poll(btn); }
}

/* 负对照 helper：无去抖的裸采样（模拟「开发者没写去抖」），与 dal_button.c:6 button_raw_pressed 同语义。 */
static bool raw_pressed(uint16_t pin, bool active_low) {
    return pal_gpio_read(pin) != active_low;
}

/* 【主线·正】电平跃变 → dal_button 计数去抖吸收抖动 → 稳定 pressed。
 * golden（强制交替；跃变 set 后首次 poll now=30000，bounce 窗 [30000,60000)）：
 *   窗内每 tick raw 强制翻转 → pressed 在 true/false 间跳 → dal_button counter 反复清零；
 *   出窗（now=60000 起）raw 稳定=false→pressed=true 连续，counter 累积到 3（now=80000）→ stable_pressed=true。
 *   故 run_ticks(6) = 3 窗内采样 + 3 出窗去抖。 */
void test_dal_button_absorbs_bounce_and_settles(void) {
    wink_sim_faults_t f = WINK_SIM_FAULTS_IDEAL;
    f.bounce_us = BOUNCE_US; f.prng_seed = 1;
    sim_set_faults(&f);

    dal_button_t btn;
    TEST_ASSERT_EQUAL(WINK_OK, dal_button_init(&btn, 7, true));   /* active_low */
    sim_set_gpio_ideal(7, true);                                   /* ① 上电态=释放(raw=true)，不抖 */
    run_ticks(&btn, 2);                                            /* now=20000，稳定到「未按下」 */
    bool released = true;
    dal_button_is_pressed(&btn, &released);
    TEST_ASSERT_FALSE(released);

    sim_set_gpio_ideal(7, false);                                  /* ② 跃变=按下(raw=false) → 抖动窗 */
    run_ticks(&btn, 6);                                            /* now=30000..80000：3 窗内 + 3 出窗去抖 */

    bool pressed = false;
    TEST_ASSERT_EQUAL(WINK_OK, dal_button_is_pressed(&btn, &pressed));
    TEST_ASSERT_TRUE(pressed);                                     /* 去抖吸收抖动，稳定按下 */
    sim_clear_gpio_ideal();
}

/* 【主线·负对照】同一抖动电平序列，无去抖裸采样 → 抖动窗内必跳变（误触发）。
 * 证明 ADR-0009 §3.1 核心论点「不写去抖则多次误触发」。强制交替保证窗内既采到 pressed 又 released。 */
void test_raw_read_without_debounce_bounces(void) {
    wink_sim_faults_t f = WINK_SIM_FAULTS_IDEAL;
    f.bounce_us = BOUNCE_US; f.prng_seed = 1;
    sim_set_faults(&f);

    sim_set_gpio_ideal(9, true);                                   /* 上电=释放（pin9，避耦合） */
    pal_delay_ms(TICK_MS);                                         /* now=10000 */
    sim_set_gpio_ideal(9, false);                                  /* 跃变=按下 → 窗 [10000,40000) */

    bool saw_pressed = false, saw_released = false;
    for (int i = 0; i < 3; i++) {                                  /* 窗内 3 次裸采样（强制交替必跳变） */
        if (raw_pressed(9, true)) { saw_pressed = true; }
        else { saw_released = true; }
        pal_delay_ms(TICK_MS);                                     /* +10ms，仍在窗内（10000→20000→30000） */
    }
    TEST_ASSERT_TRUE(saw_pressed && saw_released);                 /* 无去抖 → 既「按下」又「释放」=误触发 */
    sim_clear_gpio_ideal();
}

/* 【基线】无退化（bounce_us=0）→ 快速稳定，无抖动 */
void test_no_bounce_config_settles_fast(void) {
    sim_set_faults(&WINK_SIM_FAULTS_IDEAL);                        /* bounce_us=0 */
    dal_button_t btn;
    TEST_ASSERT_EQUAL(WINK_OK, dal_button_init(&btn, 8, false));   /* active_high */
    sim_set_gpio_ideal(8, true);                                   /* 按下 raw=true */
    run_ticks(&btn, 5);
    bool pressed = false;
    dal_button_is_pressed(&btn, &pressed);
    TEST_ASSERT_TRUE(pressed);
    sim_clear_gpio_ideal();
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_dal_button_absorbs_bounce_and_settles);
    RUN_TEST(test_raw_read_without_debounce_bounces);
    RUN_TEST(test_no_bounce_config_settles_fast);
    return UNITY_END();
}
```

- [ ] **Step 2: 接 CMake（`add_wink_test_sim`）**

`test/CMakeLists.txt` 在 `add_wink_test_sim(test_dal_ultrasonic_sim ...)` 后追加：
```cmake
# ADR-0009 Wave1 按键抖动端到端（dal_button × 物理退化；链 pal_host 含算法库 + 注入）
add_wink_test_sim(test_button_debounce_e2e test_button_debounce_e2e.c)
```

- [ ] **Step 3: 跑测试确认失败→通过**

Run: `ctest --test-dir build-test -R test_button_debounce_e2e --output-on-failure`
Expected: PASS（3 用例：去抖吸收抖动 / 裸采样误触发[负对照] / 理想基线）。若 `test_dal_button_absorbs_bounce...` 失败，核验：跃变是否正确构造（先 set 释放态稳定、再 set 按下态）；抖动窗内 dal_button 读到强制交替电平、counter 反复清零；出窗后连续累积到阈值 3。若负对照失败（窗内未观察到跳变），核验 bounce_us 与 TICK_MS 的窗内采样点数是否 ≥2。

- [ ] **Step 4: 提交**
```bash
git add wink-micro-os/test/test_button_debounce_e2e.c wink-micro-os/test/CMakeLists.txt
git commit -m "test(sim): ADR-0009 Wave1 button-bounce end-to-end vs dal_button debounce"
```

---

### Task 8：构建接线（算法库进 pal_host OBJECT）+ 全量回归 + ADR §6 记录 `[ ⏳ 待开始 ]`

**Files:**
- Modify: `wink-micro-os/targets/host/CMakeLists.txt`（`pal_host` OBJECT +`wink_sim_physical.c`）
- Modify: `wink-micro-os/test/CMakeLists.txt`（去掉 Task 2 的临时显式链源）
- Modify: `docs/decisions/unisim/0009-physical-behavior-simulation-fault-injection.md`（§6 追加）

- [ ] **Step 1: 算法库进 `pal_host` OBJECT（零编译污染）**

`targets/host/CMakeLists.txt` 的 `add_library(pal_host OBJECT ...)` 源列表追加：
```cmake
    ${CMAKE_CURRENT_SOURCE_DIR}/../../pal/src/wink_sim_physical.c)
```
（接在 `wink_dev_config.c` 后。）

- [ ] **Step 2: 去掉 Task 2 的临时显式链源**

`test/CMakeLists.txt` 把 Task 2 的：
```cmake
add_wink_host_test(test_sim_physical test_sim_physical.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../pal/src/wink_sim_physical.c)
```
改回（算法库经 `HOST_PAL_OBJECT` 提供）：
```cmake
add_wink_host_test(test_sim_physical test_sim_physical.c)
```
此时 Task 6 Step 4 的 `test_host_gpio_ideal_transition_triggers_bounce` 用例可用（链 `HOST_PAL_OBJECT` 即含算法库 + `pal_gpio_read` + `host_gpio_read_debounced`）。确认该用例 `RUN_TEST` 已启用。

- [ ] **Step 3: 零编译污染核验**

Run: `grep -n wink_sim_physical wink-micro-os/targets/esp32 wink-micro-os/targets/baremetal wink-micro-os/targets/wasm -r`
Expected: 无命中（esp32/baremetal/wasm CMake 不含算法库）。

- [ ] **Step 4: 全量回归**

Run: `cmake -B build-test -DTARGET_PLATFORM=host -G Ninja; cmake --build build-test; ctest --test-dir build-test --output-on-failure`
Expected: 全绿（含 `test_sim_physical`、`test_button_debounce_e2e`、`test_pal_contract`、既有全量）。GCC+MSVC 双链 0 warning。

- [ ] **Step 5: ADR-0009 §6 追加 host Wave 1 记录**

`0009-physical-behavior-simulation-fault-injection.md` §6 末追加（状态行保持 Proposed）：
```markdown
* **2026-06-28：host 试点 Wave 1 落地（状态仍 Proposed；本记录为 PoC 验证，非 Acceptance）**：
  target 无关物理退化算法库 `pal/src/wink_sim_physical.c`（抖动状态机 / RC 低通+噪声 / 确定性 PRNG /
  warmup+采样间隔 / 总线丢包，五算法 host 全单测）+ 按键抖动接 `dal_button` 端到端**含负对照**（无去抖裸采样
  误触发 vs `dal_button` 去抖稳定，证明 §3.1「不写去抖则误触发」）+ 参数化 `wink_sim_faults_t`。
  确定性守卫（§4.1）在 host 满足（虚拟时钟 `pal_get_us`）；零编译污染（§4.3）：算法库仅进 `pal_host` OBJECT
 （esp32/baremetal CMake **显式枚举**源，已核验非 glob）。
  **对 §3.1 的修订项**：抖动电平模型由骨架的 `(now/1000)%2` 改为**每次采样强制翻转**（ctx 内 1 个翻转位 `bounce_flip`）。
  原因：`(now/P)%2` 强依赖采样周期——系统默认 `WINK_RUNTIME_TICK_MS=10`（`wink_status.h:63`）下商每 tick 增 10（偶），
  电平锁死、抖动静默失效；改质数 997 亦仅对特定 tick 有效（凡 `Δnow/P` 商增量为偶即混叠）。强制交替：采样周期无关、
  100% 确定、且是最严苛抖动（每次采样必跳）。RC 噪声 / 总线丢包仍用 PRNG（§4.1）。
  **wasm 集成仍为前置**：方案 C 的 wasm 双域 + JS 故障 JSON 下发未做，且依赖 ADR-0003 决策 3 的 wasm 虚拟时钟
  （当前 `pal_get_us` 仍为 JS 墙钟，`pal_osal_wasm.c:18`）。**ADR Accepted 待 wasm 虚拟时钟落地。**
  详见 [Wave 1 计划](./2026-06-28-adr-0009-host-pilot-physical-sim-wave1-plan.md)。
  Wave 2（新外设端到端）：ADC PAL+DAL、DHT11 预热、I2C-drop 挂 ssd1306，后置。
```

- [ ] **Step 6: 提交**
```bash
git add wink-micro-os/targets/host/CMakeLists.txt wink-micro-os/test/CMakeLists.txt docs/decisions/unisim/0009-physical-behavior-simulation-fault-injection.md
git commit -m "build(sim): ADR-0009 Wave1 wire algo lib into pal_host OBJECT + full regression + record in ADR §6"
```

---

## 6. 测试策略（L0–L1）

`test_sim_physical.c`（`add_wink_host_test`）覆盖算法库 5 算法：
1. **PRNG**：golden（seed=1→1103527590, ≈0.5138）+ 可复现 + [0,1) 范围（单精度）。
2. **抖动（强制交替）**：窗内每次采样强制翻转电平、出窗稳定、bounce_us=0 禁用、NULL ctx 降级、时钟回拨守卫（Task 3 共 5 用例）。
3. **RC 低通**：首次运行自适应初始化、首步 golden（0.02）+ 防御时钟回拨/重置 + 收敛到 target + 噪声有界 + NULL ctx 降级。
4. **warmup/间隔**：BUSY→TIMEOUT→OK 状态机 + 时钟回拨自动强制复位保护 + last_sample 更新语义。
5. **总线丢包**：0‰ 永不丢、1000‰ 总丢、500‰ 确定性可复现。
6. **host GPIO 注入**：电平**跃变**触发抖动（上电态不抖）、强制交替序列、出窗稳定、未注入 pin 现状不变（Task 6 用例）。

`test_button_debounce_e2e.c`（`add_wink_test_sim`，`-DSIMULATION`）覆盖端到端：
7. **去抖吸收抖动（正）**：电平跃变 + 30ms 抖动 → dal_button 计数去抖吸收 → 稳定 pressed。
8. **无去抖误触发（负对照）**：同一抖动序列 + 裸采样 → 窗内必跳变，证明 §3.1「不写去抖则误触发」。
9. **理想基线**：bounce_us=0 → 无退化快速 pressed。

**L0 编译门禁**：host `ctest` 全绿；`test_pal_contract` 绿；GCC+MSVC 双链 0 warning；esp32/baremetal/wasm 不含算法库（grep 核验）。

---

## 7. 回滚与降级方案

- **方案 1（运行期降级，内置）**：`sim_set_faults(&WINK_SIM_FAULTS_IDEAL)`（全 0）→ 所有退化禁用，等同理想仿真；`sim_clear_gpio_ideal()` → `pal_gpio_read` 回现状。无需重编译。
- **方案 2（Git 回退）**：`git revert` Wave 1 全部 commit → 回 baseline。
- **方案 3（编译期裁剪）**：从 `pal_host` OBJECT 移除 `wink_sim_physical.c` + 还原 `pal_gpio_read` → 退化路径消失（host 回纯 echo 逻辑）。

---

## 8. 参考资料

- [ADR-0009](../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)
- [ADR-0003](../../decisions/unisim/0003-simulation-fidelity-boundary.md)（决策 2 bypass 收窄、决策 3 虚拟时钟前置）
- [ADR-0004](../../decisions/core/0004-static-dispatch-vs-runtime-ops.md)
- [ADR-0008 计划](../core/2026-06-28-adr-0008-flash-device-tree-override-plan.md)（TDD + 三 target 构建先例）

---

## 9. Self-Review（writing-plans 自查）

- **Spec 覆盖**：设计 §1（架构）→ Task 6/7/8；§2（5 算法库）→ Task 2-5；§3（按键端到端）→ Task 6/7；§4（故障配置）→ Task 2(`wink_sim_faults_t`) + Task 6(`sim_set_faults`)；§5（测试）→ §6 测试策略；§6（边界：ADR Proposed / 零编译污染）→ Task 8 Step 3/5。✅ 全覆盖。
- **占位扫描**：Task 2 的 warmup_check stub 已注明「Task 5 替换」且 Task 5 确有真实实现步骤；无 TBD/TODO。✅
- **类型一致性**：`wink_sim_faults_t` 字段（bounce_us/warmup_us/sample_interval_us/adc_noise_v/rc_tau_s/i2c_drop_permil/prng_seed）在 Task 2 定义、Task 6 `sim_set_faults` 消费、Task 7 测试填充——一致。`wink_phys_debounce_ctx_t`（含 `bounce_flip`）Task 3 定义、Task 6 `sim_set_gpio_ideal` 注册初始化 + `host_gpio_read_debounced` 调用——一致。✅
- **评审修复回溯（专家复查）**：① **P0 假绿已修**——原 Task 6/7 单次 `sim_set_gpio_ideal` 后期望抖动，但注册即同步 `stable=level` 使 `target==stable` 永不抖动；现改为构造**电平跃变序列** + **负对照**（裸采样误触发）。② **抖动模型已升级**——原 `(now/997)%2` 在系统默认 10ms tick 下混叠锁死，改为**强制交替**（采样周期无关）。③ **P1 注入双语义 / echo pin 约束**已写入 §2.3 红线 6/7 + 头文件契约。④ **P2 注释措辞**（「消除 FPU 双精度开销」→「f 后缀保确定性」）已正。✅
- **Wave 2 边界**：ADC/DHT11/I2C-drop 端到端明确标注 Wave 2、本计划不实现，仅 bus_drop/warmup 算法层单测。✅

### 问题与变更日志

| 日期 | 问题描述 | 解决方案 | 影响范围 |
|------|----------|----------|----------|
| 2026-06-28 | Task 6 注入测试依赖 Task 8 CMake 接线（算法库进 OBJECT） | Task 6 Step 4 注明执行顺序：先改代码、Task 8 接线后启用；或临时显式链源 | Task 6/8 |
| 2026-06-28 | RC 低通避免 expf/libm 依赖 | 用离散一阶近似 `alpha=min(1,dt/tau)`，注明与 §3.3 公式差异 | Task 4 |
| 2026-06-28 | **P0** Task 6/7 端到端假绿：单次 set 后 `stable==target` 永不抖动 | 改为电平跃变序列（先稳定释放态、再改按下态）+ 负对照（裸采样误触发）；强制交替保证窗内必跳变 | Task 6/7 |
| 2026-06-28 | **P0** 抖动 `(now/997)%2` 在 10ms tick 下混叠锁死、抖动静默失效 | 改为每次采样强制翻转（ctx `bounce_flip`），采样周期无关、100% 确定；Task 8 回写 ADR §3.1 修订项 | Task 3/8 |
| 2026-06-28 | **P1** `sim_set_gpio_ideal` 双语义 / echo pin 约束未文档化 | 写入 §2.3 红线 6/7 + `host_test_ctrl.h` / `wink_sim_physical.h` 契约注释 | Task 6 |
| 2026-06-28 | **P2** 注释「消除 FPU 双精度开销」过度承诺 | 改为「字面量统一 f 后缀，避免中间 double 提升，保确定性」 | Task 2/4 |


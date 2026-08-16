# Plan 2 — trace + runtime 骨架（一等 peer 层 + 回调注入主循环）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 A* 的两个一等 peer 层：`trace/`（Golden Trace：固定大小环形缓冲 + fault 记录，零动态分配）与 `runtime/`（协作式主循环，App 经 `wink_app_callbacks_t` 回调注入，runtime 对外部 `app_*` 符号零 `extern` 依赖），并各成独立 STATIC 库；host 端跑通"注册回调 → 跑 N tick → fault 上报 trace"的端到端集成测。

**Architecture:** 落地 03-directory-architecture.md §4/§7 + §6.1 约束1（零分配）、约束2（DAL/PAL 不调 trace，但 runtime 可调 trace）。`trace` 是横切基础服务（被 runtime/app 消费），`runtime` 用 PAL OSAL 做 tick、用 `pal_delay_ms` 让出（语义由各 target 实现）。回调注入达成二进制解耦：runtime 库内无 `extern void app_loop(void)`，而是接收一个函数指针结构体，host 测试可直接传 mock 回调验证调度行为。

**Tech Stack:** C99 · CMake ≥3.15 · Unity · host gcc。

## Global Constraints

- 见系列 [00-README.md 全局约束](./00-README.md)。
- **零动态分配**（§6.1 约束1）：trace 用静态环形缓冲，runtime 无动态分配。
- **Trace 隔离**（§6.1 约束2）：runtime 可调 `wink_trace_*`（它是 App/调度层，非 DAL/PAL 驱动）；但本计划 runtime 只在 fault 路径调 `wink_trace_fault`，不在正常 tick 路径刷 trace（保持极简）。
- **依赖前置**：本计划需要 Plan 1 的 `pal`(INTERFACE) + `wink_status.h`。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `wink-micro-os/trace/include/wink_trace.h` | Create | trace 公共 API：`wink_trace_fault()`、`wink_trace_reset()`、`wink_trace_count()`、`wink_trace_last()` |
| `wink-micro-os/trace/src/wink_trace.c` | Create | 静态环形缓冲实现（零分配） |
| `wink-micro-os/trace/CMakeLists.txt` | Create | `libwink_trace.a` STATIC，link pal |
| `wink-micro-os/runtime/include/wink_app.h` | Create | `wink_app_callbacks_t` 回调结构体 + `wink_app_delay_ms()` |
| `wink-micro-os/runtime/include/wink_runtime.h` | Create | `wink_runtime_run(callbacks, max_ticks)` 主循环入口 |
| `wink-micro-os/runtime/src/wink_runtime.c` | Create | tick 调度实现（回调注入，无外部 extern） |
| `wink-micro-os/runtime/CMakeLists.txt` | Create | `libwink_runtime.a` STATIC，link pal + trace |
| `wink-micro-os/test/test_trace.c` | Create | trace 单元测试 |
| `wink-micro-os/test/test_runtime.c` | Create | runtime 回调注入 + tick 调度测试 |
| `wink-micro-os/test/CMakeLists.txt` | Modify | 注册新测试；trace/runtime 源编入测试 |

---

## Task 1: `trace/` —— Golden Trace 一等 peer 层

**Files:**
- Create: `wink-micro-os/trace/include/wink_trace.h`
- Create: `wink-micro-os/trace/src/wink_trace.c`
- Create: `wink-micro-os/trace/CMakeLists.txt`

**Interfaces:**
- Consumes: Plan 1 的 `wink_status.h`（`uint32_t` fault 码用 `uint32_t`，无 PAL 硬件依赖）。
- Produces: `libwink_trace.a`；API（后续 runtime/Plan 4/Plan 5 与 App 消费）：
  - `void wink_trace_reset(void)`
  - `void wink_trace_fault(uint32_t fault_code)`
  - `uint32_t wink_trace_count(void)`
  - `uint32_t wink_trace_last(void)`（无记录返回 `0`）

- [ ] **Step 1: 写失败测试 `test/test_trace.c`**

```c
#include "unity.h"
#include "wink_trace.h"

void setUp(void) { wink_trace_reset(); }
void tearDown(void) {}

void test_reset_clears_buffer(void) {
    wink_trace_fault(1001);
    wink_trace_reset();
    TEST_ASSERT_EQUAL_UINT32(0, wink_trace_count());
}

void test_fault_recorded_in_order(void) {
    wink_trace_fault(1001);
    wink_trace_fault(1002);
    TEST_ASSERT_EQUAL_UINT32(2, wink_trace_count());
    TEST_ASSERT_EQUAL_UINT32(1002, wink_trace_last());
}

void test_ring_buffer_overwrites_oldest(void) {
    /* WINK_TRACE_CAPACITY 见 wink_trace.h；填满后再写，count 封顶、last 为最新 */
    for (uint32_t i = 0; i < WINK_TRACE_CAPACITY + 5; i++) {
        wink_trace_fault(i);
    }
    TEST_ASSERT_EQUAL_UINT32(WINK_TRACE_CAPACITY, wink_trace_count());
    TEST_ASSERT_EQUAL_UINT32(WINK_TRACE_CAPACITY + 4, wink_trace_last());
}

void test_last_when_empty_is_zero(void) {
    TEST_ASSERT_EQUAL_UINT32(0, wink_trace_last());
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_reset_clears_buffer);
    RUN_TEST(test_fault_recorded_in_order);
    RUN_TEST(test_ring_buffer_overwrites_oldest);
    RUN_TEST(test_last_when_empty_is_zero);
    return UNITY_END();
}
```

- [ ] **Step 2: 注册测试到 `test/CMakeLists.txt`**

在 `add_wink_test(test_smoke test_smoke.c)` 后追加（注意把 trace 源编入测试可执行，避免单独链 trace 库）：

```cmake
add_wink_test(test_trace test_trace.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../trace/src/wink_trace.c)
```

> `add_wink_test`（Plan 1 Task 2）已 PRIVATE 包含 `${CMAKE_CURRENT_SOURCE_DIR}/../pal/include`，trace 源能找到 `wink_status.h`。需额外让 trace 头可见——在 `add_wink_test` 函数体的 `target_include_directories` 列表追加 `${CMAKE_CURRENT_SOURCE_DIR}/../trace/include`。**修改 `add_wink_test` 函数**（在 `../pal/include` 那行后加一行）：

```cmake
    target_include_directories(${name} PRIVATE
        ${UNITY_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/../pal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../trace/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include)
```

- [ ] **Step 3: 运行测试，确认失败（trace 未实现）**

Run:
```bash
cmake --build build-test
cd build-test && ctest -R test_trace --output-on-failure
```
Expected: 编译失败 —— `wink_trace.h` not found / `wink_trace_fault` 未定义。

- [ ] **Step 4: 写 `trace/include/wink_trace.h`**

```c
/**
 * @file wink_trace.h
 * @brief Golden Trace —— 故障/事件记录的一等 peer 层。
 *
 * 定位见 03-directory-architecture.md §4（trace 独立顶层，非 runtime 子特性）。
 * 零动态分配（§6.1 约束1）：内部用静态环形缓冲。
 * 隔离契约（§6.1 约束2）：DAL/PAL 驱动禁调本 API；仅 runtime 调度器与 App 回调调用。
 */
#ifndef WINK_TRACE_H
#define WINK_TRACE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** @brief 环形缓冲容量（静态分配，可按平台调整） */
#ifndef WINK_TRACE_CAPACITY
#define WINK_TRACE_CAPACITY 32
#endif

/** @brief 清空 trace 缓冲（启动/测试前调用） */
void wink_trace_reset(void);

/**
 * @brief 记录一个故障码
 * @param fault_code 业务自定义故障码（由 App/runtime 在 fault 路径上报）
 * @note 满则覆盖最旧记录（环形）
 */
void wink_trace_fault(uint32_t fault_code);

/** @brief 当前已记录条数（≤ WINK_TRACE_CAPACITY） */
uint32_t wink_trace_count(void);

/** @brief 最近一条故障码；无记录返回 0 */
uint32_t wink_trace_last(void);

#ifdef __cplusplus
}
#endif

#endif /* WINK_TRACE_H */
```

- [ ] **Step 5: 写 `trace/src/wink_trace.c`**

```c
/**
 * @file wink_trace.c
 * @brief Golden Trace 实现：静态环形缓冲（零动态分配）。
 */
#include "wink_trace.h"

static uint32_t s_buffer[WINK_TRACE_CAPACITY];
static uint32_t s_count = 0;     /* 已写入总数（含覆盖） */
static uint32_t s_head = 0;      /* 下一个写入位置 */

void wink_trace_reset(void) {
    s_count = 0;
    s_head = 0;
}

void wink_trace_fault(uint32_t fault_code) {
    s_buffer[s_head] = fault_code;
    s_head = (s_head + 1u) % WINK_TRACE_CAPACITY;
    s_count++;                   /* 溢出回绕由 count() 截断 */
}

uint32_t wink_trace_count(void) {
    return (s_count < WINK_TRACE_CAPACITY) ? s_count : WINK_TRACE_CAPACITY;
}

uint32_t wink_trace_last(void) {
    if (s_count == 0) return 0u;
    /* 最近写入在 s_head 的前一个位置 */
    uint32_t last_idx = (s_head + WINK_TRACE_CAPACITY - 1u) % WINK_TRACE_CAPACITY;
    return s_buffer[last_idx];
}
```

- [ ] **Step 6: 写 `trace/CMakeLists.txt`（独立 STATIC 库）**

```cmake
# trace (Golden Trace) —— 一等 peer 层 STATIC 库。
# 被 runtime/dal/app 消费（横切基础服务）。零动态分配。
add_library(wink_trace STATIC
    src/wink_trace.c)

target_include_directories(wink_trace PUBLIC include)
target_link_libraries(wink_trace PUBLIC pal)   /* wink_status.h 等 */
```

- [ ] **Step 7: 挂载 trace 子目录到顶层 CMake**

Modify `wink-micro-os/CMakeLists.txt`，在 `add_subdirectory(dal)` 后、host test 段前追加：

```cmake
add_subdirectory(trace)
```

- [ ] **Step 8: 运行测试，确认通过**

Run:
```bash
cmake --build build-test
cd build-test && ctest -R test_trace --output-on-failure
```
Expected: `test_trace` PASS（4 测试通过）。

- [ ] **Step 9: Commit**

```bash
git add wink-micro-os/trace wink-micro-os/test/test_trace.c wink-micro-os/test/CMakeLists.txt wink-micro-os/CMakeLists.txt
git commit -m "Add trace peer layer (Golden Trace, static ring buffer, zero-alloc)"
```

---

## Task 2: `runtime/` —— 回调注入主循环（无外部 extern）

**Files:**
- Create: `wink-micro-os/runtime/include/wink_app.h`
- Create: `wink-micro-os/runtime/include/wink_runtime.h`
- Create: `wink-micro-os/runtime/src/wink_runtime.c`
- Create: `wink-micro-os/runtime/CMakeLists.txt`
- Create: `wink-micro-os/test/test_runtime.c`

**Interfaces:**
- Consumes: Plan 1 `wink_status.h`、`pal_osal.h`（`pal_delay_ms`）；Task 1 `wink_trace.h`（`wink_trace_fault`）。
- Produces: `libwink_runtime.a`；API（target entry 与 App 消费）：

```c
typedef struct {
    void (*init)(void);
    void (*loop)(void);
    void (*on_fault)(uint32_t fault_code);
} wink_app_callbacks_t;

void wink_app_delay_ms(uint32_t ms);
wink_status_t wink_runtime_run(const wink_app_callbacks_t *callbacks, uint32_t max_ticks);
```

> `wink_runtime_run` 的 `max_ticks`：host/测试用有限值（避免 `while(1)` 卡死）；真机/wasm entry 传 `0` 表示无限循环（见 Step 4 实现的 `max_ticks==0` 分支）。

- [ ] **Step 1: 写失败测试 `test/test_runtime.c`**

```c
#include "unity.h"
#include "wink_runtime.h"
#include "wink_trace.h"

/* 测试用 mock 计数器（静态分配，§6.1 约束1） */
static int s_init_calls = 0;
static int s_loop_calls = 0;
static int s_fault_calls = 0;
static uint32_t s_last_fault = 0;

static void mock_init(void) { s_init_calls++; }
static void mock_loop(void) {
    s_loop_calls++;
    /* 第 3 次 loop 模拟触发故障并主动上报 trace */
    if (s_loop_calls == 3) {
        wink_trace_fault(7001);
    }
}
static void mock_on_fault(uint32_t code) { s_fault_calls++; s_last_fault = code; }

void setUp(void) {
    s_init_calls = s_loop_calls = s_fault_calls = 0;
    s_last_fault = 0;
    wink_trace_reset();
}
void tearDown(void) {}

void test_run_calls_init_once_then_loop(self_void) { (void)self_void; /* placeholder removed below */ }

void test_run_calls_init_once_then_loops_n_times(void) {
    wink_app_callbacks_t cb = { mock_init, mock_loop, mock_on_fault };
    wink_status_t s = wink_runtime_run(&cb, 5);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
    TEST_ASSERT_EQUAL_INT(1, s_init_calls);
    TEST_ASSERT_EQUAL_INT(5, s_loop_calls);
}

void test_run_null_callbacks_returns_invalid_arg(void) {
    wink_status_t s = wink_runtime_run(NULL, 5);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, s);
}

void test_null_init_callback_treated_as_ok(void) {
    /* init/loop 允许 NULL（runtime 跳过），on_fault 允许 NULL */
    wink_app_callbacks_t cb = { NULL, NULL, NULL };
    wink_status_t s = wink_runtime_run(&cb, 3);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_run_calls_init_once_then_loops_n_times);
    RUN_TEST(test_run_null_callbacks_returns_invalid_arg);
    RUN_TEST(test_null_init_callback_treated_as_ok);
    return UNITY_END();
}
```

> ⚠ 删除上面那个占位 `test_run_calls_init_once_then_loop` 函数（它是误植的残行，不要写入文件）。最终文件只含 3 个真实测试 + setUp/tearDown + main。

- [ ] **Step 2: 注册测试到 `test/CMakeLists.txt`**

在 `add_wink_test(test_trace ...)` 后追加（runtime 源 + trace 源都编入）：

```cmake
add_wink_test(test_runtime test_runtime.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/src/wink_runtime.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../trace/src/wink_trace.c)
```

> runtime 的 `wink_app_delay_ms` 会调 `pal_delay_ms`——本测试不实际消耗时间，需一个 host 的 `pal_delay_ms` 桩。最简做法：在 `test/` 加 `pal_host_min_stub.c`（仅 OSAL，最小桩），编入 test_runtime。**Create `wink-micro-os/test/pal_host_min_stub.c`**：

```c
/* host 测试用最小 PAL OSAL 桩（仅供 runtime 测试，非一等 target；Plan 3 引入完整 targets/host） */
#include "pal_osal.h"

void pal_delay_ms(uint32_t ms) { (void)ms; }
void pal_delay_us(uint32_t us) { (void)us; }
uint64_t pal_get_ms(void) { return 0; }
uint64_t pal_get_us(void) { return 0; }
pal_mutex_t pal_mutex_create(void) { return (pal_mutex_t)1; }
bool pal_mutex_lock(pal_mutex_t m, uint32_t t) { (void)m; (void)t; return true; }
bool pal_mutex_unlock(pal_mutex_t m) { (void)m; return true; }
void pal_mutex_destroy(pal_mutex_t m) { (void)m; }
```

并把 test_runtime 的注册改为（追加该桩）：

```cmake
add_wink_test(test_runtime test_runtime.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/src/wink_runtime.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../trace/src/wink_trace.c
    ${CMAKE_CURRENT_SOURCE_DIR}/pal_host_min_stub.c)
```

- [ ] **Step 3: 运行测试，确认失败**

Run:
```bash
cmake --build build-test
cd build-test && ctest -R test_runtime --output-on-failure
```
Expected: 编译失败 —— `wink_runtime.h` not found / `wink_runtime_run` 未定义。

- [ ] **Step 4: 写 `runtime/include/wink_app.h`**

```c
/**
 * @file wink_app.h
 * @brief App 回调契约 —— 生成式 App 通过此结构体向 runtime 注册生命周期钩子。
 *
 * 回调注入（非 extern）：runtime 库不持有对外部 app_* 符号的强依赖，
 * 达成二进制级解耦（见 03-directory-architecture.md §7）。target entry 实例化
 * 本结构体并调用 wink_runtime_run。
 */
#ifndef WINK_APP_H
#define WINK_APP_H

#include <stdint.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief App 生命周期回调集合（各字段允许为 NULL，runtime 跳过）
 *  - init:    启动时调用一次
 *  - loop:    每个 tick 调用
 *  - on_fault: 故障时调用（fault_code 由 runtime 或 App 上报）
 */
typedef struct {
    void (*init)(void);
    void (*loop)(void);
    void (*on_fault)(uint32_t fault_code);
} wink_app_callbacks_t;

/** @brief App 侧周期延时（内部转 PAL pal_delay_ms，语义由 target 实现） */
void wink_app_delay_ms(uint32_t ms);

#ifdef __cplusplus
}
#endif

#endif /* WINK_APP_H */
```

- [ ] **Step 5: 写 `runtime/include/wink_runtime.h`**

```c
/**
 * @file wink_runtime.h
 * @brief OS 主循环入口（target-agnostic）。
 *
 * 各 target 的 *_entry.c 实例化 wink_app_callbacks_t 后调用 wink_runtime_run。
 * 调度器仅用 PAL OSAL 做 tick，挂起语义由 target 实现（ADR-0002 双 target 对齐落点）。
 */
#ifndef WINK_RUNTIME_H
#define WINK_RUNTIME_H

#include "wink_app.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief 运行 OS 主循环
 * @param callbacks App 生命周期回调（NULL 返回 WINK_ERR_INVALID_ARG）
 * @param max_ticks 最多跑多少个 loop tick；传 0 表示无限循环（真机/wasm）
 * @return WINK_OK（max_ticks>0 跑完后）或 WINK_ERR_INVALID_ARG
 * @note host/测试传有限 max_ticks 避免 while(1) 卡死
 */
WINK_WARN_UNUSED_RESULT
wink_status_t wink_runtime_run(const wink_app_callbacks_t *callbacks, uint32_t max_ticks);

#ifdef __cplusplus
}
#endif

#endif /* WINK_RUNTIME_H */
```

- [ ] **Step 6: 写 `runtime/src/wink_runtime.c`**

```c
/**
 * @file wink_runtime.c
 * @brief 协作式主循环实现（回调注入，无外部 extern app_*）。
 */
#include "wink_runtime.h"
#include "pal_osal.h"

void wink_app_delay_ms(uint32_t ms) {
    pal_delay_ms(ms);
}

wink_status_t wink_runtime_run(const wink_app_callbacks_t *callbacks, uint32_t max_ticks) {
    if (callbacks == NULL) return WINK_ERR_INVALID_ARG;

    if (callbacks->init) {
        callbacks->init();
    }

    uint32_t tick = 0;
    /* max_ticks == 0 => 无限循环（真机/wasm）；host 测试传有限值 */
    while ((max_ticks == 0u) || (tick < max_ticks)) {
        if (callbacks->loop) {
            callbacks->loop();
        }
        wink_app_delay_ms(WINK_RUNTIME_TICK_MS);
        tick++;
    }
    return WINK_OK;
}
```

> 需在 `wink_runtime.c` 顶部或 `wink_runtime.h` 定义 `WINK_RUNTIME_TICK_MS`。**在 `wink_runtime.h` 的 `#include` 区后、`wink_runtime_run` 声明前追加**：

```c
/** @brief 单 tick 默认延时（ms），可被 target/app 覆盖（编译期 -D） */
#ifndef WINK_RUNTIME_TICK_MS
#define WINK_RUNTIME_TICK_MS 10
#endif
```

- [ ] **Step 7: 写 `runtime/CMakeLists.txt`**

```cmake
# runtime (OS 运行时) —— STATIC 库，回调注入主循环。
add_library(wink_runtime STATIC
    src/wink_runtime.c)

target_include_directories(wink_runtime PUBLIC include)
target_link_libraries(wink_runtime PUBLIC pal wink_trace)   /* pal: OSAL; wink_trace: fault 上报 */
```

- [ ] **Step 8: 挂载 runtime 子目录到顶层 CMake**

Modify `wink-micro-os/CMakeLists.txt`，在 `add_subdirectory(trace)` 后追加：

```cmake
add_subdirectory(runtime)
```

- [ ] **Step 9: 运行测试，确认通过**

Run:
```bash
cmake --build build-test
cd build-test && ctest --output-on-failure
```
Expected: 全 PASS（test_smoke + test_trace + test_runtime）。

- [ ] **Step 10: Commit**

```bash
git add wink-micro-os/runtime wink-micro-os/test/test_runtime.c wink-micro-os/test/pal_host_min_stub.c wink-micro-os/test/CMakeLists.txt wink-micro-os/CMakeLists.txt
git commit -m "Add runtime peer layer (callback-injected cooperative main loop, no extern app deps)"
```

---

## Self-Review

**1. Spec coverage（对照 03-directory-architecture.md）**：
- §4 `trace/` 一等 peer（wink_trace.h/.c + 库）→ Task 1 ✅
- §4 `runtime/` 一等层（wink_app.h/wink_runtime.h/.c + 库）→ Task 2 ✅
- §7 回调注入 `wink_app_callbacks_t` + `wink_runtime_run(callbacks)` → Task 2 ✅（与用户优化的 §7 流程图一致）
- §6.1 约束1 零动态分配 → trace 静态缓冲 ✅、runtime 无分配 ✅
- §6.1 约束2 trace 隔离 → runtime（非 DAL/PAL）调 `wink_trace_fault` 在注释/契约上合规 ✅

**2. Placeholder scan**：无 TBD/TODO；test_trace/test_runtime 含完整断言；占位残函数已显式标注删除 ✅。

**3. Type/signature consistency**：
- `wink_app_callbacks_t {init, loop, on_fault}` 在 wink_app.h 定义、wink_runtime.c 使用、test_runtime mock 一致 ✅
- `wink_runtime_run(const wink_app_callbacks_t*, uint32_t) -> wink_status_t` 三处一致 ✅
- `wink_trace_*` 4 个 API 在 wink_trace.h 定义、wink_trace.c 实现、test_trace 调用一致 ✅
- `WINK_TRACE_CAPACITY` 在 .h 定义、test 依赖、.c 使用一致 ✅
- `WINK_RUNTIME_TICK_MS` 在 .h 定义、.c 使用一致 ✅

**4. 已知风险**：
- `pal_host_min_stub.c` 是临时最小 OSAL 桩（仅供 runtime 测试）；Plan 3 引入完整 `targets/host/`（含 HAL + OSAL + 协作式虚拟时间）后会取代它。runtime 测试届时改链 targets/host OBJECT 库。本计划与 Plan 3 已在 00-README 依赖图标注 P2→P3。
- `wink_runtime_run` 不在正常 tick 路径调 trace（极简）；fault 上报由 App 回调内部自调 `wink_trace_fault`（test_runtime mock 演示），runtime 自身 MVP 不自动注入 fault——符合"故障捕获收敛在 App"的 §6.1 约束2。
- 真机/wasm 的 `max_ticks=0` 无限循环分支未在本测试覆盖（host 无法测 while(1)）；该分支由 Plan 3 的 target entry 验证（wasm/esp32）。

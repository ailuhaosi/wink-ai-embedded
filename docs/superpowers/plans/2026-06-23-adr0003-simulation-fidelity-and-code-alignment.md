# ADR-0003 仿真可信度边界落地 + DAL 代码对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 ADR-0003 的决策 1（仿真可信度边界文档声明）与决策 2（`#ifdef SIMULATION` bypass 收窄到最底层），并顺手清掉阻塞它们的代码技术债（缺失的 `wink_status.h`、DAL 层未对齐 `wink_status_t` 的签名），使 wink-micro-os 内核进入"代码与已 Accepted 的 ADR-0001/0004 一致、bypass 形态符合 c-code.md §2 lowest-layer 规则"的可实施基线。

**Architecture:** ADR-0003 三个决策难度梯度极大（决策 1 纯文档 / 决策 2 中等代码重构 / 决策 3 系统级后置工程）。本计划聚焦**可立即执行、可测试**的决策 1 + 决策 2 + 技术债对齐，把决策 3 留作 Phase 1+ 路标（仅记录借鉴资产，不展开 bite-sized 步骤）。决策 2 的 bypass 收窄与 ADR-0002 双 target spike 共用同一批 DAL 代码，二者协同推进。测试采用 host (PC gcc) + Unity 框架，范式迁移自外部对照仓库 chigo-micro（`D:\workspaces\ai-coding\chigo\chigo-micro\project\embedded\sim\test\`，已迁出本仓库，见 MEMORY）。

**Tech Stack:** C99 · CMake ≥3.15 · Unity 单元测试框架（vendor） · Emscripten/xtensa 双 target（本计划不改 target 实现，仅保证双 target 可编译性）。

## Global Constraints

- **C 标准**：C99（`CMAKE_C_STANDARD 99`，见 `wink-micro-os/CMakeLists.txt`）。
- **双 target 同源**：所有 C 改动必须同时能被 `emcc`（wasm32）与 `xtensa-esp32-elf-gcc`（ESP-IDF）干净编译，禁用任一工具链不支持的 clang/gcc 扩展（ADR-0002、c-code.md §3）。
- **错误码**：所有可能失败的函数返回 `wink_status_t`（`int32_t`），`0 = WINK_OK`，负数 = 错误；判定用 `if (status < 0)`，禁止 `if (status)`（ADR-0001、c-code.md §1）。
- **DAL 范式**：编译期静态分发 + 命名式 API + POD 结构体，禁止 `struct device_ops`/函数指针虚表/`container_of`（ADR-0004、c-code.md §2）。
- **bypass 收窄**：`#ifdef SIMULATION` 只旁路最底层的物理信号来源（trigger 时序、echo 脉宽测量），协议解析/换算/超时逻辑必须两端同源共享（ADR-0003 决策 2、c-code.md §2）。
- **Git 提交**：英文 message、原子提交（按逻辑模块聚合）、关联相关 ADR（CLAUDE.md Git Commit Rules）。
- **本计划 Out-of-Scope**：① HAL 层（`pal_*.h`）仍返回 `bool`，全量迁移到 `wink_status_t` 范围过大，留作后续独立任务；② 顶层 CMake 的 `-Wall -Wextra -Werror` 全局开关属 ADR-0002 spike 项 1 范围；③ 顶层 CMake `ASYNCIFY_IMPORTS` 配置疑点（应含 `js_pal_delay_ms` 而非仅 `js_sim_get_ultrasonic_distance`）移交 ADR-0002 spike；④ 决策 3（虚拟时钟 + 多任务仿真）详见 Phase E 路标。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `wink-micro-os/pal/include/wink_status.h` | Create | 统一 `wink_status_t` 类型 + 错误码宏（ADR-0001）。放 PAL 层因 PAL 是最底层、被所有上层 link 继承 include。 |
| `wink-micro-os/pal/CMakeLists.txt` | Modify | 把 `wink_status.h` 纳入 `target_sources`（工程可见性）。 |
| `wink-micro-os/test/unity/unity.{c,h}` + `unity_internals.h` | Create (vendor) | 从 `chigo-micro/project/embedded/sim/test/unity/` 拷贝 Unity 框架。 |
| `wink-micro-os/test/pal_host_stub.{c,h}` | Create | host 测试用 PAL 桩：协作式虚拟时间推进（支撑 ultrasonic 脉宽测量）+ pwm duty 记录（支撑 servo）。 |
| `wink-micro-os/test/CMakeLists.txt` | Create | host test 构建配置（Unity + ctest），范式迁移自 chigo。 |
| `wink-micro-os/CMakeLists.txt` | Modify | 非 wasm 时 `add_subdirectory(test)` + `enable_testing()`。 |
| `wink-micro-os/dal/include/dal_ultrasonic.h` | Modify | 签名 `float get_distance()` → `wink_status_t read(dev, float *out)`（对齐设计文档 §3.1）。 |
| `wink-micro-os/dal/src/dal_ultrasonic.c` | Modify | 两阶段：Task 5 对齐签名（保整 bypass）；Task 7 收窄 bypass（提取共享换算、仿真侧只取脉宽）。 |
| `wink-micro-os/dal/include/dal_servo.h` | Modify | 签名 `bool set_angle()` → `wink_status_t set_angle()`。 |
| `wink-micro-os/dal/src/dal_servo.c` | Modify | 返回 `wink_status_t`，PAL 失败转 `WINK_ERR_IO`。 |
| `wink-micro-os/test/js_sim_host_stub.{c,h}` | Create (Task 7) | 仿真侧 js_sim_* host 桩（-DSIMULATION 同源测试用）。 |
| `wink-micro-os/test/test_dal_ultrasonic_sim.c` | Create (Task 7) | 仿真分支同源测试（-DSIMULATION=1，验证两端换算一致）。 |
| `docs/design/07-platform-governance/01-device-model-registry.md` | Modify (Task 7) | bypassImports 同步为新 trigger + measure_pulse_us 两条（SSOT 先行）。 |
| `wink-micro-os/test/test_dal_ultrasonic.c` | Create | ultrasonic 单元/集成测试。 |
| `wink-micro-os/test/test_dal_servo.c` | Create | servo 单元测试。 |
| `docs/design/README.md` | Modify (Task 3) | 顶层前置仿真可信度边界声明。 |
| `docs/design/01-system-overall/01-system-overview.md` | Modify (Task 3) | §1 愿景段加边界声明。 |
| `docs/implementation-plans/scripts/README.md` | Modify (Task 4) | 加"已知仿真限制"小节。 |
| `docs/decisions/unisim/0003-simulation-fidelity-boundary.md` | Modify (Task 8) | 决策 1/2 落地后状态推进 + 日志。 |
| `docs/decisions/unisim/0002-dual-target-compilation.md` | Modify (Task 8) | 声明项 4 对 ADR-0003 决策 2 的前置依赖（已在前次标注，本计划复核）。 |

---

## Phase 0 — 基础设施（blocker）

### Task 1: 创建 `wink_status.h` 统一错误码头文件

**Files:**
- Create: `wink-micro-os/pal/include/wink_status.h`
- Modify: `wink-micro-os/pal/CMakeLists.txt`

**Interfaces:**
- Produces: `wink_status_t`（`enum`，**逐字源出 `02-error-fault-model.md §2`**）、完整错误码枚举（含 ADR-0001 方案 C + ADR-0005 `-50s` 降级段；`WINK_ERR_IO = -5` 等）、`WINK_WARN_UNUSED_RESULT` 便携宏、`wink_status_is_error()` 便利函数；后续所有 DAL 任务消费此类型。

- [ ] **Step 1: 写 `wink_status.h`**

```c
/**
 * @file wink_status.h
 * @brief 统一状态返回类型与错误码
 *
 * ⚠ SSOT 闭环：本头是 `docs/design/07-platform-governance/02-error-fault-model.md §2`
 *    的落地物。错误码取值、命名、码段分区必须与该规范逐字一致；任何变更先改
 *    02-error-fault-model.md，再同步本头（避免第三处漂移，见 pitfalls.md 陷阱 3）。
 *    约定：0 = WINK_OK，负数 = 错误；判定用 if (status < 0)，禁 if (status)。
 */
#ifndef WINK_STATUS_H
#define WINK_STATUS_H

#ifdef __cplusplus
extern "C" {
#endif

/* 便携「返回值不可忽略」宏（error-codes.md；禁裸写 __attribute__）。
 * MSVC 下退化为空，保证双 target 同源 (ADR-0002)。 */
#if defined(__GNUC__) || defined(__clang__)
    #define WINK_WARN_UNUSED_RESULT __attribute__((warn_unused_result))
#else
    #define WINK_WARN_UNUSED_RESULT
#endif

/* 与 02-error-fault-model.md §2 逐字一致 (ADR-0001 方案 C + ADR-0005 -50s 降级段) */
typedef enum {
    WINK_OK = 0,

    /* 通用可恢复错误（负数，对齐 Linux/POSIX 惯例） */
    WINK_ERR_INVALID_ARG        = -1,
    WINK_ERR_TIMEOUT            = -2,
    WINK_ERR_DISCONNECTED       = -3,
    WINK_ERR_OUT_OF_RANGE       = -4,
    WINK_ERR_IO                 = -5,
    WINK_ERR_BUSY               = -6,
    WINK_ERR_UNSUPPORTED        = -7,
    WINK_ERR_CHECKSUM           = -8,
    WINK_ERR_PERMISSION         = -9,
    WINK_ERR_RESOURCE_EXHAUSTED = -10,
    WINK_ERR_NOT_INITIALIZED    = -11,

    /* 功能安全相关（区分可恢复 / 致命） */
    WINK_ERR_OVERCURRENT        = -20,   /* 过流（可恢复：限流重试） */
    WINK_ERR_OVERTEMPERATURE    = -21,   /* 过温（可恢复：降频） */
    WINK_ERR_WATCHDOG           = -30,   /* 看门狗超时（致命：复位） */
    WINK_ERR_OVERFLOW           = -40,   /* 数值溢出 / 计算 UB（致命） */

    /* 可恢复降级 (ADR-0005)：系统已安全降级、应继续运行（非 halt） */
    WINK_ERR_CONFIG_CORRUPT_DEGRADED = -50,   /* NVS/配置损坏 → 用安全默认值继续 */
    WINK_ERR_FAILED_INIT             = -51,   /* 器件 init 失败 → 器件隔离，系统继续 */

    WINK_ERR_PANIC              = -99,   /* 不可恢复，需 halt */
} wink_status_t;

/** @brief 判定状态是否为错误 (status < 0)；对 -50s 降级状态同样正确捕获 */
static inline int wink_status_is_error(wink_status_t s) {
    return s < 0;
}

#ifdef __cplusplus
}
#endif

#endif /* WINK_STATUS_H */
```

- [ ] **Step 2: 把 `wink_status.h` 纳入 PAL 工程可见性**

Modify `wink-micro-os/pal/CMakeLists.txt`，在 `target_sources` 列表追加 `include/wink_status.h`：

```cmake
# PAL (Platform Abstraction Layer) Component CMake
add_library(pal STATIC)

# 暴露包含路径给其他组件使用
target_include_directories(pal PUBLIC include)

# 声明 PAL 层需要导出的头文件（主要为底层实现做桩）
target_sources(pal PRIVATE
    include/pal_hal.h
    include/pal_osal.h
    include/wink_status.h
)
```

- [ ] **Step 3: 验证头文件可被 DAL 层 include（冒烟编译）**

Run（host 配置，不定义 SIMULATION）:
```bash
cd wink-micro-os
cmake -B build-test -DTARGET_PLATFORM=host -DCMAKE_C_COMPILER=gcc
cmake --build build-test --target pal
```
Expected: PAL 静态库构建成功，无 "wink_status.h not found" 错误。
> 注：若环境无 `TARGET_PLATFORM=host` 分支，本步骤可合并到 Task 2 完成后统一验证（host test 配置在 Task 2 引入）。

- [ ] **Step 4: Commit**

```bash
git add wink-micro-os/pal/include/wink_status.h wink-micro-os/pal/CMakeLists.txt
git commit -m "Add wink_status.h (SSOT from 02-error-fault-model) + warn_unused_result macro (ADR-0001)"
```

---

### Task 2: 搭建 wink-micro-os host 单元测试基础设施

**Files:**
- Create: `wink-micro-os/test/unity/unity.c`、`unity.h`、`unity_internals.h`（vendor from chigo-micro）
- Create: `wink-micro-os/test/pal_host_stub.h`、`pal_host_stub.c`
- Create: `wink-micro-os/test/CMakeLists.txt`
- Modify: `wink-micro-os/CMakeLists.txt`（加 test 子目录）
- Create: `wink-micro-os/test/test_smoke.c`（验证 Unity 跑通）

**Interfaces:**
- Produces: host 测试构建能力（`cmake --build` + `ctest`）；`pal_host_stub` 提供协作式虚拟时间（`sim_set_echo_timing` / `sim_last_pwm_duty`）供 Task 5/6/7 消费。
- Consumes: PAL/DAL 接口（链接 `pal`、`dal` 库）。

- [ ] **Step 1: vendor Unity 框架**

Run（PowerShell）:
```powershell
# chigo-micro 为外部对照仓库（已迁出本仓库，见 MEMORY），用绝对路径 vendor，勿在本仓库内相对引用
$src = "D:\workspaces\ai-coding\chigo\chigo-micro\project\embedded\sim\test\unity"
$dst = "D:\workspaces\ai-coding\wink-ai\wink-ai-embedded\wink-micro-os\test\unity"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "$src\unity.c"            $dst
Copy-Item "$src\unity.h"            $dst
Copy-Item "$src\unity_internals.h"  $dst
```

- [ ] **Step 2: 写 host PAL 桩头文件 `pal_host_stub.h`**

```c
/**
 * @file pal_host_stub.h
 * @brief host (PC) 测试用 PAL 桩：协作式虚拟时间 + pwm 记录
 *        非 wasm / 非 esp32 target，仅在 test 构建中链接，提供 PAL 符号实现。
 */
#ifndef PAL_HOST_STUB_H
#define PAL_HOST_STUB_H

#include <stdint.h>

/* ---- 虚拟时间控制（供 ultrasonic 脉宽测量测试） ---- */
void sim_reset_time(void);
void sim_set_echo_pin(uint16_t pin);
/* 设定 echo 在 rise_us 时刻变高，持续 high_duration_us 后变低 */
void sim_set_echo_timing(uint64_t rise_us, uint64_t high_duration_us);

/* ---- pwm 记录（供 servo 测试） ---- */
float sim_last_pwm_duty(uint8_t channel);

#endif /* PAL_HOST_STUB_H */
```

- [ ] **Step 3: 写 host PAL 桩实现 `pal_host_stub.c`**

```c
/**
 * @file pal_host_stub.c
 * @brief host PAL 桩实现
 *
 * 设计要点（协作式时间推进）：
 *   ultrasonic 真机分支用 `while(!pal_gpio_read(echo)){...}` 空等 echo 变高，
 *   循环体内不调 delay，靠真实 CPU 时间推进。host 没有真实时间流逝，
 *   故让 `pal_gpio_read` 在被调用时把虚拟时间推进到下一个 echo 边沿，
 *   从而驱动 while 循环前进（读一次跳到 rise 返回 true，再读一次跳到 fall 返回 false）。
 *
 * ⚠️ 架构风险警告（Risk Warning）：
 *   本桩的虚拟时间协作推进强耦合了目前 DAL ultrasonic 驱动内部的 while 轮询结构。
 *   如果未来驱动改为中断驱动（ISR-driven）或非阻塞回调模式，此测试桩必须同步重构为事件驱动/中断触发模拟。
 */
#include "pal_host_stub.h"
#include "pal_hal.h"
#include "pal_osal.h"
#include <string.h>

#define PWM_CHANNELS 8

static uint64_t s_sim_time_us = 0;
static uint64_t s_echo_rise_us = 0;
static uint64_t s_echo_high_us = 0;
static uint16_t s_echo_pin = 0xFFFF;
static float s_pwm_duty[PWM_CHANNELS];

void sim_reset_time(void) {
    s_sim_time_us = 0;
    s_echo_rise_us = 0;
    s_echo_high_us = 0;
    s_echo_pin = 0xFFFF;
    memset(s_pwm_duty, 0, sizeof(s_pwm_duty));
}

void sim_set_echo_pin(uint16_t pin) { s_echo_pin = pin; }

void sim_set_echo_timing(uint64_t rise_us, uint64_t high_duration_us) {
    s_echo_rise_us = rise_us;
    s_echo_high_us = high_duration_us;
}

float sim_last_pwm_duty(uint8_t channel) {
    if (channel >= PWM_CHANNELS) return -1.0f;
    return s_pwm_duty[channel];
}

/* ---- PAL HAL 桩 ---- */
bool pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) {
    (void)pin; (void)mode; return true;
}
void pal_gpio_write(uint16_t pin, bool level) { (void)pin; (void)level; }

bool pal_gpio_read(uint16_t pin) {
    if (pin != s_echo_pin) return false;
    /* 协作式推进：把时间跳到下一个 echo 边沿 */
    if (s_sim_time_us < s_echo_rise_us) {
        s_sim_time_us = s_echo_rise_us;   /* 推进到变高时刻 */
        return true;                       /* echo 现在为高 */
    }
    if (s_sim_time_us < s_echo_rise_us + s_echo_high_us) {
        s_sim_time_us = s_echo_rise_us + s_echo_high_us;  /* 推进到变低时刻 */
        return false;                                      /* echo 现在为低 */
    }
    return false;
}

bool pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t t, pal_gpio_isr_t cb, void *a) {
    (void)pin; (void)t; (void)cb; (void)a; return true;
}
bool pal_gpio_disable_interrupt(uint16_t pin) { (void)pin; return true; }

bool pal_pwm_init(uint8_t channel, uint32_t freq) { (void)channel; (void)freq; return true; }
bool pal_pwm_set_duty(uint8_t channel, float duty) {
    if (channel >= PWM_CHANNELS) return false;
    s_pwm_duty[channel] = duty;
    return true;
}
bool pal_i2c_transfer(uint8_t port, uint16_t addr,
                      const uint8_t *w, uint32_t wl, uint8_t *r, uint32_t rl) {
    (void)port; (void)addr; (void)w; (void)wl; (void)r; (void)rl; return true;
}

/* ---- PAL OSAL 桩 ---- */
void pal_delay_ms(uint32_t ms) { s_sim_time_us += (uint64_t)ms * 1000; }
void pal_delay_us(uint32_t us) { s_sim_time_us += us; }
uint64_t pal_get_ms(void) { return s_sim_time_us / 1000; }
uint64_t pal_get_us(void) { return s_sim_time_us; }

/* pal_mutex_t 复用 pal_osal.h 的 typedef void*；不在此重复定义
 * （-Werror 下重复 typedef 为约束违反，GCC 严格模式 / MSVC 报错） */
pal_mutex_t pal_mutex_create(void) { return (pal_mutex_t)1; }
bool pal_mutex_lock(pal_mutex_t m, uint32_t to) { (void)m; (void)to; return true; }
bool pal_mutex_unlock(pal_mutex_t m) { (void)m; return true; }
void pal_mutex_destroy(pal_mutex_t m) { (void)m; }
```

- [ ] **Step 4: 写测试构建配置 `wink-micro-os/test/CMakeLists.txt`**

```cmake
# wink-micro-os host unit tests (PC gcc, no ESP-IDF, no Emscripten)
# 范式迁移自 chigo-micro/project/embedded/sim/test/CMakeLists.txt

set(UNITY_DIR ${CMAKE_CURRENT_SOURCE_DIR}/unity)
set(PAL_STUB  ${CMAKE_CURRENT_SOURCE_DIR}/pal_host_stub.c)
set(JS_SIM_STUB ${CMAKE_CURRENT_SOURCE_DIR}/js_sim_host_stub.c)

# DAL 源文件直接编进每个测试可执行（避免单独链接 dal 库）
set(DAL_SRCS
    ${CMAKE_CURRENT_SOURCE_DIR}/../dal/src/dal_ultrasonic.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../dal/src/dal_servo.c
)

# Unity 是 vendor 代码，豁免严格警告（vendor 的无害 warning 不应阻塞测试构建）
set_source_files_properties(${UNITY_DIR}/unity.c PROPERTIES COMPILE_FLAGS "-w")

# 通用：真机分支（#else）测试 —— 不定义 SIMULATION，PAL 符号来自 pal_host_stub.c
function(add_wink_test name src)
    add_executable(${name}
        ${src}
        ${UNITY_DIR}/unity.c
        ${PAL_STUB}
        ${DAL_SRCS}
        ${ARGN})
    target_include_directories(${name} PRIVATE
        ${UNITY_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/../dal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../pal/include
    )
    # 严格警告；桩允许未用参数
    target_compile_options(${name} PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
    add_test(NAME ${name} COMMAND ${name})
endfunction()

# 仿真分支（#ifdef SIMULATION）测试 —— 定义 SIMULATION=1，js_sim_* 符号来自 js_sim_host_stub.c。
# 用途：验证 ADR-0003 决策 2「换算/超时两端同源」在仿真侧确被走到（真机测试只覆盖 #else）。
# 链 PAL_STUB 是为 servo 等无 SIMULATION 分支的器件提供 PAL 符号占位。
function(add_wink_test_sim name src)
    add_executable(${name}
        ${src}
        ${UNITY_DIR}/unity.c
        ${JS_SIM_STUB}
        ${PAL_STUB}
        ${DAL_SRCS}
        ${ARGN})
    target_include_directories(${name} PRIVATE
        ${UNITY_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/../dal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../pal/include
    )
    target_compile_definitions(${name} PRIVATE SIMULATION=1)
    target_compile_options(${name} PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
    add_test(NAME ${name} COMMAND ${name})
endfunction()

add_wink_test(test_smoke test_smoke.c)

add_custom_target(check
    COMMAND ${CMAKE_CTEST_COMMAND} --output-on-failure
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
)
```

- [ ] **Step 5: 写冒烟测试 `wink-micro-os/test/test_smoke.c`**

```c
#include "unity.h"
#include "wink_status.h"

void setUp(void) {}
void tearDown(void) {}

void test_wink_status_is_error_negative(void) {
    TEST_ASSERT_TRUE(wink_status_is_error(WINK_ERR_INVALID_ARG));
    TEST_ASSERT_TRUE(wink_status_is_error(WINK_ERR_TIMEOUT));
}

void test_wink_status_ok_is_not_error(void) {
    TEST_ASSERT_FALSE(wink_status_is_error(WINK_OK));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_wink_status_is_error_negative);
    RUN_TEST(test_wink_ok_is_not_error);
    return UNITY_END();
}
```

- [ ] **Step 6: 在顶层 CMake 挂载 test（仅非 wasm）**

Modify `wink-micro-os/CMakeLists.txt`，在文件末尾追加：

```cmake
# ---- host 单元测试（非 wasm target 时启用）----
if(NOT TARGET_PLATFORM STREQUAL "wasm")
    enable_testing()
    add_subdirectory(test)
endif()
```

- [ ] **Step 7: 构建并运行测试，确认冒烟通过**

Run:
```bash
cd wink-micro-os
cmake -B build-test -DTARGET_PLATFORM=host
cmake --build build-test
cd build-test && ctest --output-on-failure
```
Expected: `test_smoke` PASS，2 个测试通过，Unity 输出 `OK`。

- [ ] **Step 8: Commit**

```bash
git add wink-micro-os/test wink-micro-os/CMakeLists.txt
git commit -m "Add host unit test infrastructure with Unity (PAL host stub)"
```

---

## Phase A — ADR-0003 决策 1：仿真可信度边界声明（纯文档，零依赖）

### Task 3: README + 01-overview 前置边界声明

**Files:**
- Modify: `docs/design/README.md`
- Modify: `docs/design/01-system-overall/01-system-overview.md`（§1 愿景段）

**Interfaces:** 无代码接口。产出对外承诺措辞收敛为"行为级高保真"。

- [ ] **Step 1: 在 `docs/design/README.md` 顶部（愿景之后）插入边界声明块**

插入文案（ADR-0003 决策 1 原文）：

```markdown
> **仿真可信度边界**
>
> Wink-AI 提供**行为级（causal）高保真仿真**：保证业务逻辑的**因果顺序与逻辑正确性**（状态机迁移、传感器语义值、执行器命令、异常处理路径），**不保证 cycle/tick 级时序保真**。
>
> ✅ 仿真**可**验证：业务状态机正确性、传感器语义值、执行器命令、I2C/UART payload 级协议交互、故障/超时/断线的异常处理路径。
>
> ❌ 仿真**不可**验证：实时时序（PID 周期精度、微秒级响应）、中断抢占与优先级嵌套、驱动协议的寄存器/CRC 正确性（DAL Bypass 路径）、模拟电路特性（ADC 量化、阻抗、电源完整性）。
>
> 时序与电气级验证仍需真机进行。详见 [ADR-0003](../../decisions/unisim/0003-simulation-fidelity-boundary.md)。
```

- [ ] **Step 2: 在 `01-system-overview.md §1` 愿景段同步加入同一声明**（文案同上，可压缩为一行 + 链接 ADR-0003）。

- [ ] **Step 3: Commit**

```bash
git add docs/design/README.md docs/design/01-system-overall/01-system-overview.md
git commit -m "Add simulation fidelity boundary disclaimer to README and overview (ADR-0003)"
```

### Task 4: 04-wasm-simulation/README 加"已知仿真限制"小节

**Files:**
- Modify: `docs/implementation-plans/scripts/README.md`

- [ ] **Step 1: 在 `04-wasm-simulation/README.md` 顶部加"已知仿真限制"小节**，列出 ADR-0003 决策 1 的 ❌ 清单（无虚拟时钟、中断协作式、DAL Bypass 切 #ifdef、多任务仿真缺位、电气特性不仿真），每条一行 + 指向 ADR-0003。

- [ ] **Step 2: Commit**

```bash
git add docs/implementation-plans/scripts/README.md
git commit -m "Document known simulation limits in wasm-sim README (ADR-0003)"
```

---

## Phase B — DAL 错误码与签名对齐（技术债）

### Task 5: `dal_ultrasonic` 签名对齐到 `wink_status_t`

**Files:**
- Modify: `wink-micro-os/dal/include/dal_ultrasonic.h`
- Modify: `wink-micro-os/dal/src/dal_ultrasonic.c`
- Create: `wink-micro-os/test/test_dal_ultrasonic.c`
- Modify: `wink-micro-os/test/CMakeLists.txt`

**Interfaces:**
- Consumes: `wink_status.h`（Task 1）、`pal_hal.h`/`pal_osal.h`、`pal_host_stub`（Task 2）。
- Produces: `wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm)` —— BAL/Codegen 与 Task 7 消费的新契约。**本任务暂保留旧整 bypass 形态**（仿真侧仍 `js_sim_get_ultrasonic_distance`），仅迁移错误码语义。

> 注：本任务完成后，仿真分支仍违反 c-code.md §2 lowest-layer 规则（整 bypass），Task 7 再收窄。两步分离保证每步可独立测试、可独立 commit。

- [ ] **Step 1: 写失败测试 `test_dal_ultrasonic.c`**

```c
#include "unity.h"
#include "wink_status.h"
#include "dal_ultrasonic.h"
#include "pal_host_stub.h"

void setUp(void) {
    sim_reset_time();
}
void tearDown(void) {}

void test_read_null_returns_invalid_arg(void) {
    wink_status_t s = dal_ultrasonic_read(NULL, (float[]){0});
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, s);
}

void test_read_null_out_returns_invalid_arg(void) {
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    wink_status_t s = dal_ultrasonic_read(&dev, NULL);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, s);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_read_null_returns_invalid_arg);
    RUN_TEST(test_read_null_out_returns_invalid_arg);
    return UNITY_END();
}
```

- [ ] **Step 2: 在 test CMake 注册该测试**

Modify `wink-micro-os/test/CMakeLists.txt`，在 `add_wink_test(test_smoke ...)` 后追加：
```cmake
add_wink_test(test_dal_ultrasonic test_dal_ultrasonic.c)
```

- [ ] **Step 3: 运行测试，确认失败（签名未改）**

Run:
```bash
cd wink-micro-os
cmake --build build-test
cd build-test && ctest -R test_dal_ultrasonic --output-on-failure
```
Expected: 编译失败 —— `dal_ultrasonic_read` 未定义（当前是 `dal_ultrasonic_get_distance`）。

- [ ] **Step 4: 改 `dal_ultrasonic.h` 签名并补齐接口契约**

```c
/**
 * @file dal_ultrasonic.h
 * @brief 逻辑器件层 - HC-SR04 超声波测距传感器驱动接口
 */
#ifndef DAL_ULTRASONIC_H
#define DAL_ULTRASONIC_H

#include <stdint.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint16_t trig_pin;
    uint16_t echo_pin;
    float last_distance;    ///< 最近一次测量的距离值 (单位: cm)
} dal_ultrasonic_t;

/**
 * @brief 获取当前障碍物物理距离 (厘米)
 *
 * @param dev 传感器实例句柄
 * @param distance_cm 输出距离值 (0.0 到 400.0cm)
 * @return wink_status_t 执行状态 (0 为成功，负数为具体错误码)
 *
 * @note API Contract (REF/static-dispatch/contracts.md):
 *   - Blocking: Yes (MAX 30ms timeout, relies on software polling loop)
 *   - Thread-safe: No (requires external mutex lock if accessed by multiple tasks)
 *   - ISR-safe: No (contains blocking delay/polling, must NOT be called from ISR)
 *   - Callback-context: N/A
 *   - Input-range:
 *       - dev: Not NULL, pins must be valid GPIOs.
 *       - distance_cm: Not NULL, memory must be pre-allocated.
 *   - Error-codes:
 *       - WINK_OK: Success.
 *       - WINK_ERR_INVALID_ARG: dev or distance_cm is NULL.
 *       - WINK_ERR_TIMEOUT: Sensor didn't echo within 30ms.
 *   - Preconditions:
 *       - Underlying GPIO pins must be initialized (currently done externally).
 *   - Postconditions:
 *       - dev->last_distance is updated with the returned distance_cm on WINK_OK.
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm);

#ifdef __cplusplus
}
#endif

#endif /* DAL_ULTRASONIC_H */
```

- [ ] **Step 5: 改 `dal_ultrasonic.c`（保整 bypass，仅迁移错误码）**

```c
#include "dal_ultrasonic.h"
#include "pal_hal.h"
#include "pal_osal.h"

#ifdef SIMULATION
/* --- Web 仿真直通旁路模式（旧整 bypass 形态，Task 7 将收窄）--- */
extern float js_sim_get_ultrasonic_distance(uint16_t trig_pin);

wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) return WINK_ERR_INVALID_ARG;
    dev->last_distance = js_sim_get_ultrasonic_distance(dev->trig_pin);
    *distance_cm = dev->last_distance;
    return WINK_OK;
}

#else
/* --- 真实芯片运行模式 --- */
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) return WINK_ERR_INVALID_ARG;

    /* 1. Trig 引脚拉高，保持至少 10us */
    pal_gpio_write(dev->trig_pin, true);
    pal_delay_us(10);
    pal_gpio_write(dev->trig_pin, false);

    /* 2. 等待 Echo 变高 (30ms 超时保护) */
    uint64_t wait_start = pal_get_us();
    while (!pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - wait_start > 30000) return WINK_ERR_TIMEOUT;
    }

    /* 3. 测量 Echo 高电平脉宽 */
    uint64_t echo_start = pal_get_us();
    while (pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - echo_start > 30000) return WINK_ERR_TIMEOUT;
    }
    uint64_t pulse_duration_us = pal_get_us() - echo_start;

    /* 4. 换算为厘米 (Task 7 将提取为共享函数) */
    dev->last_distance = (float)pulse_duration_us * 0.017f;
    *distance_cm = dev->last_distance;
    return WINK_OK;
}
#endif
```

- [ ] **Step 6: 运行测试，确认通过**

Run:
```bash
cmake --build build-test
cd build-test && ctest -R test_dal_ultrasonic --output-on-failure
```
Expected: `test_dal_ultrasonic` PASS（2 测试通过）。

- [ ] **Step 7: Commit**

```bash
git add wink-micro-os/dal/include/dal_ultrasonic.h wink-micro-os/dal/src/dal_ultrasonic.c wink-micro-os/test/test_dal_ultrasonic.c wink-micro-os/test/CMakeLists.txt
git commit -m "Align dal_ultrasonic API to wink_status_t (ADR-0001)"
```

### Task 6: `dal_servo` 签名对齐到 `wink_status_t`

**Files:**
- Modify: `wink-micro-os/dal/include/dal_servo.h`
- Modify: `wink-micro-os/dal/src/dal_servo.c`
- Create: `wink-micro-os/test/test_dal_servo.c`
- Modify: `wink-micro-os/test/CMakeLists.txt`

**Interfaces:**
- Produces: `wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle)`；`WINK_ERR_IO` 表示底层 PAL 失败。

- [ ] **Step 1: 写失败测试 `test_dal_servo.c`**

```c
#include "unity.h"
#include "wink_status.h"
#include "dal_servo.h"
#include "pal_host_stub.h"

void setUp(void) { sim_reset_time(); }
void tearDown(void) {}

void test_set_angle_null_returns_invalid_arg(void) {
    wink_status_t s = dal_servo_set_angle(NULL, 90.0f);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, s);
}

void test_set_angle_90_maps_to_expected_duty(void) {
    dal_servo_t s = { .pwm_channel = 0, .current_angle = 0.0f,
                      .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    /* 90 度 -> 脉宽 (0.5 + 0.5*(2.5-0.5)) = 1.5ms -> 占空比 (1.5/20)*100 = 7.5% */
    wink_status_t st = dal_servo_set_angle(&s, 90.0f);
    TEST_ASSERT_EQUAL_INT(WINK_OK, st);
    TEST_ASSERT_EQUAL_FLOAT(7.5f, sim_last_pwm_duty(0));
    TEST_ASSERT_EQUAL_FLOAT(90.0f, s.current_angle);
}

void test_set_angle_clamps_overflow(void) {
    dal_servo_t s = { .pwm_channel = 1, .current_angle = 0.0f,
                      .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    /* 200 度被钳到 180 -> 脉宽 2.5ms -> 占空比 12.5% */
    dal_servo_set_angle(&s, 200.0f);
    TEST_ASSERT_EQUAL_FLOAT(12.5f, sim_last_pwm_duty(1));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_set_angle_null_returns_invalid_arg);
    RUN_TEST(test_set_angle_90_maps_to_expected_duty);
    RUN_TEST(test_set_angle_clamps_overflow);
    return UNITY_END();
}
```

- [ ] **Step 2: 注册测试**（追加到 `test/CMakeLists.txt`）
```cmake
add_wink_test(test_dal_servo test_dal_servo.c)
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `cmake --build build-test && cd build-test && ctest -R test_dal_servo --output-on-failure`
Expected: 编译失败 —— `bool` 与 `wink_status_t` 返回不匹配 / `WINK_OK` 未定义。

- [ ] **Step 4: 改 `dal_servo.h` 并补齐接口契约**

```c
#ifndef DAL_SERVO_H
#define DAL_SERVO_H

#include <stdint.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint8_t pwm_channel;
    float current_angle;
    float min_pulse_ms;
    float max_pulse_ms;
} dal_servo_t;

/**
 * @brief 设置舵机偏转角度
 *
 * @param dev 舵机实例句柄
 * @param angle 目标角度 (0.0 到 180.0 度，超出范围将被自动钳位)
 * @return wink_status_t 执行状态 (0 为成功，负数为具体错误码)
 *
 * @note API Contract (REF/static-dispatch/contracts.md):
 *   - Blocking: No
 *   - Thread-safe: No (requires external mutex lock if accessed by multiple tasks)
 *   - ISR-safe: No (contains pal_pwm_init/pal_pwm_set_duty calls, context dependent)
 *   - Callback-context: N/A
 *   - Input-range:
 *       - dev: Not NULL, min_pulse_ms/max_pulse_ms must be valid.
 *   - Error-codes:
 *       - WINK_OK: Success.
 *       - WINK_ERR_INVALID_ARG: dev is NULL.
 *       - WINK_ERR_IO: Underlying PAL PWM initialization or setting duty failed.
 *   - Postconditions:
 *       - dev->current_angle is updated with clamped target angle.
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle);

#ifdef __cplusplus
}
#endif

#endif /* DAL_SERVO_H */
```

- [ ] **Step 5: 改 `dal_servo.c`**

```c
#include "dal_servo.h"
#include "pal_hal.h"
#include "wink_status.h"

#define SERVO_PWM_FREQ_HZ   50   /* 50Hz -> 周期 20ms */

wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle) {
    if (dev == NULL) return WINK_ERR_INVALID_ARG;

    /* 钳位输入角度 */
    if (angle < 0.0f) angle = 0.0f;
    if (angle > 180.0f) angle = 180.0f;
    dev->current_angle = angle;

    /* 角度 -> 脉宽 (ms) */
    float pulse_width_ms = dev->min_pulse_ms +
        (angle / 180.0f) * (dev->max_pulse_ms - dev->min_pulse_ms);

    /* 脉宽 -> 20ms 周期下的占空比百分比 */
    float duty_percent = (pulse_width_ms / 20.0f) * 100.0f;

    if (!pal_pwm_init(dev->pwm_channel, SERVO_PWM_FREQ_HZ)) return WINK_ERR_IO;
    if (!pal_pwm_set_duty(dev->pwm_channel, duty_percent)) return WINK_ERR_IO;
    return WINK_OK;
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `cmake --build build-test && cd build-test && ctest -R test_dal_servo --output-on-failure`
Expected: `test_dal_servo` PASS（3 测试通过）。

- [ ] **Step 7: Commit**

```bash
git add wink-micro-os/dal/include/dal_servo.h wink-micro-os/dal/src/dal_servo.c wink-micro-os/test/test_dal_servo.c wink-micro-os/test/CMakeLists.txt
git commit -m "Align dal_servo API to wink_status_t (ADR-0001)"
```

---

## Phase C — ADR-0003 决策 2：bypass 收窄到最底层

### Task 7: ultrasonic 提取共享换算 + bypass 收窄（含 Registry 同步与仿真分支同源测试）

**Files:**
- Modify: `wink-micro-os/dal/src/dal_ultrasonic.c`
- Modify: `docs/design/07-platform-governance/01-device-model-registry.md`（bypassImports 同步，SSOT 先行）
- Create: `wink-micro-os/test/js_sim_host_stub.h`、`js_sim_host_stub.c`（仿真侧 js_sim 桩）
- Create: `wink-micro-os/test/test_dal_ultrasonic_sim.c`（-DSIMULATION=1 同源测试）
- Modify: `wink-micro-os/test/test_dal_ultrasonic.c`（加换算 + 真机脉宽测量 + 超时测试）
- Modify: `wink-micro-os/test/CMakeLists.txt`（注册 sim 测试，Task 2 已建 `add_wink_test_sim`）
- **不改**: `wink-micro-os/CMakeLists.txt` 的 `ASYNCIFY_IMPORTS`（移交 ADR-0002 spike，见 Step 9 说明）

**Interfaces:**
- Consumes: 新 JS 导入契约 `void js_sim_trigger_ultrasonic(uint16_t trig_pin)` + `uint32_t js_sim_measure_echo_pulse_us(uint16_t trig_pin)`，**签名以 Registry 为 SSOT**（Step 1 先登记，.c extern 抄它）。
- Produces: 符合 c-code.md §2 lowest-layer bypass 的 ultrasonic——换算/超时两端同源，仅 trigger 时序与 echo 脉宽测量在仿真侧旁路；并有两端同源回归测试守护。

> **SSOT 闭环（修正 P0-3）**：新 bypass 契约必须先在 Device Registry 登记，再让 `.c` 的 `extern` 抄 Registry 声明，杜绝 pitfalls.md 陷阱 3「`js_sim_*` 三处冲突」复发。仿真侧不再整函数 bypass 拿距离，而是 `js_sim_measure_echo_pulse_us` 取 echo 高电平脉宽（物理量来源），换算 `*0.017f` 与超时判定两端共享。

- [ ] **Step 1: 先更新 Device Registry 的 bypassImports（SSOT 先行）**

Modify `docs/design/07-platform-governance/01-device-model-registry.md` 的 HC-SR04 `simulation.bypassImports`，把旧的整 bypass 单条替换为两条最低层旁路：

```json
"simulation": {
  "supportedModes": ["dal-value-bypass", "pin-level"],
  "preferredMode": "dal-value-bypass",
  "bypassImports": [
    {
      "name": "js_sim_trigger_ultrasonic",
      "returnType": "void",
      "params": [{ "name": "trig_pin", "type": "uint16_t" }]
    },
    {
      "name": "js_sim_measure_echo_pulse_us",
      "returnType": "uint32_t",
      "params": [{ "name": "trig_pin", "type": "uint16_t" }]
    }
  ]
}
```

> **参数语义 / 技术债**：现状 `dal_ultrasonic_t` 只有 `trig_pin`（无 `component_id` 字段，device_tree 尚未 codegen 落地，见 pitfalls.md 陷阱 8），故 bypass 参数暂用 `trig_pin`。device_tree 落地引入 `component_id` 后，bypass 参数应迁移到 `component_id`（JS 侧 raycast 靠组件 ID 定位 3D 对象，靠 trig_pin 反查脆弱）——届时同步改 Registry + `.c` extern。本计划不扩大范围。

- [ ] **Step 2: 扩展真机分支失败测试（换算纯函数 + 真机脉宽测量 + 超时）**

在 `test_dal_ultrasonic.c` 追加：

```c
/* ---- 1. 共享换算纯函数 ---- */
extern float dal_pulse_us_to_cm(uint32_t pulse_us);

void test_pulse_to_cm_100cm(void) {
    /* 100cm -> 往返 200cm -> 200/0.034 us ≈ 5882us；0.017 * 5882 ≈ 100 */
    TEST_ASSERT_EQUAL_FLOAT(99.994f, dal_pulse_us_to_cm(5882));
}

/* ---- 2. 真机分支脉宽测量集成测（用 host 桩协作式时间）---- */
void test_read_real_measure_pulse(void) {
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    sim_set_echo_pin(5);
    sim_set_echo_timing(/*rise*/ 100, /*high_duration*/ 5882);  /* ≈100cm */
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 99.994f, dist);
}

/* ---- 3. 超时：echo 永不变高（rise 远超 30ms）---- */
void test_read_real_timeout_no_echo(void) {
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    sim_set_echo_pin(5);
    sim_set_echo_timing(/*rise*/ 100000, /*high*/ 1000);  /* rise > 30ms 上限 */
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_TIMEOUT, s);
}
```

并在 `main()` 注册这三个测试。

> 换算函数 `dal_pulse_us_to_cm` 声明为**非 static** 以便单测 `extern` 访问（见 Step 4）。这是 skill「例外机制」下的局部封装让步：换算是无副作用纯函数，暴露为模块内公共符号风险可控；替代方案（建独立编译 target 测 `static`）见 Self-Review 记录。**不要**再 `#include "../dal/src/dal_ultrasonic.c"`——test CMake 已把该 `.c` 编入测试可执行，重复 include 会多重定义。

- [ ] **Step 3: 运行真机测试，确认失败**

Run: `cmake --build build-test && cd build-test && ctest -R test_dal_ultrasonic --output-on-failure`
Expected: `dal_pulse_us_to_cm` 未定义 / 整 bypass 形态下 `test_read_real_*` 不走真机逻辑。

- [ ] **Step 4: 重写 `dal_ultrasonic.c`（提取共享换算 + 收窄 bypass；extern 抄 Registry）**

```c
#include "dal_ultrasonic.h"
#include "pal_hal.h"
#include "pal_osal.h"

#define ULTRASONIC_TIMEOUT_US  30000u   /* 30ms 超时保护 */
#define ULTRASONIC_CM_PER_US   0.017f   /* 声速换算系数 (340m/s, 往返折半) */

/* ---- 两端共享：脉宽(us) -> 距离(cm) ---- */
/* 非 static 以便单元测试访问（例外，见 Task 7 Step 2 备注） */
float dal_pulse_us_to_cm(uint32_t pulse_us) {
    return (float)pulse_us * ULTRASONIC_CM_PER_US;
}

#ifdef SIMULATION
/* --- 仿真模式：仅旁路底层物理量来源（trigger + echo 脉宽测量），
       换算与超时逻辑与真机同源 (ADR-0003 决策2 / c-code.md §2)。
       extern 签名抄 Device Registry (01-device-model-registry.md, Step 1 登记) --- */
extern void     js_sim_trigger_ultrasonic(uint16_t trig_pin);
extern uint32_t js_sim_measure_echo_pulse_us(uint16_t trig_pin);

wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) return WINK_ERR_INVALID_ARG;

    /* 1. trigger 时序旁路（真机侧为 GPIO 10us 脉冲） */
    js_sim_trigger_ultrasonic(dev->trig_pin);

    /* 2. echo 脉宽测量旁路（真机侧为 while 循环测高电平） */
    uint32_t pulse_us = js_sim_measure_echo_pulse_us(dev->trig_pin);
    if (pulse_us >= ULTRASONIC_TIMEOUT_US) return WINK_ERR_TIMEOUT;

    /* 3. 换算：两端同源 */
    dev->last_distance = dal_pulse_us_to_cm(pulse_us);
    *distance_cm = dev->last_distance;
    return WINK_OK;
}

#else
/* --- 真实芯片运行模式 --- */
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) return WINK_ERR_INVALID_ARG;

    /* 1. Trig 引脚拉高，保持至少 10us */
    pal_gpio_write(dev->trig_pin, true);
    pal_delay_us(10);
    pal_gpio_write(dev->trig_pin, false);

    /* 2. 等待 Echo 变高 (超时保护) */
    uint64_t wait_start = pal_get_us();
    while (!pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - wait_start > ULTRASONIC_TIMEOUT_US) return WINK_ERR_TIMEOUT;
    }

    /* 3. 测量 Echo 高电平脉宽 (超时保护) */
    uint64_t echo_start = pal_get_us();
    while (pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - echo_start > ULTRASONIC_TIMEOUT_US) return WINK_ERR_TIMEOUT;
    }
    uint32_t pulse_us = (uint32_t)(pal_get_us() - echo_start);

    /* 4. 换算：与仿真同源 */
    dev->last_distance = dal_pulse_us_to_cm(pulse_us);
    *distance_cm = dev->last_distance;
    return WINK_OK;
}
#endif
```

- [ ] **Step 5: 新增仿真侧 js_sim host 桩（供 -DSIMULATION 同源测试）**

Create `wink-micro-os/test/js_sim_host_stub.h`：

```c
/**
 * @file js_sim_host_stub.h
 * @brief 仿真分支（-DSIMULATION=1）host 测试用 js_sim_* 桩
 *        仅在 sim test 构建中链接，提供 Registry 登记的 js_sim_* 符号实现。
 */
#ifndef JS_SIM_HOST_STUB_H
#define JS_SIM_HOST_STUB_H

#include <stdint.h>

/* 设定下一次 js_sim_measure_echo_pulse_us 返回的脉宽（us） */
void sim_set_echo_pulse_us(uint32_t pulse_us);

#endif /* JS_SIM_HOST_STUB_H */
```

Create `wink-micro-os/test/js_sim_host_stub.c`：

```c
/**
 * @file js_sim_host_stub.c
 * @brief 仿真侧 js_sim_* 桩实现（签名抄 Device Registry）。
 *        用途：让 -DSIMULATION=1 的测试能验证「仿真分支同样走共享换算 dal_pulse_us_to_cm」，
 *        而非各自硬编码距离——这是 ADR-0003 决策 2 价值的回归守卫。
 */
#include "js_sim_host_stub.h"

static uint32_t s_injected_pulse_us = 0;

void sim_set_echo_pulse_us(uint32_t pulse_us) { s_injected_pulse_us = pulse_us; }

/* Registry: void js_sim_trigger_ultrasonic(uint16_t trig_pin) —— 时序旁路，host 下空操作 */
void js_sim_trigger_ultrasonic(uint16_t trig_pin) { (void)trig_pin; }

/* Registry: uint32_t js_sim_measure_echo_pulse_us(uint16_t trig_pin) —— 返回注入脉宽 */
uint32_t js_sim_measure_echo_pulse_us(uint16_t trig_pin) {
    (void)trig_pin;
    return s_injected_pulse_us;
}
```

- [ ] **Step 6: 新增仿真分支同源测试 `test_dal_ultrasonic_sim.c`**

Create `wink-micro-os/test/test_dal_ultrasonic_sim.c`（用 `add_wink_test_sim` 注册，编译时 `-DSIMULATION=1`，走 `#ifdef SIMULATION` 分支）：

```c
/* 核心：证明仿真分支同样调用 dal_pulse_us_to_cm，输出 == 真机分支对同一脉宽的换算。
 * 这是 ADR-0003 决策 2「两端同源」的回归守卫——host 真机测试只覆盖 #else。 */
#include "unity.h"
#include "wink_status.h"
#include "dal_ultrasonic.h"
#include "js_sim_host_stub.h"

extern float dal_pulse_us_to_cm(uint32_t pulse_us);

void setUp(void) { sim_set_echo_pulse_us(0); }
void tearDown(void) {}

void test_sim_read_uses_shared_conversion(void) {
    /* 注入 5882us 脉宽，仿真分支应经 dal_pulse_us_to_cm 换算得 ≈99.994cm */
    sim_set_echo_pulse_us(5882);
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
    /* 与真机分支 test_read_real_measure_pulse 同一脉宽 → 同一距离（两端同源铁证） */
    TEST_ASSERT_EQUAL_FLOAT(dal_pulse_us_to_cm(5882), dist);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 99.994f, dist);
}

void test_sim_read_timeout_when_pulse_exceeds_limit(void) {
    sim_set_echo_pulse_us(31000);  /* ≥ ULTRASONIC_TIMEOUT_US */
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_TIMEOUT, s);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_sim_read_uses_shared_conversion);
    RUN_TEST(test_sim_read_timeout_when_pulse_exceeds_limit);
    return UNITY_END();
}
```

- [ ] **Step 7: 在 test CMake 注册 sim 测试**

Modify `wink-micro-os/test/CMakeLists.txt`，在 `add_wink_test(test_dal_servo ...)` 后追加：

```cmake
add_wink_test_sim(test_dal_ultrasonic_sim test_dal_ultrasonic_sim.c)
```

- [ ] **Step 8: 运行全部测试，确认通过（含 sim 同源测试）**

Run: `cmake --build build-test && cd build-test && ctest --output-on-failure`
Expected: 全部 PASS（test_smoke + test_dal_ultrasonic[5] + test_dal_servo[3] + test_dal_ultrasonic_sim[2]）。

- [ ] **Step 9: ASYNCIFY_IMPORTS 处置说明（本 Task 不改 CMake，移交 spike）**

**不改** `wink-micro-os/CMakeLists.txt` 的 `ASYNCIFY_IMPORTS`。理由：

1. Global Constraints Out-of-Scope ③ 已声明「顶层 CMake `ASYNCIFY_IMPORTS` 配置疑点移交 ADR-0002 spike」——本 Task 忠实执行该边界，不做半改。
2. `ASYNCIFY_IMPORTS` 是 Emscripten 的 Asyncify 栈快照提示，**不影响符号链接**（符号解析靠 JS 侧 import 实现）。列与不列只影响 Asyncify 栈预算，不决定 wasm 能否构建。
3. 新符号 `js_sim_trigger_ultrasonic`/`js_sim_measure_echo_pulse_us` 的 JS 侧实现不在本计划交付范围；它们是否需 ASYNCIFY（取决于 JS 实现是否 yield）须由 ADR-0002 spike 项 2 测定后再核定。

> 残留状态：Task 7 后，wasm target 的 `ASYNCIFY_IMPORTS` 仍列旧值 `js_sim_get_ultrasonic_distance`（代码已不引用，Emscripten 不因列了未用符号报错）。完整 wasm 链通依赖 JS 侧实现 + spike，非本计划阻塞项。

- [ ] **Step 10: wasm 双 target 可编译性（标注待 spike，非本计划完成判据）**

> **本计划内无法通过**：Task 7 的 JS 侧实现（`js_sim_measure_echo_pulse_us` 等）未交付，即便本机有 emcc，`emcmake` 链接必报 `Imported function not defined`。此步仅作「ADR-0002 spike 项 1/2 完成后的回归项」记录，**不阻塞本 Task 完成**。本 Task 以 host 全测试通过（Step 8，含 sim 同源）为完成判据。

- [ ] **Step 11: Commit**

```bash
git add wink-micro-os/dal/src/dal_ultrasonic.c \
        wink-micro-os/test/js_sim_host_stub.h wink-micro-os/test/js_sim_host_stub.c \
        wink-micro-os/test/test_dal_ultrasonic.c wink-micro-os/test/test_dal_ultrasonic_sim.c \
        wink-micro-os/test/CMakeLists.txt \
        docs/design/07-platform-governance/01-device-model-registry.md
git commit -m "Narrow ultrasonic bypass to lowest layer, share pulse-to-cm, sync Registry (ADR-0003)"
```

---

## Phase D — 回写与 ADR 协同

### Task 8: ADR-0003 状态推进 + 设计文档回写 + ADR-0002 依赖复核

**Files:**
- Modify: `docs/decisions/unisim/0003-simulation-fidelity-boundary.md`
- Modify: `docs/design/02-wink-micro-os/01-dal-device-abstraction.md`（§4.1 bypass 示例更新为新形态）
- Modify: `docs/design/02-wink-micro-os/README.md`（若引用 bypass 形态）
- Modify: `docs/design/07-platform-governance/02-error-fault-model.md`（§2 注明枚举已落地于 `pal/include/wink_status.h`，闭合 SSOT）
- Review（不改）: `docs/decisions/unisim/0002-dual-target-compilation.md`（项 4 前置依赖已标注）
- Review（不改）: `docs/design/07-platform-governance/01-device-model-registry.md`（已在 Task 7 Step 1 同步，本 Task 复核 bypassImports 与 `.c` extern 一致）

**Interfaces:** 无代码。产出文档与代码一致。

- [ ] **Step 1: 更新 ADR-0003 状态日志**（底部追加）：
```markdown
- 2026-06-23：决策 1（边界声明）落地 README/01-overview/04-wasm-sim；决策 2（bypass 收窄）落地 dal_ultrasonic.c，换算逻辑两端同源。决策 3 仍为 Phase 1+ 路标。
```
状态由 Proposed 推进为 **决策 1/2 Accepted、决策 3 仍 Proposed**（在状态行注明"分决策状态"）。

- [ ] **Step 2: 回写 `01-dal-device-abstraction.md §4.1`**：把 `dal_ultrasonic.c` 示例从"整 bypass（js_sim_get_ultrasonic_distance）"更新为 Task 7 的新形态（js_sim_trigger + js_sim_measure_echo_pulse_us + 共享换算），并标注"符合 c-code.md §2 lowest-layer bypass"。

- [ ] **Step 2b: 闭合错误码 SSOT**：在 `07-platform-governance/02-error-fault-model.md §2` 代码块上方加一行注明"枚举落地于 `wink-micro-os/pal/include/wink_status.h`，两处须同步"，避免 §2 代码块与 `wink_status.h` 漂移（Task 1 已让头文件逐字抄 §2）。

- [ ] **Step 3: 复核 ADR-0002 项 4 前置依赖**：确认 `0002` 中"测重构后的新 bypass 形态（基于 ADR-0003 决策2）"与 Task 7 产出一致，无需再改 0002。

- [ ] **Step 3b: 复核 Device Registry 一致性**：确认 `01-device-model-registry.md` 的 HC-SR04 `bypassImports`（Task 7 Step 1 已改）与 `dal_ultrasonic.c` 的 `extern` 签名逐字一致（参数名/类型/返回类型），无第三处漂移。

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/unisim/0003-simulation-fidelity-boundary.md \
        docs/design/02-wink-micro-os/01-dal-device-abstraction.md \
        docs/design/02-wink-micro-os/README.md \
        docs/design/07-platform-governance/02-error-fault-model.md
git commit -m "Backport ADR-0003 decisions 1/2 to design specs, close error-code SSOT loop"
```

---

## Phase E — ADR-0003 决策 3：路标（不展开，Phase 1+）

决策 3（虚拟时钟 + OSAL 多任务仿真）是系统级工程，明确后置于 MVP 闭环跑通后。本计划仅记录借鉴资产与方向，**不展开 bite-sized 步骤**（届时另写独立计划）。

**借鉴资产（外部对照仓库 chigo-micro 已有，绝对路径 `D:\workspaces\ai-coding\chigo\chigo-micro`，见 MEMORY）**：
- `chigo-micro/project/embedded/sim/freertos_sim.c` —— 用 `static uint32_t s_virtual_tick_ms` + `sim_tick_set_ms()`/`xTaskGetTickCount()` 实现**虚拟时钟**。这正是 ADR-0003 决策 3 虚拟时钟的现成范式：把 `pal_get_ms/pal_get_us` 接到虚拟时钟（而非墙钟 `js_pal_get_ms`），让 `js_pal_delay_ms` 推进逻辑时间。
- `chigo-micro/project/embedded/sim/` 的 `freertos_sim.c`（信号量 pthread 实现）、`esp_timer_sim.c`、`platform_sim.c` —— PC native 的 FreeRTOS shim 全套，可作为多任务仿真建模参考。
- **迁移注意**：chigo-micro 的 sim 是 PC native（pthread 多线程），**不可直接用于 wasm 单线程**。wasm 多任务须走协程化（Asyncify 协作式），pthread 语义不适用。虚拟时钟部分（单变量 + getter）可直接迁移；任务/信号量部分需重新设计为协作式。

**前置依赖**：决策 3 的多任务可行性受 ADR-0002 spike 项 6（多任务边界探测）结论约束——若 spike 结论为"MVP 须收敛单任务"，则决策 3 的多任务仿真推迟到单任务 MVP 跑通后再评估。

---

## Self-Review

**1. Spec coverage（对照 ADR-0003 三决策 + 技术债）**：
- 决策 1（边界声明）→ Task 3、4 ✅
- 决策 2（bypass 收窄）→ Task 7 ✅（换算共享、仿真侧只取脉宽）
- 决策 3（虚拟时钟+多任务）→ Phase E 路标（明确后置，不展开）✅ 符合"MVP 后"定位
- 技术债：`wink_status.h` 缺失 → Task 1 ✅；dal_ultrasonic 签名 → Task 5 ✅；dal_servo 签名 → Task 6 ✅
- 与 ADR-0002 spike 协同 → Task 8 Step 3 复核 + 各 Task 标注 ✅

**2. Placeholder scan**：无 TBD/TODO；每个代码步骤含完整代码；commit message 完整；测试含断言预期值（7.5%、99.994cm 等）。✅

**3. Type/signature consistency**：
- `dal_ultrasonic_read(dal_ultrasonic_t*, float*)` 在 Task 5 定义、Task 7 保持签名不变（只改实现体）✅
- `dal_pulse_us_to_cm(uint32_t) -> float` 在 Task 7 Step 4 定义、Step 2 真机测试 extern 声明一致 ✅
- `js_sim_measure_echo_pulse_us` / `js_sim_trigger_ultrasonic` 在 Device Registry（Step 1）、`.c` extern（Step 4）、host 桩（Step 5）三处签名一致 ✅；ASYNCIFY_IMPORTS 本计划不改（见 Step 9）
- `sim_set_echo_timing(rise, duration)` 在 Task 2 桩定义、Task 7 Step 2 真机测试调用签名一致 ✅

**4. 已知风险**：
- Task 2 host 桩的"协作式时间推进"耦合 ultrasonic 真机分支的 while 循环模式——若未来该循环结构大改，桩需同步调整（已在 `pal_host_stub.c` 注释说明）。缓解：Task 7 新增的 sim 同源测试（-DSIMULATION）走 js_sim 桩、独立于该耦合，核心的"换算同源"始终有回归保护。
- Task 7 不改 `ASYNCIFY_IMPORTS`（与 Out-of-Scope ③ 一致），完整 wasm 链通依赖 JS 侧实现 + ADR-0002 spike 项 1/2；残留旧值 `js_sim_get_ultrasonic_distance` 无害（见 Step 9）。
- HAL 层 `bool` 返回未对齐（Out-of-Scope），dal_servo 已用 `WINK_ERR_IO` 翻译 PAL 的 bool 失败。

**5. SSOT 对齐核查（评审新增维度）**：
- `wink_status.h` 枚举逐字等于 `02-error-fault-model.md §2`（含 ADR-0001 方案 C + ADR-0005 `-50s` 段），`WINK_ERR_IO=-5` ✅；含 `WINK_WARN_UNUSED_RESULT` 宏 ✅。
- DAL 两个公共 API 声明加 `WINK_WARN_UNUSED_RESULT` ✅。
- `js_sim_trigger_ultrasonic`/`js_sim_measure_echo_pulse_us` 在 Device Registry（Task 7 Step 1）、`.c` extern（Step 4）、host 桩（Step 5）三处签名一致，无第四处漂移 ✅。
- 仿真分支经 `test_dal_ultrasonic_sim`（-DSIMULATION=1）验证同样走 `dal_pulse_us_to_cm`，两端同源有回归守卫 ✅。
- chigo-micro vendor 路径用已迁出的绝对路径（`D:\workspaces\ai-coding\chigo\…`），非本仓库相对路径 ✅。

---

## 附录 A：评审修正记录（2026-06-23 架构评审）

本计划经 `embedded-best-practice` skill 架构评审后修正以下项：

**P0 阻断（已修正）**：
- Task 1：`wink_status.h` 错误码改为逐字抄 `02-error-fault-model.md §2`（修正 `WINK_ERR_IO` -4→-5 等数值/命名漂移；补 `-50s` 降级段）；补 `WINK_WARN_UNUSED_RESULT` 宏。
- Task 5/6：DAL 声明加 `WINK_WARN_UNUSED_RESULT` 前缀，并补齐了 Doxygen/YAML API 契约块注释。
- Task 7：新 bypass 契约先回写 Device Registry（`bypassImports`），`.c` extern 抄 Registry，杜绝 `js_sim_*` 三处冲突复发。
- Task 2 Step 1：Unity vendor 源路径改为已迁出的 `D:\workspaces\ai-coding\chigo\chigo-micro\…` + 显式 mkdir。

**P1 重要（已修正）**：
- Task 7：新增 `-DSIMULATION=1` 同源测试（`test_dal_ultrasonic_sim` + `js_sim_host_stub`），守护「仿真分支同样走共享换算」——ADR-0003 决策 2 的核心收益。
- Task 2 Step 3：在 host PAL 桩的协作式时间逻辑处，追加了“强耦合 while 轮询结构”的架构风险与警告注释。
- Task 2 Step 3：删除 `pal_host_stub.c` 重复 `typedef pal_mutex_t`（-Werror 下报错）。
- Task 2 Step 4：Unity vendor 代码豁免 `-Werror`（`-w`），避免 vendor 无害 warning 阻塞构建。
- Task 7：不改 `ASYNCIFY_IMPORTS`（与 Global Constraints Out-of-Scope ③ 一致，移交 ADR-0002 spike）；wasm 验证标注为「待 JS 实现 + spike」，不作为本计划完成判据。

**P2 遗留技术债（本计划不展开，记录备查）**：
- `dal_pulse_us_to_cm` 为单测可见声明为非 static（封装让步，例外已文档化）；未来可建独立编译 target 测 static 以恢复封装。
- `dal_ultrasonic_t.last_distance` / `dal_servo_t.current_angle` 仍为扁平字段，未做 `lifecycle.md §2` config/state 分离、未加 §6 `health` 字段（skill README 已标为待迁移形态）。本计划未触及，留作后续独立任务。
- bypass 参数暂用 `trig_pin`；device_tree codegen 落地引入 `component_id` 后应迁移（见 Task 7 Step 1 技术债说明）。
- `pal/CMakeLists.txt` 把 `wink_status.h` 列入 `target_sources PRIVATE` 无编译作用（头不入编译），实际可见性靠 `target_include_directories(PUBLIC include)`；冗余但无害，保留以利 IDE 索引。
- Self-Review 原第 3 项只验代码内部签名一致，未覆盖与 Registry / 02-error-fault-model / ADR 的 SSOT 对齐——本次修正已补齐该维度（见 Self-Review 第 5 项）。

---

## 附录 B：后续计划与待办事项 (TodoList)

以下架构建议与任务超出本次 ADR-0003 实施范围，已建档登记，待下一阶段（如 BAL 骨架搭建或设备树 Codegen 落地时）分步执行：

- [ ] **Task T1: BAL 层极简集成测试**
  - **内容**：在 `wink-micro-os/test/` 下创建 `test_bal_smoke.c`，编写一个极简的应用层逻辑（如读取超声波测距，若距离变小则设定舵机偏转），并在 host 桩上运行测试。
  - **目的**：验证 `PAL -> DAL -> BAL` 的三层联动与生命周期初始化闭环。

- [ ] **Task T2: PAL 层 API 返回值类型统一**
  - **内容**：将 `pal_hal.h` 中诸如 `pal_gpio_init`, `pal_pwm_set_duty` 等接口的 `bool` 返回值统一迁移到 `wink_status_t`。
  - **目的**：消除 DAL 层将 bool 强行翻译为 `WINK_ERR_IO` 的临时封装，实现端到端的错误码可回溯性。

- [ ] **Task T3: 设备树 Codegen 静态适配**
  - **内容**：当 `device_tree` codegen 脚本编写完成时，确保其自动生成的结构体（含引脚、配置）能无缝输入给已修改签名的 `dal_ultrasonic_t` 和 `dal_servo_t`，避免接口重新漂移。


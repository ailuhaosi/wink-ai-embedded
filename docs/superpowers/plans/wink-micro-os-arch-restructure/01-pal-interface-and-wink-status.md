# Plan 1 — PAL 改 INTERFACE 库 + wink_status.h + pal.h 聚合头

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `pal/` 从 STATIC 库重构为 **INTERFACE 库**（纯契约、无 `.c`），落地 `wink_status.h` 统一错误码与 `WINK_WARN_UNUSED_RESULT` 宏，新增 `pal.h` 聚合头，并搭起 host 冒烟测试基础设施，为后续 Plan 2~4 提供"可编译的 PAL 契约面"。

**Architecture:** A* 架构的 §4/§5：PAL 是最底层 INTERFACE 契约库（只有头、无符号），实现全部下沉到 `targets/<platform>/`。本计划先把 PAL 库类型切到 INTERFACE、把错误码头落地（SSOT←`07-platform-governance/02-error-fault-model.md §2`），并引入 Unity 测试骨架验证"PAL 契约面可被 include + DAL 可链"。wink_status.h 作为跨全层基础类型，物理放 `pal/include/` 但属公共面（§6 例外）。

**Tech Stack:** C99 · CMake ≥3.15 · Unity 单元测试框架（vendor from chigo-micro） · host gcc 编译。

## Global Constraints

- 见系列 [00-README.md 全局约束](./00-README.md)。
- 本计划**不改** `pal_hal.h`/`pal_osal.h` 的 API 签名（HAL 返回值仍 `bool`，全量迁 `wink_status_t` 是后续独立任务，见 ADR-0003 计划附录 B Task T2）。
- 本计划**不实现**任何 PAL 函数体——PAL 是 INTERFACE，实现归 `targets/`（Plan 3）。本计划只保证"契约面可 include、DAL 可链"。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `wink-micro-os/pal/include/wink_status.h` | Create | 统一 `wink_status_t` 枚举 + 错误码（逐字源出 `02-error-fault-model.md §2`）+ `WINK_WARN_UNUSED_RESULT` 便携宏 + `wink_status_is_error()` |
| `wink-micro-os/pal/include/pal.h` | Create | 聚合头（include pal_hal + pal_osal + wink_status） |
| `wink-micro-os/pal/CMakeLists.txt` | Modify | STATIC → INTERFACE 库；`target_sources` 删（INTERFACE 无源）；include 用 `PUBLIC` 传递 |
| `wink-micro-os/test/unity/unity.{c,h}` + `unity_internals.h` | Create (vendor) | 从 chigo-micro 拷贝 |
| `wink-micro-os/test/test_smoke.c` | Create | 冒烟测试：验证 `wink_status_is_error` 语义 |
| `wink-micro-os/test/CMakeLists.txt` | Create | host test 构建配置（占位 `add_wink_test`，Plan 4 扩展 sim 变体） |
| `wink-micro-os/CMakeLists.txt` | Modify | 非 wasm 时 `add_subdirectory(test)` + `enable_testing()` |

---

## Task 1: 创建 `wink_status.h` 与 `pal.h` 聚合头

**Files:**
- Create: `wink-micro-os/pal/include/wink_status.h`
- Create: `wink-micro-os/pal/include/pal.h`

**Interfaces:**
- Produces: `wink_status_t`（enum）、完整错误码（ADR-0001 方案 C + ADR-0005 `-50s` 降级段）、`WINK_WARN_UNUSED_RESULT` 宏、`wink_status_is_error()`。后续所有计划消费此类型。
- Produces: `pal.h`（聚合头，供 `#include "pal.h"` 一次拉全 PAL 契约 + 状态码）。

- [ ] **Step 1: 写 `wink_status.h`**

```c
/**
 * @file wink_status.h
 * @brief 统一状态返回类型与错误码
 *
 * ⚠ SSOT 闭环：本头是 docs/design/07-platform-governance/02-error-fault-model.md §2
 *    的落地物。错误码取值、命名、码段分区必须与该规范逐字一致；任何变更先改
 *    02-error-fault-model.md，再同步本头（避免第三处漂移）。
 *    约定：0 = WINK_OK，负数 = 错误；判定用 if (status < 0)，禁 if (status)。
 */
#ifndef WINK_STATUS_H
#define WINK_STATUS_H

#ifdef __cplusplus
extern "C" {
#endif

/* 便携「返回值不可忽略」宏（c-code.md；禁裸写 __attribute__）。
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

- [ ] **Step 2: 写 `pal.h` 聚合头**

```c
/**
 * @file pal.h
 * @brief PAL 聚合头 —— 一次 include 拉全 PAL 契约面（HAL + OSAL + 状态码）。
 *        内核内部组件（dal/runtime/trace/targets）可 #include "pal.h"；
 *        App/BAL 禁用本头（见 03-directory-architecture.md §6 App/BAL 禁入规则），
 *        它们只应 include wink_status.h（基础类型例外）。
 */
#ifndef PAL_H
#define PAL_H

#include "wink_status.h"
#include "pal_hal.h"
#include "pal_osal.h"

#endif /* PAL_H */
```

- [ ] **Step 3: Commit**

```bash
git add wink-micro-os/pal/include/wink_status.h wink-micro-os/pal/include/pal.h
git commit -m "Add wink_status.h (SSOT from 02-error-fault-model) and pal.h aggregator (ADR-0001)"
```

---

## Task 2: 搭建 host 单元测试基础设施（Unity vendor + 冒烟测试）

**Files:**
- Create: `wink-micro-os/test/unity/unity.c`、`unity.h`、`unity_internals.h`（vendor from chigo-micro）
- Create: `wink-micro-os/test/test_smoke.c`
- Create: `wink-micro-os/test/CMakeLists.txt`
- Modify: `wink-micro-os/CMakeLists.txt`（挂载 test 子目录）

**Interfaces:**
- Produces: host 测试构建能力（`cmake --build` + `ctest`）；`add_wink_test(name src)` 便利函数（Plan 4 扩展 `add_wink_test_sim`）。后续计划的 `test_*.c` 都经此函数注册。
- Consumes: PAL include 面（`wink_status.h`）。

> 注：本计划 host 测试只 link `pal`（INTERFACE，仅头）+ Unity；尚无 DAL/runtime/targets 实现，故 `add_wink_test` 此版只编译测试自身 + Unity。

- [ ] **Step 1: vendor Unity 框架**

Run（PowerShell）:
```powershell
$src = "D:\workspaces\ai-coding\chigo\chigo-micro\project\embedded\sim\test\unity"
$dst = "D:\workspaces\ai-coding\wink-ai\wink-ai-embedded\wink-micro-os\test\unity"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "$src\unity.c"            $dst
Copy-Item "$src\unity.h"            $dst
Copy-Item "$src\unity_internals.h"  $dst
```

- [ ] **Step 2: 写测试构建配置 `wink-micro-os/test/CMakeLists.txt`**

```cmake
# wink-micro-os host unit tests (PC gcc, no ESP-IDF, no Emscripten)
# 范式迁移自 chigo-micro/project/embedded/sim/test/CMakeLists.txt

set(UNITY_DIR ${CMAKE_CURRENT_SOURCE_DIR}/unity)

# Unity 是 vendor 代码，豁免严格警告（vendor 的无害 warning 不应阻塞测试构建）
set_source_files_properties(${UNITY_DIR}/unity.c PROPERTIES COMPILE_FLAGS "-w")

# 通用 host 测试：仅链 pal(INTERFACE,仅头) + Unity。
# Plan 3 起会在此扩展链接 targets/host；Plan 4 扩展 add_wink_test_sim。
function(add_wink_test name src)
    add_executable(${name}
        ${src}
        ${UNITY_DIR}/unity.c
        ${ARGN})
    target_include_directories(${name} PRIVATE
        ${UNITY_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/../pal/include)
    target_link_libraries(${name} PRIVATE pal)
    target_compile_options(${name} PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
    add_test(NAME ${name} COMMAND ${name})
endfunction()

add_wink_test(test_smoke test_smoke.c)

add_custom_target(check
    COMMAND ${CMAKE_CTEST_COMMAND} --output-on-failure
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
)
```

- [ ] **Step 3: 写冒烟测试 `wink-micro-os/test/test_smoke.c`**

```c
#include "unity.h"
#include "wink_status.h"

void setUp(void) {}
void tearDown(void) {}

void test_wink_status_is_error_negative(void) {
    TEST_ASSERT_TRUE(wink_status_is_error(WINK_ERR_INVALID_ARG));
    TEST_ASSERT_TRUE(wink_status_is_error(WINK_ERR_TIMEOUT));
    TEST_ASSERT_TRUE(wink_status_is_error(WINK_ERR_CONFIG_CORRUPT_DEGRADED));  /* -50s 降级也算错误 */
}

void test_wink_status_ok_is_not_error(void) {
    TEST_ASSERT_FALSE(wink_status_is_error(WINK_OK));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_wink_status_is_error_negative);
    RUN_TEST(test_wink_status_ok_is_not_error);
    return UNITY_END();
}
```

- [ ] **Step 4: 在顶层 CMake 挂载 test（仅非 wasm）**

Modify `wink-micro-os/CMakeLists.txt`，在文件**末尾**追加（不要动现有的 `add_subdirectory(pal)` / `add_subdirectory(dal)` / wasm 可执行段）：

```cmake
# ---- host 单元测试（非 wasm target 时启用）----
if(NOT TARGET_PLATFORM STREQUAL "wasm")
    enable_testing()
    add_subdirectory(test)
endif()
```

- [ ] **Step 5: Commit**

```bash
git add wink-micro-os/test wink-micro-os/CMakeLists.txt
git commit -m "Add host unit test infrastructure with Unity (smoke test)"
```

---

## Task 3: `pal/` 改 INTERFACE 库

**Files:**
- Modify: `wink-micro-os/pal/CMakeLists.txt`（STATIC → INTERFACE）
- Modify: `wink-micro-os/dal/CMakeLists.txt`（确认 link pal 仍可用——INTERFACE 传递 include）

**Interfaces:**
- Consumes: Task 1 的 `wink_status.h`、`pal.h`。
- Produces: `pal` 成为 INTERFACE 库（`target_include_directories(PUBLIC include)`），所有链 `pal` 的组件（dal/test/future runtime）自动拿到 include 路径。`pal_*` 实现符号不再由 `pal` 库提供（归 targets/，Plan 3），对 STATIC 库链接无影响（符号留待终链解析）。

> **为什么 INTERFACE**：PAL 是纯契约（§4/§5）。STATIC 库 + `target_sources(头)` 在头文件上无编译作用（ADR-0003 计划附录 P2 已标"冗余但无害"）。改 INTERFACE 后语义自洽、且为云端预编译（`libdal.a` 不再拖一个空 `libpal.a`）铺路。

- [ ] **Step 1: 改 `pal/CMakeLists.txt` 为 INTERFACE**

全文替换 `wink-micro-os/pal/CMakeLists.txt`：

```cmake
# PAL (Platform Abstraction Layer) —— 纯契约 INTERFACE 库（无 .c，无符号）。
# 实现全部下沉到 targets/<platform>/（见 03-directory-architecture.md §4/§5）。
add_library(pal INTERFACE)

# 暴露 PAL 契约面（pal.h / pal_hal.h / pal_osal.h / wink_status.h）给所有链 pal 的组件。
target_include_directories(pal INTERFACE include)
```

- [ ] **Step 2: 复核 `dal/CMakeLists.txt` 无需改**

`wink-micro-os/dal/CMakeLists.txt` 现有 `target_link_libraries(dal PUBLIC pal)` —— 链一个 INTERFACE 库是合法且惯用的（`dal` 自动继承 `pal` 的 `INTERFACE include`）。**本步不改 dal**，仅人工确认。

- [ ] **Step 3: 构建冒烟测试，验证 PAL INTERFACE 库 + wink_status 可用**

Run（host，从 `wink-micro-os/` 目录）:
```bash
cmake -B build-test -DTARGET_PLATFORM=host
cmake --build build-test
cd build-test && ctest --output-on-failure
```
Expected: `test_smoke` PASS（2 测试通过），Unity 输出 `OK`；构建期无 `pal` STATIC 相关错误，无 `wink_status.h not found`。

> 注：`TARGET_PLATFORM=host` 当前在顶层 CMake 走"非 wasm"分支（Task 2 Step 4 的 `if(NOT TARGET_PLATFORM STREQUAL "wasm")`），挂载 test。DAL 在本步不参与 host 构建编译（dal 源会因缺 pal_* 实现链接失败）——本步只验 PAL 接口库 + smoke 测试，DAL 编译验证在 Plan 3 引入 targets/host 后。

- [ ] **Step 4: Commit**

```bash
git add wink-micro-os/pal/CMakeLists.txt
git commit -m "Refactor pal to INTERFACE contract library (A* §4/§5)"
```

---

## Self-Review

**1. Spec coverage（对照 03-directory-architecture.md）**：
- §4 `pal/include/wink_status.h`、`pal.h` → Task 1 ✅
- §4/§5 `pal` = INTERFACE 库 → Task 3 ✅
- host 测试基础设施（test/ + unity + smoke）→ Task 2 ✅（为 Plan 2~4 铺路）
- §6 wink_status.h 公共例外 → Task 1 pal.h 注释 + Task 1 wink_status 无 PAL 依赖 ✅
- §6.1 约束2 trace 隔离：本计划无 trace，N/A
- §6.1 约束1 零动态分配：wink_status 无分配 ✅

**2. Placeholder scan**：无 TBD/TODO；wink_status.h 含完整枚举；smoke 含断言；CMake 含完整 add_wink_test ✅。

**3. Type/signature consistency**：
- `wink_status_is_error(wink_status_t) -> int` 在 Task 1 定义、Task 2 smoke 调用一致 ✅
- `wink_status_t` 枚举值与 ADR-0003 计划 Task 1（同源）逐字一致 ✅
- `add_wink_test(name src)` 签名 Plan 4 会扩展 `add_wink_test_sim`，不冲突 ✅
- `pal` INTERFACE 后 `dal PUBLIC pal` 仍有效（CMake INTERFACE 传递）✅

**4. 已知风险**：
- Task 3 Step 3 host 构建不编译 DAL（缺 pal_* 实现）——故意收窄，DAL 编译验证留给 Plan 3 引入 targets/host。smoke 测试只链 pal(INTERFACE,仅头)，无 pal_* 符号需求，故可独立通过。
- `pal.h` 聚合头内部 `#include "pal_hal.h"` 拉入 `bool` 返回签名（HAL 仍 bool）——与本计划"不改 HAL 签名"边界一致；HAL 迁 wink_status_t 是后续独立任务。

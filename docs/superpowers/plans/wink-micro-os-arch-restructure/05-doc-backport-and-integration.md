# Plan 5 — doc 回写 + 集成接线 + 端到端验证

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 闭合 A* 架构的 SSOT 文档环（README/02-pal/01-overview 回写 + 新增 04-runtime-and-trace.md），落地 App 注入接口（`WINK_APP_DIR`）与示例 App（`samples/avoidance_car`），把 wasm/host entry 接到 runtime 主循环，并用一个 host 端到端测试验证 PAL→DAL→runtime→App 全链路（等价 ADR-0003 计划附录 B Task T1）。最后核对目录树与设计文档逐字一致。

**Architecture:** 落地 03-directory-architecture.md §6.1 约束3（WINK_APP_DIR 注入）+ §7（entry→runtime 接线）+ §10（SSOT 回写）。Plan 3 留的 `wasm_entry.c::main` 的 `TODO(Plan 5)` 在此闭合。示例 App 用**回调注入**模型：App 提供 `app_init/loop/on_fault` + `wink_app_get_callbacks()` 工厂，entry 取回调结构体后调 `wink_runtime_run`。

**Tech Stack:** C99 · CMake ≥3.15 · Unity · host gcc。

## Global Constraints

- 见系列 [00-README.md 全局约束](./00-README.md)。
- **样本范围**：示例 App 只用**现存** DAL 驱动（ultrasonic + servo）。`dal_led` 尚未实现（不在本系列范围），故样本不引 LED。
- **依赖前置**：Plan 1~4 全部完成。
- **零分配**（§6.1 约束1）：device_tree 实例为全局静态；App 状态静态。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `docs/design/02-wink-micro-os/README.md` | Modify | 分层图加 runtime/trace；文档列表加 03/04 链接 |
| `docs/design/02-wink-micro-os/02-pal-platform-abstraction.md` | Modify | §4.3 注明 pal 为 INTERFACE、实现居 targets |
| `docs/design/01-system-overall/01-system-overview.md` | Modify | §3 内核内部补 runtime/trace 层 |
| `docs/design/02-wink-micro-os/04-runtime-and-trace.md` | Create | runtime 生命周期 + trace 契约规范（§7 详述落文档） |
| `wink-micro-os/CMakeLists.txt` | Modify | `WINK_APP_DIR` 注入接口；host 默认样本 |
| `wink-micro-os/targets/wasm/wasm_entry.c` | Modify | main 接 runtime（闭合 Plan 3 TODO） |
| `wink-micro-os/samples/avoidance_car/device_tree.h` | Create | front_radar / neck_servo 声明 |
| `wink-micro-os/samples/avoidance_car/device_tree.c` | Create | 实例静态分配 |
| `wink-micro-os/samples/avoidance_car/app_main.c` | Create | app_init/loop/on_fault + `wink_app_get_callbacks()` |
| `wink-micro-os/samples/avoidance_car/CMakeLists.txt` | Create | 样本构建（host 端到端测试可执行） |
| `wink-micro-os/test/test_app_e2e.c` | Create | PAL→DAL→runtime→App 端到端集成测 |

---

## Task 1: 设计文档回写（README / 02-pal / 01-overview）

**Files:**
- Modify: `docs/design/02-wink-micro-os/README.md`
- Modify: `docs/design/02-wink-micro-os/02-pal-platform-abstraction.md`
- Modify: `docs/design/01-system-overall/01-system-overview.md`

**Interfaces:** 无代码。遵循 docs-adr.md §2 决策回写。

- [ ] **Step 1: 改 `02-wink-micro-os/README.md` 分层图与文档列表**

把"📐 分层与数据透传设计"的 ASCII 图（现 BAL/DAL/PAL 三层）更新为五层（含 runtime + trace），并在"📂 模块设计文档"列表追加：

```markdown
*   **[03-directory-architecture.md](../../../design/02-wink-micro-os/03-directory-architecture.md) - 内核目录架构设计（A*）**
    *   Ports & Adapters 内核骨架（pal INTERFACE / dal / runtime / trace 一等 peer / targets），公共 API 面与 BAL 禁入规则，CMake 库依赖图。
*   **[04-runtime-and-trace.md](../../../design/02-wink-micro-os/04-runtime-and-trace.md) - 运行时生命周期与 Golden Trace 契约**
    *   回调注入主循环（`wink_app_callbacks_t`）、tick 调度、fault 上报 trace、target entry 接线流程。
```

并把分层图改为（在 BAL 与 DAL 之间标注 runtime/trace 为内核 peer）：

```text
       [ App (AI 生成) / BAL (独立仓) ]
                   │ (调器件语义 API / 注册回调)
                   ▼
     ┌───────────────────────────────┐
     │  runtime (主循环) + trace ◄── peer 一等层
     └───────────────┬───────────────┘
                   │ (调 DAL)
                   ▼
     ┌───────────────────────────────┐
     │     器件抽象层 (DAL)           │ ◄── SIMULATION 旁路直通 ──► [ Web 虚拟外设 UI ]
     └───────────────┬───────────────┘
                   │ (调总线与 OS API)
                   ▼
     ┌───────────────────────────────┐
     │     平台抽象层 (PAL)           │   ← INTERFACE 契约
     └───────┬───────────────┬───────┘
             ▼               ▼ (静态编译路由)
         [ ESP32 ]        [ Wasm 仿真 ]   (targets/ = 适配器端口)
```

- [ ] **Step 2: 改 `02-pal-platform-abstraction.md` §4.3**

在"4.3 WebAssembly 仿真端"小节末尾（或 §4 末）追加一段：

```markdown
> **库类型注（A* §4/§5）**：`pal/` 是 **INTERFACE 契约库**（仅头、无 `.c`、无符号）。所有 PAL 实现下沉到 `targets/<platform>/`（wasm/esp32/host）。host 升格为一等 target，供 host 端 PAL→DAL→runtime→App 全链路测试。详见 [03-directory-architecture.md](../../../design/02-wink-micro-os/03-directory-architecture.md)。
```

- [ ] **Step 3: 改 `01-system-overview.md` §3 职责表**

在 §3 分层职责表的 PAL 行后追加 runtime/trace 行（内核内部 peer）：

```markdown
| runtime | 协作式主循环、App 生命周期调度（回调注入） | `wink_runtime_run`、`wink_app_callbacks_t` | 平台适配者/应用开发者 |
| trace | Golden Trace 故障/事件记录（横切基础服务） | `wink_trace_fault` | 测试工程师 |
```

- [ ] **Step 4: Commit**

```bash
git add docs/design/02-wink-micro-os/README.md docs/design/02-wink-micro-os/02-pal-platform-abstraction.md docs/design/01-system-overall/01-system-overview.md
git commit -m "Backport A* layers (runtime/trace) to design specs (docs-adr §2)"
```

---

## Task 2: 新增 `04-runtime-and-trace.md`

**Files:**
- Create: `docs/design/02-wink-micro-os/04-runtime-and-trace.md`

- [ ] **Step 1: 写文档**

```markdown
# 3.4 运行时生命周期与 Golden Trace 契约

本文件落地 [03-directory-architecture.md](../../../design/02-wink-micro-os/03-directory-architecture.md) §7：runtime 与 trace 两层 peer 的 API 契约、回调注入模型与 target entry 接线流程。

## 1. runtime：回调注入主循环

### 1.1 设计动机
`main()` 与 OS 主循环历史上埋在 `targets/wasm/pal_hal_wasm.c`，无统一归宿。A* 把它提炼为 target-agnostic 的 `runtime` 层，各 target 的 `*_entry.c` 只负责"启动 runtime"。

### 1.2 回调注入（无 extern app_*）
App 经 `wink_app_callbacks_t` 注册生命周期钩子，runtime 库**不持有**对外部 `app_*` 符号的强 `extern`，达成二进制级解耦（便于单测/Mock）。

\`\`\`c
typedef struct {
    void (*init)(void);
    void (*loop)(void);
    void (*on_fault)(uint32_t fault_code);
} wink_app_callbacks_t;

void wink_app_delay_ms(uint32_t ms);
wink_status_t wink_runtime_run(const wink_app_callbacks_t *callbacks, uint32_t max_ticks);
\`\`\`

- `init`/`loop`/`on_fault` 均允许 NULL（runtime 跳过）。
- `max_ticks`：host/测试传有限值避免 `while(1)`；真机/wasm 传 `0` 表示无限循环。

### 1.3 接线流程
\`\`\`
wasm_entry.c::main() / esp32_entry.c::app_main() / host 样例 main()
        │  实例化 wink_app_callbacks_t（来自 App 的 wink_app_get_callbacks()）
        └─► wink_runtime_run(&cb, 0/ N)
                   ├─ cb.init()  (一次)
                   └─ while(1){ cb.loop(); wink_app_delay_ms(TICK); }
\`\`\`

## 2. trace：Golden Trace 一等 peer

### 2.1 定位
独立顶层 peer（非 runtime 子特性，见 03-directory-architecture.md §3 Screaming Architecture）。横切基础服务，被 runtime/App 消费。

### 2.2 隔离契约（§6.1 约束2）
DAL/PAL 驱动**禁**直接调 `wink_trace_*`；只返 `wink_status_t`。故障捕获与 trace 记录收敛在 App 回调（`on_fault`）或 runtime。

### 2.3 API
\`\`\`c
#define WINK_TRACE_CAPACITY 32   /* 静态环形缓冲，零动态分配 */
void wink_trace_reset(void);
void wink_trace_fault(uint32_t fault_code);
uint32_t wink_trace_count(void);
uint32_t wink_trace_last(void);  /* 无记录返回 0 */
\`\`\`

## 3. 后置（roadmap）
- trace replay/compare/CI 回归（Golden Trace 对比真机）。
- runtime 多任务（ADR-0003 决策3 协程化调度），MVP 为单任务 while(1)。
```

- [ ] **Step 2: Commit**

```bash
git add docs/design/02-wink-micro-os/04-runtime-and-trace.md
git commit -m "Add 04-runtime-and-trace spec (lifecycle + trace contracts)"
```

---

## Task 3: 示例 App（avoidance_car）+ WINK_APP_DIR 注入

**Files:**
- Create: `wink-micro-os/samples/avoidance_car/device_tree.h`
- Create: `wink-micro-os/samples/avoidance_car/device_tree.c`
- Create: `wink-micro-os/samples/avoidance_car/app_main.c`
- Create: `wink-micro-os/samples/avoidance_car/CMakeLists.txt`
- Modify: `wink-micro-os/CMakeLists.txt`（WINK_APP_DIR）

**Interfaces:**
- Produces: `wink_app_get_callbacks(void) -> const wink_app_callbacks_t*`（App 工厂，供 entry 调用）；device_tree 实例 `front_radar`、`neck_servo`。

- [ ] **Step 1: 写 `samples/avoidance_car/device_tree.h`**

```c
/**
 * @file device_tree.h
 * @brief avoidance_car 示例 App 的设备树声明（codegen 产物占位；手动编写演示注入点）。
 */
#ifndef DEVICE_TREE_H
#define DEVICE_TREE_H

#include "dal_ultrasonic.h"
#include "dal_servo.h"

extern dal_ultrasonic_t front_radar;
extern dal_servo_t      neck_servo;

#endif /* DEVICE_TREE_H */
```

- [ ] **Step 2: 写 `samples/avoidance_car/device_tree.c`**

```c
/**
 * @file device_tree.c
 * @brief 设备实例静态分配（零动态分配，§6.1 约束1）。
 *        真实 codegen 会据画布连线生成；此处手动演示。
 */
#include "device_tree.h"

dal_ultrasonic_t front_radar = {
    .trig_pin = 4,
    .echo_pin = 5,
    .last_distance = 0.0f,
};

dal_servo_t neck_servo = {
    .pwm_channel = 0,
    .current_angle = 90.0f,
    .min_pulse_ms = 0.5f,
    .max_pulse_ms = 2.5f,
};
```

- [ ] **Step 3: 写 `samples/avoidance_car/app_main.c`**

```c
/**
 * @file app_main.c
 * @brief avoidance_car 业务逻辑 + 回调工厂。
 *        简化版（无 dal_led，仅 radar+servo）：雷达探测近障则扫舵机。
 */
#include "device_tree.h"
#include "wink_app.h"
#include "wink_trace.h"
#include "wink_status.h"

#define OBSTACLE_THRESHOLD_CM 20.0f
#define FAULT_FRONT_RADAR     7001u

static void app_init(void) {
    (void)dal_servo_set_angle(&neck_servo, 90.0f);
}

static void app_loop(void) {
    float distance = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&front_radar, &distance);
    if (wink_status_is_error(s)) {
        /* §6.1 约束2：DAL 只返错误码，fault 捕获+trace 在 App 回调内 */
        wink_trace_fault(FAULT_FRONT_RADAR);
        return;
    }
    if (distance > 0.0f && distance < OBSTACLE_THRESHOLD_CM) {
        (void)dal_servo_set_angle(&neck_servo, 180.0f);   /* 近障：扫舵机 */
    } else {
        (void)dal_servo_set_angle(&neck_servo, 90.0f);    /* 复位 */
    }
}

static void app_on_fault(uint32_t fault_code) {
    wink_trace_fault(fault_code);
    (void)dal_servo_set_angle(&neck_servo, 90.0f);   /* 安全位 */
}

const wink_app_callbacks_t *wink_app_get_callbacks(void) {
    static const wink_app_callbacks_t cb = { app_init, app_loop, app_on_fault };
    return &cb;
}
```

- [ ] **Step 4: 写 `samples/avoidance_car/CMakeLists.txt`**

```cmake
# avoidance_car 示例 App（注入点演示）。
# 默认 App（WINK_APP_DIR 未指定时）。
set(APP_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/device_tree.c
    ${CMAKE_CURRENT_SOURCE_DIR}/app_main.c)

# host 端到端测试可执行：runtime + trace + dal + targets/host + app
add_executable(app_avoidance_car_e2e
    ${APP_SOURCES}
    ${CMAKE_CURRENT_SOURCE_DIR}/../../runtime/src/wink_runtime.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../trace/src/wink_trace.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../dal/src/dal_ultrasonic.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../dal/src/dal_servo.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../test/test_app_e2e.c
    $<TARGET_OBJECTS:pal_host>)

target_include_directories(app_avoidance_car_e2e PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../../pal/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../../dal/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../../runtime/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../../trace/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../../test
    ${CMAKE_CURRENT_SOURCE_DIR}/../../test/stubs)

target_compile_options(app_avoidance_car_e2e PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
add_test(NAME app_avoidance_car_e2e COMMAND app_avoidance_car_e2e)
```

> 本 CMakeLists 在 host 构建时（Plan 由顶层 WINK_APP_DIR 路由）挂载。`wink_app_get_callbacks` 工厂符号由 app_main.c 提供；test_app_e2e.c 提供测试 main（见 Task 4）。

- [ ] **Step 5: 改顶层 CMake 引入 WINK_APP_DIR**

Modify `wink-micro-os/CMakeLists.txt`，在 host test 段内追加样本挂载（WINK_APP_DIR 注入）：

```cmake
if(NOT TARGET_PLATFORM STREQUAL "wasm")
    enable_testing()
    add_subdirectory(targets/host)

    # §6.1 约束3：标准 App 注入接口。未指定则默认 samples/avoidance_car。
    if(NOT DEFINED WINK_APP_DIR)
        set(WINK_APP_DIR ${CMAKE_CURRENT_SOURCE_DIR}/samples/avoidance_car)
    endif()
    message(STATUS "WINK_APP_DIR = ${WINK_APP_DIR}")
    add_subdirectory(${WINK_APP_DIR} ${CMAKE_BINARY_DIR}/app_build)

    add_subdirectory(test)
endif()
```

- [ ] **Step 6: Commit**

```bash
git add wink-micro-os/samples wink-micro-os/CMakeLists.txt
git commit -m "Add avoidance_car sample app + WINK_APP_DIR injection (§6.1 constraint 3)"
```

---

## Task 4: wasm/host entry 接 runtime + host 端到端测试

**Files:**
- Modify: `wink-micro-os/targets/wasm/wasm_entry.c`（闭合 Plan 3 TODO）
- Create: `wink-micro-os/test/test_app_e2e.c`

**Interfaces:**
- Consumes: Plan 2 `wink_runtime_run`；Task 3 `wink_app_get_callbacks`；Plan 3 `host_test_ctrl`（注入雷达障碍）；Plan 1 `wink_status_is_error`。

- [ ] **Step 1: 改 `targets/wasm/wasm_entry.c::main` 接 runtime**

把 Plan 3 Task 2 Step 3 的 `main`（含 TODO）替换为：

```c
#include "wink_app.h"
#include "wink_runtime.h"

/* App 工厂（由注入的 App 提供，wasm 构建链接 samples 或用户 App） */
extern const wink_app_callbacks_t *wink_app_get_callbacks(void);

int main(void) {
    const wink_app_callbacks_t *cb = wink_app_get_callbacks();
    wink_runtime_run(cb, 0);   /* 0 = 无限循环（wasm 下由 Asyncify 让出） */
    return 0;
}
```

> `trigger_wasm_interrupt`（Plan 3 已实现）保持不变。wasm 完整链接待 ADR-0002 spike；本步保证符号接线正确。

- [ ] **Step 2: 写 host 端到端测试 `test/test_app_e2e.c`**

```c
/* PAL→DAL→runtime→App 端到端：注册样本回调 → 跑 N tick → 注入近障 → 验证舵机偏转 + trace。
 * 等价 ADR-0003 计划附录 B Task T1（BAL 三层联动）。
 * 注意：本测试不 link Unity（用断言宏自实现），作为 app_avoidance_car_e2e 的 main。 */
#include "wink_runtime.h"
#include "wink_trace.h"
#include "dal_servo.h"
#include "device_tree.h"
#include "host_test_ctrl.h"

extern const wink_app_callbacks_t *wink_app_get_callbacks(void);

/* targets/host 的 sim_* 经 host_test_ctrl；dal_ultrasonic 走真机分支需 echo 时序注入。
 * 为让 app_loop 的 radar 读到"近障"，注入一个近距 echo 脉宽。
 * 简化：直接经 sim_set_echo_timing 注入 ~588us(≈10cm) 脉宽。 */
#define E2E_PASS()      do { extern int puts(const char*); puts("E2E PASS"); return 0; } while(0)
#define E2E_FAIL(msg)   do { extern int puts(const char*); puts("E2E FAIL: " msg); return 1; } while(0)

int main(void) {
    sim_reset_time();
    wink_trace_reset();
    const wink_app_callbacks_t *cb = wink_app_get_callbacks();

    /* tick 1：无障碍（echo 远）→ 舵机应复位 90° */
    sim_set_echo_pin(front_radar.echo_pin);
    sim_set_echo_timing(100, 5882);   /* ≈100cm，无近障 */
    wink_runtime_run(cb, 1);
    if (neck_servo.current_angle != 90.0f) E2E_FAIL("servo not 90 when clear");

    /* tick 2：近障（echo ≈10cm = 588us）→ 舵机应扫到 180° */
    sim_set_echo_timing(100, 588);    /* ≈10cm < 20cm 阈值 */
    wink_runtime_run(cb, 1);
    if (neck_servo.current_angle != 180.0f) E2E_FAIL("servo not 180 on near obstacle");

    E2E_PASS();
}
```

> 此测试是 `app_avoidance_car_e2e` 可执行的 main（Task 3 CMake 已把它编入）。它不经 Unity（自实现 PASS/FAIL + return code），故 ctest 按退出码判定。

- [ ] **Step 3: 运行端到端测试**

Run:
```bash
cmake -B build-test -DTARGET_PLATFORM=host
cmake --build build-test
cd build-test && ctest -R app_avoidance_car_e2e --output-on-failure
```
Expected: `app_avoidance_car_e2e` PASS（输出 `E2E PASS`，退出码 0）。

- [ ] **Step 4: 全量回归（所有测试）**

Run:
```bash
cd build-test && ctest --output-on-failure
```
Expected: 全 PASS（test_smoke + test_trace + test_runtime + test_host_pal + test_dal_servo + test_dal_ultrasonic + test_dal_ultrasonic_sim + app_avoidance_car_e2e）。

- [ ] **Step 5: Commit**

```bash
git add wink-micro-os/targets/wasm/wasm_entry.c wink-micro-os/test/test_app_e2e.c
git commit -m "Wire wasm/host entry to runtime; add host e2e test (PAL->DAL->runtime->App)"
```

---

## Task 5: 目录树终验（与设计文档逐字核对）

**Files:** 无（纯验证 + 必要的小修）。

- [ ] **Step 1: 列出实际目录树**

Run（从 `wink-micro-os/`）:
```bash
find . -type f \( -name "*.c" -o -name "*.h" -o -name "CMakeLists.txt" \) | sort
```

- [ ] **Step 2: 对照 03-directory-architecture.md §4 目录树逐项核对**

预期文件清单（关键项）：
```
./CMakeLists.txt
./pal/CMakeLists.txt
./pal/include/{pal.h, wink_status.h, pal_hal.h, pal_osal.h}
./dal/CMakeLists.txt
./dal/include/{dal_ultrasonic.h, dal_servo.h}
./dal/src/{dal_ultrasonic.c, dal_servo.c}
./runtime/CMakeLists.txt
./runtime/include/{wink_app.h, wink_runtime.h}
./runtime/src/wink_runtime.c
./trace/CMakeLists.txt
./trace/include/wink_trace.h
./trace/src/wink_trace.c
./targets/wasm/{pal_hal_wasm.c, pal_osal_wasm.c, wasm_bridge.h, wasm_entry.c, CMakeLists.txt}
./targets/esp32/{pal_hal_esp32.c, pal_osal_esp32.c, esp32_entry.c, CMakeLists.txt}
./targets/host/{pal_hal_host.c, pal_osal_host.c, CMakeLists.txt}
./test/{CMakeLists.txt, test_smoke.c, test_trace.c, test_runtime.c, test_host_pal.c,
        test_dal_servo.c, test_dal_ultrasonic.c, test_dal_ultrasonic_sim.c, test_app_e2e.c}
./test/unity/{unity.c, unity.h, unity_internals.h}
./test/stubs/{host_test_ctrl.h, js_sim_host_stub.h, js_sim_host_stub.c}
./samples/avoidance_car/{device_tree.h, device_tree.c, app_main.c, CMakeLists.txt}
```

- [ ] **Step 3: 修正任何偏差并提交**

若有遗漏/多余文件，修正后：

```bash
git add -A
git commit -m "Verify A* directory tree matches 03-directory-architecture.md"
```

- [ ] **Step 4: 收尾——更新系列 README 完成状态**

Modify `docs/superpowers/plans/wink-micro-os-arch-restructure/00-README.md`，在依赖表上方加一行完成标记（执行后由执行者勾选）。无需 commit 单独（并入上步或留执行者）。

---

## Self-Review

**1. Spec coverage（对照 03-directory-architecture.md）**：
- §10 回写清单（README/02-pal/01-overview/04-runtime-and-trace）→ Task 1/2 ✅
- §6.1 约束3 WINK_APP_DIR 注入 → Task 3 ✅
- §7 entry→runtime 接线 → Task 4 ✅（闭合 Plan 3 wasm_entry TODO）
- §4 samples/avoidance_car → Task 3 ✅
- 端到端 PAL→DAL→runtime→App（ADR-0003 附录 B T1）→ Task 4 ✅
- 目录树与设计文档一致 → Task 5 ✅

**2. Placeholder scan**：无 TBD/TODO；app_main.c/device_tree/app_e2e 含完整代码与断言 ✅。

**3. Type/signature consistency（跨计划）**：
- `wink_app_get_callbacks(void) -> const wink_app_callbacks_t*`：app_main.c 定义、wasm_entry.c/test_app_e2e.c 调用一致 ✅
- `wink_runtime_run(const wink_app_callbacks_t*, uint32_t)`：Plan 2 定义、本计划 entry/e2e 调用一致 ✅
- `wink_app_callbacks_t {init,loop,on_fault}`：Plan 2 定义、app_main.c 填充一致 ✅
- device_tree 实例 `front_radar`/`neck_servo`：device_tree.h 声明、.c 定义、app_main.c/test_e2e 引用一致 ✅
- `sim_set_echo_pin`/`sim_set_echo_timing`：Plan 3 host_test_ctrl 提供、test_e2e 调用一致 ✅

**4. 已知风险**：
- `app_avoidance_car_e2e` 不用 Unity（自实现 PASS/FAIL），ctest 按退出码判定——与 Unity 测试不同范式，已在注释说明。如需统一，可后续包一层 Unity runner（YAGNI，当前端到端用退出码足够）。
- wasm 端 `wink_app_get_callbacks` 的 wasm 链接依赖 JS 侧 + ADR-0002 spike；本计划保证 C 符号接线，不保证完整 wasm 运行（与 Global Constraints 一致）。
- `01-system-overview §3` 加 runtime/trace 行是文档增量，不破坏既有 BAL/DAL/PAL 行语义。
- test_app_e2e 注入近障用 `sim_set_echo_timing(100, 588)`（≈10cm），依赖 dal_ultrasonic 真机分支 + targets/host 协作式时间（Plan 3/4 已验证）。

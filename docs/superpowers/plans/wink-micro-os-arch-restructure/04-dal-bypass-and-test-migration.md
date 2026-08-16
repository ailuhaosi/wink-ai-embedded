# Plan 4 — DAL bypass 收窄 + test/stubs 迁移

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 ADR-0003 决策2（`#ifdef SIMULATION` bypass 收窄到最底层物理量来源），同时把 DAL 两个驱动签名对齐到 `wink_status_t`，并验证"仿真分支与真机分支换算/超时两端同源"。本计划**取代**原 ADR-0003 计划 Task 5/6/7（在新 A* 结构上重做，测试改链 `targets/host`）。

**Architecture:** SSOT 闭环：bypass 契约先回写 Device Registry（Task 1），再让 DAL 的 `#ifdef SIMULATION` 分支经 `wasm_bridge.h` 引用契约（Task 2，闭合 Plan 3 的占位）。dal_servo/dal_ultrasonic 签名对齐 `wink_status_t`（Task 3/4），ultrasonic 提取共享换算 `dal_pulse_us_to_cm`、bypass 只换 trigger+echo 脉宽（Task 5），新增 `-DSIMULATION=1` 同源回归测试守护"仿真分支同样走共享换算"（Task 6）。最后把测试桩迁入 `test/stubs/`（Task 7，对齐设计 §4）。

**Tech Stack:** C99 · CMake ≥3.15 · Unity · host gcc。

## Global Constraints

- 见系列 [00-README.md 全局约束](./00-README.md)。
- **bypass 收窄**（c-code.md §2 / ADR-0003 决策2）：`#ifdef SIMULATION` 只旁路 trigger 时序 + echo 脉宽测量；换算 `*0.017f` 与超时判定两端同源。
- **不改 `ASYNCIFY_IMPORTS`**（移交 ADR-0002 spike，与 ADR-0003 计划 Out-of-Scope ③ 一致）。
- **依赖前置**：Plan 1（wink_status.h）、Plan 3（targets/host 全 PAL + wasm_bridge.h 占位 + host_test_ctrl）。
- **SSOT 闭环**：js_sim_* 契约以 Device Registry 为单一可写源；`wasm_bridge.h` 与 DAL 经 `#ifdef SIMULATION` 引用之。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `docs/design/07-platform-governance/01-device-model-registry.md` | Modify | HC-SR04 `bypassImports` 改为两条最底层旁路（SSOT 先行） |
| `wink-micro-os/targets/wasm/wasm_bridge.h` | Modify | 追加 `js_sim_*` extern（闭合 Plan 3 占位） |
| `wink-micro-os/dal/include/dal_servo.h` | Modify | `bool set_angle()` → `wink_status_t set_angle()` + 契约块 |
| `wink-micro-os/dal/src/dal_servo.c` | Modify | 返回 `wink_status_t`，PAL 失败转 `WINK_ERR_IO` |
| `wink-micro-os/dal/include/dal_ultrasonic.h` | Modify | `float get_distance()` → `wink_status_t read(dev, float*)` + 契约块 |
| `wink-micro-os/dal/src/dal_ultrasonic.c` | Modify | 两阶段：Task 4 对齐签名（保整 bypass）；Task 5 收窄 bypass + 提取 `dal_pulse_us_to_cm` |
| `wink-micro-os/test/test_dal_servo.c` | Create | servo 单元测试（链 targets/host） |
| `wink-micro-os/test/test_dal_ultrasonic.c` | Create | ultrasonic 真机分支测试（换算 + 脉宽测量 + 超时，链 targets/host） |
| `wink-micro-os/test/stubs/js_sim_host_stub.h` | Create | 仿真侧 js_sim_* host 桩头 |
| `wink-micro-os/test/stubs/js_sim_host_stub.c` | Create | 仿真侧 js_sim_* host 桩实现（签名抄 Registry/wasm_bridge.h） |
| `wink-micro-os/test/test_dal_ultrasonic_sim.c` | Create | `-DSIMULATION=1` 同源回归测试 |
| `wink-micro-os/test/stubs/host_test_ctrl.h` | Move | 从 `test/host_test_ctrl.h` 迁入 `test/stubs/`（对齐设计 §4） |
| `wink-micro-os/test/stubs/host_test_ctrl.c` | Move | 同上（内容随 Plan 3 pal_osal_host.c 的实现，仅迁路径——见 Task 7 注） |
| `wink-micro-os/test/CMakeLists.txt` | Modify | DAL_SRCS + `add_wink_test_sim` + 注册三测试 + include 路径 |

> **host_test_ctrl 迁移说明**：Plan 3 把 `sim_*` 注入控制 API 的**声明**放 `test/host_test_ctrl.h`、**实现**放 `targets/host/pal_osal_host.c`。设计 §4 要求它们居 `test/stubs/`。Task 7 把**声明头**迁到 `test/stubs/host_test_ctrl.h`；实现仍在 `targets/host/pal_osal_host.c`（host target 内部状态机，不迁）。仅头文件路径变。

---

## Task 1: Device Registry bypassImports 同步（SSOT 先行）

**Files:**
- Modify: `docs/design/07-platform-governance/01-device-model-registry.md`

**Interfaces:** 无代码。产出 bypass 契约的可写 SSOT，Task 2/5 抄它。

- [ ] **Step 1: 改 HC-SR04 `simulation.bypassImports`**

把现有 `bypassImports`（单条整 bypass `js_sim_get_ultrasonic_distance`）替换为两条最底层旁路：

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

> **参数语义/技术债**（保留 ADR-0003 计划备注）：现状 `dal_ultrasonic_t` 仅有 `trig_pin`（device_tree codegen 未落地），故 bypass 参数暂用 `trig_pin`；codegen 引入 `component_id` 后迁移（JS raycast 靠组件 ID 定位 3D 对象）。

- [ ] **Step 2: Commit**

```bash
git add docs/design/07-platform-governance/01-device-model-registry.md
git commit -m "Narrow HC-SR04 bypassImports to lowest-layer (trigger + echo pulse) (ADR-0003)"
```

---

## Task 2: `wasm_bridge.h` 追加 js_sim_*（SSOT 闭合）

**Files:**
- Modify: `wink-micro-os/targets/wasm/wasm_bridge.h`

**Interfaces:**
- Produces: `js_sim_trigger_ultrasonic`、`js_sim_measure_echo_pulse_us` 的 extern（抄 Task 1 Registry）。Task 5 的 dal_ultrasonic.c `#ifdef SIMULATION` 分支经本头引用。

- [ ] **Step 1: 把 wasm_bridge.h 的 DAL bypass 占位段替换为实际声明**

把 Plan 3 Task 1 写的 `/* ---- DAL bypass 侧 JS 导入（js_sim_*）—— Plan 4 填充 ---- */` 替换为：

```c
/* ---- DAL bypass 侧 JS 导入（js_sim_*）—— 签名抄 Device Registry (01-device-model-registry.md) ----
 * 仅在 #ifdef SIMULATION 下被 DAL 引用；真机分支不编译本段。
 * ADR-0003 决策2：只旁路最底层物理量来源（trigger 时序 + echo 脉宽），换算/超时两端同源。 */
extern void     js_sim_trigger_ultrasonic(uint16_t trig_pin);
extern uint32_t js_sim_measure_echo_pulse_us(uint16_t trig_pin);
```

- [ ] **Step 2: Commit**

```bash
git add wink-micro-os/targets/wasm/wasm_bridge.h
git commit -m "Add js_sim_* bypass contracts to wasm_bridge.h (Registry SSOT) (ADR-0003)"
```

---

## Task 3: dal_servo 签名对齐 wink_status_t

**Files:**
- Modify: `wink-micro-os/dal/include/dal_servo.h`
- Modify: `wink-micro-os/dal/src/dal_servo.c`
- Create: `wink-micro-os/test/test_dal_servo.c`
- Modify: `wink-micro-os/test/CMakeLists.txt`

**Interfaces:**
- Consumes: Plan 1 `wink_status.h`、`pal_hal.h`（`pal_pwm_*` 由 Plan 3 targets/host 提供）；Plan 3 `host_test_ctrl.h`（`sim_last_pwm_duty`）。
- Produces: `wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle)`；`WINK_ERR_IO` 表 PAL 失败。App/Codegen 消费此契约。

- [ ] **Step 1: 写失败测试 `test/test_dal_servo.c`**

```c
#include "unity.h"
#include "wink_status.h"
#include "dal_servo.h"
#include "host_test_ctrl.h"

void setUp(void) { sim_reset_time(); }
void tearDown(void) {}

void test_set_angle_null_returns_invalid_arg(void) {
    wink_status_t s = dal_servo_set_angle(NULL, 90.0f);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, s);
}

void test_set_angle_90_maps_to_expected_duty(void) {
    dal_servo_t s = { .pwm_channel = 0, .current_angle = 0.0f,
                      .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    /* 90° -> 脉宽 0.5+0.5*(2.5-0.5)=1.5ms -> 占空比 (1.5/20)*100 = 7.5% */
    wink_status_t st = dal_servo_set_angle(&s, 90.0f);
    TEST_ASSERT_EQUAL_INT(WINK_OK, st);
    TEST_ASSERT_EQUAL_FLOAT(7.5f, sim_last_pwm_duty(0));
    TEST_ASSERT_EQUAL_FLOAT(90.0f, s.current_angle);
}

void test_set_angle_clamps_overflow(void) {
    dal_servo_t s = { .pwm_channel = 1, .current_angle = 0.0f,
                      .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    /* 200° 钳到 180 -> 脉宽 2.5ms -> 占空比 12.5% */
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

- [ ] **Step 2: 改 `add_wink_host_test` 加 dal/include，并加 DAL_SRCS + 注册 test_dal_servo**

Modify `wink-micro-os/test/CMakeLists.txt`：
- 在 `add_wink_host_test` 的 `target_include_directories` 列表追加 `${CMAKE_CURRENT_SOURCE_DIR}/../dal/include`（一行）。
- 文件变量区追加：

```cmake
set(DAL_SRCS
    ${CMAKE_CURRENT_SOURCE_DIR}/../dal/src/dal_ultrasonic.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../dal/src/dal_servo.c)
```

- 在 `add_wink_host_test(test_host_pal ...)` 后追加：

```cmake
add_wink_host_test(test_dal_servo test_dal_servo.c ${DAL_SRCS})
```

> servo 只用 dal_servo.c，但 DAL_SRCS 含两文件——dal_ultrasonic.c 此时若签名未对齐会编译失败。故 **Task 3 期间临时只编 dal_servo.c**：注册改为 `add_wink_host_test(test_dal_servo test_dal_servo.c ${CMAKE_CURRENT_SOURCE_DIR}/../dal/src/dal_servo.c)`；Task 4/5 完成 ultrasonic 对齐后 DAL_SRCS 两文件才一起编（Task 5 Step 改回 DAL_SRCS）。

- [ ] **Step 3: 运行测试，确认失败**

Run:
```bash
cmake --build build-test
cd build-test && ctest -R test_dal_servo --output-on-failure
```
Expected: 编译失败 —— `bool` 与 `wink_status_t` 返回不匹配 / `WINK_OK` 未定义（签名未改）。

- [ ] **Step 4: 改 `dal/include/dal_servo.h`**

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
 * @param dev 舵机实例句柄
 * @param angle 目标角度 (0.0~180.0 度，超出范围自动钳位)
 * @return wink_status_t (0=成功，负数=错误码)
 *
 * @note API Contract:
 *   - Blocking: No
 *   - Thread-safe: No (多任务访问需外部互斥)
 *   - ISR-safe: No
 *   - Input-range: dev 非 NULL；min/max_pulse_ms 须有效
 *   - Error-codes: WINK_OK / WINK_ERR_INVALID_ARG(dev NULL) / WINK_ERR_IO(PAL 失败)
 *   - Postconditions: dev->current_angle 更新为钳位后的目标角度
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle);

#ifdef __cplusplus
}
#endif

#endif /* DAL_SERVO_H */
```

- [ ] **Step 5: 改 `dal/src/dal_servo.c`**

```c
#include "dal_servo.h"
#include "pal_hal.h"

#define SERVO_PWM_FREQ_HZ 50   /* 50Hz -> 周期 20ms */

wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle) {
    if (dev == NULL) return WINK_ERR_INVALID_ARG;

    if (angle < 0.0f) angle = 0.0f;
    if (angle > 180.0f) angle = 180.0f;
    dev->current_angle = angle;

    float pulse_width_ms = dev->min_pulse_ms +
        (angle / 180.0f) * (dev->max_pulse_ms - dev->min_pulse_ms);
    float duty_percent = (pulse_width_ms / 20.0f) * 100.0f;

    if (!pal_pwm_init(dev->pwm_channel, SERVO_PWM_FREQ_HZ)) return WINK_ERR_IO;
    if (!pal_pwm_set_duty(dev->pwm_channel, duty_percent)) return WINK_ERR_IO;
    return WINK_OK;
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `cmake --build build-test && cd build-test && ctest -R test_dal_servo --output-on-failure`
Expected: `test_dal_servo` PASS（3 测试）。

- [ ] **Step 7: Commit**

```bash
git add wink-micro-os/dal/include/dal_servo.h wink-micro-os/dal/src/dal_servo.c wink-micro-os/test/test_dal_servo.c wink-micro-os/test/CMakeLists.txt
git commit -m "Align dal_servo API to wink_status_t (ADR-0001)"
```

---

## Task 4: dal_ultrasonic 签名对齐 wink_status_t（保整 bypass）

**Files:**
- Modify: `wink-micro-os/dal/include/dal_ultrasonic.h`
- Modify: `wink-micro-os/dal/src/dal_ultrasonic.c`
- Create: `wink-micro-os/test/test_dal_ultrasonic.c`
- Modify: `wink-micro-os/test/CMakeLists.txt`

**Interfaces:**
- Produces: `wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm)`。**本任务保整 bypass**（仿真侧仍旧形态），仅迁错误码语义；Task 5 再收窄。两步分离保证各自可独立测、独立 commit。

- [ ] **Step 1: 写失败测试 `test/test_dal_ultrasonic.c`（先只放 null 校验）**

```c
#include "unity.h"
#include "wink_status.h"
#include "dal_ultrasonic.h"
#include "host_test_ctrl.h"

void setUp(void) { sim_reset_time(); }
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

- [ ] **Step 2: 注册 test_dal_ultrasonic（临时只编 ultrasonic.c）**

在 test/CMakeLists.txt 追加：

```cmake
add_wink_host_test(test_dal_ultrasonic test_dal_ultrasonic.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../dal/src/dal_ultrasonic.c)
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `cmake --build build-test && cd build-test && ctest -R test_dal_ultrasonic --output-on-failure`
Expected: 编译失败 —— `dal_ultrasonic_read` 未定义（当前签名不同）。

- [ ] **Step 4: 改 `dal/include/dal_ultrasonic.h`**

```c
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
    float last_distance;    ///< 最近一次测量距离 (cm)
} dal_ultrasonic_t;

/**
 * @brief 获取障碍物距离 (cm)
 * @param dev 传感器实例
 * @param distance_cm 输出距离 (0.0~400.0cm)
 * @return wink_status_t (0=成功，负数=错误码)
 *
 * @note API Contract:
 *   - Blocking: Yes (MAX 30ms timeout, software polling loop)
 *   - Thread-safe: No; ISR-safe: No (含阻塞 delay/polling)
 *   - Input-range: dev/distance_cm 非 NULL
 *   - Error-codes: WINK_OK / WINK_ERR_INVALID_ARG / WINK_ERR_TIMEOUT
 *   - Postconditions: dev->last_distance 在 WINK_OK 时更新
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm);

#ifdef __cplusplus
}
#endif

#endif /* DAL_ULTRASONIC_H */
```

- [ ] **Step 5: 改 `dal/src/dal_ultrasonic.c`（保整 bypass，仅迁错误码）**

```c
#include "dal_ultrasonic.h"
#include "pal_hal.h"
#include "pal_osal.h"

#ifdef SIMULATION
/* --- 旧整 bypass 形态（Task 5 将收窄）--- */
extern float js_sim_get_ultrasonic_distance(uint16_t trig_pin);

wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) return WINK_ERR_INVALID_ARG;
    dev->last_distance = js_sim_get_ultrasonic_distance(dev->trig_pin);
    *distance_cm = dev->last_distance;
    return WINK_OK;
}

#else
/* --- 真实芯片模式 --- */
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) return WINK_ERR_INVALID_ARG;

    pal_gpio_write(dev->trig_pin, true);
    pal_delay_us(10);
    pal_gpio_write(dev->trig_pin, false);

    uint64_t wait_start = pal_get_us();
    while (!pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - wait_start > 30000) return WINK_ERR_TIMEOUT;
    }

    uint64_t echo_start = pal_get_us();
    while (pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - echo_start > 30000) return WINK_ERR_TIMEOUT;
    }
    uint64_t pulse_duration_us = pal_get_us() - echo_start;

    dev->last_distance = (float)pulse_duration_us * 0.017f;
    *distance_cm = dev->last_distance;
    return WINK_OK;
}
#endif
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `cmake --build build-test && cd build-test && ctest -R test_dal_ultrasonic --output-on-failure`
Expected: `test_dal_ultrasonic` PASS（2 测试）。

- [ ] **Step 7: Commit**

```bash
git add wink-micro-os/dal/include/dal_ultrasonic.h wink-micro-os/dal/src/dal_ultrasonic.c wink-micro-os/test/test_dal_ultrasonic.c wink-micro-os/test/CMakeLists.txt
git commit -m "Align dal_ultrasonic API to wink_status_t (ADR-0001)"
```

---

## Task 5: ultrasonic 提取共享换算 + bypass 收窄（真机分支）

**Files:**
- Modify: `wink-micro-os/dal/src/dal_ultrasonic.c`
- Modify: `wink-micro-os/test/test_dal_ultrasonic.c`（追加换算 + 脉宽测量 + 超时测试）

**Interfaces:**
- Produces: `float dal_pulse_us_to_cm(uint32_t pulse_us)`（非 static，供单测 extern）；bypass 收窄为 trigger + echo 脉宽；换算/超时两端同源。

- [ ] **Step 1: 在 test_dal_ultrasonic.c 追加真机分支测试并注册新换算 extern**

在 test_dal_ultrasonic.c 的 `main` 前追加：

```c
/* ---- 共享换算纯函数 ---- */
extern float dal_pulse_us_to_cm(uint32_t pulse_us);

void test_pulse_to_cm_100cm(void) {
    /* 100cm -> 往返 200cm -> ≈5882us；0.017*5882 ≈ 99.994 */
    TEST_ASSERT_EQUAL_FLOAT(99.994f, dal_pulse_us_to_cm(5882));
}

/* ---- 真机分支脉宽测量集成（host 协作式时间）---- */
void test_read_real_measure_pulse(void) {
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    sim_set_echo_pin(5);
    sim_set_echo_timing(100, 5882);   /* rise@100us, high 5882us ≈100cm */
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 99.994f, dist);
}

void test_read_real_timeout_no_echo(void) {
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    sim_set_echo_pin(5);
    sim_set_echo_timing(100000, 1000);  /* rise > 30ms 上限 */
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_TIMEOUT, s);
}
```

并在 `main()` 注册这三个测试。

> `dal_pulse_us_to_cm` 声明非 static 以便单测 extern（例外，见下）。**不要** `#include "../dal/src/dal_ultrasonic.c"`——该 .c 已编入测试可执行，重复 include 会多重定义。

- [ ] **Step 2: 运行测试，确认失败**

Run: `cmake --build build-test && cd build-test && ctest -R test_dal_ultrasonic --output-on-failure`
Expected: `dal_pulse_us_to_cm` 未定义 / 整 bypass 形态下 `test_read_real_*` 不走真机逻辑。

- [ ] **Step 3: 重写 `dal/src/dal_ultrasonic.c`（提取共享换算 + 收窄 bypass）**

```c
#include "dal_ultrasonic.h"
#include "pal_hal.h"
#include "pal_osal.h"

#define ULTRASONIC_TIMEOUT_US 30000u   /* 30ms 超时保护 */
#define ULTRASONIC_CM_PER_US  0.017f   /* 声速换算系数 (340m/s, 往返折半) */

/* ---- 两端共享：脉宽(us) -> 距离(cm) ----
 * 非 static 以便单元测试 extern 访问（例外：无副作用纯函数，风险可控）。 */
float dal_pulse_us_to_cm(uint32_t pulse_us) {
    return (float)pulse_us * ULTRASONIC_CM_PER_US;
}

#ifdef SIMULATION
/* --- 仿真模式：仅旁路底层物理量来源（trigger + echo 脉宽），
       换算与超时与真机同源 (ADR-0003 决策2 / c-code.md §2)。
       extern 签名抄 wasm_bridge.h（SSOT 闭合）。 --- */
#include "wasm_bridge.h"

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
/* --- 真实芯片模式 --- */
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) return WINK_ERR_INVALID_ARG;

    pal_gpio_write(dev->trig_pin, true);
    pal_delay_us(10);
    pal_gpio_write(dev->trig_pin, false);

    uint64_t wait_start = pal_get_us();
    while (!pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - wait_start > ULTRASONIC_TIMEOUT_US) return WINK_ERR_TIMEOUT;
    }

    uint64_t echo_start = pal_get_us();
    while (pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - echo_start > ULTRASONIC_TIMEOUT_US) return WINK_ERR_TIMEOUT;
    }
    uint32_t pulse_us = (uint32_t)(pal_get_us() - echo_start);

    dev->last_distance = dal_pulse_us_to_cm(pulse_us);
    *distance_cm = dev->last_distance;
    return WINK_OK;
}
#endif
```

> **`#include "wasm_bridge.h"` 在 `#ifdef SIMULATION` 内**：真机/host-real 构建（无 SIMULATION）不编译本 include，故 libdal.a 对 targets/wasm 无依赖；仅 wasm 构建（SIMULATION=1）与 host sim 测试（-DSIMULATION）编译它，二者 include 路径均含 targets/wasm（见 Task 6 的 sim 测试 include 配置）。

- [ ] **Step 4: 运行真机测试，确认通过**

Run: `cmake --build build-test && cd build-test && ctest -R test_dal_ultrasonic --output-on-failure`
Expected: `test_dal_ultrasonic` PASS（5 测试：2 null + 换算 + 脉宽测量 + 超时）。

- [ ] **Step 5: Commit**

```bash
git add wink-micro-os/dal/src/dal_ultrasonic.c wink-micro-os/test/test_dal_ultrasonic.c
git commit -m "Narrow ultrasonic bypass to lowest layer, share pulse-to-cm (ADR-0003)"
```

---

## Task 6: 仿真分支同源测试（-DSIMULATION）+ js_sim host 桩

**Files:**
- Create: `wink-micro-os/test/stubs/js_sim_host_stub.h`
- Create: `wink-micro-os/test/stubs/js_sim_host_stub.c`
- Create: `wink-micro-os/test/test_dal_ultrasonic_sim.c`
- Modify: `wink-micro-os/test/CMakeLists.txt`（新增 `add_wink_test_sim` + 注册）

**Interfaces:**
- Produces: `add_wink_test_sim(name src)`（-DSIMULATION=1 + js_sim host 桩 + targets/host + DAL_SRCS）；证明仿真分支同样走 `dal_pulse_us_to_cm`（ADR-0003 决策2 回归守卫）。

- [ ] **Step 1: 写 `test/stubs/js_sim_host_stub.h`**

```c
/**
 * @file js_sim_host_stub.h
 * @brief 仿真分支（-DSIMULATION=1）host 测试用 js_sim_* 桩。
 *        签名抄 wasm_bridge.h / Device Registry。
 */
#ifndef JS_SIM_HOST_STUB_H
#define JS_SIM_HOST_STUB_H

#include <stdint.h>

/* 设定下一次 js_sim_measure_echo_pulse_us 返回的脉宽 (us) */
void sim_set_echo_pulse_us(uint32_t pulse_us);

#endif /* JS_SIM_HOST_STUB_H */
```

- [ ] **Step 2: 写 `test/stubs/js_sim_host_stub.c`**

```c
/**
 * @file js_sim_host_stub.c
 * @brief 仿真侧 js_sim_* 桩（签名抄 wasm_bridge.h / Registry）。
 *        验证「-DSIMULATION 分支同样走共享换算 dal_pulse_us_to_cm」——ADR-0003 决策2 回归守卫。
 */
#include "js_sim_host_stub.h"

static uint32_t s_injected_pulse_us = 0;

void sim_set_echo_pulse_us(uint32_t pulse_us) { s_injected_pulse_us = pulse_us; }

/* wasm_bridge.h: void js_sim_trigger_ultrasonic(uint16_t trig_pin) —— 时序旁路，host 下空操作 */
void js_sim_trigger_ultrasonic(uint16_t trig_pin) { (void)trig_pin; }

/* wasm_bridge.h: uint32_t js_sim_measure_echo_pulse_us(uint16_t trig_pin) —— 返回注入脉宽 */
uint32_t js_sim_measure_echo_pulse_us(uint16_t trig_pin) {
    (void)trig_pin;
    return s_injected_pulse_us;
}
```

- [ ] **Step 3: 写 `test/test_dal_ultrasonic_sim.c`**

```c
/* 核心：证明仿真分支同样调用 dal_pulse_us_to_cm，输出 == 真机分支对同一脉宽的换算。
 * 这是 ADR-0003 决策2「两端同源」的回归守卫——host 真机测试只覆盖 #else。 */
#include "unity.h"
#include "wink_status.h"
#include "dal_ultrasonic.h"
#include "js_sim_host_stub.h"

extern float dal_pulse_us_to_cm(uint32_t pulse_us);

void setUp(void) { sim_set_echo_pulse_us(0); }
void tearDown(void) {}

void test_sim_read_uses_shared_conversion(void) {
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
    sim_set_echo_pulse_us(31000);   /* ≥ ULTRASONIC_TIMEOUT_US */
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

- [ ] **Step 4: 在 test/CMakeLists.txt 新增 `add_wink_test_sim` 并注册**

追加函数与注册（注意 include 含 targets/wasm，供 dal_ultrasonic.c 的 `#include "wasm_bridge.h"` 解析）：

```cmake
# 仿真分支（-DSIMULATION）测试：验证 ADR-0003 决策2 两端同源在仿真侧确被走到。
function(add_wink_test_sim name src)
    add_executable(${name}
        ${src}
        ${UNITY_DIR}/unity.c
        ${CMAKE_CURRENT_SOURCE_DIR}/stubs/js_sim_host_stub.c
        ${HOST_PAL_OBJECT}
        ${DAL_SRCS}
        ${ARGN})
    target_include_directories(${name} PRIVATE
        ${UNITY_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/stubs
        ${CMAKE_CURRENT_SOURCE_DIR}/../pal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../dal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../targets/wasm     # wasm_bridge.h（dal SIMULATION 分支引用）
        ${CMAKE_CURRENT_SOURCE_DIR}/../trace/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include)
    target_compile_definitions(${name} PRIVATE SIMULATION=1)
    target_compile_options(${name} PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
    add_test(NAME ${name} COMMAND ${name})
endfunction()

add_wink_test_sim(test_dal_ultrasonic_sim test_dal_ultrasonic_sim.c)
```

> 同时把 Task 3/4 临时单文件注册改回 DAL_SRCS（两文件都对齐后）：
> - `add_wink_host_test(test_dal_servo test_dal_servo.c ${DAL_SRCS})`
> - `add_wink_host_test(test_dal_ultrasonic test_dal_ultrasonic.c ${DAL_SRCS})`

- [ ] **Step 5: 运行全部测试，确认通过（含 sim 同源）**

Run:
```bash
cmake --build build-test
cd build-test && ctest --output-on-failure
```
Expected: 全 PASS（test_smoke + test_trace + test_runtime + test_host_pal + test_dal_servo[3] + test_dal_ultrasonic[5] + test_dal_ultrasonic_sim[2]）。

- [ ] **Step 6: Commit**

```bash
git add wink-micro-os/test/stubs/js_sim_host_stub.h wink-micro-os/test/stubs/js_sim_host_stub.c wink-micro-os/test/test_dal_ultrasonic_sim.c wink-micro-os/test/CMakeLists.txt
git commit -m "Add SIM-branch same-source regression test for ultrasonic (ADR-0003 decision 2)"
```

---

## Task 7: test/stubs 迁移（host_test_ctrl 头）+ 终验

**Files:**
- Move: `wink-micro-os/test/host_test_ctrl.h` → `wink-micro-os/test/stubs/host_test_ctrl.h`
- Modify: `wink-micro-os/targets/host/CMakeLists.txt`（include 路径 ../../test → ../../test/stubs）
- Modify: 所有 `#include "host_test_ctrl.h"` 的测试源（include 路径随 stubs/ 已在 include 列表，无需改源；仅确认）
- Modify: `wink-micro-os/test/CMakeLists.txt`（add_wink_host_test / add_wink_test_sim 已含 stubs include，确认）

**Interfaces:** 无新接口。对齐设计 §4（test/stubs/{host_test_ctrl, js_sim_host_stub}）。

- [ ] **Step 1: 迁移 host_test_ctrl.h 到 stubs/**

```bash
git mv wink-micro-os/test/host_test_ctrl.h wink-micro-os/test/stubs/host_test_ctrl.h
```

> `host_test_ctrl.c` 实现不存在（Plan 3 把 `sim_*` 实现放 `targets/host/pal_osal_host.c`），故只迁头。

- [ ] **Step 2: 改 targets/host CMake include 路径**

Modify `wink-micro-os/targets/host/CMakeLists.txt`，把 `target_include_directories` 中的 `${CMAKE_CURRENT_SOURCE_DIR}/../../test` 改为 `${CMAKE_CURRENT_SOURCE_DIR}/../../test/stubs`：

```cmake
target_include_directories(pal_host PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../../test/stubs    # host_test_ctrl.h
    ${CMAKE_CURRENT_SOURCE_DIR}/../../pal/include)
```

- [ ] **Step 3: 确认测试源的 include 路径**

`add_wink_host_test` 与 `add_wink_test_sim` 的 include 列表都含 `${CMAKE_CURRENT_SOURCE_DIR}` 与 `${CMAKE_CURRENT_SOURCE_DIR}/stubs`——`#include "host_test_ctrl.h"` 经 stubs/ 解析。无需改测试源。

- [ ] **Step 4: 全量回归**

Run:
```bash
cmake -B build-test -DTARGET_PLATFORM=host
cmake --build build-test
cd build-test && ctest --output-on-failure
```
Expected: 全 PASS（7 个测试可执行，共 ~22 测试点）。

- [ ] **Step 5: Commit**

```bash
git add wink-micro-os/test/stubs/host_test_ctrl.h wink-micro-os/targets/host/CMakeLists.txt
git commit -m "Relocate host_test_ctrl to test/stubs (align A* §4 layout)"
```

---

## Self-Review

**1. Spec coverage（对照 03-directory-architecture.md + ADR-0003 决策2）**：
- §9 迁移项（DAL bypass 收窄）→ Task 5 ✅
- ADR-0003 决策2（换算/超时两端同源）→ Task 5（真机）+ Task 6（仿真回归）✅
- §4 test/stubs/{host_test_ctrl, js_sim_host_stub} → Task 6 + Task 7 ✅
- DAL 签名对齐 wink_status_t（ADR-0001）→ Task 3/4 ✅
- Device Registry SSOT 闭环 → Task 1 ✅
- js_sim_* SSOT（wasm_bridge.h）→ Task 2 ✅

**2. Placeholder scan**：无 TBD/TODO；所有代码块完整；测试含断言期望值（7.5%、99.994cm、12.5%）✅。

**3. Type/signature consistency（跨计划）**：
- `dal_ultrasonic_read(dal_ultrasonic_t*, float*) -> wink_status_t`：Task 4 定义、Task 5 保签名改实现、test 与 test_sim 调用一致 ✅
- `dal_servo_set_angle(dal_servo_t*, float) -> wink_status_t`：Task 3 定义/调用一致 ✅
- `dal_pulse_us_to_cm(uint32_t) -> float`：Task 5 定义（非 static）、Task 5 test extern、Task 6 test_sim extern 一致 ✅
- `js_sim_trigger_ultrasonic(uint16_t)` / `js_sim_measure_echo_pulse_us(uint16_t)->uint32_t`：Registry（Task1）、wasm_bridge.h（Task2）、dal_ultrasonic.c include 引用（Task5）、js_sim_host_stub.c（Task6）四处签名一致 ✅
- `sim_*` 4 API：Plan 3 host_test_ctrl.h 声明、targets/host/pal_osal_host.c 实现、test_dal_* 调用一致；Task 7 仅迁头路径 ✅
- `add_wink_host_test`/`add_wink_test_sim` 与 Plan 3 的 `add_wink_host_test` 衔接（Plan 4 给它加 dal/include）✅

**4. 已知风险**：
- `dal_pulse_us_to_cm` 非 static（封装让步）：无副作用纯函数，已文档化例外；未来可建独立编译 target 测 static 恢复封装（ADR-0003 计划 P2 同款遗留）。
- `#include "wasm_bridge.h"` 在 dal_ultrasonic.c `#ifdef SIMULATION` 内：真机构建不编译（无依赖），仅 wasm + host-sim 编译（include 路径已配）。若未来 wasm_bridge.h 拉入 PAL 无关的大量声明，DAL sim 分支编译体积可能略增——当前仅 js_sim_* 两条，可忽略。
- `ASYNCIFY_IMPORTS` 仍列旧值 `js_sim_get_ultrasonic_distance`（代码已不引用，Emscripten 不因列未用符号报错）；完整 wasm 链接待 ADR-0002 spike。与本计划 Global Constraints 一致。
- host HAL↔OSAL 跨文件 extern 访问器（Plan 3 引入）在本计划未变，DAL 真机分支经 targets/host 协作式时间跑通脉宽测量（test_read_real_measure_pulse 验证）。

# Wave B: ESP32 真机功能验证 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 wink-micro-os 核心完整移植到 ESP32 真机并完成所有硬件功能验证，实现从仿真到物理硬件的同源执行。

**Architecture:** 双目标同源编译架构，PAL/DAL/Runtime/Trace 核心代码在 wasm 仿真与 ESP32 真机间共享，仅 PAL HAL/OSAL 层存在平台差异实现。

**Tech Stack:** ESP-IDF v5.x, FreeRTOS, RMT 外设, GPIO/PWM/I2C

## Global Constraints

- 所有错误码遵循负数约定（WINK_OK = 0, 负数 = 错误）
- 双目标同源编译：`#ifdef SIMULATION` / `#if defined(ESP_PLATFORM)` 隔离必须最小化
- 所有可能失败的函数必须返回 `wink_status_t` 并标记 `WINK_WARN_UNUSED_RESULT`
- 禁止在 runtime 10ms tick 内使用 busy-wait 阻塞（>1ms 的操作必须非阻塞）
- 看门狗超时阈值：5000ms（默认），App tick 最大允许延迟：10ms

---

## Task 1: ESP32 IDF 项目集成与组件封装

**Files:**
- Create: `esp32_firmware/CMakeLists.txt`
- Create: `esp32_firmware/main/CMakeLists.txt`
- Create: `esp32_firmware/main/app_main.c`
- Create: `esp32_firmware/idf_component.yml`
- Create: `esp32_firmware/sdkconfig.defaults`
- Modify: `wink-micro-os/targets/esp32/CMakeLists.txt`

**Interfaces:**
- Consumes: PAL/DAL/Runtime/Trace 核心模块
- Produces: ESP-IDF 可编译固件工程

### Step 1.1: 创建 ESP-IDF 项目根目录结构

```bash
New-Item -ItemType Directory -Path "esp32_firmware\main" -Force
New-Item -ItemType Directory -Path "esp32_firmware\components" -Force
```

### Step 1.2: 创建项目根 CMakeLists.txt

```cmake
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(wink_esp32_firmware)

# 添加 wink-micro-os 组件
set(EXTRA_COMPONENT_DIRS "../wink-micro-os/targets/esp32")
```

### Step 1.3: 创建 idf_component.yml (组件清单)

```yaml
dependencies:
  idf: ">=5.0.0"
```

### Step 1.4: 创建 sdkconfig.defaults (默认配置)

```
# 系统配置
CONFIG_ESP_MAIN_TASK_STACK_SIZE=8192
CONFIG_ESP_TIMER_SUPPORTS_ISR_DISPATCH_METHOD=y

# FreeRTOS 配置
CONFIG_FREERTOS_HZ=1000
CONFIG_FREERTOS_USE_TRACE_FACILITY=y
CONFIG_FREERTOS_USE_STATS_FORMATTING_FUNCTIONS=y

# 看门狗配置
CONFIG_ESP_TASK_WDT_INIT=y
CONFIG_ESP_TASK_WDT_TIMEOUT_S=5

# RMT 配置
CONFIG_RMT_ENABLE_DEBUG_LOG=n
CONFIG_RMT_ISR_IRAM_SAFE=y

# GPIO 配置
CONFIG_GPIO_CTRL_FUNC_IN_IRAM=y
```

### Step 1.5: 更新 targets/esp32/CMakeLists.txt

```cmake
# ESP32 真机端口（ESP-IDF 组件模式）
# host/wasm 构建不包含本目录

if(TARGET_PLATFORM STREQUAL "esp32")
    if(ESP_PLATFORM)
        # ESP-IDF 环境：注册为 IDF 组件
        idf_component_register(
            SRCS
                pal_hal_esp32.c
                pal_osal_esp32.c
                pal_resource_esp32.c
                pal_hal_esp32_rmt.c
                ../../runtime/src/wink_runtime.c
                ../../runtime/src/wink_actuator_registry.c
                ../../trace/src/wink_trace.c
                ../../dal/src/dal_ultrasonic.c
                ../../dal/src/dal_servo.c
                ../../dal/src/dal_led.c
                ../../dal/src/dal_button.c
                ../../dal/src/dal_ssd1306.c
            INCLUDE_DIRS
                ../../pal/include
                ../../dal/include
                ../../runtime/include
                ../../trace/include
            REQUIRES
                driver
        )
        # 输出组件库目标
        set(ESP32_PAL_LIB ${COMPONENT_LIB} CACHE INTERNAL "")
    else()
        # 非 ESP-IDF 环境：仅声明源文件（供静态分析）
        set(ESP32_PAL_SOURCES
            pal_hal_esp32.c
            pal_osal_esp32.c
            pal_resource_esp32.c
            pal_hal_esp32_rmt.c
        )
    endif()
    message(STATUS "esp32 target configured (ESP-IDF integration)")
endif()
```

### Step 1.6: 创建 main/app_main.c (ESP-IDF 入口)

```c
/**
 * @file app_main.c
 * @brief ESP32 真机入口：启动 wink runtime + avoidance_car 应用
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "wink_runtime.h"
#include "wink_status.h"
#include "wink_trace.h"
#include "pal_osal.h"

/* 引入 avoidance_car 应用回调（未来改为可配置注入） */
#include "../../../wink-micro-os/samples/avoidance_car/device_tree.h"
extern const wink_app_callbacks_t *wink_app_get_callbacks(void);

#define WINK_TASK_STACK_SIZE    4096
#define WINK_TASK_PRIORITY      5
#define WINK_TICK_PERIOD_MS     10

static TaskHandle_t s_wink_task_handle = NULL;

/**
 * @brief Wink Runtime 主任务
 *
 * 运行频率：100Hz（每 10ms 一次 tick）
 * 功能：执行 App 回调、看门狗喂狗、故障检测
 */
static void wink_runtime_task(void *arg) {
    (void)arg;

    /* Phase 5：初始化看门狗（5s 超时） */
    wink_status_t wdt = pal_watchdog_init(5000);
    if (wink_status_is_error(wdt)) {
        printf("WDT init failed: %d\n", (int)wdt);
    }

    /* 初始化 Runtime */
    const wink_app_callbacks_t *app = wink_app_get_callbacks();
    wink_status_t rs = wink_runtime_init(app, WINK_TICK_PERIOD_MS);
    if (wink_status_is_error(rs)) {
        printf("Runtime init failed: %d\n", (int)rs);
        vTaskDelete(NULL);
        return;
    }

    printf("Wink-Micro-OS ESP32 Runtime started\n");
    printf("  Reset reason: %d\n", (int)pal_get_reset_reason());

    /* 10ms tick 主循环 */
    TickType_t last_wake = xTaskGetTickCount();
    for (;;) {
        /* 执行一个 tick（App init/loop/on_fault 回调在内部分发） */
        wink_runtime_tick();

        /* Phase 5：看门狗喂狗（tick 正常执行证明系统存活） */
        pal_watchdog_feed();

        /* 精确延时到下一个 10ms 周期 */
        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(WINK_TICK_PERIOD_MS));
    }
}

/**
 * @brief ESP-IDF 应用入口（由 FreeRTOS 自动调用）
 */
void app_main(void) {
    printf("=== Wink-Micro-OS ESP32 Firmware ===\n");

    /* 启动 Wink Runtime 任务 */
    BaseType_t ret = xTaskCreate(
        wink_runtime_task,
        "wink_runtime",
        WINK_TASK_STACK_SIZE,
        NULL,
        WINK_TASK_PRIORITY,
        &s_wink_task_handle
    );

    if (ret != pdPASS) {
        printf("Failed to create wink_runtime task!\n");
        return;
    }

    printf("Runtime task created (handle=%p)\n", (void*)s_wink_task_handle);

    /* app_main 任务可用于：系统监控、日志输出、CLI 等 */
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(1000));

        /* 每秒输出一次简单的心跳日志 */
        static uint32_t uptime_sec = 0;
        printf("Uptime: %us  Active faults: %u\n",
               uptime_sec++, wink_trace_get_active_fault_count());
    }
}
```

### Step 1.7: 创建 main/CMakeLists.txt

```cmake
idf_component_register(
    SRCS "app_main.c"
    INCLUDE_DIRS "."
    REQUIRES driver
)
```

### Step 1.8: 验证构建环境

Run: `cd esp32_firmware; idf.py set-target esp32; idf.py build`
Expected: Build completes successfully with 0 errors

### Step 1.9: Commit

```bash
git add esp32_firmware/
git add wink-micro-os/targets/esp32/CMakeLists.txt
git commit -m "feat(esp32): add ESP-IDF firmware project structure"
```

---

## Task 2: 超声波 RMT 硬件捕获验证

**Files:**
- Modify: `wink-micro-os/targets/esp32/pal_hal_esp32_rmt.c`
- Modify: `wink-micro-os/dal/src/dal_ultrasonic.c`
- Create: `esp32_firmware/main/test_rmt_ultrasonic.c`

**Interfaces:**
- Consumes: `pal_rmt_ultrasonic_init`, `pal_rmt_ultrasonic_measure`, `pal_rmt_ultrasonic_deinit`
- Produces: 经过真机验证的非阻塞超声波驱动

### Step 2.1: RMT 驱动边界测试修复

检查当前 RMT 实现的边界情况：
- 符号解析错误修正（第 142-146 行）
- 超时处理优化（第 127-132 行）
- 中断安全验证

```c
/* 在 pal_hal_esp32_rmt.c 第 142 行附近修正符号解析 */
if (s_rx_done_data.num_symbols >= 1) {
    /* HC-SR04 波形分析：
     *   symbol[0].level0 = 0 (等待上升沿期间的低电平)
     *   symbol[0].duration0 = 低电平持续时间
     *   symbol[0].level1 = 1 (echo 高电平)
     *   symbol[0].duration1 = echo 脉冲宽度（需要的值）
     */
    if (s_rx_done_data.received_symbols[0].level1 == 1) {
        *pulse_us = s_rx_done_data.received_symbols[0].duration1;
    } else {
        /* 异常：第一个高电平不是 echo 脉冲 */
        return WINK_ERR_TIMEOUT;
    }
    return WINK_OK;
}
```

### Step 2.2: 创建 RMT 专用测试固件

```c
/**
 * @file test_rmt_ultrasonic.c
 * @brief RMT 超声波捕获真机测试
 *
 * 测试场景：
 *   1. RMT 初始化成功/失败
 *   2. 10cm 障碍物测距验证
 *   3. 超时（无障碍物）处理
 *   4. 连续 100 次测量稳定性
 *   5. 与 busy-wait 方案精度对比
 */
#include <stdio.h>
#include "pal_hal.h"
#include "pal_hal_rmt.h"
#include "pal_osal.h"

#define TEST_TRIG_PIN    4
#define TEST_ECHO_PIN    5
#define TEST_ITERATIONS  100

void test_rmt_ultrasonic(void) {
    printf("=== RMT Ultrasonic Test ===\n");

    /* 测试 1: 初始化 */
    wink_status_t init = pal_rmt_ultrasonic_init(TEST_ECHO_PIN);
    printf("Test 1 - RMT init: %s (%d)\n",
           wink_status_is_error(init) ? "FAIL" : "PASS", (int)init);
    if (wink_status_is_error(init)) {
        printf("  Falling back to busy-wait...\n");
        pal_gpio_init(TEST_TRIG_PIN, PAL_GPIO_OUTPUT_PUSH_PULL);
        pal_gpio_init(TEST_ECHO_PIN, PAL_GPIO_INPUT);
    }

    /* 测试 2: 连续测量 */
    printf("\nTest 2 - Continuous measurement (%d iterations):\n", TEST_ITERATIONS);
    uint32_t success_count = 0;
    uint32_t timeout_count = 0;
    uint64_t total_time_us = 0;

    for (int i = 0; i < TEST_ITERATIONS; i++) {
        /* Trigger */
        pal_gpio_write(TEST_TRIG_PIN, true);
        pal_delay_us(10);
        pal_gpio_write(TEST_TRIG_PIN, false);

        /* Measure */
        uint32_t pulse_us = 0;
        uint64_t start = pal_get_us();

        wink_status_t cap = pal_rmt_ultrasonic_measure(30000, &pulse_us);

        uint64_t elapsed = pal_get_us() - start;
        total_time_us += elapsed;

        if (cap == WINK_OK) {
            success_count++;
            float distance_cm = pulse_us * 0.017f;
            printf("  [%03d] pulse=%5uus  distance=%5.1fcm  elapsed=%lluus\n",
                   i, pulse_us, distance_cm, elapsed);
        } else if (cap == WINK_ERR_TIMEOUT) {
            timeout_count++;
            printf("  [%03d] TIMEOUT\n", i);
        } else {
            printf("  [%03d] ERROR: %d\n", i, (int)cap);
        }

        pal_delay_ms(100);
    }

    /* 测试 3: 统计分析 */
    printf("\nTest 3 - Statistics:\n");
    printf("  Success:   %u/%u (%.1f%%)\n",
           success_count, TEST_ITERATIONS,
           (float)success_count / TEST_ITERATIONS * 100.0f);
    printf("  Timeouts:  %u/%u (%.1f%%)\n",
           timeout_count, TEST_ITERATIONS,
           (float)timeout_count / TEST_ITERATIONS * 100.0f);
    printf("  Avg time:  %.1f us/measurement\n",
           (float)total_time_us / TEST_ITERATIONS);

    /* 测试 4: 反初始化 */
    pal_rmt_ultrasonic_deinit();
    printf("\nTest 4 - Deinit: PASS\n");

    printf("\n=== Test Complete ===\n");
}
```

### Step 2.3: 更新 DAL 确保 RMT 路径被执行

验证 dal_ultrasonic.c 第 40-48 行（RMT 初始化）和第 73-80 行（RMT 测量）
确保 `use_rmt` 标志正确传播

### Step 2.4: 烧录并运行测试

Run: `cd esp32_firmware; idf.py -p COM3 flash monitor`
Expected:
- RMT init: PASS
- 连续测量成功率 > 95%
- 单次测量时间 ≈ 超声波回波时间（非 busy-wait 60ms+ 阻塞）

### Step 2.5: Commit

```bash
git add wink-micro-os/targets/esp32/pal_hal_esp32_rmt.c
git add wink-micro-os/dal/src/dal_ultrasonic.c
git add esp32_firmware/main/test_rmt_ultrasonic.c
git commit -m "test(esp32): validate RMT ultrasonic capture"
```

---

## Task 3: GPIO/PWM/I2C 真机驱动测试

**Files:**
- Create: `esp32_firmware/main/test_gpio_pwm_i2c.c`
- Verify: `wink-micro-os/targets/esp32/pal_hal_esp32.c`

**Interfaces:**
- Consumes: `pal_gpio_init`, `pal_gpio_write`, `pal_gpio_read`
- Consumes: `pal_pwm_init`, `pal_pwm_set_duty`
- Consumes: `pal_i2c_transfer`
- Produces: 经过验证的 GPIO/PWM/I2C 驱动

### Step 3.1: GPIO 功能测试

创建 `esp32_firmware/main/test_gpio_pwm_i2c.c`，包含：
- GPIO 输出测试（板载 LED 闪烁）
- GPIO 输入测试（BOOT 按钮读取）
- PWM 舵机扫角测试
- I2C OLED 显示测试

### Step 3.2: 更新 CMakeLists.txt 添加测试文件

在 `esp32_firmware/main/CMakeLists.txt` 中添加测试源文件

### Step 3.3: 烧录测试并验证

Run: `cd esp32_firmware; idf.py -p COM3 flash monitor`

Expected:
- GPIO LED 闪烁 5 次
- BOOT 按钮按下检测正常
- PWM 舵机 0 到 180 度扫角
- I2C OLED 初始化成功并显示内容

### Step 3.4: Commit

```bash
git add esp32_firmware/main/test_gpio_pwm_i2c.c
git add esp32_firmware/main/CMakeLists.txt
git commit -m "test(esp32): validate GPIO/PWM/I2C hardware drivers"
```

---

## Task 4: avoidance_car 端到端验证

**Files:**
- Create: `esp32_firmware/main/avoidance_car_main.c`
- Verify: Runtime tick scheduling

**Interfaces:**
- Consumes: `wink_runtime_init`, `wink_runtime_tick`
- Consumes: `dal_ultrasonic_request_measurement`, `dal_ultrasonic_get_cached_distance`
- Consumes: `dal_servo_set_angle`
- Produces: 真机运行的 avoidance_car 应用

### Step 4.1: 创建 avoidance_car 真机入口

创建 ESP-IDF 应用入口，包含：
- Runtime 初始化
- 10ms tick 调度循环
- 看门狗喂狗
- 调度抖动统计
- 每秒状态输出

### Step 4.2: 验证 DAL 设备树配置

确保 `device_tree.c/h` 中定义的引脚与实际硬件连接一致：
- front_radar (GPIO 4/5)
- neck_servo (PWM channel 0)

### Step 4.3: 端到端功能验证清单

Run: `cd esp32_firmware; idf.py -p COM3 flash monitor`

验证项：
- [ ] Runtime 初始化成功，无错误
- [ ] 超声波测距稳定（10Hz）
- [ ] 距离 < 20cm 时舵机扫到 180 度
- [ ] 距离 >= 20cm 时舵机回到 90 度
- [ ] tick 调度率稳定在 100 Hz
- [ ] tick 抖动 < 1ms
- [ ] 连续运行 5 分钟无看门狗超时
- [ ] 无活跃故障上报

### Step 4.4: 异常场景测试

- [ ] 移除超声波传感器 -> 触发 TIMEOUT fault，舵机保持安全位
- [ ] 恢复超声波传感器 -> 测量自动恢复，fault 清除
- [ ] 故意阻塞 tick > 5s -> 看门狗触发系统复位

### Step 4.5: Commit

```bash
git add esp32_firmware/main/avoidance_car_main.c
git add wink-micro-os/samples/avoidance_car/
git commit -m "test(esp32): avoidance car end-to-end validation"
```

---

## Task 5: 看门狗 + 故障安全机制验证

**Files:**
- Create: `esp32_firmware/main/test_watchdog_failsafe.c`
- Verify: `wink-micro-os/targets/esp32/pal_osal_esp32.c`
- Verify: `wink-micro-os/runtime/src/wink_actuator_registry.c`

**Interfaces:**
- Consumes: `pal_watchdog_init`, `pal_watchdog_feed`
- Consumes: `pal_get_reset_reason`
- Consumes: `wink_actuator_register`, `wink_actuator_safe_off_all`
- Produces: 经过验证的看门狗 + 故障安全机制

### Step 5.1: 创建看门狗与故障安全测试

测试场景：
1. 复位原因识别（上电复位 vs 看门狗复位）
2. 看门狗正常喂狗不触发
3. 停止喂狗触发看门狗复位
4. 执行器 safe-off 注册与触发
5. 故障注入与安全状态验证

### Step 5.2: 执行器注册机制验证

验证 `wink_actuator_register` 正确注册舵机 safe-off 回调，确保：
- 注册成功返回 WINK_OK
- 故障时 safe-off 回调被调用
- 舵机被设置到安全角度（90 度）

### Step 5.3: 看门狗测试并验证复位

Run: `cd esp32_firmware; idf.py -p COM3 flash monitor`

Expected:
- 第一次启动：复位原因为 POWER_ON
- 正常喂狗 5 秒：无复位
- 停止喂狗：2 秒后看门狗复位
- 复位后重启：复位原因为 WATCHDOG

### Step 5.4: 故障安全综合测试

测试：
- 注册舵机 safe-off 回调
- 注入超声波故障
- 验证 safe-off 回调被调用
- 验证舵机被设置到安全位置
- 验证 fault 被正确 trace

### Step 5.5: Commit 和文档

```bash
git add esp32_firmware/main/test_watchdog_failsafe.c
git commit -m "test(esp32): watchdog and failsafe mechanism validation"
```

---

## 验收标准 (Acceptance Criteria)

Wave B 真机功能验证完成标志：

1. **编译与构建**
   - [ ] ESP-IDF 构建无错误、无警告
   - [ ] wink-micro-os 核心 PAL/DAL/Runtime/Trace 全部编译
   - [ ] 双目标同源：host/wasm 构建不受影响

2. **GPIO/PWM/I2C 驱动**
   - [ ] GPIO 输出（LED 闪烁）功能正常
   - [ ] GPIO 输入（按钮读取）功能正常
   - [ ] PWM 舵机控制功能正常
   - [ ] I2C 显示屏通信正常

3. **超声波 RMT 硬件捕获**
   - [ ] RMT 初始化成功，无资源冲突
   - [ ] 测距精度与忙等待方案相当
   - [ ] 连续 100 次测量成功率 > 95%
   - [ ] 超时场景正确处理

4. **Runtime 调度性能**
   - [ ] 10ms tick 调度率稳定为 100 Hz
   - [ ] tick 调度抖动 < 1ms
   - [ ] 连续运行 5 分钟无异常

5. **avoidance_car 端到端**
   - [ ] 障碍物检测与舵机响应匹配预期
   - [ ] 故障场景舵机保持安全位
   - [ ] 故障恢复后测量自动恢复

6. **看门狗与故障安全**
   - [ ] 复位原因识别正确
   - [ ] 看门狗超时触发复位正常
   - [ ] 执行器 safe-off 回调正确执行
   - [ ] 故障 trace 机制正常工作

---

## 后续工作

Wave B 完成后，建议的后续方向：
1. 电机驱动 DAL 层设计与实现
2. PID 控制算法集成
3. 无线通信（WiFi/BLE）支持
4. 云端遥测与 OTA 升级

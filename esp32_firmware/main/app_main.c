/**
 * @file app_main.c
 * @brief ESP32 真机入口：启动 wink runtime
 *
 * 关键修复点（架构评审）：
 *   Issue #3: Runtime task 栈从 4096 → 8192 字节（防溢出）+ 水位监控
 *   Issue 增补: Heap 泄漏监控（运行5分钟内存变化 < 100字节）
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"
#include "esp_heap_caps.h"
#include "wink_runtime.h"
#include "wink_status.h"
#include "wink_trace.h"
#include "pal_osal.h"

/* 引入 avoidance_car 应用回调 */
#include "../../wink-micro-os/samples/avoidance_car/device_tree.h"
extern const wink_app_callbacks_t *wink_app_get_callbacks(void);

/* 架构评审修复 #3：栈大小调优
 * ESP32 FreeRTOS 栈单位是字节，printf + runtime tick + DAL 驱动
 * 需要较大栈空间。起步 8192 字节，运行后通过水位调优。
 * 验收标准：运行 5 分钟后栈剩余 > 1024 字节
 */
#define WINK_TASK_STACK_SIZE    8192    /* Fixed: was 4096 */
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

    /* 初始化 Runtime */
    const wink_app_callbacks_t *app = wink_app_get_callbacks();
    wink_status_t rs = wink_runtime_init(app, WINK_TICK_PERIOD_MS);
    if (wink_status_is_error(rs)) {
        printf("Runtime init failed: %d\n", (int)rs);
        vTaskDelete(NULL);
        return;
    }

    printf("Wink-Micro-OS ESP32 Runtime started\n");

    /* 10ms tick 主循环 */
    TickType_t last_wake = xTaskGetTickCount();
    for (;;) {
        /* 执行一个 tick（App init/loop/on_fault 回调在内部分发） */
        wink_runtime_tick();

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
        printf("Failed to create wink_runtime_task!\n");
        return;
    }

    printf("Runtime task created (stack=%u bytes, handle=%p)\n",
           WINK_TASK_STACK_SIZE, (void*)s_wink_task_handle);

    /* 验收标准增补：Heap 泄漏监控基准值
     * 记录启动后（系统稳定时）的可用内存作为基准
     * 验收标准：运行 5 分钟后变化 < 100 字节
     */
    const uint32_t heap_free_base = heap_caps_get_free_size(MALLOC_CAP_DEFAULT);
    printf("Heap baseline: %u bytes\n", heap_free_base);

    /* app_main 任务：系统监控、日志输出 */
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(1000));

        /* 架构评审修复 #3：栈高水位检测
         * uxTaskGetStackHighWaterMark 返回剩余栈空间（words）
         * × sizeof(StackType_t) = 字节数
         * 验收标准：运行 5 分钟后 > 1024 字节
         */
        UBaseType_t stack_free_words = uxTaskGetStackHighWaterMark(s_wink_task_handle);
        uint32_t stack_free_bytes = stack_free_words * sizeof(StackType_t);
        uint32_t stack_used_bytes = WINK_TASK_STACK_SIZE - stack_free_bytes;

        /* 验收标准增补：Heap 泄漏检测
         * 监控可用内存变化量，超过阈值报警
         */
        uint32_t heap_free_now = heap_caps_get_free_size(MALLOC_CAP_DEFAULT);
        int32_t heap_delta = (int32_t)heap_free_now - (int32_t)heap_free_base;

        printf("Uptime: %lus  Stack: used=%uB free=%uB  Heap: %uB (delta%+d)  Faults: %u\n",
               xTaskGetTickCount() / configTICK_RATE_HZ,
               stack_used_bytes,
               stack_free_bytes,
               heap_free_now,
               heap_delta,
               wink_trace_get_active_fault_count());

        /* 栈安全门禁：剩余 < 1024 字节时报警 */
        if (stack_free_bytes < 1024) {
            printf("WARNING: Stack dangerously low! free=%uB < 1024B\n", stack_free_bytes);
        }

        /* Heap 泄漏门禁：持续泄漏 > 512 字节时报警 */
        if (heap_delta < -512) {
            printf("WARNING: Possible heap leak! delta=%dB\n", heap_delta);
        }
    }
}

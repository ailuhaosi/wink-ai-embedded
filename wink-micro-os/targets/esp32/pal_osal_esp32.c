/**
 * @file pal_osal_esp32.c
 * @brief ESP32 真机 PAL OSAL 实现（FreeRTOS + ESP-IDF）。
 *
 * 实现功能：
 * - 阻塞延时（vTaskDelay）
 * - 高精度时间戳（esp_timer）
 * - 互斥锁（FreeRTOS Semaphore）
 * - WDT 看门狗（esp_task_wdt）
 * - 复位原因（esp_reset_reason）
 * - 临界区（portENTER_CRITICAL）
 */
#include "pal_osal.h"

#if defined(ESP_PLATFORM)
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_timer.h"
#include "esp_task_wdt.h"
#include "esp_reset_reason.h"
#else
/* 非 ESP32 编译环境：stub 声明供静态分析 */
typedef void* SemaphoreHandle_t;
#define pdMS_TO_TICKS(ms) (ms)
#define portMAX_DELAY 0xffffffff
#define portMUX_INITIALIZER_UNLOCKED {0}
typedef struct { int reserved; } portMUX_TYPE;
#endif

/* ─────────────────────────────────────────────────────────
 * 系统时间与高精度延时
 * ───────────────────────────────────────────────────────── */

void pal_delay_ms(uint32_t ms) {
#if defined(ESP_PLATFORM)
    vTaskDelay(pdMS_TO_TICKS(ms));
#else
    (void)ms;
#endif
}

void pal_delay_us(uint32_t us) {
#if defined(ESP_PLATFORM)
    esp_rom_delay_us(us);
#else
    (void)us;
#endif
}

uint64_t pal_get_ms(void) {
#if defined(ESP_PLATFORM)
    return esp_timer_get_time() / 1000ULL;
#else
    return 0;
#endif
}

uint64_t pal_get_us(void) {
#if defined(ESP_PLATFORM)
    return esp_timer_get_time();
#else
    return 0;
#endif
}

/* ─────────────────────────────────────────────────────────
 * 线程同步互斥锁（Mutex）
 * ───────────────────────────────────────────────────────── */

pal_mutex_t pal_mutex_create(void) {
#if defined(ESP_PLATFORM)
    SemaphoreHandle_t mux = xSemaphoreCreateMutex();
    return (pal_mutex_t)mux;
#else
    return (pal_mutex_t)1;  /* stub 非 NULL */
#endif
}

wink_status_t pal_mutex_lock(pal_mutex_t mutex, uint32_t timeout_ms) {
    if (mutex == NULL) { return WINK_ERR_INVALID_ARG; }
#if defined(ESP_PLATFORM)
    BaseType_t ok = xSemaphoreTake((SemaphoreHandle_t)mutex,
        timeout_ms == WINK_MUTEX_WAIT_FOREVER ? portMAX_DELAY : pdMS_TO_TICKS(timeout_ms));
    return ok == pdPASS ? WINK_OK : WINK_ERR_TIMEOUT;
#else
    (void)timeout_ms; return WINK_OK;
#endif
}

wink_status_t pal_mutex_unlock(pal_mutex_t mutex) {
    if (mutex == NULL) { return WINK_ERR_INVALID_ARG; }
#if defined(ESP_PLATFORM)
    BaseType_t ok = xSemaphoreGive((SemaphoreHandle_t)mutex);
    return ok == pdPASS ? WINK_OK : WINK_ERR_HARDWARE;
#else
    return WINK_OK;
#endif
}

void pal_mutex_destroy(pal_mutex_t mutex) {
#if defined(ESP_PLATFORM)
    if (mutex != NULL) {
        vSemaphoreDelete((SemaphoreHandle_t)mutex);
    }
#else
    (void)mutex;
#endif
}

/* ─────────────────────────────────────────────────────────
 * 复位原因与看门狗（Phase 5 Fail-Safe）
 * ───────────────────────────────────────────────────────── */

pal_reset_reason_t pal_get_reset_reason(void) {
#if defined(ESP_PLATFORM)
    esp_reset_reason_t rr = esp_reset_reason();
    switch (rr) {
        case ESP_RST_POWERON:     return PAL_RESET_REASON_POWER_ON;
        case ESP_RST_SW:          return PAL_RESET_REASON_SOFTWARE;
        case ESP_RST_INT_WDT:     return PAL_RESET_REASON_WATCHDOG;
        case ESP_RST_TASK_WDT:    return PAL_RESET_REASON_WATCHDOG;
        case ESP_RST_WDT:         return PAL_RESET_REASON_WATCHDOG;
        case ESP_RST_BROWNOUT:    return PAL_RESET_REASON_BROWNOUT;
        case ESP_RST_PANIC:       return PAL_RESET_REASON_PANIC;   /* 触发 boot safe-lock */
        default:                  return PAL_RESET_REASON_UNKNOWN;
    }
#else
    return PAL_RESET_REASON_UNKNOWN;
#endif
}

WINK_WARN_UNUSED_RESULT wink_status_t pal_watchdog_init(uint32_t timeout_ms) {
#if defined(ESP_PLATFORM)
    /* ESP-IDF v5.x Task Watchdog API */
    esp_task_wdt_config_t cfg = {
        .timeout_ms = timeout_ms,
        .idle_core_mask = 0,  /* 不监控 idle task */
        .trigger_panic = true,
    };
    esp_err_t err = esp_task_wdt_init(&cfg);
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
    err = esp_task_wdt_add(NULL);  /* 订阅当前 task */
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
    return WINK_OK;
#else
    (void)timeout_ms; return WINK_ERR_UNSUPPORTED;
#endif
}

WINK_WARN_UNUSED_RESULT wink_status_t pal_watchdog_feed(void) {
#if defined(ESP_PLATFORM)
    esp_err_t err = esp_task_wdt_reset();
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
    return WINK_OK;
#else
    return WINK_ERR_UNSUPPORTED;
#endif
}

/* ─────────────────────────────────────────────────────────
 * 临界区（ISR 安全）
 * ───────────────────────────────────────────────────────── */

#if defined(ESP_PLATFORM)
static portMUX_TYPE s_global_mux = portMUX_INITIALIZER_UNLOCKED;
#else
static int s_global_mux_stub = 0;
#endif

uint32_t pal_critical_enter(void) {
#if defined(ESP_PLATFORM)
    portENTER_CRITICAL(&s_global_mux);
#else
    s_global_mux_stub = 1;
#endif
    return 0;
}

void pal_critical_exit(uint32_t key) {
    (void)key;
#if defined(ESP_PLATFORM)
    portEXIT_CRITICAL(&s_global_mux);
#else
    s_global_mux_stub = 0;
#endif
}

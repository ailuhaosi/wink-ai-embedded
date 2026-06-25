/**
 * @file pal_osal_esp32.c
 * @brief ESP32 真机 PAL OSAL 骨架（vTaskDelay / esp_timer / FreeRTOS mutex）。
 * @status ROADMAP —— 待 ESP-IDF 移植填充。
 */
#include "pal_osal.h"

void pal_delay_ms(uint32_t ms) { (void)ms; }
void pal_delay_us(uint32_t us) { (void)us; }
uint64_t pal_get_ms(void) { return 0; }
uint64_t pal_get_us(void) { return 0; }
pal_mutex_t pal_mutex_create(void) { return (pal_mutex_t)0; }
wink_status_t pal_mutex_lock(pal_mutex_t m, uint32_t to) { (void)m; (void)to; return WINK_ERR_UNSUPPORTED; }
wink_status_t pal_mutex_unlock(pal_mutex_t m) { (void)m; return WINK_ERR_UNSUPPORTED; }
void pal_mutex_destroy(pal_mutex_t m) { (void)m; }

/* Phase 5 Task 5-4：ROADMAP —— 待 ESP-IDF 移植：esp_reset_reason() → pal_reset_reason_t 映射、
 * ESP-IDF task/RTC watchdog（随 P2-6）。 */
pal_reset_reason_t pal_get_reset_reason(void) { return PAL_RESET_REASON_UNKNOWN; }
WINK_WARN_UNUSED_RESULT wink_status_t pal_watchdog_init(uint32_t timeout_ms) { (void)timeout_ms; return WINK_ERR_UNSUPPORTED; }
WINK_WARN_UNUSED_RESULT wink_status_t pal_watchdog_feed(void) { return WINK_ERR_UNSUPPORTED; }

#if defined(ESP_PLATFORM) || defined(CONFIG_IDF_TARGET) || defined(INC_FREERTOS_H)
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static portMUX_TYPE s_global_mux = portMUX_INITIALIZER_UNLOCKED;

uint32_t pal_critical_enter(void) {
    portENTER_CRITICAL(&s_global_mux);
    return 0;
}

void pal_critical_exit(uint32_t key) {
    (void)key;
    portEXIT_CRITICAL(&s_global_mux);
}
#else
uint32_t pal_critical_enter(void) {
    uint32_t key;
    __asm__ __volatile__("rsil %0, 15" : "=r"(key));
    return key;
}

void pal_critical_exit(uint32_t key) {
    __asm__ __volatile__("wsr %0, ps; rsync" :: "r"(key));
}
#endif

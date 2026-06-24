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

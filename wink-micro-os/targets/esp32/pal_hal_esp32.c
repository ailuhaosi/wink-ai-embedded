/**
 * @file pal_hal_esp32.c
 * @brief ESP32 真机 PAL HAL 骨架。
 * @status ROADMAP —— 待 ESP-IDF 移植填充（ADR-0002 spike 完成后）。
 *      本文件不参与 host 构建；仅保证目录结构与签名占位。
 */
#include "pal_hal.h"

/* ROADMAP 占位：失败型 API 暂返回 WINK_ERR_UNSUPPORTED，待 ESP-IDF 移植填充 (ADR-0002 / Phase 6 Task 6-5)。
 * 读取型 pal_gpio_write(void) / pal_gpio_read(bool) 无失败语义，保持现状。 */
wink_status_t pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) { (void)pin; (void)mode; return WINK_ERR_UNSUPPORTED; }
void pal_gpio_write(uint16_t pin, bool level) { (void)pin; (void)level; }
bool pal_gpio_read(uint16_t pin) { (void)pin; return false; }
wink_status_t pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t t, pal_gpio_isr_t cb, void *a) {
    (void)pin; (void)t; (void)cb; (void)a; return WINK_ERR_UNSUPPORTED;
}
wink_status_t pal_gpio_disable_interrupt(uint16_t pin) { (void)pin; return WINK_ERR_UNSUPPORTED; }
wink_status_t pal_pwm_init(uint8_t ch, uint32_t f) { (void)ch; (void)f; return WINK_ERR_UNSUPPORTED; }
wink_status_t pal_pwm_set_duty(uint8_t ch, float d) { (void)ch; (void)d; return WINK_ERR_UNSUPPORTED; }
wink_status_t pal_i2c_transfer(uint8_t p, uint16_t a, const uint8_t *w, uint32_t wl, uint8_t *r, uint32_t rl) {
    (void)p; (void)a; (void)w; (void)wl; (void)r; (void)rl; return WINK_ERR_UNSUPPORTED;
}

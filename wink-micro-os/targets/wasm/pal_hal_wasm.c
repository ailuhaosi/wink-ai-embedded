/**
 * @file pal_hal_wasm.c
 * @brief Wasm 仿真端 PAL HAL 适配（GPIO/PWM/I2C/中断）。
 *        仅 HAL；OSAL 见 pal_osal_wasm.c；entry 见 wasm_entry.c；JS 契约见 wasm_bridge.h。
 */
#include "pal_hal.h"
#include "wasm_bridge.h"

bool pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) {
    (void)pin; (void)mode;            /* 仿真下无需硬件配置 */
    return true;
}

void pal_gpio_write(uint16_t pin, bool level) {
    js_pal_gpio_write(pin, level);
}

bool pal_gpio_read(uint16_t pin) {
    return js_pal_gpio_read(pin);
}

bool pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t intr_type, pal_gpio_isr_t callback, void *arg) {
    (void)intr_type;
    uint32_t callback_index = (uint32_t)(uintptr_t)callback;   /* C 函数指针转 Table 索引 */
    js_pal_register_interrupt(pin, callback_index, arg);
    return true;
}

bool pal_gpio_disable_interrupt(uint16_t pin) {
    js_pal_deregister_interrupt(pin);
    return true;
}

bool pal_pwm_init(uint8_t channel, uint32_t frequency_hz) {
    (void)channel; (void)frequency_hz;
    return true;
}

bool pal_pwm_set_duty(uint8_t channel, float duty_cycle_percent) {
    js_pal_pwm_set_duty(channel, duty_cycle_percent);
    return true;
}

bool pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                      const uint8_t *write_buf, uint32_t write_len,
                      uint8_t *read_buf, uint32_t read_len) {
    return js_pal_i2c_transfer(port, dev_addr, write_buf, write_len, read_buf, read_len);
}

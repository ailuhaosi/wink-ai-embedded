/**
 * @file wasm_bridge.h
 * @brief Wasm-JS 桥接契约 SSOT。
 *
 * 所有 wasm 仿真侧对 JS 的导入（js_pal_* / js_sim_*）extern 声明集中在此，
 * 杜绝散落在 pal_hal_wasm.c / pal_osal_wasm.c / dal_*.c 多处的漂移
 * （03-directory-architecture.md §9 迁移项3 / ADR-0003 SSOT 闭环）。
 *
 * 约定：js_sim_*（DAL bypass）契约以 Device Registry 为 SSOT，本头抄 Registry。
 *       Plan 4 会在此追加 js_sim_trigger_ultrasonic / js_sim_measure_echo_pulse_us。
 */
#ifndef WASM_BRIDGE_H
#define WASM_BRIDGE_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ---- PAL HAL 侧 JS 导入（来自旧 pal_hal_wasm.c）---- */
extern void js_pal_gpio_write(uint16_t pin, bool level);
extern bool js_pal_gpio_read(uint16_t pin);
extern void js_pal_pwm_set_duty(uint8_t channel, float duty_cycle_percent);
extern bool js_pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                                const uint8_t *write_buf, uint32_t write_len,
                                uint8_t *read_buf, uint32_t read_len);
extern void js_pal_register_interrupt(uint16_t pin, uint32_t callback_index, void *arg);
extern void js_pal_deregister_interrupt(uint16_t pin);

/* ---- PAL OSAL 侧 JS 导入 ---- */
extern void js_pal_delay_ms(uint32_t ms);
extern void js_pal_delay_us(uint32_t us);
extern uint64_t js_pal_get_ms(void);
extern uint64_t js_pal_get_us(void);

/* ---- DAL bypass 侧 JS 导入（js_sim_*）—— Plan 4 填充 ---- */

#ifdef __cplusplus
}
#endif

#endif /* WASM_BRIDGE_H */

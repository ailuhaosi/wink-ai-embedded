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
/* ---- 中断回调索引边界（Phase 6 Task 6-3 / P2-4）----
 * callback_index 是**不透明 JS function table 索引**，不是 C 函数指针。
 *   - 禁在单一 wasm adapter 边界（pal_hal_wasm.c enable_interrupt ↔ wasm_entry.c
 *     trigger_wasm_interrupt）之外把任意非零整数 cast 成 pal_gpio_isr_t。
 *   - wasm64 下裸 (uint32_t)(uintptr_t) cast 会截断（索引 > 2^32 时丢高位）。
 *   - 分发前须校验 index 在已注册范围内——isr != NULL 不能防错误非零索引。
 *   - 长期：用 Emscripten addFunction / function table registry 替代裸 cast。
 * 中断桥安全分两维：索引安全（本约束）＋ 时序安全（Asyncify sleeping 窗口禁重入
 * _trigger_wasm_interrupt，见 docs/04 01-wasm-sandbox-lifecycle.md §4.4 / Phase 1 Task 1-5）。 */
extern void js_pal_register_interrupt(uint16_t pin, uint32_t callback_index, void *arg);
extern void js_pal_deregister_interrupt(uint16_t pin);

/* ---- PAL OSAL 侧 JS 导入 ---- */
extern void js_pal_delay_ms(uint32_t ms);
extern void js_pal_delay_us(uint32_t us);
extern uint64_t js_pal_get_ms(void);
extern uint64_t js_pal_get_us(void);

/* ---- DAL bypass 侧 JS 导入（js_sim_*）—— 签名抄 Device Registry (01-device-model-registry.md) ----
 * 仅在 #ifdef SIMULATION 下被 DAL 引用；真机分支不编译本段。
 * ADR-0003 决策2：只旁路最底层物理量来源（trigger 时序 + echo 脉宽），换算/超时两端同源。 */
extern void     js_sim_trigger_ultrasonic(uint16_t trig_pin);
extern uint32_t js_sim_measure_echo_pulse_us(uint16_t trig_pin);

#ifdef __cplusplus
}
#endif

#endif /* WASM_BRIDGE_H */

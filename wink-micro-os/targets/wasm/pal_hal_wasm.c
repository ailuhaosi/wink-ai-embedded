/**
 * @file pal_hal_wasm.c
 * @brief Wasm 仿真端 PAL HAL 适配（GPIO/PWM/I2C/中断）。
 *        仅 HAL；OSAL 见 pal_osal_wasm.c；entry 见 wasm_entry.c；JS 契约见 wasm_bridge.h。
 *
 * 中断桥（方案 C：Poll 模型）：
 *   pal_gpio_enable_interrupt → js_pal_register_interrupt（仅写 JS 侧 pending 表映射）
 *   pal_wasm_dispatch_pending_interrupts → 由 wink_runtime.c tick 边界调用，drain JS pending 队列
 *   旧 _trigger_wasm_interrupt 导出已移除（wasm_entry.c），彻底消除 Asyncify sleeping 窗口重入面。
 */
#include "pal_hal.h"
#include "pal_pwm_router.h"
#include "wasm_bridge.h"
#include "pal_wasm_internal.h"

wink_status_t pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) {
    (void)pin; (void)mode;            /* 仿真下无需硬件配置 */
    return WINK_OK;
}

void pal_gpio_write(uint16_t pin, bool level) {
    js_pal_gpio_write(pin, level);
}

bool pal_gpio_read(uint16_t pin) {
    return js_pal_gpio_read(pin);
}

wink_status_t pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t intr_type,
                                         pal_gpio_isr_t callback, void *arg) {
    (void)intr_type;
    /* C 函数指针转 Wasm Table 索引（wasm32 安全；wasm64 迁移见 Phase 6 Task 6-3）*/
    uint32_t callback_index = (uint32_t)(uintptr_t)callback;
    uint32_t arg_ptr        = (uint32_t)(uintptr_t)arg;
    /* 告知 JS 侧 pin → (index, arg_ptr) 映射；JS 在事件到来时只写 pending 队列，不回调 Wasm */
    js_pal_register_interrupt(pin, callback_index, arg_ptr);
    return WINK_OK;
}

wink_status_t pal_gpio_disable_interrupt(uint16_t pin) {
    js_pal_deregister_interrupt(pin);
    return WINK_OK;
}

/**
 * @brief 分发 JS pending 中断（方案 C：tick 边界主动拉取）。
 *
 * 循环调用 js_pal_poll_interrupt 直到队列为空（FIFO 顺序），对每个 pending 条目
 * 将 callback_index 还原为函数指针并调用 ISR。
 *
 * 调用方：wink_runtime.c 在 #ifdef SIMULATION 下、wink_app_delay_ms() 之前调用本函数。
 * 此时 Wasm 处于正常运行态（非 Asyncify sleeping），ISR 执行安全，无重入风险。
 */
void pal_wasm_dispatch_pending_interrupts(void) {
    uint32_t callback_index;
    uint32_t arg_ptr;
    /* drain 所有 pending 中断（FIFO）直到队列空 */
    while (js_pal_poll_interrupt(&callback_index, &arg_ptr)) {
        pal_gpio_isr_t isr = (pal_gpio_isr_t)(uintptr_t)callback_index;
        if (isr != NULL) {
            isr((void *)(uintptr_t)arg_ptr);
        }
    }
}

wink_status_t pal_pwm_init(uint8_t channel, uint32_t frequency_hz) {
    uint8_t timer_num = 0;
    /* wasm 无资源表/硬件，但 router 提供通道/频率校验与槽位记账，保持与 host/esp32 一致。*/
    return pal_pwm_router_acquire(channel, frequency_hz, &timer_num);
}

wink_status_t pal_pwm_set_duty(uint8_t channel, float duty_cycle_percent) {
    if (!pal_pwm_router_channel_ready(channel)) { return WINK_ERR_INVALID_ARG; }
    js_pal_pwm_set_duty(channel, duty_cycle_percent);
    return WINK_OK;
}

void pal_pwm_deinit(uint8_t channel) {
    pal_pwm_router_release(channel);   /* no-op if uninitialized */
}

wink_status_t pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                      const uint8_t *write_buf, uint32_t write_len,
                      uint8_t *read_buf, uint32_t read_len) {
    /* JS 侧同步零拷贝 transfer：false → WINK_ERR_IO */
    return js_pal_i2c_transfer(port, dev_addr, write_buf, write_len, read_buf, read_len)
           ? WINK_OK : WINK_ERR_IO;
}

wink_status_t pal_gpio_pulse_in(uint16_t pin, bool level, uint32_t timeout_us, uint32_t *pulse_us) {
    /* Phase 4：经 bridge 同步测 echo 脉宽（非 Asyncify 挂起点，不入 IMPORTS）。
     * pin 映射 / UNSUPPORTED 随 virtual registry routing 接入（Phase 6）。 */
    if (pulse_us == NULL) { return WINK_ERR_INVALID_ARG; }
    (void)level; (void)timeout_us;
    *pulse_us = js_sim_measure_echo_pulse_us(pin);
    return WINK_OK;
}

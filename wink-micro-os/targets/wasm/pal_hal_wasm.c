/**
 * @file pal_hal_wasm.c
 * @brief WebAssembly 仿真沙箱平台适配器实现
 */

#include "pal_hal.h"
#include "pal_osal.h"
#include <stdlib.h>

#ifdef EMSCRIPTEN
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

/* ========================================================================== */
/*                             1. 声明外部 JS 导入函数                          */
/* ========================================================================== */

extern void js_pal_gpio_write(uint16_t pin, bool level);
extern bool js_pal_gpio_read(uint16_t pin);
extern void js_pal_pwm_set_duty(uint8_t channel, float duty_cycle_percent);
extern bool js_pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                                const uint8_t *write_buf, uint32_t write_len,
                                uint8_t *read_buf, uint32_t read_len);

extern void js_pal_delay_ms(uint32_t ms);
extern void js_pal_delay_us(uint32_t us);
extern uint64_t js_pal_get_ms(void);
extern uint64_t js_pal_get_us(void);

extern void js_pal_register_interrupt(uint16_t pin, uint32_t callback_index, void *arg);
extern void js_pal_deregister_interrupt(uint16_t pin);


/* ========================================================================== */
/*                            2. 实现 PAL HAL 仿真适配                        */
/* ========================================================================== */

bool pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) {
    // 仿真模式下通常无需底层硬件配置，直接返回初始化成功
    (void)pin;
    (void)mode;
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
    // 将 C 函数指针强制转换为 uint32_t 索引，以便 JS Table 存储和调用
    uint32_t callback_index = (uint32_t)(uintptr_t)callback;
    js_pal_register_interrupt(pin, callback_index, arg);
    return true;
}

bool pal_gpio_disable_interrupt(uint16_t pin) {
    js_pal_deregister_interrupt(pin);
    return true;
}

bool pal_pwm_init(uint8_t channel, uint32_t frequency_hz) {
    (void)channel;
    (void)frequency_hz;
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


/* ========================================================================== */
/*                            3. 实现 PAL OSAL 仿真适配                       */
/* ========================================================================== */

void pal_delay_ms(uint32_t ms) {
    // Asyncify 挂起，由 JS 在对应毫秒后唤醒
    js_pal_delay_ms(ms);
}

void pal_delay_us(uint32_t us) {
    // 短时间延迟，在 Web 端通常可以使用微秒级忙等待或交给 JS 挂起
    js_pal_delay_us(us);
}

uint64_t pal_get_ms(void) {
    return js_pal_get_ms();
}

uint64_t pal_get_us(void) {
    return js_pal_get_us();
}

// 仿真环境下互斥锁简化实现 (单线程 Wasm Worker 沙箱通常不需要真实的锁竞争锁)
pal_mutex_t pal_mutex_create(void) {
    return (pal_mutex_t)1;
}

bool pal_mutex_lock(pal_mutex_t mutex, uint32_t timeout_ms) {
    (void)mutex;
    (void)timeout_ms;
    return true;
}

bool pal_mutex_unlock(pal_mutex_t mutex) {
    (void)mutex;
    return true;
}

void pal_mutex_destroy(pal_mutex_t mutex) {
    (void)mutex;
}


/* ========================================================================== */
/*                       4. 导出给 JS 侧调用的中断桩入口                        */
/* ========================================================================== */

/**
 * @brief 当 JS 侧仿真传感器或按键产生状态中断时，调用此接口执行 C 语言的中断回调
 * @param callback_index 注册中断时 C 侧传给 JS 的函数指针索引
 * @param arg 中断上下文参数指针
 */
EMSCRIPTEN_KEEPALIVE
void trigger_wasm_interrupt(uint32_t callback_index, void *arg) {
    pal_gpio_isr_t isr = (pal_gpio_isr_t)(uintptr_t)callback_index;
    if (isr != NULL) {
        isr(arg);
    }
}

// Wasm 主入口主控循环
int main(void) {
    // 初始化时钟与调度环境
    return 0;
}

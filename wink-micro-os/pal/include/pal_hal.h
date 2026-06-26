/**
 * @file pal_hal.h
 * @brief 通用硬件总线与外设抽象接口 (HAL)
 */

#ifndef PAL_HAL_H
#define PAL_HAL_H

#include <stdint.h>
#include <stdbool.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================== */
/*                                1. GPIO 抽象                                */
/* ========================================================================== */

typedef enum {
    PAL_GPIO_INPUT,                 ///< 数字输入，默认浮空
    PAL_GPIO_INPUT_PULLUP,          ///< 数字输入，内部上拉
    PAL_GPIO_INPUT_PULLDOWN,        ///< 数字输入，内部下拉
    PAL_GPIO_OUTPUT_PUSH_PULL,      ///< 推挽输出
    PAL_GPIO_OUTPUT_OPEN_DRAIN      ///< 开漏输出
} pal_gpio_mode_t;

typedef enum {
    PAL_GPIO_INTR_DISABLE,          ///< 禁用中断
    PAL_GPIO_INTR_RISING_EDGE,      ///< 上升沿触发
    PAL_GPIO_INTR_FALLING_EDGE,     ///< 下降沿触发
    PAL_GPIO_INTR_ANY_EDGE          ///< 双沿触发
} pal_gpio_intr_t;

typedef void (*pal_gpio_isr_t)(void *arg);

/**
 * @brief 初始化 GPIO 引脚配置
 * @note 失败型：返回 wink_status_t。资源占用治理（host）见 Phase 2 resource guard。
 *       读取型 pal_gpio_write(void) / pal_gpio_read(bool) 无失败语义，保持现状。
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode);

/**
 * @brief 写入 GPIO 引脚输出电平（不可失败，保持 void）
 */
void pal_gpio_write(uint16_t pin, bool level);

/**
 * @brief 读取 GPIO 引脚输入电平（不可失败，保持 bool）
 */
bool pal_gpio_read(uint16_t pin);

/**
 * @brief 配置并启用 GPIO 引脚中断
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t intr_type, pal_gpio_isr_t callback, void *arg);

/**
 * @brief 禁用 GPIO 引脚中断
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_gpio_disable_interrupt(uint16_t pin);

/**
 * @brief 捕获指定引脚上的脉冲宽度（过渡 capture API；最终目标 async capture/callback，Phase 4 Task 4-5）
 * @param pin 引脚号
 * @param level 测量的脉冲电平（true=高电平脉宽，如 HC-SR04 echo）
 * @param timeout_us 超时阈值 μs
 * @param pulse_us [out] 输出脉宽 μs
 * @return WINK_OK / WINK_ERR_INVALID_ARG(pulse_us NULL) / WINK_ERR_TIMEOUT / WINK_ERR_UNSUPPORTED / WINK_ERR_IO
 * @note Blocking: target-defined，**禁**从 BAL/runtime 10ms tick 直接调用（仅供非阻塞 DAL 过渡）。
 *       ISR-safe: No; Thread-safe: target-defined。wasm 下同步返回（非 Asyncify 挂起点，不入 IMPORTS）。
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_gpio_pulse_in(uint16_t pin, bool level, uint32_t timeout_us, uint32_t *pulse_us);


/* ========================================================================== */
/*                                2. PWM 抽象                                 */
/* ========================================================================== */

/** @brief 平台无关 PWM 逻辑通道上限（各 target 与 router 统一引用）。*/
#define PAL_PWM_CHANNELS 8

/**
 * @brief 初始化指定通道的 PWM 发生器
 * @param channel 逻辑 PWM 通道号
 * @param frequency_hz PWM 频率 (单位: Hz)
 * @note 失败型：非法 channel（host: >= PWM_CHANNELS）返回 WINK_ERR_INVALID_ARG；
 *       Phase 2 起资源占用返回 WINK_ERR_BUSY / WINK_ERR_RESOURCE_EXHAUSTED。
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_pwm_init(uint8_t channel, uint32_t frequency_hz);

/**
 * @brief 设置指定通道的 PWM 占空比
 * @param channel 逻辑 PWM 通道号
 * @param duty_cycle_percent 占空比浮点百分比 (0.0f 到 100.0f)
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_pwm_set_duty(uint8_t channel, float duty_cycle_percent);

/**
 * @brief 释放指定 PWM 通道（清零占空比、释放通道占用、递减 timer 引用计数）。
 * @note void 返回：deinit 为 best-effort，不应失败；未初始化 channel 调用为 no-op。
 */
void pal_pwm_deinit(uint8_t channel);


/* ========================================================================== */
/*                               3. I2C 总线抽象                              */
/* ========================================================================== */

/**
 * @brief I2C 双向传输接口
 * @param port 逻辑 I2C 端口号
 * @param dev_addr 目标从机 I2C 地址 (7位/10位)
 * @param write_buf 待写入数据缓冲区，为 NULL 则不写入
 * @param write_len 待写入数据长度，为 0 则不写入
 * @param read_buf 待读取数据缓冲区，为 NULL 则不读取
 * @param read_len 待读取数据长度，为 0 则不读取
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                      const uint8_t *write_buf, uint32_t write_len,
                      uint8_t *read_buf, uint32_t read_len);

#ifdef __cplusplus
}
#endif

#endif /* PAL_HAL_H */

/**
 * @file pal_hal.h
 * @brief 通用硬件总线与外设抽象接口 (HAL)
 */

#ifndef PAL_HAL_H
#define PAL_HAL_H

#include <stdint.h>
#include <stdbool.h>

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
 */
bool pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode);

/**
 * @brief 写入 GPIO 引脚输出电平
 */
void pal_gpio_write(uint16_t pin, bool level);

/**
 * @brief 读取 GPIO 引脚输入电平
 */
bool pal_gpio_read(uint16_t pin);

/**
 * @brief 配置并启用 GPIO 引脚中断
 */
bool pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t intr_type, pal_gpio_isr_t callback, void *arg);

/**
 * @brief 禁用 GPIO 引脚中断
 */
bool pal_gpio_disable_interrupt(uint16_t pin);


/* ========================================================================== */
/*                                2. PWM 抽象                                 */
/* ========================================================================== */

/**
 * @brief 初始化指定通道的 PWM 发生器
 * @param channel 逻辑 PWM 通道号
 * @param frequency_hz PWM 频率 (单位: Hz)
 */
bool pal_pwm_init(uint8_t channel, uint32_t frequency_hz);

/**
 * @brief 设置指定通道的 PWM 占空比
 * @param channel 逻辑 PWM 通道号
 * @param duty_cycle_percent 占空比浮点百分比 (0.0f 到 100.0f)
 */
bool pal_pwm_set_duty(uint8_t channel, float duty_cycle_percent);


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
bool pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                      const uint8_t *write_buf, uint32_t write_len,
                      uint8_t *read_buf, uint32_t read_len);

#ifdef __cplusplus
}
#endif

#endif // PAL_HAL_H

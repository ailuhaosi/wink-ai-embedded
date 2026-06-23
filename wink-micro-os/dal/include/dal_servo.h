/**
 * @file dal_servo.h
 * @brief 逻辑器件层 - SG90 / 模拟舵机控制器驱动接口
 */

#ifndef DAL_SERVO_H
#define DAL_SERVO_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief 舵机逻辑控制器句柄
 */
typedef struct {
    uint8_t pwm_channel;    ///< 绑定物理 PWM 控制器通道
    float current_angle;    ///< 舵机当前角度 (0.0 到 180.0°)
    float min_pulse_ms;     ///< 0度对应的正脉宽 ms，默认 0.5f
    float max_pulse_ms;     ///< 180度对应的正脉宽 ms，默认 2.5f
} dal_servo_t;

/**
 * @brief 设置舵机偏转角度
 * @param dev 舵机句柄
 * @param angle 目标角度 (0.0f 到 180.0f)
 * @return bool 是否执行成功
 */
bool dal_servo_set_angle(dal_servo_t *dev, float angle);

#ifdef __cplusplus
}
#endif

#endif // DAL_SERVO_H

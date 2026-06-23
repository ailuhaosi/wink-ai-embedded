/**
 * @file dal_ultrasonic.h
 * @brief 逻辑器件层 - HC-SR04 超声波测距传感器驱动接口
 */

#ifndef DAL_ULTRASONIC_H
#define DAL_ULTRASONIC_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief 超声波传感器逻辑句柄
 */
typedef struct {
    uint16_t trig_pin;      ///< 绑定物理 Trigger 引脚
    uint16_t echo_pin;      ///< 绑定物理 Echo 引脚
    float last_distance;    ///< 最近一次测量的距离值 (单位: cm)
} dal_ultrasonic_t;

/**
 * @brief 获取当前障碍物物理距离 (厘米)
 * @param dev 传感器实例句柄
 * @return float 距离值 (0.0 到 400.0cm)，若超时或异常返回 -1.0f
 */
float dal_ultrasonic_get_distance(dal_ultrasonic_t *dev);

#ifdef __cplusplus
}
#endif

#endif // DAL_ULTRASONIC_H

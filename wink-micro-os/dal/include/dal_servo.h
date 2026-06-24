#ifndef DAL_SERVO_H
#define DAL_SERVO_H

#include <stdint.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint8_t pwm_channel;
    float current_angle;
    float min_pulse_ms;
    float max_pulse_ms;
} dal_servo_t;

/**
 * @brief 设置舵机偏转角度
 * @param dev 舵机实例句柄
 * @param angle 目标角度 (0.0~180.0 度，超出范围自动钳位)
 * @return wink_status_t (0=成功，负数=错误码)
 *
 * @note API Contract:
 *   - Blocking: No
 *   - Thread-safe: No (多任务访问需外部互斥)
 *   - ISR-safe: No
 *   - Input-range: dev 非 NULL；min/max_pulse_ms 须有效
 *   - Error-codes: WINK_OK / WINK_ERR_INVALID_ARG(dev NULL) / WINK_ERR_IO(PAL 失败)
 *   - Postconditions: dev->current_angle 更新为钳位后的目标角度
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle);

#ifdef __cplusplus
}
#endif

#endif /* DAL_SERVO_H */

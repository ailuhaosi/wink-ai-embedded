#ifndef DAL_ULTRASONIC_H
#define DAL_ULTRASONIC_H

#include <stdint.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint16_t trig_pin;
    uint16_t echo_pin;
    float last_distance;    ///< 最近一次测量距离 (cm)
} dal_ultrasonic_t;

/**
 * @brief 获取障碍物距离 (cm)
 * @param dev 传感器实例
 * @param distance_cm 输出距离 (0.0~400.0cm)
 * @return wink_status_t (0=成功，负数=错误码)
 *
 * @note API Contract:
 *   - Blocking: Yes (MAX 30ms timeout, software polling loop)
 *   - Thread-safe: No; ISR-safe: No (含阻塞 delay/polling)
 *   - Input-range: dev/distance_cm 非 NULL
 *   - Error-codes: WINK_OK / WINK_ERR_INVALID_ARG / WINK_ERR_TIMEOUT
 *   - Postconditions: dev->last_distance 在 WINK_OK 时更新
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm);

#ifdef __cplusplus
}
#endif

#endif /* DAL_ULTRASONIC_H */

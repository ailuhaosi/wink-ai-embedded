#ifndef DAL_ULTRASONIC_H
#define DAL_ULTRASONIC_H

#include <stdint.h>
#include <stdbool.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint16_t trig_pin;
    uint16_t echo_pin;
    float last_distance;     ///< 最近一次测量距离 (cm)
    bool initialized;        ///< Phase 2：dal_ultrasonic_init 成功后置 true
} dal_ultrasonic_t;

/**
 * @brief 初始化超声波：校验引脚、配置 GPIO 方向（真机）、置 initialized。
 * @note API Contract:
 *   - Preconditions: dev 非 NULL；trig_pin != echo_pin。
 *   - Blocking: No.
 *   - Thread-safe: No; ISR-safe: No.
 *   - Error-codes: WINK_OK / WINK_ERR_INVALID_ARG(NULL/同 pin) / 透传 PAL 错误
 *     （真机：WINK_ERR_IO / WINK_ERR_BUSY / WINK_ERR_RESOURCE_EXHAUSTED）。
 *   - Postconditions: WINK_OK 时 dev->initialized=true；trig/echo 方向已配置（真机）。
 *   - Sim 分支：跳过物理 GPIO 配置（旁路最低物理信号层，ADR-0003 决策2），仅置结构状态。
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_ultrasonic_init(dal_ultrasonic_t *dev, uint16_t trig_pin, uint16_t echo_pin);

/**
 * @brief 获取障碍物距离 (cm)（阻塞；Phase 4 将提供非阻塞 request/get_cached 替代）
 * @param dev 传感器实例
 * @param distance_cm 输出距离 (0.0~400.0cm)
 * @return wink_status_t (0=成功，负数=错误码)
 *
 * @note API Contract:
 *   - Preconditions: dev/distance_cm 非 NULL；dal_ultrasonic_init() 已成功。
 *   - Blocking: Yes (MAX 30ms timeout, software polling loop)
 *   - Thread-safe: No; ISR-safe: No (含阻塞 delay/polling)
 *   - Input-range: dev/distance_cm 非 NULL
 *   - Error-codes: WINK_OK / WINK_ERR_INVALID_ARG / WINK_ERR_NOT_INITIALIZED / WINK_ERR_TIMEOUT
 *   - Postconditions: dev->last_distance 在 WINK_OK 时更新
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm);

#ifdef __cplusplus
}
#endif

#endif /* DAL_ULTRASONIC_H */

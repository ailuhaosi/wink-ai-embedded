#ifndef DAL_LED_H
#define DAL_LED_H

#include <stdint.h>
#include <stdbool.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief LED 逻辑句柄（POD，ADR-0004 静态分发）
 *
 * 成员按对齐需求降序排列（c-code.md §4）：uint16_t → bool ×3 → 自然对齐。
 */
typedef struct {
    uint16_t pin;          /* 逻辑 GPIO 引脚 */
    bool active_high;      /* true: 高电平点亮；false: 低电平点亮（active low） */
    bool is_on;            /* 缓存当前点亮状态 */
    bool initialized;      /* init 成功后置 true */
} dal_led_t;

/**
 * @brief 初始化 LED：校验引脚、配置 GPIO 推挽输出、置 initialized。
 * @param dev LED 实例句柄
 * @param pin 逻辑 GPIO 引脚
 * @param active_high true=高电平点亮；false=低电平点亮
 * @return wink_status_t
 * @note API Contract:
 *   - Preconditions: dev 非 NULL。
 *   - Blocking: No（pal_gpio_init 不阻塞）。
 *   - Thread-safe: No; ISR-safe: No.
 *   - Error-codes: WINK_OK / WINK_ERR_INVALID_ARG(NULL) / 透传 PAL 错误
 *     （WINK_ERR_IO / WINK_ERR_BUSY / WINK_ERR_RESOURCE_EXHAUSTED）。
 *   - Postconditions: WINK_OK 时 dev->initialized=true；GPIO 方向已配置（真机）。
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_init(dal_led_t *dev, uint16_t pin, bool active_high);

/**
 * @brief 点亮 LED
 * @note API Contract:
 *   - Preconditions: dev 非 NULL；dal_led_init() 已成功。
 *   - Blocking: No.
 *   - Error-codes: WINK_OK / WINK_ERR_INVALID_ARG(dev NULL) / WINK_ERR_NOT_INITIALIZED。
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_on(dal_led_t *dev);

/**
 * @brief 熄灭 LED
 * @note API Contract: 同 dal_led_on。
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_off(dal_led_t *dev);

/**
 * @brief 设置 LED 显式开关状态
 * @param on true=点亮；false=熄灭
 * @note API Contract: 同 dal_led_on。
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_set(dal_led_t *dev, bool on);

/**
 * @brief 翻转 LED 状态（on↔off）
 * @note API Contract: 同 dal_led_on。
 */
WINK_WARN_UNUSED_RESULT
wink_status_t dal_led_toggle(dal_led_t *dev);

#ifdef __cplusplus
}
#endif

#endif /* DAL_LED_H */

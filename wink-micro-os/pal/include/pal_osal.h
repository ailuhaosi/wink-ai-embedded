/**
 * @file pal_osal.h
 * @brief 操作系统与内核环境抽象接口 (OSAL)
 */

#ifndef PAL_OSAL_H
#define PAL_OSAL_H

#include <stdint.h>
#include <stdbool.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================== */
/*                                1. 系统时间与时延                            */
/* ========================================================================== */

/**
 * @brief 系统毫秒延时 (主动阻塞让出 CPU 调度)
 */
void pal_delay_ms(uint32_t ms);

/**
 * @brief 系统微秒延时 (高精度短等待)
 */
void pal_delay_us(uint32_t us);

/**
 * @brief 获取系统从启动至今的毫秒数
 */
uint64_t pal_get_ms(void);

/**
 * @brief 获取系统从启动至今的微秒数 (用于高精度时序测算)
 */
uint64_t pal_get_us(void);


/* ========================================================================== */
/*                           2. 简单互斥锁/信号量支撑                          */
/* ========================================================================== */

typedef void* pal_mutex_t;

/**
 * @brief 创建一个互斥锁句柄
 */
pal_mutex_t pal_mutex_create(void);

/**
 * @brief 获取互斥锁 (锁定)
 * @param mutex 锁句柄
 * @param timeout_ms 阻塞超时时间，传入 0xFFFFFFFF 代表无限等待
 * @note 失败型：NULL mutex → WINK_ERR_INVALID_ARG；timeout → WINK_ERR_TIMEOUT；
 *       不支持 target → WINK_ERR_UNSUPPORTED。
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_mutex_lock(pal_mutex_t mutex, uint32_t timeout_ms);

/**
 * @brief 释放互斥锁 (解锁)
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_mutex_unlock(pal_mutex_t mutex);

/**
 * @brief 销毁互斥锁并释放内存
 */
void pal_mutex_destroy(pal_mutex_t mutex);


/* ========================================================================== */
/*                        3. 看门狗与复位原因 (WDT / Reset)                    */
/* ========================================================================== */

/** @brief 复位原因（Phase 5 Task 5-4） */
typedef enum {
    PAL_RESET_REASON_UNKNOWN  = 0,
    PAL_RESET_REASON_POWER_ON = 1,
    PAL_RESET_REASON_WATCHDOG = 2,
    PAL_RESET_REASON_PANIC    = 3,
} pal_reset_reason_t;

/**
 * @brief 读取上次复位原因（boot safe-lock 判定用，Phase 5 Task 5-5）。
 * @note host 返回可配置值（供测试）；wasm 返回 UNKNOWN；esp32 映射 esp_reset_reason()（随 P2-6）。
 */
pal_reset_reason_t pal_get_reset_reason(void);

/**
 * @brief 初始化硬件看门狗
 * @note host 为无操作 stub（WINK_OK）；wasm 返回 WINK_ERR_UNSUPPORTED（无浏览器 watchdog 策略）；
 *       esp32 映射 ESP-IDF task/RTC watchdog（随 P2-6）。
 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_watchdog_init(uint32_t timeout_ms);

/** @brief 喂狗（周期调用防止复位）。target 规则同 pal_watchdog_init。 */
WINK_WARN_UNUSED_RESULT wink_status_t pal_watchdog_feed(void);

#ifdef __cplusplus
}
#endif

#endif // PAL_OSAL_H

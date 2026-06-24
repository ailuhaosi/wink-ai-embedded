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

#ifdef __cplusplus
}
#endif

#endif // PAL_OSAL_H

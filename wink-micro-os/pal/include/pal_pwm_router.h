/**
 * @file pal_pwm_router.h
 * @brief target 无关的 PWM 定时器分配状态机（LEDC timer 槽 + 引用计数）。
 *
 * 由 host/wasm/esp32 三个 target 共享链接，使 LEDC timer 分配逻辑在 host CI 可测。
 * 纯逻辑：无硬件调用、无锁、无堆。
 *
 * 非并发契约：仅从 PAL 初始化任务调用（wink_runtime_run 先 init 后 loop，init 完成才
 * 进入 tick；set_duty 只读 channel_ready，不与 init 交叠）。故内部不持锁——锁本身是
 * hazard，本路径不存在并发。
 */
#ifndef PAL_PWM_ROUTER_H
#define PAL_PWM_ROUTER_H

#include <stdint.h>
#include <stdbool.h>
#include "wink_status.h"
#include "pal_hal.h"   /* PAL_PWM_CHANNELS */

#ifdef __cplusplus
extern "C" {
#endif

/** @brief LEDC 低速定时器上限（经典 ESP32 / S3 / C3 均为 4）。*/
#define PAL_PWM_TIMERS 4

/**
 * @brief 为 channel 预约频率，输出应绑定的 timer 编号。
 * @param channel   逻辑 PWM 通道 [0, PAL_PWM_CHANNELS)
 * @param freq_hz   频率 (Hz)，须 > 0
 * @param out_timer_num [out] 分配/复用的 timer 编号 [0, PAL_PWM_TIMERS)
 * @return WINK_OK / WINK_ERR_INVALID_ARG / WINK_ERR_BUSY / WINK_ERR_RESOURCE_EXHAUSTED
 *
 * 语义：
 *  - channel 越界 / freq_hz==0 / out==NULL  → WINK_ERR_INVALID_ARG（状态不变）
 *  - channel 已初始化且同 freq              → WINK_OK（幂等，out 为原 timer）
 *  - channel 已初始化且异 freq              → WINK_ERR_BUSY（状态不变）
 *  - 新频率且 4 个 timer 全占                → WINK_ERR_RESOURCE_EXHAUSTED
 *  - 否则复用同频 timer 或分配空闲 timer      → WINK_OK
 */
WINK_WARN_UNUSED_RESULT
wink_status_t pal_pwm_router_acquire(uint8_t channel, uint32_t freq_hz,
                                     uint8_t *out_timer_num);

/**
 * @brief 释放 channel：递减其 timer 引用计数，归零则回收 timer 槽。
 *        未初始化 channel 为 no-op。调用方应在调用前完成硬件 stop。
 */
void pal_pwm_router_release(uint8_t channel);

/** @brief channel 是否已就绪（set_duty 守卫）。*/
bool pal_pwm_router_channel_ready(uint8_t channel);

/** @brief channel 当前绑定的 timer；未就绪返回 0xFF。*/
uint8_t pal_pwm_router_channel_timer(uint8_t channel);

/** @brief 清空所有表（测试隔离 / 启动重置）。BSS 零初始化已满足真机启动，主要供 host 测试。*/
void pal_pwm_router_reset(void);

#ifdef __cplusplus
}
#endif

#endif /* PAL_PWM_ROUTER_H */

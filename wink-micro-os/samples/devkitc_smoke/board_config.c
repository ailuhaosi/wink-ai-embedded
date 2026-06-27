/**
 * @file board_config.c
 * @brief DevKitC 板级硬件路由（覆盖 esp32 target 的弱默认 pal_pwm_pin_map）。
 *
 * S5 PWM 测试使用通道 1（GPIO4）和通道 2（GPIO5）验证异频隔离。
 */
#include "pal_hal.h"

/* 强定义，覆盖 esp32 target 的弱默认。GPIO2 预留作 LED，
 * 通道 1=GPIO4，通道 2=GPIO5（与 avoidance_car 一致）。*/
const uint16_t pal_pwm_pin_map[PAL_PWM_CHANNELS] = {2, 4, 5, 18, 19, 21, 22, 23};

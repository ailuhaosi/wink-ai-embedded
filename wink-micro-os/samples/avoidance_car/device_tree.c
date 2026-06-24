/**
 * @file device_tree.c
 * @brief 设备实例静态分配（零动态分配，§6.1 约束1）。
 *        真实 codegen 会据画布连线生成；此处手动演示。
 */
#include "device_tree.h"

dal_ultrasonic_t front_radar = {
    .trig_pin = 4,
    .echo_pin = 5,
    .last_distance = 0.0f,
};

dal_servo_t neck_servo = {
    .pwm_channel = 0,
    .current_angle = 90.0f,
    .min_pulse_ms = 0.5f,
    .max_pulse_ms = 2.5f,
};

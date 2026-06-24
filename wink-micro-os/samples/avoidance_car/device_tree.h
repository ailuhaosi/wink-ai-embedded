/**
 * @file device_tree.h
 * @brief avoidance_car 示例 App 的设备树声明（codegen 产物占位；手动编写演示注入点）。
 */
#ifndef DEVICE_TREE_H
#define DEVICE_TREE_H

#include "dal_ultrasonic.h"
#include "dal_servo.h"

extern dal_ultrasonic_t front_radar;
extern dal_servo_t      neck_servo;

#endif /* DEVICE_TREE_H */

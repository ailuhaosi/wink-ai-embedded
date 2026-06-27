/**
 * @file device_tree.c
 * @brief DevKitC 冒烟测试静态设备实例（零动态分配，§6.1 约束1）。
 */
#include "device_tree.h"

dal_led_t    board_led   = {0};
dal_button_t boot_button = {0};

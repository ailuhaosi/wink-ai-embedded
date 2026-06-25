/**
 * @file device_tree.h
 * @brief OLED Dashboard 示例 App 的设备树声明。
 */
#ifndef DEVICE_TREE_H
#define DEVICE_TREE_H

#include "dal_button.h"
#include "dal_led.h"
#include "dal_ssd1306.h"

extern dal_button_t   user_button;
extern dal_led_t      status_led;
extern dal_ssd1306_t  status_oled;

#endif /* DEVICE_TREE_H */

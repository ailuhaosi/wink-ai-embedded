/**
 * @file device_tree.c
 * @brief OLED Dashboard 设备实例静态分配（零动态分配）。
 */
#include "device_tree.h"

dal_button_t  user_button = {0};
dal_led_t     status_led  = {0};
dal_ssd1306_t status_oled = {0};

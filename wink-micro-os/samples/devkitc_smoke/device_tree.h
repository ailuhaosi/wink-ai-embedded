/**
 * @file device_tree.h
 * @brief DevKitC 冒烟测试设备树声明（LED + Boot 按钮）。
 */
#ifndef DEVICE_TREE_H
#define DEVICE_TREE_H

#include "dal_button.h"
#include "dal_led.h"

#define BOARD_LED_PIN     2u    /* DevKitC 板载 LED（GPIO2，active-high） */
#define BOOT_BUTTON_PIN   0u    /* GPIO0 Boot 按键（active-low，内部上拉） */

extern dal_led_t    board_led;
extern dal_button_t boot_button;

#endif /* DEVICE_TREE_H */

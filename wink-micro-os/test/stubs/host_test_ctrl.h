/**
 * @file host_test_ctrl.h
 * @brief host 测试专用注入控制 API（非 PAL 契约，仅测试用）。
 *        驱动 targets/host 的虚拟时间/echo/pwm 行为，供 DAL/runtime 端到端测。
 */
#ifndef HOST_TEST_CTRL_H
#define HOST_TEST_CTRL_H

#include <stdint.h>

void sim_reset_time(void);
void sim_set_echo_pin(uint16_t pin);
void sim_set_echo_timing(uint64_t rise_us, uint64_t high_duration_us);
float sim_last_pwm_duty(uint8_t channel);

#endif /* HOST_TEST_CTRL_H */

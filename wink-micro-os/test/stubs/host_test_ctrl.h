/**
 * @file host_test_ctrl.h
 * @brief host 测试专用注入控制 API（非 PAL 契约，仅测试用）。
 *        驱动 targets/host 的虚拟时间/echo/pwm 行为，供 DAL/runtime 端到端测。
 */
#ifndef HOST_TEST_CTRL_H
#define HOST_TEST_CTRL_H

#include <stdint.h>
#include "pal_osal.h"   /* pal_reset_reason_t（sim_set_reset_reason 测试注入，Phase 5 Task 5-4） */

void sim_reset_time(void);
void sim_set_echo_pin(uint16_t pin);
void sim_set_echo_timing(uint64_t rise_us, uint64_t high_duration_us);
float sim_last_pwm_duty(uint8_t channel);
void sim_set_reset_reason(pal_reset_reason_t reason);   /* Phase 5：注入复位原因供 boot safe-lock 测试 */

#endif /* HOST_TEST_CTRL_H */

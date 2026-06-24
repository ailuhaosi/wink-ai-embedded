/**
 * @file pal_osal_host.c
 * @brief host 一等 target 的 PAL OSAL 实现 + 虚拟时间状态机 + host_test_ctrl 实现。
 *        虚拟时间状态在此维护（HAL 经 extern 消费）。
 */
#include "pal_osal.h"
#include "host_test_ctrl.h"
#include <string.h>

static uint64_t s_time_us = 0;
static uint64_t s_echo_rise_us = 0;
static uint64_t s_echo_high_us = 0;
static uint16_t s_echo_pin = 0xFFFF;
static float s_pwm_duty[8];

/* ---- HAL 侧 extern 的访问器 ---- */
uint64_t host_sim_time_us(void) { return s_time_us; }
void host_sim_advance_to(uint64_t us) { if (us > s_time_us) s_time_us = us; }
uint64_t host_echo_rise_us(void) { return s_echo_rise_us; }
uint64_t host_echo_high_us(void) { return s_echo_high_us; }
uint16_t host_echo_pin(void) { return s_echo_pin; }
void host_record_pwm(uint8_t channel, float duty) {
    if (channel < 8) s_pwm_duty[channel] = duty;
}

/* ---- host_test_ctrl 实现 ---- */
void sim_reset_time(void) {
    s_time_us = 0; s_echo_rise_us = 0; s_echo_high_us = 0; s_echo_pin = 0xFFFF;
    memset(s_pwm_duty, 0, sizeof(s_pwm_duty));
}
void sim_set_echo_pin(uint16_t pin) { s_echo_pin = pin; }
void sim_set_echo_timing(uint64_t rise_us, uint64_t high_duration_us) {
    s_echo_rise_us = rise_us; s_echo_high_us = high_duration_us;
}
float sim_last_pwm_duty(uint8_t channel) {
    if (channel >= 8) return -1.0f;
    return s_pwm_duty[channel];
}

/* ---- PAL OSAL ---- */
void pal_delay_ms(uint32_t ms) { s_time_us += (uint64_t)ms * 1000u; }
void pal_delay_us(uint32_t us) { s_time_us += us; }
uint64_t pal_get_ms(void) { return s_time_us / 1000u; }
uint64_t pal_get_us(void) { return s_time_us; }

pal_mutex_t pal_mutex_create(void) { return (pal_mutex_t)1; }
wink_status_t pal_mutex_lock(pal_mutex_t m, uint32_t to) {
    if (m == NULL) return WINK_ERR_INVALID_ARG;
    (void)to;
    return WINK_OK;
}
wink_status_t pal_mutex_unlock(pal_mutex_t m) {
    if (m == NULL) return WINK_ERR_INVALID_ARG;
    return WINK_OK;
}
void pal_mutex_destroy(pal_mutex_t m) { (void)m; }

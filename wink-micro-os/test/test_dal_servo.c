#include "unity.h"
#include "wink_status.h"
#include "dal_servo.h"
#include "host_test_ctrl.h"

void setUp(void) { sim_reset_time(); }
void tearDown(void) {}

void test_set_angle_null_returns_invalid_arg(void) {
    wink_status_t s = dal_servo_set_angle(NULL, 90.0f);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, s);
}

void test_set_angle_90_maps_to_expected_duty(void) {
    dal_servo_t s = { .pwm_channel = 0, .current_angle = 0.0f,
                      .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    /* 90° -> 脉宽 0.5+0.5*(2.5-0.5)=1.5ms -> 占空比 (1.5/20)*100 = 7.5% */
    wink_status_t st = dal_servo_set_angle(&s, 90.0f);
    TEST_ASSERT_EQUAL_INT(WINK_OK, st);
    TEST_ASSERT_EQUAL_FLOAT(7.5f, sim_last_pwm_duty(0));
    TEST_ASSERT_EQUAL_FLOAT(90.0f, s.current_angle);
}

void test_set_angle_clamps_overflow(void) {
    dal_servo_t s = { .pwm_channel = 1, .current_angle = 0.0f,
                      .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    /* 200° 钳到 180 -> 脉宽 2.5ms -> 占空比 12.5% */
    wink_status_t st_overflow = dal_servo_set_angle(&s, 200.0f);
    TEST_ASSERT_EQUAL_INT(WINK_OK, st_overflow);
    TEST_ASSERT_EQUAL_FLOAT(12.5f, sim_last_pwm_duty(1));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_set_angle_null_returns_invalid_arg);
    RUN_TEST(test_set_angle_90_maps_to_expected_duty);
    RUN_TEST(test_set_angle_clamps_overflow);
    return UNITY_END();
}

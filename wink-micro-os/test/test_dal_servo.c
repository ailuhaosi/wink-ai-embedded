#include "unity.h"
#include "wink_status.h"
#include "dal_servo.h"
#include "host_test_ctrl.h"

void setUp(void) { sim_reset_time(); }
void tearDown(void) {}

/* ---- init 契约（Phase 2 Task 2-1）---- */
void test_init_null_returns_invalid_arg(void) {
    dal_servo_config_t cfg = { .pwm_channel = 0, .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, dal_servo_init(NULL, &cfg));
    dal_servo_t dev = {0};
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, dal_servo_init(&dev, NULL));
}

void test_init_rejects_invalid_pulse_range(void) {
    dal_servo_t dev = {0};
    dal_servo_config_t zero_min  = { .pwm_channel = 0, .min_pulse_ms = 0.0f, .max_pulse_ms = 2.5f };
    dal_servo_config_t inverted  = { .pwm_channel = 0, .min_pulse_ms = 2.5f, .max_pulse_ms = 0.5f };
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, dal_servo_init(&dev, &zero_min));
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, dal_servo_init(&dev, &inverted));
}

void test_set_angle_before_init_returns_not_initialized(void) {
    /* initialized 默认 false（未 init） */
    dal_servo_t dev = { .pwm_channel = 0, .current_angle = 0.0f,
                        .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    TEST_ASSERT_EQUAL_INT(WINK_ERR_NOT_INITIALIZED, dal_servo_set_angle(&dev, 90.0f));
}

void test_set_angle_null_returns_invalid_arg(void) {
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, dal_servo_set_angle(NULL, 90.0f));
}

/* ---- init 后 set_angle 的角度→占空比映射（继承 Phase 0 常量等值校验）---- */
void test_init_then_set_angle_updates_duty(void) {
    dal_servo_t s = {0};
    dal_servo_config_t cfg = { .pwm_channel = 0, .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_servo_init(&s, &cfg));
    /* 90° -> 脉宽 0.5+0.5*(2.5-0.5)=1.5ms -> 占空比 (1.5/20)*100 = 7.5% */
    wink_status_t st = dal_servo_set_angle(&s, 90.0f);
    TEST_ASSERT_EQUAL_INT(WINK_OK, st);
    TEST_ASSERT_EQUAL_FLOAT(7.5f, sim_last_pwm_duty(0));
    TEST_ASSERT_EQUAL_FLOAT(90.0f, s.current_angle);
}

void test_init_then_set_angle_clamps_overflow(void) {
    dal_servo_t s = {0};
    dal_servo_config_t cfg = { .pwm_channel = 1, .min_pulse_ms = 0.5f, .max_pulse_ms = 2.5f };
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_servo_init(&s, &cfg));
    /* 200° 钳到 180 -> 脉宽 2.5ms -> 占空比 12.5% */
    wink_status_t st_overflow = dal_servo_set_angle(&s, 200.0f);
    TEST_ASSERT_EQUAL_INT(WINK_OK, st_overflow);
    TEST_ASSERT_EQUAL_FLOAT(12.5f, sim_last_pwm_duty(1));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_init_null_returns_invalid_arg);
    RUN_TEST(test_init_rejects_invalid_pulse_range);
    RUN_TEST(test_set_angle_before_init_returns_not_initialized);
    RUN_TEST(test_set_angle_null_returns_invalid_arg);
    RUN_TEST(test_init_then_set_angle_updates_duty);
    RUN_TEST(test_init_then_set_angle_clamps_overflow);
    return UNITY_END();
}

#include "unity.h"
#include "wink_status.h"
#include "dal_ultrasonic.h"
#include "host_test_ctrl.h"

void setUp(void) { sim_reset_time(); }
void tearDown(void) {}

void test_read_null_returns_invalid_arg(void) {
    wink_status_t s = dal_ultrasonic_read(NULL, (float[]){0});
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, s);
}

void test_read_null_out_returns_invalid_arg(void) {
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    wink_status_t s = dal_ultrasonic_read(&dev, NULL);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, s);
}

/* ---- 共享换算纯函数 ---- */
extern float dal_pulse_us_to_cm(uint32_t pulse_us);

void test_pulse_to_cm_100cm(void) {
    /* 100cm -> 往返 200cm -> ≈5882us；0.017*5882 ≈ 99.994 */
    TEST_ASSERT_EQUAL_FLOAT(99.994f, dal_pulse_us_to_cm(5882));
}

/* ---- 真机分支脉宽测量集成（host 协作式时间）---- */
void test_read_real_measure_pulse(void) {
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    sim_set_echo_pin(5);
    sim_set_echo_timing(100, 5882);   /* rise@100us, high 5882us ≈100cm */
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 99.994f, dist);
}

void test_read_real_timeout_no_echo(void) {
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    sim_set_echo_pin(5);
    sim_set_echo_timing(100000, 1000);  /* rise > 30ms 上限 */
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_TIMEOUT, s);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_read_null_returns_invalid_arg);
    RUN_TEST(test_read_null_out_returns_invalid_arg);
    RUN_TEST(test_pulse_to_cm_100cm);
    RUN_TEST(test_read_real_measure_pulse);
    RUN_TEST(test_read_real_timeout_no_echo);
    return UNITY_END();
}

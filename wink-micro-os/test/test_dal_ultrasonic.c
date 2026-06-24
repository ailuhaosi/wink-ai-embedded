#include "unity.h"
#include "wink_status.h"
#include "dal_ultrasonic.h"
#include "host_test_ctrl.h"

void setUp(void) { sim_reset_time(); }
void tearDown(void) {}

/* ---- init 契约（Phase 2 Task 2-2）---- */
void test_ultrasonic_init_null_returns_invalid_arg(void) {
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, dal_ultrasonic_init(NULL, 4, 5));
}

void test_ultrasonic_init_rejects_same_pin(void) {
    dal_ultrasonic_t dev = {0};
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, dal_ultrasonic_init(&dev, 5, 5));
}

void test_ultrasonic_read_before_init_returns_not_initialized(void) {
    /* initialized 默认 false（未 init） */
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    float dist = 0.0f;
    TEST_ASSERT_EQUAL_INT(WINK_ERR_NOT_INITIALIZED, dal_ultrasonic_read(&dev, &dist));
}

void test_read_null_returns_invalid_arg(void) {
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, dal_ultrasonic_read(NULL, (float[]){0}));
}

void test_read_null_out_returns_invalid_arg(void) {
    dal_ultrasonic_t dev = {0};
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, dal_ultrasonic_read(&dev, NULL));
}

/* ---- 共享换算纯函数 ---- */
extern float dal_pulse_us_to_cm(uint32_t pulse_us);

void test_pulse_to_cm_100cm(void) {
    /* 100cm -> 往返 200cm -> ≈5882us；0.017*5882 ≈ 99.994 */
    TEST_ASSERT_EQUAL_FLOAT(99.994f, dal_pulse_us_to_cm(5882));
}

/* ---- 真机分支脉宽测量集成（init 后；host 协作式时间）---- */
void test_ultrasonic_init_then_read_real_measure_pulse(void) {
    dal_ultrasonic_t dev = {0};
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_ultrasonic_init(&dev, 4, 5));
    sim_set_echo_pin(5);
    sim_set_echo_timing(100, 5882);   /* rise@100us, high 5882us ≈100cm */
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 99.994f, dist);
}

void test_ultrasonic_init_then_read_real_timeout(void) {
    dal_ultrasonic_t dev = {0};
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_ultrasonic_init(&dev, 4, 5));
    sim_set_echo_pin(5);
    sim_set_echo_timing(100000, 1000);  /* rise > 30ms 上限 */
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_TIMEOUT, s);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_ultrasonic_init_null_returns_invalid_arg);
    RUN_TEST(test_ultrasonic_init_rejects_same_pin);
    RUN_TEST(test_ultrasonic_read_before_init_returns_not_initialized);
    RUN_TEST(test_read_null_returns_invalid_arg);
    RUN_TEST(test_read_null_out_returns_invalid_arg);
    RUN_TEST(test_pulse_to_cm_100cm);
    RUN_TEST(test_ultrasonic_init_then_read_real_measure_pulse);
    RUN_TEST(test_ultrasonic_init_then_read_real_timeout);
    return UNITY_END();
}

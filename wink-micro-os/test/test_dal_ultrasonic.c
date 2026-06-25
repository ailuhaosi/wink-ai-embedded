#include "unity.h"
#include "wink_status.h"
#include "dal_ultrasonic.h"
#include "host_test_ctrl.h"
#include <time.h>

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

/* ---- 非阻塞状态机（Phase 4 Task 4-3；host 单 tick 同步 ready）---- */
void test_nonblocking_get_cached_before_request_returns_busy(void) {
    dal_ultrasonic_t dev = {0};
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_ultrasonic_init(&dev, 4, 5));
    float dist = 0.0f;
    /* state == IDLE（未 request）→ BUSY（无数据） */
    TEST_ASSERT_EQUAL_INT(WINK_ERR_BUSY, dal_ultrasonic_get_cached_distance(&dev, &dist));
}

void test_nonblocking_request_then_get_cached_returns_distance(void) {
    dal_ultrasonic_t dev = {0};
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_ultrasonic_init(&dev, 4, 5));
    sim_set_echo_pin(5);
    sim_set_echo_timing(100, 5882);   /* rise@100us, high 5882us ≈100cm */
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_ultrasonic_request_measurement(&dev));
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_get_cached_distance(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 99.994f, dist);
}

void test_nonblocking_request_timeout_returns_error_status(void) {
    dal_ultrasonic_t dev = {0};
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_ultrasonic_init(&dev, 4, 5));
    sim_set_echo_pin(5);
    sim_set_echo_timing(100000, 1000);   /* rise > 30ms → pulse_in TIMEOUT */
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_ultrasonic_request_measurement(&dev));
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_get_cached_distance(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_TIMEOUT, s);
}

/* Phase 4 Task 4-6 墙钟守卫：单 tick 超声波路径用虚拟时间，无真实阻塞泄漏到墙钟。
 * 阈值取 100ms（>> clock 粒度，且远小于旧 blocking worst-case ≈60ms 的真实阻塞风险面）。 */
void test_nonblocking_single_tick_wallclock_is_small(void) {
    dal_ultrasonic_t dev = {0};
    TEST_ASSERT_EQUAL_INT(WINK_OK, dal_ultrasonic_init(&dev, 4, 5));
    sim_set_echo_pin(5);
    sim_set_echo_timing(100, 5882);
    clock_t t0 = clock();
    for (int i = 0; i < 1000; i++) {   /* 重复 1000 次放大可测性 */
        wink_status_t rq = dal_ultrasonic_request_measurement(&dev); (void)rq;
        float dist = 0.0f;
        wink_status_t gc = dal_ultrasonic_get_cached_distance(&dev, &dist); (void)gc;
    }
    clock_t dt = clock() - t0;
    /* 1000 次单 tick 路径应远 < 100ms（即每次 < 100us 量级）；防止真实阻塞泄漏 */
    TEST_ASSERT(dt < (clock_t)(CLOCKS_PER_SEC / 10));
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
    RUN_TEST(test_nonblocking_get_cached_before_request_returns_busy);
    RUN_TEST(test_nonblocking_request_then_get_cached_returns_distance);
    RUN_TEST(test_nonblocking_request_timeout_returns_error_status);
    RUN_TEST(test_nonblocking_single_tick_wallclock_is_small);
    return UNITY_END();
}

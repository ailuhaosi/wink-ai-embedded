/* 核心：证明仿真分支同样调用 dal_pulse_us_to_cm，输出 == 真机分支对同一脉宽的换算。
 * 这是 ADR-0003 决策2「两端同源」的回归守卫——host 真机测试只覆盖 #else。 */
#include "unity.h"
#include "wink_status.h"
#include "dal_ultrasonic.h"
#include "js_sim_host_stub.h"

extern float dal_pulse_us_to_cm(uint32_t pulse_us);

void setUp(void) { sim_set_echo_pulse_us(0); }
void tearDown(void) {}

void test_sim_read_uses_shared_conversion(void) {
    sim_set_echo_pulse_us(5882);
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
    /* 与真机分支 test_read_real_measure_pulse 同一脉宽 → 同一距离（两端同源铁证） */
    TEST_ASSERT_EQUAL_FLOAT(dal_pulse_us_to_cm(5882), dist);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 99.994f, dist);
}

void test_sim_read_timeout_when_pulse_exceeds_limit(void) {
    sim_set_echo_pulse_us(31000);   /* ≥ ULTRASONIC_TIMEOUT_US */
    dal_ultrasonic_t dev = { .trig_pin = 4, .echo_pin = 5, .last_distance = 0.0f };
    float dist = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&dev, &dist);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_TIMEOUT, s);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_sim_read_uses_shared_conversion);
    RUN_TEST(test_sim_read_timeout_when_pulse_exceeds_limit);
    return UNITY_END();
}

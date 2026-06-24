#include "unity.h"
#include "pal_osal.h"
#include "host_test_ctrl.h"

void setUp(void) { sim_reset_time(); }
void tearDown(void) {}

void test_delay_advances_virtual_time(void) {
    pal_delay_ms(5);
    TEST_ASSERT_EQUAL_UINT64(5000u, pal_get_us());
    pal_delay_us(300);
    TEST_ASSERT_EQUAL_UINT64(5300u, pal_get_us());
}

void test_pwm_duty_recorded(void) {
    /* pal_pwm_set_duty 在 targets/host 提供；经声明直接调 */
    extern bool pal_pwm_set_duty(uint8_t channel, float duty);
    pal_pwm_set_duty(2, 7.5f);
    TEST_ASSERT_EQUAL_FLOAT(7.5f, sim_last_pwm_duty(2));
}

void test_echo_timing_stored(void) {
    sim_set_echo_pin(5);
    sim_set_echo_timing(100, 5882);
    /* 验证 host_echo_pin/rise/high 经 pal_gpio_read 协作推进（见 dal 测试，此处只验注入生效） */
    extern bool pal_gpio_read(uint16_t pin);
    TEST_ASSERT_TRUE(pal_gpio_read(5));   /* 首次读推进到 rise，返回高 */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_delay_advances_virtual_time);
    RUN_TEST(test_pwm_duty_recorded);
    RUN_TEST(test_echo_timing_stored);
    return UNITY_END();
}

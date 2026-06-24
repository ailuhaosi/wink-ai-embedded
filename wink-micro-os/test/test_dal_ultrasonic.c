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

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_read_null_returns_invalid_arg);
    RUN_TEST(test_read_null_out_returns_invalid_arg);
    return UNITY_END();
}

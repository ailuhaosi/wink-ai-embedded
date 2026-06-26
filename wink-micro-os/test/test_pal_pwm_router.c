#include "unity.h"
#include "pal_pwm_router.h"
#include "pal_resource.h"

void setUp(void) {
    pal_pwm_router_reset();
    pal_resource_reset();
}
void tearDown(void) {}

static uint8_t acquire_ok(uint8_t ch, uint32_t freq) {
    uint8_t t = 0xFF;
    TEST_ASSERT_EQUAL_INT_MESSAGE(WINK_OK, pal_pwm_router_acquire(ch, freq, &t), "acquire should succeed");
    return t;
}

void test_router_acquire_release_basic(void) {
    uint8_t t = acquire_ok(0, 1000);
    TEST_ASSERT_TRUE(t < PAL_PWM_TIMERS);
    TEST_ASSERT_TRUE(pal_pwm_router_channel_ready(0));
    TEST_ASSERT_EQUAL_UINT8(t, pal_pwm_router_channel_timer(0));

    pal_pwm_router_release(0);
    TEST_ASSERT_FALSE(pal_pwm_router_channel_ready(0));
    TEST_ASSERT_EQUAL_UINT8(0xFF, pal_pwm_router_channel_timer(0));
}

void test_router_same_freq_reuses_timer(void) {
    uint8_t t0 = acquire_ok(0, 50);
    uint8_t t1 = acquire_ok(1, 50);
    TEST_ASSERT_EQUAL_UINT8(t0, t1);   /* same freq → same timer */
}

void test_router_diff_freq_diff_timer(void) {
    uint8_t t0 = acquire_ok(0, 50);
    uint8_t t1 = acquire_ok(1, 1000);
    TEST_ASSERT_NOT_EQUAL(t0, t1);
}

void test_router_idempotent_and_busy(void) {
    uint8_t t = acquire_ok(0, 50);
    uint8_t t2 = 0xFF;
    /* same channel, same freq → idempotent, same timer */
    TEST_ASSERT_EQUAL_INT(WINK_OK, pal_pwm_router_acquire(0, 50, &t2));
    TEST_ASSERT_EQUAL_UINT8(t, t2);
    /* same channel, different freq → BUSY, state unchanged */
    TEST_ASSERT_EQUAL_INT(WINK_ERR_BUSY, pal_pwm_router_acquire(0, 1000, &t2));
    TEST_ASSERT_EQUAL_INT(WINK_OK, pal_pwm_router_acquire(0, 50, &t2));
    TEST_ASSERT_EQUAL_UINT8(t, t2);
}

void test_router_exhausted_after_four_distinct_freqs(void) {
    uint8_t t;
    uint32_t freqs[PAL_PWM_TIMERS] = {50, 200, 1000, 5000};
    for (uint8_t i = 0; i < PAL_PWM_TIMERS; i++) {
        TEST_ASSERT_EQUAL_INT(WINK_OK, pal_pwm_router_acquire(i, freqs[i], &t));
    }
    /* 5th distinct frequency, no free timer */
    TEST_ASSERT_EQUAL_INT(WINK_ERR_RESOURCE_EXHAUSTED, pal_pwm_router_acquire(4, 25000, &t));
    /* but reusing an existing freq still OK (channel 4 shares timer 0's 50Hz) */
    TEST_ASSERT_EQUAL_INT(WINK_OK, pal_pwm_router_acquire(4, 50, &t));
}

void test_router_release_recycles_timer(void) {
    uint8_t ta = acquire_ok(0, 50);
    (void)acquire_ok(1, 50);            /* ref=2 */
    pal_pwm_router_release(0);          /* ref=1 */
    pal_pwm_router_release(1);          /* ref=0 → slot recycled */
    /* re-allocating 50Hz succeeds on a fresh slot */
    TEST_ASSERT_EQUAL_INT(WINK_OK, pal_pwm_router_acquire(2, 50, &ta));
}

void test_router_invalid_args(void) {
    uint8_t t;
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, pal_pwm_router_acquire(PAL_PWM_CHANNELS, 50, &t));
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, pal_pwm_router_acquire(0, 0, &t));
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, pal_pwm_router_acquire(0, 50, NULL));
    /* release of OOR/uninit channel is a safe no-op */
    pal_pwm_router_release(PAL_PWM_CHANNELS);
    pal_pwm_router_release(0);
    TEST_PASS();
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_router_acquire_release_basic);
    RUN_TEST(test_router_same_freq_reuses_timer);
    RUN_TEST(test_router_diff_freq_diff_timer);
    RUN_TEST(test_router_idempotent_and_busy);
    RUN_TEST(test_router_exhausted_after_four_distinct_freqs);
    RUN_TEST(test_router_release_recycles_timer);
    RUN_TEST(test_router_invalid_args);
    return UNITY_END();
}

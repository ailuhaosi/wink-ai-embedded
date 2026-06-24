#include "unity.h"
#include "wink_trace.h"

void setUp(void) { wink_trace_reset(); }
void tearDown(void) {}

void test_reset_clears_buffer(void) {
    wink_trace_fault(1001);
    wink_trace_reset();
    TEST_ASSERT_EQUAL_UINT32(0, wink_trace_count());
}

void test_fault_recorded_in_order(void) {
    wink_trace_fault(1001);
    wink_trace_fault(1002);
    TEST_ASSERT_EQUAL_UINT32(2, wink_trace_count());
    TEST_ASSERT_EQUAL_UINT32(1002, wink_trace_last());
}

void test_ring_buffer_overwrites_oldest(void) {
    /* WINK_TRACE_CAPACITY 见 wink_trace.h；填满后再写，count 封顶、last 为最新 */
    for (uint32_t i = 0; i < WINK_TRACE_CAPACITY + 5; i++) {
        wink_trace_fault(i);
    }
    TEST_ASSERT_EQUAL_UINT32(WINK_TRACE_CAPACITY, wink_trace_count());
    TEST_ASSERT_EQUAL_UINT32(WINK_TRACE_CAPACITY + 4, wink_trace_last());
}

void test_last_when_empty_is_zero(void) {
    TEST_ASSERT_EQUAL_UINT32(0, wink_trace_last());
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_reset_clears_buffer);
    RUN_TEST(test_fault_recorded_in_order);
    RUN_TEST(test_ring_buffer_overwrites_oldest);
    RUN_TEST(test_last_when_empty_is_zero);
    return UNITY_END();
}

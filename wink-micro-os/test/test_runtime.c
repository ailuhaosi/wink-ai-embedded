#include "unity.h"
#include "wink_runtime.h"
#include "wink_trace.h"

/* 测试用 mock 计数器（静态分配，§6.1 约束1） */
static int s_init_calls = 0;
static int s_loop_calls = 0;
static int s_fault_calls = 0;
static uint32_t s_last_fault = 0;

static void mock_init(void) { s_init_calls++; }
static void mock_loop(void) {
    s_loop_calls++;
    /* 第 3 次 loop 模拟触发故障并主动上报 trace */
    if (s_loop_calls == 3) {
        wink_trace_fault(7001);
    }
}
static void mock_on_fault(uint32_t code) { s_fault_calls++; s_last_fault = code; }

void setUp(void) {
    s_init_calls = s_loop_calls = s_fault_calls = 0;
    s_last_fault = 0;
    wink_trace_reset();
}
void tearDown(void) {}

void test_run_calls_init_once_then_loops_n_times(void) {
    wink_app_callbacks_t cb = { mock_init, mock_loop, mock_on_fault };
    wink_status_t s = wink_runtime_run(&cb, 5);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
    TEST_ASSERT_EQUAL_INT(1, s_init_calls);
    TEST_ASSERT_EQUAL_INT(5, s_loop_calls);
}

void test_run_null_callbacks_returns_invalid_arg(void) {
    wink_status_t s = wink_runtime_run(NULL, 5);
    TEST_ASSERT_EQUAL_INT(WINK_ERR_INVALID_ARG, s);
}

void test_null_init_callback_treated_as_ok(void) {
    /* init/loop 允许 NULL（runtime 跳过），on_fault 允许 NULL */
    wink_app_callbacks_t cb = { NULL, NULL, NULL };
    wink_status_t s = wink_runtime_run(&cb, 3);
    TEST_ASSERT_EQUAL_INT(WINK_OK, s);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_run_calls_init_once_then_loops_n_times);
    RUN_TEST(test_run_null_callbacks_returns_invalid_arg);
    RUN_TEST(test_null_init_callback_treated_as_ok);
    return UNITY_END();
}

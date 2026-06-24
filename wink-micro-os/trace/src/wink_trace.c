/**
 * @file wink_trace.c
 * @brief Golden Trace 实现：静态环形缓冲（零动态分配）。
 */
#include "wink_trace.h"

static uint32_t s_buffer[WINK_TRACE_CAPACITY];
static uint32_t s_count = 0;     /* 已写入总数（含覆盖） */
static uint32_t s_head = 0;      /* 下一个写入位置 */

void wink_trace_reset(void) {
    s_count = 0;
    s_head = 0;
}

void wink_trace_fault(uint32_t fault_code) {
    s_buffer[s_head] = fault_code;
    s_head = (s_head + 1u) % WINK_TRACE_CAPACITY;
    s_count++;                   /* 溢出回绕由 count() 截断 */
}

uint32_t wink_trace_count(void) {
    return (s_count < WINK_TRACE_CAPACITY) ? s_count : WINK_TRACE_CAPACITY;
}

uint32_t wink_trace_last(void) {
    if (s_count == 0) return 0u;
    /* 最近写入在 s_head 的前一个位置 */
    uint32_t last_idx = (s_head + WINK_TRACE_CAPACITY - 1u) % WINK_TRACE_CAPACITY;
    return s_buffer[last_idx];
}

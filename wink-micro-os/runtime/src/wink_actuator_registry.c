/**
 * @file wink_actuator_registry.c
 * @brief 执行器关断注册表实现（静态表，零动态分配）。review P0-4 / Phase 5 Task 5-1。
 */
#include "wink_actuator_registry.h"
#include "wink_trace.h"

typedef struct {
    wink_actuator_safe_off_fn fn;
    void                     *ctx;
} wink_actuator_entry_t;

static wink_actuator_entry_t s_entries[WINK_ACTUATOR_REGISTRY_CAPACITY];
static uint32_t s_count = 0;

void wink_actuator_registry_reset(void) {
    s_count = 0;
}

WINK_WARN_UNUSED_RESULT
wink_status_t wink_actuator_register(wink_actuator_safe_off_fn fn, void *ctx) {
    if (fn == NULL) { return WINK_ERR_INVALID_ARG; }
    /* 幂等：重复 (fn, ctx) → OK */
    for (uint32_t i = 0; i < s_count; i++) {
        if (s_entries[i].fn == fn && s_entries[i].ctx == ctx) {
            return WINK_OK;
        }
    }
    if (s_count >= WINK_ACTUATOR_REGISTRY_CAPACITY) {
        return WINK_ERR_RESOURCE_EXHAUSTED;
    }
    s_entries[s_count].fn  = fn;
    s_entries[s_count].ctx = ctx;
    s_count++;
    return WINK_OK;
}

void wink_actuator_safe_off_all(void) {
    /* 即使单个失败也继续遍历全部；失败项 trace 记录（fault code 7000 段：actuator safe-off 失败） */
    for (uint32_t i = 0; i < s_count; i++) {
        wink_status_t s = s_entries[i].fn(s_entries[i].ctx);
        if (wink_status_is_error(s)) {
            wink_trace_fault(7000u + i);
        }
    }
}

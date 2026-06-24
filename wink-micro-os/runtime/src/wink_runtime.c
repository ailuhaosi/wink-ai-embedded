/**
 * @file wink_runtime.c
 * @brief 协作式主循环实现（回调注入，无外部 extern app_*）+ fail-safe / boot safe-lock（Phase 5）。
 */
#include "wink_runtime.h"
#include "pal_osal.h"
#include "wink_trace.h"
#include "wink_actuator_registry.h"

void wink_app_delay_ms(uint32_t ms) {
    pal_delay_ms(ms);
}

wink_status_t wink_runtime_run(const wink_app_callbacks_t *callbacks, uint32_t max_ticks) {
    if (callbacks == NULL) { return WINK_ERR_INVALID_ARG; }

    /* Phase 5 Task 5-5: boot safe-lock —— 若上次复位为 WDT/PANIC，先 trace + 关断所有执行器，
     * 在 App 显式清除 safety lock 前保持执行器失能（避免"启动→复位→启动"循环反复驱动执行器）。
     * ⚠ 硬件级默认安全态由板级电路保证（软件无法覆盖 HardFault/CPU 卡死/WDT 硬复位瞬间）。
     * ⚠ clear-lock API 是 follow-up：本阶段实现「锁定」语义但未暴露清除接口；host 测试 reset
     *   reason 默认 POWER_ON 故不受影响。真机一旦 WDT 复位需现场干预（安全优先的有意取舍）。 */
    pal_reset_reason_t rr = pal_get_reset_reason();
    if (rr == PAL_RESET_REASON_WATCHDOG || rr == PAL_RESET_REASON_PANIC) {
        wink_trace_fault(WINK_FAULT_BOOT_AFTER_RESET);
        wink_actuator_safe_off_all();
    }

    if (callbacks->init) {
        callbacks->init();
    }

    uint32_t tick = 0;
    /* max_ticks == 0 => 无限循环（真机/wasm）；host 测试传有限值 */
    while ((max_ticks == 0u) || (tick < max_ticks)) {
        if (callbacks->loop) {
            callbacks->loop();
        }
        wink_app_delay_ms(WINK_RUNTIME_TICK_MS);
        tick++;
    }
    return WINK_OK;
}

void wink_runtime_fault(const wink_app_callbacks_t *callbacks, uint32_t fault_code) {
    /* 顺序：trace → safe-off-all → on_fault（先关断所有执行器，再通知 App） */
    wink_trace_fault(fault_code);
    wink_actuator_safe_off_all();
    if (callbacks != NULL && callbacks->on_fault != NULL) {
        callbacks->on_fault(fault_code);
    }
}

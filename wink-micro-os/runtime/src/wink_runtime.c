/**
 * @file wink_runtime.c
 * @brief Cooperative main loop (callback injection) + fail-safe / boot safe-lock (Phase 5).
 */
#include "wink_runtime.h"
#include "pal_osal.h"
#include "wink_trace.h"
#include "wink_actuator_registry.h"
/* Method C: poll-based interrupt dispatch at tick boundary (wasm simulation target only).
 * Included only under SIMULATION macro; host/esp32 targets skip this header at compile time. */
#ifdef SIMULATION
#include "pal_wasm_internal.h"
#endif

void wink_app_delay_ms(uint32_t ms) {
    pal_delay_ms(ms);
}

wink_status_t wink_runtime_run(const wink_app_callbacks_t *callbacks, uint32_t max_ticks) {
    pal_reset_reason_t rr;
    uint32_t tick;
    /* WCET timing variables -- declared at block top for C89/MSVC compatibility. */
    uint64_t wcet_start;
    uint64_t wcet_elapsed;
    uint64_t wcet_limit;

    if (callbacks == NULL) { return WINK_ERR_INVALID_ARG; }

    /* Phase 5 Task 5-5: boot safe-lock.
     * If the last reset was WDT/PANIC, trace + disable all actuators before running App. */
    rr = pal_get_reset_reason();
    if (rr == PAL_RESET_REASON_WATCHDOG || rr == PAL_RESET_REASON_PANIC) {
        wink_trace_fault(WINK_FAULT_BOOT_AFTER_RESET);
        wink_actuator_safe_off_all();
    }

    if (callbacks->init) {
        callbacks->init();
    }

    tick = 0;
    /* max_ticks == 0 => infinite loop (embedded/wasm); host tests pass a finite value. */
    while ((max_ticks == 0u) || (tick < max_ticks)) {
        if (callbacks->loop) {
            wcet_start   = pal_get_us();
            callbacks->loop();
            wcet_elapsed = pal_get_us() - wcet_start;
            wcet_limit   = (uint64_t)WINK_RUNTIME_TICK_MS * 1000u;
            if (wcet_elapsed > (wcet_limit / 2u)) {
                wink_trace_fault(WINK_WARN_WCET_EXCEEDED);
            }
        }

        /* Method C: Wasm interrupt dispatch at tick boundary (before delay/Asyncify suspend).
         * Wasm is in normal running state here (not Asyncify sleeping), so ISR dispatch is safe.
         * Equivalent to ESP32/FreeRTOS bottom-half queue consumption (ADR-0002).
         * Non-SIMULATION targets (host/esp32) have this removed at compile time -- zero overhead. */
#ifdef SIMULATION
        pal_wasm_dispatch_pending_interrupts();
#endif

        wink_app_delay_ms(WINK_RUNTIME_TICK_MS);
        tick++;
    }
    return WINK_OK;
}

void wink_runtime_fault(const wink_app_callbacks_t *callbacks, uint32_t fault_code) {
    wink_trace_fault(fault_code);
    wink_actuator_safe_off_all();
    if (callbacks != NULL && callbacks->on_fault != NULL) {
        callbacks->on_fault(fault_code);
    }
}

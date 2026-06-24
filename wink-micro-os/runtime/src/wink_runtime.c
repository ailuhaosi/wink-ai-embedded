/**
 * @file wink_runtime.c
 * @brief 协作式主循环实现（回调注入，无外部 extern app_*）。
 */
#include "wink_runtime.h"
#include "pal_osal.h"

void wink_app_delay_ms(uint32_t ms) {
    pal_delay_ms(ms);
}

wink_status_t wink_runtime_run(const wink_app_callbacks_t *callbacks, uint32_t max_ticks) {
    if (callbacks == NULL) return WINK_ERR_INVALID_ARG;

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

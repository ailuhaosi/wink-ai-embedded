/**
 * @file wasm_entry.c
 * @brief Wasm 入口：main() + trigger_wasm_interrupt。
 *        从旧 pal_hal_wasm.c 拆出；target entry 只负责启动 runtime（03-dir §7）。
 *        注：本计划 runtime 接线（wink_runtime_run）见 Plan 5；此处 main 先返回 0。
 */
#ifdef EMSCRIPTEN
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif
#include "pal_hal.h"

/**
 * @brief JS 侧产生中断时回调执行 C 侧 ISR
 * @param callback_index 注册中断时 C 侧传给 JS 的函数指针索引
 * @param arg 中断上下文参数指针
 */
EMSCRIPTEN_KEEPALIVE
void trigger_wasm_interrupt(uint32_t callback_index, void *arg) {
    pal_gpio_isr_t isr = (pal_gpio_isr_t)(uintptr_t)callback_index;
    if (isr != NULL) {
        isr(arg);
    }
}

int main(void) {
    /* TODO(Plan 5): 实例化 wink_app_callbacks_t 并调用 wink_runtime_run(&cb, 0) */
    return 0;
}

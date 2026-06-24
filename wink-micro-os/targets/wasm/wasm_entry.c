/**
 * @file wasm_entry.c
 * @brief Wasm 入口：main() + trigger_wasm_interrupt。
 *        从旧 pal_hal_wasm.c 拆出；target entry 只负责启动 runtime（03-dir §7）。
 */
#ifdef EMSCRIPTEN
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif
#include "pal_hal.h"
#include "wink_app.h"
#include "wink_runtime.h"

/* App 工厂（由注入的 App 提供，wasm 构建链接 samples 或用户 App） */
extern const wink_app_callbacks_t *wink_app_get_callbacks(void);

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
    const wink_app_callbacks_t *cb = wink_app_get_callbacks();
    wink_runtime_run(cb, 0);   /* 0 = 无限循环（wasm 下由 Asyncify 让出） */
    return 0;
}

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
 * @param callback_index 注册中断时 C 侧传给 JS 的**不透明 function table 索引**（非裸函数指针）
 * @param arg 中断上下文参数指针
 *
 * @note 回调索引边界（Phase 6 Task 6-3 / P2-4）：本 cast (pal_gpio_isr_t)(uintptr_t)callback_index
 *   仅在「单一 wasm adapter 边界」内合法——JS 侧须只传经 js_pal_register_interrupt 注册过的合法索引。
 *   wasm64 下该 cast 对 >2^32 的索引会截断。isr != NULL 仅是 best-effort 守卫，**不能**防错误非零索引
 *   （须由 JS 侧 function table registry 保证，长期用 Emscripten addFunction 替代裸 cast）。
 *   另：JS 不得在 Asyncify sleeping 窗口调用本函数（见 01-wasm-sandbox-lifecycle.md §4.4）。
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

/**
 * @file pal_osal_wasm.c
 * @brief Wasm 仿真端 PAL OSAL 适配（delay/tick/mutex）。
 *        Asyncify 挂起在 js_pal_delay_ms；虚拟时钟为 ADR-0003 决策3 路标（暂用 JS 墙钟）。
 */
#include "pal_osal.h"
#include "wasm_bridge.h"

void pal_delay_ms(uint32_t ms) {
    js_pal_delay_ms(ms);            /* Asyncify 挂起，由 JS 唤醒 */
}

void pal_delay_us(uint32_t us) {
    js_pal_delay_us(us);
}

uint64_t pal_get_ms(void) { return js_pal_get_ms(); }
uint64_t pal_get_us(void) { return js_pal_get_us(); }

/* 单线程 Wasm Worker 沙箱通常无锁竞争，互斥锁退化为无竞争实现 */
pal_mutex_t pal_mutex_create(void) { return (pal_mutex_t)1; }
wink_status_t pal_mutex_lock(pal_mutex_t mutex, uint32_t timeout_ms) {
    if (mutex == NULL) return WINK_ERR_INVALID_ARG;
    (void)timeout_ms;
    return WINK_OK;
}
wink_status_t pal_mutex_unlock(pal_mutex_t mutex) {
    if (mutex == NULL) return WINK_ERR_INVALID_ARG;
    return WINK_OK;
}
void pal_mutex_destroy(pal_mutex_t mutex) { (void)mutex; }

/* Phase 5 Task 5-4：wasm 无硬件复位/WDT 语义。reset reason 恒 UNKNOWN；WDT UNSUPPORTED
 *（直至确立浏览器侧 watchdog 策略）。真挂死/CPU 卡死靠宿主（浏览器/容器）兜底，不由本层保证。 */
pal_reset_reason_t pal_get_reset_reason(void) { return PAL_RESET_REASON_UNKNOWN; }
WINK_WARN_UNUSED_RESULT wink_status_t pal_watchdog_init(uint32_t timeout_ms) { (void)timeout_ms; return WINK_ERR_UNSUPPORTED; }
WINK_WARN_UNUSED_RESULT wink_status_t pal_watchdog_feed(void) { return WINK_ERR_UNSUPPORTED; }

uint32_t pal_critical_enter(void) {
    return 0;
}

void pal_critical_exit(uint32_t key) {
    (void)key;
}

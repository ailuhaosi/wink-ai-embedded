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
bool pal_mutex_lock(pal_mutex_t mutex, uint32_t timeout_ms) { (void)mutex; (void)timeout_ms; return true; }
bool pal_mutex_unlock(pal_mutex_t mutex) { (void)mutex; return true; }
void pal_mutex_destroy(pal_mutex_t mutex) { (void)mutex; }

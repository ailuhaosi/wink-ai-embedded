/* host 测试用最小 PAL OSAL 桩（仅供 runtime 测试，非一等 target；Plan 3 引入完整 targets/host） */
#include "pal_osal.h"

void pal_delay_ms(uint32_t ms) { (void)ms; }
void pal_delay_us(uint32_t us) { (void)us; }
uint64_t pal_get_ms(void) { return 0; }
uint64_t pal_get_us(void) { return 0; }
pal_mutex_t pal_mutex_create(void) { return (pal_mutex_t)1; }
bool pal_mutex_lock(pal_mutex_t m, uint32_t t) { (void)m; (void)t; return true; }
bool pal_mutex_unlock(pal_mutex_t m) { (void)m; return true; }
void pal_mutex_destroy(pal_mutex_t m) { (void)m; }

/**
 * @file pal_resource_esp32.c
 * @brief ESP32 真机 pal_resource 无操作占位（no-op stub）。
 *
 * Phase 2：pal_resource 升为双 target 契约，使 DAL/device_tree 可无条件调用
 * pal_resource_claim 而不引入 app 层 #ifdef。
 *
 * ESP32 等真机资源的冲突治理由前端画布静态校验与 build-service 静态分析完成
 *（Device Model Registry §5），且 ESP-IDF I2C driver 自有运行时冲突报告。
 * 故 C 侧暂以 no-op 占位，避免增加 ROM 开销（P2-6 ROADMAP 可迭代为真实现）。
 */
#include "pal_resource.h"

void pal_resource_reset(void) {
}

wink_status_t pal_resource_claim(pal_resource_type_t type, uint32_t id, const char *owner) {
    (void)type; (void)id; (void)owner;
    return WINK_OK;
}

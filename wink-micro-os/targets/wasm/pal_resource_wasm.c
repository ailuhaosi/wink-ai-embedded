/**
 * @file pal_resource_wasm.c
 * @brief wasm 仿真端 pal_resource 无操作占位（no-op stub）。
 *
 * Phase 2：pal_resource 升为双 target 契约，使 DAL/device_tree 可无条件调用
 * pal_resource_claim 而不引入 app 层 #ifdef。
 *
 * wasm 单线程沙箱无需资源冲突治理（host 仿真侧负责静态校验；真机侧由 ESP-IDF 静态分析
 * 与 host 代码生成校验覆盖），故直接返回 WINK_OK。
 */
#include "pal_resource.h"

void pal_resource_reset(void) {
}

wink_status_t pal_resource_claim(pal_resource_type_t type, uint32_t id, const char *owner) {
    (void)type; (void)id; (void)owner;
    return WINK_OK;
}

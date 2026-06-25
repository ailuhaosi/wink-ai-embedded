/**
 * @file pal_resource_host.c
 * @brief host/debug 资源占用治理实现（静态表，零动态分配）。
 *        review P0-3 / Phase 2 Task 2-3。esp32 等真机暂不接入；wasm 单线程沙箱无需。
 */
#include "pal_resource.h"
#include <stddef.h>
#include <string.h>

typedef struct {
    pal_resource_type_t type;
    uint32_t            id;
    const char         *owner;   /* 静态存储，见 pal_resource.h 生命周期契约 */
} pal_resource_claim_t;

static pal_resource_claim_t s_claims[PAL_RESOURCE_MAX_CLAIMS];
static uint32_t s_count = 0;

void pal_resource_reset(void) {
    s_count = 0;
}

WINK_WARN_UNUSED_RESULT
wink_status_t pal_resource_claim(pal_resource_type_t type, uint32_t id, const char *owner) {
    /* 幂等 / 冲突判定：同 (type,id) 同 owner → OK；不同 owner → BUSY */
    for (uint32_t i = 0; i < s_count; i++) {
        if (s_claims[i].type == type && s_claims[i].id == id) {
            if (strcmp(s_claims[i].owner, owner) == 0) {
                return WINK_OK;        /* 同 owner：幂等 */
            }
            return WINK_ERR_BUSY;      /* 不同 owner：冲突 */
        }
    }
    if (s_count >= PAL_RESOURCE_MAX_CLAIMS) {
        return WINK_ERR_RESOURCE_EXHAUSTED;
    }
    s_claims[s_count].type  = type;
    s_claims[s_count].id    = id;
    s_claims[s_count].owner = owner;
    s_count++;
    return WINK_OK;
}

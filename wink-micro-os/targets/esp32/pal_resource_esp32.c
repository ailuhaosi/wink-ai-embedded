/**
 * @file pal_resource_esp32.c
 * @brief ESP32 真机资源占用治理实现（静态表 + 临界区保护）。
 *
 * 架构评审修复 #5：引脚资源冲突防护。
 * 检测 GPIO 引脚 / PWM 通道 / I2C 端口的重复占用冲突。
 * 多核心安全：使用 FreeRTOS 临界区保护静态表。
 */
#include "pal_resource.h"
#include <stddef.h>
#include <string.h>

#if defined(ESP_PLATFORM)
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#endif

typedef struct {
    pal_resource_type_t type;
    uint32_t            id;
    const char         *owner;   /* 静态存储，见 pal_resource.h 生命周期契约 */
} pal_resource_claim_t;

static pal_resource_claim_t s_claims[PAL_RESOURCE_MAX_CLAIMS];
static uint32_t s_count = 0;

void pal_resource_reset(void) {
#if defined(ESP_PLATFORM)
    taskENTER_CRITICAL(NULL);
#endif
    s_count = 0;
#if defined(ESP_PLATFORM)
    taskEXIT_CRITICAL(NULL);
#endif
}

WINK_WARN_UNUSED_RESULT
wink_status_t pal_resource_claim(pal_resource_type_t type, uint32_t id, const char *owner) {
    /* 参数校验 */
    if (owner == NULL) {
        return WINK_ERR_INVALID_ARG;
    }

#if defined(ESP_PLATFORM)
    taskENTER_CRITICAL(NULL);
#endif

    /* 幂等 / 冲突判定：同 (type,id) 同 owner → OK；不同 owner → BUSY */
    for (uint32_t i = 0; i < s_count; i++) {
        if (s_claims[i].type == type && s_claims[i].id == id) {
            if (strcmp(s_claims[i].owner, owner) == 0) {
#if defined(ESP_PLATFORM)
                taskEXIT_CRITICAL(NULL);
#endif
                return WINK_OK;        /* 同 owner：幂等 */
            }
#if defined(ESP_PLATFORM)
            taskEXIT_CRITICAL(NULL);
#endif
            return WINK_ERR_BUSY;      /* 不同 owner：冲突 */
        }
    }

    if (s_count >= PAL_RESOURCE_MAX_CLAIMS) {
#if defined(ESP_PLATFORM)
        taskEXIT_CRITICAL(NULL);
#endif
        return WINK_ERR_RESOURCE_EXHAUSTED;
    }

    s_claims[s_count].type  = type;
    s_claims[s_count].id    = id;
    s_claims[s_count].owner = owner;
    s_count++;

#if defined(ESP_PLATFORM)
    taskEXIT_CRITICAL(NULL);
#endif
    return WINK_OK;
}

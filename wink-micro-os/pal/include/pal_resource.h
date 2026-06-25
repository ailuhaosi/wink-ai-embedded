/**
 * @file pal_resource.h
 * @brief host/debug target 资源占用治理（静态表，零动态分配）。
 *
 * 检测 GPIO 引脚 / PWM 通道 / I2C 端口的重复占用冲突（review P0-3 / Phase 2 Task 2-3）。
 * 仅 host/debug target；esp32 等真机的等价治理随 P2-6 ROADMAP 推进，wasm 单线程沙箱无需。
 *
 * ⚠ owner 生命周期契约：静态表**持有 owner 指针（不拷贝字符串）**。owner 必须指向
 *    生命周期 ≥ 资源占用期的静态存储——实践中仅接受**字符串字面量**或 device_tree 中的
 *    静态名。传栈上/临时字符串会产生悬垂指针。若需放宽，应在 claim 时 strncpy 到表内
 *    固定缓冲（增加每项体积，权衡，本阶段未做）。
 *
 * ⚠ host-only：pal_resource_* 仅 host/debug 编译接入。真机 target 不得假装已治理。
 */
#ifndef PAL_RESOURCE_H
#define PAL_RESOURCE_H

#include <stdint.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief 受治理的资源类型 */
typedef enum {
    PAL_RESOURCE_GPIO_PIN    = 1,
    PAL_RESOURCE_PWM_CHANNEL = 2,
    PAL_RESOURCE_I2C_PORT    = 3,
} pal_resource_type_t;

/** @brief 静态占用表容量（可按平台 -D 调整） */
#ifndef PAL_RESOURCE_MAX_CLAIMS
#define PAL_RESOURCE_MAX_CLAIMS 32
#endif

/**
 * @brief 占用一个资源
 * @param type 资源类型
 * @param id 资源标识（GPIO pin / PWM channel / I2C port）
 * @param owner 占用方静态字符串（须为字面量/静态存储，见文件头生命周期契约）
 * @return WINK_OK / WINK_ERR_BUSY(已被不同 owner 占用) / WINK_ERR_RESOURCE_EXHAUSTED(表满)
 * @note 幂等：同 (type,id) 同 owner → WINK_OK；不同 owner → WINK_ERR_BUSY。
 */
WINK_WARN_UNUSED_RESULT
wink_status_t pal_resource_claim(pal_resource_type_t type, uint32_t id, const char *owner);

/** @brief 清空资源占用表（测试隔离 / 启动重置用） */
void pal_resource_reset(void);

#ifdef __cplusplus
}
#endif

#endif /* PAL_RESOURCE_H */

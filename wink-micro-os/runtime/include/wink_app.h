/**
 * @file wink_app.h
 * @brief App 回调契约 —— 生成式 App 通过此结构体向 runtime 注册生命周期钩子。
 *
 * 回调注入（非 extern）：runtime 库不持有对外部 app_* 符号的强依赖，
 * 达成二进制级解耦（见 03-directory-architecture.md §7）。target entry 实例化
 * 本结构体并调用 wink_runtime_run。
 */
#ifndef WINK_APP_H
#define WINK_APP_H

#include <stdint.h>
#include "wink_status.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief App 生命周期回调集合（各字段允许为 NULL，runtime 跳过）
 *  - init:    启动时调用一次
 *  - loop:    每个 tick 调用
 *  - on_fault: 故障时调用（fault_code 由 runtime 或 App 上报）
 */
typedef struct {
    void (*init)(void);
    void (*loop)(void);
    void (*on_fault)(uint32_t fault_code);
} wink_app_callbacks_t;

/** @brief App 侧周期延时（内部转 PAL pal_delay_ms，语义由 target 实现） */
void wink_app_delay_ms(uint32_t ms);

#ifdef __cplusplus
}
#endif

#endif /* WINK_APP_H */

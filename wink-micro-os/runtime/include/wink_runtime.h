/**
 * @file wink_runtime.h
 * @brief OS 主循环入口（target-agnostic）。
 *
 * 各 target 的 *_entry.c 实例化 wink_app_callbacks_t 后调用 wink_runtime_run。
 * 调度器仅用 PAL OSAL 做 tick，挂起语义由 target 实现（ADR-0002 双 target 对齐落点）。
 */
#ifndef WINK_RUNTIME_H
#define WINK_RUNTIME_H

#include "wink_app.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief 单 tick 默认延时（ms），可被 target/app 覆盖（编译期 -D） */
#ifndef WINK_RUNTIME_TICK_MS
#define WINK_RUNTIME_TICK_MS 10
#endif

/**
 * @brief 运行 OS 主循环
 * @param callbacks App 生命周期回调（NULL 返回 WINK_ERR_INVALID_ARG）
 * @param max_ticks 最多跑多少个 loop tick；传 0 表示无限循环（真机/wasm）
 * @return WINK_OK（max_ticks>0 跑完后）或 WINK_ERR_INVALID_ARG
 * @note host/测试传有限 max_ticks 避免 while(1) 卡死
 */
WINK_WARN_UNUSED_RESULT
wink_status_t wink_runtime_run(const wink_app_callbacks_t *callbacks, uint32_t max_ticks);

#ifdef __cplusplus
}
#endif

#endif /* WINK_RUNTIME_H */

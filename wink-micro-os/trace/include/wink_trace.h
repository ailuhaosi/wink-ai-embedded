/**
 * @file wink_trace.h
 * @brief Golden Trace —— 故障/事件记录的一等 peer 层。
 *
 * 定位见 03-directory-architecture.md §4（trace 独立顶层，非 runtime 子特性）。
 * 零动态分配（§6.1 约束1）：内部用静态环形缓冲。
 * 隔离契约（§6.1 约束2）：DAL/PAL 驱动禁调本 API；仅 runtime 调度器与 App 回调调用。
 * 并发契约：Thread-safe / ISR-safe —— 内部由 PAL OSAL 全局临界区（关中断/自旋锁）保护。
 */
#ifndef WINK_TRACE_H
#define WINK_TRACE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** @brief 环形缓冲容量（静态分配，可按平台调整） */
#ifndef WINK_TRACE_CAPACITY
#define WINK_TRACE_CAPACITY 32
#endif

/**
 * @brief 清空 trace 缓冲（启动/测试前调用）
 * @note Thread-safety: Thread-safe.
 * @note ISR-safe: Yes (ISR 可安全重入/调用).
 */
void wink_trace_reset(void);

/**
 * @brief 记录一个故障码
 * @param fault_code 业务自定义故障码（由 App/runtime 在 fault 路径上报）
 * @note 满则覆盖最旧记录（环形）
 * @note Thread-safety: Thread-safe.
 * @note ISR-safe: Yes (ISR 可安全重入/调用).
 */
void wink_trace_fault(uint32_t fault_code);

/**
 * @brief 当前已记录条数（≤ WINK_TRACE_CAPACITY）
 * @note Thread-safety: Thread-safe.
 * @note ISR-safe: Yes (ISR 可安全重入/调用).
 */
uint32_t wink_trace_count(void);

/**
 * @brief 最近一条故障码；无记录返回 0
 * @note Thread-safety: Thread-safe.
 * @note ISR-safe: Yes (ISR 可安全重入/调用).
 */
uint32_t wink_trace_last(void);

#ifdef __cplusplus
}
#endif

#endif /* WINK_TRACE_H */

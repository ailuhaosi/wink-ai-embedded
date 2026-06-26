/**
 * @file wink_status.h
 * @brief 统一状态返回类型与错误码
 *
 * ⚠ SSOT 闭环：本头是 docs/design/07-platform-governance/02-error-fault-model.md §2
 *    的落地物。错误码取值、命名、码段分区必须与该规范逐字一致；任何变更先改
 *    02-error-fault-model.md，再同步本头（避免第三处漂移）。
 *    约定：0 = WINK_OK，负数 = 错误；判定用 if (status < 0)，禁 if (status)。
 */
#ifndef WINK_STATUS_H
#define WINK_STATUS_H

#include <stddef.h>   /* NULL —— 显式包含，保证 ESP-IDF/newlib 精简头文件下也可用
                        （此前 host/wasm 靠传递包含侥幸通过，是移植性隐患） */

#ifdef __cplusplus
extern "C" {
#endif

/* 便携「返回值不可忽略」宏（c-code.md；禁裸写 __attribute__）。
 * MSVC 下退化为空，保证双 target 同源 (ADR-0002)。 */
#if defined(__GNUC__) || defined(__clang__)
    #define WINK_WARN_UNUSED_RESULT __attribute__((warn_unused_result))
#else
    #define WINK_WARN_UNUSED_RESULT
#endif

/* 与 02-error-fault-model.md §2 逐字一致 (ADR-0001 方案 C + ADR-0005 -50s 降级段) */
typedef enum {
    WINK_OK = 0,

    /* 通用可恢复错误（负数，对齐 Linux/POSIX 惯例） */
    WINK_ERR_INVALID_ARG        = -1,
    WINK_ERR_TIMEOUT            = -2,
    WINK_ERR_DISCONNECTED       = -3,
    WINK_ERR_OUT_OF_RANGE       = -4,
    WINK_ERR_IO                 = -5,
    WINK_ERR_BUSY               = -6,
    WINK_ERR_UNSUPPORTED        = -7,
    WINK_ERR_CHECKSUM           = -8,
    WINK_ERR_PERMISSION         = -9,
    WINK_ERR_RESOURCE_EXHAUSTED = -10,
    WINK_ERR_NOT_INITIALIZED    = -11,
    WINK_ERR_HARDWARE           = -12,   /* 硬件/驱动返回非 OK（如 ESP-IDF esp_err_t） */

    /* 功能安全相关（区分可恢复 / 致命） */
    WINK_ERR_OVERCURRENT        = -20,   /* 过流（可恢复：限流重试） */
    WINK_ERR_OVERTEMPERATURE    = -21,   /* 过温（可恢复：降频） */
    WINK_ERR_WATCHDOG           = -30,   /* 看门狗超时（致命：复位） */
    WINK_ERR_OVERFLOW           = -40,   /* 数值溢出 / 计算 UB（致命） */

    /* 可恢复降级 (ADR-0005)：系统已安全降级、应继续运行（非 halt） */
    WINK_ERR_CONFIG_CORRUPT_DEGRADED = -50,   /* NVS/配置损坏 → 用安全默认值继续 */
    WINK_ERR_FAILED_INIT             = -51,   /* 器件 init 失败 → 器件隔离，系统继续 */

    WINK_ERR_PANIC              = -99,   /* 不可恢复，需 halt */
} wink_status_t;

/** @brief 判定状态是否为错误 (status < 0)；对 -50s 降级状态同样正确捕获 */
static inline int wink_status_is_error(wink_status_t s) {
    return s < 0;
}

#ifdef __cplusplus
}
#endif

#endif /* WINK_STATUS_H */

/**
 * @file pal_hal_esp32_rmt.c
 * @brief ESP32 RMT 硬件脉冲捕获（超声波专用）。
 *
 * 使用 RMT (Remote Control) 外设实现非阻塞超声波脉冲测量，
 * 完全替换 pal_hal_esp32.c 中的 busy-wait 实现，不阻塞 tick。
 *
 * 设计要点：
 * - RMT 时钟 80MHz，分频因子 80 → 1MHz 分辨率 (1us/ tick)
 * - 双沿捕获：上升沿开始计数，下降沿停止
 * - 与 HC-SR04 工作流程完美匹配：TRIG 输出 → RMT 接收 ECHO 脉宽
 *
 * 使用方法（替代 pal_gpio_pulse_in）：
 *   pal_rmt_ultrasonic_init(echo_pin);
 *   pal_gpio_write(trig_pin, true); pal_delay_us(10); pal_gpio_write(trig_pin, false);
 *   uint32_t pulse_us;
 *   if (pal_rmt_ultrasonic_measure(30000, &pulse_us) == WINK_OK) { ... }
 *
 * TODO: Phase 4 将此接口标准化为 PAL 层非阻塞捕获 API。
 */

#include "pal_hal.h"

#if defined(ESP_PLATFORM)
#include "driver/rmt_rx.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#define RMT_CLK_DIV         80      /* 80MHz / 80 = 1MHz → 1us resolution */
#define RMT_MEM_BLOCK_SYMB  64      /* 每个 memory block 64 symbols */
#define RMT_RX_MAX_BYTES    1024    /* Ring buffer size */

/* 全局状态（单实例超声波，MVP 阶段暂不支持多路） */
static rmt_channel_handle_t   s_rmt_rx_chan = NULL;
static rmt_rx_done_event_data_t s_rx_done_data;
static SemaphoreHandle_t      s_rx_done_sem = NULL;
static uint16_t               s_echo_pin = 0xFFFF;

/* ─────────────────────────────────────────────────────────
 * RMT RX 完成回调 (ISR context)
 * ───────────────────────────────────────────────────────── */

static bool IRAM_ATTR rmt_rx_done_callback(rmt_channel_handle_t channel,
                                            const rmt_rx_done_event_data_t *edata,
                                            void *user_data) {
    BaseType_t high_task_wakeup = pdFALSE;
    s_rx_done_data = *edata;  /* 浅拷贝 received symbols */
    xSemaphoreGiveFromISR(s_rx_done_sem, &high_task_wakeup);
    return high_task_wakeup == pdTRUE;
}

/* ─────────────────────────────────────────────────────────
 * 初始化 RMT 超声波捕获通道
 * ───────────────────────────────────────────────────────── */

wink_status_t pal_rmt_ultrasonic_init(uint16_t echo_pin) {
    if (s_rmt_rx_chan != NULL) {
        return WINK_OK;  /* 已初始化 */
    }

    s_echo_pin = echo_pin;

    /* 创建 RMT RX channel */
    rmt_rx_channel_config_t rx_cfg = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .resolution_hz = 1000000,  /* 1MHz = 1us/tick */
        .mem_block_symbols = RMT_MEM_BLOCK_SYMB,
        .gpio_num = echo_pin,
        .flags.invert_in = false,
        .flags.with_dma = false,
        .flags.io_loop_back = false,
    };
    esp_err_t err = rmt_new_rx_channel(&rx_cfg, &s_rmt_rx_chan);
    if (err != ESP_OK) {
        return WINK_ERR_HARDWARE;
    }

    /* 创建完成信号量 */
    s_rx_done_sem = xSemaphoreCreateBinary();
    if (s_rx_done_sem == NULL) {
        return WINK_ERR_RESOURCE_EXHAUSTED;
    }

    /* 注册回调 */
    rmt_rx_event_callbacks_t cbs = {
        .on_recv_done = rmt_rx_done_callback,
    };
    err = rmt_rx_register_event_callbacks(s_rmt_rx_chan, &cbs, NULL);
    if (err != ESP_OK) {
        return WINK_ERR_HARDWARE;
    }

    /* 启用 RMT */
    err = rmt_enable(s_rmt_rx_chan);
    if (err != ESP_OK) {
        return WINK_ERR_HARDWARE;
    }

    return WINK_OK;
}

/* ─────────────────────────────────────────────────────────
 * 执行一次超声波脉宽测量（非阻塞，由 RMT 硬件完成）
 * ───────────────────────────────────────────────────────── */

wink_status_t pal_rmt_ultrasonic_measure(uint32_t timeout_us, uint32_t *pulse_us) {
    if (pulse_us == NULL || s_rmt_rx_chan == NULL) {
        return WINK_ERR_INVALID_ARG;
    }

    /* 清空信号量 */
    xSemaphoreTake(s_rx_done_sem, 0);

    /* 启动 RMT 接收（等待第一个上升沿开始捕获） */
    rmt_receive_config_t recv_cfg = {
        .signal_range_min_ns = 1000,     /* 1us, 过滤毛刺 */
        .signal_range_max_ns = (uint32_t)((uint64_t)timeout_us * 1000),  /* 超时对应最大脉宽 */
    };
    esp_err_t err = rmt_receive(s_rmt_rx_chan, s_rx_done_data.received_symbols,
                                 sizeof(s_rx_done_data.received_symbols), &recv_cfg);
    if (err != ESP_OK) {
        return WINK_ERR_HARDWARE;
    }

    /* 等待 RMT 捕获完成（阻塞但不消耗 CPU，由 FreeRTOS 调度） */
    BaseType_t ok = xSemaphoreTake(s_rx_done_sem, pdMS_TO_TICKS((timeout_us + 999) / 1000 + 1));
    if (ok != pdPASS) {
        /* 超时：停止接收，返回 TIMEOUT */
        rmt_receive(s_rmt_rx_chan, NULL, 0, NULL);
        return WINK_ERR_TIMEOUT;
    }

    /* 解析 RMT symbols → 超声波脉宽
     *
     * HC-SR04 波形：
     *   [0] duration0: 低电平时间 (从 TRIG 结束到 ECHO 上升沿, 可忽略)
     *       level0: 0 (低)
     *   [1] duration1: 高电平时间 (ECHO 脉冲宽度, 即为所需值)
     *       level1: 1 (高)
     */
    if (s_rx_done_data.num_symbols >= 1) {
        /* 取第一个高电平脉冲的 duration */
        *pulse_us = s_rx_done_data.received_symbols[0].duration1;
        return WINK_OK;
    }

    return WINK_ERR_TIMEOUT;
}

/* ─────────────────────────────────────────────────────────
 * 反初始化 RMT 通道
 * ───────────────────────────────────────────────────────── */

void pal_rmt_ultrasonic_deinit(void) {
    if (s_rmt_rx_chan != NULL) {
        rmt_disable(s_rmt_rx_chan);
        rmt_del_channel(s_rmt_rx_chan);
        s_rmt_rx_chan = NULL;
    }
    if (s_rx_done_sem != NULL) {
        vSemaphoreDelete(s_rx_done_sem);
        s_rx_done_sem = NULL;
    }
}

#else  /* !ESP_PLATFORM - stub implementations for static analysis */

wink_status_t pal_rmt_ultrasonic_init(uint16_t echo_pin) {
    (void)echo_pin; return WINK_ERR_UNSUPPORTED;
}

wink_status_t pal_rmt_ultrasonic_measure(uint32_t timeout_us, uint32_t *pulse_us) {
    (void)timeout_us; (void)pulse_us; return WINK_ERR_UNSUPPORTED;
}

void pal_rmt_ultrasonic_deinit(void) {}

#endif  /* ESP_PLATFORM */

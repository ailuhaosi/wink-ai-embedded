/**
 * @file test_oled_dashboard_e2e.c
 * @brief OLED Dashboard host e2e：初始化 → 跑 N tick → 验证 LED + I2C flush + 无 fault。
 */
#include "wink_runtime.h"
#include "wink_trace.h"
#include "device_tree.h"
#include "host_test_ctrl.h"

extern const wink_app_callbacks_t *wink_app_get_callbacks(void);

#define E2E_PASS() do { extern int puts(const char*); puts("E2E PASS"); return 0; } while(0)
#define E2E_FAIL(msg) do { extern int puts(const char*); puts("E2E FAIL: " msg); return 1; } while(0)

int main(void) {
    wink_trace_reset();
    sim_reset_time();
    const wink_app_callbacks_t *cb = wink_app_get_callbacks();

    /* 跑 5 tick：第 3 tick 后按钮去抖完成 → pressed → LED on + OLED flush */
    {
        wink_status_t s = wink_runtime_run(cb, 5);
        (void)s;
    }

    /* 验证 LED 点亮（host 下 active_low 按钮恒 pressed） */
    if (!status_led.is_on) E2E_FAIL("LED not on after ticks");

    /* 验证 OLED 已 flush（I2C transfer 发生） */
    if (sim_i2c_transfer_count() == 0) E2E_FAIL("no I2C transfers (OLED not flushed)");
    if (sim_last_i2c_addr() != 0x3C) E2E_FAIL("I2C addr mismatch");

    /* 验证帧缓冲非空（"Hi!" 已渲染） */
    int nonzero = 0;
    for (int i = 0; i < SSD1306_FB_SIZE; i++) {
        if (status_oled.framebuffer[i] != 0) { nonzero++; }
    }
    if (nonzero == 0) E2E_FAIL("framebuffer empty (text not drawn)");

    /* 验证无 fault */
    if (wink_trace_count() != 0) E2E_FAIL("faults recorded during run");

    E2E_PASS();
}

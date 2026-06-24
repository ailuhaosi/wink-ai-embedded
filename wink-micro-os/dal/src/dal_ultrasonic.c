#include "dal_ultrasonic.h"
#include "pal_hal.h"
#include "pal_osal.h"

#define ULTRASONIC_TIMEOUT_US 30000u   /* 30ms 超时保护 */
#define ULTRASONIC_CM_PER_US  0.017f   /* 声速换算系数 (340m/s, 往返折半) */

/* ---- 两端共享：脉宽(us) -> 距离(cm) ----
 * 非 static 以便单元测试 extern 访问（例外：无副作用纯函数，风险可控）。 */
float dal_pulse_us_to_cm(uint32_t pulse_us) {
    return (float)pulse_us * ULTRASONIC_CM_PER_US;
}

#ifdef SIMULATION
/* --- 仿真模式：仅旁路底层物理量来源（trigger + echo 脉宽），
       换算与超时与真机同源 (ADR-0003 决策2 / c-code.md §2)。
       extern 签名抄 wasm_bridge.h（SSOT 闭合）。 --- */
#include "wasm_bridge.h"

wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) { return WINK_ERR_INVALID_ARG; }

    /* 1. trigger 时序旁路（真机侧为 GPIO 10us 脉冲） */
    js_sim_trigger_ultrasonic(dev->trig_pin);

    /* 2. echo 脉宽测量旁路（真机侧为 while 循环测高电平） */
    uint32_t pulse_us = js_sim_measure_echo_pulse_us(dev->trig_pin);
    if (pulse_us >= ULTRASONIC_TIMEOUT_US) { return WINK_ERR_TIMEOUT; }

    /* 3. 换算：两端同源 */
    dev->last_distance = dal_pulse_us_to_cm(pulse_us);
    *distance_cm = dev->last_distance;
    return WINK_OK;
}

#else
/* --- 真实芯片模式 --- */
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) { return WINK_ERR_INVALID_ARG; }

    pal_gpio_write(dev->trig_pin, true);
    pal_delay_us(10);
    pal_gpio_write(dev->trig_pin, false);

    uint64_t wait_start = pal_get_us();
    while (!pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - wait_start > ULTRASONIC_TIMEOUT_US) { return WINK_ERR_TIMEOUT; }
    }

    uint64_t echo_start = pal_get_us();
    while (pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - echo_start > ULTRASONIC_TIMEOUT_US) { return WINK_ERR_TIMEOUT; }
    }
    uint32_t pulse_us = (uint32_t)(pal_get_us() - echo_start);

    dev->last_distance = dal_pulse_us_to_cm(pulse_us);
    *distance_cm = dev->last_distance;
    return WINK_OK;
}
#endif

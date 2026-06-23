#include "dal_ultrasonic.h"
#include "pal_hal.h"
#include "pal_osal.h"

#ifdef SIMULATION
// --- 1. Web 仿真直通旁路模式 (VDL Value Bypass) ---
// 声明由 Web 沙箱 JS 环境注入的外部供给接口
extern float js_sim_get_ultrasonic_distance(uint16_t trig_pin);

float dal_ultrasonic_get_distance(dal_ultrasonic_t *dev) {
    if (!dev) return -1.0f;
    // 直接绕过微观电平时序等待，向网页 3D 仿真环境拉取距离值
    dev->last_distance = js_sim_get_ultrasonic_distance(dev->trig_pin);
    return dev->last_distance;
}

#else
// --- 2. 真实芯片运行模式 (Physical MCU Mode) ---
float dal_ultrasonic_get_distance(dal_ultrasonic_t *dev) {
    if (!dev) return -1.0f;

    // 1. Trig 引脚拉高，并保持至少 10 微秒以触发脉冲
    pal_gpio_write(dev->trig_pin, true);
    pal_delay_us(10);
    pal_gpio_write(dev->trig_pin, false);

    // 2. 计数等待 Echo 引脚变高 (微秒级超时保护)
    uint64_t wait_start = pal_get_us();
    while (!pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - wait_start > 30000) { // 30ms 还没有响应则超时
            return -1.0f;
        }
    }

    // 3. 测量 Echo 高电平脉宽
    uint64_t echo_start = pal_get_us();
    while (pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - echo_start > 30000) { // 30ms 还没有拉低则超时
            return -1.0f;
        }
    }
    uint64_t pulse_duration_us = pal_get_us() - echo_start;

    // 4. 将回响时间转换为厘米距离 (340m/s -> 0.034cm/us -> 往返折半)
    dev->last_distance = (float)pulse_duration_us * 0.017f;
    return dev->last_distance;
}
#endif

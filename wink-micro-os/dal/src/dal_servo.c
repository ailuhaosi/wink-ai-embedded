#include "dal_servo.h"
#include "pal_hal.h"

// 舵机通常采用 50Hz 频率 (周期为 20ms = 20000us)
#define SERVO_PWM_FREQ_HZ   50

bool dal_servo_set_angle(dal_servo_t *dev, float angle) {
    if (!dev) return false;
    
    // 约束输入角度范围
    if (angle < 0.0f) angle = 0.0f;
    if (angle > 180.0f) angle = 180.0f;
    
    dev->current_angle = angle;
    
    // 1. 将角度转换为高电平脉宽时间 (0.0° - 180.0° -> min_pulse_ms 到 max_pulse_ms)
    float pulse_width_ms = dev->min_pulse_ms + 
        (angle / 180.0f) * (dev->max_pulse_ms - dev->min_pulse_ms);
        
    // 2. 将脉宽转换成 20ms 周期下的 PWM 占空比百分比
    // e.g. 0.5ms / 20ms = 0.025 -> 2.5f %
    // e.g. 2.5ms / 20ms = 0.125 -> 12.5f %
    float duty_percent = (pulse_width_ms / 20.0f) * 100.0f;
    
    // 3. 初始化并调用底层的 PWM 控制接口
    // 注：在实际工程中，PWM 初始化通常在设备树加载时进行一次，此处简化为每次设置均确保初始化
    pal_pwm_init(dev->pwm_channel, SERVO_PWM_FREQ_HZ);
    return pal_pwm_set_duty(dev->pwm_channel, duty_percent);
}

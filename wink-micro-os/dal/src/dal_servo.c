#include "dal_servo.h"
#include "pal_hal.h"

#define SERVO_PWM_FREQ_HZ 50   /* 50Hz -> 周期 20ms */

wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle) {
    if (dev == NULL) return WINK_ERR_INVALID_ARG;

    if (angle < 0.0f) angle = 0.0f;
    if (angle > 180.0f) angle = 180.0f;
    dev->current_angle = angle;

    float pulse_width_ms = dev->min_pulse_ms +
        (angle / 180.0f) * (dev->max_pulse_ms - dev->min_pulse_ms);
    float duty_percent = (pulse_width_ms / 20.0f) * 100.0f;

    if (!pal_pwm_init(dev->pwm_channel, SERVO_PWM_FREQ_HZ)) return WINK_ERR_IO;
    if (!pal_pwm_set_duty(dev->pwm_channel, duty_percent)) return WINK_ERR_IO;
    return WINK_OK;
}

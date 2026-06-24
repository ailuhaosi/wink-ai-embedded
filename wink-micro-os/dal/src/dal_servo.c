#include "dal_servo.h"
#include "pal_hal.h"

#define SERVO_PWM_FREQ_HZ    50                             /* 50Hz -> 周期 20ms */
#define SERVO_PERIOD_MS      (1000.0f / SERVO_PWM_FREQ_HZ)  /* 派生：单一真相源，禁再写 20.0f */
#define SERVO_MIN_ANGLE_DEG  0.0f
#define SERVO_MAX_ANGLE_DEG  180.0f
#define SERVO_DUTY_FULL_PCT  100.0f

wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle) {
    if (dev == NULL) { return WINK_ERR_INVALID_ARG; }

    if (angle < SERVO_MIN_ANGLE_DEG) { angle = SERVO_MIN_ANGLE_DEG; }
    if (angle > SERVO_MAX_ANGLE_DEG) { angle = SERVO_MAX_ANGLE_DEG; }
    dev->current_angle = angle;

    float pulse_width_ms = dev->min_pulse_ms +
        (angle / SERVO_MAX_ANGLE_DEG) * (dev->max_pulse_ms - dev->min_pulse_ms);
    float duty_percent = (pulse_width_ms / SERVO_PERIOD_MS) * SERVO_DUTY_FULL_PCT;

    if (!pal_pwm_init(dev->pwm_channel, SERVO_PWM_FREQ_HZ)) { return WINK_ERR_IO; }
    if (!pal_pwm_set_duty(dev->pwm_channel, duty_percent)) { return WINK_ERR_IO; }
    return WINK_OK;
}

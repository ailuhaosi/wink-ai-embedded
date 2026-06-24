#include "dal_ultrasonic.h"
#include "pal_hal.h"
#include "pal_osal.h"

#ifdef SIMULATION
/* --- 旧整 bypass 形态（Task 5 将收窄）--- */
extern float js_sim_get_ultrasonic_distance(uint16_t trig_pin);

wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) return WINK_ERR_INVALID_ARG;
    dev->last_distance = js_sim_get_ultrasonic_distance(dev->trig_pin);
    *distance_cm = dev->last_distance;
    return WINK_OK;
}

#else
/* --- 真实芯片模式 --- */
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *distance_cm) {
    if (dev == NULL || distance_cm == NULL) return WINK_ERR_INVALID_ARG;

    pal_gpio_write(dev->trig_pin, true);
    pal_delay_us(10);
    pal_gpio_write(dev->trig_pin, false);

    uint64_t wait_start = pal_get_us();
    while (!pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - wait_start > 30000) return WINK_ERR_TIMEOUT;
    }

    uint64_t echo_start = pal_get_us();
    while (pal_gpio_read(dev->echo_pin)) {
        if (pal_get_us() - echo_start > 30000) return WINK_ERR_TIMEOUT;
    }
    uint64_t pulse_duration_us = pal_get_us() - echo_start;

    dev->last_distance = (float)pulse_duration_us * 0.017f;
    *distance_cm = dev->last_distance;
    return WINK_OK;
}
#endif

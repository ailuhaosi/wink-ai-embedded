#include "dal_led.h"
#include "pal_hal.h"

wink_status_t dal_led_init(dal_led_t *dev, uint16_t pin, bool active_high) {
    if (dev == NULL) { return WINK_ERR_INVALID_ARG; }
    wink_status_t status = pal_gpio_init(pin, PAL_GPIO_OUTPUT_PUSH_PULL);
    if (wink_status_is_error(status)) { return status; }
    dev->pin         = pin;
    dev->active_high = active_high;
    dev->is_on       = false;
    dev->initialized = true;
    return WINK_OK;
}

wink_status_t dal_led_on(dal_led_t *dev) {
    return dal_led_set(dev, true);
}

wink_status_t dal_led_off(dal_led_t *dev) {
    return dal_led_set(dev, false);
}

wink_status_t dal_led_set(dal_led_t *dev, bool on) {
    if (dev == NULL) { return WINK_ERR_INVALID_ARG; }
    if (!dev->initialized) { return WINK_ERR_NOT_INITIALIZED; }
    bool level = on ? dev->active_high : (!dev->active_high);
    pal_gpio_write(dev->pin, level);
    dev->is_on = on;
    return WINK_OK;
}

wink_status_t dal_led_toggle(dal_led_t *dev) {
    if (dev == NULL) { return WINK_ERR_INVALID_ARG; }
    if (!dev->initialized) { return WINK_ERR_NOT_INITIALIZED; }
    return dal_led_set(dev, !dev->is_on);
}

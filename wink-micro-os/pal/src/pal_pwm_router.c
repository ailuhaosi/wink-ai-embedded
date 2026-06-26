/**
 * @file pal_pwm_router.c
 * @brief target 无关 PWM 定时器分配状态机实现（纯逻辑，无锁，无硬件）。
 *
 * 非并发契约见 pal_pwm_router.h。host/wasm/esp32 三 target 共享链接。
 */
#include "pal_pwm_router.h"

typedef struct {
    uint32_t freq_hz;
    uint8_t  ref_count;
} pwm_timer_slot_t;

static pwm_timer_slot_t s_timer_slots[PAL_PWM_TIMERS];
static bool    s_channel_init[PAL_PWM_CHANNELS];
static uint32_t s_channel_freq[PAL_PWM_CHANNELS];
static uint8_t s_channel_timer[PAL_PWM_CHANNELS];

void pal_pwm_router_reset(void) {
    for (uint8_t t = 0; t < PAL_PWM_TIMERS; t++) {
        s_timer_slots[t].freq_hz = 0;
        s_timer_slots[t].ref_count = 0;
    }
    for (uint8_t c = 0; c < PAL_PWM_CHANNELS; c++) {
        s_channel_init[c] = false;
        s_channel_freq[c] = 0;
        s_channel_timer[c] = 0xFF;
    }
}

/* 同频 timer 优先复用；否则首个空闲槽；皆无返回 -1。*/
static int8_t pwm_router_find_slot(uint32_t freq_hz) {
    int8_t free_slot = -1;
    for (uint8_t t = 0; t < PAL_PWM_TIMERS; t++) {
        if (s_timer_slots[t].ref_count > 0 && s_timer_slots[t].freq_hz == freq_hz) {
            return (int8_t)t;
        }
        if (s_timer_slots[t].ref_count == 0 && free_slot < 0) {
            free_slot = (int8_t)t;
        }
    }
    return free_slot;
}

wink_status_t pal_pwm_router_acquire(uint8_t channel, uint32_t freq_hz,
                                     uint8_t *out_timer_num) {
    if (channel >= PAL_PWM_CHANNELS || freq_hz == 0 || out_timer_num == NULL) {
        return WINK_ERR_INVALID_ARG;
    }

    if (s_channel_init[channel]) {
        if (s_channel_freq[channel] == freq_hz) {
            *out_timer_num = s_channel_timer[channel];
            return WINK_OK;                 /* idempotent */
        }
        return WINK_ERR_BUSY;               /* state unchanged */
    }

    int8_t slot = pwm_router_find_slot(freq_hz);
    if (slot < 0) {
        return WINK_ERR_RESOURCE_EXHAUSTED;
    }

    if (s_timer_slots[slot].ref_count == 0) {
        s_timer_slots[slot].freq_hz = freq_hz;
    }
    s_timer_slots[slot].ref_count++;

    s_channel_init[channel] = true;
    s_channel_freq[channel] = freq_hz;
    s_channel_timer[channel] = (uint8_t)slot;
    *out_timer_num = (uint8_t)slot;
    return WINK_OK;
}

void pal_pwm_router_release(uint8_t channel) {
    if (channel >= PAL_PWM_CHANNELS || !s_channel_init[channel]) {
        return;                             /* no-op */
    }
    uint8_t t = s_channel_timer[channel];
    if (t < PAL_PWM_TIMERS && s_timer_slots[t].ref_count > 0) {
        s_timer_slots[t].ref_count--;
        if (s_timer_slots[t].ref_count == 0) {
            s_timer_slots[t].freq_hz = 0;   /* recycle */
        }
    }
    s_channel_init[channel] = false;
    s_channel_freq[channel] = 0;
    s_channel_timer[channel] = 0xFF;
}

bool pal_pwm_router_channel_ready(uint8_t channel) {
    return channel < PAL_PWM_CHANNELS && s_channel_init[channel];
}

uint8_t pal_pwm_router_channel_timer(uint8_t channel) {
    if (!pal_pwm_router_channel_ready(channel)) {
        return 0xFF;
    }
    return s_channel_timer[channel];
}

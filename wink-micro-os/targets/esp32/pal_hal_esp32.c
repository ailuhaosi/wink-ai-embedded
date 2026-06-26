/**
 * @file pal_hal_esp32.c
 * @brief ESP32 真机 PAL HAL 实现（ESP-IDF v5.x）。
 *
 * MVP 阶段说明：
 * - GPIO/PWM/I2C 已实现真实硬件驱动
 * - 超声波脉冲捕获暂用 busy-wait（后续 Phase 4 迁移至 RMT 硬件捕获）
 * - 引脚映射为固定默认值，后续接入 peripheral registry 动态配置
 */
#include "pal_hal.h"
#include "pal_resource.h"

#if defined(ESP_PLATFORM) || defined(ESP32)
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "driver/i2c.h"
#include "esp_err.h"
#else
/* 非 ESP32 编译环境：函数体保持 stub（供静态分析/代码扫描），
 * 真机链接时由 ESP-IDF 构建系统替换为真实实现。 */
typedef int esp_err_t;
#define GPIO_NUM_MAX 50
#define ESP_OK 0
#endif

/* ─────────────────────────────────────────────────────────
 * GPIO 实现
 * ───────────────────────────────────────────────────────── */

wink_status_t pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) {
    if (pin >= GPIO_NUM_MAX) { return WINK_ERR_INVALID_ARG; }

    wink_status_t rs = pal_resource_claim(PAL_RESOURCE_GPIO_PIN, pin, "pal_hal_esp32");
    if (wink_status_is_error(rs)) { return rs; }

#if defined(ESP_PLATFORM)
    gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << pin,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    switch (mode) {
        case PAL_GPIO_INPUT:
            cfg.mode = GPIO_MODE_INPUT;
            break;
        case PAL_GPIO_INPUT_PULLUP:
            cfg.mode = GPIO_MODE_INPUT;
            cfg.pull_up_en = GPIO_PULLUP_ENABLE;
            break;
        case PAL_GPIO_INPUT_PULLDOWN:
            cfg.mode = GPIO_MODE_INPUT;
            cfg.pull_down_en = GPIO_PULLDOWN_ENABLE;
            break;
        case PAL_GPIO_OUTPUT_PUSH_PULL:
            cfg.mode = GPIO_MODE_OUTPUT;
            break;
        case PAL_GPIO_OUTPUT_OPEN_DRAIN:
            cfg.mode = GPIO_MODE_OUTPUT_OD;
            break;
        default:
            return WINK_ERR_INVALID_ARG;
    }

    esp_err_t err = gpio_config(&cfg);
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
#endif
    return WINK_OK;
}

void pal_gpio_write(uint16_t pin, bool level) {
#if defined(ESP_PLATFORM)
    if (pin < GPIO_NUM_MAX) {
        gpio_set_level((gpio_num_t)pin, level ? 1 : 0);
    }
#else
    (void)pin; (void)level;
#endif
}

bool pal_gpio_read(uint16_t pin) {
#if defined(ESP_PLATFORM)
    if (pin >= GPIO_NUM_MAX) { return false; }
    return gpio_get_level((gpio_num_t)pin) != 0;
#else
    (void)pin; return false;
#endif
}

#if defined(ESP_PLATFORM)
static pal_gpio_isr_t s_gpio_isr[GPIO_NUM_MAX];
static void *s_gpio_isr_arg[GPIO_NUM_MAX];

static void IRAM_ATTR gpio_isr_wrapper(void *arg) {
    uint32_t pin = (uint32_t)arg;
    if (pin < GPIO_NUM_MAX && s_gpio_isr[pin] != NULL) {
        s_gpio_isr[pin](s_gpio_isr_arg[pin]);
    }
}
#endif

wink_status_t pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t intr_type,
                                         pal_gpio_isr_t cb, void *arg) {
    if (pin >= GPIO_NUM_MAX || cb == NULL) { return WINK_ERR_INVALID_ARG; }

#if defined(ESP_PLATFORM)
    gpio_int_type_t esp_intr_type;
    switch (intr_type) {
        case PAL_GPIO_INTR_RISING_EDGE:
            esp_intr_type = GPIO_INTR_POSEDGE;
            break;
        case PAL_GPIO_INTR_FALLING_EDGE:
            esp_intr_type = GPIO_INTR_NEGEDGE;
            break;
        case PAL_GPIO_INTR_ANY_EDGE:
            esp_intr_type = GPIO_INTR_ANYEDGE;
            break;
        default:
            return WINK_ERR_INVALID_ARG;
    }

    static bool s_isr_service_installed = false;
    if (!s_isr_service_installed) {
        esp_err_t err = gpio_install_isr_service(0);
        if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
            return WINK_ERR_HARDWARE;
        }
        s_isr_service_installed = true;
    }

    s_gpio_isr[pin] = cb;
    s_gpio_isr_arg[pin] = arg;

    esp_err_t err = gpio_isr_handler_add((gpio_num_t)pin, gpio_isr_wrapper, (void *)pin);
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }

    err = gpio_set_intr_type((gpio_num_t)pin, esp_intr_type);
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
#else
    (void)intr_type; (void)cb; (void)arg;
#endif
    return WINK_OK;
}

wink_status_t pal_gpio_disable_interrupt(uint16_t pin) {
    if (pin >= GPIO_NUM_MAX) { return WINK_ERR_INVALID_ARG; }

#if defined(ESP_PLATFORM)
    esp_err_t err = gpio_set_intr_type((gpio_num_t)pin, GPIO_INTR_DISABLE);
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
    gpio_isr_handler_remove((gpio_num_t)pin);
    s_gpio_isr[pin] = NULL;
#endif
    return WINK_OK;
}

/* ─────────────────────────────────────────────────────────
 * PWM (LEDC) 实现
 * ───────────────────────────────────────────────────────── */

#define PWM_CHANNELS  8

static bool s_pwm_initialized[PWM_CHANNELS] = {false};

wink_status_t pal_pwm_init(uint8_t channel, uint32_t freq_hz) {
    if (channel >= PWM_CHANNELS) { return WINK_ERR_INVALID_ARG; }

    wink_status_t rs = pal_resource_claim(PAL_RESOURCE_PWM_CHANNEL, channel, "pal_hal_esp32");
    if (wink_status_is_error(rs)) { return rs; }

#if defined(ESP_PLATFORM)
    /* FIXME: MVP 阶段固定映射，后续接入 peripheral registry 动态配置
     * channel 0 -> GPIO 2 (板载 LED), 1 -> GPIO 4, 2 -> GPIO 5, 3 -> GPIO 18
     * channel 4 -> GPIO 19, 5 -> GPIO 21, 6 -> GPIO 22, 7 -> GPIO 23 */
    static const int pwm_gpio_map[PWM_CHANNELS] = {2, 4, 5, 18, 19, 21, 22, 23};

    ledc_timer_config_t timer_cfg = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_13_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = freq_hz,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    esp_err_t err = ledc_timer_config(&timer_cfg);
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }

    ledc_channel_config_t ch_cfg = {
        .gpio_num = pwm_gpio_map[channel],
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = (ledc_channel_t)channel,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_0,
        .duty = 0,
        .hpoint = 0,
    };
    err = ledc_channel_config(&ch_cfg);
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
#else
    (void)freq_hz;
#endif

    s_pwm_initialized[channel] = true;
    return WINK_OK;
}

wink_status_t pal_pwm_set_duty(uint8_t channel, float duty_percent) {
    if (channel >= PWM_CHANNELS || !s_pwm_initialized[channel]) {
        return WINK_ERR_INVALID_ARG;
    }
    if (duty_percent < 0.0f) { duty_percent = 0.0f; }
    if (duty_percent > 100.0f) { duty_percent = 100.0f; }

#if defined(ESP_PLATFORM)
    uint32_t duty = (uint32_t)(duty_percent / 100.0f * 8191.0f); /* 13-bit = 8192 */
    esp_err_t err = ledc_set_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)channel, duty);
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
    err = ledc_update_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)channel);
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
#else
    (void)duty_percent;
#endif
    return WINK_OK;
}

/* ─────────────────────────────────────────────────────────
 * I2C 实现
 * ───────────────────────────────────────────────────────── */

#define I2C_PORTS  2

static bool s_i2c_initialized[I2C_PORTS] = {false};

wink_status_t pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                      const uint8_t *write_buf, uint32_t write_len,
                      uint8_t *read_buf, uint32_t read_len) {
    if (port >= I2C_PORTS) { return WINK_ERR_INVALID_ARG; }

#if defined(ESP_PLATFORM)
    if (!s_i2c_initialized[port]) {
        /* FIXME: MVP 阶段固定 SDA/SCL 映射
         * I2C0: SDA=21, SCL=22; I2C1: SDA=33, SCL=32 */
        static const int i2c_sda_map[I2C_PORTS] = {21, 33};
        static const int i2c_scl_map[I2C_PORTS] = {22, 32};

        i2c_config_t cfg = {
            .mode = I2C_MODE_MASTER,
            .sda_io_num = i2c_sda_map[port],
            .scl_io_num = i2c_scl_map[port],
            .sda_pullup_en = GPIO_PULLUP_ENABLE,
            .scl_pullup_en = GPIO_PULLUP_ENABLE,
            .master.clk_speed = 400000,
        };
        esp_err_t err = i2c_param_config((i2c_port_t)port, &cfg);
        if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
        err = i2c_driver_install((i2c_port_t)port, cfg.mode, 0, 0, 0);
        if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
            return WINK_ERR_HARDWARE;
        }
        s_i2c_initialized[port] = true;
    }

    esp_err_t err = i2c_master_write_read_device(
        (i2c_port_t)port, dev_addr,
        write_buf, (size_t)write_len,
        read_buf, (size_t)read_len,
        1000 / portTICK_PERIOD_MS
    );
    if (err != ESP_OK) { return WINK_ERR_HARDWARE; }
#else
    (void)dev_addr; (void)write_buf; (void)write_len; (void)read_buf; (void)read_len;
#endif
    return WINK_OK;
}

/* ─────────────────────────────────────────────────────────
 * GPIO Pulse In（超声波硬件捕获）
 * ───────────────────────────────────────────────────────── */

wink_status_t pal_gpio_pulse_in(uint16_t pin, bool level,
                                  uint32_t timeout_us, uint32_t *pulse_us) {
    /* FIXME: MVP 阶段暂用 busy-wait（会阻塞 tick）。
     * Phase 4 目标：迁移至 RMT + GPIO 双沿 ISR + 硬件定时器实现非阻塞捕获。
     * 当前实现仅供 avoidance_car 示例跑通，实时性不达标。 */
    if (pulse_us == NULL || pin >= GPIO_NUM_MAX) {
        return WINK_ERR_INVALID_ARG;
    }

    uint64_t start = pal_get_us();
    while (pal_gpio_read(pin) != level) {
        if (pal_get_us() - start > timeout_us) {
            return WINK_ERR_TIMEOUT;
        }
    }

    uint64_t pulse_start = pal_get_us();
    while (pal_gpio_read(pin) == level) {
        if (pal_get_us() - start > timeout_us) {
            return WINK_ERR_TIMEOUT;
        }
    }

    *pulse_us = (uint32_t)(pal_get_us() - pulse_start);
    return WINK_OK;
}

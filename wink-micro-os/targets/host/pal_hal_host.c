/**
 * @file pal_hal_host.c
 * @brief host 一等 target 的 PAL HAL 实现。
 *
 * 设计要点（协作式时间推进，迁移自 ADR-0003 计划 Task 2 pal_host_stub.c）：
 *   ultrasonic 真机分支用 while(!pal_gpio_read(echo)){...} 空等 echo 变高。
 *   host 无真实时间流逝，故让 pal_gpio_read 在被调用时把虚拟时间推进到下一个
 *   echo 边沿，驱动 while 循环前进。
 *
 * ⚠ 架构风险：此协作推进强耦合 ultrasonic 真机分支的 while 轮询结构。
 *   若未来驱动改中断/非阻塞，本实现须同步重构（Plan 4 sim 同源测试独立于此耦合）。
 *
 * 注：虚拟时间状态机在 pal_osal_host.c 维护（sim_* API 经 extern 访问）。
 */
#include "pal_hal.h"
#include "host_test_ctrl.h"

/* 虚拟时间状态（OSAL 侧推进，HAL 侧消费）—— 跨文件共享，故 extern */
extern uint64_t host_sim_time_us(void);
extern void host_sim_advance_to(uint64_t us);
extern uint64_t host_echo_rise_us(void);
extern uint64_t host_echo_high_us(void);
extern uint16_t host_echo_pin(void);
extern void host_record_pwm(uint8_t channel, float duty);

#define PWM_CHANNELS 8
/* 协作式 echo 轮询窗口：真机驱动用 while(!read(echo)){ 超时判定 } 空等 echo。
 * host 无真实时间流逝，故 pal_gpio_read 在被调用时把虚拟时间向 echo 边沿推进，
 * 但每次最多推进本窗口——若 echo 在窗口外（远超 30ms 才变高），驱动循环自身的
 * 30ms 超时判定自然触发（模拟「echo 久不响应」）。窗口值对齐器件超时 (30000us)。 */
#define ECHO_POLL_WINDOW_US 30000u

bool pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) { (void)pin; (void)mode; return true; }
void pal_gpio_write(uint16_t pin, bool level) { (void)pin; (void)level; }

bool pal_gpio_read(uint16_t pin) {
    if (pin != host_echo_pin()) return false;
    uint64_t t = host_sim_time_us();
    uint64_t rise = host_echo_rise_us();
    uint64_t high = host_echo_high_us();
    /* 向下一个 echo 边沿推进，但单次最多推进 ECHO_POLL_WINDOW_US，
     * 使驱动 polling 循环的 30ms 超时判定可达（远期 rise 不会被瞬间跳过）。 */
    if (t < rise) {
        uint64_t target = rise;
        if (rise - t > ECHO_POLL_WINDOW_US) target = t + ECHO_POLL_WINDOW_US;
        host_sim_advance_to(target);
        return target >= rise;                /* 推进到变高时刻返回高；窗口内未达返回低 */
    }
    if (t < rise + high) {
        host_sim_advance_to(rise + high);
        return false;                         /* 推进到变低时刻，echo 为低 */
    }
    return false;
}

bool pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t t, pal_gpio_isr_t cb, void *a) {
    (void)pin; (void)t; (void)cb; (void)a; return true;
}
bool pal_gpio_disable_interrupt(uint16_t pin) { (void)pin; return true; }

bool pal_pwm_init(uint8_t channel, uint32_t freq) { (void)channel; (void)freq; return true; }
bool pal_pwm_set_duty(uint8_t channel, float duty) {
    if (channel >= PWM_CHANNELS) return false;
    host_record_pwm(channel, duty);
    return true;
}

bool pal_i2c_transfer(uint8_t port, uint16_t addr,
                      const uint8_t *w, uint32_t wl, uint8_t *r, uint32_t rl) {
    (void)port; (void)addr; (void)w; (void)wl; (void)r; (void)rl; return true;
}

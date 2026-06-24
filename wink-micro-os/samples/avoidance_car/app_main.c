/**
 * @file app_main.c
 * @brief avoidance_car 业务逻辑 + 回调工厂。
 *        简化版（无 dal_led，仅 radar+servo）：雷达探测近障则扫舵机。
 */
#include "device_tree.h"
#include "wink_app.h"
#include "wink_trace.h"
#include "wink_status.h"

#define OBSTACLE_THRESHOLD_CM 20.0f
#define FAULT_FRONT_RADAR     7001u

static void app_init(void) {
    (void)dal_servo_set_angle(&neck_servo, 90.0f);
}

static void app_loop(void) {
    float distance = 0.0f;
    wink_status_t s = dal_ultrasonic_read(&front_radar, &distance);
    if (wink_status_is_error(s)) {
        /* §6.1 约束2：DAL 只返错误码，fault 捕获+trace 在 App 回调内 */
        wink_trace_fault(FAULT_FRONT_RADAR);
        return;
    }
    if (distance > 0.0f && distance < OBSTACLE_THRESHOLD_CM) {
        (void)dal_servo_set_angle(&neck_servo, 180.0f);   /* 近障：扫舵机 */
    } else {
        (void)dal_servo_set_angle(&neck_servo, 90.0f);    /* 复位 */
    }
}

static void app_on_fault(uint32_t fault_code) {
    wink_trace_fault(fault_code);
    (void)dal_servo_set_angle(&neck_servo, 90.0f);   /* 安全位 */
}

const wink_app_callbacks_t *wink_app_get_callbacks(void) {
    static const wink_app_callbacks_t cb = { app_init, app_loop, app_on_fault };
    return &cb;
}

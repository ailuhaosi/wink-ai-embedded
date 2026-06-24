/**
 * @file js_sim_host_stub.h
 * @brief 仿真分支（-DSIMULATION=1）host 测试用 js_sim_* 桩。
 *        签名抄 wasm_bridge.h / Device Registry。
 */
#ifndef JS_SIM_HOST_STUB_H
#define JS_SIM_HOST_STUB_H

#include <stdint.h>

/* 设定下一次 js_sim_measure_echo_pulse_us 返回的脉宽 (us) */
void sim_set_echo_pulse_us(uint32_t pulse_us);

#endif /* JS_SIM_HOST_STUB_H */

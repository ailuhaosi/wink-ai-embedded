# Plan 3 — targets 拆分（wasm 拆 4 块 + host 升一等 target）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `targets/wasm/pal_hal_wasm.c`（HAL+OSAL+bridge extern+entry 五合一）拆解为 4 个单一职责文件，并集中 `wasm_bridge.h` 作为 `js_pal_*`+`js_sim_*` 的 SSOT；把 host 升格为一等 target（`targets/host/`），吸收旧 host 桩，使 host 能跑**完整** PAL→DAL→runtime→App 链路（不再只测 DAL 单元）。esp32 立骨架（不实现）。

**Architecture:** 落地 03-directory-architecture.md §4 targets 层 + §9 迁移项 2/3。wasm 拆分让 `wasm_bridge.h` 成为 JS 导入契约的唯一来源（修 ADR-0003 警告的 `js_sim_*` 多处漂移温床）。host 一等化后，测试改链 `targets/host` OBJECT 库，DAL 全测试在 host 上跑通（含 ultrasonic 真机分支协作式时间），为 Plan 4 的 bypass 收窄提供验证底座。

**Tech Stack:** C99 · CMake ≥3.15 · Unity · host gcc（wasm 仅保证 host 侧可编译性，完整 emcc 链接属 ADR-0002 spike）。

## Global Constraints

- 见系列 [00-README.md 全局约束](./00-README.md)。
- **不改 DAL 实现**（DAL 签名/bypass 由 Plan 4 处理）；本计划只重组 targets，保证 DAL 全测试在 host 仍绿。
- **不改顶层 wasm 可执行产物的对外契约**（`EXPORTED_FUNCTIONS=['_main','_trigger_wasm_interrupt']`、`MODULARIZE`、`EXPORT_NAME` 保持不变；`ASYNCIFY_IMPORTS` 本计划不碰——移交 ADR-0002 spike，与 ADR-0003 计划 Out-of-Scope ③ 一致）。
- **依赖前置**：Plan 1（pal INTERFACE）。Plan 2 非硬依赖（本计划不接 runtime），但 host 一等化与 Plan 2 协同（Plan 2 的 `pal_host_min_stub.c` 在本计划后被 `targets/host` 取代）。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `wink-micro-os/targets/wasm/wasm_bridge.h` | Create | ★SSOT：所有 `js_pal_*` + `js_sim_*` extern 声明集中 |
| `wink-micro-os/targets/wasm/pal_hal_wasm.c` | Modify | 瘦身为仅 HAL（gpio/pwm/i2c/interrupt），include wasm_bridge.h |
| `wink-micro-os/targets/wasm/pal_osal_wasm.c` | Create | OSAL（delay/tick/mutex）从旧文件拆出 |
| `wink-micro-os/targets/wasm/wasm_entry.c` | Create | `main()` + `trigger_wasm_interrupt` 从旧文件拆出 |
| `wink-micro-os/targets/wasm/CMakeLists.txt` | Create | wasm port 构建配置 |
| `wink-micro-os/targets/host/pal_hal_host.c` | Create | host HAL（协作式虚拟时间 + pwm 记录） |
| `wink-micro-os/targets/host/pal_osal_host.c` | Create | host OSAL（虚拟时钟推进） |
| `wink-micro-os/targets/host/CMakeLists.txt` | Create | host port OBJECT/STATIC 库 |
| `wink-micro-os/targets/esp32/` | Create (skeleton) | `pal_hal_esp32.c`/`pal_osal_esp32.c`/`esp32_entry.c` 骨架（空实现 + TODO 注释，不参与 host 构建） |
| `wink-micro-os/test/pal_host_min_stub.c` | Delete | 被 `targets/host` 取代（Plan 2 引入的临时桩） |
| `wink-micro-os/test/test_host_pal.c` | Create | host target 的 HAL/OSAL 行为测试（协作式时间 + pwm 记录） |
| `wink-micro-os/test/CMakeLists.txt` | Modify | DAL/host 测试改链 `targets/host` OBJECT 库 |
| `wink-micro-os/CMakeLists.txt` | Modify | wasm 可执行改用 4 文件；host 子目录挂载 |

> **注**：`test/stubs/host_test_ctrl.{c,h}`（注入控制 API `sim_set_echo_timing`/`sim_last_pwm_duty`）本计划在 `test/` 下创建（DAL 测试需要），Plan 4 会把它迁到 `test/stubs/`。本计划先放 `test/host_test_ctrl.{c,h}`。

---

## Task 1: `targets/wasm/wasm_bridge.h` —— JS 导入契约 SSOT

**Files:**
- Create: `wink-micro-os/targets/wasm/wasm_bridge.h`

**Interfaces:**
- Produces: 唯一声明所有 `js_pal_*`（PAL 侧）+ `js_sim_*`（DAL bypass 侧）extern 的头。后续 `pal_hal_wasm.c`/`pal_osal_wasm.c`/`dal_ultrasonic.c`(Plan 4) 都 include 本头，杜绝多处 `extern` 漂移。
- **范围说明**：本计划只登记**现存**的 `js_pal_*`（来自旧 pal_hal_wasm.c）。`js_sim_*`（bypass 契约）由 Plan 4 加入本头（SSOT 先行）；本计划留好结构，Plan 4 Step 1 填充。

- [ ] **Step 1: 写 `targets/wasm/wasm_bridge.h`**

```c
/**
 * @file wasm_bridge.h
 * @brief Wasm-JS 桥接契约 SSOT。
 *
 * 所有 wasm 仿真侧对 JS 的导入（js_pal_* / js_sim_*）extern 声明集中在此，
 * 杜绝散落在 pal_hal_wasm.c / pal_osal_wasm.c / dal_*.c 多处的漂移
 * （03-directory-architecture.md §9 迁移项3 / ADR-0003 SSOT 闭环）。
 *
 * 约定：js_sim_*（DAL bypass）契约以 Device Registry 为 SSOT，本头抄 Registry。
 *       Plan 4 会在此追加 js_sim_trigger_ultrasonic / js_sim_measure_echo_pulse_us。
 */
#ifndef WASM_BRIDGE_H
#define WASM_BRIDGE_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ---- PAL HAL 侧 JS 导入（来自旧 pal_hal_wasm.c）---- */
extern void js_pal_gpio_write(uint16_t pin, bool level);
extern bool js_pal_gpio_read(uint16_t pin);
extern void js_pal_pwm_set_duty(uint8_t channel, float duty_cycle_percent);
extern bool js_pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                                const uint8_t *write_buf, uint32_t write_len,
                                uint8_t *read_buf, uint32_t read_len);
extern void js_pal_register_interrupt(uint16_t pin, uint32_t callback_index, void *arg);
extern void js_pal_deregister_interrupt(uint16_t pin);

/* ---- PAL OSAL 侧 JS 导入 ---- */
extern void js_pal_delay_ms(uint32_t ms);
extern void js_pal_delay_us(uint32_t us);
extern uint64_t js_pal_get_ms(void);
extern uint64_t js_pal_get_us(void);

/* ---- DAL bypass 侧 JS 导入（js_sim_*）—— Plan 4 填充 ---- */

#ifdef __cplusplus
}
#endif

#endif /* WASM_BRIDGE_H */
```

- [ ] **Step 2: Commit**

```bash
git add wink-micro-os/targets/wasm/wasm_bridge.h
git commit -m "Add wasm_bridge.h as SSOT for JS import contracts (A* §9 item3)"
```

---

## Task 2: 拆分 `pal_hal_wasm.c` → HAL / OSAL / entry 三文件

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_hal_wasm.c`（瘦身为仅 HAL）
- Create: `wink-micro-os/targets/wasm/pal_osal_wasm.c`
- Create: `wink-micro-os/targets/wasm/wasm_entry.c`

**Interfaces:**
- Consumes: Task 1 `wasm_bridge.h`、Plan 1 `pal_hal.h`/`pal_osal.h`。
- Produces: 三个单一职责文件，行为与旧单文件**逐字节等价**（拆分不改逻辑，只搬家 + include wasm_bridge.h）。

> **验证策略**：wasm 端完整 emcc 链接依赖 JS 侧实现 + ADR-0002 spike（见 Global Constraints）。本计划以"host 侧 gcc 对 4 文件各做语法/编译可达性检查 + 人工 diff 等价性确认"为判据，不以完整 wasm 链接为判据。

- [ ] **Step 1: 全文重写 `pal_hal_wasm.c`（仅 HAL + 中断）**

```c
/**
 * @file pal_hal_wasm.c
 * @brief Wasm 仿真端 PAL HAL 适配（GPIO/PWM/I2C/中断）。
 *        仅 HAL；OSAL 见 pal_osal_wasm.c；entry 见 wasm_entry.c；JS 契约见 wasm_bridge.h。
 */
#include "pal_hal.h"
#include "wasm_bridge.h"

bool pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) {
    (void)pin; (void)mode;            /* 仿真下无需硬件配置 */
    return true;
}

void pal_gpio_write(uint16_t pin, bool level) {
    js_pal_gpio_write(pin, level);
}

bool pal_gpio_read(uint16_t pin) {
    return js_pal_gpio_read(pin);
}

bool pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t intr_type, pal_gpio_isr_t callback, void *arg) {
    (void)intr_type;
    uint32_t callback_index = (uint32_t)(uintptr_t)callback;   /* C 函数指针转 Table 索引 */
    js_pal_register_interrupt(pin, callback_index, arg);
    return true;
}

bool pal_gpio_disable_interrupt(uint16_t pin) {
    js_pal_deregister_interrupt(pin);
    return true;
}

bool pal_pwm_init(uint8_t channel, uint32_t frequency_hz) {
    (void)channel; (void)frequency_hz;
    return true;
}

bool pal_pwm_set_duty(uint8_t channel, float duty_cycle_percent) {
    js_pal_pwm_set_duty(channel, duty_cycle_percent);
    return true;
}

bool pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                      const uint8_t *write_buf, uint32_t write_len,
                      uint8_t *read_buf, uint32_t read_len) {
    return js_pal_i2c_transfer(port, dev_addr, write_buf, write_len, read_buf, read_len);
}
```

- [ ] **Step 2: 写 `pal_osal_wasm.c`（OSAL）**

```c
/**
 * @file pal_osal_wasm.c
 * @brief Wasm 仿真端 PAL OSAL 适配（delay/tick/mutex）。
 *        Asyncify 挂起在 js_pal_delay_ms；虚拟时钟为 ADR-0003 决策3 路标（暂用 JS 墙钟）。
 */
#include "pal_osal.h"
#include "wasm_bridge.h"

void pal_delay_ms(uint32_t ms) {
    js_pal_delay_ms(ms);            /* Asyncify 挂起，由 JS 唤醒 */
}

void pal_delay_us(uint32_t us) {
    js_pal_delay_us(us);
}

uint64_t pal_get_ms(void) { return js_pal_get_ms(); }
uint64_t pal_get_us(void) { return js_pal_get_us(); }

/* 单线程 Wasm Worker 沙箱通常无锁竞争，互斥锁退化为无竞争实现 */
pal_mutex_t pal_mutex_create(void) { return (pal_mutex_t)1; }
bool pal_mutex_lock(pal_mutex_t mutex, uint32_t timeout_ms) { (void)mutex; (void)timeout_ms; return true; }
bool pal_mutex_unlock(pal_mutex_t mutex) { (void)mutex; return true; }
void pal_mutex_destroy(pal_mutex_t mutex) { (void)mutex; }
```

- [ ] **Step 3: 写 `wasm_entry.c`（main + 中断桩）**

```c
/**
 * @file wasm_entry.c
 * @brief Wasm 入口：main() + trigger_wasm_interrupt。
 *        从旧 pal_hal_wasm.c 拆出；target entry 只负责启动 runtime（03-dir §7）。
 *        注：本计划 runtime 接线（wink_runtime_run）见 Plan 5；此处 main 先返回 0。
 */
#ifdef EMSCRIPTEN
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif
#include "pal_hal.h"

/**
 * @brief JS 侧产生中断时回调执行 C 侧 ISR
 * @param callback_index 注册中断时 C 侧传给 JS 的函数指针索引
 * @param arg 中断上下文参数指针
 */
EMSCRIPTEN_KEEPALIVE
void trigger_wasm_interrupt(uint32_t callback_index, void *arg) {
    pal_gpio_isr_t isr = (pal_gpio_isr_t)(uintptr_t)callback_index;
    if (isr != NULL) {
        isr(arg);
    }
}

int main(void) {
    /* TODO(Plan 5): 实例化 wink_app_callbacks_t 并调用 wink_runtime_run(&cb, 0) */
    return 0;
}
```

> `main` 内的 `TODO(Plan 5)` 是**指向后续计划的明确标注**（非占位敷衍）：本计划聚焦 targets 拆分，runtime 接线属 Plan 5 集成，避免越界。

- [ ] **Step 4: 写 `targets/wasm/CMakeLists.txt`**

```cmake
# Wasm 仿真端口构建配置（仅在 EMSCRIPTEN 环境生效）。
# 调用方（顶层 CMake）决定是否链接成 wink_simulator 可执行，本文件只声明源与依赖。
set(WASM_PAL_SOURCES
    pal_hal_wasm.c
    pal_osal_wasm.c)

set(WASM_ENTRY_SOURCE wasm_entry.c)

# 提供给顶层引用（顶层负责 link 成 wink_simulator）。
# 不在此 add_library，避免在非 emcc 环境构建失败。
```

- [ ] **Step 5: 改顶层 CMake 的 wasm 可执行源（4 文件 → 拆分后的文件）**

Modify `wink-micro-os/CMakeLists.txt` 的 wasm 可执行段，把 `targets/wasm/pal_hal_wasm.c` 替换为三文件：

```cmake
if(TARGET_PLATFORM STREQUAL "wasm" AND EMSCRIPTEN)
    add_executable(wink_simulator
        targets/wasm/pal_hal_wasm.c
        targets/wasm/pal_osal_wasm.c
        targets/wasm/wasm_entry.c)
    target_link_libraries(wink_simulator PRIVATE pal dal)
    target_link_options(wink_simulator PRIVATE
        "-s" "ASYNCIFY=1"
        "-s" "ASYNCIFY_IMPORTS=['js_sim_get_ultrasonic_distance']"
        "-s" "EXPORTED_FUNCTIONS=['_main','_trigger_wasm_interrupt']"
        "-s" "EXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
        "-s" "MODULARIZE=1"
        "-s" "EXPORT_NAME='WasmSandbox'")
endif()
```

> `ASYNCIFY_IMPORTS` 保持旧值不动（Global Constraints：移交 ADR-0002 spike；Plan 4 改 DAL bypass 后残留值无害，与 ADR-0003 计划 Step 9 结论一致）。

- [ ] **Step 6: Commit**

```bash
git add wink-micro-os/targets/wasm wink-micro-os/CMakeLists.txt
git commit -m "Split pal_hal_wasm.c into HAL/OSAL/entry (A* §9 item3, behavior-equivalent)"
```

---

## Task 3: `targets/host/` —— host 升一等 target

**Files:**
- Create: `wink-micro-os/targets/host/pal_hal_host.c`
- Create: `wink-micro-os/targets/host/pal_osal_host.c`
- Create: `wink-micro-os/targets/host/CMakeLists.txt`
- Create: `wink-micro-os/test/host_test_ctrl.h`
- Create: `wink-micro-os/test/host_test_ctrl.c`
- Create: `wink-micro-os/test/test_host_pal.c`
- Delete: `wink-micro-os/test/pal_host_min_stub.c`
- Modify: `wink-micro-os/test/CMakeLists.txt`

**Interfaces:**
- Consumes: Plan 1 `pal_hal.h`/`pal_osal.h`。
- Produces: `targets/host` OBJECT 库（提供完整 PAL 符号：HAL 协作式虚拟时间 + pwm 记录，OSAL 虚拟时钟推进）；`host_test_ctrl` 注入控制 API（`sim_set_echo_pin`/`sim_set_echo_timing`/`sim_last_pwm_duty`/`sim_reset_time`）供 DAL/runtime 测试驱动 host 行为。
- **吸收来源**：行为迁移自 ADR-0003 计划 Task 2 的 `pal_host_stub.c`（协作式时间推进逻辑逐字保留）+ Plan 2 的 `pal_host_min_stub.c`（被取代删除）。

> **关键设计**：`targets/host` 提供真实 PAL 符号；`host_test_ctrl` 是测试**专用**的注入控制 API（非 PAL 契约），物理放 `test/`（测试工具，非内核）。二者协作：host 的 `pal_gpio_read` 读取 host_test_ctrl 注入的虚拟 echo 时序。

- [ ] **Step 1: 写测试注入控制头 `test/host_test_ctrl.h`**

```c
/**
 * @file host_test_ctrl.h
 * @brief host 测试专用注入控制 API（非 PAL 契约，仅测试用）。
 *        驱动 targets/host 的虚拟时间/echo/pwm 行为，供 DAL/runtime 端到端测。
 */
#ifndef HOST_TEST_CTRL_H
#define HOST_TEST_CTRL_H

#include <stdint.h>

void sim_reset_time(void);
void sim_set_echo_pin(uint16_t pin);
void sim_set_echo_timing(uint64_t rise_us, uint64_t high_duration_us);
float sim_last_pwm_duty(uint8_t channel);

#endif /* HOST_TEST_CTRL_H */
```

- [ ] **Step 2: 写 `targets/host/pal_hal_host.c`（HAL，协作式虚拟时间）**

```c
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

bool pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) { (void)pin; (void)mode; return true; }
void pal_gpio_write(uint16_t pin, bool level) { (void)pin; (void)level; }

bool pal_gpio_read(uint16_t pin) {
    if (pin != host_echo_pin()) return false;
    uint64_t t = host_sim_time_us();
    uint64_t rise = host_echo_rise_us();
    uint64_t high = host_echo_high_us();
    if (t < rise) {
        host_sim_advance_to(rise);
        return true;                          /* 推进到变高时刻，echo 为高 */
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
```

- [ ] **Step 3: 写 `targets/host/pal_osal_host.c`（OSAL + 虚拟时间状态机 + 注入控制实现）**

```c
/**
 * @file pal_osal_host.c
 * @brief host 一等 target 的 PAL OSAL 实现 + 虚拟时间状态机 + host_test_ctrl 实现。
 *        虚拟时间状态在此维护（HAL 经 extern 消费）。
 */
#include "pal_osal.h"
#include "host_test_ctrl.h"
#include <string.h>

static uint64_t s_time_us = 0;
static uint64_t s_echo_rise_us = 0;
static uint64_t s_echo_high_us = 0;
static uint16_t s_echo_pin = 0xFFFF;
static float s_pwm_duty[8];

/* ---- HAL 侧 extern 的访问器 ---- */
uint64_t host_sim_time_us(void) { return s_time_us; }
void host_sim_advance_to(uint64_t us) { if (us > s_time_us) s_time_us = us; }
uint64_t host_echo_rise_us(void) { return s_echo_rise_us; }
uint64_t host_echo_high_us(void) { return s_echo_high_us; }
uint16_t host_echo_pin(void) { return s_echo_pin; }
void host_record_pwm(uint8_t channel, float duty) {
    if (channel < 8) s_pwm_duty[channel] = duty;
}

/* ---- host_test_ctrl 实现 ---- */
void sim_reset_time(void) {
    s_time_us = 0; s_echo_rise_us = 0; s_echo_high_us = 0; s_echo_pin = 0xFFFF;
    memset(s_pwm_duty, 0, sizeof(s_pwm_duty));
}
void sim_set_echo_pin(uint16_t pin) { s_echo_pin = pin; }
void sim_set_echo_timing(uint64_t rise_us, uint64_t high_duration_us) {
    s_echo_rise_us = rise_us; s_echo_high_us = high_duration_us;
}
float sim_last_pwm_duty(uint8_t channel) {
    if (channel >= 8) return -1.0f;
    return s_pwm_duty[channel];
}

/* ---- PAL OSAL ---- */
void pal_delay_ms(uint32_t ms) { s_time_us += (uint64_t)ms * 1000u; }
void pal_delay_us(uint32_t us) { s_time_us += us; }
uint64_t pal_get_ms(void) { return s_time_us / 1000u; }
uint64_t pal_get_us(void) { return s_time_us; }

pal_mutex_t pal_mutex_create(void) { return (pal_mutex_t)1; }
bool pal_mutex_lock(pal_mutex_t m, uint32_t to) { (void)m; (void)to; return true; }
bool pal_mutex_unlock(pal_mutex_t m) { (void)m; return true; }
void pal_mutex_destroy(pal_mutex_t m) { (void)m; }
```

- [ ] **Step 4: 写 `targets/host/CMakeLists.txt`（OBJECT 库）**

```cmake
# host 一等 target（OBJECT 库）—— 提供完整 PAL 符号，供 test 与 host 样例链接。
add_library(pal_host OBJECT
    pal_hal_host.c
    pal_osal_host.c)

target_include_directories(pal_host PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../../test          # host_test_ctrl.h
    ${CMAKE_CURRENT_SOURCE_DIR}/../../pal/include)
```

> 注：host 的 HAL 经 `extern` 访问 OSAL 侧的访问器函数（同 OBJECT 库内符号），不需跨库链接。`host_test_ctrl.h` 在 `test/` 下，故 include `../../test`。

- [ ] **Step 5: 写 host target 行为测试 `test/test_host_pal.c`**

```c
#include "unity.h"
#include "pal_osal.h"
#include "host_test_ctrl.h"

void setUp(void) { sim_reset_time(); }
void tearDown(void) {}

void test_delay_advances_virtual_time(void) {
    pal_delay_ms(5);
    TEST_ASSERT_EQUAL_UINT64(5000u, pal_get_us());
    pal_delay_us(300);
    TEST_ASSERT_EQUAL_UINT64(5300u, pal_get_us());
}

void test_pwm_duty_recorded(void) {
    /* pal_pwm_set_duty 在 targets/host 提供；经声明直接调 */
    extern bool pal_pwm_set_duty(uint8_t channel, float duty);
    pal_pwm_set_duty(2, 7.5f);
    TEST_ASSERT_EQUAL_FLOAT(7.5f, sim_last_pwm_duty(2));
}

void test_echo_timing_stored(void) {
    sim_set_echo_pin(5);
    sim_set_echo_timing(100, 5882);
    /* 验证 host_echo_pin/rise/high 经 pal_gpio_read 协作推进（见 dal 测试，此处只验注入生效） */
    extern bool pal_gpio_read(uint16_t pin);
    TEST_ASSERT_TRUE(pal_gpio_read(5));   /* 首次读推进到 rise，返回高 */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_delay_advances_virtual_time);
    RUN_TEST(test_pwm_duty_recorded);
    RUN_TEST(test_echo_timing_stored);
    return UNITY_END();
}
```

- [ ] **Step 6: 改 `test/CMakeLists.txt` —— 引入 targets/host OBJECT 库，删 pal_host_min_stub**

在文件顶部变量区追加：

```cmake
set(HOST_PAL_OBJECT $<TARGET_OBJECTS:pal_host>)
```

新增一个链接 targets/host 的测试函数，并把 test_runtime 改链 host（取代 pal_host_min_stub）：

```cmake
# 链接 targets/host（完整 PAL）的测试
function(add_wink_host_test name src)
    add_executable(${name}
        ${src}
        ${UNITY_DIR}/unity.c
        ${HOST_PAL_OBJECT}
        ${ARGN})
    target_include_directories(${name} PRIVATE
        ${UNITY_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/../pal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../trace/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include)
    target_compile_options(${name} PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
    add_test(NAME ${name} COMMAND ${name})
endfunction()

add_wink_host_test(test_host_pal test_host_pal.c)
```

并把 Plan 2 引入的 `test_runtime` 注册从 `add_wink_test(... pal_host_min_stub.c)` 改为（用 targets/host 提供完整 PAL）：

```cmake
add_wink_host_test(test_runtime test_runtime.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/src/wink_runtime.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../trace/src/wink_trace.c)
```

删除 `test_runtime` 对 `pal_host_min_stub.c` 的引用，并 `git rm` 该文件：

```bash
git rm wink-micro-os/test/pal_host_min_stub.c
```

- [ ] **Step 7: 挂载 host 子目录到顶层 CMake**

Modify `wink-micro-os/CMakeLists.txt`，在 host test 段（`if(NOT TARGET_PLATFORM STREQUAL "wasm")`）内、`add_subdirectory(test)` **前**加：

```cmake
if(NOT TARGET_PLATFORM STREQUAL "wasm")
    enable_testing()
    add_subdirectory(targets/host)      # host 一等 target，供 test 链接
    add_subdirectory(test)
endif()
```

- [ ] **Step 8: 运行测试，确认 host target + trace + runtime 全绿**

Run:
```bash
cmake -B build-test -DTARGET_PLATFORM=host
cmake --build build-test
cd build-test && ctest --output-on-failure
```
Expected: 全 PASS（test_smoke + test_trace + test_runtime + test_host_pal）。

- [ ] **Step 9: Commit**

```bash
git add wink-micro-os/targets/host wink-micro-os/test/host_test_ctrl.h wink-micro-os/test/host_test_ctrl.c wink-micro-os/test/test_host_pal.c wink-micro-os/test/CMakeLists.txt wink-micro-os/CMakeLists.txt
git commit -m "Promote host to first-class target (absorb stubs, full PAL on host)"
```

---

## Task 4: `targets/esp32/` 骨架（不实现）

**Files:**
- Create: `wink-micro-os/targets/esp32/pal_hal_esp32.c`
- Create: `wink-micro-os/targets/esp32/pal_osal_esp32.c`
- Create: `wink-micro-os/targets/esp32/esp32_entry.c`
- Create: `wink-micro-os/targets/esp32/CMakeLists.txt`

**Interfaces:** 无（骨架占位，不参与 host 构建；待 ESP-IDF 移植填充，属 ADR-0002 spike 后续）。

- [ ] **Step 1: 写三骨架文件（统一空实现 + 路标注释）**

`pal_hal_esp32.c`:
```c
/**
 * @file pal_hal_esp32.c
 * @brief ESP32 真机 PAL HAL 骨架。
 * @status ROADMAP —— 待 ESP-IDF 移植填充（ADR-0002 spike 完成后）。
 *      本文件不参与 host 构建；仅保证目录结构与签名占位。
 */
#include "pal_hal.h"

bool pal_gpio_init(uint16_t pin, pal_gpio_mode_t mode) { (void)pin; (void)mode; return false; }
void pal_gpio_write(uint16_t pin, bool level) { (void)pin; (void)level; }
bool pal_gpio_read(uint16_t pin) { (void)pin; return false; }
bool pal_gpio_enable_interrupt(uint16_t pin, pal_gpio_intr_t t, pal_gpio_isr_t cb, void *a) {
    (void)pin; (void)t; (void)cb; (void)a; return false;
}
bool pal_gpio_disable_interrupt(uint16_t pin) { (void)pin; return false; }
bool pal_pwm_init(uint8_t ch, uint32_t f) { (void)ch; (void)f; return false; }
bool pal_pwm_set_duty(uint8_t ch, float d) { (void)ch; (void)d; return false; }
bool pal_i2c_transfer(uint8_t p, uint16_t a, const uint8_t *w, uint32_t wl, uint8_t *r, uint32_t rl) {
    (void)p; (void)a; (void)w; (void)wl; (void)r; (void)rl; return false;
}
```

`pal_osal_esp32.c`:
```c
/**
 * @file pal_osal_esp32.c
 * @brief ESP32 真机 PAL OSAL 骨架（vTaskDelay / esp_timer / FreeRTOS mutex）。
 * @status ROADMAP —— 待 ESP-IDF 移植填充。
 */
#include "pal_osal.h"

void pal_delay_ms(uint32_t ms) { (void)ms; }
void pal_delay_us(uint32_t us) { (void)us; }
uint64_t pal_get_ms(void) { return 0; }
uint64_t pal_get_us(void) { return 0; }
pal_mutex_t pal_mutex_create(void) { return (pal_mutex_t)0; }
bool pal_mutex_lock(pal_mutex_t m, uint32_t to) { (void)m; (void)to; return false; }
bool pal_mutex_unlock(pal_mutex_t m) { (void)m; return false; }
void pal_mutex_destroy(pal_mutex_t m) { (void)m; }
```

`esp32_entry.c`:
```c
/**
 * @file esp32_entry.c
 * @brief ESP32 真机入口（app_main）。
 * @status ROADMAP —— 待移植：实例化 wink_app_callbacks_t → wink_runtime_run(&cb, 0)。
 */
/* ESP-IDF 提供 app_main；骨架期留空，移植时填充。 */
```

- [ ] **Step 2: 写 `targets/esp32/CMakeLists.txt`（仅 ESP-IDF 环境启用）**

```cmake
# ESP32 真机端口（仅在 ESP-IDF 环境作为 component 参与构建）。
# host/wasm 构建不包含本目录。
if(TARGET_PLATFORM STREQUAL "esp32")
    # ESP-IDF 组件化时由顶层 idf.py 接管；此处仅声明源占位。
    message(STATUS "esp32 target skeleton active (ESP-IDF integration pending)")
endif()
```

- [ ] **Step 3: Commit**

```bash
git add wink-micro-os/targets/esp32
git commit -m "Add esp32 target skeleton (roadmap, ESP-IDF integration pending)"
```

---

## Self-Review

**1. Spec coverage（对照 03-directory-architecture.md）**：
- §4 targets/wasm 4 文件 + wasm_bridge.h SSOT → Task 1/2 ✅
- §4 targets/host 一等化（吸收 host stub）→ Task 3 ✅
- §4 targets/esp32 骨架 → Task 4 ✅
- §9 迁移项2（host stub 迁 targets/host）→ Task 3 ✅
- §9 迁移项3（wasm 拆 4 块 + JS SSOT）→ Task 1/2 ✅
- §6.1 约束4 平台配置隐藏 → esp32_entry.c 承载 entry 配置（骨架已立）✅

**2. Placeholder scan**：
- `wasm_entry.c::main` 的 `TODO(Plan 5)` 是**指向后续计划的明确标注**，非敷衍占位——已注明为何留到 Plan 5（runtime 接线属集成阶段）✅
- `targets/esp32/*` 的 `@status ROADMAP` 注释 + 空实现是**有意的骨架占位**，目录架构（§8 roadmap）已声明 esp32 先立骨架，符合设计 ✅
- 无其他 TBD/TODO 残留 ✅

**3. Type/signature consistency**：
- `js_pal_*` 7 个 extern 在 wasm_bridge.h（Task1）、pal_hal_wasm.c/pal_osal_wasm.c（Task2）调用一致 ✅
- host HAL↔OSAL 跨文件 extern 访问器（`host_sim_time_us` 等 6 个）签名在 pal_hal_host.c(extern) 与 pal_osal_host.c(定义) 一致 ✅
- `sim_*` 4 个 API 在 host_test_ctrl.h 声明、pal_osal_host.c 实现、test_host_pal.c 调用一致 ✅
- `pal_*` 签名与 pal_hal.h/pal_osal.h（Plan1 未改）逐字一致 ✅

**4. 已知风险**：
- wasm 完整 emcc 链接未验证（依赖 JS 实现 + ADR-0002 spike，Global Constraints 已声明）。host 侧对 4 文件可达性 + 行为等价性（人工 diff）为判据。
- host HAL 经 `extern` 访问 OSAL 访问器——同一 OBJECT 库内符号，链接无碍；但若未来 host 拆多文件需保持访问器在同一翻译单元集合。缓解：注释已标注耦合点。
- `host_test_ctrl.h` 物理在 `test/`，`targets/host` 反向 include `../../test`——略有反向依赖（target 依赖 test 工具）。Plan 4 会把 `host_test_ctrl` 迁到 `test/stubs/` 并复核此 include 路径是否需调整；本计划保持可用。

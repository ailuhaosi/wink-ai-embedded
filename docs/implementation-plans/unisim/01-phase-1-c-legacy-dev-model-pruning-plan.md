# 阶段一计划：C 侧 Deprecated 物理器件模型剥离与边沿同源收敛

| 项 | Content |
|---|---|
| **计划名称** | Phase 1: C Legacy Physical Model Pruning & Edge Injection Alignment |
| **所属总纲** | [`00-master-execution-plan.md`](./00-master-execution-plan.md) |
| **状态** | **Completed** |
| **核心目标** | 清理 C 侧 `wasm_dev_ultrasonic.c` 等 Legacy 物理捷径，实现前端 `UltrasonicPlugin` 脉冲边沿注入与 C 侧同源 `pulse_in` 测量 |

---

## 1. 问题背景与收敛必要性

在 early MVP 阶段，`wink-micro-os/targets/wasm/devices/wasm_dev_ultrasonic.c` 维护了 `s_virtual_ultrasonic_distance` 全局数组，前端直接调用 `pal_wasm_set_ultrasonic_distance` 写入厘米数，C 侧在底层做 `cm -> us` 简化的数学换算。

这造成了两个严重问题：
1. **双重物理状态源**：TS 插件与 C 侧各自存了一份 `distanceCm`。
2. **破坏测量路径同源性**：真实 ESP32 硬件走的是高电平脉宽捕获（`pulse_in` / RMT 边沿），而 WASM 走 C 侧数学乘法，绕过了协议换算、超时机制与状态机测试。

---

## 2. 详细改动方案

### 2.1 C 侧（wink-micro-os）

1. **[MODIFY] [pal_hal_wasm.c](file:///d:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai-embedded/wink-micro-os/targets/wasm/pal_hal_wasm.c)**:
   - 强化 `pal_gpio_pulse_in` 消费 `s_pin_events` 边沿队列的稳定性，支持自动推进虚拟时间 `pal_wasm_advance_virtual_clock(t_end - current_time)` 与超时推进。
   - 保证在 `timing` 精度模式下，`pal_wasm_push_pin_event(pin, delay_us, level)` 能够无损地将 ECHO 引脚的高低电平跳变推入队列。
2. **[MODIFY] [wasm_dev_ultrasonic.c](file:///d:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai-embedded/wink-micro-os/targets/wasm/devices/wasm_dev_ultrasonic.c)**:
   - 标注 `pal_wasm_set_ultrasonic_distance` / `pal_wasm_get_ultrasonic_distance` 为 **Deprecated** 捷径 API，仅保留 fallback 兼容逻辑。
   - 删除任何试图在 C 侧重写 `pulse_in` 测量逻辑的代码。

### 2.2 TypeScript 侧（@wink-ai/unisim）

1. **[MODIFY] [ultrasonic-hc-sr04.ts](file:///D:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai/packages/unisim/src/unisim/plugin/builtins/ultrasonic-hc-sr04.ts)**:
   - 当收到 TRIG 引脚变高电平信号 (`onPinChange`) 时：
     - 计算声波往返延迟：`pulseDurationUs = Math.round(distanceCm / 0.017)`
     - 注入高电平开始边沿：`ctx.pushPinEvent(echoPin, 10 /* us */, 1)`
     - 注入低电平结束边沿：`ctx.pushPinEvent(echoPin, 10 + pulseDurationUs, 0)`

---

## 3. 任务列表 (Tasks)

- [x] **Task 1.1**: 在 TS 侧 `UltrasonicPlugin` 实现 TRIG 触发 $\rightarrow$ ECHO 边沿事件队列注入机制。
- [x] **Task 1.2**: 在 C 侧 `pal_hal_wasm.c` 验证 `pal_gpio_pulse_in` 处理 ECHO 脉冲的准确度，确保测量误差 $\le 0.1 \text{ cm}$。
- [x] **Task 1.3**: 标记 `wasm_dev_ultrasonic.c` 为 Deprecated 并添加 `@deprecated` Doxygen 标记。
- [x] **Task 1.4**: 运行避障小车 `avoidance_car` E2E 仿真测试，验证注入障碍物距离后舵机偏转逻辑符合预期。
- [x] **Task 1.5** *(P1 追加)*: **明确 `pulse_in` 超时边界行为**。
  - 在 `pal_hal_wasm.c` 的 `pal_gpio_pulse_in(pin, level, timeout_us)` 中实现无边沿事件时，自动将虚拟时钟推进 `timeout_us` 并返回 `WINK_ERR_TIMEOUT`。

---

## 4. 验证计划 (Verification)

### 自动化单元测试
- **C Unity 测试**：运行 `test_dal_ultrasonic_sim.c`，确保 `dal_ultrasonic_read()` 通过 `pal_gpio_pulse_in` 正常返回厘米数。
  - 追加**超时负向用例**：不注入任何 ECHO 边沿，断言 `dal_ultrasonic_read()` 返回 `0` 且虚拟时钟精确前进 `38000 μs`。
- **TS Bun 测试**：运行 `bun test` 中的 `UltrasonicPlugin.test.ts`。

### 手动 E2E 验证
- 在 Web 前端启动避障小车 Demo，拖动超声波 Slider 调节距离，观察 Workbench 控制台与 Canvas 画面中避障小车的转向反应。

# 阶段三计划：通道 3 Analog ADC 与拓扑扩展器件仿真协同落地

| 项 | Content |
|---|---|
| **计划名称** | Phase 3: Channel 3 Analog ADC & Infrastructure Topology Devices Plan |
| **所属总纲** | [`00-master-execution-plan.md`](./00-master-execution-plan.md) |
| **对齐提案** | [`06-c-target-architecture-and-refactoring-proposal.md`](./06-c-target-architecture-and-refactoring-proposal.md) (v2.0) |
| **状态** | **Draft (Aligned with v2.0 Architecture)** |
| **核心目标** | 落地 ADR-0057 规范，实现通道 3 归一化模拟量 `[0,1]` 注入与 C 侧物理退化，切出 `pal_wasm_ch2b_pwm.c` 并重命名 `pal_wasm_ch3_adc.c` |

---

## 1. 背景与架构契约 (ADR-0057 对齐)

ADR-0057 明确规定了通道 3 (Analog ADC) 的物理旁路契约：
1. **TS 侧 PinArbiter 为模拟电气 SSOT**：JS 侧只维护 `[0,1]` 归一化电平 (`readAnalog(pin)`)，不知道滿量程与 mV 换算。
2. **C 侧 `pal_wasm_ch3_adc.c` 做物理换算与退化**：通过导入 `js_pal_adc_read_norm(pin)` 获取 `[0,1]` 基础值，然后在 C 侧完成 `raw` / `mv` 换算，并叠加 RC 低通滤波（`wink_phys_rc_lowpass`）、高斯噪声与预热判定。
3. **拓扑扩展器件 (Infrastructure Devices)**：如 PCF8574 (I2C 到 8 位 GPIO 扩展)，属于物理总线到逻辑 GPIO 的转换桥，必须在 TS 插件层正确解算拓扑。

---

## 2. 详细改动方案

### 2.1 C 侧（wink-micro-os）

1. **[RENAME/MODIFY] [pal_wasm_ch3_adc.c](../../../../../wink-micro-os/targets/wasm/pal_wasm_ch3_adc.c)** *(遵从 06 v2.0 架构规范，由原 pal_wasm_adc.c 重命名)*:
   - 实现标准的 `pal_adc_read_raw(channel)` 和 `pal_adc_read_mv(channel)` 接口。
   - 调用 `js_pal_adc_read_norm((uint16_t)pin)` 读取 TS 侧理想归一化电平，并按通道独立 PRNG 种子叠加噪声。
2. **[NEW] [pal_wasm_ch2b_pwm.c](file:///d:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai-embedded/wink-micro-os/targets/wasm/pal_wasm_ch2b_pwm.c)** *(遵从 06 v2.0 平摊重构规范)*:
   - 从 `pal_hal_wasm.c` 搬迁 PWM 驱动与观测段。
   - 统一接管 `pal_wasm_get_pwm_duty_percent` 符号，解决 `wasm_dev_servo.c` 中的符号冲突风险（N1 消除）。
3. **[NEW] [test_dal_analog_knob_sim.c](../../../../../wink-micro-os/test/unit/dal/test_dal_analog_knob_sim.c)**:
   - 新增 `analog_knob` / `analog_sensor` DAL 驱动在 WASM 仿真环境下的自动化测试，验证从 `norm -> raw -> mv -> 物理业务量` 的正确性。

#### 2.1.1 测试构建同步（G2 — 防止测试先于产品断裂）

核实 `test/CMakeLists.txt:292-295` 有独立的显式源文件清单（直接编译 `devices/wasm_sim_registry.c` / `wasm_dev_servo.c` / `wasm_dev_ultrasonic.c`），且 `test/wasm/run_gpio_semantics_emcc.ps1:30` 硬编码 `wasm_dev_servo.c` 路径。Phase 3 收敛 PWM 符号后必须同步：

- `test/CMakeLists.txt` 中 `test_wasm_devices_sim` 的源文件列表：随 PWM 迁入 `pal_wasm_ch2b_pwm.c` 更新；该测试（`test/unit/sim/test_wasm_devices_sim.c:44-50` 通过 servo 测 `pal_wasm_get_pwm_duty_percent`）改为对 `ch2b_pwm.c` 验证。
- `test/wasm/run_gpio_semantics_emcc.ps1:30` 的硬编码路径同步更新。
- 确认 `WINK_USE_RC_SERVO` 关闭与开启两种配置下均无 `pal_wasm_get_pwm_duty_percent` duplicate symbol（原定义在 `wasm_dev_servo.c:27`）。

> **提交纪律（G5）**：先提交"PWM 段从 `pal_hal_wasm.c` 剪切到 `ch2b_pwm.c`"的纯搬迁 commit（搬迁即全量测试绿），再提交 servo 符号收敛 / ADC 退化增强等功能 commit。

### 2.2 TypeScript 侧（@wink-ai/unisim）

1. **[MODIFY] [pin-arbiter.ts](file:///D:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai/packages/unisim/src/unisim/core/pin-arbiter.ts)**:
   - 健全 `setAnalogDriver(pin, driver)` 与 `readAnalog(pin)`，实现高侧 Wire-OR 理想逼近算法（最高强度优先，同强度取最大值）。
2. **[NEW] [pcf8574.ts](file:///D:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai/packages/unisim/src/unisim/plugin/builtins/pcf8574.ts)**:
   - 实现 PCF8574 I2C IO 扩展芯片插件，监听 `I2CBus` 读写命令，并将 8 个虚拟 P0-P7 引脚的驱动状态更新至 `PinArbiter`。

---

## 3. 任务列表 (Tasks)

> **G4 串行化**：本阶段抽 PWM 段会编辑 `pal_hal_wasm.c`，必须**先于 Phase 4** 合入 main；Phase 4 GPIO 抽离需 rebase 到本阶段之后。两阶段不得并行（见总纲 §2）。

- [ ] **Task 3.1**: 从 `pal_hal_wasm.c` 搬迁 PWM 段至新建的 `pal_wasm_ch2b_pwm.c`，统一收纳 `pal_wasm_get_pwm_duty_percent` 符号。
- [ ] **Task 3.1a (G2)**: 同步更新 `test/CMakeLists.txt`（`test_wasm_devices_sim` 源清单）与 `test/wasm/run_gpio_semantics_emcc.ps1:30` 硬编码路径；将 PWM duty 测试迁移到对 `ch2b_pwm.c`，验证两种 `WINK_USE_RC_SERVO` 配置下无 duplicate symbol。
- [ ] **Task 3.2**: 将 `pal_wasm_adc.c` 重命名为 `pal_wasm_ch3_adc.c`，完善 `pal_adc_read_raw` 与 `pal_adc_read_mv` 的 RC 滤波与物理退化引擎集成。
- [ ] **Task 3.3**: 完善 TS 侧 `PinArbiter.ts` 模拟量仲裁与 `NaN` clamp 机制。
- [ ] **Task 3.4**: 编写内置外设 `potentiometer.ts` (电位器) 与 `pcf8574.ts` (IO扩展器) 插件。
- [ ] **Task 3.5**: 提升通道 3 选型表成熟度至 `Landed`。
- [ ] **Task 3.6** *(P1 追加)*: **设计 `I2CBus` 地址路由表与 TCA9548A 通道选通状态机**。
  - 在 `I2CBus.ts` 中维护 `Map<address, I2CDevice>` 路由表，插件注册时报告地址冲突（`SimDiagnosticError`）。
  - `TCA9548APlugin` 内部维护 8 个下游虚拟总线的启用位图，写操作更新选通状态，此后的 I2C 事务路由至已选通下游总线。
  - 新增集成测试：两个 PCF8574 不同 I2C 地址下独立读写互不干扰。
- [ ] **Task 3.7** *(P2 追加)*: **在 `wink-app.json` 中引入 `fidelityLevel` 仿真精度等级配置**。
  - 支持三档：`"ideal"` （无退化）、`"nominal"` （RC 滤波+±1 LSB 噪声）、`"noisy"` （全退化+预热延迟）。
  - C 侧通过 `pal_wasm_set_fidelity_level(uint8_t level)` ABI 在初始化时由 JS 侧注入。
  - 退化引擎函数 `wink_phys_add_noise` 内部根据 `s_fidelity_level` 动态开关。
  - **(G9) ABI 三件套**：该导出在 `wasm_bridge.h`（AXES A+F 区）已被注释引用（bridge.h:273）但尚未声明——本任务须补 `extern` 声明 → bump `PAL_WASM_ABI_HASH` → 更新 TS `types/wasm/exports.ts`，由 `ssotAlignment.test.ts` 守门。C 实现归入 `pal_wasm_degradation.c`（Axis F）。

---

## 4. 验证计划 (Verification)

### 自动化单元测试
- **C 侧单测**：运行 `test_dal_analog_knob_sim.c`，断言旋转电位器注入 `0.5` 归一化值时，C 侧能够读出大约 `1650 mV`（3.3V 满量程下）。
- **PWM 抽离单测**：运行 `test_dal_pwm_sim.c`，断言 PWM 设置与 duty 查询在 `pal_wasm_ch2b_pwm.c` 搬迁后功能无损。
- **TS 侧单测**：运行 `PinArbiter.analog.test.ts` 验证多源驱动时的 Wire-OR 仲裁结果。
- **I2C 地址隔离集成测试**：运行 `I2CBus.routing.test.ts`，验证两个 PCF8574 分别占用 `0x20` 和 `0x21` 地址时独立读写互不干扰。

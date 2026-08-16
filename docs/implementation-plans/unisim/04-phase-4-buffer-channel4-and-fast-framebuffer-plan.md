# 阶段四计划：通道 4 Buffer Payload 帧缓冲与高频/媒体器件通道落地

| 项 | Content |
|---|---|
| **计划名称** | Phase 4: Channel 4 Buffer Payload & High-Frequency Media Devices Plan |
| **所属总纲** | [`00-master-execution-plan.md`](./00-master-execution-plan.md) |
| **对齐提案** | [`06-c-target-architecture-and-refactoring-proposal.md`](./06-c-target-architecture-and-refactoring-proposal.md) (v2.0) |
| **状态** | **Draft (Aligned with v2.0 Architecture)** |
| **核心目标** | 落地通道 4 (Buffer Payload) 帧缓冲机制，支撑 WS2812 炫彩灯条与摄像头等海量数据块零拷贝传输，切出 `pal_wasm_ch1_gpio.c` 与 `pal_wasm_ch4_buffer.c` |

---

## 1. 背景与技术挑战

像 WS2812 这种基于 0.4μs 单总线 NRZ 编码的高频 LED，或者摄像头捕获的 Raw RGB 帧，如果逐位/逐脚进行模拟，每秒将产生数百万次 JS↔Wasm 交叉，导致 CPU 爆满与帧率骤降。

因此，**通道 4 (Buffer Payload)** 采用“同源 App/DAL 填充 RGB 缓冲，PAL 层面直通 payload 字节数组”的策略，避免在底层仿真 NRZ 位时序。

```text
┌──────────────────────────┐                      ┌──────────────────────────┐
│  WASM 固件 (App/DAL)     │                      │      TS 侧 SimWorker     │
│                          │                      │                          │
│  dal_ws2812_show(buf)    │                      │  ws2812-led-strip.ts     │
│             │            │                      │             ▲            │
│             ▼            │                      │             │            │
│  pal_ws2812_write() ─────┼── js_pal_ws2812 ─────┼─────────────┘            │
│  (Heap Uint8Array 切片)  │   write_buffer       │   解析 RGB 帧并派发 UI   │
└──────────────────────────┘                      └──────────────────────────┘
```

---

## 2. 详细改动方案

### 2.1 C 侧（wink-micro-os）

1. **[NEW] [pal_wasm_ch1_gpio.c](../../../../../wink-micro-os/targets/wasm/pal_wasm_ch1_gpio.c)** *(遵从 06 v2.0 平摊重构规范)*:
   - 从 `pal_hal_wasm.c` 搬迁 GPIO 读写、电平驱动与 `s_pin_events[]` / `s_gpio_mode[]` / `pulse_in` 静态状态。
   - 从 `pal_wasm_physical.c` 迁入 `pal_wasm_gpio_read()` bool wrapper。
   - 从 `devices/wasm_sim_registry.c` 迁入 `pal_wasm_set_gpio_input` / `pal_wasm_get_gpio_output` 状态。
   - 包含 `pal_test_*` / `pal_rmt_*` Unsupported stubs。
2. **[NEW] [pal_wasm_ch4_buffer.c](../../../../../wink-micro-os/targets/wasm/pal_wasm_ch4_buffer.c)** *(遵从 06 v2.0 架构规范)*:
   - 实现通道 4 专职 C 文件及 `pal_ws2812_write(wink_pin_t pin, const uint8_t *rgb_buf, size_t num_leds)`。
   - 堆内分配帧缓冲区时必须检查 `malloc` 返回值，分配失败时调用 `pal_wasm_report_oom()` 并返回，不得直接 `abort`。
   - 直接通过 Emscripten 导出接口，传递 WASM 堆内存指针 `rgb_buf` 与字节长度到 JS 侧。
3. **[MODIFY] [wasm_bridge.h](../../../../../wink-micro-os/targets/wasm/wasm_bridge.h)**:
   - 新增通道 4 导出与导入签名：
     - `extern void js_pal_ws2812_write(uint16_t pin, const uint8_t *buf, uint32_t len);`
   - 在器函数注释中明确声明：**JS 侧实现者必须在函数返回前完成 `.slice()` 防御拷贝，严禁持有跨调用的 WASM 堆视图**。

#### 2.1.1 registry 退场与 reset 编排（G2 + G3 — 防止热重载与测试断链）

核实 `devices/wasm_sim_registry.c` 始终编译且持有一个 JS→C 的 `EMSCRIPTEN_KEEPALIVE` 导出 `pal_wasm_sim_reset_all_devices`（registry.c:44），TS 热重载路径会调用它；`test/wasm/test_pal_gpio_read_wasm_semantics.c:141` 也直接调用内部 `wasm_sim_devices_reset()`。registry 在 Phase 4 随 GPIO 状态迁出而退场，必须：

1. **保留 ABI 不断链（G3）**：`pal_wasm_sim_reset_all_devices` 导出**不得删除或改名**。将其实现迁移到 `pal_wasm_degradation.c`（或 Phase 4 临时落点，Phase 5 再归位），内部改为调用各轴发布的 `pal_wasm_ch1_reset()` / `pal_wasm_ch2_reset()` 等 reset 钩子（R2 裁定），不再依赖 `devices/` 内部符号。TS 侧无需改动。
2. **测试构建同步（G2）**：`test/CMakeLists.txt:292-295` 仍显式编译 `wasm_sim_registry.c` / `wasm_dev_servo.c` / `wasm_dev_ultrasonic.c`。registry 退场时该清单必须同步移除/替换；`test_pal_gpio_read_wasm_semantics.c:141` 改为调用新的 reset 编排导出（而非 `wasm_sim_devices_reset` 内部函数）。
3. GPIO 状态数组、`pal_wasm_set_gpio_input`、`pal_wasm_get_gpio_output` 迁入 `ch1_gpio.c` 后，确认 registry 中再无其他被引用的 KEEPALIVE 导出，方可删除文件。

> **提交纪律（G5）**：先提交"GPIO 段从 `pal_hal_wasm.c` 剪切到 `ch1_gpio.c`"的纯搬迁 commit（搬迁即全量测试绿），再提交 WS2812 帧缓冲 / OOM / registry 退场等功能 commit。

### 2.2 TypeScript 侧（@wink-ai/unisim）

1. **[NEW] [ws2812-led-strip.ts](file:///D:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai/packages/unisim/src/unisim/plugin/builtins/ws2812-led-strip.ts)**:
   - 实现 WS2812 灯条插件，监听 `js_pal_ws2812_write` 调用的内存切片。
   - 读取 WASM Heap 的 `Uint8ClampedArray`，更新 `stateChannels.pixels` 并触发 UI 刷新。

---

## 3. 任务列表 (Tasks)

> **G4 串行化**：本阶段抽 GPIO 段会编辑 `pal_hal_wasm.c`，必须在 **Phase 3 合入 main 之后** rebase 再开工，不得与 Phase 3 并行（见总纲 §2）。

- [ ] **Task 4.0** *(P0 PRE-CONDITION — 必须首先完成)*: **帧缓冲内存安全、OOM 应对与 WASM 内存参数配置**。
  - 在 `wasm_bridge.h` 的 `js_pal_ws2812_write` 器函数注释中明确写明：JS 侧必须在函数返回前完成 `.slice()` 内存拷贝，严禁持有跨调用的 WASM 堆视图。
  - 在 Emscripten 编译参数中明确：`INITIAL_MEMORY=8MB`、`MAXIMUM_MEMORY=32MB`、`ALLOW_MEMORY_GROWTH=1`、`ABORTING_MALLOC=0`（分配失败返回 NULL 而非 abort）。
  - 实现 `pal_wasm_report_oom(const char *tag, size_t size)` ABI，内存不足时向 JS 侧报告 `SIM_OOM_EVENT` 代替崩溃。
  - **(G8) ABI 归属与三件套**：`pal_wasm_report_oom` 属 Axis F（Fault/Observation），C 实现归入 `pal_wasm_fault.c`（Phase 4 该文件已存在），不得散落在 `ch4_buffer.c`；在 `wasm_bridge.h` Axis F 区声明 → bump `PAL_WASM_ABI_HASH` → 更新 TS `types/wasm/exports.ts`，由 `ssotAlignment.test.ts` 守门。
- [ ] **Task 4.1**: 从 `pal_hal_wasm.c` 搬迁 GPIO 段与静态状态数组至新建的 `pal_wasm_ch1_gpio.c`。
- [ ] **Task 4.1a (G2/G3)**: 将 `pal_wasm_sim_reset_all_devices` 导出迁出 registry（保留 ABI 签名、TS 不改），改为 reset 钩子编排；同步更新 `test/CMakeLists.txt` 源清单与 `test_pal_gpio_read_wasm_semantics.c:141`；确认 registry 无其他被引用 KEEPALIVE 后删除 registry.c。
- [ ] **Task 4.2**: 在 `wasm_bridge.h` 与 `createUnisimImports.ts` 中注册 `js_pal_ws2812_write` 桥。
- [ ] **Task 4.3**: 在新建的 `pal_wasm_ch4_buffer.c` 中实现 `pal_ws2812_write` 堆指针传递。
- [ ] **Task 4.4**: 编写内置插件 `ws2812-led-strip.ts` 与对应的 UI Canvas 渲染组件。
- [ ] **Task 4.5**: 提升通道 4 选型表成熟度至 `Landed`。
- [ ] **Task 4.6** *(P1 追加)*: **在 `ws2812-led-strip.ts` 插件中实现双缓冲帧率节流（背压机制）**。
  - 删除每次 `js_pal_ws2812_write` 调用即派发 `postMessage` 的逻辑，改为仅更新内部 `_pendingFrame`（立即 `.slice()`）。
  - 使用 `_rafScheduled` 标志，确保单 tick 内多次写入只派发最后一帧（与真实 WS2812 Latch 语义一致）。
  - 在 `wink-app.json` 的外设配置中支持可选的 `maxFps` 字段限制最高帧率。

---

## 4. 验证计划 (Verification)

### 自动化单元测试
- **GPIO 搬迁单测**：运行 `test_dal_button_sim.c` 与 `test_dal_led_sim.c`，断言从 `pal_hal_wasm.c` 搬迁至 `pal_wasm_ch1_gpio.c` 后所有 GPIO 逻辑正常。
- **C 侧 WS2812 单测**：编写 `test_dal_ws2812_sim.c`，调用 `dal_ws2812_set_pixel()` 并 `show()`，验证 WASM PAL 接口被触发且参数校验无误。
- **TS 侧单测**：运行 `Ws2812Plugin.test.ts`，验证 RGB 颜色缓冲数组能够正确解析为 `[R, G, B, A]` 并触发 UI 帧发布。
  - 追加帧节流用例：单 tick 内连续调用 `js_pal_ws2812_write` 100 次，断言实际发出的 `postMessage` 次数为 1（只派发最后一帧）。

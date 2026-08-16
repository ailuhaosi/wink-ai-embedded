# 阶段二计划：通道 2 UART 异步 RX 与 IRQ 中断队列模型落地

| 项 | Content |
|---|---|
| **计划名称** | Phase 2: Channel 2 UART Async RX & Interrupt Queue Implementation |
| **所属总纲** | [`00-master-execution-plan.md`](./00-master-execution-plan.md) |
| **对齐提案** | [`06-c-target-architecture-and-refactoring-proposal.md`](./06-c-target-architecture-and-refactoring-proposal.md) (v2.0) |
| **状态** | **Draft (Aligned with v2.0 Architecture)** |
| **核心目标** | 落地 ADR-0054 规范，补充 WASM Target UART 异步接收字节流与 RX IRQ 中断触发机制，解耦切出 `pal_wasm_ch2_bus.c` 与 `pal_wasm_ch2_uart.c` |

---

## 1. 背景与技术设计 (ADR-0054 对齐)

在当前 WASM 仿真实现中，串口仅导出了 TX 方向 API（`js_pal_uart_write`），缺少从宿主 TS 异步向 C 固件注入字节的 RX 通道。

为了支持 GPS NMEA 流、蓝牙/WiFi 串口透传以及 AT 指令传感器的仿真，需要建立从 TS `UARTBus` 到 C 侧 `InterruptQueue` 的异步 RX 字节注入与中断唤醒机制。

```text
┌───────────────────────────┐                ┌───────────────────────────┐
│     TS 侧 UARTBus         │                │     C 侧 WASM Target      │
│  (NMEA / AT / User Input) │                │                           │
│             │             │                │  pal_wasm_push_uart_rx()  │
│             └─────────────┼── js_pal ──────┼──────────► ┌──────────┤│
│                           │   import       │            │  RX FIFO   ┤│
│                           │                │            │(pal_os_ringbuf)
│                           │                │            └─────┬──────┤│
│                           │                │                  │       │
│                           │                │             触发 RX IRQ  │
└───────────────────────────┘                └───────────────────────────┘
```

> **协作单核模型与安全调用时序**：WASM 仿真属于协作单核模型，JS 写入与 C 消费永远在单线程上通过事件循环交替执行，二者无竞态冲突。`pal_wasm_push_uart_rx_byte` 只能在 WASM 主循环让出控制权后（即进入 JS 调度层）被调用：
>
> ```text
> JS 宿主调度层
>   │
>   ├─ [SAFE] UARTBus.sendToFirmware() → pal_wasm_push_uart_rx_byte() ← 写入 OSAL ringbuf
>   └─ wasmExports.wink_loop_step()   ← C 主循环
>        └─ dal_uart_read()              ← 此时 JS 不可能同时写入
> ```

---

## 2. 详细改动方案

### 2.1 C 侧（wink-micro-os）

1. **[MODIFY] [wasm_bridge.h](../../../../../wink-micro-os/targets/wasm/wasm_bridge.h)**:
   - 新增 ABI 导出接口：
     - `EMSCRIPTEN_KEEPALIVE void pal_wasm_push_uart_rx_byte(uint8_t port, uint8_t byte);`
     - `EMSCRIPTEN_KEEPALIVE uint32_t pal_wasm_get_uart_rx_available(uint8_t port);`
2. **[NEW] [pal_wasm_fault_types.h](../../../../../wink-micro-os/targets/wasm/pal_wasm_fault_types.h)** *(遵从 06 v2.0 提前拆分规范)*:
   - 从 `pal_wasm_internal.h` 机械拆出故障枚举与结构体声明，供新文件直接引用。
3. **[NEW] [pal_wasm_ch2_uart.c](../../../../../wink-micro-os/targets/wasm/pal_wasm_ch2_uart.c)** *(遵从 06 v2.0 架构规范)*:
   - 建立专职 UART 异步 RX 缓冲 C 文件。
   - **复用 `osal/common/pal_osal_ringbuf.c`** 实例化 `pal_os_ringbuf` 作为 RX FIFO（容量取 2 的幂）。
   - 实现 `pal_wasm_push_uart_rx_byte`（生产者端）与 `pal_uart_read`（消费者端）。
4. **[NEW] [pal_wasm_ch2_bus.c](../../../../../wink-micro-os/targets/wasm/pal_wasm_ch2_bus.c)** *(遵从 06 v2.0 架构规范)*:
   - 从 `pal_hal_wasm.c` 迁出 **I2C** 物理通道逻辑与 `s_i2c_bus_inited[]` 数组。
   - 迁入 `pal_wasm_i2c_transfer()` bool wrapper（来自 `pal_wasm_physical.c`）。
   - 注意：初版仅 I2C，当前无 SPI C 实现（`js_pal_spi_transfer` 仅 bridge.h 声明）；SPI 留待后续补，不在本阶段搬迁范围。
5. **[MODIFY] [pal_irq_wasm.c](file:///d:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai-embedded/wink-micro-os/targets/wasm/pal_irq_wasm.c)**:
   - 增加 UART RX 中断源类型 `WASM_IRQ_SOURCE_UART_RX`。
   - 当 `pal_wasm_push_uart_rx_byte` 入队成功时，向 IRQ Poll 队列推入中断事件。

#### 2.1.1 双 target 同源消费者 API（G1 — 防止 ESP32 构建断裂）

现状核实：仓库**不存在任何 `pal_uart_*` PAL API 与 `dal_uart`**，esp32 target 下也无 `pal_hal_uart_esp32.c`。Phase 2 不能只在 wasm 侧新增消费者端，否则违反 ADR-0002 双 target 同源、ESP32 链接失败。本阶段必须补齐：

1. 在 `pal/include/hal/` 新增 `pal_uart.h`，定义同源消费者 API（由 DAL 调用）：
   - `wink_status_t pal_uart_read(uint8_t port, uint8_t *byte, uint32_t timeout_us);`
   - `wink_status_t pal_uart_rx_available(uint8_t port, uint32_t *out_count);`
2. **[NEW] `targets/esp32/pal_hal_uart_esp32.c`**：提供 ESP32 真实 UART RX 实现。若本阶段不落地真实驱动，必须提供显式返回 `WINK_ERR_UNSUPPORTED` 的 stub 并登记 ADR，**不得留未定义符号**。
3. 在 `targets/esp32/CMakeLists.txt` 与 `targets/wasm/CMakeLists.txt` 同步登记新源文件。
4. 明确 DAL 范围：GPS NMEA 插件需要 `dal_uart_read`。若 DAL UART 驱动本阶段不落地，则 `ch2_uart.c` 的 wasm 消费者必须由测试入口直接调用验证，并标注 DAL UART 为后续阶段，**不得假设其存在**。
5. 任何在 `wasm_bridge.h` 新增的导出（`pal_wasm_push_uart_rx_byte` / `pal_wasm_get_uart_rx_available` / `push_uart_rx_error`）一律执行 ABI 三件套：bridge.h 声明 + `PAL_WASM_ABI_HASH` bump + TS `types/wasm/exports.ts` 更新（`ssotAlignment.test.ts` 守门）。

> UART RX overrun 策略（G6）：C 侧 ringbuf 满时 `pal_os_ringbuf_push` 返回 `WINK_ERR_FULL`，**丢弃新字节并上报一条 Axis F fault**，与 TS `UARTBus.injectRx` 的 "drop newest, retain unread" 一致；Task 2.5 增加 overrun 负向用例。

### 2.2 TypeScript 侧（@wink-ai/unisim）

1. **[MODIFY] [UARTBus.ts](file:///D:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai/packages/unisim/src/unisim/bridge/UARTBus.ts)**:
   - 增加 `sendToFirmware(port: number, data: Uint8Array)` 方法，循环调用 `wasmExports.pal_wasm_push_uart_rx_byte`。
2. **[NEW] [gps-nmea-sensor.ts](file:///D:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai/packages/unisim/src/unisim/plugin/builtins/gps-nmea-sensor.ts)**:
   - 新建基于 UART 异步 RX 的内置 GPS 传感器插件，定期通过 `UARTBus` 发送 `$GPRMC` 协议帧。

---

## 3. 任务列表 (Tasks)

> **提交纪律（G5，适用 Phase 2~4）**：每阶段必须把"纯搬迁 commit"与"新功能 commit"分离——先提交零逻辑变更的 `git mv`/剪切搬迁（搬迁后全量 C 与 TS 测试必须绿），再提交 UART 功能新增。搬迁与功能不得混在同一 commit，以保证 git bisect、review 与回滚粒度。Phase 2 顺序：① `pal_wasm_fault_types.h` 切出；② I2C 段搬入 `ch2_bus.c`（纯搬迁）；③ `ch2_uart.c` + 消费者 API 新增（功能）。

- [ ] **Task 2.0** *(P0 PRE-CONDITION — 必须首先完成)*: **提前切出 `pal_wasm_fault_types.h` 并确定复用 `pal_os_ringbuf`**。
  - 从 `pal_wasm_internal.h` 切出零行为变更的纯类型头文件 `pal_wasm_fault_types.h`。
  - 确认直接复用 `osal/common/pal_osal_ringbuf.c`，取消新建自定义 `pal_uart_rx_fifo.h` 计划。
  - 在 ADR-0054 中补充「协作单核安全调用时序契约」附录。
- [ ] **Task 2.1**: 更新 `wasm_bridge.h` 增加 UART RX 导出函数并更新 `PAL_WASM_ABI_HASH`。
- [ ] **Task 2.2**: 建立 `pal_wasm_ch2_uart.c`，实现基于 `pal_os_ringbuf` 的 UART RX 环形缓冲区与 IRQ 唤醒逻辑。
- [ ] **Task 2.3**: 建立 `pal_wasm_ch2_bus.c`，从 `pal_hal_wasm.c` 搬迁 **I2C** 同步事务逻辑与 `s_i2c_bus_inited[]` 状态（SPI 暂无 C 实现，不搬迁）。
- [ ] **Task 2.3a (G1)**: 新增同源 `pal/include/hal/pal_uart.h` 消费者 API，并提供 `targets/esp32/pal_hal_uart_esp32.c`（真实驱动或 `WINK_ERR_UNSUPPORTED` stub + ADR），同步两个 target 的 CMakeLists；DAL UART 落地范围按 §2.1.1 明确。
- [ ] **Task 2.4**: 在 TS `UARTBus.ts` 补齐 `sendToFirmware` 数据发送桥。
- [ ] **Task 2.5**: 编写 `test_dal_uart_rx_sim.c` 单元测试，验证非阻塞与中断接收流程；追加 ringbuf 满时 overrun（丢新字节 + Axis F fault）负向用例。
- [ ] **Task 2.6** *(P2 追加)*: **实现 UART 错误帧负向注入接口**（支撑 GPS 解析库错误帧丢弃验证）。
  - 在 `wasm_bridge.h` 中新增 `pal_wasm_push_uart_rx_error(uint8_t port, wasm_uart_error_t error)` 接口。
  - 错误类型枚举：`UART_ERR_FRAMING`、`UART_ERR_PARITY`、`UART_ERR_OVERRUN`。
  - 在 TS `UARTBus.ts` 中新增 `injectError(port, flags)` 方法，并编写对应错误帧单元测试。

---

## 4. 验证计划 (Verification)

### 自动化单元测试
- **C 侧 Unity 单测**：运行 `test_dal_uart_sim` 测试套件，验证模拟字节注入后 `dal_uart_read` 正确接收到完整的字符串包。
- **TS 侧 ABI 校验**：运行 `ssotAlignment.test.ts` 验证 C 与 TS 的 ABI 签名严格匹配。

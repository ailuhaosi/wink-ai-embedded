# Wasm↔JS 桥接 ABI 契约

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Landed**（`wasm_bridge.h` / TS `WasmImports`·`WasmExports` / `ssotAlignment` 防漂移）；个别导出能力本身可能是 Stub（如功耗模型，见符号表备注） |
| 支撑轴 | 横切 ABI（不挂 A～F primary） |
| 关联代码 | **`wink-micro-os/targets/wasm/wasm_bridge.h`（ABI SSOT）**、`wink-micro-os/targets/wasm/wink_sim_js.js`、`wink-micro-os/targets/wasm/exported_runtime_functions.json`、`@wink-ai/unisim` (WasmImports / WasmExports / ssotAlignment) |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | 0009、0019、0042、0045 |
| 迁自 | `04-wasm-simulation-2.0/10-wasm-js-bridge-abi.md` |

> 本文件是 `wasm_bridge.h` 的人类可读镜像：集中列出所有 C↔JS 跨边界符号、类型契约与 6 条隐性 ABI 前提。**符号签名以头文件为准**；若本文与头冲突，以头为准并在变更时同步本文。TS `WasmImports`/`WasmExports` 与 `ssotAlignment.test.ts`（解析头文件比对 key）在编译/测试期防漂移。变更桥接代码时不得违反下列契约。
>
> **交叉发现**：Asyncify 挂起 / Execution Mode → [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md)；Fault / safeWrap 路径 → [`05-memory-and-faults.md`](./05-memory-and-faults.md)；本篇写**契约**（ABI #6）。

---

## 1. 契约总则

- 所有 wasm 仿真侧对 JS 的导入（`js_pal_*` / `js_sim_*`）`extern` 声明集中在 `wink-micro-os/targets/wasm/wasm_bridge.h`，杜绝散落在多个 `.c` 的漂移；
- 约定：`js_sim_*`（DAL/device bypass）契约以 Device Registry 为 SSOT，本头抄 Registry；
- 类型映射（`-s WASM_BIGINT=1`）：

| C 类型 | JS 类型 | 说明 |
|---|---|---|
| `uint64_t`/`int64_t` | `bigint` | 时钟字段，禁止 `number`（精度丢失） |
| `uint32_t`/`uint16_t`/`uint8_t`/`int32_t` | `number` | ≤53 位安全 |
| `float`/`double` | `number` | IEEE 754 互转 |
| `bool` | `boolean` | |
| 指针（wasm32） | `number` | wasm 堆字节偏移，4 字节；wasm64 迁移见 §8 |

- 导出符号由 `EMSCRIPTEN_KEEPALIVE` 标注（`pal_wasm_*`/`pal_os_*`）；可见性来自 KEEPALIVE，头里仅做跨翻译单元声明。

> **头文件注记（2026-08-02）**：`wasm_bridge.h` 顶部仍有「Plan 4 会追加 `js_sim_trigger_ultrasonic` / `js_sim_measure_echo_pulse_us`」历史注释——符号**不存在**，以通道文淘汰说明为准（[`08-channel-routing.md`](./08-channel-routing.md) §5），勿按该注释新增导入。

---

## 2. 六条隐性 ABI 契约（改桥接必读）

### ABI #1：Wasm 栈向下增长
Emscripten Wasm 栈从高地址向低地址增长，Asyncify unwind/rewind 依赖此行为。无法用 `_Static_assert`（运行时属性）。风险：栈溢出静默覆盖堆。防护：`-s ASYNCIFY_STACK_SIZE=65536` 留余量。

### ABI #2：浮点与 NaN 装箱
- C `float`/`double` ↔ JS `number`：IEEE 754 安全互转；
- **禁止 `long double`**（Emscripten 降级为 double）；
- JS `NaN`/`Infinity` 传到 C 是合法 IEEE 值，但 C 逻辑可能未处理 → JS 侧必须在传入 C 前做 `isFinite` 检查（结合 `sanitizeFloat` 逻辑规范进行防污染净化）。

### ABI #3：指针对齐
- Emscripten `malloc` 保证 8 字节对齐；
- `uint64_t`/`double` 访问需 8 字节对齐；未对齐访问在 Wasm 中是 UB（可能静默读错值）；
- 跨边界结构体用 `__attribute__((aligned(8)))` 或 packed + `memcpy`。

### ABI #4：EM_JS 宏展开时机
`EM_JS` 定义的 JS 在**编译期**嵌入二进制：运行时不可改、无法访问 JS 闭包（仅全局作用域）、参数传递有开销，避免热路径调用。

### ABI #5：WASM_BIGINT ABI
- 启用 `-s WASM_BIGINT=1` 后 `uint64_t`/`int64_t` ↔ JS `bigint` 精确传递；
- TS 误用 `number` 传入会抛 `TypeError`（运行期兜底 TS 编译期检查）；
- TS 侧所有时钟/时间字段强制 `bigint`；反序列化后做 runtime `typeof` 校验。详见 [`02-virtual-clock.md`](./02-virtual-clock.md)。

### ABI #6：Asyncify 重入限制（+ safeWrap 兜底）
Asyncify sleeping 状态（wasm 已 unwind、等 Promise-returning import resolve）下：
- Host **不得**调用任何 `pal_wasm_*` 导出（线性内存/栈部分在 Asyncify 备份缓冲区，重入会读到不一致状态并可能损坏备份栈）；
- Host **不得**直接读写 Wasm 堆（`HEAPU8` 视图可能因 Asyncify 临时移动而指向陈旧内容，rewind 后才一致）；
- **允许**纯 JS 侧逻辑（VirtualClock 推进、`PinArbiter.setDriver`、`InterruptQueue.push` 等 framework-owned 组件）——只改 JS state，下次 wasm 进入时由 Phase 0/`js_pal_poll_interrupt`/`js_pal_gpio_read` 等 pull 路径兑现。

**P0-3/P1-4 双层防线（Import + Export 安全网）**：
1. **Import 层（C→JS）**：`safeWrap`/`safeWrapAsync` HOF 对所有用户可覆盖 `js_*` import 做 try/catch + `Promise.catch`，宿主抛错/reject 永远返回 resolved Promise → Emscripten 永不见 throw/reject，不 abort；错误 marshal 到 `pal_wasm_host_fault(8003, msg)` 走标准 fault 路径（Fault 语义见 [`05-memory-and-faults.md`](./05-memory-and-faults.md)）；
2. **Export 层（JS→C）**：TS 侧使用 `createSafeExportsProxy` 对 `WasmExports` 进行代理防护。在 Asyncify Sleeping / BusyWait 挂起状态（`isYielded`）下，拦截 Host 主动发起的写操作与状态变更类 `pal_wasm_*` 导出函数，并抛出强类型 `ABI Guard` 异常，防范重入损坏 Wasm 堆与备份栈；
3. `pal_wasm_host_fault` 置位 `s_wasm_faulted` 锁存后，所有 state-mutating `pal_wasm_*` 导出经 `WASM_FAULT_GUARD_*` 宏 fast-fail 为 no-op；`pal_wasm_is_faulted()` 仍可读；
### ABI #7：Binding Manifest 与 Fail-Loud 显式存在性校验
- TS 侧宿主与外设挂载 WASM Exports 时，必须提供显式绑定表 (**Binding Manifest**，如 `requiredExports: ['pal_wasm_push_pin_event', ...]`)；
- **禁止依赖弱 Proxy 动态查找的静默 `undefined`**：若某个 required export 在底层 Emscripten Module 上不存在或拼写错误，挂载期必须立刻 Fail-Loud `throw Error`；
- 挂载期强制进行 ABI Hash 握手校验（`pal_wasm_get_abi_hash()`），防范固件版本与前端依赖不一致隐患。

Asyncify 挂起与 Execution Mode 行为见 [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md)。

---

## 3. JS→C 导入（`js_*`，C extern 声明）

### 3.1 PAL HAL（GPIO/PWM/总线）

| 符号 | 签名 | 说明 |
|---|---|---|
| `js_pal_gpio_write` | `(uint16_t pin, bool level)` | GPIO 输出到 PinArbiter |
| ~~`js_pal_gpio_read`~~ | ~~`(uint16_t pin) → bool`~~ | **已彻底移除**：全量升级为 `js_pal_gpio_read_state` |
| `js_pal_gpio_read_state` | `(uint16_t pin) → uint8_t` | **电气 SSOT 读**：0=LOW/1=HIGH/2=HiZ/3=CONFLICT（见 [`07-peripheral-registry.md`](./07-peripheral-registry.md) §4.2） |
| `js_pal_gpio_drive_ideal` | `(uint16_t pin, bool level)` | UI/测试理想注入，driver id `ideal:ui:{pin}` SUPPLY |
| `js_pal_gpio_release_ideal` | `(uint16_t pin)` | 仅移除 ideal driver |
| `js_pal_gpio_release_mcu` | `(uint16_t pin)` | 移除 `mcu:gpio{N}`（INPUT*/开漏释放） |
| `js_pal_pwm_set_duty` | `(uint8_t channel, float duty_cycle_percent)` | 通道 1b，duty 为 0~100 百分比 |
| `js_pal_adc_read_norm` | `(uint16_t pin) → float` | 通道 3：读 `PinArbiter.readAnalog(pin)` 归一化值 `[0,1]`。**不返回 mV**——raw/mv 换算在 C 侧 `pal_wasm_adc.c`（ADR-0057）；满量程由 PAL per-channel 状态持有，JS 不感知 |
| `js_pal_i2c_transfer` | `(uint8_t port, uint16_t dev_addr, const uint8_t* wbuf, uint32_t wlen, uint8_t* rbuf, uint32_t rlen) → bool` | 同 Worker 同步 Heap 切片 |
| `js_pal_spi_transfer` | `(uint8_t port, uint16_t device_id, const uint8_t* tx, uint32_t len, uint8_t* rx, uint8_t mode, uint32_t sck_hz) → bool` | 全双工；device_id 是片选/设备索引；mode 0..3；Phase 4 T5 minimal stub |
| `js_pal_uart_write` | `(uint8_t port, const uint8_t* buf, uint32_t len)` | 写 UART 帧（TX）。**无**对称 `js_pal_uart_read`；异步 RX **Planned**（见 [`08`](./08-channel-routing.md)） |
| `js_pal_gpio_on_write` | `(uint8_t pin, uint8_t level)` | GPIO 写通知桥 |

### 3.2 中断 Poll（方案 C）

| 符号 | 签名 | 说明 |
|---|---|---|
| `js_pal_register_interrupt` | `(uint16_t pin, uint32_t callback_index, uint32_t arg_ptr)` | C 注册 ISR 时告知 pin→(cb,arg) 映射；JS 只存不回调 |
| `js_pal_deregister_interrupt` | `(uint16_t pin)` | 注销映射 |
| `js_pal_poll_interrupt` | `(uint32_t* out_callback_index, uint32_t* out_arg_ptr) → bool` | 每 tick C 主动拉一个 pending；FIFO，多次调用直到 false |

> 旧 Push 模型 `_trigger_wasm_interrupt` 已永久移除。详见 [`04-interrupt-model.md`](./04-interrupt-model.md)。`callback_index` 是不透明 Wasm Table 索引；wasm32 用 `(uint32_t)(uintptr_t)` 截断，wasm64 须迁移。

### 3.3 PAL OSAL

| 符号 | 签名 | Asyncify | 说明 |
|---|---|---|---|
| `js_pal_os_sleep_ms` | `(uint32_t ms)` | **是（`'auto'`）** | 必须返回 `Promise<void>` |
| `js_pal_os_busy_wait_us` | `(uint32_t us)` | **是（`'auto'`）** | 必须返回 `Promise<void>` |

- 时间 SSOT：C `pal_os_get_us/ms()` 直读 `s_virtual_us`（零 JS 调用），时钟经 C→JS 导出 `pal_wasm_advance_virtual_clock` 推进；**不存在** JS→C 的 `get_ms/get_us` 导入（旧 `js_pal_os_get_ms/us` 死桩已删除）。
- 这两个是当前唯一的 ASYNCIFY_IMPORTS（见 `exported_runtime_functions.json`）。

### 3.4 日志与 Plugin Channel

| 符号 | 签名 | 说明 |
|---|---|---|
| `js_pal_log` | `(uint8_t level, const char* msg)` | level=ERROR1/WARN2/INFO3/DEBUG4；msg 是 NUL-terminated UTF-8（wasm 偏移），同步调用 JS 不得持有指针 |
| `js_sim_get_plugin_channel` | `(const char* instance_id, const char* channel_name) → float` | 插件物理语义读（如 `"ultrasonic:0"` / `"distanceCm"`）。**Observation / Plugin SSOT**；**禁止**作 DAL 业务旁路。C 内 cm→μs 测量捷径为 **Deprecated**（见 [`08-channel-routing.md`](./08-channel-routing.md) §4） |

---

## 4. C→JS 导出（`pal_wasm_*` / `pal_os_*`，KEEPALIVE）

### 4.1 物理退化引擎（ADR-0009 Wave 2）

| 符号 | 签名 | 说明 |
|---|---|---|
| `pal_wasm_advance_virtual_clock` | `(uint64_t us)` | 时钟推进（INTERACTIVE 路径，经单 Gate） |
| `pal_wasm_set_bounce_us` | `(uint32_t)` | 抖动 |
| `pal_wasm_set_warmup_us` | `(uint32_t)` | 预热 |
| `pal_wasm_set_sample_interval_us` | `(uint32_t)` | 采样间隔 |
| `pal_wasm_set_adc_noise_v` | `(float)` | ADC 噪声 |
| `pal_wasm_set_rc_tau_s` | `(float)` | RC tau |
| `pal_wasm_set_i2c_drop_permil` | `(uint16_t)` | I2C 丢包千分比 |
| `pal_wasm_set_prng_seed` | `(uint32_t)` | 种子 |
| `pal_wasm_get_prng_state` / `set_prng_state` | `() → uint32_t` / `(uint32_t)` | 回归/会话回放（双仓联动） |
| `pal_wasm_get_abi_hash` | `() → uint32_t` | ABI 布局锁（SimFaults/snapshot 变更须 bump） |
| `pal_wasm_reset_physical` | `()` | 复位全部物理状态（faulted 态唯一可运行 mutator） |

### 4.2 时钟与观测

| 符号 | 签名 | 说明 |
|---|---|---|
| `pal_wasm_is_clock_warning_fired` | `() → bool` | 跨 UINT64 中点预警 |
| `pal_wasm_get_virtual_clock_us` | `() → uint64_t` | 当前虚拟时钟（与 `pal_os_get_us` 同源，便于 cwrap） |
| `pal_os_get_us` / `pal_os_get_ms` | `() → uint64_t` | OSAL 时钟直读导出 |
| `pal_wasm_gpio_read` | `(uint16_t pin) → bool` | JS 友好 bool 包装 |
| `pal_wasm_i2c_transfer` | `(...) → bool` | bool 返回避免 out-pointer 编组 |

### 4.3 故障审计与 Fault（详见 [`05-memory-and-faults.md`](./05-memory-and-faults.md)）

| 符号 | 说明 |
|---|---|
| `pal_wasm_get_fault_log_count` / `reset_fault_log` | 故障环计数/复位 |
| `pal_wasm_get_fault_log_raw_ptr` | Bulk 日志数组基地址（16 字节 Stride，DataView O(1) 批量提取） |
| `pal_wasm_fault_event_get_timestamp/type/pin_or_bus/sequence` | 字段访问器（timestamp 用 bigint；越界返回 0，先 count 判边界） |
| `pal_wasm_is_faulted` | 锁存查询 |
| `pal_wasm_host_fault(uint32_t code, const char* msg_cstr)` | Host→C fault（code=8003）；msg 经 `_malloc`+stringToUTF8 写入后 `_free`，可 NULL |
| `pal_wasm_set_pin_power_model` / `get_total_energy_mj` | 功耗模型 **Wave3 stub**（set 仅校验不存储，get 返回 0，bigint mJ） |

### 4.4 外设控制/状态与执行模式

| 符号 | 说明 |
|---|---|
| `pal_wasm_sim_reset_all_devices` | 复位全部虚拟器件 |
| `pal_wasm_get_servo_angle(uint8_t channel) → float` | 舵机角度观测 |
| `pal_wasm_get_pwm_duty_percent(uint8_t channel) → float` | PWM duty 观测 |
| `pal_wasm_push_pin_event(uint8_t pin, uint64_t delay_us, uint8_t level)` | Pin Event Queue 注入（零 Yield 脉宽环回） |
| `pal_wasm_set_gpio_input(uint8_t pin, bool level)` | GPIO 输入注入 |
| `pal_wasm_get_gpio_output(uint8_t pin) → bool` | GPIO 输出观测 |
| `pal_wasm_set_sim_mode(uint32_t mode)` / `get_sim_mode()` | INTERACTIVE/HEADLESS（ADR-0042） |

> 已退役：`pal_wasm_get_ssd1306_fb`（Phase E）——OLED framebuffer SSOT 改为 UniSim plugin `displays[]`。

---

## 5. 运行时导出配置（exported_runtime_functions.json）

```json
{
  "EXPORTED_FUNCTIONS": ["_main", "_malloc", "_free"],
  "EXPORTED_RUNTIME_METHODS": ["ccall", "cwrap", "HEAPU8", "Asyncify", "callMain"],
  "ASYNCIFY_IMPORTS": ["js_pal_os_sleep_ms", "js_pal_os_busy_wait_us"],
  "ASYNCIFY_STACK_SIZE": 65536,
  "EXPORT_NAME": "WasmSandbox"
}
```

启动必须用 `Module.callMain()`（不是 `_main()`），且不得 `await callMain()`（main 是永不返回的调度循环）。详见 [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md)。

---

## 6. 字段级访问器约定

故障事件等跨语言结构体**不**整体传递（避免 alignment/padding 风险）：JS 先 `get_count`，再对每个 index 逐字段 getter（timestamp 用 BigInt，其余 number）。越界 getter 返回 0/不写 out，调用方必须先用 count 做边界判断。

功耗模型 `wasm_pin_power_model_t` 是仅 3 个 uint32 的 POD struct；JS 在 wasm 堆 malloc 逐字段写入再传指针偏移，JS 永不见完整定义（头里仅前向 `struct` 声明）。

---

## 7. 防漂移机制

- **C 侧**：`wasm_bridge.h` 是唯一 extern 声明点；
- **TS 侧**：`types/wasm/imports.ts` 的 `WasmImports` 接口逐字段镜像，注释标明 SSOT 是头文件；`createUnisimImports` 必须产出 `WasmImports`，`installUnisimBridge` 必须赋每个字段；
- **测试**：UniSim SSOT 防漂移测试工具（`@wink-ai/unisim`）解析头文件比对 key 集合，漂移即 fail；
- **ABI hash**：`pal_wasm_get_abi_hash()` 锁 SimFaults/snapshot ABI；新增/变更导入时同步 bump `PAL_WASM_ABI_HASH`（C 与 TS 各一份）。

---

## 8. wasm64 迁移门控

当前 wasm32：指针是 4 字节，`pal_irq_wasm.c` 有 `_Static_assert(sizeof(void*)==4)`。迁移到 wasm64 须同步：
1. ABI #5 更新为 64-bit 指针 ABI；
2. JS 侧 `writeU32LE → writeU64LE`、BigInt 化；
3. 去掉所有 `(uint32_t)(uintptr_t)` 截断，改全宽度；
4. `WasmImports` 的 out-pointer 参数类型改 bigint。

---

## 9. API × Axis × Phase Cross-Reference

> **Reading guide**: This table indexes every symbol in `wasm_bridge.h` by
> simulation-fidelity axis (A~F), channel, call direction, and delivery phase.
> Parameter details live in `wasm_bridge.h` — **do NOT duplicate them here**.
> Update this table whenever a symbol is added, removed, or reassigned.

| Symbol | Axis | Channel / Sub-system | Direction | Phase / Status |
|---|---|---|---|---|
| **— Axis A · CH1: Digital Pin —** |||||
| `js_pal_gpio_write` | A | CH1 Pin | C→JS | Landed |
| ~~`js_pal_gpio_read`~~ | A | CH1 Pin | C→JS | **Removed** (upgraded to `read_state`) |
| `js_pal_gpio_read_state` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_drive_ideal` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_release_ideal` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_release_mcu` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_on_write` | A | CH1 Pin | C→JS | Landed (observation hook) |
| `pal_wasm_push_pin_event` | A+B | CH1 + VirtualClock | JS→C | Landed |
| `pal_wasm_set_gpio_input` | A | CH1 Pin | JS→C | Landed |
| `pal_wasm_get_gpio_output` | A | CH1 Pin | JS→C | Landed |
| `pal_wasm_gpio_read` | A | CH1 Pin | JS→C | Landed (bool wrapper) |
| **— Axis A · CH1b: PWM —** |||||
| `js_pal_pwm_set_duty` | A+C | CH1b PWM | C→JS | Landed |
| `pal_wasm_get_pwm_duty_percent` | C | CH1b PWM | JS→C | Landed |
| **— Axis A · CH2: Bus —** |||||
| `js_pal_i2c_transfer` | A | CH2 I2C | C→JS | Landed |
| `js_pal_spi_transfer` | A | CH2 SPI | C→JS | Phase 4 stub |
| `js_pal_uart_write` | A | CH2 UART TX | C→JS | Landed |
| `pal_wasm_i2c_transfer` | A | CH2 I2C | JS→C | Landed (bool wrapper) |
| `pal_wasm_set_i2c_drop_permil` | A+F | CH2 I2C degradation | JS→C | Landed |
| `pal_wasm_push_uart_rx_byte` | A+E | CH2 UART RX | JS→C | Landed (Async RX) |
| `pal_wasm_push_uart_rx_error` | A+F | CH2 UART error | JS→C | Landed |
| **— Axis A · CH3: Analog ADC —** |||||
| `js_pal_adc_read_norm` | A | CH3 Analog | C→JS | Landed |
| `pal_wasm_set_adc_noise_v` | A+F | CH3 degradation | JS→C | Landed |
| `pal_wasm_set_rc_tau_s` | A+F | CH3 RC filter | JS→C | Landed |
| **— Axis A · CH4: Buffer Payload —** |||||
| `js_pal_ws2812_write` | A | CH4 WS2812 | C→JS | Landed |
| **— Axis A · Plugin Channel —** |||||
| `js_sim_get_plugin_channel` | A | Plugin observation | C→JS | Landed |
| **— Axis B: Time Base —** |||||
| `js_pal_os_sleep_ms` | B | OSAL delay | C→JS | Landed (Asyncify import) |
| `js_pal_os_busy_wait_us` | B | OSAL busy-wait | C→JS | Landed (Asyncify import) |
| `pal_wasm_advance_virtual_clock` | B | VirtualClock | JS→C | Landed |
| `pal_wasm_is_clock_warning_fired` | B | VirtualClock | JS→C | Landed |
| `pal_wasm_get_virtual_clock_us` | B | VirtualClock | JS→C | Landed |
| `pal_os_get_us` | B | OSAL clock | JS→C | Landed |
| `pal_os_get_ms` | B | OSAL clock | JS→C | Landed |
| **— Axis D: Interrupt Model —** |||||
| `js_pal_register_interrupt` | D | IRQ poll | C→JS | Landed |
| `js_pal_deregister_interrupt` | D | IRQ poll | C→JS | Landed |
| `js_pal_poll_interrupt` | D | IRQ poll | C→JS | Landed |
| **— Axis E: Scheduler / Concurrency —** |||||
| *(no dedicated extern symbols)* | E | Calling-convention contract | — | ADR-0054 + Phase 2 Task 2.0 |
| **— Axis F: Fault & Observation —** |||||
| `pal_wasm_get_fault_log_count` | F | Fault log | JS→C | Landed |
| `pal_wasm_reset_fault_log` | F | Fault log | JS→C | Landed |
| `pal_wasm_get_fault_log_raw_ptr` | F | Bulk fault log accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_timestamp` | F | Fault log accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_type` | F | Fault log accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_pin_or_bus` | F | Fault log accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_sequence` | F | Fault log accessor | JS→C | Landed |
| `pal_wasm_is_faulted` | F | Fault state | JS→C | Landed |
| `pal_wasm_host_fault` | F | Fault injection | JS→C | Landed |
| `pal_wasm_get_abi_hash` | F | ABI hash lock | JS→C | Landed |
| `pal_wasm_set_pin_power_model` | F | Power model | JS→C | Wave 3 stub |
| `pal_wasm_get_total_energy_mj` | F | Power model | JS→C | Wave 3 stub |
| **— Axes A+F: Physical Degradation Engine —** |||||
| `pal_wasm_set_bounce_us` | A+F | Degradation | JS→C | Landed |
| `pal_wasm_set_warmup_us` | A+F | Degradation | JS→C | Landed |
| `pal_wasm_set_sample_interval_us` | A+F | Degradation | JS→C | Landed |
| `pal_wasm_set_prng_seed` | A+F | Degradation PRNG | JS→C | Landed |
| `pal_wasm_get_prng_state` | A+F | Degradation PRNG | JS→C | Landed |
| `pal_wasm_set_prng_state` | A+F | Degradation PRNG | JS→C | Landed |
| `pal_wasm_reset_physical` | A+F | Degradation reset | JS→C | Landed |
| `pal_wasm_set_fidelity_level` | A+F | Fidelity level | JS→C | Landed |
| **— Axes A+F: Peripheral Control & Execution Mode —** |||||
| `pal_wasm_sim_reset_all_devices` | A+F | Device control | JS→C | Landed |
| `pal_wasm_set_sim_mode` | F | Execution mode | JS→C | Landed |
| `pal_wasm_get_sim_mode` | F | Execution mode | JS→C | Landed |
| **— Cross-axis Utility —** |||||
| `js_pal_log` | — | Logging | C→JS | Landed |
| **— DEPRECATED & REMOVED —** |||||
| ~~`pal_wasm_set_ultrasonic_distance`~~ | ~~A~~ | ~~CH1 shortcut~~ | JS→C | **Removed** · Replaced by `push_pin_event` ECHO pulse |
| ~~`pal_wasm_get_ultrasonic_distance`~~ | ~~A~~ | ~~CH1 shortcut~~ | JS→C | **Removed** · Replaced by `push_pin_event` ECHO pulse |

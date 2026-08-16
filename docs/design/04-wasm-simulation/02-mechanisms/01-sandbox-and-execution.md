# Wasm 沙箱、Worker 隔离、Asyncify 与执行模式

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Landed**（Worker / Asyncify / INTERACTIVE·HEADLESS / 链接参数）；构建产物路径随本机 emsdk 变化 |
| 支撑轴 | **横切**（宿主 / 执行模式；与 B/D/E 交互） |
| 关联代码 | `wink-micro-os/targets/wasm/`、`wink-micro-os/osal/wasm/pal_osal_wasm.c`、`wink-micro-os/targets/wasm/exported_runtime_functions.json`、`wink-micro-os/targets/wasm/wink_sim_js.js`、`@wink-ai/unisim` (SimWorker / WasmBridge) |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | [0002](../../../decisions/unisim/0002-dual-target-compilation.md)、[0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md)、[0019](../../../decisions/unisim/0019-wasm-imports-override-and-asyncify-syntax.md)、[0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md)、[0042](../../../decisions/unisim/0042-sim-execution-modes.md) |
| 迁自 | `04-wasm-simulation-2.0/02-sandbox-and-execution.md` |

> 本文件回答：Wasm 实例如何被宿主加载、阻塞调用如何不卡死 Worker、INTERACTIVE 与 HEADLESS 两种执行模式如何工作、构建链接参数是什么。时钟机制见 [02](./02-virtual-clock.md)，调度器见 [03](./03-scheduler-and-concurrency.md)，中断 Poll 见 [04](./04-interrupt-model.md)。

---

## 1. Web Worker 线程隔离

### 1.1 为什么必须用 Worker

嵌入式 C 的 `while(1)` / FreeRTOS 式循环若跑在主线程，会长时间占用事件循环，导致 UI 在 60 FPS 下冻结。方案是：

- **专用 Web Worker** 运行 Wasm 沙箱；
- 主线程只通过 `postMessage` 做消息驱动的渲染（引脚状态、OLED 帧、日志）；
- 用户输入（按键、滑块）也以消息送入 Worker。

### 1.2 生命周期数据流

```text
(1) UI postMessage {type:'start', wasmBytes}
(2) Worker WebAssembly.instantiate()
(3) Module.callMain() → main() → 调度器初始化 → App 循环
        │ C 调 pal_gpio_write
(4) Worker postMessage {type:'pin_write', pin, lvl} → UI 更新
(5) 用户点虚拟按键 → UI postMessage {type:'pin_input', pin, lvl}
(6) Worker 写入虚拟引脚状态（PinArbiter / InterruptQueue）
(7) {type:'pause'}  → 挂起 Wasm 协程
(8) {type:'resume'} → 恢复
(9) {type:'stop'}   → 销毁实例 + Worker
```

### 1.3 二进制产出与 App 注入

构建（在 `wink-micro-os/` 下）：

```powershell
# 激活 emsdk（PowerShell）
D:\software\embedded\emsdk\emsdk_env.ps1
emcmake cmake -S . -B build-wasm -DTARGET_PLATFORM=wasm
cmake --build build-wasm
# 切换 App：-DWINK_APP_DIR=<abs path to app dir>
```

产出：

- `build-wasm/wink_simulator.wasm`：单二进制（未压缩）；
- `build-wasm/wink_simulator.js`：MODULARIZE glue，`EXPORT_NAME=WasmSandbox`（UMD 导出），默认 `js_*` 桩由 `wink_sim_js.js` 注入。

App 注入契约（见 `02-wink-micro-os/03-directory-architecture.md`）：App CMakeLists 用 `set(WINK_APP_SOURCES ... PARENT_SCOPE)` 导出源。Wasm 对所有 App 变体是**一个共享二进制目标**（与 host "每个 App 一个可执行"对称）。

### 1.4 本仓 Node 侧烟测

`wink-micro-os/targets/wasm/wink_sim_stub.js` 是**编译期契约闸**，不是 host 替代品：

1. 静态解析 `wink_simulator.wasm` 的 `env.js_*` 导入集，与期望集合比对（漂移即 fail）；
2. 在 `worker_threads.Worker` 里加载 `wink_simulator.js`，`onRuntimeInitialized` 即 PASS。

必须放 Worker：Emscripten 6.x Asyncify unwind→rewind 与 Node 主事件循环共存会饿死定时器并 OOM（实测）。

---

## 2. Emscripten Asyncify 协程挂起（ADR-0019）

### 2.1 问题：阻塞调用与事件循环

`pal_os_sleep_ms(100)` 这类阻塞调用在单 Worker 线程里若真的忙等，会阻塞 `onmessage`。Asyncify 在导入点挂起 Wasm 栈（寄存器/帧），把控制权还给事件循环，到期后恢复栈继续执行。

### 2.2 两侧契约（缺一即静默失败）

ADR-0019 确立的三段契约：

1. **C/链接侧**：`-sASYNCIFY_IMPORTS=[...]` 声明哪些导入是异步挂起点（正确标志是 `ASYNCIFY_IMPORTS`，**不是** `ASYNCIFY_ONLY`/`ASYNCIFY_ADD`）。当前为：
   ```json
   "ASYNCIFY_IMPORTS": ["js_pal_os_sleep_ms", "js_pal_os_busy_wait_us"]
   ```
2. **JS 库侧（`--js-library`）**：库函数必须**同时**返回 Promise **且**带 `<symbol>__async: 'auto'` 元数据。emcc 6.x 的 `src/jsifier.mjs:482` 只在 `__async === 'auto'` 时自动包 `Asyncify.handleAsync`；`__async: true` **无效**（Promise 被丢弃，wasm 立即返回，无诊断）。
3. **手写 sleep 侧**：用 `return new Promise(resolve => scheduleWakeAt(clock.getUs()+..., resolve))`；`resolve`/`wakeUp` 必须恰好调用一次。

> 历史教训：旧文档使用 `js_pal_delay_ms`/`js_pal_delay_us` 等符号名——这些已被 `js_pal_os_sleep_ms`/`js_pal_os_busy_wait_us` 取代；时钟读取 `js_pal_get_ms/us` 已**删除**（C 直读 `s_virtual_us` 内存）。

### 2.3 wrapper 模式（默认桩）

`wink-micro-os/targets/wasm/wink_sim_js.js` 里每个 `wasm_bridge.h` 的 `js_*` 符号都是 wrapper：

```javascript
function(/*...*/) {
  if (typeof Module.js_pal_gpio_write === 'function') return Module.js_pal_gpio_write.apply(null, arguments);
  /* 默认桩 */
}
```

- 宿主（Workbench）不在库内重声明符号，而是在 Module 工厂配置里赋值 `Module.js_pal_gpio_write = fn`（推荐，首次调用前生效），或工厂后在实例上赋值（必须在首次 wasm 调用前）。
- emcc 6.x 三条已验证结论：(a) 顶层 `Module.js_* = fn` 单独无效，必须有逐符号的 Module 查找 wrapper；(b) `__async:true` 不触发自动包装；(c) wasm 符号只能被覆盖，不能新增——缺 `js_*` 会 `abort('missing function')`。新增符号顺序：加 `wasm_bridge.h` extern → 加 `wink_sim_js.js` 默认 wrapper 桩 → 重编译。

### 2.4 Promise 契约（前端实现者必读）

`js_pal_os_sleep_ms` / `js_pal_os_busy_wait_us` 的宿主覆盖**必须返回 Promise**。同步返回会导致 unwind→rewind 死循环且无诊断。唯一的类型防线是 `@wink-ai/unisim` 的 `WasmImports` 接口把这两个标注为 `Promise<void>`。

启动要求：

1. `return new Promise(...)`，不要 `setTimeout` 后裸 return；
2. `wakeUp`/`resolve` 恰好一次；
3. 用 `Module.callMain()` 启动，**不要**用 `Module._main()`（MODULARIZE+ASYNCIFY 下只有 callMain 正确处理被插桩的 main）；main 是永不返回的调度循环，JS 不得 `await callMain()`；
4. Wasm 必须在 Worker 中加载（主线程已观测到 20s 堆爆）。

### 2.5 编译链接参数（已核对链接命令）

`wink-micro-os/targets/wasm/exported_runtime_functions.json` 与实际 `link.txt` 一致的关键参数：

| 参数 | 值 | 含义 |
|---|---|---|
| `ASYNCIFY` | 1 | 启用协程挂起 |
| `ASYNCIFY_IMPORTS` | `['js_pal_os_sleep_ms','js_pal_os_busy_wait_us']` | 挂起点白名单 |
| `ASYNCIFY_STACK_SIZE` | 65536 | 异步栈 64 KiB（起始值，须按最深 AI 生成调用链实测调优） |
| `WASM_BIGINT` | 1 | uint64 时钟 ↔ JS bigint（[ADR-0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)） |
| `STACK_OVERFLOW_CHECK` | 2 | 栈溢出检查（dev/debug） |
| `ASSERTIONS` | 1 | 运行期断言（dev/debug） |
| `MODULARIZE` / `EXPORT_NAME` | 1 / `WasmSandbox` | UMD 工厂导出 |
| `EXPORTED_FUNCTIONS` | `_main`,`_malloc`,`_free` | 显式导出 |
| `EXPORTED_RUNTIME_METHODS` | `ccall`,`cwrap`,`HEAPU8`,`Asyncify`,`callMain` | 运行时方法 |
| `ERROR_ON_UNDEFINED_SYMBOLS` | 0 | 未定义符号不报错（由运行时 wrapper 提供） |

> 时钟读取是零 JS 调用的内存直读：`pal_os_get_us/ms()` 读 `s_virtual_us`；时钟通过 C→JS **导出** `pal_wasm_advance_virtual_clock(bigint)` 推进。不存在 JS→C 的 `get_ms/get_us` 导入。

---

## 3. 执行模式：INTERACTIVE 与 HEADLESS（ADR-0042）

### 3.1 动机

INTERACTIVE 下 idle 时走 `js_pal_os_sleep_ms` 的 Asyncify 挂起，CI/Node 跑 sleep-heavy 测试时 unwind/rewind 极慢（10s 仿真时间耗 5~30s 墙钟）。HEADLESS 在所有任务等待时直接在 C 调度循环内跳跃虚拟时钟，绕过 Asyncify，吞吐提升 **100~1000 倍**。

### 3.2 两种模式

| 模式 | 适用 | idle 行为 | 外部事件 | WCET 8002 |
|---|---|---|---|---|
| **INTERACTIVE**（默认） | 浏览器 UI / 3D | 经 `js_pal_os_sleep_ms` Asyncify 让出，JS 推进时钟并唤醒 | 支持动态注入 | 启用（墙钟兜底） |
| **HEADLESS** | Node 单测 / CI | C 主循环直接跳跃 `s_virtual_us` 到 `next_wakeup_us` 并 `continue`，**零 Asyncify** | JS 主线程被阻塞，须预加载事件队列 / C 侧自决物理 / 时间片分片 | **旁路**（虚拟时间瞬跳，墙钟比照无意义，避免误杀蒙特卡洛等密集计算） |

切换：C→JS 导出 `pal_wasm_set_sim_mode(mode)` / `pal_wasm_get_sim_mode()`（类型 `wink_sim_mode_t`）。host 侧在 `wink-micro-os/osal/host/pal_osal_host.c` 有等价物。unisim 的 `WasmExports` 类型与 `ssotAlignment.test.ts` 须同步。

### 3.3 时钟单 Gate 红线（R-VC-1）

ADR-0042 在引入 HEADLESS 第二写入者的同时，把 ADR-0003 的"单一写入入口"重构为**单一 Gate**：

- 静态私有函数 `wink_vclock_advance_internal()` 是 `s_virtual_us` 的**唯一赋值点**；
- 两个合法调用者：(a) 导出 `pal_wasm_advance_virtual_clock()`（JS 路径，INTERACTIVE）；(b) HEADLESS 调度循环内的跳跃；
- **任何其他代码不得直接写 `s_virtual_us`**；`pal_delay_ms/us` 禁止步进（双重步进是 C14 级逃逸）。

### 3.4 HEADLESS 约束

- 调度循环不释放控制权，运行期间 JS 主线程被阻塞，无法中途动态注入输入。测试须：预加载事件队列、用 C 侧自决物理引擎、或按时间片分片运行。
- 必备单测：`test_sim_scheduler_headless_jump`（虚拟时钟快跳跃）。

### 3.5 CI 与 Execution Mode（契约）

HEADLESS **旁路 Asyncify 与 WCET**，吞吐高，但一整类缺陷（Asyncify 栈损坏、yield 序、Promise 契约违反）在纯 HEADLESS CI 中**不可复现**。

| 用途 | 模式 | 落地 |
|---|---|---|
| 吞吐 / 确定性算法 / 无 yield 重路径 | HEADLESS | Landed 用法 |
| yield-heavy / sleep 交织 / IRQ+Asyncify / 深调用链 | **至少一组**须 INTERACTIVE | **Planned**（CI 门禁未强制；评审纪律先行） |

证据与 Accuracy 正交说明见 [`11-accuracy-observation-lifecycle.md`](./11-accuracy-observation-lifecycle.md)。roadmap：[审阅闭环 C7](../../../implementation-plans/unisim/2026-08-02-unisim3-mechanisms-review-closure-plan.md)。

---

## 4. 共享内存与零拷贝数据读取

高频 I2C/UART 传输不拷贝字节，而是在 wasm 线性内存上建 `Uint8Array` 视图：

```javascript
// write_buf / read_buf 是 wasm 线性内存偏移（指针）
const writeView = new Uint8Array(Module.HEAPU8.buffer, write_buf, write_len);
bus.write(dev_addr, writeView);          // 同 Worker 同步切片
const readView  = new Uint8Array(Module.HEAPU8.buffer, read_buf, read_len);
readView.set(responseData);              // 回填
```

要点（见 [08](./08-channel-routing.md)、[10](./10-wasm-js-bridge-abi.md)）：

- 是**同 Worker 同步 Heap 切片** → `I2CBus`/`SPIBus`/`UARTBus` 插件解析器；**不是**跨线程 MessageChannel 零拷贝；
- 总线传输当前为同步语义（Phase 3 才做异步 DMA 窗口，见 C8）；
- Asyncify sleeping 期间 `HEAPU8` 视图可能指向陈旧内容——禁止在 sleeping 窗口读写堆（[10 ABI #6](./10-wasm-js-bridge-abi.md)）。

---

## 5. STRICT_NONBLOCKING 构建落地（怎么做）

> **为什么**（纪律动机、pragma 分类、业务回调禁令）见 [`../01-overview/04-methodology.md` §4](../01-overview/04-methodology.md#4-strict_nonblocking-与-bringup-隔离)。**调度器侧** WCET / LIGHT 上下文断言 / `app_loop` 纪律见 [`./03-scheduler-and-concurrency.md` §8](./03-scheduler-and-concurrency.md#8-strict_nonblocking-编译期门禁adr-0025)。规范依据：[ADR-0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md)。

### 5.1 CMake 默认与逃生口

`wink-micro-os/CMakeLists.txt` 对 **`wink_simulator` 的 App 源文件**（`WINK_APP_SOURCES`）默认开启严格非阻塞：

```cmake
# ADR-0017/0025 Stage 5: sim target defaults to STRICT_NONBLOCKING=1 for
# app source files. PAL sources are NOT affected (they implement the
# blocking APIs). Escape hatch: -DWINK_STRICT_NONBLOCKING=0.
set(WINK_STRICT_NONBLOCKING 1 CACHE STRING "Enable strict nonblocking for app sources")
if(WINK_STRICT_NONBLOCKING)
    set_source_files_properties(${WINK_APP_SOURCES} PROPERTIES
        COMPILE_DEFINITIONS WINK_STRICT_NONBLOCKING=1)
endif()
```

要点：

- **作用域**：仅 App 业务源；PAL/DAL 实现层**不受影响**（它们要实现阻塞 API 本体，供真机构建使用）。
- **链接期 fail-fast**：`-DWINK_STRICT_NONBLOCKING=1` 下，`WINK_BLOCKING` API（如阻塞式 `dal_ultrasonic_read`）在头文件中用 `#ifndef WINK_STRICT_NONBLOCKING` 包围而**消失**，App 误用 → **undefined reference**，而非在 Asyncify 下"静默跑起来"。
- **逃生口**：配置时传 `-DWINK_STRICT_NONBLOCKING=0` 可关闭（bringup 调试、过渡期单测等）；仿真与 CI 主路径**不得**默认关闭。

### 5.2 Bringup / Selftest 隔离

阻塞辅助工具置于 `wink-micro-os/runtime/selftest/`，文件级用 `#ifndef WINK_STRICT_NONBLOCKING` 包裹声明与实现（例：`wink_sim_ultrasonic_echo.h`）。严格模式下：

- selftest 主体**不编译进** `wink_simulator`；
- 对外仅留 stub 返回 `WINK_ERR_UNSUPPORTED`，防止阻塞代码进入仿真沙箱；
- bringup 仪器（GPIO 短路测试、超声波 echo 环回等）**不得**放在 `samples/common/` 或 App 源树中。

### 5.3 与 Asyncify / HEADLESS 的边界

STRICT_NONBLOCKING 是**编译期**防线，与 §2 Asyncify 挂起、§3 HEADLESS 快进正交：

- 合法 idle 路径：`pal_os_sleep_ms` → Asyncify（INTERACTIVE）或调度器内虚拟时钟跳跃（HEADLESS）；
- 非法路径：App/BAL 直接调用 `WINK_BLOCKING` DAL API → 严格构建下链接失败，而非依赖 Asyncify 让阻塞"看起来能跑"。


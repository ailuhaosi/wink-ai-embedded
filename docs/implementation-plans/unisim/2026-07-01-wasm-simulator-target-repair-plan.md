# wink_simulator wasm target 修复实施计划：接通 App 注入链路与 JS 桥接契约

| 项 | 内容 |
|----|------|
| 创建日期 | 2026-07-01 |
| 关联评审 | 无（本计划由 Phase 1.5 §4.3 wasm 烟测验证时发现的 broken build 触发） |
| 关联 ADR | [ADR-0002 双目标同源编译](../../decisions/unisim/0002-dual-target-compilation.md)（**契约本 phase 未兑现**）、[ADR-0012 契约诚实优于静默降级](../../decisions/core/0012-contract-honesty-over-silent-degradation.md) |
| 关联技术设计 | [04-wasm-simulation/01-wasm-sandbox-lifecycle.md](../../design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md)、[02-wink-micro-os/03-directory-architecture.md](../../design/02-wink-micro-os/03-directory-architecture.md) |
| 前置发现 | 见本文档 §0；触发 commit `baca3cf`（2026-06-24 "Wire wasm/host entry to runtime"）未同步顶层 CMake，导致 wasm build 从当天起持续 broken 至今 |
| 影响范围 | `wink-micro-os/CMakeLists.txt`（wasm 分支）、`wink-micro-os/samples/*/CMakeLists.txt`（wasm 目标定义）、`wink-micro-os/targets/wasm/wasm_entry.c`、可能新增 `wink-micro-os/targets/wasm/wink_sim_stub.js`（JS 桥接契约测试脚本）、docs/design/02/03/04 相关章节 |
| 预计工期 | 1~2 个工作日（若无 JS 侧联调需求）；含 JS 桥接 stub 与 Node 联调则 2~3 个工作日 |
| 当前状态 | **已完成**（2026-07-01；见文末落地记录） |
| 风险等级 | 中（修配置链路本身低风险；但激活 wasm build 后可能暴露之前未编译的 wasm 侧 C 代码回归） |

---

## 0. 为什么需要本计划

### 0.1 触发事件

Phase 1.5（`2026-07-01-pal-interrupt-phase1p5-gpio-prio-enforcement-plan.md`）§5 DoD §6 要求 "WASM 仿真烟测通过"。执行时：

1. 装好 emsdk 6.0.1，`emcmake cmake -DTARGET_PLATFORM=wasm` **configure 通过**。
2. `emmake cmake --build build-wasm` 在编译 `targets/wasm/wasm_entry.c` 时报：
   ```
   wasm_entry.c:17:10: fatal error: 'wink_app.h' file not found
       17 | #include "wink_app.h"
   ```
3. 逐层排查发现：
   - `wink_app.h` 实际位于 `wink-micro-os/runtime/include/`。
   - 顶层 `wink_simulator` target 定义（`wink-micro-os/CMakeLists.txt:86-90`）只 link `pal dal`，**不 link `wink_runtime`**，因此拿不到 runtime PUBLIC 导出的 `runtime/include`。
   - 即使加上 link，还会撞第二堵墙：`wasm_entry.c` 里 `extern wink_app_get_callbacks(void)` 需要**具体 App 提供实现**，但顶层 CMake 的 wasm 分支从未 `add_subdirectory` 任何 App 目录（host 分支才有，见 `CMakeLists.txt:106-131`）。

### 0.2 触发根因（git blame 层面）

- 2026-06-24 `baca3cf` "Wire wasm/host entry to runtime; add host e2e test"：把 `wasm_entry.c` 从"独立 main() + 内嵌逻辑"改为"依赖 `wink_runtime_run(cb, 0)` + 外部注入 App"。
- 该 commit 只改 `wasm_entry.c` + 加了 `test/test_app_e2e.c`；**没同步顶层 CMake 的 wasm 分支**。
- 之后所有开发都通过 `python wink-tools/wink.py test`（host build）验证，从没跑 `emcmake` 完整链路 → **broken 状态被"没人踩"藏了 7 天**。

### 0.3 与 ADR-0002 的关系

ADR-0002 "双目标同源编译" 明确要求：**wink-micro-os 的 C 代码必须能同时被 Emscripten/wasm32 与 ESP-IDF/xtensa 编译通过**。当前 wasm 侧不能通过 = 该 ADR 处于**违约状态**（虽然是隐性违约 —— 没人主动跑 wasm build）。本计划是补齐 ADR-0002 落地的必要工程。

### 0.4 现状盘点（2026-07-01 grep + 手工构建核验）

| 事项 | 现状 |
|------|------|
| `wink_simulator` 顶层定义 | `wink-micro-os/CMakeLists.txt:86-104` 定义 target，link 仅 `pal dal`，未 link `wink_runtime` |
| App 侧 wasm 打包 target | `samples/*/CMakeLists.txt` 只定义 host e2e 可执行（`add_executable(app_xxx_e2e ...)`），无 wasm target |
| `wasm_entry.c` 期望的符号 | `wink_app_get_callbacks(void)` —— 每个 App 的 `app_callbacks.c` 里都有定义 |
| Emscripten 编译器 | 本机已装 emsdk 6.0.1（`D:\software\embedded\emsdk`），`emcc`/`emcmake` 均可用 |
| `pal_hal_wasm.c` 单文件 | Phase 1.5 之后经 host `gcc -fsyntax-only` 与 emcc 单文件编译均通过，无回归 |
| 既有 warning（非本 phase 引入） | ① `-Wstack-usage=1536` 在 clang(emcc) 下 unknown；② `wasm_pin_power_model_t` 在 `wasm_bridge.h` 与 `pal_wasm_internal.h` 双 typedef（C11 warning） |
| `SIMULATION=1` 在 wasm 分支自动打开 | `CMakeLists.txt:14-16` 已保证 |
| JS 侧胶水层 | 本仓无（04-wasm-simulation 文档假设它在 Workbench/前端仓），故本 phase 只保证 "wasm build 产出正确 `.wasm+.js`"，不做 JS 侧运行时端到端 |

### 0.5 与 Phase 1.5 的边界

Phase 1.5 只做**PAL 中断子系统**（G3/G2）。本计划做的是"让 wasm target 首先可编译"——它是 Phase 1.5 DoD §6 兜底工程，**不改任何 PAL/DAL/runtime 语义**。二者独立提交、独立 review。

---

## 1. 任务清单

### Task 1: 打通 wasm build 编译链路（最小修复）

**目标**：`emcmake cmake -DTARGET_PLATFORM=wasm -DWINK_APP_DIR=<any_sample>` + `emmake cmake --build build-wasm` 能一路跑到 `.wasm + .js` 产出。

#### 1.1 `wink-micro-os/CMakeLists.txt` wasm 分支重写

现状（`CMakeLists.txt:80-104`）：
```cmake
if(TARGET_PLATFORM STREQUAL "wasm" AND EMSCRIPTEN)
    add_subdirectory(targets/wasm)
    add_executable(wink_simulator
        ${PAL_WASM_SOURCES}
        ${WASM_ENTRY_SOURCE}
        pal/src/pal_pwm_router.c
        pal/src/wink_dev_config.c)
    target_link_libraries(wink_simulator PRIVATE pal dal)   # ← 缺 wink_runtime
    target_include_directories(wink_simulator PRIVATE ${WASM_EXTRA_INCLUDE_DIRS})
    ...
endif()
```

改动：

1. **link `wink_runtime`**（一行改动）：解决 `wink_app.h` 找不到。
2. **引入 `WINK_APP_DIR` 语义（同 host 分支）**：`add_subdirectory(${WINK_APP_DIR})` 后由 App CMakeLists 提供 wasm target 或 App 源文件列表。默认值同 host 分支：`${CMAKE_CURRENT_SOURCE_DIR}/samples/avoidance_car`。
3. **App 源文件传递**：因为顶层 `add_executable(wink_simulator ...)` 需要 App 源，而 App CMakeLists 已经把源列表挂在 host e2e target 上，需要设计一个"App 源列表 SSOT"。方案见 Task 2。

#### 1.2 关键设计判断：App 源如何注入 wasm target

**外部计划可能提议**："在 `wink_simulator` 里直接 hard-code `samples/avoidance_car/*.c`"。**拒绝**该方案，理由：

| 问题 | 说明 |
|------|------|
| 违反 03-directory-architecture §6.1 约束 3 | 该约束要求"标准化 CMake 注入接口，通过 `WINK_APP_DIR` 指定，未指定则默认 avoidance_car"。硬编码违反此约束。 |
| 与 host 分支不对称 | host 分支通过 `add_subdirectory(${WINK_APP_DIR})` + App CMakeLists 定义 target 实现注入；wasm 若走硬编码则要维护两套注入机制，永远漂移。 |
| 不支持 codegen 生成的 App | AI 生成的 App 会写到某个用户目录，`WINK_APP_DIR=<path>` 是唯一注入通道。 |

**推荐方案**：**Option A — App CMakeLists 通过 PARENT_SCOPE 导出 `WINK_APP_SOURCES` 变量**（对齐 `targets/wasm/CMakeLists.txt` 的 `PAL_WASM_SOURCES` 模式）。

在每个 App 的 `samples/*/CMakeLists.txt` 里加：

```cmake
# 供 wasm target 消费（host e2e 已在下方各自 add_executable 消费）
set(WINK_APP_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/device_tree.c
    ${CMAKE_CURRENT_SOURCE_DIR}/app_callbacks.c
    PARENT_SCOPE)
```

逻辑：

```cmake
if(TARGET_PLATFORM STREQUAL "wasm" AND EMSCRIPTEN)
    add_subdirectory(targets/wasm)

    if(NOT DEFINED WINK_APP_DIR)
        set(WINK_APP_DIR ${CMAKE_CURRENT_SOURCE_DIR}/samples/avoidance_car)
    endif()
    message(STATUS "WINK_APP_DIR = ${WINK_APP_DIR}")
    add_subdirectory(${WINK_APP_DIR} ${CMAKE_BINARY_DIR}/app_build)

    add_executable(wink_simulator
        ${PAL_WASM_SOURCES}
        ${WASM_ENTRY_SOURCE}
        ${WINK_APP_SOURCES}                # ← 新增
        pal/src/pal_pwm_router.c
        pal/src/wink_dev_config.c)
    target_link_libraries(wink_simulator PRIVATE pal dal wink_runtime)   # ← +wink_runtime 解决头文件与符号依赖
    target_include_directories(wink_simulator PRIVATE
        ${WASM_EXTRA_INCLUDE_DIRS}
        ${CMAKE_CURRENT_SOURCE_DIR}/dal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/dal/include/input
        ${CMAKE_CURRENT_SOURCE_DIR}/dal/include/output
        ${CMAKE_CURRENT_SOURCE_DIR}/dal/include/actuator
        ${CMAKE_CURRENT_SOURCE_DIR}/dal/include/display
        ${CMAKE_CURRENT_SOURCE_DIR}/dal/include/sensor
        ${WINK_APP_DIR})                    # App 内部 header（如 device_tree.h）

    target_link_options(wink_simulator PRIVATE
        "-s" "ERROR_ON_UNDEFINED_SYMBOLS=0"                  # ← 新增：允许 C 代码中的 extern js_pal_* / js_sim_* 符号作为 WebAssembly imports 导入并由 JS 侧提供
        "-s" "ASYNCIFY=1"
        "-s" "ASYNCIFY_IMPORTS=['js_pal_os_sleep_ms','js_pal_os_busy_wait_us']"
        "-s" "EXPORTED_FUNCTIONS=['_main']"                  # _trigger_wasm_interrupt 已移除（方案 C：Poll 模型消除 Push 导出，见 wasm_entry.c）
        "-s" "EXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
        "-s" "MODULARIZE=1"
        "-s" "EXPORT_NAME='WasmSandbox'"
        "-s" "WASM_BIGINT=1"               # ADR-0009 Wave 2：64 位整型 ↔ JS BigInt 原生映射，杜绝 number 隐式失精
        "-s" "STACK_OVERFLOW_CHECK=2"      # dev/debug：栈溢出 abort，避免静默线性内存越界（亦为中断重入早期报警，见 plan Phase 1 Task 1-5）
        "-s" "ASSERTIONS=1"                # dev/debug：带运行时开销/体积代价，生产 profile 调优留作后续
        "-s" "ASYNCIFY_STACK_SIZE=65536")  # 起步值；最终须实测最深 AI 生成调用链（plan Task 1-4 清单第 6 项）
endif()
```

**理由**：App CMakeLists 保持"host e2e 定义"不动，只多导出一个变量；wasm target 消费该变量即可。零重复源列表、零硬编码。

**Option B（备选）**：让 App CMakeLists **自己 add_executable(wink_simulator_<app> ...)** 定义 wasm target。理由 pro：App 可以定制自己的 Emscripten flag（例如某 App 需要额外 `--preload-file`）；理由 con：EXPORTED_FUNCTIONS / MODULARIZE 等公共 flag 会散在每个 App，SSOT 破坏，未来 flag 升级要挨个改。

**Option C（资深专家推荐，作为后续重构备选）**：通过 CMake `OBJECT` 库传递源文件。
- App 侧 `add_library(wink_app_sources OBJECT ...)`，并挂载 `target_include_directories`。
- 顶层通过 `$<TARGET_OBJECTS:wink_app_sources>` 消费。
- **优点**：避免使用 `PARENT_SCOPE` 变量，符号与头文件路径通过 Target 隐式传播，更符合现代 CMake 最佳实践。
- **选择**：本计划由于需与 `PAL_WASM_SOURCES` 的既有设计（使用 `PARENT_SCOPE` 变量）保持一致，因此采用 **Option A**。

#### 1.3 处理 4 个既有 App 的 wasm 可编译性

| App | wasm 可编性风险 |
|-----|----------------|
| `avoidance_car` | 低。仅用 GPIO/PWM，全部经 PAL；device_tree.c 无平台特化。 |
| `oled_dashboard` | 中。用到 I2C + SSD1306 DAL；I2C 在 wasm 侧目前是 `js_sim_i2c_transfer` bypass 路径（见 `pal_hal_wasm.c`），需验证 DAL 层调用能编过。 |
| `devkitc_smoke` | **高**。这是裸板真机验证 sample，`test_devkitc_smoke_e2e.c` 引 `host_test_ctrl.h`（host-only），且业务逻辑本身设计给 ESP32 GPIO 用。**本 phase 不为其加 wasm 支持**，只在 CMakeLists 里保护性 gate（`if (NOT EMSCRIPTEN)` 包裹）。 |
| `smp_uaf_test` | **高**。SMP 双核 UAF 压力测试，只在 ESP32 上有意义。同上 gate 掉。 |

**具体做法**：给 `devkitc_smoke` 和 `smp_uaf_test` 的 CMakeLists 顶部直接加上明确的 `FATAL_ERROR` 硬拦截：

```cmake
if(EMSCRIPTEN)
    # 本 sample 面向真机验证 (SMP / hardware smoke)，wasm target 上无意义，直接硬报错拒绝配置。
    message(FATAL_ERROR "Sample '${CMAKE_PROJECT_NAME}' is a physical hardware/SMP test and is not supported on the WebAssembly simulator target.")
endif()
```

对于其它自定义 App，如果用户忘记导出 `WINK_APP_SOURCES`，则在顶层 CMakeLists 给出兜底的**清晰 fatal_error**：

```cmake
if(NOT DEFINED WINK_APP_SOURCES OR "${WINK_APP_SOURCES}" STREQUAL "")
    message(FATAL_ERROR "wasm target requires an app that exports WINK_APP_SOURCES; "
                        "'${WINK_APP_DIR}' did not. See docs/implementation-plans/scripts/README.md")
endif()
```

#### 1.4 处理既有 clang warning（非本 phase 引入）

- **根本解决 `-Wstack-usage` 的 Clang 不兼容问题**：由于 GCC 和 Clang 的警告参数不一致（Clang 使用 `-Wframe-larger-than=`，GCC 使用 `-Wstack-usage=`），且顶层 `CMakeLists.txt` 原逻辑对 Clang 误加了 `-Wstack-usage`，这会导致 `emcc` 报未知编译器选项错误。
- **解决方案**：重构顶层 `CMakeLists.txt` 对警告标志的判断（不再采用 wasm 分支中 `remove_definitions` 这种无法移除编译选项的 CMake 语法）：
  ```cmake
  if(CMAKE_C_COMPILER_ID STREQUAL "GNU")
      add_compile_options(-Wstack-usage=${WINK_STACK_USAGE_LIMIT})
  elseif(CMAKE_C_COMPILER_ID STREQUAL "Clang")
      add_compile_options(-Wframe-larger-than=${WINK_STACK_USAGE_LIMIT})
  endif()
  ```
- **解决 `wasm_pin_power_model_t` 重复 typedef 问题**：在 `wasm_bridge.h:203` 移除重复的 `typedef`，改用前向声明 `struct wasm_pin_power_model_t;`，并调整接口参数类型以对齐 C99 严格模式（避免在 C99 标准下重复 typedef 导致的编译报错）。

#### 1.5 验收

- ✅ `emcmake cmake -S wink-micro-os -B build-wasm -DTARGET_PLATFORM=wasm` configure 通过。
- ✅ `cmake --build build-wasm` 全绿到 `wink_simulator.wasm + wink_simulator.js` 产出。
- ✅ 默认（不指定 `WINK_APP_DIR`）产出 `avoidance_car` 变体。
- ✅ `-DWINK_APP_DIR=samples/oled_dashboard` 也产出对应变体。
- ✅ `-DWINK_APP_DIR=samples/smp_uaf_test` 给出**清晰的 fatal_error** 而不是隐晦的 link 失败。
- ✅ host build（`python wink-tools/wink.py test`）保持全绿。

**预计工时**：0.5~1 天

---

### Task 2: 验证 Phase 1.5 pal_hal_wasm.c 改动在 wasm build 下无回归

**目标**：Phase 1.5 §5 DoD §6（WASM 烟测）可以打钩。

#### 2.1 具体验证项

Task 1 打通编译链路后，实际过一遍：

1. **完整 wasm build**（`avoidance_car`）：确认 `pal_hal_wasm.c` 里 Phase 1.5 加入的 G3 首次锁定 + REALTIME 拒接分支在 emcc 下编过、no warning、no error。
2. **objdump 检查符号**：
   ```powershell
   D:\software\embedded\emsdk\upstream\bin\wasm-objdump.exe -x build-wasm/wink_simulator.wasm | Select-String "pal_gpio_enable_interrupt_ex|pal_irq_enable"
   ```
   确认符号存在。
3. **静态分析双 target 契约一致性**：`grep` 三 target `pal_hal_*.c` 的 REALTIME 拒接/GPIO prio 锁定分支，肉眼确认三份控制流对齐。（Phase 1.5 里已经验证过，此处仅作最终 checkpoint。）

**明确不做**：

- ❌ **不做**运行时 JS 端到端测试（需要 Workbench 前端仓的 JS 胶水层，`04-wasm-simulation/01-wasm-sandbox-lifecycle.md` §2.2.2 涉及）。
- ❌ **不做**在 Node.js 里 `.js` glue 起 wasm 跑 avoidance_car —— MODULARIZE=1 + Asyncify 要求 JS 侧提供 `js_pal_delay_ms` 等 import 的真实实现，不在本仓范围。

#### 2.2 轻量 Node stub 联调（核心验证，必做）

为验证 `Asyncify` 在运行时没有栈溢出，且 JS-WASM 接口签名完全匹配，必须在本仓添加轻量级本地运行桩 `wink-micro-os/targets/wasm/wink_sim_stub.js`，提供完整的 `js_pal_*` / `js_sim_*` mock 实现。这能在 CI 与本地极大缩短调试反馈弧。

在 `wink-micro-os/targets/wasm/wink_sim_stub.js` 中编写如下内容：

```javascript
// D:\workspaces\ai-coding\wink-ai\wink-ai-embedded\wink-micro-os\targets\wasm\wink_sim_stub.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 加载 Emscripten 编译生成的 JS 胶水代码
const WasmSandbox = require('../../build-wasm/wink_simulator.js');

// 准备导入的 JS 桩函数（对应 wasm_bridge.h 的 13 个接口）
const imports = {
    // PAL OSAL
    js_pal_os_sleep_ms: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
    js_pal_os_busy_wait_us: (us) => {},
    js_pal_os_get_ms: () => BigInt(Date.now()),
    js_pal_os_get_us: () => BigInt(Date.now() * 1000),

    // PAL HAL
    js_pal_gpio_write: (pin, level) => {
        console.log(`[JS Stub] GPIO Write: Pin ${pin} -> ${level}`);
    },
    js_pal_gpio_read: (pin) => {
        return false;
    },
    js_pal_pwm_set_duty: (channel, duty) => {
        console.log(`[JS Stub] PWM Set Duty: Channel ${channel} -> ${duty}%`);
    },
    js_pal_i2c_transfer: (port, addr, wbuf, wlen, rbuf, rlen) => {
        return true;
    },
    js_pal_register_interrupt: (pin, callback_index, arg_ptr) => {
        console.log(`[JS Stub] Register Interrupt: Pin ${pin}, Callback Index ${callback_index}`);
    },
    js_pal_deregister_interrupt: (pin) => {
        console.log(`[JS Stub] Deregister Interrupt: Pin ${pin}`);
    },
    js_pal_poll_interrupt: (out_callback_index, out_arg_ptr) => {
        return false; // 无 pending 中断
    },

    // DAL bypass
    js_sim_trigger_ultrasonic: (trig_pin) => {},
    js_sim_measure_echo_pulse_us: (trig_pin) => 1000,
};

async function run() {
    console.log("Starting WASM Simulator Node Stub...");
    const instance = await WasmSandbox({
        ...imports
    });
    
    // 运行一段时间后退出，验证没有运行时崩溃或 Asyncify 挂起死锁
    setTimeout(() => {
        console.log("WASM Simulator Node Stub finished successfully (no crash).");
        process.exit(0);
    }, 500);
}

run().catch((err) => {
    console.error("WASM Simulator crashed:", err);
    process.exit(1);
});
```

用 `node --experimental-wasm-bigint targets/wasm/wink_sim_stub.js` 运行。
成功退出 = 运行时烟测通过。

**预计工时**：0.5 天

---

### Task 3: 文档回写

#### 3.1 必须同步更新的文档

| 文档 | 修改点 |
|------|--------|
| `docs/design/02-wink-micro-os/03-directory-architecture.md` §6.1 | 把"标准化 CMake 注入接口"扩展为"host + wasm 双分支都通过 `WINK_APP_DIR` + `WINK_APP_SOURCES` 变量对齐注入"，补 wasm 例子。 |
| `docs/design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md` §1.2 | 明示 wasm build 产出物（`wink_simulator.wasm + .js`）的构建入口和 App 注入方式，避免下次找不到。 |
| `docs/tech-designs/unisim/2026-07-20-co-simulation-plugin-contract.md` §5 DoD §6 | 从"⚠️ 本机 emcc 未装" 更新为"✅ 已通过 Task 1 补齐 wasm build 后，pal_hal_wasm.c 无回归"（引用本计划）。 |
| `wink-micro-os/README.md` §3.1 | 补一段"WINK_APP_DIR 参数化"的例子，与 host 分支的说明对齐。 |
| （可选）新增 ADR-IRQ-XXX 或 单独 note | 记录 "App 源列表通过 PARENT_SCOPE 变量注入" 的模式，便于未来其它 target 复用。**推荐先不立**，直到出现第三个消费者（如 STM32 target）再抽象。 |

**不需要**新立顶层 ADR：本计划纯配置修复，不涉及跨子系统决策。

**预计工时**：0.5 天

---

### Task 4: CI / 回归防护

#### 4.1 加 wasm build 到 CI（若有 CI）

当前仓库无 CI 配置（`.github/workflows/` 不存在）。若未来接入 CI，加一个 job：

```yaml
- name: WASM build smoke
  run: |
    ./emsdk/emsdk_env.sh
    cd wink-micro-os
    emcmake cmake -B build-wasm -DTARGET_PLATFORM=wasm
    emmake cmake --build build-wasm
    test -f build-wasm/wink_simulator.wasm
```

**本 phase 不主动新增 CI**（那属于独立议题），但**必须**在 `python wink-tools/wink.py test` 或 README 里加一段引导：

```powershell
# 可选：wasm 烟测（需要 emsdk）
& 'D:\software\embedded\emsdk\emsdk_env.ps1'
emcmake cmake -S . -B build-wasm -DTARGET_PLATFORM=wasm
cmake --build build-wasm
```

#### 4.2 防止未来"link 但没 add_subdirectory App"再次回归

在顶层 `wink_simulator` 定义后加 CMake 语言级断言：

```cmake
get_target_property(_link_libs wink_simulator LINK_LIBRARIES)
if(NOT "wink_runtime" IN_LIST _link_libs)
    message(FATAL_ERROR "wink_simulator must link wink_runtime; wasm_entry.c depends on wink_runtime_run()")
endif()
```

这是一份"活文档式契约"—— 只要有人以后误删 `wink_runtime` 依赖，configure 阶段就直接爆。

**预计工时**：0.5 天

---

## 2. 提交结构（CLAUDE.md 原子提交原则）

| # | Commit | 内容 |
|---|--------|------|
| 1 | `fix(cmake): wire wink_simulator to wink_runtime and WINK_APP_DIR injection` | Task 1.1/1.2/1.3 — CMakeLists.txt + 4 个 samples/*/CMakeLists.txt + `EMSCRIPTEN` gate 与错误提示 |
| 2 | `fix(cmake): silence clang-incompatible warnings on wasm target` | Task 1.4 — 顶层 Clang 选项重构 + `wasm_pin_power_model_t` 前向声明修复 |
| 3 | `test(wasm): add node stub and CMake assertions for regression check` | Task 2.2 Node stub 脚本 + Task 4.2 CMake 契约断言 + README 引导 |
| 4 | `docs(wasm): backport WINK_APP_DIR injection contract to §6.1/§04-01` | Task 3 全部文档 |

---

## 3. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| App 源列表变量 `WINK_APP_SOURCES` 与 host e2e target 的源列表漂移 | 中 | 中 | Task 1.2 把 App CMakeLists 里的源列表**用一个变量集中定义**，host e2e 与 wasm 都从它取；后续新增 App 的 skill/codegen 强制覆盖此模式 |
| Emscripten 版本升级导致 `-s XXX` flag 语法变化 | 低 | 低 | 顶层 CMakeLists 里的 flag 集中，一处修改；本 phase 用 emsdk 6.0.1（用户已装）作为基线 |
| `pal_hal_wasm.c` Phase 1.5 改动在 emcc/clang 下暴露隐藏警告（例如 `-Werror=implicit-int-conversion`） | 低 | 低 | 已单文件 emcc 编过；Task 1 是完整链路首次通过，若有新 warning 现场修 |
| `oled_dashboard` 在 wasm build 下 link 失败（SSD1306 DAL 依赖 I2C，I2C wasm 侧走 bypass） | 中 | 低 | Task 2.1 完整验证；若确定不能 link，视为**新的欠债**，独立处理不阻塞 avoidance_car 落地 |
| Node stub 导入接口与 `wasm_bridge.h` 契约漂移 | 低 | 低 | Node stub 作为 CI / 本地测试门禁强制执行，漂移会在测试阶段直接报错，倒逼开发者对齐 |
| 未来接入真 JS 胶水（Workbench 前端仓）时发现 wasm 侧 export 集合不对 | 中 | 中 | 本计划保留 `EXPORTED_FUNCTIONS=['_main']` + `EXPORTED_RUNTIME_METHODS=['ccall','cwrap']`，与 `04-wasm-simulation/01-...` 现有文档保持一致；一旦联调发现缺 export，追加即可，不影响本 phase 落地 |

---

## 4. 不在本计划范围（明确边界）

- ❌ **不做** JS 侧 Asyncify 胶水层（`04-wasm-simulation/01-...` §2.2.2 涉及），那在 Workbench 前端仓。
- ❌ **不做** UniSim (`../../../../wink-ai/packages/unisim/src/unisim/`) 与 wasm 沙箱的桥接 —— UniSim 目前是纯 TS 引脚仲裁子系统，Phase 3+ 才会接入 wasm runtime。
- ❌ **不做** ESP32 侧 wasm-related 改动（`esp32_firmware/` 与本 phase 无交集）。
- ❌ **不动** `pal_hal_wasm.c` 的业务逻辑（Phase 1.5 已定型，本 phase 只保证它可被编译）。
- ❌ **不新立** wasm_simulator 独立子目录（`docs/design/02-.../03-directory-architecture.md` §16 提到过；那是长期路线，本 phase 是短期 unblock）。
- ❌ **不做** 完整浏览器端到端仿真 —— 那需要 Workbench 前端；本 phase 交付物是"可以给 Workbench 的 wasm 二进制"。

---

## 5. 验收标准（Definition of Done）

Phase 完成的标志：

1. ✅ `emcmake cmake -S wink-micro-os -B build-wasm -DTARGET_PLATFORM=wasm` configure 无 error。
2. ✅ `cmake --build build-wasm` 从零到 `wink_simulator.wasm + wink_simulator.js` 全绿，含默认 App（avoidance_car）。
3. ✅ `-DWINK_APP_DIR=<samples/oled_dashboard>` 亦产出对应变体（若确认 oled_dashboard 可编）；若不可编，作为 §3 风险表列出的"新欠债"独立跟踪。
4. ✅ `-DWINK_APP_DIR=<samples/smp_uaf_test>` 给出明确的硬件/SMP不支持 `FATAL_ERROR`，阻止 configure 阶段。
5. ✅ host build（`python wink-tools/wink.py test`）保持 24/24 通过（含 Phase 1.5 的 27 个 test_pal_irq 用例），无回归。
6. ✅ CMakeLists 里的"wink_simulator 必须 link wink_runtime"契约断言就位。
7. ✅ 通过 Node stub 执行 `wink_simulator.js` 验证运行时没有崩溃或 Asyncify 挂起死锁。
8. ✅ 文档回写完成（§3.1 五处）。
9. ✅ Phase 1.5 §5 DoD §6 从"⚠️ 本机 emcc 未装"更新为"✅ 通过（引用本 phase）"。
10. ✅ 每个 commit 独立可 review、可回滚。

---

## 6. 时间线

| 工作日 | Task | 输出 |
|--------|------|------|
| Day 1 上午 | Task 1.1/1.2/1.3 CMakeLists 注入打通与 Sample Gate | wasm configure 级硬拦截通过 |
| Day 1 下午 | Task 1.4 Clang/GCC 警告规避 + `wasm_pin_power_model_t` 前向声明 | wasm 纯编译阶段无 Warning 产出 |
| Day 2 上午 | Task 2.2 Node stub 编写与本地运行时烟测集成 | 验证 Asyncify stack 及 JS 接口未崩溃 |
| Day 2 下午 | Task 3 文档回写 + Task 4.1/4.2 CMake 契约与 README 引导 | 完整文档同步，交付 wasm 二进制门禁 |

---

## 附录 A：完整的最小 wasm build 命令（本机 Windows PowerShell）

```powershell
# 一次性激活 emsdk（本机路径）
$env:EMSDK_QUIET = '1'
& 'D:\software\embedded\emsdk\emsdk_env.ps1'

# WinLibs mingw32-make 加进 PATH（emcmake 默认生成 MinGW Makefiles）
$env:PATH = "C:\Users\77174\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;$env:PATH"

# 构建
cd d:\workspaces\ai-coding\wink-ai\wink-ai-embedded\wink-micro-os
if (Test-Path build-wasm) { Remove-Item -Recurse -Force build-wasm }
emcmake cmake -S . -B build-wasm -DTARGET_PLATFORM=wasm
cmake --build build-wasm

# 验证产出
ls build-wasm\wink_simulator.wasm, build-wasm\wink_simulator.js
& 'D:\software\embedded\emsdk\upstream\bin\wasm-objdump.exe' -x build-wasm\wink_simulator.wasm | Select-String "pal_gpio_enable_interrupt_ex|pal_irq_enable"

# 运行 Node.js 烟测
node --experimental-wasm-bigint targets/wasm/wink_sim_stub.js
```

---

## 附录 B：与其它计划的关系

- **Phase 1.5**（`2026-07-01-pal-interrupt-phase1p5-gpio-prio-enforcement-plan.md`）：Phase 1.5 §5 DoD §6 依赖本 phase 完成。本 phase 是 Phase 1.5 的**兜底工程**，不改任何 Phase 1.5 语义。
- **Phase 2 中断子系统重构**（`2026-06-30-pal-unified-interrupt-subsystem-implementation-plan.md`）：与本 phase 无直接依赖，但 Phase 2 的"TU 拆分"若涉及 `pal_hal_wasm.c` 拆文件，需在本 phase 之后跑一次 wasm build 回归。
- **ADR-0002 双目标同源编译**：本 phase 从"隐性违约"（wasm build 不通）变为"显式兑现"（wasm build 通过），补齐 ADR-0002 的 CI 门禁基础。
- **04-wasm-simulation 长期路线**：本 phase 是 04-wasm-simulation 长期路线（Web Worker + Asyncify + UniSim 三层集成）的**最底层不动脚手架**。有了它，未来 Workbench 前端仓才有 wasm 二进制可以接。

---

## 附录 C：落地记录（2026-07-01）

Plan 全部 Task 已实施完成。5 个原子 commit 对应关系：

| # | Commit | 覆盖 Task | 说明 |
|---|--------|-----------|------|
| 1 | `1f76f99` | Task 1.4 | 顶层 CMake 按 `CMAKE_C_COMPILER_ID` 分派 `-Wstack-usage`（GCC）/ `-Wframe-larger-than`（Clang），并移除 `wasm_bridge.h` 与 `pal_wasm_internal.h` 中 `wasm_pin_power_model_t` 的重复 typedef（改为纯 struct 前向声明）。 |
| 2 | `2cf023a` | Task 1.1 + 1.2 | 顶层 CMake wasm 分支 link `wink_runtime`、经 `WINK_APP_DIR` `add_subdirectory` 消费 `WINK_APP_SOURCES`（Option A）；顶层兜底 `FATAL_ERROR` 提示未导出的情况。 |
| 3 | `f3723d4` | Task 1.3 | `samples/avoidance_car/` + `samples/oled_dashboard/` `set(WINK_APP_SOURCES ... PARENT_SCOPE)` 后 `if(EMSCRIPTEN) return()`；`samples/devkitc_smoke/` 与 `samples/smp_uaf_test/` 在 `EMSCRIPTEN` 下直接 `FATAL_ERROR`。 |
| 4 | `bd84ea8` | Task 2.2 | 新增 `targets/wasm/wink_sim_js.js`（emcc `--js-library` 桩）+ `targets/wasm/wink_sim_stub.js`（Node worker_thread 烟测）；顶层 CMake 加 `--js-library` + `LINK_DEPENDS`。 |
| 5 | `99bd80b` | Task 4.2 | 顶层 CMake configure-time 契约断言："wink_simulator 必须 link wink_runtime"，防历史回归（`baca3cf` broken 7 天）复现。 |
| 6 | `faf8739` | Task 3 全部 | 文档回写：`02-.../03-directory-architecture §6.1`（扩到 host+wasm 双路径 + JS 桥接 SSOT + build 期兜底）、`04-.../01-wasm-sandbox-lifecycle §1.3/§1.4/§2.2.2`（wasm build 产出/Node stub 契约/宿主是"覆盖"而非"新增"）、`README §3.1`、Phase 1.5 DoD §6 `⚠️→✅`。 |
| 7 | `4605665` | Task 2.2 强化 | Stub 支持 `--build-dir=<path>` / `WINK_BUILD_DIR` / 位置参数切换构建目录；imports 校验从 avoidance_car 硬编码改为 `wasm_bridge.h` 全集子集检查（超集 → fail、DCE → warn），支持任意 App 变体。 |

### 与 plan 的关键偏离（诚实报告）

1. **Task 2.2 stub 设计**：plan §2.2 提议的 `Module.js_pal_* = customImpl` 顶层覆盖方案对 **Emscripten 6.x 无效**——emcc 会把每个未由 `--js-library`/`--pre-js` 注册的 `js_*` 编译成 `abort('missing function: ...')`，Module 顶层 property 不会被 wasm-loader wire。改成 `--js-library` 提供**默认实现** + 宿主 `Module.js_* = ...` **覆盖**（而非新增）的双层设计。该修正已回写到 `04-.../01-wasm-sandbox-lifecycle §2.2.2` 与 `02-.../03-directory-architecture §6.1.4`。
2. **Task 2.2 stub 隔离**：plan §2.2 里的 stub 直接在主线程 `require` emscripten 胶水；实测 Node 主线程 event loop 与 Asyncify unwind→rewind 循环无法共存（`setTimeout(resolve, 10ms)` + rewind 同步链在事件循环里形成 tight loop，长跑内 OOM）。改为 `worker_threads.Worker` 隔离。该发现同样适用于浏览器——Workbench 前端**必须**用 Web Worker，主 UI 线程不能 host wasm；已写进 `04-.../01-wasm-sandbox-lifecycle §1.4/§2.2.2` 第 4 条契约。
3. **未纳入 CI**：plan §4.1 明确说本 phase 不主动加 CI（仓库无 `.github/workflows/`），仅在 README 加了引导命令。保持原判定。

### DoD 逐条核验

| # | DoD | 状态 |
|---|-----|------|
| 1 | `emcmake configure` 无 error（默认 App） | ✅ avoidance_car + oled_dashboard 均已实测 |
| 2 | `cmake --build` 到 `.wasm+.js`（默认 App） | ✅ 两 variant 均全绿 |
| 3 | `-DWINK_APP_DIR=samples/oled_dashboard` 变体 | ✅ imports 组合从 avoidance_car 的 pwm+ultrasonic 5 个变为 oled 的 gpio+i2c 5 个，Node stub PASS |
| 4 | `-DWINK_APP_DIR=samples/smp_uaf_test` 明确 `FATAL_ERROR` | ✅ commit f3723d4；同一 gate 保护 `devkitc_smoke` |
| 5 | host `python wink-tools/wink.py test` 24/24 保持全绿 | ✅ 未引入回归 |
| 6 | "wink_simulator 必须 link wink_runtime" configure-time 契约 | ✅ commit 99bd80b |
| 7 | Node stub 无崩溃 / 无 Asyncify 挂起死锁 | ✅ 两 variant `onRuntimeInitialized` 到达 + 200ms post-init 存活 |
| 8 | §3.1 五处文档回写 | ✅ commit faf8739（03-directory-architecture、04-wasm-sandbox-lifecycle、README、phase1p5 DoD、加 commit 4605665 里 README 的 stub 用法微调） |
| 9 | Phase 1.5 §5 DoD §6 `⚠️→✅` | ✅ commit faf8739 |
| 10 | 每 commit 独立可 review、可回滚 | ✅ 5+2 个 commit 各司其职，无跨 Task 混合 |

Plan 归档。后续与 wasm 相关的新 phase 应基于 04-wasm-simulation 长期路线设计新 plan，不再回撞本 phase 的脚手架。


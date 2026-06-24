# wink-micro-os

`wink-micro-os` 是为 **Wink-AI 低代码平台** 打造的跨平台嵌入式硬件运行时框架。它集成了 **PAL（平台抽象层）** 与 **DAL（器件抽象层）**，旨在通过“业务语义级 API”支持图形化/AI 自动生成的业务逻辑在 **Web 浏览器沙箱 (Wasm)** 与 **实体物理微控制器 (ESP32/STM32等)** 之间的无缝切换与同源执行。

---

## 1. 核心架构分层

内核采用 **Ports & Adapters（A\*）** 架构：`pal`（纯契约 INTERFACE）← `dal` ← `runtime` + `trace`（两横切一等 peer 层），`targets/`（wasm/host/esp32）为适配器端口，App/BAL 仅 link 公共 include 面。

```
┌────────────────────────────────────────────────────────┐
│      App（AI 生成）/ BAL（独立仓）                      │
├────────────────────────────────────────────────────────┤
│  runtime（回调注入主循环） + trace（Golden Trace） ◄ peer 一等层
├────────────────────────────────────────────────────────┤
│      2. 器件抽象层 (DAL - Device Abstraction Layer)    │
├────────────────────────────────────────────────────────┤
│      3. 平台抽象层 (PAL - INTERFACE 契约，无 .c)        │
├────────────────────────────────────────────────────────┤
│  targets/：wasm 仿真 / host 一等 target / esp32 真机    │
└────────────────────────────────────────────────────────┘
```

1. **BAL / App (应用逻辑层)**：由低代码编排生成的业务逻辑。它经 `wink_app_callbacks_t` 回调注入 runtime，并调用 DAL 暴露的只读/只写业务 API，不对接任何底层的 I2C/GPIO 硬件。
2. **runtime + trace**：一等 peer 层。`runtime` 用回调注入跑协作式主循环（无 `extern app_*` 强依赖，二进制解耦）；`trace` 用静态环形缓冲记录故障（零动态分配）。DAL/PAL 驱动**禁**直接调 `wink_trace_*`，故障捕获收敛在 App 回调。
3. **DAL (器件抽象层)**：管理具体的传感器和执行器（如超声波测距仪、舵机、温湿度计）。
   * **双模运行能力**：在仿真模式下，DAL 驱动仅旁路最底层物理信号来源（trigger 时序、echo 脉宽），换算与超时判定两端同源；在真机模式下，它调用 PAL 接口操作物理引脚。
4. **PAL (平台抽象层)**：纯契约 INTERFACE 库（仅头、无符号）。统一包装跨平台的操作系统服务（OSAL，任务与微秒定时器）与硬件总线控制（HAL，如 GPIO, PWM, I2C）。所有实现下沉到 `targets/`。
5. **Targets (平台适配器)**：具体平台的 PAL 实现端口（wasm/host/esp32）。host 为一等 target，供 PC 上跑完整 PAL→DAL→runtime→App 测试。

---

## 2. 目录架构说明

本仓库按组件化结构组织（A\* 架构，详见 [03-directory-architecture.md](../docs/design/02-wink-micro-os/03-directory-architecture.md)）：

```text
wink-micro-os/
├── CMakeLists.txt              # 顶层：TARGET_PLATFORM 路由 · WINK_APP_DIR 注入 · 层库聚合
├── run-tests.ps1               # host 测试一键脚本（见 §3.3）
├── pal/                        # 平台抽象层 (INTERFACE 契约库，仅头无 .c)
│   └── include/  pal.h · wink_status.h · pal_hal.h · pal_osal.h
├── dal/                        # 器件抽象层 (STATIC，两端同源)
│   ├── include/  dal_ultrasonic.h · dal_servo.h
│   └── src/      dal_ultrasonic.c · dal_servo.c
├── runtime/                    # OS 运行时 (STATIC，回调注入主循环)
│   ├── include/  wink_app.h · wink_runtime.h
│   └── src/      wink_runtime.c
├── trace/                      # Golden Trace (STATIC，静态环形缓冲)
│   ├── include/  wink_trace.h
│   └── src/      wink_trace.c
├── targets/                    # 平台适配端口
│   ├── wasm/     pal_hal_wasm.c · pal_osal_wasm.c · wasm_bridge.h · wasm_entry.c
│   ├── host/     pal_hal_host.c · pal_osal_host.c   # 一等 target，吸收旧 host 桩
│   └── esp32/    pal_hal_esp32.c · pal_osal_esp32.c · esp32_entry.c (骨架)
├── test/                       # host 单元/端到端测试 (Unity)
│   ├── unity/    unity.{c,h} + unity_internals.h
│   ├── stubs/    host_test_ctrl.h · js_sim_host_stub.{c,h}
│   └── test_*.c
└── samples/avoidance_car/      # 示例 App（device_tree + app_main）
```

---

## 3. 构建与编译说明

项目使用 CMake 构建，通过传入 `-DTARGET_PLATFORM` 参数静态绑定编译目标。

### 3.1 编译为 WebAssembly 仿真组件
使用 Emscripten 工具链进行编译，生成 Wasm 字节码供 Web 端 Worker 线程载入：
```bash
mkdir build_wasm && cd build_wasm
emcmake cmake -DTARGET_PLATFORM=wasm ..
emmake make
```

### 3.2 编译为 ESP32 真机固件
作为 ESP-IDF 工程的组件 (Component) 引入：
```bash
idf.py build
```
> esp32 目前为骨架（ROADMAP），完整 ESP-IDF 移植待后续。

### 3.3 在本机（host）构建并运行测试

内核各层与端到端链路可在 **PC 上用 gcc + cmake 跑测试**（无需真实硬件 / 浏览器），用 Unity 框架。这是日常开发最快的验证回路。

**前置：安装工具链。** 需要 gcc 与 cmake。本机推荐经 winget 安装 WinLibs MinGW（自带 gcc 16.1.0 + cmake 4.3.2）：

```powershell
winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e
# 安装后 gcc/cmake 进入 User PATH；若新窗口未识别，重启电脑使其生效。
gcc --version   # 验证可用
```

**方式一：一键脚本（推荐）。** 在 `wink-micro-os/` 目录下：

```powershell
.\run-tests.ps1            # 增量构建 + 跑全部测试
.\run-tests.ps1 -Clean     # 删 build-test 全量重编（改了 CMake 时用）
.\run-tests.ps1 -Detailed  # 打印每个测试的完整 Unity 输出
```

**方式二：手动三步。**

```powershell
cd wink-micro-os
cmake -B build-test -DTARGET_PLATFORM=host
cmake --build build-test
cd build-test; ctest --output-on-failure
```

看到 `100% tests passed` 即通过。只跑某项：`ctest -R servo --output-on-failure`；直接看单个 exe 输出：`.\test\test_dal_servo.exe`。

**测试矩阵（8 个可执行，约 30 个测试点）：**

| 测试 | 验证 |
|---|---|
| `test_smoke` | `wink_status_t` 错误码语义（负数=错误） |
| `test_trace` | Golden Trace 环形缓冲（满则覆盖） |
| `test_runtime` | 主循环：注册回调 → 跑 N tick → fault 上报 |
| `test_host_pal` | host 虚拟时间推进 + PWM 记录 |
| `test_dal_servo` | 舵机角度→占空比换算、钳位 |
| `test_dal_ultrasonic` | 超声波真机分支：脉宽→距离、超时 |
| `test_dal_ultrasonic_sim` | 仿真分支与真机同源换算（ADR-0003 守卫） |
| `app_avoidance_car_e2e` | 端到端 PAL→DAL→runtime→App（注入障碍→舵机偏转） |

> `build-test/` 为构建产物，**不提交 git**。

---

## 4. 编码规范契约
* **函数命名**：统一使用小写蛇形命名 `dal_[device]_[action]` / `pal_[bus]_[action]` / `wink_[layer]_[action]`。
* **错误码**：所有可能失败的函数返回 `wink_status_t`（`int32_t`，0=`WINK_OK`，负=错误）；判定用 `if (status < 0)`，**禁** `if (status)`（负数在 C 中为真）。详见 [ADR-0001](../docs/design/decisions/0001-error-code-sign-convention.md)。
* **时序与延时**：在 DAL 实现中，非阻塞场景必须使用 OSAL 提供的 `pal_get_us()` 计算时间差；阻塞式微秒延时统一调用 `pal_delay_us()`。
* **仿真条件分支**：`#ifdef SIMULATION` 只旁路最底层物理信号来源（如 trigger 时序、echo 脉宽），换算与超时判定两端同源（ADR-0003）。详见 [.claude/rules/c-code.md](../.claude/rules/c-code.md)。

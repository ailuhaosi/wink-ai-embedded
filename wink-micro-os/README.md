# wink-micro-os

`wink-micro-os` 是为 **Wink-AI 低代码平台** 打造的跨平台嵌入式硬件运行时框架。它集成了 **PAL（平台抽象层）** 与 **DAL（器件抽象层）**，旨在通过“业务语义级 API”支持图形化/AI 自动生成的业务逻辑在 **Web 浏览器沙箱 (Wasm)** 与 **实体物理微控制器 (ESP32/STM32等)** 之间的无缝切换与同源执行。

---

## 1. 核心架构分层

系统采用严格的三层解耦架构设计，从上到下依次为：

```
┌────────────────────────────────────────────────────────┐
│      1. 应用逻辑层 (BAL - Business App Layer)          │
├────────────────────────────────────────────────────────┤
│      2. 器件抽象层 (DAL - Device Abstraction Layer)    │
├────────────────────────────────────────────────────────┤
│      3. 平台抽象层 (PAL - Platform Abstraction Layer)  │
└────────────────────────────────────────────────────────┘
```

1. **BAL (应用逻辑层)**：由低代码编排生成的业务逻辑。它仅调用 DAL 暴露的只读/只写业务 API，不对接任何底层的 I2C/GPIO 硬件。
2. **DAL (器件抽象层)**：管理具体的传感器和执行器（如超声波测距仪、舵机、温湿度计）。
   * **双模运行能力**：在仿真模式下，DAL 驱动会跳过底层总线时序，直通 Web 前端以获得高吞吐的物理状态；在真机模式下，它调用 PAL 接口操作物理引脚。
3. **PAL (平台抽象层)**：统一包装跨平台的操作系统服务（OSAL，任务与微秒定时器）与硬件总线控制（HAL，如 GPIO, PWM, I2C, SPI）。
4. **Targets (平台适配器)**：具体硬件厂商的 SDK 适配实现。通过 CMake 静态链接，零运行期跳转开销。

---

## 2. 目录架构说明

本仓库按组件化结构组织，结构如下：

```text
wink-micro-os/
├── CMakeLists.txt              # 根 CMake 配置文件
├── pal/                        # 平台抽象层组件 (Platform Abstraction Layer)
│   ├── CMakeLists.txt          # PAL 组件构建配置
│   └── include/
│       ├── pal_hal.h           # 通用硬件总线抽象 API (GPIO/I2C/PWM等)
│       └── pal_osal.h          # 操作系统抽象 API (延时/定时器/线程等)
├── dal/                        # 器件抽象层组件 (Device Abstraction Layer)
│   ├── CMakeLists.txt          # DAL 组件构建配置
│   └── include/
│       ├── dal_ultrasonic.h    # 超声波传感器逻辑接口
│       └── dal_servo.h         # 舵机控制器逻辑接口
└── targets/                    # 针对不同平台的适配层实现
    ├── wasm/                   # 浏览器 WASM 仿真环境适配实现
    │   └── pal_hal_wasm.c
    ├── esp32/                  # ESP32 板卡物理绑定实现 (基于 ESP-IDF)
    └── stm32/                  # STM32 板卡物理绑定实现 (基于 STM32 HAL)
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

---

## 4. 编码规范契约
* **函数命名**：统一使用小写蛇形命名 `vdl_[device]_[action]` / `pal_[bus]_[action]`。
* **时序与延时**：在 DAL 实现中，非阻塞场景必须使用 OSAL 提供的 `pal_get_us()` 计算时间差；阻塞式微秒延时统一调用 `pal_delay_us()`。
* **仿真条件分支**：如果器件在 Web 仿真下需要旁路，必须使用 `#ifdef SIMULATION` 宏进行隔离。

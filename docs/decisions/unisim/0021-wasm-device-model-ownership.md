# ADR-0021：Wasm 仿真侧外设行为模型归属与混合仿真契约

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-05（提议），2026-07-05（采纳） |
| 触发 | Web端 WASM 仿真设计器开发前置架构决策（P1-W1） |
| 影响范围 | `wink-micro-os/targets/wasm/`（新增虚拟外设模型与拦截分发）、`wink-micro-os/targets/wasm/devices/`（新建设备）、`app_codegen.py`（AI 生成逻辑）、WASM ↔ JS 桥接接口 |
| 决策者 | 架构委员会 & 用户 |
| 关联既有 ADR | [ADR-0002 双 target 同源编译](0002-dual-target-compilation.md), [ADR-0003 仿真保真度边界](0003-simulation-fidelity-boundary.md), [ADR-0009 物理退化](0009-physical-behavior-simulation-fault-injection.md), [ADR-0013 协作式调度器](0013-sim-cooperative-scheduler.md), [ADR-0019 Wasm imports 覆盖](0019-wasm-imports-override-and-asyncify-syntax.md) |
| 关联设计规范 | [02-virtual-peripheral-registry.md](../../design/04-wasm-simulation/archive/02-virtual-peripheral-registry.md), [03-multi-channel-sim-routing.md](../../design/04-wasm-simulation/archive/03-multi-channel-sim-routing.md) |

---

## 背景（Context）

在进行 **WASM 仿真设计器** 架构选型时，必须解决的核心问题是：**外设的仿真行为模型（Behavior Model）究竟存存放于何处？** 

如果外设的状态维护与通信协议解码逻辑（如 SSD1306 OLED 的 I2C 指令集解码）存放在前端（JS 侧），会带来严重的架构弊端：
1. **Asyncify 性能地狱**：在 WASM 协程中执行同步总线读操作（例如阻塞读取 I2C）时，Wasm 必须通过 Asyncify 挂起当前的堆栈，跨过 Worker 的 IPC 边界向前端 JS 请求数据，等待其计算完返回后再重绕（rewind）恢复。这种高频挂起（Yield/Resume）在 CPU 上有巨大开销。
2. **多端仿真分裂**：如果仿真模型绑定在 JS 侧，就无法在纯 C 环境下（如 Host 单元测试、CI/CD 自动化集成测试）跑“无头（Headless）”的整机行为验证。
3. **两仓耦合债**：固件 DAL 驱动协议稍有改动，前端 JS 仿真器必须同步发版，导致开发链路断裂。

但如果完全将仿真逻辑写死在 C 侧（Wasm Target），其最致命的缺点是：**用户无法在前端画布上“动态”地拉入、配置或扩展自定义器件**，因为这必须修改固件 C 源码并重新编译。

---

## 方案比选（Options）

### 选项 A：C 侧树内 Canonical 模型 (Scheme A)
* **做法**：标准件外设的仿真逻辑用 C 实现，静态打包在 `targets/wasm` 下。JS 前端只读结果渲染。
* **优点**：极性能，免除通信开销；支持 Host C 环境的纯命令行 CI 测试。
* **缺点**：灵活性差，用户在画布中动态拉入自定义传感器时，必须动 C 源码，对低代码平台不友好。

### 选项 B：Marshalling Shell 纯透传 (Scheme B)
* **做法**：C 侧只作总线包透传，所有行为逻辑在 JS 侧编写。
* **优点**：前端迭代快，对三方插件扩展十分方便。
* **缺点**：总线高频通信导致严重的帧率卡顿和 CPU 占用率过高（Asyncify 挂起频次过密）。

### 选项 C：1+3 混合双轨架构 (Hybrid - 推荐)
* **做法**：
  1. **标准外设 (Built-in)**：直接走 **方案 A**（C 侧树内内置），确保屏幕、舵机等性能大户的流畅度。
  2. **扩展外设 (Custom)**：采用 **“AI 动态转译编译 + 异步/同步注入”**。
     * 用户在前端动态添加的低频传感器，走 **方案一（JS 同步桥接）**。
     * 用户拖入的显示类只写外设，走 **方案二（非阻塞异步批处理）**。
     * 复杂的或高频的自定义器件，走 **方案三（AI Codegen 将其转译为 C 代码，在仿真编译阶段静态合并进 Wasm）**。

### 选项 D：Scheme A + AI Codegen 静态编译双轨制（Accepted）
* **做法**：在选项 C 的基础上做极致的架构统一与化简，彻底废除“JS侧运行模型”的动态脚本解析器。
  * **统一归属**：所有外设的仿真行为模型（Built-in + 自定义）**全部用 C 编写并运行在 Wasm 侧**。
  * **自定义扩展**：用户在画布上动态定义器件（自然语言或简单配置），仿真编译前由 **AI 自动将模型转译为 C 侧模拟器源码**，随业务代码一并静态编译进 Wasm 中。
  * **运行交互**：通过“单向数据流”与“Setter 物理量同步注入”规避仿真读取的 Asyncify 挂起。

---

## 决策结论（Decision）

我们决定采纳 **选项 D：Scheme A + AI Codegen 静态编译** 作为系统仿真的核心架构决策。

### 1. 通信契约与数据流向设计

仿真期间 WASM ↔ JS 之间的数据流向彻底解耦，统一为**单向双轨流**：

```text
               【 JS 侧 前端 UI (Canvas / 3D) 】
                       │                     ▲
  (1) 交互输入/物理量注入│                     │ (2) 像素/状态数据拉取
      Setter 同步调用    │                     │     Getter 读取
                       ▼                     │
               【 WASM 侧 仿真引擎 (C) 】 ──────┘
```

1. **JS $\rightarrow$ WASM（Setter 同步物理注入）**
   * 用于模拟环境物理量的变化。例如，当用户在前端 UI 上拖动超声波障碍物滑块时，前端 JS 捕获到变化，并立即同步调用 Wasm 导出的 Setter API：
     ```javascript
     Module._pal_wasm_set_ultrasonic_distance(echoPin, distanceCm);
     ```
   * Wasm 内部的 C模型接收该数据并存入内存。由于是在主线程中直接对 Wasm Memory 进行同步写操作，**不涉及 Wasm 的 Yield 挂起，零 Asyncify 开销**。
   * 当 Wasm 侧固件任务调用 `pal_gpio_pulse_in()` 读取脉宽时，C 侧模拟器直接读取内存中注入的 `distanceCm` 并同步换算为脉宽返回。

2. **WASM $\rightarrow$ JS（Getter 单向像素/状态提取）**
   * Wasm 内的 C 虚拟外设自行计算状态（如 SSD1306 OLED 的 I2C 写操作直接渲染到 Wasm 内部的 1024 字节 Framebuffer）。
   * 前端 JS 的渲染 Tick（通常为 60Hz 帧循环）中，通过导出的 Getter API 批量提取状态：
     ```javascript
     const fbPtr = Module._pal_wasm_get_ssd1306_fb(widthPtr, heightPtr);
     const pixels = new Uint8Array(Module.HEAPU8.buffer, fbPtr, 1024);
     drawToCanvas(pixels);
     ```
   * C 侧写寄存器不触发任何跨语言 IPC 通信，刷新画面的开销降低了 **99%**。

### 2. 备用 Fallback 机制 (保留调试通路)
在 Wasm 侧的 `pal_i2c_transfer` 入口维护一个虚拟路由表。若写入的 I2C 目标地址在 C 侧注册的外设表中未命中，则将调用 fallback 到宿主 JS 导入函数 `js_pal_i2c_transfer`（即选项 B 的通路）。这为尚处于开发调试期、未进行 Codegen 的临时自定义设备保留了一条便捷的通道。

---

## 影响评估（Consequences）

1. **性能提升**：彻底消除了外设读取操作带来的 Asyncify 协程挂起，使避障小车等带高频读写的仿真在低配设备下也能流畅运行。
2. **测试一致性**：所有自定义或内置外设的行为模拟全部可以在 Host（Windows Fiber 或 Linux GCC）下用标准 C 单测覆盖，极大地提升了系统的工程卫生质量。
3. **编译依赖**：用户修改自定义外设逻辑时，需要触发 Wasm 重新编译。由于业务代码修改本身就依赖重新编译，此步骤可以在工具链侧做一键编译无缝融合，对开发迭代频次没有坏的影响。


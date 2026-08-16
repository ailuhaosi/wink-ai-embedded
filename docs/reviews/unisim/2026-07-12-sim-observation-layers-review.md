# 仿真数据面分层（输出观测 + 输入注入）架构设计专家评审报告

> **评审对象：** `docs/tech-designs/unisim/2026-07-12-sim-observation-layers-design.md` （特别是第 13 章：外设可维护性：现状诊断与重构方向）
> **评审日期：** 2026-07-12
> **评审人：** Antigravity（资深嵌入式仿真设计专家）
> **计划状态：** ✅ Accepted（已采纳）— 技术设计已同步更新状态为 Accepted，详见 [`../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md`](../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md) 头部「状态」字段

---

## 1. 总体评价

**综合评分：9.2 / 10 — 极佳（Highly Recommended）**

该设计规格书针对嵌入式仿真平台（Wink AI Embedded Workbench）的数据通道进行了非常清晰、深入的解耦与规范。提出的 **“3 出 + 1 入 = 4 条数据面”** 计数口径，从根本上厘清了过去容易混淆的“输入注入”与“输出观测”的概念。

特别是在 **第 13 章“外设可维护性：现状诊断与重构方向”** 中，设计深入挖掘了现网代码中的耦合摩擦（如宿主组件特判、UI 直接依赖 runtime 状态、输入输出职责不清等问题），并提出了极具工程实操性的**插件化契约（`PeripheralSimulationContract`）**与**分阶段迁移路线（M1-M6）**。这是一份理论严谨、工程化落地性极高的资深级架构设计。

### 维度评估

| 评估维度 | 评分 | 核心评价 |
| :--- | :--- | :--- |
| **架构合理性** | 9.5 / 10 | “3 出 + 1 入”彻底解决了 I/O 混淆；Raw 与 Semantic 的分离符合工业级 HIL 仿真最佳实践（类似 Simulink 信号总线设计）。 |
| **可维护性设计** | 9.0 / 10 | 插件化契约设计合理，通过外设定义自包含（Self-contained）有效终结了宿主 `switch(type)` 的反模式。 |
| **落地可行性** | 9.5 / 10 | 渐进式重构路线（M1-M6）对现有运行的 Demo 破坏性极小，支持兼容过渡，非常务实。 |
| **时序与确定性** | 8.0 / 10 | 方案对输入注入（④）的时序确定性与多屏显示的扩展性描述略显简略，有进一步补充空间（见下文补充建议）。 |

---

## 2. 外设可维护性（第 13 章）专项评审与诊断

### 2.1 目标契约（§13.4）的先进性与合理性
提出的 `PeripheralSimulationContract` 和 `PeripheralUiBind` 契约是解决当前宿主代码膨胀（如 `bindCanvasProps` / `bindWorldProps` 存在 `switch(type)` 特判）的核心武器。

*   **数据隔离的彻底性**：通过 `SimViewContext`（提供 `pinStates`、`displayFb`、`actuatorObservations`）作为只读上下文传递给 UI 层，禁止 UI 组件直接 `import simulation-runtime`。这形成了强有力的物理隔离，有利于后续将仿真引擎与渲染层做跨进程/Web Worker 分离。
*   **双层执行器模型的落地**：舵机作为首个落地通道 ③（Semantic）的金样板，证明了 `Raw (pwm) -> Mapper -> Semantic (Observation)` 链路的优越性，后续电机等复杂执行器可直接复制该模式。

### 2.2 现状摩擦诊断的精准性
设计中对现状的痛点把握极其精准：
1.  **“假 Observe”问题**：超声波本是输入，却在底层声明了 `watchUltrasonic`，并在 Workbench 中特判，导致通道语义不纯。
2.  **宿主特判膨胀**：每新增一个传感器或执行器，都需要在 `bindWorldProps` 等宿主方法中增加 `type === 'xxx'` 分支，破坏了开放封闭原则（OCP）。
3.  **UI 绕过 Binder 直读**：Glyph 组件直接读取全局 runtime 状态，导致组件难以进行单元测试和独立沙箱渲染。

---

## 3. 待评审问题（Q7-Q12）的明确答复与决策建议

对于规格书中 **§13.9** 提出的决策问题，基于资深仿真设计视角的建议如下：

| 问题编号 | 待决策问题 | 评审意见 | 深度理由与落地策略 |
| :--- | :--- | :--- | :--- |
| **Q7** | 是否认可“按通道的成功标准”：③/②/④ 新增时宿主零 `type` 特判？ | **强烈同意** | 这是衡量重构成功与否的 **SSOT（单一真理源）指标**。一旦宿主实现零特判，外设开发者就拥有了彻底的自主权，极大降低了合并冲突和回归测试成本。 |
| **Q8** | UI bind 是否迁入 `definition.ui.*`（M2）？ | **同意** | 遵循 **“一外设一包”（P3）** 原则，将行为定义与视图绑定归拢在同一个目录下。建议在构建脚手架中加入规范校验，确保外设包自包含。 |
| **Q9** | Ideal Inject 是否迁入 `definition.simulation.inject`（M3）？ | **同意** | 必须将零散在 Workbench 和各个 widget 中的注入逻辑收口到外设契约中。但需注意 **时序同步**（详见下文补充建议）。 |
| **Q10** | 电机作为 M5 验证外设（先于 LED 迁 ③）？ | **强烈同意** | LED 相对简单（基于通道 ① 即可工作），而电机（直流/编码电机）涉及双向 PWM 和速度/方向转换。用电机验证“通道 ③ 的 Mapper 映射机制”，能有效检验双通道 Raw 转换为 Semantic 的鲁棒性。 |
| **Q11** | `watchI2C→oled` 是否在 M4 改为 `observeDisplay`？ | **同意** | I2C 是总线协议，Display 是应用层显示载荷。用 `observeDisplay` 明确声明显示器属性，有利于 Worker 统一管理多屏缓冲区。 |
| **Q12** | 新增 Checklist 是否强制“方向 → 通道 → Raw”三步（§13.6）？ | **强烈同意** | 这能强制开发者在动笔写代码前理清数据流向。许多仿真系统的重构都是因为开发者一开始混淆了“控制输入”与“状态输出”而导致架构腐烂。 |

---

## 4. 资深仿真专家的核心补充与设计增强建议

为了确保该设计规格书能够支撑未来 2-3 年内更复杂的仿真场景（例如：多屏仪表盘、多车协同、高精度物理反馈），建议对技术规格书补充以下四个维度的设计：

### 补充 1：输入注入（通道 ④）的时间确定性与队列化（Temporal Determinism）
> [!IMPORTANT]
> **现状隐患：** 在多线程仿真（UI 线程 $\leftrightarrow$ Worker 线程）中，用户点击按钮或更新超声波距离是异步的。如果 UI 直接发送 `SET_PIN_IDEAL` 消息，Worker 接收后立即写入 Wasm 内存，会导致仿真结果受 JS 事件循环延迟影响，**丧失仿真确定性（Non-deterministic Simulation）**。这意味着相同的操作序列在不同的运行中可能产生不同的传感器读取时序。

*   **补充设计建议：**
    1.  **注入事件时间戳化**：将注入的 `inject.apply` 改造为输出带仿真时间戳的事件包：
        ```typescript
        interface InjectEvent {
          deviceComponentId: string;
          payload: any;
          timestampUs?: string; // 期望在仿真的哪一微秒生效。若空，则在下一仿真步生效
        }
        ```
    2.  **Worker 端事件队列**：Worker 维护一个临时的输入注入事件队列。每步进（step）仿真前，Worker 检查当前仿真时间（`simTimeUs`），将满足时间要求的注入事件批量写入 Wasm，从而实现**仿真回放与测试的绝对确定性**。

### 补充 2：多屏幕支持与帧缓冲区传输优化（通道 ② 增强）
> [!NOTE]
> 现状仅支持一块单色的 SSD1306 OLED。若未来支持彩色屏（如 TFT 240x240 RGB）或多屏联动，通道 ② 将面临严重的性能与路由挑战。

*   **补充设计建议：**
    1.  **多屏幕寻址化**：在 `SimViewContext` 中，将全局 `displayFb: Uint8Array | null` 升级为**多屏映射表**：
        ```typescript
        interface SimViewContext {
          // ...
          displays: Record<string, DisplayPayload>; // key 为 deviceComponentId
        }
        interface DisplayPayload {
          width: number;
          height: number;
          format: 'mono_vertical' | 'rgb565' | 'rgb888';
          framebuffer: Uint8Array;
        }
        ```
    2.  **零拷贝性能优化（Transferable Objects）**：
        由于 Worker 与主线程频繁传输大块 `Uint8Array` 会带来显著的序列化开销，应明确规范：在 Worker 的 `STATE_UPDATE` 消息中，将各屏幕的 `ArrayBuffer` 放入 `postMessage` 的可转移对象（Transferables）列表中，实现零拷贝传输，防止 UI 渲染掉帧。

### 补充 3：通道 ①（Digital Pin Mirror）多态电平扩展
> [!TIP]
> 真实的硬件引脚不仅有“高/低电平（bool）”，还有“高阻态（Floating/Input）”、“弱上拉”、“模拟电压（ADC）”等状态。现有的 `pinStates: Record<number, boolean>` 无法表达这些电路级的真相。

*   **补充设计建议：**
    为了保持电路视窗的专业性以及后续支持 ADC 外设、弱上拉按键等，通道 ① 的数据结构定义应保留向前兼容的灰度升级能力：
    ```typescript
    type PinSignalState = 
      | boolean             // 传统逻辑高低（快速通道）
      | {
          level: boolean;   // 逻辑值
          voltage?: number; // 模拟电压 (V)
          mode: 'input' | 'output' | 'high_z' | 'analog';
          pull: 'none' | 'up' | 'down';
        };

    pinStates: Record<number, PinSignalState>;
    ```
    本规格书中应注明：*“通道 ① 现阶段以 boolean 传输，但消费者需通过 Helper 函数（如 `isPinHigh(state)`) 进行解析，以便后续无缝升级至多态电平结构。”*

### 补充 4：AST 静态代码护栏（Architecture Linting）
> [!WARNING]
> 架构规范极易随着人员流动和快速迭代而“腐烂”。规格书中提到的“架构单测护栏”主要约束了 UI 组件的导入，但无法有效阻挡外设内部的不规范调用。

*   **补充设计建议：**
    在重构阶段 M1 中，建议引入 `dependency-cruiser` 或自定义 `ESLint` 规则，强制实施以下依赖方向约束：
    1.  **禁止越权导入**：`src/peripherals/<type>/` 目录下的代码禁止直接 `import` `src/services/simulation-runtime.ts`。所有运行态信息必须且仅能通过 `SimViewContext` / `InjectContext` 获取。
    2.  **禁止反向引用**：`src/services/` 和 `src/workers/` 禁止 `import` 任何 `src/peripherals/` 下的视图层文件，宿主层仅允许通过 `src/peripherals/index.ts` 进行外设定义列表的静态注册。

---

## 5. 总结与后续建议

该设计是一次非常成功的外设可维护性重构规划。

**行动路线推荐：**
1.  **通过评审**：同意该规格书作为 Wink AI Embedded 数据面分层与外设插件化的指导规范。
2.  **开辟 ADR**：基于 Q1/Q5 结论，立刻归纳一份架构决策记录（ADR-000X），确立 “3 出 + 1 入” 及 “外设自包含契约” 长期有效。
3.  **实施计划拆解**：按照重构路线 **M1 $\rightarrow$ M2 $\rightarrow$ M3 $\rightarrow$ M5** 的优先级启动实施开发。在 M3 中务必参考本评审报告中关于“注入队列化与确定性”的设计建议。


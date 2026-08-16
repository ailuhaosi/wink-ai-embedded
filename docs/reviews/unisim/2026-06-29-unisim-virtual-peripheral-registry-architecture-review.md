# UniSim 虚拟外设注册表架构深度评审

| 项 | 内容 |
|----|------|
| 评审日期 | 2026-06-29 |
| 评审对象 | `04-wasm-simulation/02-virtual-peripheral-registry.md` |
| 关联文档 | `04-wasm-simulation/03-multi-channel-sim-routing.md`, `07-platform-governance/01-device-model-registry.md`, `04-wasm-simulation/05-simulation-consistency-and-fidelity-spec.md` |
| 关联 ADR | ADR-0003 (同源旁路原则), ADR-0009 (物理行为与故障注入) |
| 评审类型 | 架构完整性评审 + 技术可行性评审 |
| 评审人 | Architecture Review Board |

---

## 1. 评审背景与范围

### 1.1 评审目的

本评审针对 UniSim 虚拟外设注册表架构设计文档（`02-virtual-peripheral-registry.md`）进行**全方位深度技术评估**，目的在于：
1. 验证架构设计的完整性与技术正确性
2. 识别边缘场景处理缺口与一致性风险
3. 评估与平台其他子系统（Device Model Registry、三级仿真通路）的整合度
4. 提出具体可落地的改进建议与实施路径

### 1.2 评审范围

| 评审维度 | 覆盖内容 |
|---------|---------|
| **数据模型层** | `sim-project.json` 拓扑 Schema、`peripheral-definition.json` 元数据规范 |
| **渲染集成层** | SchemaForm 零转换渲染机制、自适应导线路由算法 |
| **仿真驱动层** | `WasmPeripheralRegistry` 接口设计、四大典型驱动范例 |
| **性能架构层** | 三级仿真通路机制与智能路由策略 |
| **系统整合层** | 与 Device Model Registry、故障注入、高保真路线图的对齐度 |

### 1.3 文档结构总览

被评审文档包含四大核心模块：
1. ✅ 项目拓扑与电路图存储规范
2. ✅ SchemaForm 外设元数据表单设计
3. ✅ 自适应导线路由设计
4. ✅ 虚拟外设驱动注册表设计与四大驱动范例

文档结构清晰，核心概念定义准确，代码范例质量高。

---

## 2. 架构优势与设计亮点深度解析

### 2.1 三级仿真通路机制：行业突破性设计

**设计原文**（见 `03-multi-channel-sim-routing.md`）：
```text
[ Pin-level Sim ] → [ Protocol Bypass ] → [ DAL Value Bypass ]
     逐位电平           数据包旁路          语义值直通
```

**深度评价**：

这是整个架构**最具创新性与技术价值**的核心决策，完美解决了 Web 嵌入式仿真领域的长期行业痛点：

| 痛点场景 | 传统方案的问题 | 本设计的突破 |
|---------|---------------|-------------|
| **I2C 屏幕刷新** | 逐 bit 时钟翻转产生 8×1024 = 8192 次 JS-Wasm 调用，浏览器卡死 | 协议旁路后仅 1 次调用，性能提升 **50×+** |
| **UART 115200 波特率** | 每秒 115200 次电平翻转，主线程完全阻塞 | 协议旁路后按帧传输，CPU 占用 < 5% |
| **超声波测距** | 逐微秒轮询 echo 引脚，Wasm 死循环超时 | DAL 旁路后仅 2 次同步调用，同源换算保留 |

**技术先进性评级**：★★★★★（达到商业仿真引擎级别）

### 2.2 同源旁路哲学：虚实一致性的基石

**设计原文**（见 `03-multi-channel-sim-routing.md` 第 80-96 行）：
> 旁路的只是物理信号**来源**，不是测距语义

**深度评价**：

这一设计原则（ADR-0003 决策 2）的价值怎么强调都不为过。它准确把握了"仿真"与"模拟"的本质区别：

| 维度 | 错误做法（业界常见） | 本设计正确做法 |
|------|---------------------|---------------|
| **驱动代码** | `#ifdef SIMULATION` 直接返回 JS 数值，驱动代码完全未执行 | `#ifdef` 仅在最底层 PAL 入口，驱动代码 100% 同源执行 |
| **换算逻辑** | 距离换算在 JS 侧完成，C 侧只拿结果 | 脉宽换算、超时判定、错误码返回完全由 C 侧同源处理 |
| **一致性** | 仿真通过但真机驱动 Bug 完全逃逸 | 驱动 Bug 在仿真阶段即可暴露 |

**设计哲学评级**：★★★★★（深刻理解嵌入式仿真本质）

### 2.3 注册表模式：生态扩展性的保障

**设计原文**（见 `02-virtual-peripheral-registry.md` 第 224-263 行）：
```typescript
class PeripheralRegistry {
  private registry = new Map<string, PeripheralSimulationLogic>();
  register(type: string, logic: PeripheralSimulationLogic)
  get(type: string)
}
```

**深度评价**：

采用注册表模式带来三大关键优势：

1. **解耦性**：外设驱动与仿真内核完全分离，第三方贡献新外设无需修改核心代码
2. **增量加载**：按需注册用到的外设类型，减少首屏加载体积
3. **版本隔离**：同一外设的不同仿真实现（如 Pin-level 版 vs DAL Bypass 版）可并行注册

### 2.4 SchemaForm 零转换：前端工程化优秀实践

**设计原文**（见 `02-virtual-peripheral-registry.md` 第 84-209 行）：

外设元数据的 `properties` 字段直接与 `@yo-cloud/yo-ux-vue` 的 `DynamicItemSchemaType` 类型对齐。

**深度评价**：

这是一个被低估但极有价值的工程化决策：
- ✅ 消除了"后端定义 Schema → 前端转换为表单配置"的中间层
- ✅ 避免了两端定义不一致导致的 Bug
- ✅ 新增外设属性时，前端零代码修改自动支持
- ✅ AI 生成外设配置时直接输出标准格式

---

## 3. 架构缺口深度分析与改进方案

### 3.1 P0 级关键缺口：引脚仲裁与总线冲突机制

#### 3.1.1 问题描述

当前设计中 `PinManager` 只定义了单向数据流接口：
```typescript
// 现有接口（单向）
pinManager.readPin(pin: number): boolean
pinManager.setPinInput(pin: number, value: boolean): void
pinManager.onPinChange(pin: number, callback: Function): () => void
```

**完全缺失多驱动源冲突仲裁机制**。真实硬件场景中：

| 冲突场景 | 发生概率 | 后果 |
|---------|---------|------|
| **开漏总线上拉/下拉** | 极高（I2C、OneWire） | 线与逻辑计算错误，导致通信失败 |
| **两外设同时驱动同一引脚** | 中（多路开关、电平冲突） | 不确定电平，仿真结果不可信 |
| **I2C 多主设备仲裁** | 中（多 MCU 板间通信） | 总线死锁或数据损坏 |
| **高阻态 (Hi-Z) 传播** | 中（未连接引脚、三态门） | 浮空电平未正确模拟 |

#### 3.1.2 改进方案：引脚状态机与强弱电平仲裁器 (Strength-based Arbiter)

为了在 JS/Wasm 仿真环境中实现极致性能并完美复现开漏线与、短路冲突以及高阻态传播，引入 **4值逻辑状态** 与 **3级驱动强度** 仲裁模型（借鉴 SystemVerilog 规范），避免昂贵的浮点数模拟电压节点分压计算：

```typescript
/** 4值逻辑状态 */
type LogicState = 
  | 0   // 低电平 (Low)
  | 1   // 高电平 (High)
  | 'Z' // 高阻态 (Floating/Hi-Z)
  | 'X'; // 未知/冲突态 (Contention/Unknown)

/** 驱动强度等级（从强到弱） */
enum DriveStrength {
  SUPPLY = 3, // 电源直连（如 VCC/GND, 推挽输出 push-pull）
  PULL   = 2, // 电阻拉低/拉高（如 I2C 外部上拉, 内部 pull-up/down）
  WEAK   = 1, // 弱电平/悬空（漏极开路 open-drain 释放时、高阻输入）
}

/** 驱动源定义 */
interface PinDriver {
  state: LogicState;
  strength: DriveStrength;
}

/** 单引脚状态 */
interface PinState {
  resolvedState: LogicState;  // 仲裁后的最终逻辑值
  drivers: Map<string, PinDriver>; // 注册的所有驱动源 (如 mcu:gpi1, ext:pullup)
}

/** 强弱电平引脚仲裁器 */
class PinArbiter {
  private pinStates = new Map<number, PinState>();

  /** 注册或更新驱动源状态 */
  setDriver(pin: number, driverId: string, state: LogicState, strength: DriveStrength): void {
    let pinState = this.pinStates.get(pin);
    if (!pinState) {
      pinState = { resolvedState: 'Z', drivers: new Map() };
      this.pinStates.set(pin, pinState);
    }
    pinState.drivers.set(driverId, { state, strength });
    pinState.resolvedState = this.resolvePinState(pinState.drivers);
  }

  /**
   * 强弱电平仲裁算法
   * 根据当前所有驱动源，计算出引脚的最终4值逻辑状态
   */
  private resolvePinState(drivers: Map<string, PinDriver>): LogicState {
    if (drivers.size === 0) return 'Z';

    let maxStrength = -1;
    let resolved: LogicState = 'Z';
    let hasConflict = false;

    for (const [_, drv] of drivers) {
      // 忽略不起驱动作用的高阻态
      if (drv.state === 'Z') continue;

      if (drv.strength > maxStrength) {
        maxStrength = drv.strength;
        resolved = drv.state;
        hasConflict = false;
      } else if (drv.strength === maxStrength) {
        // 同等强度下输出不同的电平 -> 产生逻辑冲突 (X)
        if (drv.state !== resolved) {
          hasConflict = true;
        }
      }
    }

    if (hasConflict) return 'X';
    return resolved;
  }

  /** 获取仲裁后的引脚电压估算（用于兼容模拟显示组件，如 LED 亮度） */
  getResolvedVoltage(pin: number): number {
    const state = this.pinStates.get(pin);
    if (!state) return 0;
    switch (state.resolvedState) {
      case 1: return 3.3;
      case 0: return 0;
      case 'X': return 1.65; // 冲突电压折中
      case 'Z': default: return 0.0; // 悬空高阻电压
    }
  }
}
```

### 3.2 P0 级关键缺口：外设生命周期状态机

#### 3.2.1 问题描述

当前 `PeripheralSimulationLogic` 仅定义了 `attachEvents` 一次性初始化钩子，完全缺失外设的完整生命周期管理。真实硬件外设存在完整状态机：

```text
                  ┌──────────────┐
   上电复位 ─────► │  INIT_STATE  │
                  └──────┬───────┘
                         │  初始化完成
                  ┌──────▼───────┐
   配置命令 ─────► │  CONFIGURED  │
                  └──────┬───────┘
                         │  进入运行态
                  ┌──────▼───────┐
   读/写操作 ─────► │   RUNNING    │ ◄──┐
                  └──────┬───────┘    │
                         │  休眠命令   │
                  ┌──────▼───────┐    │
                  │   SLEEPING   │    │
                  └──────┬───────┘    │
                         │  唤醒      │
                         └────────────┘
                  热插拔移除 ──►  销毁
```

#### 3.2.2 改进方案：生命周期钩子扩展（增加电源域与上电爬坡时序）

真实硬件中存在电容充电、振荡器就绪延迟。为了暴露出 MCU 启动过快、在外设就绪前盲目发送 I2C 命令导致挂起的 Race Condition，必须在生命周期中加入**电源域 (Power Domain) 绑定**与**上电稳定延迟**：

```typescript
export interface PeripheralLifecycle {
  /** 
   * 绑定的物理电源轨/电源域 (如 '3V3_SYS', '5V_PERIPHERAL')
   * 当板载主控断电或电源轨因保护关闭时，会自动切断该外设的供电
   */
  powerDomain: string;

  /** 
   * 模拟电源从 0V 升至稳定工作电压的时序爬坡延迟 (单位: 微秒)
   * 在此延迟时间段内，外设对总线/引脚读写无响应，必须返回 WINK_ERR_BUSY
   */
  powerUpDelayUs?: number;

  /**
   * 上电复位调用
   * 执行：上电时序延迟、寄存器默认值初始化、自检
   */
  onPowerOn?: () => Promise<void>;

  /**
   * 断电/热插拔移除调用
   * 执行：资源释放、事件监听器清理、状态持久化
   */
  onPowerOff?: () => void;

  /**
   * 软复位（如 I2C 软件复位命令）
   */
  onReset?: () => void;

  /**
   * 用户动态修改外设属性（如修改限流电阻）
   */
  onPropertyChange?: (key: string, oldValue: any, newValue: any) => void;

  /**
   * 进入/退出低功耗模式
   */
  onPowerModeChange?: (mode: 'active' | 'sleep' | 'deep-sleep') => void;

  /**
   * 热插拔支持标记
   * true = 支持在仿真运行中动态添加/移除
   */
  supportsHotPlug?: boolean;
}

// 合并入原有接口
export interface PeripheralSimulationLogic extends PeripheralLifecycle {
  onPinStateChange?: (pinName: string, state: LogicState) => void;
  attachEvents?: (
    element: HTMLElement,
    pinManager: PinManager,
    getMappedPin: (partPinName: string) => number | null,
    componentId: string
  ) => () => void;
}
```

#### 3.2.3 典型应用：SSD1306 上电时序

```typescript
WasmPeripheralRegistry.register('ssd1306', {
  onPowerOn: async () => {
    // 模拟真实上电复位时序
    await delayUs(100);    // VDD 稳定延迟
    await delayUs(500);    // RES# 拉低 ≥ 3us
    await delayUs(1000);   // RES# 拉高后等待 ≥ 100us
    // 执行显示芯片初始化命令序列
  },
  
  // ... 其余生命周期钩子
});
```

### 3.3 P0 级关键缺口：故障注入标准接口（与 ADR-0009 对齐）

#### 3.3.1 问题描述

[ADR-0009] 已正式采纳物理行为模拟与故障注入决策，但 `PeripheralSimulationLogic` 接口**完全没有预留任何故障注入入口**。这将导致：
1. ADR 决策无法落地实施
2. 故障注入需要侵入式修改每个外设驱动
3. 无法实现统一的自动化故障注入测试

#### 3.3.2 改进方案：标准化故障注入接口

```typescript
/**
 * 故障注入控制接口（与 ADR-0009 完全对齐）
 * 每个外设驱动可选择性实现这些能力
 */
export interface PeripheralFaultInjection {
  /** 支持的故障类型列表（用于 UI 动态生成故障注入面板） */
  supportedFaults: FaultType[];

  /**
   * 引脚抖动（Jitter）：电平变化的时间偏移
   * 用途：测试软件消抖算法有效性
   */
  setPinJitter?(pinName: string, enabled: boolean, config: {
    amplitudeUs: number;      // 抖动幅度 (μs)
    distribution: 'uniform' | 'gaussian';  // 分布类型
  }): void;

  /**
   * 信号噪声（Noise）：模拟 ADC 采样噪声
   * 用途：测试滤波算法、传感器校准
   */
  setAnalogNoise?(pinName: string, enabled: boolean, config: {
    snrDb: number;            // 信噪比 (dB)
    sampleRate: number;       // 噪声采样率
  }): void;

  /**
   * 导线断开（Disconnect）：物理断线模拟
   * 用途：测试错误处理、故障恢复
   */
  setPinDisconnect?(pinName: string, disconnected: boolean): void;

  /**
   * 通信超时（Timeout）：总线无响应
   * 用途：测试驱动超时与重试逻辑
   */
  setBusTimeout?(busType: 'i2c' | 'spi' | 'uart', enabled: boolean, config: {
    probability: number;      // 超时概率 0.0 ~ 1.0
  }): void;

  /**
   * 数据损坏（Corruption）：位翻转注入
   * 用途：测试校验和、CRC、重传机制
   */
  setDataCorruption?(enabled: boolean, config: {
    bitErrorRate: number;     // 位错误率
  }): void;

  /**
   * 预热延迟（Warm-up）：传感器上电稳定时间
   * 用途：测试初始化时序合理性
   */
  setWarmupDelay?(enabled: boolean, config: {
    delayMs: number;          // 预热时长
    driftCurve: 'linear' | 'exponential';  // 漂移曲线
  }): void;
}
```

#### 3.3.3 架构纪律：故障注入分层原则（强制执行）

> **⚠️ 重要：物理层故障绝对不能在外设驱动内部实现！**

采用**非侵入式中间件模式**，三层故障严格分离：

| 故障层级 | 处理位置 | 允许的故障类型 |
|---------|---------|---------------|
| **第一层：PinManager** | 引脚管理器中间件 | ✅ 断线（disconnect）、抖动（jitter）、上拉/下拉电阻失效、高阻态传播 |
| **第二层：总线控制器** | I2C/SPI/UART 控制器中间件 | ✅ ACK 丢失、超时、CRC 错误、位翻转、总线仲裁丢失 |
| **第三层：外设逻辑** | 外设驱动 `PeripheralSimulationLogic` | ✅ 传感器超量程（Out of Range）、电机堵转、EEPROM 坏块等**业务特有故障** |

**反模式（禁止）**：
- ❌ 在外设 `attachEvents()` 中直接操作引脚电平模拟断线
- ❌ 每个外设各自实现抖动/噪声算法
- ❌ 外设直接调用 `pinManager.setDriverLevel()` 模拟故障

**正确模式**：
```typescript
// 外设只做一件事：注册引脚映射，然后被动接收仲裁后的电压
const anodePin = getMappedPin('Anode');
pinManager.registerPeripheralPin(componentId, anodePin, 'Anode');

// 故障注入由测试框架通过 PinManager 标准 API 调用，外设完全无感知
// pinManager.setPinDisconnect(anodePin, true);  // 这是测试代码，不是外设代码！
```

---

## 4. 中优先级改进建议详细设计

### 4.1 仿真通路动态自适应降级策略

#### 4.1.1 问题

当前三级仿真通路是**静态选择**，无法根据运行时条件动态调整：
- 低端浏览器运行复杂项目时帧率崩溃
- 用户打开"逻辑分析仪"需要高精度波形，但当前通路是 DAL Bypass
- 后台标签页不需要高帧率，但仍消耗大量 CPU

#### 4.1.2 解决方案：基于 QoS 的动态路由

```typescript
/** QoS 服务质量等级 */
type SimulationQoS = 
  | 'maximum-fidelity'     // 最高保真（逻辑分析仪开启）
  | 'balanced'             // 平衡（默认）
  | 'performance-priority' // 性能优先（帧率 < 30 FPS）
  | 'minimum'              // 最低（后台标签页）

/** 通路自适应控制器 */
class SimPathController {
  private currentQoS: SimulationQoS = 'balanced';
  private fpsHistory: number[] = [];

  /** 每帧调用，根据实际帧率自动调整通路等级 */
  onFrameRender(fps: number): void {
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > 30) this.fpsHistory.shift();

    const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;

    // 自动降级/升级
    if (avgFps < 15 && this.currentQoS === 'balanced') {
      this.setQoS('performance-priority');
      console.warn('[SimPath] 帧率不足，自动降级到性能优先模式');
    } else if (avgFps > 45 && this.currentQoS === 'performance-priority') {
      this.setQoS('balanced');
    }
  }

  /** 外部触发 QoS 变更 */
  setQoS(qos: SimulationQoS): void {
    this.currentQoS = qos;
    
    // 通知所有外设切换通路实现
    this.peripherals.forEach(p => {
      const impl = this.getImplementationForQoS(p.type, qos);
      p.switchImplementation(impl);
    });
  }

  /** 获取对应 QoS 等级的外设实现 */
  private getImplementationForQoS(type: string, qos: SimulationQoS): PeripheralSimulationLogic {
    // 同一种外设可以注册多个通路级别的实现
    return this.registry.get(`${type}:${qos}`) || this.registry.get(type);
  }
}
```

### 4.2 网表级信号传播与级联效应

#### 4.2.1 问题

当前设计假设外设**独立工作**，但真实电路中存在外设级联与被动元件影响：

```text
MCU_GPIO ────► LED ────► 220Ω 电阻 ────► GND
                      电阻值影响实际亮度
```

```text
MCU_3V3 ────► 电平转换芯片 ────► 5V 传感器
                 ↑
           方向控制引脚
```

这类级联效应在当前架构中**完全无法建模**，导致仿真结果与真实硬件存在偏差。

#### 4.2.2 解决方案：网表传播器

```typescript
/** 网表节点类型 */
type NetNode = 
  | { type: 'mcu-pin'; pin: number }
  | { type: 'peripheral-pin'; componentId: string; pinName: string }
  | { type: 'passive'; componentId: string; elementType: 'resistor' | 'capacitor' }
  | { type: 'power-net'; net: 'VCC' | 'GND' }

/** 连通网络 */
interface ConnectivityNet {
  netId: string;
  nodes: NetNode[];
  // 节点间导纳矩阵（用于直流分析）
  admittanceMatrix: number[][];
}

/**
 * 网表级信号传播器
 * 负责计算整个连通网络的电气特性
 */
class NetlistPropagator {
  private nets: ConnectivityNet[] = [];

  /** 某节点状态变化时，传播到整个连通网络 */
  propagate(changedNode: NetNode, newValue: ElectricalState): void {
    // 1. 找到该节点所属的连通网络
    const net = this.findNetContaining(changedNode);
    if (!net) return;

    // 2. 执行网络直流分析（节点电压法）
    const nodeVoltages = this.solveDCOperatingPoint(net, changedNode, newValue);

    // 3. 更新网络中所有节点的电压状态
    net.nodes.forEach((node, idx) => {
      this.updateNodeVoltage(node, nodeVoltages[idx]);
    });

    // 4. 触发外设的电气特性更新（如 LED 亮度随电压变化）
    net.nodes.forEach(node => {
      if (node.type === 'peripheral-pin') {
        const peripheral = this.getPeripheral(node.componentId);
        if (peripheral.onVoltageChange) {
          peripheral.onVoltageChange(node.pinName, nodeVoltages[idx]);
        }
      }
    });
  }

  /** 求解直流工作点（简化版节点电压法） */
  private solveDCOperatingPoint(
    net: ConnectivityNet, 
    source: NetNode, 
    sourceValue: ElectricalState
  ): number[] {
    // 简化实现：考虑电阻分压、二极管压降等
    // 完整实现可参考 SPICE 类仿真器算法
    return [];
  }
}
```

### 4.3 Schema 版本化与自动迁移管道

#### 4.3.1 问题

当前 `peripheral-definition.json` 没有版本化机制，平台演进时将面临：
- 新字段添加导致旧项目文件解析失败
- 字段语义变更无兼容层
- 无法自动批量升级历史项目

#### 4.3.2 解决方案：版本化 Schema + 迁移管道

```typescript
interface VersionedSchema {
  schemaVersion: number;
  $schema: string;
}

interface MigrationStep {
  fromVersion: number;
  toVersion: number;
  up: (data: any) => any;
  down?: (data: any) => any;  // 可选降级
}

class SchemaMigrationEngine {
  private migrations: MigrationStep[] = [];

  registerMigration(step: MigrationStep): void {
    this.migrations.push(step);
  }

  /** 自动升级到最新版本 */
  migrateToLatest<T extends VersionedSchema>(data: T): T {
    let current = data;
    let version = data.schemaVersion || 1;

    // 按顺序执行所有需要的迁移步骤
    while (version < LATEST_SCHEMA_VERSION) {
      const migration = this.migrations.find(m => m.fromVersion === version);
      if (!migration) {
        throw new Error(`No migration path from version ${version}`);
      }
      current = migration.up(current);
      version = migration.toVersion;
    }

    current.schemaVersion = LATEST_SCHEMA_VERSION;
    return current;
  }
}

// 示例迁移：从 v1 → v2
const migrationV1toV2: MigrationStep = {
  fromVersion: 1,
  toVersion: 2,
  up: (data) => ({
    ...data,
    // v2 新增字段：故障模型配置
    faultModel: data.faultModel || { supportsJitter: false },
    // v2 字段重命名：visual.tagName → visual.webComponent
    visual: {
      ...data.visual,
      webComponent: data.visual.tagName
    }
  })
};
```

---

## 5. 前瞻性设计建议（未来平台扩展）

### 5.1 外设可观测性与标准探针接口

为 AI 自动化调试与测试框架预留在轨观测能力：

```typescript
/** 探针描述符（AI 调试器可自动发现） */
interface ProbeDescriptor {
  name: string;
  type: 'digital' | 'analog' | 'bus-transaction' | 'internal-state';
  unit?: string;
  samplingMethod: 'polling' | 'interrupt';
}

/** 波形捕获结果 */
interface Waveform {
  probeName: string;
  startTimeUs: number;
  endTimeUs: number;
  sampleIntervalUs: number;
  samples: (boolean | number)[];
  annotations: { timeUs: number; text: string }[];
}

/** 外设可观测性接口 */
export interface PeripheralObservability {
  /** 获取所有可用观测探针 */
  getAvailableProbes(): ProbeDescriptor[];

  /** 捕获指定时间段的波形数据 */
  captureWaveform(probeName: string, durationUs: number): Promise<Waveform>;

  /** 获取内部状态快照（用于 AI 故障诊断） */
  getInternalStateSnapshot(): Record<string, any>;

  /** 导出状态转换图（用于形式化验证） */
  getStateTransitionDiagram?(): { states: string[]; transitions: any[] };
}
```

### 5.2 多板卡分布式同步总线

多 MCU 板间通信场景需要跨 Worker/线程同步：

```typescript
/** 板间通信总线 */
interface InterBoardBus {
  /** 创建板间虚拟导线 */
  createWire(
    endpoints: { boardId: string; portName: string }[],
    protocol: 'uart' | 'i2c' | 'spi' | 'gpio'
  ): VirtualWire;

  /** 广播事件（如 3D 场景中的物理碰撞） */
  broadcast(channel: string, event: SimulationEvent): void;

  /**
   * 分布式时钟同步
   * 解决多个 Wasm Worker 之间的虚拟时间不一致问题
   */
  syncSimTime(masterTimeUs: number): void;
}
```

### 5.3 物理量纲系统与类型安全检查

```typescript
/** 物理量类型系统 */
type PhysicalQuantity = 
  | { type: 'resistance'; value: number; unit: 'ohm' | 'kohm' | 'mohm' }
  | { type: 'voltage'; value: number; unit: 'V' | 'mV' | 'uV' }
  | { type: 'current'; value: number; unit: 'A' | 'mA' | 'uA' }
  | { type: 'time'; value: number; unit: 's' | 'ms' | 'us' | 'ns' }
  | { type: 'temperature'; value: number; unit: 'C' | 'F' | 'K' }
  | { type: 'distance'; value: number; unit: 'm' | 'cm' | 'mm' }
  | { type: 'angle'; value: number; unit: 'deg' | 'rad' };

/**
 * 量纲检查器（AI 代码生成时自动验证）
 * 防止：把电阻值赋值给电压引脚这类语义错误
 */
class DimensionalChecker {
  static convert(q: PhysicalQuantity, targetUnit: string): PhysicalQuantity {
    // 单位转换实现
  }

  static assertCompatible(a: PhysicalQuantity, b: PhysicalQuantity): void {
    if (a.type !== b.type) {
      throw new TypeError(`量纲不兼容：${a.type} vs ${b.type}`);
    }
  }
}
```

---

## 6. 跨文档一致性分析与整合方案

### 6.1 问题识别：信息重复定义风险

当前平台存在两份独立的外设元数据定义：

| 定义位置 | 内容 | 维护方 |
|---------|------|-------|
| `02-virtual-peripheral-registry.md` | `peripheral-definition.json`（前端渲染用） | 前端仿真团队 |
| `07-platform-governance/01-device-model-registry.md` | Device Model（全平台统一用） | 平台架构团队 |

**两者内容高度重叠但归属不同维护主体**，存在严重的一致性风险：

| 字段 | 02 号文档 | 07 号文档 | 状态 |
|------|-----------|-----------|------|
| `id` | ✅ | ✅ | 重复 |
| `name` | ✅ | ✅ | 重复 |
| `category` | ✅ | ✅ | 重复 |
| `visual.*` | ✅ | ✅ | 重复 |
| `pins.*` | ✅ | ✅ | 重复 |
| `properties` | ✅ (SchemaForm) | ✅ (通用) | 语义不同 |
| `dal.*` | ❌ | ✅ | 缺失 |
| `simulation.*` | ❌ | ✅ | 缺失 |
| `faultModel.*` | ❌ | ✅ (ADR-0009) | 缺失 |
| `codegen.*` | ❌ | ✅ | 缺失 |

### 6.2 推荐整合架构

```text
┌─────────────────────────────────────────────────────────┐
│           Device Model Registry (单一事实源)              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  pins, visual, properties, dal, simulation,       │  │
│  │  faultModel, codegen, lifecycle, observability    │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  前端渲染导出  │  │  仿真引擎导出  │  │  代码生成导出  │
│  SchemaForm  │  │  Registry    │  │  device_tree │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 6.3 具体整合措施与构建时绑定管道 (Build-time Binding Pipeline)

为了杜绝手动维护前端 JSON 与后端编译配置导致的版本漂移，确立以 `device-model.json` 为单一事实源 (SSOT) 的自动化管道：

1. **停用** `02-virtual-peripheral-registry.md` 中独立的 `peripheral-definition.json` 定义。
2. **统一**以 Device Model Registry 作为外设元数据的唯一来源。
3. **补充** Device Model 中缺失的仿真专用字段：
   - `simulation.preferredPath: 'pin-level' | 'protocol' | 'dal-bypass'`
   - `simulation.registryLogic: PeripheralSimulationLogic`（类型引用）
4. **自动化绑定管道 (SSOT Code Generation Pipeline)**：
   每次执行构建时，绑定生成器 `scripts/generate-device-bindings.py` 自动消费 `device-model.json`：
   - **前端派生**：提取 `properties` 声明，生成给前端 `<SchemaForm>` 直接渲染的 JS 配置，并编译出 Web GL/Canvas 端对应的 Pin 连线热区坐标。
   - **C 驱动派生**：自动生成 `device_tree.c` 与对应的 `device_tree.h` 头文件，保证真机/Wasm 双端实例引脚、初始化结构体参数对齐。

---

## 7. 总体评分与实施路径规划

### 7.1 多维评分矩阵

| 评估维度 | 权重 | 评分 (0-10) | 加权分 | 评价说明 |
|---------|------|------------|--------|---------|
| **架构完整性** | 25% | 7.5 | 1.875 | 核心架构完整，缺失仲裁、生命周期、故障注入三个关键接口 |
| **技术前瞻性** | 20% | 8.5 | 1.70 | 三级通路设计达到商业引擎水平，行业领先 |
| **工程可实施性** | 20% | 8.0 | 1.60 | 边界清晰，增量实施难度低，代码范例质量高 |
| **虚实一致性** | 15% | 6.5 | 0.975 | 同源旁路原则正确，但总线级一致性待 Phase 3 补足 |
| **AI 友好性** | 10% | 7.0 | 0.70 | SchemaForm 很好，但缺少标准探针与类型系统 |
| **跨系统整合度** | 10% | 5.5 | 0.55 | 与 Device Model Registry 存在重复定义风险 |
| **总分** | 100% | - | **7.40** | 优秀架构，需补足边缘场景 |

### 7.2 评分等级说明

| 分数区间 | 等级 | 含义 |
|---------|------|------|
| 9.0-10 | S | 业界标杆，无明显缺陷 |
| 8.0-8.9 | A | 优秀架构，少量改进点 |
| 7.0-7.9 | B+ | 良好架构，若干关键缺口需要补足 |
| 6.0-6.9 | B | 基本可用，多处改进空间 |
| < 6.0 | C | 需要重大重构 |

### 7.3 分阶段实施路径

| 优先级 | 阶段 | 内容 | 预计工作量 | 关联决策/文档 |
|--------|------|------|-----------|--------------|
| **P0** | Phase 0 | 引脚仲裁器与总线冲突机制 | 1 周 | 本文档 |
| **P0** | Phase 0 | 外设生命周期状态机接口 | 3 天 | 本文档 |
| **P0** | Phase 0 | 故障注入标准接口（与 ADR-0009 对齐） | 1 周 | ADR-0009 |
| **P1** | Phase 1 | 与 Device Model Registry 整合 | 2 周 | 07-01 |
| **P1** | Phase 1 | 仿真通路动态自适应降级 | 1 周 | 04-03 |
| **P2** | Phase 2 | 网表级信号传播器 | 2 周 | 本文档（远期） |
| **P2** | Phase 2 | 可观测性探针接口 | 2 周 | AI 调试器路线图 |
| **P3** | Phase 3 | 物理量纲系统 | 1 周 | 代码生成器路线图 |
| **P3** | Phase 3 | 多板卡分布式同步总线 | 2 周 | 多板卡功能规划 |

---

## 8. 评审结论与后续行动

### 8.1 总体结论

**评审通过（条件性）**。

UniSim 虚拟外设注册表是一份**高质量、具备行业领先水平**的架构设计文档。其三级仿真通路机制创新性地解决了 Web 嵌入式仿真的核心性能瓶颈，同源旁路哲学准确把握了虚实一致性的本质。

架构整体方向正确，核心设计优秀，但需补足三个关键缺口后方可进入实施阶段：
1. ✅ 引脚仲裁与总线冲突机制（P0）
2. ✅ 外设生命周期状态机（P0）
3. ✅ 故障注入标准接口（与 ADR-0009 对齐，P0）

### 8.2 强制整改项（必须完成后才能进入实施）

| 编号 | 整改内容 | 完成标准 |
|------|---------|---------|
| CR-001 | 补充引脚仲裁器设计，包含开漏线与逻辑计算 | 提供完整 TypeScript 接口与算法伪代码 |
| CR-002 | 补充外设生命周期接口，包含上电/断电/复位/热插拔 | 整合入 `PeripheralSimulationLogic` 接口 |
| CR-003 | 补充故障注入标准接口，与 ADR-0009 完全对齐 | 包含所有 5 种 ADR 定义的故障类型 |
| CR-003a | 明确故障注入分层架构原则（强制执行） | 物理层故障必须由 PinManager/总线控制器统一处理，外设逻辑保持纯净，不得侵入式实现物理层故障 |
| CR-004 | 明确与 Device Model Registry 的整合关系 | 提供数据流向图与字段映射表 |

### 8.3 建议改进项（可实施中逐步完善）

| 编号 | 改进内容 | 建议完成时间 |
|------|---------|-------------|
| IMP-001 | 实现仿真通路动态自适应降级策略 | MVP 后首个迭代 |
| IMP-002 | 建立 Schema 版本化与自动迁移管道 | v1.0 发布前 |
| IMP-003 | 预留在轨观测探针接口 | v1.0 发布前 |

---

## 9. 附件：四大范例驱动完整修正版

（本附件展示修正后的 LED 驱动范例，严格遵循「非侵入式中间件模式」架构原则）

### 9.1 架构说明

**核心设计原则**：外设逻辑保持纯净，物理层故障由中间件统一注入。

```text
[测试框架] → PinManager.setPinDisconnect(pin, true)
                     ↓ 透明注入
[MCU] → pal_gpio_read() → [PinManager 中间件] → LED 驱动（纯净）
                                               ↓
                                   收到高阻态电平，自动变暗
```

✅ LED 驱动**完全不知道**故障注入的存在，也不需要实现任何故障逻辑  
✅ 所有物理层故障由 PinManager 统一处理，一套代码服务所有外设  
✅ 外设开发者只需要关注「正常物理行为建模」，不需要学习故障注入框架

---

### 9.2 修正后的 LED 虚拟驱动范例（正确的非侵入式模式）

```typescript
/**
 * 修正后的 LED 虚拟驱动范例
 * 包含：引脚仲裁、生命周期、可观测性
 * 重要：物理层故障注入（断线/抖动/噪声）由 PinManager 中间件统一处理，
 *      本驱动完全不包含任何故障注入代码！
 */
WasmPeripheralRegistry.register('generic-led', {
  // ========== 引脚注册与物理逻辑 ==========
  attachEvents: (element, pinManager, getMappedPin, componentId) => {
    const anodePin = getMappedPin('Anode');
    const cathodePin = getMappedPin('Cathode');

    // 1. 向 PinManager 注册外设引脚（用于仲裁、故障注入溯源）
    if (anodePin !== null) {
      pinManager.registerPeripheralPin(
        componentId, 
        anodePin, 
        'Anode', 
        'peripheral-sink'   // LED 阳极为灌电流模式
      );
    }
    if (cathodePin !== null) {
      pinManager.registerPeripheralPin(
        componentId, 
        cathodePin, 
        'Cathode', 
        'peripheral-source'  // LED 阴极为源电流模式
      );
    }

    // 2. 纯净的物理行为建模：只根据引脚电压计算亮度
    //    故障注入（断线/抖动）完全透明，这里不需要关心！
    const updateLed = () => {
      // 使用 PinManager 仲裁后的实际电压计算亮度
      // 如果引脚被注入了"断线"故障，这里会自动收到高阻态/浮空电压
      const anodeVoltage = anodePin !== null ? pinManager.getResolvedVoltage(anodePin) : 0;
      const cathodeVoltage = cathodePin !== null ? pinManager.getResolvedVoltage(cathodePin) : 0;
      
      // 考虑 LED 正向压降（约 1.8V）与限流电阻
      const voltageAcrossLed = Math.max(0, anodeVoltage - cathodeVoltage - 1.8);
      const brightness = Math.min(1, voltageAcrossLed / 1.5);  // 非线性亮度曲线
      
      (element as any).value = brightness > 0.1;
      (element as any).brightness = brightness;
    };

    // 3. 监听引脚变化（故障注入会通过这个回调自动触发更新）
    let unsubAnode = () => {};
    let unsubCathode = () => {};
    if (anodePin !== null) {
      unsubAnode = pinManager.onPinChange(anodePin, updateLed);
    }
    if (cathodePin !== null) {
      unsubCathode = pinManager.onPinChange(cathodePin, updateLed);
    }

    return () => {
      unsubAnode();
      unsubCathode();
      // 注销引脚注册
      if (anodePin !== null) pinManager.unregisterPeripheralPin(componentId, anodePin);
      if (cathodePin !== null) pinManager.unregisterPeripheralPin(componentId, cathodePin);
    };
  },

  // ========== 生命周期钩子 ==========
  onPowerOn: async () => {
    // LED 上电无特殊延迟，直接就绪
  },

  onPropertyChange: (key, oldValue, newValue) => {
    if (key === 'currentLimitResistor') {
      // 限流电阻变更，需要更新亮度计算曲线
      console.log(`LED 限流电阻从 ${oldValue}Ω 变为 ${newValue}Ω`);
    }
    if (key === 'color') {
      // 颜色变更，更新正向压降参数
      const forwardVoltage = { red: 1.8, green: 2.2, blue: 3.0, yellow: 2.0 };
      this.ledForwardVoltage = forwardVoltage[newValue] || 1.8;
    }
  },

  // ========== 业务层故障注入（可选） ==========
  // 注意：只有业务特有故障才在这里实现！
  // 物理层故障（断线/抖动/噪声）绝对不能在这里实现！
  supportedFaults: ['led-burnout'],  // LED 烧坏是业务层特有故障

  setBusinessFault: (faultType: string, enabled: boolean, config: any) => {
    if (faultType === 'led-burnout') {
      // LED 烧坏是业务层故障：灯丝烧断，永久不亮
      this.ledBurnedOut = enabled;
      this.updateLed();  // 触发状态更新
    }
  },

  // ========== 可观测性探针 ==========
  getAvailableProbes: () => [
    { name: 'brightness', type: 'analog', unit: '%', samplingMethod: 'polling' },
    { name: 'anode-voltage', type: 'analog', unit: 'V', samplingMethod: 'polling' }
  ],

  getInternalStateSnapshot: () => ({
    brightness: this.currentBrightness,
    forwardVoltage: this.ledForwardVoltage,
    ledBurnedOut: this.ledBurnedOut  // 只有业务层故障出现在状态快照中
  })
});
```

---

### 9.3 故障注入的正确调用方式（测试框架用）

```typescript
// ✅ 正确：测试框架通过 PinManager 标准 API 注入故障
// 这是测试代码，不是外设驱动代码！
testFramework.injectFault('pin-disconnect', {
  componentId: 'led-1',
  pinName: 'Anode',
  durationMs: 5000
});

// PinManager 内部实现（对驱动透明）：
// 1. 找到 'led-1' 组件的 'Anode' 引脚编号
// 2. 将该引脚标记为"已断开"
// 3. 下次仲裁时返回高阻态电压
// 4. 触发引脚变化回调，驱动自动更新亮度
// 5. 5 秒后自动恢复
```

---

**评审完成时间**：2026-06-29
**文档状态**：待架构委员会确认
**后续跟踪**：整改项完成后重新提交复核

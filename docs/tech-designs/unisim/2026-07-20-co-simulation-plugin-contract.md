# 控制域-物理域解耦：联合仿真插件契约 — 技术设计规格

| 项 | 内容 |
|----|------|
| 状态 | **Draft（草稿，待评审）** |
| 创建日期 | 2026-07-20 |
| 范围层级 | 技术设计规格（`docs/tech-designs/`） |
| 关联设计规范 | `../04-wasm-simulation/`、`../05-frontend-workbench/` |
| 前置 ADR | ADR-0001（负数错误码）、ADR-0003（仿真保真度边界）、ADR-0009（物理行为仿真/故障注入）、ADR-0021（Wasm 器件模型归属）、ADR-0027（数据面 3 出 + 1 入）、ADR-0042（仿真执行模式） |
| 拟产出 ADR | ADR-00XX《联合仿真插件作为一等扩展单元》（本设计 Accepted 后落盘） |
| 关联仓库 | 上游 C 侧：`wink-ai-embedded/wink-micro-os`；下游 TS 侧：`wink-ai/packages/unisim`、`wink-ai/packages/embedded-frontend` |
| 负责人 | TBD |

---

## 0. TL;DR

- **现状痛点**：`unisim` 仿真内核在 `createUnisimImports.ts`（引脚 12/13 硬编码）与 `SimWorker.ts` 硬编码了 HC-SR04 特定逻辑；前端 `PeripheralDefinition` 与 `unisim/PeripheralRegistry` **两套注册表完全断联**；PWM/OLED 通过硬编码 `pal_wasm_get_ssd1306_fb` / `pal_wasm_get_pwm_duty_percent` 轮询导出。
- **目标形态**：新增一个外设 = **只提交一个外设包**（`packages/peripheral-<name>/`：manifest + Plugin + Vue Glyph + Conformance Test），核心三仓（`wink-micro-os` / `unisim` / `embedded-frontend`）零改动。
- **必须同时冻结的 5 项契约**：
  1. **Peripheral Manifest（跨三端 SSOT）**：C DAL `config_t` / 前端 `PeripheralDefinition` / Unisim `SimulationPlugin` 由同一份 manifest 派生或对账。
  2. **SimulationPlugin 生命周期**：6 态显式状态机 + 事件驱动 / 锁步 / 混合三种 `timingModel`。
  3. **PluginContext 门面**：绝对虚拟时间戳事件调度、按 `BusKind` 索引的总线代理、TypedStateChannel、FaultReporter；**不直接暴露 arbiter/clock 引用**。
  4. **Worker IPC 通用化**：删除 device-specific 消息（`SET_ULTRASONIC_DISTANCE` 等），归口到 `UPDATE_PLUGIN_PROPERTIES` / `DISPATCH_PLUGIN_EVENT` / TypedStateChannel。
  5. **Conformance Test 套件 + ABI 版本**：三方插件 `runPluginConformance(plugin)` 一行验收；manifest 声明 `abi.version`，Registry semver 校验。
- **与既有 ADR 对齐**：
  - ADR-0027：插件状态发布走 **TypedStateChannel** → 归入 ③ Actuator Observation 或 ④ 反向注入；**不新增第五种数据面**。
  - ADR-0003 / ADR-0021：插件运行在 Worker 沙箱中，禁止穿透 Wasm 边界；C 侧 DAL 保持权威接口，仅 codegen 从 manifest 派生 `config_t` / override 布局。
  - ADR-0042：插件不引入非确定性；`PluginContext.rng` 由 host 注入 seedable RNG。
  - ADR-0001：插件错误经 `FaultReporter` 归一到 `wink_status_t` 负数错误码。
- **非目标（本规格不覆盖）**：3D 渲染管线、真机 HIL 联合仿真、插件热更新/OTA、跨插件耦合（如 IMU + 车体动力学联合方程）——留待后续独立技术设计。

---

## 1. 背景与问题

### 1.1 当前实现的耦合痕迹（可搜索的硬编码点）

| 位置 | 硬编码内容 | 类型 |
|------|-----------|------|
| `packages/unisim/src/unisim/bridge/createUnisimImports.ts:315-327` | `js_pal_gpio_on_write` 内引脚 12→13 的超声 Trig-Echo 环回、echo 脉冲快进 | **具体器件逻辑穿透仿真内核** |
| `packages/unisim/src/unisim/worker/SimWorker.ts:158-161` | `ultrasonicEchoUs` / `getEchoPin` 作为 `SimWorkerOptions` 构造参数 | 内核 API 泄漏设备细节 |
| `packages/embedded-frontend/src/workers/wasm-simulation.worker.ts:227-247` | 每 tick 直调 `pal_wasm_get_ssd1306_fb` + 循环轮询 `pal_wasm_get_pwm_duty_percent` | 前端 Worker 内枚举具体外设 |
| `packages/unisim/src/unisim/core/peripheral-registry.ts`（整份） | `PeripheralRegistry` / `PeripheralInstance` / `PeripheralDriver` 定义完备但**前端未接入**，仅 `PinArbiter` + `VirtualClock` 被使用 | **双注册表断联** |
| `packages/embedded-frontend/src/peripherals/observe-builder.ts:14-15` | `watchUltrasonic` 已被标注 `@deprecated`，但 protocol 里仍存在 `ultrasonicConfig` | 过渡期语义残留 |

### 1.2 三处 Schema 各自定义（未来一定不一致）

同一台 HC-SR04：

| Layer | 位置 | Schema 形式 |
|-------|------|-------------|
| C DAL | `wink-micro-os/dal/include/sensor/dal_ultrasonic.h` | `dal_ultrasonic_config_t { trig_pin, echo_pin, use_rmt }` + `apply_override` 4B 二进制布局 |
| Frontend | `wink-ai/packages/embedded-frontend/src/peripherals/ultrasonic/definition.ts` | `UnifiedPinDef[]` + `PeripheralPropsSchema` |
| Unisim | `createUnisimImports.ts` 硬编码 + 若走原方案则新增 `SimulationPlugin.onBind` | `Record<string, any>` |

**根本风险**：任一处修改（例如 `dal_ultrasonic_config_t` 增字段），必须三处联动，且**没有编译期或 CI 兜底**。这是"半年后又累积同样债务"的根本成因。

### 1.3 目标与约束

**目标（可验证）：**

- **G1**. 新增一个外设 = 一个 monorepo 包，核心三仓零改动。
- **G2**. Manifest 是三端 schema 的**唯一事实来源**；CI 校验对账。
- **G3**. 插件契约同时支持事件驱动（HC-SR04）、锁步（车辆运动学）、混合（编码器 + PWM）三种时序模型。
- **G4**. 三方插件通过 `runPluginConformance(plugin)` 一行获得契约级验收。
- **G5**. 无匿名 `postStateUpdate(Record<string, any>)` 逃逸口；状态发布全部走 TypedStateChannel。
- **G6**. 电源/复位/故障语义与 wink-micro-os `wink_status_t` 负数错误码（ADR-0001）对齐。

**硬约束：**

- **C1**. ADR-0003：物理旁路仅允许在 DAL 内以 `SIMULATION` 宏收敛；插件禁止读写 Wasm 线性内存。
- **C2**. ADR-0021：所有设备模型运行在 Worker 侧，与 Wasm 隔离。
- **C3**. ADR-0027：**不新增第五种数据面**；插件状态发布归入 ③（执行器语义）或反向注入。
- **C4**. ADR-0042：插件不得引入非确定性行为（无 `Date.now` / `Math.random`）；随机源由 `PluginContext.rng` 提供并可 seed。
- **C5**. 与 wink-micro-os `pal_resource` / `device_tree` 引脚占用模型一致（不发明两套冲突检测）。
- **C6**. ADR-0001：插件错误经 `FaultReporter` 归一到 `wink_status_t` 负数错误码。

### 1.4 行为权威归属裁定（ADR-0021 张力的正式回应）

> **本节是 Phase 0 ADR 评审的必答项。** ADR-0021 决议"所有外设行为模型写在 C 侧、运行在 Wasm 内，JS 侧仅做 setter 注入 + getter 提取"。本设计将器件行为（echo 时序、运动学积分）下沉到 TS 侧 Plugin，表面上与 ADR-0021 冲突。此处显式裁定边界，消除后续争议。

**核心区分：接口权威 ≠ 行为权威。**

| 维度 | 权威归属 | 说明 |
|------|---------|------|
| **接口权威** | **C 侧 DAL（不变）** | API 签名、`config_t` 布局、`wink_status_t` 错误码语义、事件类型（如 `WINK_EVENT_DISTANCE_READY`）。真机与仿真共用同一接口。 |
| **真机行为权威** | **物理世界** | echo 脉冲由真实声波往返产生；轮速由真实电机产生。C 侧驱动只是读取/驱动硬件寄存器。 |
| **仿真行为权威** | **TS 侧 Plugin（仅 `SIMULATION` 模式）** | echo 时序、运动学积分等"物理世界会如何响应激励"的模型。 |

**为什么行为模型放 TS 侧而非 C 侧（与 ADR-0021 的调和）：**

1. ADR-0021 的原始语境是**器件的寄存器级/协议级行为**（如 I2C 应答、GPIO 电平），这类行为**真机与仿真同源**，理应在 C 侧同源编译测试（ADR-0003 的"Bypass 范围收窄"）。本设计**不动这部分**——C 侧 DAL 的协议逻辑照旧走 Wasm。
2. Plugin 承载的是**器件外部的物理世界模型**（声波传播、刚体运动学、热扩散）。这部分在真机上**根本不存在于 MCU 代码里**（它发生在 MCU 之外的物理空间），因此不适用"C 侧同源"原则——真机上没有对应的 C 代码可对齐。
3. 二者的对齐点是 **DAL 接口**（激励进、观测出），而不是实现。即：`SIMULATION` 模式下 C 侧 DAL 通过 PAL 边界把激励（TRIG 上升沿）交给 Plugin，Plugin 回灌观测（ECHO 脉冲）；真机模式下同一个 DAL 接口对接 RMT 硬件。

**一句话结论（写入 ADR-00XX）：**
> C 侧 DAL 是**接口与协议权威**；TS 侧 Plugin 是**器件外部物理世界的仿真行为权威**，仅在 `SIMULATION` 模式生效。二者通过 DAL 接口对齐，而非通过实现对齐。ADR-0021 约束的"器件协议行为"仍留在 C/Wasm 内，本设计不触碰。

**边界自检清单（Phase 1 pilot 验证）：**

- [ ] HC-SR04 的 I2C/GPIO 协议时序仍在 C 侧 DAL（`dal_ultrasonic.c`）——✅ 未下沉。
- [ ] HC-SR04 的"距离 → echo 脉宽"物理映射在 TS Plugin——✅ 属物理世界模型。
- [ ] 真机路径不加载任何 Plugin，行为由 RMT 硬件提供——✅ Plugin 仅 `SIMULATION`。

### 1.5 与 sim-observation-layers（M0–M6）的关系

> sim-observation-layers（ADR-0027 / tech-design `2026-07-12`）已落地 UI bind 与 inject 的插件化机制，含 ESLint 架构守护与 278 项测试。本设计与其存在功能重叠，此处显式声明归并关系，**避免 Phase 1–2 出现"两套插件机制并存"的混乱期**。

| M 阶段既有机制 | 本设计的处置 | 归并去向 |
|---------------|-------------|---------|
| **M2** `definition.ui.canvasProps / worldProps` | **保留**，作为前端 UI 绑定层契约 | 不变；`PluginContext` 不侵入 UI 层，UI 仍通过 `SimViewContext` 消费 |
| **M3** `PeripheralSimulationInject`（`gpio_ideal` / `ultrasonic_distance`） | **取代** | `manifest.hostInjections` + IPC `DISPATCH_PLUGIN_EVENT` |
| **M4** `observeDisplay` / `displayKinds`（`ssd1306_fb`） | **归并** | `stateChannels` 的 `fb: Uint8Array` → STATE_UPDATE 通道 ② `displayPayloads` |
| **M5/M6** `actuatorObserve` / `actuatorConverterRegistry` | **归并** | `stateChannels` 声明的执行器语义 → STATE_UPDATE 通道 ③ `actuatorObservations` |
| `ObserveBuilder.watchGpio/watchI2C` | **内部化** | Host 从 `manifest.pins` + `capabilities.buses` 自动派生观察集，不再需要外设手动 `watch*` |

**分层职责再申明（消除重叠）：**

- **UI 绑定层**（M2 保留）：`CircuitComponentInstance + SimViewContext → 渲染 props`，运行在**主线程**，纯展示映射，无物理逻辑。
- **仿真行为层**（本设计新增）：`SimulationPlugin`，运行在 **Worker**，承载物理模型 + 状态发布。
- 二者通过 `TypedStateChannel`（Worker → 主线程）单向连接；UI 层**只读** channel，不反向写 Plugin。

**迁移顺序约束**：Phase 1 迁移 HC-SR04 时，M3 的 `inject` 适配层与 `hostInjections` **并存一个 minor 版本**（§10.2），M3 API 内部转发到 `DISPATCH_PLUGIN_EVENT`；确认 avoidance_car E2E 全绿后再摘除 M3 分支，杜绝并存期长期化。

---

## 2. 高阶架构

```
+------------------------------------------------------------------+
|  App Control Domain (Wasm / C)                                   |
|  wink-micro-app + wink-micro-os DAL / PAL                        |
+---------------------------+--------------------------------------+
                            | Wasm imports/exports (Asyncify)
                            v
+------------------------------------------------------------------+
|  Platform Sim Kernel  (unisim, Worker inside)                    |
|  +-------------+ +-----------+ +-------------+ +--------------+  |
|  | VirtualClock| | PinArbiter| | BusRegistry | |InterruptQueue|  |
|  +-------------+ +-----------+ +-------------+ +--------------+  |
|             ^                                                    |
|             | PluginContext (facade, methods only, see 4.2)      |
|             v                                                    |
|  +----------------------------------------------------------+    |
|  | SimulationPluginHost                                     |    |
|  |  - load manifest, validate ABI version                   |    |
|  |  - schedule by timingModel (event / step-lock / hybrid)  |    |
|  |  - TypedStateChannel aggregation + rate limit            |    |
|  |  - WCET budget, capability enforcement, fault normalize  |    |
|  +----------------------------------------------------------+    |
|             ^              ^              ^                      |
+-------------+--------------+--------------+----------------------+
              |              |              |
   +----------+----+  +------+--------+  +--+---------------------+
   | HC-SR04 Plugin|  | OLED SSD1306  |  | SmartCar Kinematics    |
   | (event)       |  | (event)       |  | (step-lock)            |
   +---------------+  +---------------+  +------------------------+

+------------------------------------------------------------------+
|  Frontend UI  (embedded-frontend, main thread)                   |
|  Canvas Glyph / World Widget / Inspector — 通过 TypedStateChannel|
|  订阅插件状态；通过 IPC 反向调用 UPDATE_PLUGIN_PROPERTIES 与     |
|  DISPATCH_PLUGIN_EVENT。                                         |
+------------------------------------------------------------------+
```

**关键改动一览：**

1. `unisim` 内核（PinArbiter/VirtualClock/BusRegistry/InterruptQueue）保持**器件无关**。所有具体器件行为下沉到 Plugin。
2. `unisim/PeripheralRegistry` 升级为 `SimulationPluginHost`，与前端 `PeripheralRegistry` 由同一份 manifest 派生。
3. `createUnisimImports.ts` 移除 `js_pal_gpio_on_write` 内的 12/13 分支——通用化为"通知 Host 有引脚变化，Host 广播给订阅了该引脚的插件"。
4. 前端 Worker `wasm-simulation.worker.ts` 不再枚举具体 `pal_wasm_get_*`；改为聚合 `TypedStateChannel` 快照上报主线程。
5. C 侧 `wink-micro-os/dal/*` 不变；`tools/codegen` 从 manifest 派生 `dal_xxx_config_t` 与 `apply_override` 布局，CI 对账。

---

## 3. 契约 1：Peripheral Manifest（跨三端 SSOT）

### 3.1 文件位置与命名

```
packages/peripheral-<kebab-name>/
├── peripheral.manifest.json      # SSOT，本节规范
├── src/
│   ├── <Name>SimulationPlugin.ts # Unisim 插件
│   ├── CanvasGlyph.vue           # 前端画布
│   ├── WorldWidget.vue           # 世界视图
│   └── InspectorExtra.vue        # 属性面板扩展
├── tests/
│   ├── plugin.conformance.test.ts
│   └── plugin.behavior.test.ts
└── package.json                  # peer deps: @wink/unisim ^1, @wink/embedded-frontend ^1
```

### 3.2 Manifest Schema（JSON Schema 摘要）

```jsonc
{
  "$schema": "https://wink.ai/schemas/peripheral.manifest.v1.json",
  "type": "ultrasonic",
  "displayName": "HC-SR04 Ultrasonic",
  "category": "sensor",
  "abi": {
    "version": "1.0.0",
    "unisim":   "^1.0.0",
    "frontend": "^1.0.0",
    "micro-os": "^0.2.0"
  },
  "catalog": {
    "id": "hc-sr04",
    "worldCoupling": "required",
    "allowedSensorMappings": ["raycast_range_cm"]
  },
  "size": { "width": 180, "height": 100 },
  "pins": [
    { "name": "VCC",  "direction": "POWER",  "signal": "power",   "required": true,  "voltage": "5V"  },
    { "name": "TRIG", "direction": "SINK",   "signal": "digital", "required": true,  "wireNet": "secondary" },
    { "name": "ECHO", "direction": "SOURCE", "signal": "digital", "required": true,  "wireNet": "primary"   },
    { "name": "GND",  "direction": "GROUND", "signal": "power",   "required": true }
    // 模拟量引脚示例（LDR/电位器）：
    // { "name": "AIN0", "direction": "SINK", "signal": "analog", "required": true, "voltage": "3V3", "adcResolutionBits": 12, "maxMv": 3300 }
  ],
  "properties": {
    "distance": {
      "type": "number",
      "default": 25,
      "range": [2, 400, 1],
      "unit": "cm",
      "description": "Simulated obstacle distance"
    }
  },
  "timingModel": "event-driven",
  "power": {
    "domain": "SWITCHABLE",         // ALWAYS_ON | SWITCHABLE | BATTERY_BACKED
    "powerUpDelayUs": 5000,          // 上电到 Ready 的虚拟时间延迟
    "brownoutThresholdMv": 3000      // 低于此电压进入 PowerFault（可选，未声明则不建模 brownout）
  },
  "capabilities": {
    "buses": [],
    "clocks": ["virtual"],
    "wcetBudgetMs": {                // 宿主侧真实执行时间预算（毫秒），见 §7.3
      "onPinChange": 0.5,
      "onStep": 1.0
    }
  },
  "stateChannels": {
    "distance":    { "type": "number",  "unit": "cm", "rateHzMax": 100 },
    "echoActive":  { "type": "boolean" },
    "measuring":   { "type": "boolean" }
  },
  "hostInjections": [
    {
      "name": "SET_DISTANCE",
      "params": { "cm": { "type": "number", "range": [2, 400] } }
    }
  ],
  "codegen": {
    "cConfigStruct": "dal_ultrasonic_config_t",
    "cHeader": "dal/include/sensor/dal_ultrasonic.h",
    // offset 默认由 codegen 按目标平台对齐规则自动计算；仅在需要与既有固件二进制
    // 兼容时用可选的 fixedOffset 覆盖（见 §3.5）。
    "overrideLayout": [
      { "field": "trig_pin", "type": "u16", "mapFromPin": "TRIG" },
      { "field": "echo_pin", "type": "u16", "mapFromPin": "ECHO" }
    ]
  },
  "simulation": {
    "pluginEntry": "./src/UltrasonicSimulationPlugin.ts"
  },
  "ui": {
    "canvasGlyph": "./src/CanvasGlyph.vue",
    "worldWidget": "./src/WorldWidget.vue",
    "inspectorExtra": "./src/InspectorExtra.vue"
  }
}
```

### 3.3 派生规则（每一端从 manifest 拿什么）

| 消费者 | 派生输出 | 派生工具 | CI 校验 |
|--------|---------|---------|---------|
| C DAL / wink-micro-os | `dal_xxx_config_t` 结构体 + `apply_override` 反序列化代码 + `WINK_USE_XXX` 宏 | `wink-tools/tools/codegen/from_manifest.py` | 生成物与手工 `dal_xxx.h` diff = 0；破坏性变更需要 ABI 版本 bump |
| Frontend Registry | `PeripheralDefinition`（`pins` / `props` / `catalog` / UI 引用） | `packages/embedded-frontend/build/manifest-loader.ts` | 运行时校验 default 值符合 range；类型收窄 |
| Unisim PluginHost | 加载 `pluginEntry`、注入 `capabilities`、初始化 TypedStateChannel、pin whitelist | `packages/unisim/src/plugin-host/loadFromManifest.ts` | ABI semver 校验；capability 声明与实际调用对账（见 §7） |

**CI 门禁（三端对账，缺一不可）：**

- **G1-Check**：manifest → 三端派生 → 运行既有单元测试，全部通过。
- **G2-Check**：`peripheral.manifest.json` 是 codegen 输出的 SSOT；任何手工修改 `dal_xxx_config_t` 字段但不同步 manifest → CI 报 `manifest-drift`。
- **G3-Check**：`abi.version` 与依赖 `unisim/frontend/micro-os` semver 兼容性由 `wink lint peripherals` 校验。

### 3.4 字段语义关键点

- **`pins[].direction`**：与 `unisim/PeripheralRegistry` 的 `PinDirection` 枚举（SOURCE / SINK / BIDIRECTIONAL / POWER / GROUND）一致；直接进 `checkPinConflictForMapping` 冲突矩阵。
- **`timingModel`**：`event-driven` | `step-lock` | `hybrid`（三选一，见 §4.3）。**不允许缺省**——手工声明是防止插件作者误用 `onStep` 造成性能悬崖的第一道门。
- **`power`**：对齐 wink-micro-os 电源域概念（见 §3.6）；`domain` 缺省 `SWITCHABLE`，`brownoutThresholdMv` 缺省不建模。
- **`capabilities.buses`**：声明"我要用什么总线"；未声明就调用 `ctx.bus.i2c(0)` / `ctx.bus.pwm(0)` → `PluginCapabilityViolation`。支持的总线：`i2c` / `spi` / `uart` / `pwm` / `can`。
- **`capabilities.analog`**：声明"我要用模拟量引脚"；未声明调用 `ctx.pin.readAdcMv()` / `writeDacMv()` → `PluginCapabilityViolation`。
- **`capabilities.wcetBudgetMs`**：每次钩子的**宿主侧真实执行时间**预算（毫秒）；超预算 → 记录 fault + 降级（不硬 kill 插件，见 §7.3）。**注意单位是真实毫秒，不是虚拟微秒**（见 §7.3 单位裁定）。
- **`stateChannels`**：**唯一**的状态发布通道，类型化；`postStateUpdate(Record<string, any>)` 彻底废除。
- **`hostInjections`**：宿主 → 插件的反向调用清单；替代 `SET_ULTRASONIC_DISTANCE` 之类的 device-specific IPC。

### 3.5 `codegen.overrideLayout` 的 offset 策略（评审补充）

`overrideLayout` 只声明**字段顺序与类型**（`field` / `type` / `mapFromPin`），**offset 由 codegen 依据目标平台对齐规则自动计算**（对齐 `.claude/rules/c-code.md` 的自然对齐、降序排列约定）。理由：manifest 应描述语义而非物理布局；一旦 C 侧对齐规则变化（4B→2B），手写 offset 全部作废。

- **默认**：无 `offset` 字段；codegen 生成 offset 并写入 `generated/dal_<name>_config.h` 注释。
- **例外**：需与既有固件二进制/Flash blob 兼容时，用可选 `fixedOffset` 显式钉死：
  ```jsonc
  { "field": "trig_pin", "type": "u16", "mapFromPin": "TRIG", "fixedOffset": 0 }
  ```
  - `fixedOffset` 出现即触发 CI 校验：codegen 计算值 ≠ `fixedOffset` → 报 `layout-conflict`（提示对齐规则或字段顺序不一致）。
  - 一个 manifest 内 `fixedOffset` 必须**全有或全无**（禁止半声明，避免歧义）。

### 3.6 `power.domain` 与 wink-micro-os 电源域映射（评审补充，回应 R5）

| manifest `power.domain` | wink-micro-os 概念 | 语义 |
|-------------------------|--------------------|------|
| `ALWAYS_ON` | MCU 主供电域 | 随系统上电，不可软关断 |
| `SWITCHABLE` | 软件可控电源开关 | 可 `powerOn/powerOff`，有 `powerUpDelayUs` |
| `BATTERY_BACKED` | RTC/VBAT 域 | `reset()` 时保留状态（不清零累计量，见 §4.1 cold vs warm） |

- `PeripheralRegistry.PowerDomain`（现有 `VCC_3V3 / VCC_5V / VBAT / SWITCHABLE`）在 Phase 0 提供一份映射表；短期未明确者以 `SWITCHABLE` 兜底。
- `brownoutThresholdMv`：宿主注入的供电电压低于阈值 → 插件转 `PowerFault`（建模掉电），为后续"电池仿真"留口子。

---

## 4. 契约 2：SimulationPlugin 生命周期

### 4.1 6 态状态机

```
   Unbound
      |
      | onBind(ctx, pinMappings, properties)
      v
    Bound  <-------------------.
      |                        |
      | Host.powerOn()         | Host.reset()
      v                        |
  PoweringUp                   |
      |                        |
      | (powerUpDelayUs elapsed)
      v                        |
    Ready  <-------------------+
      |     .------------------|
      | fault/brownout          |
      v                        |
  PowerFault --recover--> PoweringUp
      |
      | Host.powerOff()
      v
   PoweredOff
      |
      | Host.unbind()
      v
   Unbound
```

**转换保证：**

- 除 `Unbound → Bound` 外，每个转换都对应插件的一个 `onStateChange(prev, next)` 回调。
- `PowerFault` 是显式一等状态，用于建模：ESP32 brown-out、I2C NACK、传感器上电失败（对齐 `dal_ultrasonic_init` 返回 `WINK_ERR_IO`）。
- `Ready` 是唯一允许接受 `onPinChange` / `onStep` / 宿主注入的状态；其他状态下钩子被 Host 拦截。
- `reset()` 保留 pin mapping 与 properties，重置内部状态（对齐 `PeripheralDriver.onReset` 语义）。

**`PowerFault → PoweringUp`（recover）触发条件（评审补充）：**

- **不自动重试**。恢复只由以下之一显式触发：
  1. 宿主 `RESET` 消息（全局复位）；
  2. 供电电压回升到 `brownoutThresholdMv` 以上后，宿主显式 `powerOn(instanceId)`；
  3. WCET 连续超限导致的 `PowerFault`（§7.3），同样需宿主显式恢复。
- 理由：自动重试会掩盖真实硬件的"需人工干预"故障语义，也可能造成 fault→recover→fault 抖动风暴。

**Cold boot vs Warm reset（对齐 `power.domain`）：**

- `BATTERY_BACKED` 域：`reset()` 为 **warm reset**，保留累计量（里程、RTC 计数）。
- 其他域：`reset()` 为 **cold boot**，清空所有内部状态到初 bind 值（conformance L7 校验）。

### 4.2 插件接口（`SimulationPlugin`）

```typescript
// packages/unisim/src/plugin/types.ts
export interface SimulationPlugin<S extends StateChannelMap = StateChannelMap> {
  /** 唯一标识：与 manifest.type 一致 */
  readonly type: string;
  /** 声明性 timingModel：与 manifest 一致；Host 用此决定调度类别 */
  readonly timingModel: TimingModel;

  // ---- 生命周期 ----
  onBind(ctx: PluginContext<S>, pinMappings: PinMappingSnapshot, properties: PropertySnapshot): void;
  onUnbind?(): void;

  onStateChange?(prev: PluginState, next: PluginState): void;

  /** 属性面板修改 —— 由 UPDATE_PLUGIN_PROPERTIES 触发 */
  onPropertyChange?(key: string, oldValue: unknown, newValue: unknown): void;

  /** 宿主反向注入（对应 manifest.hostInjections） */
  onHostInjection?(name: string, params: Record<string, unknown>): void;

  // ---- 时序钩子（按 timingModel 至少实现一个）----

  /**
   * 事件驱动：Host 只在插件声明的 SINK/BIDIRECTIONAL 引脚上分发。
   *
   * 同步/异步约束（见 §4.6）：
   *   - event-driven 模型：可返回 void（同步）或 Promise<void>（异步）。返回 Promise
   *     时 `ctx` 在 Promise settle 前保持有效；Host 在 settle 后才失效 ctx。
   *   - step-lock / hybrid 模型：**必须同步返回 void**（异步会破坏锁步确定性）。
   */
  onPinChange?(pin: number, level: boolean, atUs: bigint): void | Promise<void>;

  /** 锁步：Host 根据 stepPeriodUs 或全局 dt 调用。**必须同步返回**（Q2 结论）。 */
  onStep?(nowUs: bigint, dtUs: bigint): void;

  /**
   * I2C 事务命中（如果 capabilities.buses 声明了 i2c）。
   * 同步返回 ACK/NACK；需要多字节状态机的器件在内部缓存状态。
   */
  onI2CTransaction?(port: number, addr: number, wbuf: Uint8Array, rbuf: Uint8Array): boolean;
}

export type TimingModel = 'event-driven' | 'step-lock' | 'hybrid';
export type PluginState = 'Unbound' | 'Bound' | 'PoweringUp' | 'Ready' | 'PowerFault' | 'PoweredOff';
```

### 4.3 三种 timingModel 的调度语义

| Model | Host 行为 | 典型器件 | 反例（不该选这个 model） |
|-------|-----------|---------|-------------------------|
| **event-driven** | 只在 `onPinChange` / `onI2CTransaction` / `onHostInjection` 时被激活；**不进 step 循环** | HC-SR04、按钮、OLED、大部分总线传感器 | 车辆运动学（无引脚事件驱动状态推进） |
| **step-lock** | Host 按 `stepPeriodUs` 定期调用 `onStep`；用小根堆维护多插件的截止时间 | 两轮差速小车运动学、GPS 位置积分、热力学 | 按钮（事件驱动更省 CPU） |
| **hybrid** | 二者兼有：`onPinChange` 处理离散事件，`onStep` 推进连续量 | 编码器（PWM 输入 + 距离积分）、伺服（PWM + 位置动力学） | 简单开关（用 event-driven 更清晰） |

### 4.4 确定性顺序（每次 `STEP_CLOCK(dt)` 的 5 步 pipeline）

现状 `SimWorker.handleStepClock` 只有两步（`bridge.advanceClock` + `clock.advance`），需要扩展为：

```
STEP_CLOCK(dt) 处理顺序（顺序不可交换，写入 ADR）：

  1. bridge.advanceClock(dt)            // Wasm s_virtual_us 前进
  2. Host.tickStepLockPlugins(dt)       // step-lock/hybrid 插件按截止时间排序调用 onStep
  3. Host.flushPinScheduler(now)        // 处理已到期的 schedulePinChangeAt 事件（可能触发 onPinChange 级联，见 §4.4.1）
  4. clock.advance(dt)                  // 解决 JS pending sleep（可能再次触发引脚事件）
  5. Host.flushStateChannels()          // 汇聚 TypedStateChannel 快照 + 翻转黑板双缓冲（§4.7），postMessage 主线程
```

**为什么必须固定顺序：**

- 步骤 2 → 3：`onStep` 内部可以 `ctx.pin.schedulePinChangeAt(...)`，产生的引脚事件必须在同一 dt 内 flush。
- 步骤 3 → 4：`onPinChange` 内部可以 `clock.sleepUs(...)`，其 pending promise 由步骤 4 解决。
- 步骤 5 最后：确保主线程看到的状态是一致快照，不会读到"半更新"。

#### 4.4.1 级联深度与传播延迟模型（评审补充）

步骤 3 flush 时触发的 `onPinChange` 内部可再次 `schedulePinChangeAt`，多个插件链式依赖（A→B→C）会导致单次 `STEP_CLOCK` 内需要多轮 flush。为避免无界级联或死循环，**采用"下一 dt 传播"模型作为默认，级联深度作为硬上限保护**：

| 策略 | 规则 | 保真度影响（ADR-0003 允许行为级近似） |
|------|------|--------------------------------------|
| **默认：下一 dt 传播** | 本次 `flushPinScheduler` 内**新产生**的、`atUs` 落在**未来 dt** 的 pin event，排入后续 dt；只有 `atUs <= now` 的到期事件在本轮处理 | 每一级插件间引入 ≤1 个 tick 的传播延迟，等价于真实硬件的门延迟/传播延迟——**符合物理直觉**，且天然消除死循环 |
| **同 dt 级联（同时刻事件）** | 同一 `atUs == now` 的级联事件在本轮多次 flush 处理 | 需要 `MAX_CASCADE_DEPTH` 保护 |

**硬上限保护：**

- `MAX_CASCADE_DEPTH = 8`（同一 `now` 时刻的 flush 迭代上限）。
- 超出：Host 截断本轮级联，记录 `ctx.fault.report(WINK_ERR_TIMEOUT, 'pin cascade depth exceeded')` + trace event `plugin.cascade.overflow`，并将剩余事件延后到下一 dt（不丢弃，保证不静默）。
- 该上限可在 `INIT` 时由项目配置覆盖（复杂拓扑放宽，但记录 warning）。

**确定性保证**：同一 `now` 时刻内多个到期事件的处理顺序，按 `(atUs, pin, 插件注册序)` 三元组字典序排序，跨机器可复现。

### 4.5 时间戳的绝对语义

**取消原方案中的 `schedulePinChange(pin, delayUs, level)`（相对偏移）；一律使用绝对虚拟时间戳：**

```typescript
interface PinScheduler {
  /** 绝对虚拟时间戳；atUs < now → 抛 PluginContractViolation */
  schedulePinChangeAt(pin: number, atUs: bigint, level: boolean): void;
}

// 便利函数（Host 侧提供，不进契约）
ctx.pin.after(deltaUs, pin, level)   // = schedulePinChangeAt(now + deltaUs, pin, level)
```

**理由**：跨机器/跨调度器回放时，相对偏移在插件本地叠加会造成累计误差；绝对时间戳与 `VirtualClock` 是同一坐标系，直接可回放。

### 4.6 异步钩子与 `ctx` 失效时机（评审补充）

§7.4 的 `ctx` Proxy "钩子返回后立即失效"策略对同步钩子成立；对异步钩子需精确定义，否则 `onPinChange` 内发起 `bus.i2c(port).transferAsync` 后，async 回调再访问 `ctx.state.publish` 会命中已失效 Proxy。

**规则（按 timingModel 分档）：**

| timingModel | `onPinChange` 返回类型 | `ctx` 失效时机 | 总线事务 |
|-------------|----------------------|---------------|---------|
| **event-driven** | `void` 或 `Promise<void>` | Promise settle 后（同步钩子则返回后） | 允许 `transferAsync`；Host 在 async 边界内保持 ctx 有效 |
| **step-lock** | 仅 `void`（同步） | 返回后立即失效 | 仅同步 `transfer`（ACK/NACK 即时返回） |
| **hybrid** | `onPinChange` 可异步，`onStep` 必须同步 | 分别按上两行 | 事件路径可异步，锁步路径同步 |

**实现约束：**
- 异步 `onPinChange` 的 Promise 由 Host 在**步骤 3 内 await**（同一 dt 边界），因此异步事务的虚拟时间**不推进**——它建模的是"零虚拟耗时的宿主计算"，而非"占用虚拟时间的总线传输"。若需建模总线传输耗时，用 `schedulePinChangeAt` 显式安排未来事件。
- 锁步插件试图返回 Promise → Host 检测到并抛 `PluginContractViolation`（conformance L10 覆盖）。

### 4.7 黑板（Blackboard）双缓冲语义（评审补充，跨插件耦合基础）

`ctx.state.snapshot()` 用于跨插件读取（如 Kinematics 读 IMU 的 `acceleration`）。若无明确语义，读到的是本 dt 还是上一 dt 的值取决于插件调度顺序 → 非确定性。**引入双缓冲黑板：**

- `ctx.state.snapshot(channel)` **始终返回上一 dt 结束时（步骤 5 翻转后）的稳定快照**（读 back buffer）。
- 本 dt 内 `ctx.state.publish(...)` 写入 front buffer，对其他插件**不可见**，直到步骤 5 `flushStateChannels` 翻转缓冲。
- 结论：**同一 dt 内所有插件看到的输入一致，与调度顺序无关**——这是确定性联合仿真的关键保障，也是 §11 Q3 跨插件耦合的落地机制。
- 代价：跨插件信号引入固定 1 tick 延迟。对 1ms 级 `stepPeriodUs` 的运动学-传感器耦合可忽略；若某耦合对延迟敏感，应合并为单个 `hybrid` 插件而非拆分。

### 4.8 模拟量/ADC 信号（补充：最大的结构性缺口）

**背景**：当前契约仅支持数字量（0/1/HI-Z）和总线（I2C），但嵌入式系统中 40%+ 的外设是**模拟量**：电位器、光敏电阻（LDR）、热敏电阻（NTC）、电池电压采样、麦克风、电流传感器。它们既不是数字引脚也不是总线——不补的话，第二个外设（比如旋钮调光）就会打破契约。

**Manifest 扩展**（§3.2 pins 字段，对齐现有 schema 风格）：

```typescript
pins: Array<{
  name: string;
  direction: PinDirection;           // SOURCE/SINK/BIDIRECTIONAL/POWER/GROUND
  signal: 'digital' | 'i2c' | 'power' | 'analog';  // + 'analog'
  required: boolean;
  wireNet?: string;
  voltage?: '3V3' | '5V';            // 模拟量参考电压，未声明则全局默认
  adcResolutionBits?: number;        // 12位/10位/8位，未声明则全局默认
  minMv?: number;                    // 输入范围下界（mV），用于归一化
  maxMv?: number;                    // 输入范围上界（mV），用于归一化
}>
```

**语义规范**：

- **`SINK + analog`**：插件只允许读（ADC 采样）；调用 `ctx.pin.readAdcMv(pin)` 返回毫伏数（0–`maxMv`）。
- **`SOURCE + analog`**：插件只允许写（DAC/PWM 输出）；调用 `ctx.pin.writeDacMv(pin, mv)` 设定输出毫伏数。
- **`onAdcChange`**：模拟量跳变（如跨阈值）触发回调；与 `onPinChange` 类似但传 `mv` 而非 `level`。
- **PinArbiter 内部扩展**：从 4-value（0/1/HI-Z/conflict）扩展为 `{ digital: LogicState | null; analog: number | null }` 两字段独立；数字量与模拟量不冲突（各自仲裁）。

**与物理保真度对齐（ADR-0003）**：
- Host 级注入：主线程可以通过 `SET_PIN_ANALOG` IPC 消息给模拟引脚灌入理想 mV 值（对齐按钮/超声的注入模式）。
- 噪声模型：`ctx.pin.readAdcMv()` 默认返回注入的理想值；插件可自行叠加高斯噪声（使用可 seed RNG `ctx.rng.gaussian(sigma)`，保证确定性）。
- 抖动/量化：ADC 量化噪声由 Host 层统一叠加，插件无需关心——插件读到的已是"物理世界采样值"。

**迁移兼容性**：现有数字量外设的 pin schema 完全兼容，增量式扩展，不返工 Phase 1 pilot。

---

## 5. 契约 3：PluginContext 门面

### 5.1 设计原则

- **门面（Facade），不是句柄**：插件**只能**通过 `ctx.xxx.yyy(...)` 调用方法；`PinArbiter`、`VirtualClock`、`I2CBus` **不作为字段直接暴露**。
- **能力最小化**：每个方法都对应 manifest 里的一条 capability 或 pin 声明；越权直接抛 `PluginCapabilityViolation` / `PinAccessDenied`。
- **确定性**：所有随机、时间、Bus 事件都经 `ctx` 派发；插件禁止 `import` 全局 `Math.random` / `Date.now` / `performance.now`（由 ESLint 规则强制）。

### 5.2 接口

```typescript
export interface PluginContext<S extends StateChannelMap = StateChannelMap> {
  // ---- 身份 ----
  readonly instanceId: string;
  readonly manifest: Readonly<PeripheralManifest>;

  // ---- 时间（只读）----
  now(): bigint;                     // 当前虚拟微秒
  readonly rng: SeedableRng;         // seedable，来自 host

  // ---- 引脚（受 pinMappings 白名单约束）----
  readonly pin: {
    read(pin: number): boolean;                                     // 只允许读 pinMappings 中出现的 pin（数字量）
    driveHigh(pin: number, strength?: DriveStrength): void;         // 只允许写 SOURCE / BIDIRECTIONAL（数字量）
    driveLow(pin: number, strength?: DriveStrength): void;
    release(pin: number): void;                                     // HI-Z
    onChange(pin: number, cb: (level: boolean, atUs: bigint) => void): Unsubscribe;
    schedulePinChangeAt(pin: number, atUs: bigint, level: boolean): void;
    readAdcMv(pin: number): number;                                 // 读取模拟量毫伏数（§4.8）
    writeDacMv(pin: number, mv: number): void;                      // 输出模拟量毫伏（§4.8，如 PWM 转模拟）
    onAdcChange(pin: number, cb: (mv: number, atUs: bigint) => void): Unsubscribe;
  };

  // ---- 总线（受 capabilities.buses 白名单约束）----
  readonly bus: {
    i2c(port: number): I2CBusHandle;         // capabilities 未声明 'i2c' → 抛
    // 后续扩展：spi(port), uart(port), can(port)
  };

  // ---- 状态发布（受 stateChannels 白名单约束、rateHzMax 限流）----
  readonly state: {
    /** 写 front buffer；本 dt 内对其他插件不可见（黑板双缓冲，§4.7） */
    publish<K extends keyof S>(channel: K, value: S[K]): void;
    /** 读 back buffer：始终返回上一 dt 结束时的稳定快照（跨插件读取，§4.7） */
    snapshot<K extends keyof S>(channel: K): S[K] | undefined;
  };

  // ---- 故障归一 ----
  readonly fault: {
    /** code 对齐 wink_status_t 负数错误码；msg 结构化 */
    report(code: WinkStatusCode, msg: string, ctx?: Record<string, unknown>): void;
  };

  // ---- 观测（trace / debug）----
  readonly trace: {
    event(name: string, payload?: Record<string, unknown>): void;   // 归入 wink-micro-os trace 时间线
  };
}
```

### 5.3 与 wink-micro-os `pal_resource` 对齐

- 插件 `onBind` 时，Host 向 wink-micro-os codegen 输出的 `pin-ownership.json` 交叉核对；仿真侧冲突判定与真机侧完全一致（消灭 `PeripheralRegistry.checkPinConflictForMapping` 与 `pal_resource` 两套规则并存的可能）。
- 冲突分级：
  - HARD：`SOURCE` vs `SOURCE` → 直接拒绝 `powerOn`（对齐 `WINK_ERR_RESOURCE_EXHAUSTED`）。
  - WARN：`SOURCE` vs `BIDIRECTIONAL` → 记录 fault，允许运行。
  - OK：`SINK` 共享、`POWER/GROUND` 共享。

### 5.4 越权处理

| 越权行为 | 抛异常 | Host 反应 |
|---------|--------|---------|
| 写未在 pinMappings 中的 pin | `PinAccessDenied` | 记录 fault、状态转 `PowerFault`；本次调用中止 |
| 读/写未在 pinMappings 的 pin | `PinAccessDenied` | 同上 |
| 调 `bus.i2c(0)` 但未声明 capability | `PluginCapabilityViolation` | 同上 |
| `state.publish('unknown', ...)` | `UnknownStateChannel` | 同上 |
| 传入 `atUs < now()` 的 `schedulePinChangeAt` | `PluginContractViolation` | 同上 |
| `onStep` 单次超过 `wcetBudgetUs.onStep` | 无（记录） | trace 上报、可选降级到更低频率（见 §7.3） |

---

## 6. 契约 4：Worker IPC 通用化

### 6.1 消息协议改造

```diff
// packages/embedded-frontend/src/types/sim-worker-protocol.ts

export type SimWorkerInbound =
  | { type: 'INIT'; payload: { projectCode: string; wasmBaseUrl: string; peripherals: PeripheralBindingSnapshot[] } }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESET' }
  | { type: 'SET_SPEED'; payload: number }
  | { type: 'SET_PIN_IDEAL'; payload: { pin: number; level: boolean } }
- | { type: 'SET_ULTRASONIC_DISTANCE'; payload: { trigPin: number; echoPin: number; distanceCm: number } }
+ | { type: 'UPDATE_PLUGIN_PROPERTIES'; payload: { instanceId: string; properties: Record<string, unknown> } }
+ | { type: 'DISPATCH_PLUGIN_EVENT'; payload: { instanceId: string; name: string; params: Record<string, unknown> } }
+ | { type: 'SEED_RNG'; payload: { seed: string } };

export type SimWorkerOutbound =
- | { type: 'STATE_UPDATE'; payload: LegacyStateSnapshot }
+ | { type: 'STATE_UPDATE'; payload: {
+       pinStates: Record<number, boolean>;           // ADR-0027 通道 ①
+       displayPayloads: Record<string, Uint8Array>;  // ADR-0027 通道 ②
+       actuatorObservations: ActuatorObservation[];  // ADR-0027 通道 ③
+       pluginChannels: PluginStateChannelSnapshot[]; // 新：TypedStateChannel 快照
+       simTimeUs: string;
+     } }
+ | { type: 'PLUGIN_FAULT'; payload: { instanceId: string; code: number; msg: string } }
+ | { type: 'RNG_SEEDED'; payload: { seed: string } };   // 确定性回放：确认 seed 已生效
```

> **`SEED_RNG` → `RNG_SEEDED` 握手（评审补充）**：确定性回放场景中，主线程必须收到 `RNG_SEEDED` 确认后才能开始注入事件序列，否则可能在 seed 生效前注入首批事件导致回放漂移。`SET_SPEED` 变更 `simSpeed` 不影响 RNG 序列（RNG 仅由虚拟事件驱动，见 C4）。

### 6.2 前端 `apis` 保持向后兼容（渐进迁移）

现有 `PeripheralSimulationInject`（`ultrasonic_distance` / `gpio_ideal`）继续存在一版本，但内部适配层将 `apis.setUltrasonicDistance(trig, echo, cm)` 翻译为 `DISPATCH_PLUGIN_EVENT { name: 'SET_DISTANCE', params: { cm } }`。旧 API 在 v2 摘除。

### 6.3 状态回流与 ADR-0027 数据面归位

| 数据面（ADR-0027） | 本契约的来源 |
|-------------------|-------------|
| ① Digital Pin Mirror | Host 汇总 `PinArbiter` 快照（含插件写入的 SOURCE）→ `pinStates` |
| ② Display Payload | 显示类插件在 `stateChannels` 声明 `fb: Uint8Array` → Host 归入 `displayPayloads` |
| ③ Actuator Observation | 执行器类插件 `state.publish('actuator', ActuatorObservation)` → Host 归入 `actuatorObservations` |
| ④ Ideal Inject（反向） | 前端 `SET_PIN_IDEAL` / `DISPATCH_PLUGIN_EVENT`（`hostInjections`） |

**不新增第五种数据面**（严守 ADR-0027 决议）。任何"插件私有 UI 状态"仍走 ③（视为语义化执行器观测）或走 ④ 的反向（若是宿主控制的理想量）。

---

## 7. 契约 5：ABI 版本、Conformance Test、沙箱守护

### 7.1 ABI 版本策略（semver）

- Manifest `abi.version` 是**契约版本号**，独立于插件语义版本。
- 破坏性变更（新增必选钩子、修改 `PluginContext` 签名、`stateChannels` schema 破坏）→ major bump。
- 加字段（可选钩子、可选 capability）→ minor bump。
- 修 bug、优化 → patch bump。
- Registry 加载时按 semver 校验：`abi.unisim` 与运行时 `@wink/unisim` 版本必须 caret 兼容；不兼容 → `PluginAbiMismatch`，**加载失败而非运行时 NPE**。

### 7.2 Conformance Test 套件

`packages/unisim/src/plugin-host/conformance/` 提供：

```typescript
import { runPluginConformance } from '@wink/unisim/testing';
import { UltrasonicSimulationPlugin } from '../src/UltrasonicSimulationPlugin';
import manifest from '../peripheral.manifest.json';

describe('HC-SR04 conformance', () => {
  runPluginConformance(UltrasonicSimulationPlugin, manifest);
});
```

**验证项**（全通过才允许发布）：

| 验证项 | 说明 |
|--------|------|
| L1. Lifecycle | `Unbound → Bound → PoweringUp → Ready → PoweredOff → Unbound` 全路径可达，钩子顺序正确 |
| L2. Pin sandbox | 尝试写未映射 pin → 抛 `PinAccessDenied` |
| L3. Bus sandbox | 未声明 `i2c` capability 时 `ctx.bus.i2c(0)` → 抛 `PluginCapabilityViolation` |
| L4. State channel schema | 仅声明的 channel 可 publish；类型不符 → 抛 `StateChannelTypeError` |
| L5. Determinism | 相同 seed + 相同输入序列 → 相同 `state` publish 序列（**数值型字段容差 `1e-6`**，跨 JS 引擎浮点差异；布尔/整数绝对 0 差异） |
| L6. WCET budget | 遍历 fuzz 事件，`onStep` / `onPinChange` 单次不得超预算 |
| L7. Reset invariance | reset() 后状态与初 bind 相同（`equal(snapshotBefore, snapshotAfterReset)`） |
| L8. Fault normalization | 内部抛异常 → 经 `ctx.fault.report` 归一，不外传到 Host |
| L9. Idempotent power off | 多次 `powerOff` 无副作用 |
| L10. Manifest binding | Plugin 声明的 `timingModel` 与 manifest 一致；实现的钩子与 timingModel 允许集一致；step-lock 插件返回 Promise → 判失败 |
| L11. Time monotonicity | step-lock/hybrid：`onStep` 的 `nowUs` 严格单调递增且 `dtUs > 0`；event-driven：`onPinChange` 的 `atUs` 不小于上一次（捕获 Host 时间回退 bug 与插件非法时间戳缓存比较） |

**runPluginConformance 输出**：机器可读的 conformance report（JSON），供 wink registry 门禁使用。

### 7.3 WCET 预算与降级（单位裁定 + 降级策略）

**单位裁定（评审补充，消除虚拟/真实时间混淆）：**

- `wcetBudgetMs` 是**宿主侧真实执行时间预算（真实毫秒）**，度量"插件钩子在 Worker 线程上跑了多久墙钟时间"，用 `performance.now()` 计量。**它与虚拟时间无关**，因为虚拟时间无法用 `performance.now()` 度量。
- **加速仿真的处理**：`SET_SPEED` 提高 `simSpeed` 时，单位真实时间内需处理更多虚拟时间工作量，钩子调用**更频繁**但**单次耗时不变**。因此预算比对的是**单次钩子耗时**，不受 `simSpeed` 影响——无需缩放公式，规避了原 §R3 的复杂度。
- **慢机器环境系数**（回应 R3）：Host 在 `INIT` 时跑一段标定微基准（固定运算量），得出 `envFactor = 本机基准耗时 / 参考基准耗时`；比对时用 `effectiveBudget = wcetBudgetMs * envFactor`。三方作者按**参考机**（在 registry 文档标注规格）声明绝对值，无需关心部署环境。

**降级阶梯（不硬 kill，对齐 wink-micro-os `test_sim_scheduler_wcet_fault.c`）：**

- 首次超预算：trace event `plugin.wcet.exceeded` + `ctx.fault.report(WINK_ERR_TIMEOUT, ...)`。
- 连续 3 次超预算（滑动窗口）：Host 将该 step-lock 插件的 `stepPeriodUs` 翻倍（降频，保持系统前进）。
- 连续 10 次超预算：进入 `PowerFault`，需宿主 `RESET` 显式恢复（§4.1 不自动重试）。

### 7.4 沙箱与代码验证

- 插件包发布前跑 `wink lint peripheral`：
  - 静态检查禁用 API（`Math.random` / `Date.now` / `performance.now` / 全局 `fetch` / `XMLHttpRequest` / `import()` 动态加载）。
  - `PluginContext` 引用不得逸出钩子作用域（除 §4.6 允许的异步 `onPinChange` Promise 生命周期内）。
  - 不得 `import` 主线程 API（`window` / `document` / Vue 相关）。
- 运行时 Host 提供 `ctx` 的 `Proxy` 封装：
  - **同步钩子**：返回后立即失效。
  - **异步 `onPinChange`（仅 event-driven）**：`ctx` 在 Host `await` 的 Promise settle 后才失效（§4.6）；settle 后再访问抛 `ContextExpired`。
  - 目的：防止插件缓存 `ctx` 泄漏 Host 内部对象或跨 dt 复用。

### 7.5 已知限制与边界说明（补充：无法 100% 防的情况）

**必须显式写进契约，避免未来对外承诺过高。**

| 限制 | 影响范围 | 对策/边界 |
|-----|---------|-----------|
| **同步死循环无法被 WCET 捕获** | 所有插件 | JS 单线程无抢占；`onStep/onPinChange` 写 `while(true){}` 永远不返回，Host 根本没机会调用 `performance.now()` 收尾 → **整个 Worker 冻死**。当前机制只能抓"慢"，抓不住"卡死"。<br><br>**对策**：依赖发布前 lint + code review；不受信任的第三方插件需放入**独立 Worker** + terminate 看门狗（Phase 4 可选增强）。本契约 Phase 0–3：**显式承认此限制**，不承诺能防止恶意/错误代码挂死进程。 |
| **浮点 bit-exact 回放跨引擎不可靠** | step-lock 物理插件（运动学、PID） | L5 要求"差异容忍 = 0"，但 `Math.sin/cos`、浮点累加在不同 JS 引擎（V8 vs SpiderMonkey vs JavaScriptCore）、不同 CPU 架构（x86 vs ARM）上可能有 **ULP（末位单位）级差异**。对 float-heavy 插件，bit-exact 回放几乎做不到。<br><br>**对策**：将 L5 语义改为**"指定点数容差内一致"**（`1e-6` 对绝大多数物理量足够），或要求物理插件 publish 前做 32-bit 定点量化（牺牲精度换确定性）。Phase 1 pilot（超声波，无 heavy float）不受影响。 |
| **同型号多实例命名空间隐含但未强制** | 多外设场景 | manifest `type` 同、`instanceId` 不同 → state channel 名可能撞。当前依赖 Host 自动加前缀；未在契约中显式校验。**影响低**，Phase 1 随 conformance 套件一并补齐。 |
| **I2C 多设备地址匹配责任未明确** | 总线外设 | `onI2CTransaction` 由 Host 按地址分发还是全部广播？当前隐含"插件自己校验地址"。**影响低**，Phase 2 迁 OLED 时明确。 |

---

## 8. 关键流程时序图

### 8.1 加载与绑定

```
UI thread                      Worker (SimPluginHost)                 Plugin
    |                                 |                                  |
    | INIT {peripherals[]}            |                                  |
    |-------------------------------->|                                  |
    |                                 | load manifests, verify ABI       |
    |                                 |                                  |
    |                                 | for each peripheral:             |
    |                                 |   import(pluginEntry)            |
    |                                 |   new Plugin()                   |
    |                                 |   ctx = createContext(manifest)  |
    |                                 |   plugin.onBind(ctx, pins, props)|--> Bound
    |                                 |                                  |
    |                                 | if manifest.autoPowerOn:         |
    |                                 |   plugin.onStateChange(          |--> PoweringUp
    |                                 |     Bound, PoweringUp)           |
    |                                 |   await powerUpDelayUs           |
    |                                 |   plugin.onStateChange(          |--> Ready
    |                                 |     PoweringUp, Ready)           |
    | OK {simTimeUs: 0}               |                                  |
    |<--------------------------------|                                  |
```

### 8.2 超声波测距（事件驱动，重构后）

```
Wasm (dal_ultrasonic_request_measurement)
    |
    | pal_gpio_write(TRIG, HIGH)
    v
js_pal_gpio_on_write(TRIG, 1)  --Host.notifyPinChange(TRIG, HIGH)-->
                                                                   |
                                                                   v
                                                        Plugin.onPinChange(TRIG, HIGH, atUs)
                                                                   |
                                                                   |   echoUs = distance * 58   (58 us/cm: 声速往返, 340 m/s)
                                                                   v
                                                       ctx.pin.schedulePinChangeAt(ECHO, atUs+100, HIGH)
                                                       ctx.pin.schedulePinChangeAt(ECHO, atUs+100+echoUs, LOW)
                                                                   |
                                                                   v
                                                       ctx.state.publish('measuring', true)
                                                                   |
                                             STEP_CLOCK dt 到期 --> Host flushPinScheduler
                                                                   |
                                                                   v
                                              PinArbiter drive ECHO HIGH -> InterruptQueue
                                                                   |
                                                                   v
                                                     wasm 下次 poll -> ISR 起 -> pal_rmt capture
                                                                   |
                                                                   v
                                                     dal_ultrasonic_get_cached_distance = OK
```

### 8.3 车辆运动学（锁步）

```
STEP_CLOCK(dt=1000us) 到达 Worker
    |
    |  1. bridge.advanceClock(1000us)
    |  2. Host.tickStepLockPlugins(1000us):
    |         SmartCarKinematicsPlugin.onStep(nowUs, 1000us)
    |           read left/right PWM duty via ctx.pin.read* (or bus)
    |           integrate x, y, theta
    |           ctx.state.publish('pose', {x, y, theta})
    |  3. Host.flushPinScheduler(now)
    |  4. clock.advance(1000us)
    |  5. Host.flushStateChannels() --> STATE_UPDATE {pluginChannels: [...]}
    v
UI thread ActuatorMirror 消费 pose
```

---

## 9. 与 wink-micro-os 的联动契约

### 9.1 Codegen 派生的双向对账

- `wink-tools/tools/codegen/from_manifest.py`（新增）：
  - 输入：`peripheral.manifest.json`；
  - 输出：`generated/dal_<name>_config.h`（`config_t` 定义）+ `dal_<name>_apply_override.c`（反序列化）+ `wink_use_<name>.cmake` 片段。
- 手写 DAL 头文件（如 `dal_ultrasonic.h`）继续存在，但被 codegen 输出**引用**（`#include "generated/dal_ultrasonic_config.h"`）。
- CI 差异检测：`tools/manifest-lint.py` 比对 manifest 与 DAL 头文件字段清单，破坏性 diff 报错。

### 9.2 pin-ownership.json（新增 codegen 产物）

- `wink-app.json` → `device_tree.c` codegen 时同时输出 `build/generated/pin-ownership.json`。
- Unisim `SimulationPluginHost` 在 `INIT` 时读取同一份文件做冲突校验。
- 由此仿真侧与真机侧的引脚占用规则**只有一处定义**，不再有两套发明规则的空间。

### 9.3 与 ADR-0033（超声波距离事件）的关系

- 本契约不干预 C 侧 `WINK_EVENT_DISTANCE_READY` 事件语义。
- 前端插件在 `Ready` 状态下通过 `ctx.state.publish('distance', cm)` 广播；主线程通过 STATE_UPDATE 拿到。
- 反向注入的宿主控制（例如 UI 滑块调 distance）走 `DISPATCH_PLUGIN_EVENT { name: 'SET_DISTANCE' }`，插件在 `onHostInjection` 更新内部 distanceCm。

### 9.4 与 ADR-0042（仿真执行模式）对齐

- `stepPeriodUs`（虚拟时间）/ `wcetBudgetMs`（真实时间）与 wink-micro-os cooperative scheduler 的 10ms tick / WCET fault 概念同构。
- Trace event 使用相同格式（`wink_trace_event` 兼容），便于 `.wtr` 回放跨 C/TS 时间轴合并。

---

## 10. 演进路线图与迁移策略

### 10.1 分阶段落地（先契约、后代码）

```mermaid
graph LR
  P0[Phase 0: 契约冻结 ADR] --> P1[Phase 1: HC-SR04 Pilot]
  P1 --> P2[Phase 2: OLED + PWM 迁移]
  P2 --> P3[Phase 3: 外部插件包 + CI 门禁]
  P3 --> P4[Phase 4: 混沌与联合仿真闭环]
```

| Phase | 输出 | 完成标准 |
|-------|------|---------|
| **Phase 0**（1 周） | 本文档 Accepted；ADR-00XX 归档；`peripheral.manifest.v1.schema.json` 冻结；`SimulationPlugin` / `PluginContext` 类型定义 landed | 3 端（C/TS）代码不变，仅新增契约类型 |
| **Phase 1**（2 周） | HC-SR04 作为 pilot 迁移：manifest + `UltrasonicSimulationPlugin` + conformance test；移除 `createUnisimImports.ts:315-327` 硬编码；移除 `SimWorker.ultrasonicEchoUs` / `getEchoPin` | avoidance_car E2E 与既有单测全绿；硬编码计数清零 |
| **Phase 2**（2 周） | OLED（`ssd1306`）与 PWM 驱动迁移；`pal_wasm_get_ssd1306_fb` 走 TypedStateChannel；PWM 走 `bus.pwm` capability | `wasm-simulation.worker.ts:227-247` 内枚举清零 |
| **Phase 3**（2 周） | `packages/peripheral-*` 独立包 scaffold（`wink new peripheral`）；registry 从 packages 动态发现；CI 门禁 `manifest-lint` + `runPluginConformance` 全量跑 | 新增 servo/motor/dht22 走独立包路径完成 |
| **Phase 4**（后续） | 车辆运动学等 step-lock 插件；跨插件耦合（IMU + kinematics 联合方程） | 独立 ADR |

### 10.2 兼容性策略

- 旧 `PeripheralDefinition.simulation.observe` / `inject` API 保留一个 minor 版本，内部适配到新契约。
- 旧 `PeripheralDriver`（`unisim/PeripheralRegistry`）保留但标注 `@deprecated`；一个 major 版本后删除（届时 `PeripheralRegistry` 完全被 `SimulationPluginHost` 取代）。
- Manifest v1 → v2 的迁移工具由 `wink migrate manifest` 提供。

### 10.3 破坏性变更清单（本设计 Accepted 后一次性生效）

- 删除 `SimWorkerOptions.ultrasonicEchoUs` / `getEchoPin`。
- 删除 IPC 消息 `SET_ULTRASONIC_DISTANCE`。
- 删除 `createUnisimImports.ts` 内 `js_pal_gpio_on_write` 的 12/13 分支。
- 删除 `ObserveBuilder.watchUltrasonic`（已 `@deprecated`）。
- 变更 `PeripheralRegistry.attachEvents` 契约：不再直接暴露 `PinArbiter`；改为通过 `PluginContext.pin.*`。

以上均要求：先 landed manifest + adapter shim → 一个 minor 版本 → 删除 shim（避免大爆炸提交）。

---

## 11. 风险与开放问题

| # | 风险 / 问题 | 影响 | 缓解 / 待决 |
|---|------------|------|-------------|
| R1 | Manifest schema v1 冻结过早，后续插件类型需要新字段 | 加字段 = minor bump，但可能产生 v1/v2 并存期 | Phase 0 前跑一遍 5 种真实器件（LED/Button/OLED/PWM/HC-SR04）验证 schema 覆盖 |
| R2 | codegen 与手写 DAL 头文件对账工具复杂 | 若对账失败，C 端与 TS 端脱钩 | Phase 1 用 diff-based 策略，Phase 2 演进到 AST-based |
| R3 | WCET 预算在慢机器上误报 | 开发者体验差 | **已裁定（§7.3）**：`wcetBudgetMs` = 真实毫秒；`INIT` 标定 `envFactor` 自动缩放；单次耗时比对不受 `simSpeed` 影响 |
| R4 | 插件跨线程共享内存不可行（Worker 结构化克隆） | 大 framebuffer 拷贝开销 | TypedStateChannel 使用 `Transferable`（`Uint8Array.buffer`）；OLED FB 走 transfer 而非 clone |
| R5 | 现存 `PeripheralRegistry.PowerDomain` 与 wink-micro-os 电源域概念不完全一致 | 迁移期语义模糊 | **已裁定（§3.6）**：manifest `power.domain` 三值 + 映射表；短期以 `SWITCHABLE` 兜底 |
| R6 | `bus.i2c` 与现有 `I2CBus.transfer` 语义有差 | 迁移期两套 API 并存 | 保留 `unisim/bridge/I2CBus.ts` 内部实现；`PluginContext.bus.i2c` 作为门面 |
| R7 | 外部插件包在 CI 上如何被主仓识别？ | 影响 Phase 3 落地 | 采用 `pnpm-workspace.yaml` scope（`@wink/peripheral-*`）+ `wink lint peripherals` 遍历 |
| R8 | AI 生成的低代码 App 直接 `import` 插件包会不会误用 | 越权风险 | 应用层不直接 import 插件包；一律经 registry；`wink lint app` 校验 |
| **R9** | **模拟量/ADC 信号缺失（结构性缺口）** | **加第二个外设（电位器）时立刻暴露** | **已补充（§4.8）**：扩展 `signal: 'analog'` + `readAdcMv/writeDacMv/onAdcChange`；PinArbiter 两字段独立仲裁 |
| **R10** | **同步死循环 WCET 抓不住（安全模型漏洞）** | **不受信任插件可能冻死整个 Worker** | **已补充（§7.5）**：显式承认此限制；Phase 4 可选增强：独立 Worker + terminate 看门狗 |
| **R11** | **浮点 bit-exact 回放跨引擎不可靠** | **物理插件 L5 确定性校验会 flaky** | **已补充（§7.5）**：L5 语义从"绝对 0 差异"改为"指定容差内一致"（Phase 1 超声波不受影响） |
| **R12** | **i18n 字符串 schema 未定** | **前端 UI 多语言需返工** | **影响低，延后**：manifest `displayName/description` 是裸字符串，需定义 i18n key 规范；Phase 3 多外设时统一 |

**开放问题（Phase 0 评审前需回答）：**

- **Q1**：`manifest.abi.micro-os` 版本约束是软性（warn）还是硬性（block）？——建议硬性，但配 override 环境变量 `WINK_ALLOW_ABI_DRIFT=1`。
- **Q2**：Plugin 是否允许 `async onStep`？——**已裁定（§4.6）**：禁止（`onStep` 必须同步返回，否则锁步语义崩溃）；异步仅限 event-driven 的 `onPinChange`，`ctx` 生命周期延至 Promise settle。
- **Q3**：跨插件的耦合（例如 IMU 提供加速度给 Kinematics 用）通过 `state.snapshot` 拉取，还是 event bus？——**已裁定（§4.7）**：采用**双缓冲黑板**，`snapshot` 始终读上一 dt 稳定快照，与调度顺序无关；跨插件信号固定 1 tick 延迟。event bus 留待 Phase 4。
- **Q4**：是否允许"合成外设"（Composite Plugin，如 L298N 双电机模块）？——暂不进契约；作者应发布两个 motor plugin + 一份 catalog 组合。

---

## 12. 验收清单（供评审对照）

**契约完备性：**

- [ ] Manifest schema v1 冻结（JSON Schema 文件已产出）。
- [ ] `SimulationPlugin` / `PluginContext` TS 类型定义与 §4、§5 完全一致。
- [ ] IPC 协议 v2 与 §6 完全一致，旧消息标注废弃时点。
- [ ] Conformance 测试套件 L1–L11 全部实现且可复用。

**与既有 ADR / 规范的对齐：**

- [ ] 行为权威归属已裁定（§1.4）：C 侧接口权威 vs TS 侧仿真行为权威，ADR-0021 张力消解。
- [ ] 与 sim-observation-layers（M0–M6）归并关系明确（§1.5），无双插件机制并存期长期化。
- [ ] 无第五种数据面（ADR-0027 未违反）。
- [ ] 插件全部运行在 Worker 内（ADR-0021 未违反）。
- [ ] 插件不引入 `Math.random` / `Date.now`（ADR-0042 未违反）。
- [ ] 故障码归一到 `wink_status_t` 负数（ADR-0001 未违反）。
- [ ] pin conflict 规则与 `pal_resource` 一致（未双源发明）。
- [ ] 模拟量/ADC 信号契约完整（§4.8），支持电位器/LDR/热敏类外设。
- [ ] 已知限制文档化（§7.5）：同步死循环边界、浮点确定性容差。

**演进可行性：**

- [ ] HC-SR04 pilot 完成，avoidance_car E2E 全绿。
- [ ] 硬编码点清零（`createUnisimImports.ts:315-327`、`SimWorker.ts:158-161`、`wasm-simulation.worker.ts:227-247`、`observe-builder.ts:14-15`）。
- [ ] 5 种真实器件（**含 1 个模拟量**：电位器）manifest 全部通过 `runPluginConformance`。
- [ ] CI 门禁 `manifest-lint` + `abi-check` + `conformance` 生效。

**外部使用者友好度（G1–G4 抽样）：**

- [ ] 新增一个"温度传感器插件包"耗时 < 4 小时（含 conformance test）。
- [ ] 三仓（`wink-micro-os` / `unisim` / `embedded-frontend`）该次提交零改动。
- [ ] `wink new peripheral <name>` scaffold 一键产出可 build 的包。

---

## 13. 附录

### 13.1 术语表

| 术语 | 定义 |
|------|------|
| Peripheral Manifest | `peripheral.manifest.json`，跨 C DAL / 前端 / Unisim 三端的 SSOT |
| SimulationPlugin | Unisim Worker 内运行的器件仿真单元，遵循本契约 |
| PluginContext | 传入插件的门面对象，通过方法暴露 pin/bus/state/fault/trace 能力 |
| TimingModel | `event-driven` / `step-lock` / `hybrid` 三选一，声明插件被 Host 调度的方式 |
| TypedStateChannel | 类型化状态发布通道，替代匿名 `postStateUpdate` |
| Conformance Test | 契约级验收测试套件（L1–L10） |
| pin-ownership.json | codegen 产物，仿真侧与真机侧共用的引脚占用真相 |
| ABI | Application Binary Interface；此处特指插件契约版本 |

### 13.2 参考实现示例：`UltrasonicSimulationPlugin`

```typescript
import type { SimulationPlugin, PluginContext, PropertySnapshot, PinMappingSnapshot } from '@wink/unisim';

interface UltrasonicState {
  distance: number;
  echoActive: boolean;
  measuring: boolean;
}

export class UltrasonicSimulationPlugin implements SimulationPlugin<UltrasonicState> {
  readonly type = 'ultrasonic';
  readonly timingModel = 'event-driven' as const;

  private ctx!: PluginContext<UltrasonicState>;
  private trigPin = -1;
  private echoPin = -1;
  private distanceCm = 25.0;

  onBind(ctx: PluginContext<UltrasonicState>, pins: PinMappingSnapshot, props: PropertySnapshot) {
    this.ctx = ctx;
    this.trigPin = pins.get('TRIG')!;
    this.echoPin = pins.get('ECHO')!;
    this.distanceCm = Number(props.get('distance') ?? 25);
    ctx.state.publish('distance', this.distanceCm);
  }

  onPinChange(pin: number, level: boolean, atUs: bigint) {
    if (pin !== this.trigPin || !level) return;
    const echoUs = BigInt(Math.round(this.distanceCm * 58));
    this.ctx.state.publish('measuring', true);
    this.ctx.pin.schedulePinChangeAt(this.echoPin, atUs + 100n, true);
    this.ctx.pin.schedulePinChangeAt(this.echoPin, atUs + 100n + echoUs, false);
    this.ctx.trace.event('ultrasonic.ping', { distanceCm: this.distanceCm, echoUs: Number(echoUs) });
  }

  onPropertyChange(key: string, _oldValue: unknown, newValue: unknown) {
    if (key === 'distance') {
      this.distanceCm = Number(newValue);
      this.ctx.state.publish('distance', this.distanceCm);
    }
  }

  onHostInjection(name: string, params: Record<string, unknown>) {
    if (name === 'SET_DISTANCE' && typeof params.cm === 'number') {
      this.distanceCm = params.cm;
      this.ctx.state.publish('distance', this.distanceCm);
    }
  }

  onStateChange(_prev, next) {
    if (next === 'PoweredOff' || next === 'PowerFault') {
      this.ctx.state.publish('measuring', false);
      this.ctx.state.publish('echoActive', false);
    }
  }
}
```

### 13.3 参考实现示例：`SmartCarKinematicsPlugin`（step-lock）

```typescript
export class SmartCarKinematicsPlugin implements SimulationPlugin<{ pose: Pose }> {
  readonly type = 'smart-car-kinematics';
  readonly timingModel = 'step-lock' as const;

  private ctx!: PluginContext<{ pose: Pose }>;
  private leftPwm = 0;
  private rightPwm = 0;
  private pose: Pose = { x: 0, y: 0, theta: 0 };
  private wheelBase = 0.16;
  private maxVPerUs = 0.5e-6;   // 最大线速度，单位 m/us（= 0.5 m/s）

  onBind(ctx, pins, props) {
    this.ctx = ctx;
    // 引脚不用作 pin-level 事件；从 PWM channel 读取占空比（bus.pwm 见 §5.2 扩展）
    this.wheelBase = Number(props.get('wheelBase') ?? 0.16);
    this.maxVPerUs = Number(props.get('maxSpeed') ?? 0.5) / 1_000_000;  // m/s -> m/us
  }

  onStep(nowUs: bigint, dtUs: bigint) {
    this.leftPwm = this.ctx.bus.pwm(0).readDuty();     // 假设 PWM channel 0
    this.rightPwm = this.ctx.bus.pwm(1).readDuty();

    const vL = this.leftPwm * this.maxVPerUs;
    const vR = this.rightPwm * this.maxVPerUs;
    const v = (vL + vR) / 2;
    const omega = (vR - vL) / this.wheelBase;

    const dtNumber = Number(dtUs);
    this.pose.x += v * Math.cos(this.pose.theta) * dtNumber;
    this.pose.y += v * Math.sin(this.pose.theta) * dtNumber;
    this.pose.theta += omega * dtNumber;

    this.ctx.state.publish('pose', { ...this.pose });
  }
}

interface Pose { x: number; y: number; theta: number; }
```

### 13.4 与现有 skill / 规则的关系

- 本设计遵循 CLAUDE.md 中的"编译期静态分发"（ADR-0004）——C 侧仍以 POD + 命名 API 提供，不引入运行时 vtable。
- 本设计遵循 `.claude/rules/c-code.md` 的对齐降序 struct 布局。
- 本设计遵循 `.claude/rules/docs-adr.md` 的四层文档流转（tech-design → ADR → 回写设计规范）。

---

## 14. 变更历史

| 日期 | 版本 | 变更 | 作者 |
|------|------|------|------|
| 2026-07-20 | v0.1 (Draft) | 初稿，基于 `C:\Users\77174\.gemini\antigravity-ide\brain\6fee6170-37c8-4beb-9d63-62adc383b37e\co_simulation_contract_analysis.md` 评审补充 5 项契约 | TBD |
| 2026-07-20 | v0.2 (Draft) | 架构师评审 10 点补充：§1.4 行为权威归属裁定（ADR-0021 张力）、§1.5 与 sim-observation-layers（M0–M6）归并关系、§3.5 overrideLayout offset 自动计算、§3.6 power.domain 映射、§4.4.1 级联深度/传播延迟模型、§4.6 异步钩子与 ctx 失效、§4.7 双缓冲黑板、§7.3 WCET 单位裁定（真实毫秒 + envFactor）、L11 时间单调性、`RNG_SEEDED` 握手、manifest `power` 段、状态机 recover 触发条件、文字勘误（echoUs 单位/maxVPerUs） | TBD |
| 2026-07-20 | **v0.3 (Draft, 全覆盖)** | **最终补缺口**：§4.8 模拟量/ADC 信号（最大结构性缺口，支持电位器/LDR/热敏）、§7.5 已知限制边界说明（同步死循环无法捕获、浮点 bit-exact 跨引擎不可靠）、manifest `signal: 'analog'` + `ctx.pin.readAdcMv/writeDacMv/onAdcChange`、PinArbiter 两字段独立仲裁、capabilities.analog 白名单、风险表 R9–R12、L5 确定性容差从 0 → `1e-6`、验收清单补模拟量验证、多实例/总线多设备隐含限制 | TBD |


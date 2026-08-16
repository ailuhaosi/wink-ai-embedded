# 虚拟外设注册表、配置源边界与 PinArbiter

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Partial**：PinArbiter / 配置源边界 / TS↔ABI 四态 **Landed**；SchemaForm·画布 **Partial**；`powerDomain` 生命周期 **Planned** |
| 支撑轴 | **A（secondary，配置面）** |
| 关联代码 | `@wink-ai/unisim` (PinArbiter / PeripheralRegistry / LogicTypes)、`wink-micro-os/targets/wasm/wasm_bridge.h` |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | 0003、0040 |
| 迁自 | `04-wasm-simulation-2.0/08-peripheral-registry.md` |

> 本文件回答：虚拟外设如何声明与注册、电路图/元数据存哪、引脚电气状态如何仲裁、TS 四态与 wasm ABI 如何映射。这是轴 A 的**配置面**；数据如何流进固件（四通道）见 [`08-channel-routing.md`](./08-channel-routing.md)。

---

## 0. 三类配置源的边界（重要，旧文档未厘清）

ADR-0040 要求外设引脚/通道/设备标识有单一来源，但实际系统有四份配置，各管一层，互不冲突：

| 配置 | 归属 | 内容 | 消费者 |
|---|---|---|---|
| **`wink-app.json`** | 固件设备树 SSOT（ADR-0040） | App 使用的外设实例、引脚、通道、设备 ID；语义仿真门禁 | codegen → `device_tree.h`、DAL/BAL、Arduino façade |
| **`sim-project.json`** | 仿真画布/电路 | boards、components、connections（导线拓扑、坐标、布线路径） | UniSim 前端画布、PinArbiter 连线 |
| **`peripheral-definition.json`** | 外设类型元数据 | tagName、pins[]、properties[]（SchemaForm）、视觉缩略图 | SchemaForm 属性面板、注册表 |
| **`device_tree.h`** | 生成产物 | codegen 从 `wink-app.json` 生成的 C 静态设备实例 | 固件编译 |

- `wink-app.json` 管「固件语义上接了什么器件在哪个脚」；`sim-project.json` 管「画布上画了什么元件、导线怎么连」。两者通过实例/引脚映射关联，但**不是**重复 SSOT。
- 未在 `wink-app.json` 声明的器件不得做语义 Bypass（ADR-0040 Fail-Loud）；普通引脚级 GPIO（LED blink）无需声明。
- **拓扑/扩展器件 (Infrastructure Devices)**：如 PCF8574 (IO扩展)、74HC138 (3-8译码器)、TCA9548A (I2C开关) 使用 `"category": "infrastructure"` 声明。其拓扑与通道解耦机制见 [hardware-topology-and-infrastructure-devices-design.md](../../../tech-designs/frontend/2026-08-03-hardware-topology-and-infrastructure-devices-design.md)。

---

## 1. 电路拓扑存储（sim-project.json）

顶层扁平对象模型，支持多板：

```jsonc
{
  "$schema": "https://unisim-spec.org/v1/sim-project.schema.json",
  "version": 1,
  "projectName": "Multi-Board IoT Gateway",
  "boards": [
    { "id": "gateway_esp32", "type": "board-esp32-s3", "x": 0, "y": 0,
      "sourceDir": "...", "settings": { "baudRate": 115200, "flashSize": "4MB" } }
  ],
  "components": [
    { "id": "led_status", "type": "generic-led", "x": 120, "y": 40,
      "rotation": 0, "properties": { "color": "red" } }
  ],
  "connections": [
    { "id": "c1", "from": "gateway_esp32:TX0", "to": "node_nano:RX",
      "color": "#5af", "signalType": "uart",
      "routing": { "mode": "orthogonal", "path": ["v15", "h-30", "*"] } }
  ]
}
```

- `from`/`to` 格式：`boardId:pinName` 或 `componentId:pinName`；
- `signalType`：`digital`/`uart`/`spi`/`i2c`/`analog`/`pwm`；
- `$schema` URL 为规划中的规范域名（**占位，确认是否托管**）。

### 1.1 自适应导线（Adaptive Routing）

两种模式：

1. **orthogonal（默认）**：横平竖直；引擎记录相对转向指令，元件移动时渲染器重算。指令：`v[N]` 垂直 N px、`h[N]` 水平 N px、`*` 源/目标路径汇合分隔符。
2. **custom**：用户拖拽/加把手后降级为 custom，存绝对 `{x,y}[]` 点，防止自动重算覆盖手工布局。

底层连通性用 Union-Find 网表合并（继承自 Velxio 分析，见 §6）。

---

## 2. SchemaForm 外设元数据（peripheral-definition.json）

元数据原生对接 `@yo-cloud/yo-ux-vue` 的 SchemaForm；`properties` 是 `DynamicItemSchemaType[]`，选中元件后零转换直传 `<SchemaForm>`。

```jsonc
{
  "$schema": "https://unisim-spec.org/v1/peripheral-definition.schema.json",
  "id": "generic-led",
  "tagName": "wokwi-led",            // Wokwi Elements web component
  "name": { "en": "LED", "zh": "发光二极管" },
  "category": "output",
  "visual": { "thumbnail": "<svg .../>", "dimensions": { "width": 32, "height": 32 } },
  "pins": [
    { "name": "Anode", "label": "A", "type": "digital_io", "description": "阳极" },
    { "name": "Cathode", "label": "K", "type": "gnd", "description": "阴极" }
  ],
  "properties": [
    { "prop": "color", "label": "颜色", "compType": "Select",
      "compProps": { "options": ["red","green","yellow","blue"] }, "defaultValue": "red",
      "rules": [{ "required": true, "message": "必选", "trigger": "change" }] },
    { "prop": "currentLimitResistor", "label": "限流电阻(Ω)", "compType": "Slider",
      "compProps": { "min": 0, "max": 10000, "step": 10 }, "defaultValue": 220 }
  ]
}
```

> **勘误（旧 02 自相矛盾）**：旧文 JSON 里 slider `max:10000`，Vue 脚本里写 `max:1000`。以元数据 JSON 为准（**10000**）。

Vue 集成骨架：

```vue
<el-card>
  <SchemaForm :schemas="activeComponentMeta.properties"
             v-model:data="activeComponent.properties"
             :form-props="formProps" />
</el-card>
```

```ts
import { SchemaForm, type DynamicItemSchemaType } from '@yo-cloud/yo-ux-vue';
interface ComponentInstance { id: string; type: string; properties: Record<string, unknown>; }
const formProps = { labelPosition: 'top', size: 'default' };
```

---

## 3. 虚拟外设注册表（PeripheralRegistry）

注册表把 DOM 视觉状态（`<wokwi-led>`）与 Wasm 仿真线程的逻辑引脚电平同步。

### 3.1 生命周期接口（设计面）

```ts
interface PeripheralLifecycle {
  powerDomain: string;           // 如 '3V3_SYS' / '5V_PERIPHERAL'；rail 关断时自动切
  powerUpDelayUs?: number;       // 上电爬坡延迟，期间读引脚/总线须返回 WINK_ERR_BUSY
  onPowerOn?(): Promise<void>;
  onPowerOff?();                 // 掉电/热插拔
  onReset?();                    // 软复位
  onPropertyChange?(key: string, oldValue: unknown, newValue: unknown): void;
}

interface PeripheralSimulationLogic extends PeripheralLifecycle {
  onPinStateChange?(pinName: string, state: LogicState): void;
  attachEvents?(element: HTMLElement, pinArbiter: IPinArbiter,
                getMappedPin: (partPinName: string) => number | null,
                componentId: string): () => void;   // 返回 cleanup
}
```

> **落地状态（诚实标注）**：`powerDomain`/`powerUpDelayUs`/`onPowerOn` 等是**设计面，当前示例与实现均未真正落地电源轨建模**（C22 电源多属 🚫）——标记为 **Planned**，勿写成 Landed。示例里 LED 不做 busy、servo 仅设了 `powerUpDelayUs:5000` 但无 busy 逻辑；跨 JS→C 如何返回 `WINK_ERR_BUSY` 也无机制。不要把这些接口当作已实现能力。

`PeripheralRegistry`（`Map<type, PeripheralSimulationLogic>`）提供 `register(type, logic)` / `get(type)`，导出单例。

### 3.2 驱动示例（已按真实 PinArbiter API 修正）

> 勘误：旧 02 的示例用了 4 参 `setDriver(pin, id, state, strength)`、不存在的 `onPwmChange`/`setAnalogVoltage`、不规范的引脚名 `'1.l'`、以及把 PWM 百分比当 0.5~2.5ms 脉宽的错误注释。下面统一为真实接口 `setDriver(pin, PinDriver)`（2 参），PWM 用 duty-percent 语义（对齐 `js_pal_pwm_set_duty(channel, percent)`），引脚名用 `pins[]` 规范名。

**LED（数字输出）**：注册 `generic-led`，powerDomain `3V3_SYS`。在 Anode/Cathode 上各放一个 `{id:'${componentId}:led_drv', state:'Z', strength:WEAK}` 驱动；`onPinChange` 时计算 `voltageAcross = max(0, V_anode - V_cathode - 1.8)`（1.8V 正向压降），`brightness = min(1, voltageAcross/1.5)`，置 `element.value = brightness>0.1`、`element.brightness = brightness`；cleanup 退订并 `removeDriver`。

**按键（数字输入+中断）**：`pushbutton`。映射引脚用 `getMappedPin('Pin1') ?? getMappedPin('Pin2')`（规范名）；默认 WEAK `'Z'`（依赖板/外部上拉，低电平有效）；按下时以 SUPPLY 驱动 0，松开恢复 WEAK `'Z'`；监听 DOM `button-press`/`button-release`。

**电位器（ADC 模拟）**：`potentiometer`，映射 `SIG`。`input` 事件读 0.0~1.0，`simulatedVoltage = percent*3.3`，用 `pinArbiter.setAnalogDriver(adcPin, { id: driverId, value: percent, strength: SUPPLY })`（真实模拟通道 API，见 §4.3）。

**舵机/机械臂关节（PWM 输出+WebGL）**：`servo-motor`，powerDomain `5V_PERIPHERAL`，映射 `PWM`。**通道 1b 是 duty 百分比语义（L2），不仿真载波边沿**；角度映射 `targetAngle = (duty/100)*180`，派发 `window.dispatchEvent(new CustomEvent('servo-rotate', {detail:{componentId, angle}}))`，Three.js 视口监听并设 `joint.rotation.y`。（旧文「0.5~2.5ms 脉宽→角度」的注释与通道 1b 模型冲突，已删除；需要 µs 脉宽语义的器件应走通道 1 边沿注入。PWM 路由见 [`08-channel-routing.md`](./08-channel-routing.md) §2.3；载波/周期 behave 见 [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)。）

---

## 4. PinArbiter 电气 SSOT

`PinArbiter` 是 GPIO 电气状态的唯一仲裁者，取代了早期文档里的 `PinManager` 命名（已淘汰）。

### 4.1 四值逻辑与驱动强度（TS）

```ts
const LogicStates = { LOW: 0, HIGH: 1, HI_Z: 'Z', CONFLICT: 'X' } as const;
type LogicState = 0 | 1 | 'Z' | 'X';

enum DriveStrength { SUPPLY = 3, PULL = 2, WEAK = 1 }
// SUPPLY: VCC/GND 直连或推挽 GPIO
// PULL:   电阻上/下拉（I2C 外置 4.7kΩ）
// WEAK:   弱内部上拉/开漏释放/浮空输入
```

```ts
interface PinDriver {
  id: string;                 // 'ideal:ui:' / 'mcu:gpio{N}' / '${componentId}:...'
  state: LogicState;
  strength: DriveStrength;
}
interface IPinArbiter {
  setDriver(pin: number, driver: PinDriver): void;
  removeDriver(pin: number, driverId: string): void;
  removeDriversByIdPrefix(prefix: string): void;   // reset/生命周期
  readPin(pin: number): LogicState;
  getResolvedVoltage(pin: number): number;         // 0~3.3V 估算（LED 亮度等）
  onPinChange(pin: number, cb: PinChangeCallback): () => void;
  onContention(cb: PinContentionCallback): () => void;
  getDrivers(pin: number): PinDriver[];            // 诊断
  // 模拟通道
  setAnalogDriver(pin: number, driver: AnalogDriver): void;
  removeAnalogDriver(pin: number, driverId: string): void;
  readAnalog(pin: number): number;                 // [0,1]，高强度胜，平票取大（高侧 Wire-OR）
  clearTrace(): void;
}
```

仲裁算法：(1) 忽略所有 `'Z'`；(2) 取最大强度；(3) 最大强度驱动一致 → 该态；(4) 不一致 → `'X'` 冲突并告警；(5) 无驱动 → `'Z'` 浮空。

**I2C 线与示例**：外置上拉 `{id:'board:i2c-pullup-sda', state:1, strength:PULL}` + MCU 开漏 `{id:'mcu:sda', state:0, strength:SUPPLY}` → 读 0（低有效）；MCU 释放为 `'Z'` → 读 1（上拉胜）。

### 4.2 TS 四态 ↔ wasm ABI 映射（旧文档缺失，本版补齐）

TS `LogicState` 是 `0|1|'Z'|'X'`（字符串联合），跨 wasm ABI 用 **uint8 数值**编码（`wink-micro-os/targets/wasm/wasm_bridge.h`、`WasmImports.js_pal_gpio_read_state`）：

| 逻辑态 | TS 值 | wasm ABI（`js_pal_gpio_read_state` 返回） | C 枚举 |
|---|---|---|---|
| LOW | `0` | `0` | `JS_GPIO_STATE_LOW=0` |
| HIGH | `1` | `1` | `JS_GPIO_STATE_HIGH=1` |
| Hi-Z（浮空） | `'Z'` | `2` | `JS_GPIO_STATE_HIZ=2` |
| CONFLICT（总线竞争） | `'X'` | `3` | `JS_GPIO_STATE_CONFLICT=3` |

driver-id 前缀约定：

| 前缀 | 含义 | 相关 API |
|---|---|---|
| `mcu:gpio{N}` | MCU 固件驱动（GPIO 输出/开漏释放） | `js_pal_gpio_release_mcu`（INPUT*/开漏释放时移除） |
| `ideal:ui:` | UI/测试理想电平注入 | `js_pal_gpio_drive_ideal` / `release_ideal` |
| `${componentId}:...` | 插件/元件驱动（上拉、LED 等） | `setDriver` / `removeDriver` |

> 新增/变更这些导入时 bump `PAL_WASM_ABI_HASH`（C 与 TS 各一份，`ssotAlignment.test.ts` 比对）。

### 4.3 模拟通道

`AnalogDriver = { id, value:number(0..1), strength }`；`readAnalog` 返回归一化值，最高强度驱动胜，同强度取最大值（高侧 Wire-OR 理想近似）。ADC 通道 3 的物理源绑定见 [`08-channel-routing.md`](./08-channel-routing.md) §2.4。

> **通道 3 消费方式（ADR-0057，2026-08-05）**：wasm 侧 `js_pal_adc_read_norm(pin)` 即读 `readAnalog(pin)` 返回 `[0,1]`；C 侧 `pal_wasm_adc.c` 在此基础上做 raw/mv 换算并叠加 RC/噪声。PinArbiter 是模拟电气 SSOT，JS 不做 mV 换算、不知满量程。

### 4.4 电压估算的注意点

四态电压映射表里 `'Z'` 默认 0.0V 是「元件可自定义」的缺省，不代表浮空真的是 0V；仲裁算法本身忽略 Z，由 PULL/WEAK 驱动决定电平。LED 等用 `getResolvedVoltage` 做亮度估算即可，勿据此推断「浮空脚读到 0」。

---

## 5. 与四通道/插件的关系

- PinArbiter 是通道 1（Pin）的电气落点；总线器件（SSD1306 等）走通道 2 的 `I2CBus`/`SPIBus`/`UARTBus`，不在引脚仲裁内逐位仿真；
- OLED 等显示插件：C 跑完整 I2C 写缓冲，`MonoOledPlugin` 解析命令/数据并发帧缓冲（旧 Scheme-A 地址短路由已淘汰）；
- ProductWorld/3D Raycaster 算出的距离必须转成 ECHO 边沿或 ADC 值注入，**严禁**作为 DAL 返回值（见 [`08-channel-routing.md`](./08-channel-routing.md) §4）；
- 注册表不直接做 Trace；`pal.transfer` 类摘要由 Worker 在 `js_pal_*` 返回时记录。

---

## 6. 从 Velxio 继承的资产（并入原 04 分析）

原 `04-velxio-migration-analysis.md` 的可复用结论（不再单独成文）：

| 资产 | 处理 |
|---|---|
| `@wokwi/elements` Web Components（LED/button/LCD1602/7-seg/keypad/potentiometer） | 100% 继承；Vite 配置 `compilerOptions.isCustomElement: tag => tag.startsWith('wokwi-')` |
| SVG 正交导线（Union-Find 网表 + L 形/多段折线） | 继承算法，重构为 Vue 3 + Pinia + SVG 模板（见 §1.1） |
| TS 虚拟外设状态机（VirtualSSD1306/DS1307/PCF8574 等，实现标准 `I2CDevice`） | 继承并挂到 I2CBus；与 CPU 模拟器解耦 |
| AVR8js / rp2040js / QEMU / 云端指令级模拟 | **全部抛弃**（API/组件翻译级仿真，非指令级；零服务器成本） |
| React Zustand / Tailwind | 迁移到 Pinia / Element Plus |

定位差异：Velxio 是指令/寄存器级硬件仿真；Wink 是 API/组件翻译级 Wasm 仿真，C 业务代码同源编译到 wasm32，所有板在单 Worker 沙箱跑。

# Virtual Peripheral Registry, Configuration Boundaries & PinArbiter

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/07-peripheral-registry.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Partial**: PinArbiter / Configuration source boundaries / TS $\leftrightarrow$ ABI 4-state mapping are **Landed**; SchemaForm canvas is **Partial**; `powerDomain` lifecycle is **Planned** |
| Supporting Axis | **A (secondary, configuration plane)** |
| Associated Code | `@wink-ai/unisim` (PinArbiter / PeripheralRegistry / LogicTypes), `wink-micro-os/targets/wasm/wasm_bridge.h` |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0003, 0040 |
| Migrated From | `04-wasm-simulation-2.0/08-peripheral-registry.md` |

> This document answers: How virtual peripherals are declared and registered, where schematics/metadata reside, how pin electrical states are arbitrated, and how TS 4-state maps to Wasm ABI. This is the **configuration plane** of Axis A; how data flows into firmware (4 channels) is described in [`08-channel-routing.md`](./08-channel-routing.md).

---

## 0. Boundaries of Three Configuration Sources (Important, Clarifying Legacy Documents)

ADR-0040 requires a single source of truth for peripheral pins/channels/device identifiers; in practice, the system organizes configurations across four layers without conflict:

| Configuration | Ownership | Scope | Consumer |
|---|---|---|---|
| **`wink-app.json`** | Firmware Device Tree SSOT ([ADR-0040](../../../decisions/unisim/0040-arduino-semantic-sim-json-gate.md)) | Peripheral instances, pin mappings, channels, device IDs; semantic simulation gate | Codegen $\rightarrow$ `device_tree.h`, DAL/BAL, Arduino façade |
| **`sim-project.json`** | Simulation Canvas / Schematic | Boards, components, connections (wire topology, coordinates, routing paths) | UniSim frontend canvas, PinArbiter wiring |
| **`peripheral-definition.json`** | Peripheral Type Metadata | `tagName`, `pins[]`, `properties[]` (SchemaForm), visual thumbnails | SchemaForm property inspector, Registry |
| **`device_tree.h`** | Generated C Header | Generated static C structs for device instances from `wink-app.json` | Firmware compilation |

- `wink-app.json` governs "what device is semantically connected to which pin in firmware"; `sim-project.json` governs "what component is drawn on canvas and how wires connect". The two correlate via instance/pin mappings, but are **not** duplicate SSOTs.
- Devices not declared in `wink-app.json` must not perform semantic bypasses (ADR-0040 Fail-Loud); standard pin-level GPIOs (LED blink) require no declaration.
- **Infrastructure Devices**: Such as PCF8574 (IO expander), 74HC138 (3-to-8 decoder), TCA9548A (I2C switch) declare `"category": "infrastructure"`. Their topology and channel decoupling mechanisms are detailed in [hardware-topology-and-infrastructure-devices-design.md](../../../tech-designs/frontend/2026-08-03-hardware-topology-and-infrastructure-devices-design.md).

---

## 1. Schematic Topology Storage (sim-project.json)

Top-level flat object model supporting multi-board topologies:

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

- `from`/`to` format: `boardId:pinName` or `componentId:pinName`;
- `signalType`: `digital`/`uart`/`spi`/`i2c`/`analog`/`pwm`;
- `$schema` URL is a planned specification domain name (**placeholder, pending hosting confirmation**).

### 1.1 Adaptive Routing

Two modes:

1. **orthogonal (default)**: Right-angled routing; engine records relative turn commands, and the renderer recomputes when components move. Commands: `v[N]` vertical N px, `h[N]` horizontal N px, `*` source/target path convergence delimiter.
2. **custom**: Degrades to custom upon user drag/handle addition, storing absolute `{x,y}[]` points to prevent automatic recalculation from overwriting manual layouts.

Underlying connectivity uses Union-Find netlist merging (inherited from Velxio analysis, see §6).

---

## 2. SchemaForm Peripheral Metadata (peripheral-definition.json)

Metadata natively interfaces with SchemaForm from `@yo-cloud/yo-ux-vue`; `properties` is `DynamicItemSchemaType[]`, passing directly to `<SchemaForm>` without conversion upon selecting a component.

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

> **Errata (Legacy 02 Contradiction)**: Legacy JSON wrote slider `max:10000`, while the Vue script wrote `max:1000`. The metadata JSON is authoritative (**10000**).

Vue Integration Skeleton:

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

## 3. Virtual Peripheral Registry (PeripheralRegistry)

The registry synchronizes DOM visual state (`<wokwi-led>`) with logical pin levels in the Wasm simulation thread.

### 3.1 Lifecycle Interface (Design Surface)

```ts
interface PeripheralLifecycle {
  powerDomain: string;           // e.g. '3V3_SYS' / '5V_PERIPHERAL'; auto-switches on rail shutdown
  powerUpDelayUs?: number;       // Power-on ramp delay; pin/bus reads return WINK_ERR_BUSY during this
  onPowerOn?(): Promise<void>;
  onPowerOff?(): void;           // Power cut / hot-unplug
  onReset?(): void;              // Soft reset
  onPropertyChange?(key: string, oldValue: unknown, newValue: unknown): void;
}

interface PeripheralSimulationLogic extends PeripheralLifecycle {
  onPinStateChange?(pinName: string, state: LogicState): void;
  attachEvents?(element: HTMLElement, pinArbiter: IPinArbiter,
                getMappedPin: (partPinName: string) => number | null,
                componentId: string): () => void;   // returns cleanup
}
```

> **Landing Status (Honest Notation)**: `powerDomain`/`powerUpDelayUs`/`onPowerOn` are **design surfaces; neither sample nor current implementation has landed real power rail modeling** (C22 power scenarios are mostly 🚫)—marked as **Planned**, do not describe as Landed. In samples, LED does not implement busy, and servo only specifies `powerUpDelayUs:5000` without busy logic; no mechanism exists across JS→C to return `WINK_ERR_BUSY`. Do not treat these interfaces as implemented capabilities.

`PeripheralRegistry` (`Map<type, PeripheralSimulationLogic>`) exposes `register(type, logic)` / `get(type)`, exporting a singleton.

### 3.2 Driver Examples (Corrected per Real PinArbiter API)

> Errata: Legacy 02 samples used 4-arg `setDriver(pin, id, state, strength)`, non-existent `onPwmChange`/`setAnalogVoltage`, non-standard pin name `'1.l'`, and erroneous comments treating PWM percentages as 0.5~2.5ms pulse widths. The sections below unify to the real interface `setDriver(pin, PinDriver)` (2 args), duty-percent semantics for PWM (aligned with `js_pal_pwm_set_duty(channel, percent)`), and canonical names from `pins[]`.

**LED (Digital Output)**: Register `generic-led`, powerDomain `3V3_SYS`. Place `{id:'${componentId}:led_drv', state:'Z', strength:WEAK}` driver on both Anode and Cathode; on `onPinChange`, compute `voltageAcross = max(0, V_anode - V_cathode - 1.8)` (1.8V forward voltage drop), `brightness = min(1, voltageAcross/1.5)`, set `element.value = brightness>0.1`, `element.brightness = brightness`; cleanup un-subscribes and calls `removeDriver`.

**Pushbutton (Digital Input + Interrupt)**: `pushbutton`. Mapped pin uses `getMappedPin('Pin1') ?? getMappedPin('Pin2')` (canonical name); default WEAK `'Z'` (relies on board/external pull-up, active-low); drives 0 with SUPPLY on press, restores WEAK `'Z'` on release; listens to DOM `button-press`/`button-release`.

**Potentiometer (ADC Analog)**: `potentiometer`, mapped to `SIG`. `input` event reads 0.0~1.0, `simulatedVoltage = percent*3.3`, uses `pinArbiter.setAnalogDriver(adcPin, { id: driverId, value: percent, strength: SUPPLY })` (real analog channel API, see §4.3).

**Servo Motor / Joint (PWM Output + WebGL)**: `servo-motor`, powerDomain `5V_PERIPHERAL`, mapped to `PWM`. **Channel 1b uses duty percentage semantics (L2), without simulating carrier edges**; angle mapping `targetAngle = (duty/100)*180`, dispatches `window.dispatchEvent(new CustomEvent('servo-rotate', {detail:{componentId, angle}}))`, Three.js viewport listens and sets `joint.rotation.y`. (Legacy comments mapping "0.5~2.5ms pulse width → angle" conflicted with the Channel 1b model and have been removed; devices requiring µs pulse width semantics must use Channel 1 edge injection. PWM routing see [`08-channel-routing.md`](./08-channel-routing.md) §2.3; carrier/period behavior see [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md).)

---

## 4. PinArbiter Electrical SSOT

`PinArbiter` is the sole arbiter of GPIO electrical state, superseding the legacy `PinManager` naming (deprecated).

### 4.1 4-Value Logic & Drive Strengths (TS)

```ts
const LogicStates = { LOW: 0, HIGH: 1, HI_Z: 'Z', CONFLICT: 'X' } as const;
type LogicState = 0 | 1 | 'Z' | 'X';

enum DriveStrength { SUPPLY = 3, PULL = 2, WEAK = 1 }
// SUPPLY: VCC/GND direct or push-pull GPIO
// PULL:   Resistor pull-up/down (I2C external 4.7kΩ)
// WEAK:   Weak internal pull-up / open-drain released / floating input
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
  removeDriversByIdPrefix(prefix: string): void;   // reset/lifecycle
  readPin(pin: number): LogicState;
  getResolvedVoltage(pin: number): number;         // 0~3.3V estimation (LED brightness, etc.)
  onPinChange(pin: number, cb: PinChangeCallback): () => void;
  onContention(cb: PinContentionCallback): () => void;
  getDrivers(pin: number): PinDriver[];            // diagnostics
  // Analog channels
  setAnalogDriver(pin: number, driver: AnalogDriver): void;
  removeAnalogDriver(pin: number, driverId: string): void;
  readAnalog(pin: number): number;                 // [0,1], high strength wins, tie takes larger (high-side Wire-OR)
  clearTrace(): void;
}
```

Arbitration Algorithm: (1) Ignore all `'Z'`; (2) Find maximum strength; (3) If drivers with max strength agree → resolved state; (4) If disagree → `'X'` contention and warn; (5) If no active drivers → `'Z'` floating.

**I2C Wired-AND Example**: External pull-up `{id:'board:i2c-pullup-sda', state:1, strength:PULL}` + MCU open-drain `{id:'mcu:sda', state:0, strength:SUPPLY}` → reads 0 (active-low); MCU released to `'Z'` → reads 1 (pull-up wins).

### 4.2 TS 4-State $\leftrightarrow$ Wasm ABI Mapping (Added in this Revision)

TS `LogicState` is `0|1|'Z'|'X'` (string union), encoded across Wasm ABI as **uint8 numbers** (`wink-micro-os/targets/wasm/wasm_bridge.h`, `WasmImports.js_pal_gpio_read_state`):

| Logic State | TS Value | Wasm ABI (`js_pal_gpio_read_state` return) | C Enum |
|---|---|---|---|
| LOW | `0` | `0` | `JS_GPIO_STATE_LOW=0` |
| HIGH | `1` | `1` | `JS_GPIO_STATE_HIGH=1` |
| Hi-Z (Floating) | `'Z'` | `2` | `JS_GPIO_STATE_HIZ=2` |
| CONFLICT (Contention) | `'X'` | `3` | `JS_GPIO_STATE_CONFLICT=3` |

Driver-ID Prefix Conventions:

| Prefix | Meaning | Relevant API |
|---|---|---|
| `mcu:gpio{N}` | MCU firmware driver (GPIO output / open-drain release) | `js_pal_gpio_release_mcu` (Removed on INPUT* / open-drain release) |
| `ideal:ui:` | UI/test ideal level injection | `js_pal_gpio_drive_ideal` / `release_ideal` |
| `${componentId}:...` | Plugin / component driver (pull-up, LED, etc.) | `setDriver` / `removeDriver` |

> When adding/changing these imports, bump `PAL_WASM_ABI_HASH` (kept identically in C and TS, verified in `ssotAlignment.test.ts`).

### 4.3 Analog Channels

`AnalogDriver = { id, value:number(0..1), strength }`; `readAnalog` returns normalized values, with the highest strength driver prevailing and ties resolving to the maximum value (ideal high-side Wire-OR approximation). Physical source binding for ADC Channel 3 is described in [`08-channel-routing.md`](./08-channel-routing.md) §2.4.

> **Channel 3 Consumption Model (ADR-0057, 2026-08-05)**: Wasm-side `js_pal_adc_read_norm(pin)` directly reads `readAnalog(pin)` returning `[0,1]`; C-side `pal_wasm_adc.c` converts this to raw counts/mV and overlays RC filtering/noise. PinArbiter is the analog electrical SSOT; JS performs no mV conversions and has no concept of full-scale voltage.

### 4.4 Considerations for Voltage Estimation

In the 4-state voltage mapping table, `'Z'` defaulting to 0.0V is a "component-customizable" default, not implying that a floating pin is physically 0V; the arbitration algorithm itself ignores Z, allowing PULL/WEAK drivers to determine voltage. Devices like LEDs may use `getResolvedVoltage` for brightness estimation, but this must not be used to infer that "floating pins read 0".

---

## 5. Relationship with Four Channels / Plugins

- PinArbiter represents the electrical landing point for Channel 1 (Pin); bus devices (SSD1306, etc.) route through Channel 2 `I2CBus`/`SPIBus`/`UARTBus`, without bit-level simulation in pin arbitration;
- Display plugins like OLED: C executes full I2C write buffers, and `MonoOledPlugin` parses command/data streams into framebuffers (legacy Scheme-A address short-routing is deprecated);
- Distances computed by ProductWorld / 3D Raycaster must be converted into ECHO edges or ADC values for injection, and are **strictly forbidden** from being returned directly as DAL values (see [`08-channel-routing.md`](./08-channel-routing.md) §4);
- The registry does not perform tracing directly; `pal.transfer` style summaries are recorded by the Worker upon `js_pal_*` returns.

---

## 6. Assets Inherited from Velxio (Merged from Original 04 Analysis)

Reusable conclusions from former `04-velxio-migration-analysis.md` (no longer a separate document):

| Asset | Disposition |
|---|---|
| `@wokwi/elements` Web Components (LED/button/LCD1602/7-seg/keypad/potentiometer) | 100% Inherited; Vite configured with `compilerOptions.isCustomElement: tag => tag.startsWith('wokwi-')` |
| SVG Orthogonal Wires (Union-Find netlist + L-shaped/multi-segment polylines) | Inherited algorithm, refactored into Vue 3 + Pinia + SVG templates (see §1.1) |
| TS Virtual Peripheral State Machines (VirtualSSD1306/DS1307/PCF8574, implementing standard `I2CDevice`) | Inherited and mounted onto I2CBus; decoupled from CPU emulators |
| AVR8js / rp2040js / QEMU / Cloud-based instruction-level emulators | **Completely discarded** (API/component translation-level simulation, not instruction-level; zero server cost) |
| React Zustand / Tailwind | Migrated to Pinia / Element Plus |

Positioning Difference: Velxio performs instruction/register-level hardware emulation; Wink performs API/component translation-level Wasm simulation, compiling single-source C business code to wasm32 and running all boards within a single Worker sandbox.

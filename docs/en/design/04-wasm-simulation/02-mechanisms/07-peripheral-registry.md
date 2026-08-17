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
| **Landed** | **Partial**: PinArbiter / Configuration boundaries / TS $\leftrightarrow$ ABI 4-state mapping are **Landed**; SchemaForm canvas is **Partial**; `powerDomain` lifecycle is **Planned** |
| Supporting Axis | **A (secondary, configuration plane)** |
| Associated Code | `@wink-ai/unisim` (PinArbiter / PeripheralRegistry / LogicTypes), `wink-micro-os/targets/wasm/wasm_bridge.h` |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0003, 0040 |
| Migrated From | `04-wasm-simulation-2.0/08-peripheral-registry.md` |

> This document defines how virtual peripherals are declared, where schematic metadata resides, how electrical pin contention is arbitrated, and how TypeScript logic states map to Wasm ABI.

---

## 0. Configuration Source Boundaries

The platform organizes peripheral configurations across four distinct layers:

| Configuration | Ownership | Scope | Consumer |
|---|---|---|---|
| **`wink-app.json`** | Firmware Device Tree SSOT ([ADR-0040](../../../decisions/unisim/0040-arduino-semantic-sim-json-gate.md)) | Peripheral instances, pin mappings, channels, device IDs; semantic bypass gates | Codegen $\rightarrow$ `device_tree.h`, DAL/BAL |
| **`sim-project.json`** | Simulation Canvas / Schematic | Boards, components, wire connections, routing coordinates | UniSim Canvas UI, PinArbiter |
| **`peripheral-definition.json`** | Peripheral Type Metadata | `tagName`, `pins[]`, `properties[]` (SchemaForm), thumbnails | SchemaForm property inspector |
| **`device_tree.h`** | Generated C Header | Generated static C structs for device instances | Firmware compilation |

- `wink-app.json` governs firmware bindings; `sim-project.json` governs canvas topology.
- Undeclared semantic bypasses fail at compile time (Fail-Loud).
- **Infrastructure Devices** (e.g., PCF8574 IO expanders, TCA9548A I2C muxes) declare `"category": "infrastructure"`.

---

## 1. Schematic Topology Storage (`sim-project.json`)

Flat multi-board schema model:

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

### 1.1 Adaptive Wire Routing

1. **orthogonal** (Default): Right-angled routing computed dynamically using relative steps (`v[N]`, `h[N]`, `*`).
2. **custom**: User-manipulated paths storing explicit `{x,y}[]` coordinates.

---

## 2. SchemaForm Peripheral Metadata (`peripheral-definition.json`)

Native integration with `@yo-cloud/yo-ux-vue` SchemaForm:

```jsonc
{
  "$schema": "https://unisim-spec.org/v1/peripheral-definition.schema.json",
  "id": "generic-led",
  "tagName": "wokwi-led",
  "name": { "en": "LED", "zh": "发光二极管" },
  "category": "output",
  "visual": { "thumbnail": "<svg .../>", "dimensions": { "width": 32, "height": 32 } },
  "pins": [
    { "name": "Anode", "label": "A", "type": "digital_io", "description": "Anode" },
    { "name": "Cathode", "label": "K", "type": "gnd", "description": "Cathode" }
  ],
  "properties": [
    { "prop": "color", "label": "Color", "compType": "Select",
      "compProps": { "options": ["red","green","yellow","blue"] }, "defaultValue": "red",
      "rules": [{ "required": true, "message": "Required", "trigger": "change" }] },
    { "prop": "currentLimitResistor", "label": "Current Limiting Resistor (Ω)", "compType": "Slider",
      "compProps": { "min": 0, "max": 10000, "step": 10 }, "defaultValue": 220 }
  ]
}
```

---

## 3. Virtual Peripheral Registry (`PeripheralRegistry`)

Synchronizes DOM visual elements with logical pin states inside the simulation worker.

### 3.1 Lifecycle Interface (Design Surface)

```ts
interface PeripheralLifecycle {
  powerDomain: string;
  powerUpDelayUs?: number;
  onPowerOn?(): Promise<void>;
  onPowerOff?(): void;
  onReset?(): void;
  onPropertyChange?(key: string, oldValue: unknown, newValue: unknown): void;
}

interface PeripheralSimulationLogic extends PeripheralLifecycle {
  onPinStateChange?(pinName: string, state: LogicState): void;
  attachEvents?(element: HTMLElement, pinArbiter: IPinArbiter,
                getMappedPin: (partPinName: string) => number | null,
                componentId: string): () => void;
}
```

### 3.2 Driver Implementation Patterns

- **LED (Digital Output)**: Sets drivers on Anode/Cathode; computes forward voltage delta $V_{\text{across}} = \max(0, V_A - V_K - 1.8\text{V})$ and adjusts DOM element brightness.
- **Pushbutton (Digital Input + Interrupt)**: Drives `0` with `SUPPLY` strength on press; releases to `WEAK` `'Z'` on release.
- **Potentiometer (ADC Analog)**: Dispatches `setAnalogDriver(adcPin, { id, value: percent, strength: SUPPLY })`.
- **Servo Motor (PWM Output)**: Consumes duty percentage over Channel 1b ($TargetAngle = (duty / 100) \times 180^\circ$) to animate 3D viewport joints.

---

## 4. PinArbiter Electrical SSOT

### 4.1 4-Value Logic & Drive Strengths

```ts
const LogicStates = { LOW: 0, HIGH: 1, HI_Z: 'Z', CONFLICT: 'X' } as const;
type LogicState = 0 | 1 | 'Z' | 'X';

enum DriveStrength { SUPPLY = 3, PULL = 2, WEAK = 1 }
```

Arbitration Rules:
1. Ignore `'Z'` (Hi-Z);
2. Find maximum drive strength;
3. If all top-strength drivers agree $\rightarrow$ Resolved state;
4. If top-strength drivers conflict $\rightarrow$ `'X'` (Contention);
5. If no drivers active $\rightarrow$ `'Z'` (Floating).

### 4.2 TypeScript LogicState $\leftrightarrow$ Wasm ABI Numeric Mapping

| Logic State | TS Value | Wasm ABI Value | C Enumeration |
|---|---|---|---|
| LOW | `0` | `0` | `JS_GPIO_STATE_LOW = 0` |
| HIGH | `1` | `1` | `JS_GPIO_STATE_HIGH = 1` |
| Hi-Z (Floating) | `'Z'` | `2` | `JS_GPIO_STATE_HIZ = 2` |
| CONFLICT (Contention) | `'X'` | `3` | `JS_GPIO_STATE_CONFLICT = 3` |

### 4.3 Analog Channels

`readAnalog(pin)` resolves normalized analog voltages $[0, 1]$, where the highest strength driver prevails. C-side `pal_wasm_adc.c` scales values to raw counts and millivolts ([ADR-0057](../../../decisions/unisim/0057-analog-channel-pin-arbiter-ssot.md)).

---

## 5. Relationship with 4 Channels & Plugins

- PinArbiter represents the electrical terminal for Channel 1 (Pin);
- Bus devices (SSD1306) route via Channel 2 (`I2CBus`/`SPIBus`/`UARTBus`);
- 3D spatial distances must inject via Echo pin edges or raw ADC counts, never directly into DAL variables.

---

## 6. Heritage from Velxio

| Asset | Integration Status |
|---|---|
| `@wokwi/elements` Web Components | 100% Inherited |
| SVG Orthogonal Wires (Union-Find netlist) | Reimplemented in Vue 3 + Pinia |
| TS Virtual Peripheral State Machines (I2C) | Decoupled from CPU emulators and mounted to `I2CBus` |
| Instruction Emulators (AVR8js, rp2040js, QEMU) | **Discarded** in favor of single-source C Wasm compilation |

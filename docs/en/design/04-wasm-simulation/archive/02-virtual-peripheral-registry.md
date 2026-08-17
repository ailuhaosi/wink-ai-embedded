# 4.2 UniSim Virtual Circuit Specification & SchemaForm Configuration

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/archive/02-virtual-peripheral-registry.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

To enable visual drag-and-drop circuit design, multi-board netlist wiring, and dynamic peripheral property configuration, Wink-AI defines the **UniSim (Unified Simulation Project) Virtual Peripheral & Topology Specification**.

---

## 1. Project Topology & Netlist Storage Specification (`sim-project.json`)

Circuit netlists and canvas topologies are organized in flat object models capturing multi-board nodes, component coordinates, physical attributes, and electrical wire connections.

### 1.1 Netlist Schema Example

```json
{
  "$schema": "https://unisim-spec.org/v1/sim-project.schema.json",
  "version": 1,
  "projectName": "Multi-Board IoT Gateway",
  "boards": [
    {
      "id": "gateway_esp32",
      "type": "board-esp32-s3",
      "x": 100,
      "y": 150,
      "sourceDir": "src/gateway-esp32",
      "settings": {
        "baudRate": 115200,
        "flashSize": 8388608
      }
    },
    {
      "id": "node_nano",
      "type": "board-arduino-nano",
      "x": 500,
      "y": 150,
      "sourceDir": "src/node-nano"
    }
  ],
  "components": [
    {
      "id": "led_status",
      "type": "generic-led",
      "x": 350,
      "y": 280,
      "rotation": 90,
      "properties": {
        "color": "#ff0000",
        "currentLimitResistor": 220
      }
    }
  ],
  "connections": [
    {
      "id": "wire_1",
      "from": "node_nano:D13",
      "to": "led_status:Anode",
      "color": "red",
      "signalType": "digital",
      "routing": {
        "mode": "orthogonal",
        "path": ["v15", "h-30", "*"]
      }
    },
    {
      "id": "wire_2",
      "from": "gateway_esp32:TX0",
      "to": "node_nano:RX",
      "color": "blue",
      "signalType": "uart",
      "routing": {
        "mode": "custom",
        "points": [
          { "x": 180, "y": 190 },
          { "x": 340, "y": 190 },
          { "x": 480, "y": 170 }
        ]
      }
    }
  ]
}
```

---

## 2. SchemaForm-Driven Peripheral Property Configuration

Peripheral metadata definitions align directly with `@yo-cloud/yo-ux-vue` `<SchemaForm>` schemas.

### 2.1 Peripheral Definition Schema (`peripheral-definition.json`)

```json
{
  "$schema": "https://unisim-spec.org/v1/peripheral-definition.schema.json",
  "id": "generic-led",
  "tagName": "wokwi-led",
  "name": {
    "en": "Light Emitting Diode",
    "zh": "发光二极管 (LED)"
  },
  "category": "output",
  "visual": {
    "thumbnail": "<svg width=\"64\" height=\"64\">...</svg>",
    "dimensions": { "width": 24, "height": 36 }
  },
  "pins": [
    { "name": "Anode", "label": "A", "type": "digital_io", "description": "Anode" },
    { "name": "Cathode", "label": "C", "type": "gnd", "description": "Cathode" }
  ],
  "properties": [
    {
      "prop": "color",
      "label": "LED Color",
      "compType": "Select",
      "compProps": {
        "placeholder": "Select color",
        "options": [
          { "label": "Red", "value": "red" },
          { "label": "Green", "value": "green" },
          { "label": "Yellow", "value": "yellow" },
          { "label": "Blue", "value": "blue" }
        ]
      },
      "defaultValue": "red",
      "rules": [{ "required": true, "message": "Color is required", "trigger": "change" }]
    },
    {
      "prop": "currentLimitResistor",
      "label": "Current Limiting Resistor (Ω)",
      "compType": "Slider",
      "compProps": {
        "min": 0,
        "max": 10000,
        "step": 10
      },
      "defaultValue": 220
    }
  ]
}
```

---

## 3. Adaptive Wire Routing

1. **Orthogonal Routing**: Manhattan-style horizontal and vertical segments (`v[N]`, `h[N]`, `*`).
2. **Custom Routing**: Absolute control points (`points: {x, y}[]`) when user manually drags wire handles.

---

## 4. Virtual Peripheral Registry & PinArbiter

UniSim implements a **4-value logic state** and **3-level drive strength** electrical arbitration system.

```typescript
export type LogicState = 0 | 1 | 'Z' | 'X';

export enum DriveStrength {
  SUPPLY = 3, // Direct rail (VCC/GND, Push-Pull)
  PULL   = 2, // Resistor pull (I2C 4.7kΩ pullup)
  WEAK   = 1, // Open-drain release, high impedance input
}

export interface PinArbiter {
  readPin(pin: number): LogicState;
  getResolvedVoltage(pin: number): number;
  onPinChange(pin: number, callback: (pin: number, state: LogicState) => void): () => void;
  setDriver(pin: number, driver: PinDriver): void;
  removeDriver(pin: number, driverId: string): void;
}

export interface PinDriver {
  id: string;
  state: LogicState;
  strength: DriveStrength;
}
```

### 4.1 Typical Drivers: LED, Button, Potentiometer, Servo

- **LED**: Computes brightness via resolved voltage delta: $V_{\text{anode}} - V_{\text{cathode}} - 1.8\text{V}$.
- **Button**: Drives `LogicState.Z` (weak) when unpressed, and `LogicState.0` (`DriveStrength.SUPPLY`) when pressed.
- **Potentiometer**: Reads normalized percentage and sets analog voltage ($0.0 \sim 3.3\text{V}$).
- **Servo Motor**: Listens to PWM duty cycles and dispatches joint angle updates ($0^\circ \sim 180^\circ$) to 3D WebGL renderers.

### 4.2 PinArbiter 4-Value Logic Arbitration

| State | Meaning | Voltage |
|---|---|---|
| `0` | Logic Low | 0.0V |
| `1` | Logic High | 3.3V |
| `'Z'` | High Impedance / Floating | 0.0V |
| `'X'` | Contention / Short-circuit | 1.65V |

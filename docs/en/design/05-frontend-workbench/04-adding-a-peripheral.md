# 04. How to Add a Peripheral Plugin (With Simulation)

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/04-adding-a-peripheral.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

A concise guide for adding a **simulation-capable peripheral** to `embedded-frontend`. Peripheral packages manage asset libraries, canvas/world rendering, property inspectors, simulation I/O declarations, and semantic UI bindings; **firmware DAL/C drivers are not part of this package**.

> **Active Status (2026-07-12)**: Simulation Data Plane refactoring M0–M6 landed ([ADR-0027](../../decisions/unisim/0027-sim-observation-data-planes.md) Accepted). The host acts as a pure bus; isomorphic peripherals require only an **isolated directory + a single-line import**, without touching Worker or Workbench branches.

Standard Count: **3 Output Observation Planes + 1 Input Injection Plane = 4 Data Planes**.

---

## 0. 5-Minute Overview

```text
1. Select Channel (Input ④ / Output ①②③) + Verify Raw availability -> Isomorphic, 0 Worker changes
2. Copy _template -> peripherals/<type>/
3. Fill definition.ts (pins / props / observe|inject / ui / actuatorObserve)
4. Author purely presentational CanvasGlyph (consumes props only; no simulation-runtime imports)
5. Register definition in index.ts (register converter for ③) + 1-line import in peripherals/index.ts
6. Run npm test & architecture guards; verify in Simulate mode
```

| Goal | Channel | Reference |
|---|---|---|
| Real-time semantic quantities (Angles, RPM) | **③** | `servo/`, `motor_driver_stub/` |
| User inputs / Distance slider | **④** | `button/`, `ultrasonic/` |
| LED illumination | **①** (Optionally add ③) | `led/` |
| OLED screen refresh | **②** | `oled/` |

---

## 1. Select the Data Plane

Governed by [ADR-0027](../../decisions/unisim/0027-sim-observation-data-planes.md).

```text
Is it "User/Environment -> Firmware"?
  ├─ Yes -> ④ Ideal Inject (Input; not an observation)
  └─ No (Firmware -> UI) ->
        Full display buffer? -> ② Display Payload
        Needs angle/RPM/frequency or Actuator Panel entry? -> ③ Actuator Observation
        Raw pin logic in circuit canvas? -> ① Pin Mirror
```

| Data Plane Category | Count | Planes |
|---|---|---|
| Output Observation | **3** | ① `pinStates` · ② `oledFb` / display · ③ `actuatorObservations` |
| Input Injection | **1** | ④ Ideal Inject |
| Total | **4** | ① + ② + ③ + ④ |

---

## 2. SSOT Ownership

| Data Domain | SSOT Location | Query Entry Point |
|---|---|---|
| Circuit Peripherals (Pins, Canvas) | `peripherals/<type>/definition.ts` | `registry` $\rightarrow$ `deviceCatalog` |
| Development Boards | `boards/<boardId>/definition.ts` | `boardRegistry` |
| Mechanical / Environment Assets | `world-assets/<id>/definition.ts` | `worldRegistry` |
| Mapping Schema | `types/mapping-registry.ts` | Binding Validation |
| User Binding Instances | `manifest.bindings` | Project Manifest JSON |

---

## 3. Standard Workflow (Isomorphic Peripheral · 5 Steps)

### Step 1 — Scaffold
```bash
cp -r ../../../../wink-ai/packages/embedded-frontend/src/peripherals/_template ../../../../wink-ai/packages/embedded-frontend/src/peripherals/<type>
```

### Step 2 — Fill `definition.ts`
Implement `PeripheralDefinition` from `peripherals/types.ts`:

#### Channel ③ Skeleton (Actuator Semantic Sync)
```ts
actuatorObserve: {
  profile: {
    defaultQuantity: 'angular_position',
    unit: 'deg',
    convert: 'my_convert_id',
  },
},
simulation: {
  observe: (comp, builder) => {
    builder.watchActuatorSource({
      deviceComponentId: comp.id,
      transport: 'pwm_channel',
      transportKey: (comp.props.pwmChannel as number) ?? 0,
    });
  },
},
ui: {
  canvasProps: (comp, ctx) => {
    const obs = ctx.actuatorObservations.find(
      (o) => o.deviceComponentId === comp.id && o.quantity === 'angular_position',
    );
    return {
      id: comp.id,
      label: comp.props.label ?? comp.id,
      angle: typeof obs?.value === 'number' ? obs.value : 90,
    };
  },
},
```

#### Channel ④ Skeleton (Ideal Input Injection)
```ts
simulation: {
  inject: {
    kind: 'gpio_ideal',
    apply(comp, ctx) {
      // ctx.apis.setPinIdeal(pin, level)
      // ctx.apis.setUltrasonicDistance(trig, echo, cm)
    },
  },
},
```

### Step 3 — Pure Presentational Components (`CanvasGlyph.vue`)
Components **consume props only**. Direct imports of `simulation-runtime` or Wasm modules are blocked by architectural guards.

### Step 4 — Registration in `index.ts`
```ts
import { registry } from '../registry';
import { myDefinition } from './definition';
import { actuatorConverterRegistry } from '@/services/actuator-converter-registry';

actuatorConverterRegistry.register('my_convert_id', (raw, ctx) => {
  return {
    quantity: 'angular_position',
    value: raw.value,
    unit: 'deg',
    role: 'command',
  };
});

registry.register(myDefinition);
```

### Step 5 — One-Line Mount in `peripherals/index.ts`
```ts
import './<type>';
```

---

## 4. Summary Matrix by Channel

- **Channel ③ Actuators**: `actuatorObserve` + `watchActuatorSource` + `ui.canvasProps` + converter.
- **Channel ④ Sensors**: `simulation.inject` + `inspectorExtra`.
- **Channel ① LEDs**: `ui.*` reads `ctx.pinStates` via `isPinHigh`.
- **Channel ② Displays**: `watchDisplay('ssd1306_fb')` + framebuffer rendering.
- **Non-Isomorphic**: Requires Wasm export and Worker telemetry extension first.

---

## 5. Automated Verification

```bash
cd ../../../../wink-ai/packages/embedded-frontend
bun test
bun run typecheck
bun run build
bunx vitest run src/peripherals/__tests__/architecture-data-plane.test.ts
```
Expected: `offenders = []`.

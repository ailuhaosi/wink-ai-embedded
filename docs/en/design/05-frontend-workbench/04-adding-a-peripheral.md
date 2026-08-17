# 04. How to Add a Peripheral Plugin (With Simulation)

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/04-adding-a-peripheral.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

The fastest path for beginners: Adding a **simulation-capable** peripheral plugin to `embedded-frontend`.  
Peripheral packages manage asset library entries, canvas/world rendering, property inspectors, simulation I/O declarations, and semantic UI bindings; **firmware DAL / C drivers are not part of this package**.

> **Active Status (2026-07-12):** Simulation Data Plane refactoring M0–M6 has fully landed ([ADR-0027](../../decisions/unisim/0027-sim-observation-data-planes.md) Accepted). The host acts as a pure bus; isomorphic peripherals require only an **isolated directory + a single-line import**, without touching Worker or Workbench special branches.

Standard nomenclature: **3 Output Observation Channels + 1 Input Injection Channel = 4 Data Planes** (never say "4 observation channels").

---

## 0. 5-Minute Overview (Read This First)

```text
1. Select Channel (Input ④ / Output ①②③) + Confirm Raw availability → Isomorphic, zero Worker modifications
2. Copy _template → peripherals/<type>/
3. Fill definition.ts (pins / props / observe|inject / ui / actuatorObserve)
4. Author purely presentational CanvasGlyph (consumes props only; forbidden to import simulation-runtime)
5. Register definition in index.ts (register converter for ③) + 1-line import in peripherals/index.ts
6. npm test + architecture guards; verify semantic telemetry / injection closed loop in Simulate
```

| Desired Behavior | Primary Channel | Reference Sample |
|---|---|---|
| Real-time synchronization of **semantic quantities** (angles, RPM, etc.) | **③** | `servo/`, `motor_driver_stub/` |
| Button press / Distance slider injected into firmware | **④** | `button/`, `ultrasonic/` |
| LED illumination (Circuit view) | **①** (Optionally add ③ for panel) | `led/` |
| OLED display buffer updates | **②** | `oled/` |

**Isomorphic** = Reuses existing Raw (`gpio` / `pwm` / `ssd1306_fb`) or existing injection APIs (`setPinIdeal` / `setUltrasonicDistance`).  
**Non-isomorphic** = Desired data cannot be expressed by existing exports $\rightarrow$ First expand Wasm export + Worker, then author peripheral package (requires review).

---

## 1. Select Channel First (Mandatory Before Coding)

Governed by [ADR-0027](../../decisions/unisim/0027-sim-observation-data-planes.md). Skipping this step and copying the wrong peripheral template is the most common cause of rework.

```text
Is it "User / Environment → Firmware"?
  ├─ Yes → ④ Ideal Inject (Input; not an observation)
  └─ No (Firmware → UI) →
        Full display buffer? → ② Display Payload
        Needs angle / RPM / frequency / semantic color, or enters Actuator Panel? → ③ Actuator Observation
        Raw pin logic, primarily in Circuit View? → ① Pin Mirror
```

| Category | Count | Included Channels |
|---|---|---|
| Output Observation | **3** | ① `pinStates` · ② `oledFb` / display · ③ `actuatorObservations` |
| Input Injection | **1** | ④ Ideal Inject |
| Total | **4** | ① + ② + ③ + ④ |

### Forbidden (Blocked by Architecture Tests / Fails Review)

- Adding `type === 'xxx'` checks in `bind*` / `EmbeddedWorkbench` / `simulation-client`
- Glyph / WorldWidget **directly reading** data plane refs in `simulation-runtime` (must route through `ui.*` + props)
- Stuffing framebuffers into `ActuatorObservation`
- Wrapping Channel ④ inputs as Channel ③ "for convenient panel display"
- Consuming Channel ① with raw boolean checks $\rightarrow$ must use `isPinHigh(...)` (see `peripherals/types.ts`)

For detailed scenario matrices, see [Technical Design §6](../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md#6-场景决策矩阵外设作者速查).

---

## 2. SSOT Ownership (Must Read Before Adding)

| Data Domain | SSOT Location | Query Entry Point |
|---|---|---|
| Circuit Peripherals (Pins, Draggable) | `peripherals/<type>/definition.ts` | `registry` $\rightarrow$ `deviceCatalog` |
| Development Boards | `boards/<boardId>/definition.ts` | `boardRegistry` |
| Mechanical / Environment Assets (No circuit pins) | `world-assets/<id>/definition.ts` | `worldRegistry` |
| Mapping Type Schema | `types/mapping-registry.ts` | Binding Validation |
| User Binding Instances | `manifest.bindings` | Project JSON |

**Discipline:**

- `pins[]` is the **sole** handwritten source of pin definitions; `catalog.pins` is deprecated.
- Canvas routing netlists are derived from `definition.pins` + recommended explicit `wireNet` declarations; **never** maintain hardcoded parallel netlists in the host.
- `wireNet` optional roles: `'primary' | 'secondary' | 'vcc' | 'gnd'`. Identical roles are automatically coalesced into `pinCandidates` within the same `NetDefinition`.
- `worldCoupling` is declared only in `definition.catalog`.
- **Never** handwrite peripheral/stub/board entries in `device-catalog.ts`.
- Components with pins participating in `connections` must supply `CanvasGlyph.vue`.

Full checklist see [Peripheral Plugin Registry Plan · Appendix A](../../implementation-plans/core/2026-07-10-peripheral-plugin-registry-plan.md#14-附录-a--新增外设-checklistp3-完成后的最终形态).  
Four-directory relationships: [`../../../../wink-ai/packages/embedded-frontend/src/catalog/README.md`](../../../../wink-ai/packages/embedded-frontend/src/catalog/README.md).

---

## 3. Standard Workflow (Isomorphic Peripheral · 5 Steps)

### Workflow Step 1 — Scaffold

```bash
cp -r ../../../../wink-ai/packages/embedded-frontend/src/peripherals/_template ../../../../wink-ai/packages/embedded-frontend/src/peripherals/<type>
```

`<type>` matches `definition.type` (globally unique).

### Workflow Step 2 — Fill `definition.ts`

Contract type: [`peripherals/types.ts`](../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts) $\rightarrow$ `PeripheralDefinition`.

| Field | Purpose |
|---|---|
| `type` / `displayName` / `category` | Identity and asset library grouping |
| `pins` | **Sole pin SSOT** (includes `catalogType`, `defaultConnection`, `relX`/`relY`) |
| `props` | Property schema $\rightarrow$ auto-generates Property Inspector (no host per-type branching) |
| `size` / `wireColor` | Canvas dimensions and wire routing colors |
| `catalog` | `id` / `worldCoupling` / `allowed*Mappings` (**excludes** `pins`) |
| `canvas` / `world` | Viewport components (`canvas` required if device has pins) |
| `inspectorExtra` | Optional; for controls not expressible in schema (e.g. distance sliders) |
| **`simulation.observe`** | Output collection declarations (①/②/③ Raw sources) |
| **`simulation.inject`** | **④** Ideal input injection (`apply` / optional `idle`) |
| **`actuatorObserve`** | **③** Semantic profile (quantity / unit / convert id) |
| **`ui.canvasProps` / `ui.worldProps`** | Maps `SimViewContext` to Glyph props (invoked automatically by host) |

**Fill Contracts by Channel:**

| Channel | What to write in definition |
|---|---|
| **①** | `ui.*` reads from `ctx.pinStates`, via `isPinHigh` |
| **②** | `observe` $\rightarrow$ `watchDisplay('ssd1306_fb')` (+ optional `watchI2C` metadata only); `ui.*` passes FB |
| **③** | `actuatorObserve` + `watchActuatorSource`; `ui.*` reads semantic values from `ctx.actuatorObservations` |
| **④** | `simulation.inject`; **do not** write fake `observe` / `watchUltrasonic` |

Observe Builder API ([`observe-builder.ts`](../../../../wink-ai/packages/embedded-frontend/src/peripherals/observe-builder.ts)):

| Method | Channel | Description |
|---|---|---|
| `watchGpio(pins)` | ① | GPIO digital signals |
| `watchI2C(sda, scl)` | Metadata | No longer implicitly enables OLED FB |
| `watchDisplay(kind)` | ② | E.g. `'ssd1306_fb'` |
| `watchActuatorSource(...)` | ③ | Actuator Raw source (`pwm_channel` / `gpio_pin`) |
| `watchUltrasonic(...)` | — | **Deprecated**; distance uses Channel ④ `inject` |
| `setParam(key, value)` | — | Custom Worker parameter |

#### ③ Skeleton (Semantic Real-Time Sync · Most Common)

```ts
actuatorObserve: {
  profile: {
    defaultQuantity: 'angular_position', // or angular_velocity / state ...
    unit: 'deg',
    convert: 'my_convert_id', // Registered in index.ts
  },
},
simulation: {
  observe: (comp, builder) => {
    builder.watchActuatorSource({
      deviceComponentId: comp.id,
      transport: 'pwm_channel', // or 'gpio_pin'
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

Gold standards: `servo/definition.ts`, `motor_driver_stub/definition.ts`.

#### ④ Skeleton (Input Injection)

```ts
simulation: {
  inject: {
    kind: 'gpio_ideal', // or 'ultrasonic_distance'
    apply(comp, ctx) {
      // ctx.apis.setPinIdeal(pin, level)
      // ctx.apis.setUltrasonicDistance(trig, echo, cm)
    },
    // idle(comp, ctx) { ... }  // Button release states, etc.
  },
},
```

Gold standards: `button/definition.ts`, `ultrasonic/definition.ts`.

### Workflow Step 3 — Pure Presentational Components

| File | When Required |
|---|---|
| `CanvasGlyph.vue` | Has pins, visible on canvas $\rightarrow$ **Required** |
| `WorldWidget.vue` | Needed in Product World viewport |
| `InspectorExtra.vue` | Controls not expressible via schema |

**Discipline:** Components **consume props only**. Never `import` `simulation-runtime` / `simulation-client` / Wasm / global `window` state.  
Host constructs read-only `SimViewContext` and invokes `definition.ui.canvasProps(comp, ctx)` for injection.

### Workflow Step 4 — Register in `index.ts`

```ts
import { registry } from '../registry';
import { myDefinition } from './definition';
import { actuatorConverterRegistry } from '@/services/actuator-converter-registry';

// Channel ③ only: Raw -> Semantic (ctx.props / ctx.simTimeUs / ctx.stateStore available)
actuatorConverterRegistry.register('my_convert_id', (raw, ctx) => {
  return {
    quantity: 'angular_position',
    value: /* ... */,
    unit: 'deg',
    role: 'command',
  };
});

registry.register(myDefinition);
```

Reference: `servo/index.ts` (duty cycle $\rightarrow$ angle), `motor_driver_stub/index.ts` (duty cycle $\rightarrow$ RPM + `stateStore` inertia).

### Workflow Step 5 — One-Line Mount

In [`peripherals/index.ts`](../../../../wink-ai/packages/embedded-frontend/src/peripherals/index.ts):

```ts
import './<type>';
```

Uses **explicit imports** (avoiding `import.meta.glob`).

**Isomorphic workflows complete here:** Zero changes to Worker, `simulation-client`, or `EmbeddedWorkbench`; zero `type ===` branches added.

Registry APIs: `register` / `get` / `list` / `listByCategory` / `getWireColor` / `getSize` / `getDefaultProps` / `getDefaultPinConnections` (see [`registry.ts`](../../../../wink-ai/packages/embedded-frontend/src/peripherals/registry.ts)).

---

## 4. Minimal Checklist by Channel

### A. ③ Actuators (Real-Time Semantic Synchronization)

1. `actuatorObserve` + `watchActuatorSource` + `ui.canvasProps`
2. Register converter in `index.ts`
3. Glyph consumes semantic props only
4. Single-line import
5. Acceptance: Simulate $\rightarrow$ `SimActuatorPanel` shows semantic rows; canvas updates accordingly

Modified scope: strictly `peripherals/<type>/` + `peripherals/index.ts`.

### B. ④ Sensors / HMI

1. `simulation.inject` (`apply` + optional `idle`)
2. `inspectorExtra` or controls modify `comp.props`
3. Avoid `watchUltrasonic` / fake observe declarations
4. Acceptance: Sliders/Buttons $\rightarrow$ firmware behavior mutates

### C. ① LEDs

1. `ui.*` reads `ctx.pinStates` + `isPinHigh`
2. If actuator panel visibility needed: append Channel ③ (see `gpio_to_state` in `led/`)

### D. ② Displays

1. `watchDisplay('ssd1306_fb')` (+ optional `watchI2C`)
2. Glyph consumes binder-passed FB and paints locally
3. **New display protocols** $\rightarrow$ Non-isomorphic; expand Worker `displayKinds` first

### E. Non-Isomorphic

1. Review and approve new Raw / Wasm exports
2. Extend Worker telemetry collection
3. Follow A–D workflows

---

## 5. Runtime: Automated Platform Responsibilities

**Outputs (Wasm $\rightarrow$ UI):**

```text
Wasm Raw → Worker STATE_UPDATE → simulation-runtime
  ├─ ① pinStates
  ├─ ② display / oledFb
  └─ ③ Mapper + converter → actuatorObservations
→ SimViewContext → ui.canvasProps → Glyph refresh
```

`SimActuatorPanel` **reads Channel ③ only**: When new actuators declare Observations, the panel lists semantic values **with zero host modifications**.

**Inputs (UI $\rightarrow$ Wasm):**

```text
Control events → runInject / runInjectIdle (per definition.inject)
→ Worker writes aligned with simTimeUs → Firmware reads
```

---

## 6. Acceptance Verification

### Automated

```bash
cd ../../../../wink-ai/packages/embedded-frontend
bun test
bun run typecheck
bun run build
bunx vitest run src/peripherals/__tests__/architecture-data-plane.test.ts
# Expected: offenders = [] (Cleaned in M2; Glyphs must not directly import simulation-runtime)
```

When modifying `PeripheralDefinition`, update `_template/` synchronously and verify via `peripherals/__tests__/template-contract.test.ts`.

### Manual

1. Drag from asset library $\rightarrow$ Canvas dimensions / pin anchors position accurately.
2. Property Inspector schema is editable; `inspectorExtra` operates properly.
3. Simulate:
   - **③** $\rightarrow$ Actuator panel semantic values update in real time; Glyph reacts.
   - **④** $\rightarrow$ Injection drives firmware closed loops (Buttons / Distance sliders).
   - **①** $\rightarrow$ Circuit canvas pin levels reflect accurate states.
   - **②** $\rightarrow$ Display refreshes cleanly.
4. Isomorphic verification: Confirm **zero** `type ===` special-case branches added to Worker or Workbench.

---

## 7. Out of Scope / Forbidden Actions

| Prohibited Action | Rationale |
|---|---|
| Firmware DAL / C Drivers | Implemented in Wasm App / `wink-micro-os` |
| Adding `type ===` in `WorkbenchPropertyInspector` / `bind*` / Workbench | Use `props` / `inspectorExtra` / `ui.*` / `inject` |
| Hardcoding peripheral types in `simulation-client` / Worker (isomorphic) | Declare observation and injection in definitions |
| Glyph importing `simulation-runtime` directly | Fails architectural guard; pass props via `ui.bind` |
| Unreviewed protocol mutations when existing Raw is insufficient | Non-isomorphic changes require Wasm/Worker expansion first |

---

## 8. Simulation Integration Pathways (Active Mainline)

| Pathway | When to Use | Status |
|---|---|---|
| **`simulation.observe` + `ui.*` + (③) `actuatorObserve`/converter** | Outputs: ①/②/③ | ✅ **Active Mainline** (Isomorphic peripherals) |
| **`simulation.inject`** | Inputs: ④ | ✅ **Active Mainline** (Buttons / Ultrasonic, etc.) |
| **`catalog.worldCoupling` + binding** | Sensor/Actuator mappings in Product World | Declarations preserved; evolving alongside W3c ideal-inputs bridge, **does not replace** rows above |

New peripherals: **Follow observe / inject / ui plugin contracts first**; declare `worldCoupling` and `allowed*Mappings` as needed. Do not treat binding bridges as the primary entry point for adding simulation peripherals.

---

## 9. Code Anchors

| Purpose | Path |
|---|---|
| Contract Types / `isPinHigh` / Inject | `peripherals/types.ts` |
| Observe Builder | `peripherals/observe-builder.ts` |
| Converter Registry | `services/actuator-converter-registry.ts` |
| Template | `peripherals/_template/` |
| ③ Gold Standards | `peripherals/servo/`, `motor_driver_stub/` |
| ④ Gold Standards | `peripherals/button/`, `ultrasonic/` |
| ① + Optional ③ | `peripherals/led/` |
| ② Display | `peripherals/oled/` |
| Architecture Guardrails | `peripherals/__tests__/architecture-data-plane.test.ts` |

---

## 10. Related Documentation

- [ADR-0027: Simulation Data Plane Layering: 3 Outputs + 1 Input](../../decisions/unisim/0027-sim-observation-data-planes.md)
- [Implementation Plan Suite · 00-roadmap (M0–M6, Completed)](../../implementation-plans/unisim/00-roadmap.md)
- [Technical Design: Simulation Data Plane Layering](../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md)
- [Catalog SSOT Convergence Plan](../../implementation-plans/core/2026-07-11-catalog-ssot-convergence-plan.md)
- [Peripheral Plugin Registry Implementation Plan](../../implementation-plans/core/2026-07-10-peripheral-plugin-registry-plan.md)
- [Frontend Workbench Architecture](./01-frontend-workbench-architecture.md)
- [Dual-Viewport Product World Layout](./02-dual-viewport-product-world-layout.md)

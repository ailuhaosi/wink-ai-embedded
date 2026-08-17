# 15. Embedded Frontend Workbench Architecture & Experience Design

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/01-frontend-workbench-architecture.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

This document defines the frontend architecture, page layouts, state models, module boundaries, and integration mechanisms for the Wink-AI Embedded Frontend Workbench.

---

## 1. Design Goals

1. **Professional Workbench Experience**: Enables users to design topologies, edit logic, run simulations, inject faults, trace telemetry, compile, and flash firmware in a unified workspace.
2. **Clear State Gating**: Enforces safety progression (S0-S4) across static checking, simulation, fault validation, compilation, and flashing.
3. **Pluggable Integration**: Runs standalone during development; integrates as a lazy-loaded route in the main Wink-AI frontend.
4. **Runtime Isolation**: Decouples Web Workers, trace buffers, and simulation bridges from UI rendering state.
5. **Testability**: State machines, manifest validation, wire routing, and trace diffs can be unit-tested in isolation from UI components.

---

## 2. Information Architecture

A 3-column layout with a bottom console panel:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Top Bar: Project / Target / Safety Level / Consistency / Build Status │
├───────────────┬───────────────────────────────────┬──────────────────┤
│ Left Panel    │ Center Workspace                  │ Right Panel      │
│ - Templates   │ - Circuit Canvas                  │ - Properties     │
│ - Board Lib   │ - Simulation View                 │ - Diagnostics    │
│ - Peripherals │ - Logic State Machine             │ - Fault Inject   │
│ - AI Assistant│ - Generated C Preview             │ - Build & Flash  │
├───────────────┴───────────────────────────────────┴──────────────────┤
│ Bottom Console: Trace / Logs / Static Check / Build Output / AI Fix    │
└──────────────────────────────────────────────────────────────────────┘
```

> **Evolution Note**: The center workspace evolves into a **Dual-Viewport Layout** (2D Circuit + 3D Product World) driven by `design`, `simulate`, and `diagnose` workbench modes ([02-dual-viewport-product-world-layout.md](./02-dual-viewport-product-world-layout.md)).

---

## 3. Page & Workbench Modes

| Mode | Primary Purpose | Center Workspace |
|---|---|---|
| `design` | Component drag-and-drop, wire routing, properties | Circuit Canvas |
| `logic` | State machine / Blockly / DSL editing | Logic Editor |
| `simulate` | Running Wasm, observing virtual peripherals | Dual-Viewport (Circuit + 3D Product World) |
| `diagnose` | Inspecting faults, traces, diagnostics | Trace + Diagnostics |
| `build` | Compilation, manifest inspection, flashing | Build & Flash Wizard |

---

## 4. Module Boundaries

Source code location: `wink-ai/packages/embedded-frontend/src/`

```text
wink-ai/packages/embedded-frontend/src/
├── views/
│   └── EmbeddedWorkbench.vue       # Main Dual-Viewport Workbench View
├── components/
│   ├── canvas/                     # 2D Circuit Canvas (HCTR Wire Routing)
│   ├── product-world/              # 3D Mechanical & Physics Viewport (Three.js/WebGL)
│   ├── device-library/
│   ├── property-inspector/
│   ├── logic-editor/
│   ├── simulation-panel/
│   ├── trace-console/
│   ├── diagnostics/
│   └── build-flash/
├── stores/                         # Pinia State Trees
│   ├── project.store.ts
│   ├── canvas.store.ts
│   ├── simulation.store.ts
│   ├── safety.store.ts
│   ├── trace.store.ts
│   └── build.store.ts
├── services/
│   ├── manifest.service.ts
│   ├── manifest-migration.ts
│   ├── registry.service.ts
│   ├── validation.service.ts
│   ├── simulation-client.ts
│   ├── build-client.ts
│   └── ai-tools-client.ts
└── workers/
    └── wasm-simulation.worker.ts
```

---

## 5. State Layering

| State | Source | Persisted | Example |
|---|---|---|---|
| Project State | Manifest | Yes | devices, connections, logic |
| Derived State | Computations | No (Reconstructible) | validation results, safety gates |
| Runtime State | Worker / Build Job | No | running, heartbeat, build progress |
| UI State | Interactions | Optional | selected component, collapsed panels |

---

## 6. Manifest-Driven Dataflow

```text
User Action / AI Patch
        │
        ▼
Project Manifest Mutation
        │
        ▼
Schema Validation
        │
        ▼
Connection + Device Model Validation
        │
        ▼
Codegen / Device Tree Generation
        │
        ▼
Static Check
        │
        ▼
Simulation / Build Gate Update
```

---

## 7. Circuit Canvas & Wire Routing (HCTR)

The canvas uses **HCTR (Hierarchical Channel Track Routing)** for orthogonal netlist routing.

### Topology Categories:
- `local`: Manhattan distance < 80px; short L-routes.
- `same-side`: Single vertical track + stubs.
- `cross-side`: U-shaped bypasses across board centers.
- `power-tap` / `power-trunk`: Star topology power rails.

### Routing Features:
- Track allocation with 10px spacing (`TRACK_SPACING = 10px`).
- I2C bundle parallel offsets (`I2C_BUNDLE_GAP = 8px`).
- Board perimeter obstacle avoidance (`routePathAroundObstacle`).
- Manual waypoint insertion and "Tidy Wires" automatic re-routing.

---

## 8. Property Inspector

Renders dynamic forms via `@yo-cloud/yo-ux-vue` `<SchemaForm>` based on peripheral definitions. Modifications trigger connection validation, codegen hash invalidation, and simulation resets.

---

## 9. Simulation Client Architecture

```text
Simulation Panel
        │ Commands / Events
        ▼
Simulation Client
        │ postMessage
        ▼
Wasm Simulation Worker
        ├── Wasm Runtime
        ├── JS Bridge
        ├── Virtual Peripheral Registry
        ├── Fault Injector
        └── Trace Buffer
```

### 9.1 4 Observation Data Planes

| Layer | Data Content | Consumers |
|---|---|---|
| ① Pin Mirror | `pinStates` (Electrical Truth) | Circuit View, PinArbiter, Fault Visualization |
| ② Display Payload | `oledFb` Framebuffers | Virtual Display Panels |
| ③ Actuator Observation | `actuatorObservations` (Kinematic Quantities) | Actuator Panels, 3D Product World (SSOT) |
| ④ Ideal Inject | Pushbutton / Ultrasonic Ideal Stimuli | Input Stimuli (Excluded from observation) |

---

## 10. Trace Console

Supports filtering by event type and component ID, state transition inspection, fault highlighting, JSON exporting, AI explanation actions, and golden trace comparisons.

---

## 11. Build & Flash Wizard

Flashing button enabled only when:
1. `safety.level >= S2`
2. Static checks pass
3. Simulation passes nominal and required fault runs
4. Build job succeeds with matching SHA256 checksums
5. WebSerial browser capability is available

---

## 12. AI Assistant Integration Points

- **Project Initialization**: Template generation via AI prompt.
- **Wiring Diagnostics**: "Let AI Recommend Connections" inline action.
- **Static Check Errors**: "AI Quick-Fix" on error diagnostics.
- **Simulation Faults**: Trace Console "Explain Fault" action.
- **Compilation / Flash Errors**: Build Log error explanations.

---

## 13. Main Project Integration

Lazy-loaded via `/embedded` route in main router. Communicates with host contexts via props, events, and API client abstractions without depending directly on main project internal stores.

---

## 14. Phased MVP Scope

- **MVP-0**: 3-column layout skeleton, ESP32 + LED + Button, connection validation, Wasm Worker baseline, basic Trace Console.
- **MVP-1**: HC-SR04 + Servo, Fault Injection panel, DSL state machine editing, remote Build Job submission.
- **MVP-2**: WebSerial flashing, hardware trace capture, trace diff comparison, main project route integration.

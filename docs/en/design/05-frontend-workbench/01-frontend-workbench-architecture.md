# 15. Embedded Frontend Workbench Architecture & Experience Design

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/01-frontend-workbench-architecture.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

This document defines the frontend architecture, page layouts, state models, module boundaries, and integration mechanisms for the Wink-AI Embedded Frontend Workbench. The goal is to allow embedded capabilities to run standalone while seamlessly integrating into the main project as a professional workbench module.

---

## 1. Design Goals

1. **Professional Workbench Experience**: Users can complete topology design, logic editing, simulation, fault injection, tracing, compilation, and flashing within a unified interface.
2. **Clear State Gating**: Static checking, simulation, fault testing, compilation, and flashing progress through S0-S4 safety levels.
3. **Pluggable Integration**: Runs standalone during development without depending on the main project; integrates as a lazy-loaded route in the main project frontend.
4. **Runtime Isolation**: Decouples Wasm Workers, trace buffers, and simulation bridges from UI rendering state.
5. **Testability**: Core state machines, manifest validation, wire connectivity validation, and trace diffing can be unit-tested in isolation from UI components.

---

## 2. Page Information Architecture

Adopts a 3-column + bottom console layout standard in professional IDEs:

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

> **Evolution Note (2026-07-09)**: The center workspace evolves from mutually exclusive "Circuit Canvas / Simulation View Tabs" into a **Dual-Viewport Split Screen** (2D Circuit + 3D Product World), introducing `design`, `simulate`, and `diagnose` workbench modes to govern split ratios and editing permissions. Full specification in **[02-dual-viewport-product-world-layout.md](./02-dual-viewport-product-world-layout.md)**.

Core Principles:

1. The canvas and simulation are central.
2. Properties, diagnostics, and builds form the right-hand context panels.
3. Trace and logs stay at the bottom, avoiding canvas interaction interruptions.
4. AI assistant can be accessed from the left panel or triggered as inline actions from diagnostics.
5. **Circuit topology and the 3D product world should be linked on-screen during simulation runtime** (see 02 document §3, §5).

---

## 3. Page Modes

| Mode | Primary Purpose | Center Workspace |
|---|---|---|
| `design` | Component drag-and-drop, wiring, property configuration | Circuit Canvas |
| `logic` | State machine / Blockly / DSL editing | Logic Editor |
| `simulate` | Running Wasm, observing virtual peripherals | Simulation View |
| `diagnose` | Inspecting errors, traces, faults | Trace + Diagnostics |
| `build` | Compilation, manifest inspection, flashing | Build & Flash Wizard |

Modes can be toggled via top tabs or left navigation, keeping the underlying Project Manifest unchanged.

**Workbench Mode**: `design` / `simulate` / `diagnose` in the table above are elevated to primary top-bar control dimensions; under `simulate` mode, the center workspace adopts a **Circuit View + Product World split screen** by default (replacing the single Simulation View Tab). `logic` and `build` remain accessible as overlaid views or wizards without replacing workbench modes. Details in [02-dual-viewport-product-world-layout.md](./02-dual-viewport-product-world-layout.md) §4.

---

## 4. Frontend Module Boundaries

> **Source Code Note**: Frontend workbench source code has migrated from the isolated embedded repository to a standalone package in the Wink-AI main monorepo: [`wink-ai/packages/embedded-frontend/`](../../../../wink-ai/packages/embedded-frontend/) (details in [embedded-frontend/MOVED.md](../../../embedded-frontend/MOVED.md)).

```text
wink-ai/packages/embedded-frontend/src/
├── views/
│   └── EmbeddedWorkbench.vue       # Main Dual-Viewport Workbench View
├── components/
│   ├── canvas/                     # 2D Circuit Canvas (HCTR Wire Routing)
│   ├── product-world/              # 3D Product World Physics/Mechanical Viewport (Three.js/WebGL)
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
│   ├── manifest-migration.ts       # Manifest v1 -> v2 Migration
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
| Derived State | Computations | No (Reconstructible) | validation, safety gate |
| Runtime State | Worker / Build Job | No | running, heartbeat, build progress |
| UI State | Page Interactions | Optional | selected component, panel collapsed |

Worker runtime state must not be written back to Manifest unless explicitly emitted as trace, build manifest, or safety verification results.

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

All UI operations should ultimately translate into Manifest patches, facilitating undo, redo, collaboration, and AI automated repairs.

---

## 7. Canvas Design

Canvas Objects:

1. Board Node
2. Peripheral Node
3. Wire Edge
4. Bus Group
5. Virtual Input Control
6. Warning Marker

The canvas must execute real-time validation:

| Validation | Visual Presentation |
|---|---|
| Pin type mismatch | Blocks wire connection, displays red warning |
| Dangerous voltage domain | Yellow/red alert, suggests automatic level shifter |
| I2C address conflict | Highlights bus, blocks deployment |
| Strapping / boot pin occupied | Warns and suggests alternative pins |
| Resource exhaustion | Listed in right-hand diagnostics panel |

### 7.1 Wire Routing (HCTR)

The workbench adopts **HCTR (Hierarchical Channel Track Routing)** by default to generate orthogonal wiring, replacing legacy A* channel fallbacks. Implemented under `../../../../wink-ai/packages/embedded-frontend/src/routing/`, with public APIs re-exported via `peripheral-pins.ts`.

**Topology Categories** (`WireTopology`):

| Topology | Condition | Path Template |
|---|---|---|
| `local` | Manhattan distance < 80px and pin orientation visible | Short L-route |
| `same-side` | Start and end pins on the same side of board center | Single vertical track + stub |
| `cross-side` | Start and end pins on opposite sides of board center | U-shaped bypass (Vertical $\rightarrow$ Horizontal $\rightarrow$ Vertical) |
| `power-tap` / `power-trunk` | Power star topology | Dedicated power rails, bypasses HCTR templates |

**Track Allocation** (`buildTrackAssignments`):

1. Sorts by `priority` (power < i2c < digital), `channel` (left / cross / right), and average Y.
2. Allocates incrementing lanes within channels for `verticalTrackX` / `horizontalTrackY`, with spacing `TRACK_SPACING = 10px`.
3. Parallel offset for I2C bundles (`bundleId`) set to `I2C_BUNDLE_GAP = 8px`.
4. Boundary: `start.x === boardCenterX` grouped into left bucket (`<= centerX`).

**Segment Occupancy & Conflict Resolution** (`SegmentOccupancyRegistry` + `conflict-resolver`):

- Routed segments register in the occupancy table; overlapping segments trigger track bumping (up to `MAX_BUMP_COUNT = 5`), falling back to legacy routing upon failure.
- Pin coordinates do not snap; track coordinates snap to a 4px grid (`snapTrackCoord`).

**Perimeter Obstacle Avoidance** (`resolveBoardPinEndDir` + `resolvePeripheralPinStartDir` + `routePathAroundObstacle`):

- Development board pin `endDir` takes the final pad entry direction, with stub anchor `p2` automatically landing outside the board body.
- Peripheral pin `startDir` is computed geometrically from the nearest bounding box edge, with stub anchor `p1` automatically landing outside the component body (replacing legacy heuristics).
- **Bottom Pin Headers** (e.g., Ultrasonic): If vertical bus X falls within module width, routing detours along the **left/right outer edge** down to pin height before connecting (`buildBottomPinSideApproachPath`), forbidding vertical paths through the module body.
- **Same-Side Bypass**: Side selection is governed by wire source direction (`resolveBypassEdgeX`: vertical bus or power node in left half $\rightarrow$ route via left edge, and vice versa), ensuring multi-pin lines (VCC/GND/TRIG/ECHO) share the same outer edge without branching across sides.
- If routed templates still intersect board or body obstacles, insertion points detour along the nearest perimeter edge (allowing only short pad entry/exit stubs).

**Manual Routing Mode**:

- Clicking a wire inserts a waypoint, transitioning to manual mode: routes connect directly via `forcedPoints` / `waypoints` without template evaluation.
- "Tidy Wires" button clears waypoints and restores automatic HCTR routing.

**Drag Behavior**:

- `mousemove`: Freezes `trackAssignments`, updating only dragged component pin coordinates incrementally to avoid canvas flickering.
- `mouseup`: Unfreezes and fully reallocates routing tracks.

**Fallback & Debugging**:

| Switch | Effect |
|---|---|
| `VITE_LEGACY_WIRE_ROUTING=true` | Falls back to `wire-routing-legacy.ts` |
| `?legacy_routing=true` | Instant URL runtime fallback without restart |
| `?routing_debug=true` | Overlays track dashed lines, occupied segments, and topology labels (dev diagnostics) |

---

## 8. Property Inspector

The Property Inspector is rendered from Device Model `properties` schemas:

```text
selected component
  ↓
load peripheral model
  ↓
render SchemaForm
  ↓
validate property constraints
  ↓
patch manifest.devices[].properties
```

Property changes trigger:

1. Connection validation
2. Codegen hash invalidation
3. Simulation reset prompt
4. Safety level downgrade if needed

---

## 9. Simulation Client Architecture

```text
Simulation Panel
        │ commands/events
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

Worker Commands:

```typescript
type SimulationCommand =
  | { type: 'loadProject'; manifest: EmbeddedProjectManifest; registryLockHash: string }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'injectFault'; scenarioId: string }
  | { type: 'setVirtualInput'; componentId: string; name: string; value: unknown }
  | { type: 'exportTrace' }
```

Worker Events:

```typescript
type SimulationEvent =
  | { type: 'heartbeat'; timestampMs: number; loopCount: number; memoryBytes: number }
  | { type: 'stateChanged'; state: 'ready' | 'running' | 'paused' | 'faulted' | 'terminated' }
  | { type: 'traceEvent'; event: TraceEvent }
  | { type: 'diagnostic'; diagnostic: Diagnostic }
  | { type: 'virtualPeripheralUpdate'; componentId: string; patch: unknown }
```

### 9.1 Simulation Data Plane Layering

Simulation Client and Wasm Simulation Worker **share the underlying `STATE_UPDATE` channel**, but frontend consumption contracts are semantically layered rather than placing all payloads into a single monolithic structure (details in [ADR-0027](../../decisions/unisim/0027-sim-observation-data-planes.md)):

| Layer | Content | Consumer |
|---|---|---|
| ① Pin Mirror | `pinStates` (Pin-level electrical ground truth) | Circuit viewport, PinArbiter, fault visualization |
| ② Display Payload | `oledFb` and display framebuffers | Display peripheral panels |
| ③ Actuator Observation | `actuatorObservations` (Semantic physical quantities) | Actuator panel / Future ActuatorMirror (SSOT) |
| ④ Ideal Inject | Button/ultrasonic ideal input injection | Input excitation, excluded from observation |

Accounting Convention: **3 output observations (①②③) + 1 input injection (④) = 4 data planes**; "Unified" signifies consumption discipline and evolutionary convergence onto ③, not deleting channels or merging ④ into observation. Phase W3b ([03-dual-viewport-phased-design/04-phase-w3b-physics-actuators.md](03-dual-viewport-phased-design/04-phase-w3b-physics-actuators.md)) lands ③ as actuator SSOT, and Phase W3c ([03-dual-viewport-phased-design/05-phase-w3c-sensors-env-bridge.md](03-dual-viewport-phased-design/05-phase-w3c-sensors-env-bridge.md)) evolves ④; phased implementation details see [roadmap](../../implementation-plans/unisim/00-roadmap.md).

---

## 10. Trace Console

The Trace Console supports:

1. Filtering by event type.
2. Filtering by `componentId`.
3. Visualizing state transition chains.
4. Highlighting critical events before and after faults.
5. Exporting JSON traces.
6. One-click submission for AI diagnostic analysis.
7. Comparing against Golden Traces.

The Trace UI filters out low-level noise events by default, presenting semantic milestones.

---

## 11. Build & Flash Wizard

Wizard Steps:

```text
1. Check Safety Gate
2. Select Target
3. Review Manifest / Hash
4. Submit Build Job
5. Show Build Log
6. Review Firmware Manifest
7. Flash or Download
8. Optional Hardware Trace
```

Flash Button Enable Criteria:

1. `safety.level >= S2`
2. Static check passed
3. Simulation normal run passed
4. Required fault tests passed
5. Build successful
6. Artifact SHA-256 verified
7. Browser WebSerial capability available

---

## 12. AI Assistant Interaction Touchpoints

| Scenario | Entry Point |
|---|---|
| New Project | AI Project Generator on Templates page |
| Wiring Error | Diagnostics card "Ask AI to Recommend Wiring" |
| Static Check Failure | Error line "AI Fix" |
| Simulation Fault | Trace Console "Explain Fault" |
| Compilation Failure | Build Log "Explain and Fix" |
| Flashing Failure | Flash Wizard "Guide Entering Bootloader" |

AI patches must enter preview mode first, and must not automatically mutate code or flash devices without user confirmation.

---

## 13. Main Project Integration Approach

When integrating into the main project frontend:

1. Main project `router` adds an `/embedded` lazy-loaded route.
2. Main project sidebar registers "Embedded Workbench" via dynamic navigation.
3. `embedded-frontend` receives host context:

```typescript
interface EmbeddedHostContext {
  userId?: string
  workspaceId?: string
  projectId?: string
  theme: 'light' | 'dark'
  apiBaseUrl: string
  aiEnabled: boolean
  desktopRuntime?: boolean
}
```

4. Embedded modules must not directly depend on internal stores of the main project frontend.
5. Cross-module communication is conducted via props, events, API clients, and shared types.

---

## 14. MVP Frontend Scope

MVP-0:

1. 3-column workbench skeleton.
2. ESP32 Board + LED + Button.
3. Wire connection validation.
4. Manifest save/load.
5. Generated `device_tree.h` and App templates.
6. Wasm Worker mock or minimal execution.
7. Basic Trace Console events.

MVP-1:

1. HC-SR04 + Servo.
2. Fault injection panel.
3. DSL state machine editing.
4. Build Job submission.
5. Firmware Manifest visualization.

MVP-2:

1. WebSerial flashing.
2. Hardware trace capture.
3. Trace comparison.
4. Main project router integration.

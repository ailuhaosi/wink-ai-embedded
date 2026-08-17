# W1 Layout Skeleton — Dual-Viewport Split-Pane & Mode State Machine

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/03-dual-viewport-phased-design/01-phase-w1-layout-skeleton.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Phase | W1 |
| Effort Estimate | ~2–2.5 days (With buffer; core P0 ~2 days) |
| Prerequisites | HCTR wire routing stability (Phase C Canvas) ✅ |
| Deliverables | SplitPane, `CircuitCanvas.vue` extraction, `workbench-mode` store, `layout` store, Right/Bottom Tab shells, Onboarding Wizard |
| Milestone | M0 + S4: Complete Onboarding $\rightarrow$ wire in design $\rightarrow$ split view in simulate $\rightarrow$ Play without crashing |
| Master Plan Ref | [00-master-plan.md](./00-master-plan.md) §4.6 simulate gate, §5.4 bottom console, §6.4 test strategy |

---

## 0. Conventions

- **State Management**: Introduces **Pinia** (`pinia` + `pinia-plugin-persistedstate`), see Master Plan §11. Task 1.0 installs dependencies first.
- **Manifest Fields**: Uses standard schema identifiers: `componentId` / `name` / `valueC`, see Master Plan §10.
- **Undo/Redo**: **Not implemented** in this phase; `Ctrl+Z` shortcut reserved, see Master Plan §12.
- **simulate Gate**: W1 evaluates **static checks only**; binding validation connects in W2, see Master Plan §4.6.
- **i18n**: UI strings use translation keys (`t('workbench.*')`); MVP uses `zh-CN` resource files only.

---

## 1. Goals

1. Upgrade center workspace from `activeTab = 'canvas' | 'sim'` mutually exclusive tabs to a **draggable split-pane dual viewport**.
2. Introduce `design` / `simulate` / `diagnose` **Workbench Modes** controlling layout ratios and editing permissions.
3. Safely extract `CircuitCanvas.vue` from monolithic `EmbeddedWorkbench.vue` (Strangler Fig Step 1).
4. Establish core Pinia Stores infrastructure (replacing raw `ref()` exports).
5. Split right-panel Inspector into **contextual Tab shells**.
6. Create empty shells for `project.store` / `inspector.store` (populated with Manifest v2 in W2).
7. Establish bottom console shell with mode linkages (default Tab / heights; Causal content in W5).
8. Provide first-time user Onboarding Wizard (Scenarios S4 / M0).

---

## 2. SplitPane Component

### 2.1 Component API

```typescript
// components/layout/SplitPane.vue
interface SplitPaneProps {
  direction: 'horizontal' | 'vertical';  // default: horizontal
  defaultRatio: number;                   // 0-1, left/top ratio
  minSizePx: number;                      // Minimum pixel threshold per side, default: 280
  storageKey?: string;                    // localStorage persistence key
}

interface SplitPaneEmits {
  (e: 'ratioChange', ratio: number): void;
  (e: 'collapse', side: 'left' | 'right'): void;
}
```

### 2.2 Split Handle Interaction Standards

| Property | Specification |
|---|---|
| **Width** | 6px (expands to 10px on hover) |
| **Default Color** | `rgba(148, 163, 184, 0.2)` (slate-400/20%) |
| **Hover Color** | Primary theme blue `#3B82F6` (50% opacity) |
| **Active Dragging** | Primary theme blue `#3B82F6` (100%) + full-viewport overlay preventing mouse capture loss |
| **Cursor** | `col-resize` (horizontal) / `row-resize` (vertical) |
| **Snapping** | Snaps to collapse when dragged below minimum width (shows expand arrow) |
| **Double-Click** | Maximizes focused viewport to full screen (double-click again restores split) |
| **Tooltip** | Displays current ratio percentage while dragging, e.g., `60 : 40` |
| **Animation** | Ratio changes driven by mode switching use `300ms ease-out` transitions |

### 2.3 Split Orientation Toggling

- Shortcut `Ctrl+\` toggles horizontal/vertical split orientation.
- State persists to `layout.store` + `localStorage`.
- Vertical split suits 21:9 ultra-wide monitor setups.

### 2.4 Split Ratios by Workbench Mode

> Ratio semantics see Master Plan §2.1.1. `splitRatio` = Circuit width ratio within center workspace (0–1).

| Mode | Center Split (Circuit : World, `splitRatio`) | Center Height | Console Height | Description |
|---|---|---|---|---|
| `design` (Wiring priority) | 70 : 30 (`0.7`) | 75% | 25% | 3D provides assembly preview |
| `design` (Structure priority)| 30 : 70 (`0.3`) | 75% | 25% | See §2.5 |
| `simulate` | 40 : 60 (`0.4`) | 70% | 30% | Product motion focus |
| `diagnose` | **50 : 50 (`0.5`)** | **50%** | **50%** | Console causal chain takes primary focus |

Ratio transitions during mode changes animate with `300ms ease-out`. Once a user manually drags the split handle, automatic mode ratio changes are suppressed until layout reset.

### 2.5 `designSubMode` Switching Rules

| Trigger | Behavior |
|---|---|
| Default | `circuit-first`, `splitRatio = 0.7` |
| User selects "Structure Priority" in design toolbar | `structure-first`, `splitRatio = 0.3` |
| Adding mechanical part to 3D placeholder/viewport first time | Auto-switches to `structure-first` + 3D width $\ge 40\%$ |
| User manually drags split handle | Suppresses automatic subMode switching |

Top bar design toolbar control: `[Wiring Priority | Structure Priority]` SegmentedControl, peer to Wire/Grid controls.

---

## 3. Mode State Machine

### 3.1 Store Definition

```typescript
// stores/workbench-mode.store.ts
import { defineStore } from 'pinia';

type WorkbenchMode = 'design' | 'simulate' | 'diagnose';

interface ModeState {
  current: WorkbenchMode;
  previous: WorkbenchMode | null;
  designSubMode: 'circuit-first' | 'structure-first';
  userOverriddenRatio: boolean;  // true after manual user drag
}

export const useWorkbenchModeStore = defineStore('workbench-mode', {
  state: (): ModeState => ({
    current: 'design',
    previous: null,
    designSubMode: 'circuit-first',
    userOverriddenRatio: false,
  }),
  
  actions: {
    async switchTo(target: WorkbenchMode): Promise<boolean> {
      // Gate checks (W1: static check only; W2 adds bindings, see Master Plan §4.6)
      if (target === 'simulate' && this.current === 'design') {
        const ok = await staticCheckService.run();
        if (!ok) return false;
        // W2+: await canEnterSimulate() — see 02-phase-w2 §3.3 (static-check -> validateBindings)
      }
      if (target === 'design' && this.current === 'simulate') {
        const confirmed = await this.confirmStopSimulation();
        if (!confirmed) return false;
      }
      this.previous = this.current;
      this.current = target;
      return true;
    },
    
    resetToDesign() {
      this.previous = this.current;
      this.current = 'design';
      // Clears Runtime State without mutating Manifest
    }
  },
  
  getters: {
    canEditCircuit: (state) => state.current === 'design',
    canEditMechanical: (state) => state.current === 'design',
    canEditEnvironment: (state) => state.current !== 'diagnose', // Environment adjustable during simulation
    canEditFaults: (state) => state.current !== 'design',
    showTransportControls: (state) => state.current !== 'design',
  }
});
```

### 3.2 State Transition Gates

| Transition | Gate Condition (W1) | Gate Condition (W2+) | Failure Action |
|---|---|---|---|
| design $\rightarrow$ simulate | ① Static checks pass | ① + ② Bindings contain no blocking errors | Bottom console Static Check / Diagnostics expands with error list |
| simulate $\rightarrow$ design | User confirms stopping simulation (Modal) | Same as left | — |
| simulate $\rightarrow$ diagnose | Fault triggered (automatic) or user manual | Same as left | Auto-pauses simulation |
| diagnose $\rightarrow$ simulate | User clicks Resume | Same as left | Retains causal chain history |
| any $\rightarrow$ design | Reset button | Same as left | Clears Runtime State |

**`static-check.service.ts`** (W1 reuses existing logic):

- Path: `../../../../../wink-ai/packages/embedded-frontend/src/services/static-check.service.ts`
- Entry point: `staticCheckService.run(): Promise<boolean>`
- On failure: Returns `false`, `workbench-mode.store` aborts transition; `layout.store` expands bottom console and activates `Static Check` tab.
- Relationship with bindings: **W1 does not invoke** `binding-validation.service` (created in W2).

**Stop Simulation Confirmation Modal** (`simulate $\rightarrow$ design`):

- Title: "Stop Simulation?"
- Body: "Returning to design mode will terminate the active simulation and reset runtime state."
- Buttons: `Cancel` (Primary) / `Stop & Return` (Danger color).

### 3.3 Mode Switching Animation

```css
/* Mode toolbar transition during mode switching */
.mode-toolbar-enter-active,
.mode-toolbar-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}
.mode-toolbar-enter-from { opacity: 0; transform: translateY(-8px); }
.mode-toolbar-leave-to   { opacity: 0; transform: translateY(8px); }
```

---

## 4. Two-Row TopBar Architecture

### 4.1 Layout Structure

```text
┌─────────────────────────────────────────────────────────────────┐
│ Row 1 (Global Context):                                         │
│   [Logo] Wink-AI   ProjectName ▾   Target: ESP32-S3 ▾           │
│                          Safety: S2 ▾   [Causal OK ✅]          │
├─────────────────────────────────────────────────────────────────┤
│ Row 2 (Mode Toolbar — Contents switch per mode):                │
│   [design]  [simulate] [diagnose]  │  <<Mode Action Controls>> │
│                                     │                           │
│   design:   Wire:Auto/Manual │ Tidy │ Grid:On/Off               │
│   simulate: ▶ Pause │ ⏹ Stop │ Step │ Speed:1x ▾ │ Time:12ms   │
│   diagnose: ▶Resume │ ⏹ Stop │ [Fault:bounce] │ Time:12ms     │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Responsive Overflow

When window width < 1440px:
- Row 1 Safety Level badge and consistency label collapse into `⋯` overflow menu.
- Row 2 secondary actions (Grid, Tidy) collapse into `⋯` menu.

### 4.3 Mode Switcher Visual Design

```text
┌──────────┬──────────┬──────────┐
│  Design  │ Simulate │ Diagnose │
│  ✏️ Edit  │  ▶️ Sim   │  🔍 Diag │
└──────────┴──────────┴──────────┘
```

- Active mode: Solid background + white text.
- Inactive mode: Transparent background + muted text.
- Hover: Semi-transparent background highlight.
- Switch animation: Underline slider (200ms ease).

---

## 5. CircuitCanvas Extraction

### 5.1 Extraction Scope

Extracts the following sections from `EmbeddedWorkbench.vue` into `components/circuit/CircuitCanvas.vue`:

| Code Section | Approximate Lines | Target Location |
|---|---|---|
| SVG `<circuit-svg>` template | ~300 lines | `CircuitCanvas.vue` template |
| Board / Pin rendering logic | ~200 lines | `CircuitCanvas.vue` template |
| HCTR routing visualization | ~150 lines | `CircuitCanvas.vue` template |
| Wire / Peripheral SVG | ~250 lines | `CircuitCanvas.vue` template |
| Canvas event handling (click/drag) | ~200 lines | `CircuitCanvas.vue` script |
| Route computation / waypoints | ~100 lines | `CircuitCanvas.vue` script or composable |

**Zero Logic Change Principle**: Extraction is a pure refactor without altering rendering or interaction behaviors.

### 5.2 Props / Emits Contract & Routing Types (Gap 6)

> **W1 Scope**: **TypeScript type predefinitions** + Props contract only; persisting `ConnectionRouting` to Manifest occurs in **W2**. W1 extraction does not modify HCTR runtime execution.

Supplements routing-related TypeScript types to support HCTR orthogonal routing persistence and canvas parsing (aligning with `sim_specs_deep_assessment.md` Gap 6):

```typescript
export type WireRouteMode = 'orthogonal' | 'custom';

/** 2D Grid Coordinate Point */
export interface CircuitPoint {
  x: number;
  y: number;
}

/** Orthogonal routing command parsing types (e.g. v15 = vertical 15px, h-30 = horizontal -30px, * = auto-converge) */
export type OrthogonalCommand = `v${number}` | `h${number}` | '*';

/** Wire connection routing payload */
export interface ConnectionRouting {
  mode: WireRouteMode;
  /** Valid only in orthogonal mode */
  path?: OrthogonalCommand[];
  /** Valid only in custom mode, recording absolute waypoints */
  points?: CircuitPoint[];
}

// components/circuit/CircuitCanvas.vue
interface CircuitCanvasProps {
  readonly: boolean;                  // true in simulate/diagnose modes
  showRoutingDebug: boolean;          // ?routing_debug=true
  highlightedComponentIds: string[];  // Selection linking
  connections: Array<{
    id: string;
    from: string;
    to: string;
    routing: ConnectionRouting;       // Orthogonal routing data
  }>;
}

interface CircuitCanvasEmits {
  (e: 'componentSelect', id: string): void;
  (e: 'componentAdd', type: string, position: CircuitPoint): void;
  (e: 'connectionCreate', from: PinRef, to: PinRef, routing: ConnectionRouting): void;
  (e: 'canvasClick', position: CircuitPoint): void;
}
```

### 5.3 Regression Guards

1. **HCTR Snapshot Tests**: Output SVG paths from existing routing have snapshot baselines.
2. **Feature Flag**: `VITE_LEGACY_SIM_TAB=true` restores legacy tab behavior.
3. **Visual Regression**: Screenshot diffing across extractions (via Playwright screenshot comparisons).

---

## 6. Context Inspector Tab Shells

### 6.1 Tab Structure

```vue
<!-- components/inspector/ContextInspector.vue -->
<template>
  <div class="inspector-panel">
    <div class="inspector-tabs">
      <TabButton 
        v-for="tab in visibleTabs" 
        :key="tab.id"
        :active="activeTab === tab.id"
        :pinned="tab.pinned"
        @click="activateTab(tab.id)"
      >
        {{ tab.label }}
      </TabButton>
    </div>
    <div class="inspector-content">
      <CircuitInspector    v-if="activeTab === 'circuit'" />
      <MechanicalInspector v-if="activeTab === 'mechanical'" />
      <BindingsInspector   v-if="activeTab === 'bindings'" />
      <EnvironmentInspector v-if="activeTab === 'environment'" />
      <FaultsInspector     v-if="activeTab === 'faults'" />
      <DiagnosticsInspector v-if="activeTab === 'diagnostics'" />
    </div>
  </div>
</template>
```

### 6.2 Auto-Focus Rules

| Selected Object Type | Auto-Activated Tab | Exception |
|---|---|---|
| Circuit Peripheral / Board Pin | `circuit` | Preserved when user pinned another Tab |
| 3D Mechanical Part | `mechanical` | — |
| 3D Environment Prop | `environment` | — |
| Bindable Object (with binding) | `bindings` | — |
| No Selection | Previous active Tab | — |

### 6.3 Pinning Mechanism

- Each Tab header features a 📌 icon.
- When pinned, that Tab **will not be overridden by auto-focus** (users can still switch tabs manually).
- W1 permits pinning **only one Tab** at a time (multi-pin deferred to Master Plan §12 Phase 2).
- Clicking Pin on another Tab replaces the active pin.

### 6.3.1 Right Panel Icon Mode (`< 1440px`)

| Behavior | Specification |
|---|---|
| Display | Shows Tab icons only (Circuit=⚡, Mechanical=🔧, ...) |
| Tooltip | Hover displays full Tab title |
| Click | Panel expands as an overlay (320px width), without compressing center workspace |
| Dismiss | Click outside overlay or press `Escape` |

### 6.4 W1 Tab Content

Tabs in W1 are created as **placeholder shells**:

| Tab | W1 Content |
|---|---|
| `Circuit` | Migrated existing Property Inspector code |
| `Mechanical` | "Implemented in Phase W3a" placeholder text |
| `Bindings` | "Implemented in Phase W2" placeholder text |
| `Environment` | "Implemented in Phase W4" placeholder text |
| `Faults` | Migrated existing Fault Injector code |
| `Diagnostics` | "Implemented in Phase W5" placeholder text |

---

## 7. ProductWorld Placeholder

### 7.1 Empty State Design

```vue
<!-- components/world/ProductWorldPlaceholder.vue -->
<template>
  <div class="world-placeholder">
    <div class="placeholder-card">
      <img src="@/assets/3d-preview-illustration.svg" alt="" />
      <h3>3D Product World</h3>
      <p>Drag in chassis parts to start building your product</p>
      <div class="quick-actions">
        <button @click="loadTemplate('tpl_avoidance_car')">
          🚗 Obstacle Car Template
        </button>
        <button @click="loadTemplate('tpl_temp_alarm')">
          🌡️ Thermal Alarm Template
        </button>
      </div>
      <p class="hint">Or use templates above for a quick start (drag from Mechanical library starting in W2)</p>
    </div>
  </div>
</template>
```

### 7.2 Placeholder Replacement Conditions

Replaced by `ProductWorld3D.vue` when `VITE_ENABLE_PRODUCT_WORLD=true` and `mechanical.parts.length > 0`.

---

## 8. Layout Store

```typescript
// stores/layout.store.ts
import { defineStore } from 'pinia';

interface LayoutState {
  splitDirection: 'horizontal' | 'vertical';
  splitRatio: number;         // 0-1, Circuit width ratio in center workspace
  leftPanelCollapsed: boolean;
  leftPanelCollapsedBeforeSimulate: boolean;  // Saved state before simulation for restoration
  rightPanelCollapsed: boolean;
  rightPanelMode: 'full' | 'icon';  // icon mode shows tab glyphs only
  bottomPanelHeight: number;  // px
  bottomPanelUserResized: boolean;  // true after manual user drag
  bottomPanelActiveTab: 'trace' | 'causal' | 'logs' | 'build' | 'static-check';
  pipEnabled: boolean;        // Phase 2; field reserved in W1
  pipPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  pipScale: number;           // 0.25–0.5
}

export const useLayoutStore = defineStore('layout', {
  state: (): LayoutState => ({
    splitDirection: 'horizontal',
    splitRatio: 0.7,
    leftPanelCollapsed: false,
    leftPanelCollapsedBeforeSimulate: false,
    rightPanelCollapsed: false,
    rightPanelMode: 'full',
    bottomPanelHeight: 200,
    bottomPanelUserResized: false,
    bottomPanelActiveTab: 'static-check',
    pipEnabled: false,
    pipPosition: 'bottom-right',
    pipScale: 0.3,
  }),
  
  actions: {
    applyModeDefaults(mode: WorkbenchMode) {
      const modeStore = useWorkbenchModeStore();
      // Split ratios (see §2.4 / Master Plan §2.1.1)
      if (!modeStore.userOverriddenRatio) {
        const ratioByMode: Record<WorkbenchMode, number> = {
          design: modeStore.designSubMode === 'structure-first' ? 0.3 : 0.7,
          simulate: 0.4,
          diagnose: 0.5,
        };
        this.splitRatio = ratioByMode[mode];
      }
      // Bottom console height and default Tab (see §9)
      if (!this.bottomPanelUserResized) {
        const heightByMode: Record<WorkbenchMode, number> = {
          design: 0.25,
          simulate: 0.30,
          diagnose: 0.50,
        };
        const vh = window.innerHeight * heightByMode[mode];
        this.bottomPanelHeight = Math.round(vh);
      }
      const tabByMode: Record<WorkbenchMode, LayoutState['bottomPanelActiveTab']> = {
        design: 'static-check',
        simulate: 'trace',
        diagnose: 'causal',
      };
      this.bottomPanelActiveTab = tabByMode[mode];
      // simulate: Remember and collapse left panel
      if (mode === 'simulate') {
        this.leftPanelCollapsedBeforeSimulate = this.leftPanelCollapsed;
        this.leftPanelCollapsed = true;
      }
      // Return to design: Restore left panel state
      if (mode === 'design' && this.leftPanelCollapsedBeforeSimulate !== undefined) {
        this.leftPanelCollapsed = this.leftPanelCollapsedBeforeSimulate;
      }
    },
    
    resetLayout() {
      this.$reset();
      useWorkbenchModeStore().userOverriddenRatio = false;
      this.bottomPanelUserResized = false;
    }
  },
  
  persist: { key: 'wink-layout' }  // pinia-plugin-persistedstate
});
```

---

## 9. Bottom Console Shell

> Aligned with Master Plan §5.4. W1 migrates existing Trace / Logs / Build / Static Check; `Causal Chain` Tab displays W5 placeholder.

### 9.1 Tab and Mode Defaults

| Tab | W1 Content | Default Active Mode |
|---|---|---|
| `Trace` | Migrated existing Trace panel | `simulate` |
| `Causal Chain` | "Implemented in Phase W5" placeholder | `diagnose` |
| `Logs` | Migrated existing Logs | — |
| `Build` | Migrated existing Build output | — |
| `Static Check` | Migrated existing static checks list | `design`; auto-expands on check failures |

### 9.2 Linkage Rules

- Successful `workbench-mode.store.switchTo()` invokes `layout.store.applyModeDefaults(mode)`.
- First-time `design $\rightarrow$ simulate`: Console expands + activates `Trace` (Master Plan §5.2 progressive disclosure).
- Static check failure: Aborts mode transition, expands bottom console with `Static Check` active.
- User drag resizing bottom height $\rightarrow$ `bottomPanelUserResized = true`, suppressing automatic height changes on subsequent mode switches.

### 9.3 Component Boundaries

```text
components/console/BottomConsole.vue   # Shell + Drag Height Handle
components/console/TracePanel.vue      # Extracted from Workbench
components/console/StaticCheckPanel.vue
components/console/CausalChainPlaceholder.vue  # Replaced in W5
```

---

## 10. Onboarding Wizard

> Scenario **S4** / Milestone **M0** deliverable. Details in Master Plan §5.1.

### 10.1 Components

```text
components/onboarding/OnboardingWizard.vue   # 3-step spotlight tour
composables/useOnboarding.ts                 # localStorage read/write
```

### 10.2 Steps and Acceptance Criteria

| Step | Action | Acceptance Criterion |
|---|---|---|
| 1 | Highlights dual viewport + explanatory copy | User clicks "Next" |
| 2 | Expands left panel Templates, highlights Obstacle Car | User clicks template or "Skip" |
| 3 | Pulse-highlights Play button; permits Play during placeholder state | User clicks Play without runtime crashes |

- `localStorage` key: `wink_onboarding_completed`.
- Settings panel provides "Replay Onboarding Tour".
- Completed users will not see automatic popups.

---

## 11. Implementation Task List

#### Task 1.0: Pinia Scaffolding & Core Stores

| Field | Content |
|---|---|
| Effort Estimate | 3h |
| Files Modified | `package.json`, `main.ts`, `stores/*.ts` |

- [ ] Install `pinia`, `pinia-plugin-persistedstate`; register in `main.ts`.
- [ ] Implement `workbench-mode`, `layout`, `selection`, `canvas`, `inspector`, `simulation`, and `project` (shell) stores.
- [ ] Wrap `simulation.store` progressively over `simulation-client.ts`: W1 migrates `isRunning` / `simTimeUs` / `lastError`; components access state uniformly through store.
- [ ] Vitest: Mode transition guards (including W1 static-check-only gating).

#### Tasks 1.1–1.5 (P0)

Corresponding to §2–§7, §9: SplitPane, `CircuitCanvas` extraction, Workbench shell, TopBar modes, Inspector Tab shells, BottomConsole shell.

| Task | Description | Priority |
|---|---|---|
| 1.1 | SplitPane + layout store linkage | P0 |
| 1.2 | `workbench-mode` state machine | P0 |
| 1.3 | Workbench shell + dual viewport mounting | P0 |
| 1.4 | Two-row TopBar | P0 |
| 1.5 | ContextInspector + BottomConsole shells | P0 |
| 1.5b | `CircuitCanvas` extraction (~1200 lines) | P1 (Deferred to late W1 / W1.5 if needed) |

#### Task 1.6: Smoke E2E (see §13)

#### Task 1.7: Onboarding Wizard (see §10)

| Field | Content |
|---|---|
| Effort Estimate | 2h |
| Priority | 🟢 P0 (S4 / M0) |
| Prerequisite | Task 1.3 |

- [ ] `OnboardingWizard.vue` + `useOnboarding.ts`
- [ ] 3-step spotlight + template shortcut linkage
- [ ] Acceptance: New user completes Play within 3 steps (3D can be placeholder).

---

## 12. Acceptance Checklist

| # | Acceptance Item | Validation Method |
|---|---|---|
| A1 | SplitPane draggable with minimum 280px constraint | Manual + Component Test |
| A2 | Double-click split handle toggles maximize/restore | Manual |
| A3 | `Ctrl+\` toggles horizontal/vertical split | Manual |
| A4 | Mode switching triggers 300ms animated ratio transitions | Visual |
| A5 | `design $\rightarrow$ simulate` gate (static checks) functions properly | Vitest |
| A6 | Circuit wiring immutable in `simulate` mode | Manual |
| A7 | Top bar hides routing controls in `simulate` mode | Manual |
| A8 | `VITE_LEGACY_SIM_TAB=true` restores legacy tab behavior | Manual |
| A9 | Zero regression in HCTR wiring output after `CircuitCanvas` extraction | Snapshot Tests |
| A10 | Right panel Tab switching and pinning operate smoothly | Manual |
| A11 | 3D placeholder shows onboarding card and template shortcuts | Visual |
| A12 | Right panel collapses to icon mode on windows < 1440px | Manual |
| A13 | Pinia stores registered; `npm run build` succeeds | CI |
| A14 | W1: `design $\rightarrow$ simulate` requires static checks only (no binding blocks) | Vitest |
| A15 | Entering simulate collapses left panel; returning to design restores state | Manual |
| A16 | First-time simulate expands Trace; diagnose expands Causal placeholder | Manual |
| A17 | SplitPane / bottom height persist to localStorage | Manual |
| A18 | 3-step Onboarding writes `wink_onboarding_completed` | Manual + E2E |
| A19 | `diagnose` mode: center 50% height + bottom 50% height + 50:50 center split | Visual |

---

## 13. Task 1.6 — Smoke E2E (Optional, Recommended)

| Field | Content |
|---|---|
| Effort Estimate | 2h |
| Priority | 🟡 P1 |
| Prerequisite | Task 1.3 |

**Steps:**

- [ ] Introduce Playwright test framework.
- [ ] Cover Strangler Fig §S1 minimal user flow: Open page $\rightarrow$ Skip onboarding $\rightarrow$ Add LED $\rightarrow$ Switch to simulate $\rightarrow$ Dual viewports visible $\rightarrow$ Click Play without crashes.
- [ ] CI setup: Optional nightly on `main` branch.

**Validation:** Local `npx playwright test` passes cleanly.

> Expand E2E to cover obstacle avoidance loop before W3c (see Master Plan §12).

---

*Document Revision History:*

- 2026-07-09: Initial creation.
- 2026-07-09: Review revisions—Pinia finalization, project/inspector stores, Task 1.6 E2E, Undo deferral.
- 2026-07-09: Secondary review revisions—§4.6 bindings transition, §9 bottom console, §10 Onboarding, diagnose layout, Task 1.7, Acceptance A14–A19.

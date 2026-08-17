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
| Effort Estimate | ~2–2.5 days (Core P0 ~2 days) |
| Prerequisites | HCTR wire routing stability (Phase C Canvas) ✅ |
| Deliverables | SplitPane, `CircuitCanvas.vue` extraction, `workbench-mode` store, `layout` store, Inspector/Bottom Tab shells, Onboarding Wizard |
| Milestone | M0 + S4: Complete Onboarding $\rightarrow$ wire in design $\rightarrow$ split view in simulate $\rightarrow$ Play without crashing |
| Master Plan Ref | [00-master-plan.md](./00-master-plan.md) §4.6 simulate gate, §5.4 bottom console, §6.4 test strategy |

---

## 0. Conventions

- **State Management**: Introduces **Pinia** (`pinia` + `pinia-plugin-persistedstate`).
- **Manifest Fields**: Uses standard schema identifiers: `componentId` / `name` / `valueC` (Master Plan §10).
- **Simulate Gate in W1**: Evaluates **static checks only**; binding validation connects in W2.
- **i18n**: UI strings use translation keys (`t('workbench.*')`).

---

## 1. Goals

1. Upgrade center workspace from tab-based switching to a **draggable split-pane dual viewport**.
2. Implement **Workbench Modes** (`design` / `simulate` / `diagnose`) controlling layout ratios and permissions.
3. Safely extract `CircuitCanvas.vue` from monolithic `EmbeddedWorkbench.vue` (Strangler Fig Step 1).
4. Establish core Pinia Stores.
5. Create Contextual Inspector and Bottom Console Tab shells.
6. Provide a 3-step Onboarding Wizard for new users.

---

## 2. SplitPane Component

### 2.1 Component API
```typescript
interface SplitPaneProps {
  direction: 'horizontal' | 'vertical'; // default: horizontal
  defaultRatio: number;                  // 0.0 - 1.0 (left/top ratio)
  minSizePx: number;                     // Minimum pixel threshold, default: 280
  storageKey?: string;                   // localStorage persistence key
}

interface SplitPaneEmits {
  (e: 'ratioChange', ratio: number): void;
  (e: 'collapse', side: 'left' | 'right'): void;
}
```

### 2.2 Split Ratios by Mode

| Mode | Center Split (Circuit : World) | Center Height | Console Height | Notes |
|---|---|---|---|---|
| `design` (Wiring priority) | 70 : 30 (`0.7`) | 75% | 25% | 3D provides assembly preview |
| `design` (Structure priority)| 30 : 70 (`0.3`) | 75% | 25% | Mechanical focus |
| `simulate` | 40 : 60 (`0.4`) | 70% | 30% | Product motion focus |
| `diagnose` | **50 : 50 (`0.5`)** | **50%** | **50%** | Causal chain takes focus |

---

## 3. Mode State Machine (`workbench-mode.store.ts`)

```typescript
import { defineStore } from 'pinia';

type WorkbenchMode = 'design' | 'simulate' | 'diagnose';

interface ModeState {
  current: WorkbenchMode;
  previous: WorkbenchMode | null;
  designSubMode: 'circuit-first' | 'structure-first';
  userOverriddenRatio: boolean;
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
      if (target === 'simulate' && this.current === 'design') {
        const ok = await staticCheckService.run();
        if (!ok) return false;
      }
      if (target === 'design' && this.current === 'simulate') {
        const confirmed = await this.confirmStopSimulation();
        if (!confirmed) return false;
      }
      this.previous = this.current;
      this.current = target;
      return true;
    }
  },
  getters: {
    canEditCircuit: (state) => state.current === 'design',
    canEditMechanical: (state) => state.current === 'design',
    canEditEnvironment: (state) => state.current !== 'diagnose',
    canEditFaults: (state) => state.current !== 'design',
    showTransportControls: (state) => state.current !== 'design',
  }
});
```

---

## 4. Two-Row TopBar Architecture

- **Row 1 (Global Context)**: Project Name, Target MCU dropdown, Safety Level badge (S0–S4), Causal Consistency tag.
- **Row 2 (Mode Toolbar)**: Mode selector (`[design | simulate | diagnose]`) + mode-specific action buttons.

---

## 5. CircuitCanvas Extraction & Routing Types (Gap 6)

```typescript
export type WireRouteMode = 'orthogonal' | 'custom';
export type OrthogonalCommand = `v${number}` | `h${number}` | '*';

export interface CircuitPoint {
  x: number;
  y: number;
}

export interface ConnectionRouting {
  mode: WireRouteMode;
  path?: OrthogonalCommand[];
  points?: CircuitPoint[];
}

interface CircuitCanvasProps {
  readonly: boolean;
  showRoutingDebug: boolean;
  highlightedComponentIds: string[];
  connections: Array<{
    id: string;
    from: string;
    to: string;
    routing: ConnectionRouting;
  }>;
}
```

---

## 6. Context Inspector & Bottom Console Shells

- **Inspector Tabs**: `Circuit` (migrated property inspector), `Mechanical` (W3a placeholder), `Bindings` (W2 placeholder), `Environment` (W4 placeholder), `Faults` (migrated fault injector), `Diagnostics` (W5 placeholder).
- **Pinning Mechanism**: Tabs can be pinned with 📌 to prevent automatic tab switching.
- **Bottom Console**: Houses `Trace` (Simulation mode), `Causal Chain` (Diagnose mode placeholder), `Logs`, `Build`, and `Static Check` (Design mode).

---

## 7. Onboarding 3-Step Wizard

1. **Step 1**: Dual-Viewport introduction spotlight.
2. **Step 2**: Templates Accordion expansion pointing to Obstacle Avoidance Car.
3. **Step 3**: Pulse-highlight on the Play button in simulation mode.

---

## 8. Verification Matrix (A1~A19)

- **A1**: Draggable SplitPane preserving 280px minimum widths.
- **A4**: 300ms ease-out animated transitions between workbench modes.
- **A5**: `design -> simulate` gating strictly validated against static checks.
- **A9**: Zero regression in SVG wire routes following `CircuitCanvas.vue` extraction.
- **A18**: Onboarding flow saves `wink_onboarding_completed` in `localStorage`.

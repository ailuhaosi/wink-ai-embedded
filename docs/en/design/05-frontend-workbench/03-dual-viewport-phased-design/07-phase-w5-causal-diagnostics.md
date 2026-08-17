# W5 Causal Chain + Diagnostics Mode — CausalChainConsole & Replay Foundation

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/03-dual-viewport-phased-design/07-phase-w5-causal-diagnostics.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Phase | W5 |
| Effort Estimate | ~1.5 days |
| Prerequisites | W3c Sensor Bridge complete (W4 can run in parallel) |
| Deliverables | CausalChainConsole, Forward/Reverse tracing, Diagnose mode linkage, Replay foundation interfaces |
| Milestone | M6: Full closed-loop obstacle avoidance workflow traceable $\ge 5$ steps forward and backward in causal console |
| Upstream Refs | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §10–§11 |

---

## 1. Goals

1. Implement `CausalChainConsole` bottom console panel, visualizing causal chain timelines.
2. Support bidirectional navigation for **forward narrative** and **reverse root-cause tracing**.
3. Implement diagnose mode linkage: Fault triggers auto-pause $\rightarrow$ causal chain focus $\rightarrow$ dual-viewport height compression.
4. Manage ring buffer strategy (500-step cap) + duplicate event coalescing.
5. Define replay foundation interfaces (implemented in Phase 3).
6. Support JSON export (extension point for Golden Trace comparison).

---

## 1.1 W5 MVP Scope (Causal Layer Coverage)

| Layer | W5 MVP | Deferred |
|---|---|---|
| `world` | ✅ Main thread EnvState / Rapier trace points | — |
| `env` | ✅ Ideal value mutations | — |
| `actuator` | ✅ `actuatorOutput` changes | — |
| `world_feedback` | ✅ ActuatorMirror physical feedback | — |
| `app` | ⚠️ **Stub**: Parsed from trace log branches or Worker explicit `causalStep` if spike passes | Full CFG instrumentation |
| `pal` | ⚠️ **Stub**: Main thread diffs ideal vs `STATE_UPDATE` degraded readings or Worker pushes | In-Wasm line-by-line tracing |

**M6 Minimal Acceptance Baseline**: **At least 4 of 6 layers contain real data** (`world`/`env`/`actuator`/`world_feedback` must be real); `pal`/`app` can be stubbed with `[inferred]`.

**Worker `causalStep` spike (Pre-W5, 0.5d)**: Verify whether App can be inferred via existing trace events; if not, infer only `pal` layer via `STATE_UPDATE` diffs.

---

## 2. Causal Chain Data Model

### 2.1 Enhanced CausalChainStep

Extends upstream specifications with `parentStepId` to support DAG topologies and `relatedBindings` for dual-viewport highlight linking:

```typescript
// types/causal-chain.ts

export interface CausalChainStep {
  stepId: string;                     // Unique ID (UUID or monotonic)
  simTimeUs: bigint;
  layer: CausalLayer;
  summary: string;                    // Human-readable summary
  data?: Record<string, unknown>;     // Structured data
  parentStepId?: string;              // Reverse trace link
  relatedBindings?: string[];         // Associated bindingIds for highlighting
  severity?: 'info' | 'warning' | 'fault';
}

export type CausalLayer = 
  | 'world'           // 3D physics events (collisions, ray hits)
  | 'env'             // Environmental ideal value calculations
  | 'pal'             // PAL signal degradation
  | 'app'             // App business logic decisions
  | 'actuator'        // Actuator outputs
  | 'world_feedback'; // 3D physical world feedback (wheel halted, etc.)

export const LAYER_CONFIG: Record<CausalLayer, {
  label: string;
  color: string;
  icon: string;
  defaultCollapsed: boolean;
}> = {
  world:          { label: '3D Physics',  color: '#22d3ee', icon: '🌍', defaultCollapsed: false },
  env:            { label: 'Environment', color: '#3B82F6', icon: '📡', defaultCollapsed: false },
  pal:            { label: 'PAL Degrad.', color: '#f59e0b', icon: '⚡', defaultCollapsed: true },
  app:            { label: 'App Logic',   color: '#10b981', icon: '🧠', defaultCollapsed: false },
  actuator:       { label: 'Actuators',   color: '#8b5cf6', icon: '⚙️', defaultCollapsed: false },
  world_feedback: { label: 'Feedback',    color: '#06b6d4', icon: '🔄', defaultCollapsed: false },
};
```

### 2.2 Fault Audit Log & Domain Isolation Structures (Gap 3 & Gap 5)

Defines TypeScript structures to bridge C-side Wasm fault isolation and audit ring buffers (aligning with `sim_specs_deep_assessment.md` Gaps 3 and 5):

```typescript
// ─── Fault Audit Log (Gap 3) ───

export enum FaultType {
  GPIO_BOUNCE = 1,
  I2C_DROP = 2,
  I2C_NOISE = 3,
  CLOCK_DRIFT = 4,
  ADC_DEVIATION = 5,
}

/** Fault audit log event pulled from Worker memory upon simulation exceptions */
export interface FaultAuditLogEvent {
  /** Virtual clock value at fault occurrence (bigint) */
  timestampUs: bigint;
  /** Fault degradation category */
  faultType: FaultType;
  /** Faulted GPIO pin number or I2C bus port */
  pinOrBus: number;
  /** Monotonic sequence counter for consistency validation */
  sequence: number;
}

// ─── Fault Domain Control (Gap 5) ───

export enum FaultDomainId {
  GLOBAL = 0,
  GPIO = 1,
  I2C0 = 2,
  I2C1 = 3,
  SPI0 = 4,
  CLOCK = 5,
}

/** Fault domain control packet for targeted peripheral fault injection */
export interface FaultDomainControl {
  domainId: FaultDomainId;
  armed: boolean;
}
```

### 2.3 Causal Chain Store

```typescript
// stores/causal-chain.store.ts

export const useCausalChainStore = defineStore('causal-chain', {
  state: () => ({
    steps: [] as CausalChainStep[],
    maxSteps: 500,
    selectedStepId: null as string | null,
    filterLayers: new Set<CausalLayer>(['world', 'env', 'pal', 'app', 'actuator', 'world_feedback']),
    isVerboseMode: false,     // Enabled during diagnose or ?causal=verbose
    autoScroll: true,
  }),
  
  actions: {
    pushStep(step: CausalChainStep) {
      // Coalesce consecutive identical world_feedback steps
      const last = this.steps[this.steps.length - 1];
      if (last && last.layer === step.layer && last.summary === step.summary && step.layer === 'world_feedback') {
        last.data = { ...last.data, mergedCount: ((last.data?.mergedCount as number) ?? 1) + 1 };
        return;
      }
      
      this.steps.push(step);
      
      // Ring buffer cap
      if (this.steps.length > this.maxSteps) {
        this.steps.shift();
      }
    },
    
    selectStep(stepId: string) {
      this.selectedStepId = stepId;
      const step = this.steps.find(s => s.stepId === stepId);
      if (step?.relatedBindings) {
        useSelectionStore().highlightBindingGroup(step.relatedBindings);
      }
    },
    
    // Reverse trace
    traceBack(stepId: string): CausalChainStep[] {
      const chain: CausalChainStep[] = [];
      let current = this.steps.find(s => s.stepId === stepId);
      while (current) {
        chain.unshift(current);
        if (!current.parentStepId) break;
        current = this.steps.find(s => s.stepId === current!.parentStepId);
      }
      return chain;
    },
    
    // Forward trace
    traceForward(stepId: string): CausalChainStep[] {
      return this.steps.filter(s => s.parentStepId === stepId);
    },
    
    clear() {
      this.steps = [];
      this.selectedStepId = null;
    },
  },
  
  getters: {
    filteredSteps: (state) => {
      return state.steps.filter(s => state.filterLayers.has(s.layer));
    },
    
    faultSteps: (state) => {
      return state.steps.filter(s => s.severity === 'fault');
    },
  },
});
```

---

## 3. Causal Chain Generation

### 3.1 Layer Generation Triggers

| Layer | Generation Point | Trigger Condition |
|---|---|---|
| `world` | `EnvStateManager.tick()` | Raycast hit distance changes $> 5\text{cm}$, or collision occurs |
| `env` | `EnvStateManager.tick()` | Ideal value changes |
| `pal` | Worker `causalStep` event | Delta between pre/post degradation exceeds threshold |
| `app` | Worker `causalStep` event | App logic branch executed (`if`/`switch`) |
| `actuator` | Worker `actuatorOutput` event | GPIO/PWM output levels mutate |
| `world_feedback` | `ActuatorMirror.applyOutputs()` | Joint velocities change |

### 3.2 Main Thread Generation

```typescript
// Inside EnvStateManager.tick()
if (Math.abs(prevDistance - newDistance) > 5) {
  causalChainStore.pushStep({
    stepId: generateId(),
    simTimeUs,
    layer: 'world',
    summary: `Raycast hit ${hitObjectId} @ ${newDistance}cm`,
    data: { bindingId, prevDistance, newDistance, hitObjectId },
    relatedBindings: [bindingId],
  });
  
  causalChainStore.pushStep({
    stepId: generateId(),
    simTimeUs,
    layer: 'env',
    summary: `ideal_distance_cm = ${newDistance}`,
    data: { bindingId, value: newDistance },
    parentStepId: worldStepId,
    relatedBindings: [bindingId],
  });
}
```

### 3.3 Worker Side Generation

```typescript
// Inside wasm-simulation.worker.ts
// When PAL degradation creates significant delta
postMessage({
  type: 'causalStep',
  step: {
    stepId: generateId(),
    simTimeUs: currentSimTimeUs,
    layer: 'pal',
    summary: `+noise → ${degradedValue}cm, warmup ${warmupOk ? 'OK' : 'pending'}`,
    data: { idealValue, degradedValue, noiseAmount, warmupStatus },
    parentStepId: lastEnvStepId,
  }
});

// When App executes decision branch
postMessage({
  type: 'causalStep',
  step: {
    stepId: generateId(),
    simTimeUs: currentSimTimeUs,
    layer: 'app',
    summary: `if (dist < 40) stop motors`,
    data: { condition: 'dist < 40', result: true, distValue: 31.7 },
    parentStepId: lastPalStepId,
  }
});
```

---

## 4. CausalChainConsole UI

### 4.1 Layout

```text
┌─ Causal Chain ────────────────────────────────────────────────────┐
│ [Filter: 🌍 📡 ⚡ 🧠 ⚙️ 🔄]  [Verbose ☐]  [Export JSON]  [Clear] │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│ T=12000us  🌍 Raycast hit wall_north @ 32cm                      │
│              │                                                    │
│ T=12000us  📡 ideal_distance_cm = 32                [bind_radar] │
│              │                                                    │
│ T=12016us  ⚡ +noise → 31.7cm, warmup OK      [▶ expand details] │
│              │   bounce_us=2000, adc_noise_v=0.01                │
│              │                                                    │
│ T=12016us  🧠 if (dist < 40) stop motors              ← FAULT?  │
│              │                                                    │
│ T=12016us  ⚙️ PWM_LEFT=0, PWM_RIGHT=0                           │
│              │                                                    │
│ T=12032us  🔄 wheel_angular_vel = 0                              │
│                                                                   │
│ ◄ [反向追溯] ──────────────────── [时间轴] ────── [正向展开] ►      │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 Interaction Standards

| Interaction | Behavior |
|---|---|
| **Click Step** | Selects step $\rightarrow$ Highlights related bindings across dual viewports $\rightarrow$ Inspects bindings |
| **Double-Click PAL Step** | Expands/collapses degradation parameters detail drawer |
| **Click Reverse Trace** | Backtracks from current step to root cause, highlighting ancestor chain |
| **Click Forward Expand** | Expands all immediate downstream descendant steps |
| **Fault Auto-Scroll** | Steps with `severity=fault` scroll into view with pulsing animation |
| **Filter Icons** | Toggles layer visibility |
| **Verbose Toggle** | Enables full `causalStep` streaming from Worker |
| **Export JSON** | Exports active circular buffer to a JSON file |
| **Timeline Scrubbing** | (Replay foundation; UI reserved in W5, functionality implemented in Phase 3) |

### 4.3 Reverse Trace View

```text
┌─ Reverse Trace: "wheel stopped" ─────────────────────────────────┐
│                                                                   │
│ 🔄 wheel_angular_vel = 0                                 [当前]  │
│   ↑ 为什么轮子停了？                                              │
│ ⚙️ PWM_LEFT=0, PWM_RIGHT=0                                      │
│   ↑ 为什么 PWM 为 0？                                            │
│ 🧠 if (dist < 40) stop motors     dist=31.7cm                   │
│   ↑ 距离值从哪来？                                                │
│ ⚡ +noise → 31.7cm (ideal: 32cm)                                 │
│   ↑ ideal 值从哪来？                                              │
│ 📡 ideal_distance_cm = 32                                        │
│   ↑ 距离怎么测的？                                                │
│ 🌍 Raycast hit wall_north @ 32cm                          [根因] │
│                                                                   │
│                                         [返回时间线视图]           │
└───────────────────────────────────────────────────────────────────┘
```

### 4.4 Automated Reverse Tracing

```typescript
function detectAnomalousOutputChange(prev: ActuatorOutputBatch, curr: ActuatorOutputBatch) {
  for (const [pin, duty] of Object.entries(curr.pwm)) {
    const prevDuty = prev.pwm[pin] ?? 0;
    if (prevDuty > 0.1 && duty === 0) {
      const lastActuatorStep = findLastStepByLayer('actuator');
      if (lastActuatorStep) {
        const trace = causalChainStore.traceBack(lastActuatorStep.stepId);
        showAutoTraceNotification(`电机停止：${trace.length} 步因果链已生成`, trace);
      }
    }
  }
}
```

---

## 5. Diagnose Mode Integration

### 5.1 Triggering Conditions

| Trigger | Origin | Behavior |
|---|---|---|
| Fault Event | Worker `stateChanged: 'faulted'` | Auto-switches to diagnose + pauses simulation |
| Manual User Action | Top bar button or `Ctrl+Shift+D` | Switches mode |
| Binding Validation Error | Blocking validation error | Retains design mode; expands Diagnostics tab |

### 5.2 Diagnose Mode Layout Reconfiguration

```typescript
// Inside workbench-mode.store.ts switchTo('diagnose')
function enterDiagnoseMode() {
  // 1. Pause simulation automatically
  simulationClient.pause();
  
  // 2. Compress center viewports (25:25), expand bottom console to 50%
  layoutStore.splitRatio = 0.5;
  layoutStore.bottomPanelHeight = window.innerHeight * 0.5;
  
  // 3. Switch bottom console to Causal tab
  layoutStore.activateBottomTab('causal');
  
  // 4. Enable verbose telemetry streaming
  causalChainStore.isVerboseMode = true;
  
  // 5. Auto-focus on latest fault step
  const faultStep = causalChainStore.faultSteps.at(-1);
  if (faultStep) {
    causalChainStore.selectStep(faultStep.stepId);
  }
}
```

### 5.3 Exiting Diagnose Mode

```typescript
function exitDiagnoseMode() {
  // Retain causal chain history (do not clear)
  causalChainStore.isVerboseMode = false;
  
  // Restore layout
  layoutStore.applyModeDefaults('simulate');
}
```

---

## 6. Ring Buffer & Performance

### 6.1 Buffering Rules

| Mode | Capacity | Dispatch Strategy |
|---|---|---|
| `simulate` (Default) | 500 | Pushes world/env/app/actuator; PAL only pushed when delta $>$ threshold |
| `simulate` + Verbose | 500 | Full streaming (including every frame of world_feedback) |
| `diagnose` | 500 | Full streaming + automatic fault tagging |

### 6.2 Coalescing Strategy

Consecutive identical steps (e.g. `world_feedback: wheel_angular_vel = 0` each frame) are coalesced into a single entry annotated with `mergedCount`:

```text
🔄 wheel_angular_vel = 0 (×47 帧)
```

### 6.3 Do Not Enable Full causalStep by Default in simulate Mode

For performance considerations:

```typescript
// Worker-side decision
if (isVerboseMode || severity === 'fault') {
  postMessage({ type: 'causalStep', step });
} else {
  // Only push when app/actuator layers change
  if (step.layer === 'app' || step.layer === 'actuator') {
    if (hasValueChanged(step)) {
      postMessage({ type: 'causalStep', step });
    }
  }
}
```

---

## 7. Simulation Replay Foundation (Phase 3 Reserved)

### 7.1 Replay Frame Contracts

```typescript
// types/replay.ts (W5 interface definition, Phase 3 implementation)

export interface ReplayFrame {
  frameIndex: number;
  simTimeUs: bigint;
  idealInputs: IdealInputBatch;
  actuatorOutputs: ActuatorOutputBatch;
  physicsSnapshot?: {
    bodies: Array<{ partId: string; position: Vector3; rotation: Quaternion }>;
  };
}

export interface ReplayRecorder {
  startRecording(): void;
  stopRecording(): ReplayFrame[];
  isRecording(): boolean;
}

export interface ReplayPlayer {
  loadFrames(frames: ReplayFrame[]): void;
  seekTo(frameIndex: number): void;
  play(): void;
  pause(): void;
  getProgress(): { current: number; total: number };
}
```

### 7.2 Timeline UI Placeholder

A read-only timeline progress bar displays active SimTime at the bottom of the causal console, reserving the handle for interactive replay scrubbing in Phase 3:

```text
◄────────────────────────────────────────────────────────────►
0ms        |        5ms        |        10ms        |   12ms
           ▲ Playhead (Phase 3 active)
```

In W5, this region is a read-only progress indicator displaying current SimTime; Phase 3 implements draggable scrubbing.

---

## 8. JSON Export

```typescript
// Export format compatible with Golden Trace comparison
export interface CausalChainExport {
  version: 1;
  exportedAt: string;
  simTimeRangeUs: { start: bigint; end: bigint };
  steps: CausalChainStep[];
  manifest: {
    projectName: string;
    schemaVersion: number;
    bindingsSummary: string[];
  };
}

function exportCausalChain(): string {
  const data: CausalChainExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    simTimeRangeUs: {
      start: causalChainStore.steps[0]?.simTimeUs ?? 0n,
      end: causalChainStore.steps.at(-1)?.simTimeUs ?? 0n,
    },
    steps: causalChainStore.steps.map(s => ({
      ...s,
      simTimeUs: s.simTimeUs.toString(), // BigInt serialized as string
    })),
    manifest: {
      projectName: projectStore.manifest.projectName,
      schemaVersion: projectStore.manifest.schemaVersion,
      bindingsSummary: projectStore.manifest.bindings?.actuators.map(a => a.bindingId) ?? [],
    },
  };
  
  return JSON.stringify(data, null, 2);
}
```

---

## 9. Acceptance Criteria

| # | Acceptance Item | Validation Method |
|---|---|---|
| A1 | Obstacle car loop generates $\ge 5$ linked causal steps (world $\rightarrow$ env $\rightarrow$ pal $\rightarrow$ app $\rightarrow$ actuator $\rightarrow$ feedback) | Manual |
| A2 | Forward timeline displays steps chronologically | Visual |
| A3 | Clicking step highlights associated bindings in 2D and 3D viewports | Manual |
| A4 | Reverse trace navigates from actuator back to 3D world root cause | Manual |
| A5 | PAL layer collapsed by default; expands to show degradation parameters | Manual |
| A6 | Fault trigger auto-enters diagnose mode and focuses on fault step | Manual |
| A7 | Diagnose mode bottom console occupies 50% height with causal focus | Visual |
| A8 | 500-step ring buffer prunes oldest entries accurately | Vitest |
| A9 | Consecutive identical feedback events collapse into `(×N)` markers | Manual |
| A10 | Exported JSON serializes cleanly and parses without errors | Vitest |
| A11 | Layer filter glyphs toggle layer visibility | Manual |
| A12 | Read-only timeline displays active SimTime progress | Visual |

---

*Document Revision History:*

- 2026-07-09: Initial creation.
- 2026-07-09: Review revisions—§1.1 W5 MVP causal layer coverage and pal/app stub strategy.

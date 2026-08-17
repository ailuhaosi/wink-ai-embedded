# W5 Causal Chain & Diagnostics Mode — CausalChainConsole & Replay Foundations

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
| Prerequisites | W3c Sensors & Environment Bridge complete |
| Deliverables | `CausalChainConsole`, Forward/Reverse causality tracing, Diagnose mode integration, Replay foundation interfaces |
| Milestone | M6: Full closed-loop obstacle avoidance workflow traceable $\ge 5$ steps forward and backward in the causal console |
| Upstream Refs | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §10–§11 |

---

## 1. Goals

1. Implement `CausalChainConsole` to visualize cross-domain causality timelines.
2. Support bidirectional navigation (Forward propagation and Reverse root-cause tracing).
3. Connect Diagnose Mode interactions: Fault triggers $\rightarrow$ Automatic pause $\rightarrow$ Causal focus $\rightarrow$ 50% split view.
4. Manage circular step buffers (500 steps) with duplicate collapsing.
5. Provide JSON export capabilities for Golden Trace baseline comparisons.

---

## 2. Causal Chain Data Model

```typescript
export interface CausalChainStep {
  stepId: string;
  simTimeUs: bigint;
  layer: CausalLayer;
  summary: string;
  data?: Record<string, unknown>;
  parentStepId?: string;
  relatedBindings?: string[];
  severity?: 'info' | 'warning' | 'fault';
}

export type CausalLayer = 
  | 'world'           // 3D physics events (Collisions, raycast hits)
  | 'env'             // Environment ideal values
  | 'pal'             // PAL signal degradation (Noise, warmup)
  | 'app'             // Firmware decision branches
  | 'actuator'        // GPIO / PWM outputs
  | 'world_feedback'; // Physical reactions (Wheel halt)
```

---

## 3. Fault Audit Logs & Domain Isolation (Gaps 3 & 5)

```typescript
export enum FaultType {
  GPIO_BOUNCE = 1,
  I2C_DROP = 2,
  I2C_NOISE = 3,
  CLOCK_DRIFT = 4,
  ADC_DEVIATION = 5,
}

export interface FaultAuditLogEvent {
  timestampUs: bigint;
  faultType: FaultType;
  pinOrBus: number;
  sequence: number;
}

export enum FaultDomainId {
  GLOBAL = 0,
  GPIO = 1,
  I2C0 = 2,
  I2C1 = 3,
  SPI0 = 4,
  CLOCK = 5,
}

export interface FaultDomainControl {
  domainId: FaultDomainId;
  armed: boolean;
}
```

---

## 4. CausalChainConsole UI & Reverse Tracing

The console visualizes causality across discrete layers:
```text
T=12000us  🌍 Raycast hit wall_north @ 32cm
             │
T=12000us  📡 ideal_distance_cm = 32                [bind_radar]
             │
T=12016us  ⚡ +noise -> 31.7cm, warmup OK
             │
T=12016us  🧠 if (dist < 40) stop motors
             │
T=12016us  ⚙️ PWM_LEFT=0, PWM_RIGHT=0
             │
T=12032us  🔄 wheel_angular_vel = 0
```

Clicking **Reverse Trace** starts at the selected actuator output and traverses backward via `parentStepId` up to the originating 3D world event.

---

## 5. Diagnose Mode Layout Integration

Entering Diagnose mode triggers:
1. Automatic simulation suspension.
2. Viewport redistribution: Dual-viewport compressed to 50% height; bottom console expanded to 50% height with `splitRatio = 0.5`.
3. Activates the `Causal` tab and enables verbose telemetry streaming.
4. Auto-scrolls to the latest recorded fault.

---

## 6. Circular Buffer & Performance Rules

- Maximum buffer depth: 500 steps.
- Consecutive identical feedback events (e.g. `wheel_angular_vel = 0`) are collapsed with `(x47 frames)`.
- Full verbose logging is active only in Diagnose mode to protect 60 FPS simulation performance.

---

## 7. Verification Criteria (A1~A12)

- **A1**: Obstacle avoidance produces $\ge 5$ linked causal steps across all layers.
- **A3**: Clicking any causal step highlights associated bindings across 2D and 3D viewports.
- **A4**: Reverse tracing accurately tracks motor halts back to obstacle raycast hits.
- **A6**: Fault injection switches the IDE to diagnose mode and focuses on the fault step.
- **A10**: JSON export serializes cleanly with full BigInt timestamp strings.

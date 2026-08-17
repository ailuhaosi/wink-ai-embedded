# W3c Sensors & Environment Bridge — Raycast Distance & EnvStateManager

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/03-dual-viewport-phased-design/05-phase-w3c-sensors-env-bridge.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Phase | W3c |
| Effort Estimate | ~1.5 days |
| Prerequisites | W3b Physics Engine & Actuators complete |
| Deliverables | `EnvStateManager`, Raycast distance calculation, Distance slider migration, Noise visualization |
| Milestone | M4: Chassis advances $\rightarrow$ Encounters obstacle $\rightarrow$ Ultrasonic detects distance $\rightarrow$ Firmware halts motors $\rightarrow$ Vehicle stops |
| Upstream Refs | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §6–§7 |

---

## 1. Goals

1. Implement `EnvStateManager` to calculate ideal inputs from active bindings each frame.
2. Implement physics raycast distance measurement originating from sensor mounts.
3. Migrate ultrasonic distance inputs from manual sliders to 3D environment raycasting.
4. Batch dispatch ideal inputs to the Wasm Worker via `setIdealInputs`.
5. Visualize sensor noise comparisons (Ideal vs Degraded values).
6. Achieve full end-to-end obstacle avoidance closed-loop validation.

---

## 1.1 Wasm Bridge Migration Reference Table (SSOT)

| Sensor / Actuator | Phase C API | W3c Target API | Migration Strategy |
|---|---|---|---|
| HC-SR04 Range | `setUltrasonicDistance(trig, echo, cm)` | `setIdealInputs({ sensors: [{ bindingId, value, unit: 'cm' }] })` | EnvState calculates distance; resolves pins via `binding-pin-resolver` |
| Button GPIO | `setPinIdeal(pin, level)` | Preserved in `idealBatch.virtualGpio` | Non-blocking |
| PWM Output | None | `actuatorOutput.pwm` | Delivered in W3b |
| DHT Temperature| None | Implemented in W4 | W4 scope |

---

## 1.2 Raycasting & Collision Unification

**Rapier is the SSOT for collision geometry and raycasting**. `PhysicsWorld.castRay(origin, direction, maxRange)` calculates the exact distance to environment colliders. Three.js `Raycaster` is reserved strictly for UI click-picking.

---

## 2. EnvStateManager Architecture

```typescript
export interface IdealSensorValue {
  bindingId: string;
  value: number | boolean;
  unit: 'cm' | 'celsius' | 'percent' | 'bool' | 'lux';
  source: 'computed' | 'override';
}

export class EnvStateManager {
  tick(simTimeUs: bigint, frameCount: number): IdealInputBatch {
    // Computes raycasts, thermal field values, and collision flags
  }
}
```

---

## 3. Raycast Distance Calculation

Raycasts originate from the sensor mount's world position and shoot along the mount's forward orientation vector:
```typescript
const hit = this.physics.castRay(origin, worldDir, mapping.maxRangeCm / 100);
const distanceCm = hit ? Math.round(hit.timeOfImpact * 100) : mapping.maxRangeCm;
```

---

## 4. Distance Slider Migration & Override Toggles

Manual distance sliders are replaced by automated 3D raycasting. A debug "Manual Override" toggle in the Bindings panel allows users to inject forced distance values during testing.

---

## 5. End-to-End Obstacle Avoidance Causal Flow

```text
[world]      Raycast hits wall_north @ 32cm
  → [env]    ideal_distance_cm = 32
  → [worker] setIdealInputs({ bind_radar_front: 32 })
  → [pal]    +noise -> 31.7cm, warmup OK
  → [app]    if (distance < 40) { stop_motors(); }
  → [worker] actuatorOutput: PWM_LEFT=0, PWM_RIGHT=0
  → [mirror] ActuatorMirror -> joint_wheel_left velocity = 0
  → [world]  wheel_angular_vel = 0, chassis stops
```

---

## 6. Verification Criteria (A1~A10)

- **A1**: Ultrasonic raycast origin moves and rotates with the car chassis.
- **A2**: Raycast hits obstacle wall and returns correct distance within $\pm 1\text{cm}$.
- **A4**: `EnvStateManager.tick()` computes within $< 1\text{ms}$ per frame.
- **A6**: Firmware logic halts motors when encountering obstacles in the 3D world.
- **A10**: Complete closed-loop execution of the `tpl_avoidance_car` template.

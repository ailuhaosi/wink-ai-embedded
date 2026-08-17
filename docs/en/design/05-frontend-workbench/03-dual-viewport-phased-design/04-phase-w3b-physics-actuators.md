# W3b Physics Engine & Actuators — Rapier Integration & SimTime Synchronization

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/03-dual-viewport-phased-design/04-phase-w3b-physics-actuators.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Phase | W3b |
| Effort Estimate | ~1.5 days |
| Prerequisites | W3a Static 3D Preview complete |
| Deliverables | Rapier 3D integration, SimTime sync protocol, ActuatorMirror, Worker protocol extension |
| Milestone | M3: PWM output $\rightarrow$ 3D wheel turns proportional to duty cycle $\rightarrow$ Chassis moves |
| Master Plan Ref | [00-master-plan.md](./00-master-plan.md) §3 Performance Budget |

---

## 1. Goals

1. Integrate Rapier 3D (Wasm edition) supporting rigid bodies, colliders, and joints.
2. Establish a precise **SimTime Synchronization Protocol** aligning main-thread physics with Wasm worker clocks.
3. Implement `ActuatorMirror` to translate Worker GPIO/PWM outputs into 3D joint motor impulses.
4. Extend Worker protocols with `setIdealInputs` / `actuatorOutput`.
5. Implement frame budget telemetry monitors.

---

## 2. Rapier Integration & Fallback

```typescript
import '@dimforge/rapier3d-compat';

export async function initPhysics(): Promise<PhysicsWorld> {
  const RAPIER = await import('@dimforge/rapier3d-compat');
  await RAPIER.init();
  const gravity = new RAPIER.Vector3(0, -9.81, 0);
  return new PhysicsWorld(new RAPIER.World(gravity), RAPIER);
}
```

Kinematic fallback is available if WASM compilation fails on low-end client environments.

---

## 3. PhysicsWorld Architecture

```typescript
export class PhysicsWorld {
  addDynamicBody(partId: string, position: Vector3, mass: number): RAPIER.RigidBody;
  addStaticBody(propId: string, position: Vector3): RAPIER.RigidBody;
  addBoxCollider(bodyId: string, halfExtents: Vector3, friction: number): RAPIER.Collider;
  addCylinderCollider(bodyId: string, radius: number, halfHeight: number): RAPIER.Collider;
  addRevoluteJoint(jointId: string, parentId: string, childId: string, anchor: Vector3, axis: Vector3): RAPIER.ImpulseJoint;
  step(dt: number): void;
  syncToThreeJS(meshRegistry: Map<string, THREE.Mesh>): void;
}
```

---

## 4. SimTime Synchronization Protocol

### 4.1 Master-Slave Time Architecture
- **Main Thread (Time Master)**: Increments `simTimeUs` frame-by-frame and dispatches `postMessage({ setIdealInputs, targetSimTimeUs })`.
- **Wasm Worker (Time Follower)**: Steps `s_virtual_us` in passive catch-up loops up to `MAX_CATCHUP_US_PER_FRAME = 5000` (5ms max catch-up per frame).
- **Timeout Protection**: 3 consecutive dropped frames trigger an automatic SimSpeed throttle.

---

## 5. ActuatorMirror Engine

```typescript
export class ActuatorMirror {
  applyOutputs(outputs: ActuatorOutputBatch) {
    // Maps pwm_to_angular_velocity to Rapier joint motors
    // motorMaxTorque is retrieved from MechanicalJoint metadata
  }
}
```

### Differential Drive Kinematics
Translates left/right wheel angular velocities into linear and angular velocities:
$$v = \frac{v_{\text{left}} + v_{\text{right}}}{2}, \quad \omega = \frac{v_{\text{right}} - v_{\text{left}}}{\text{trackWidth}}$$

---

## 6. Worker Protocol Extensions

### 6.1 `setIdealInputs` Command
Dispatches batched ideal sensor readings and virtual GPIO states to the Wasm sandbox.

### 6.2 `actuatorOutput` Event
Returns batched GPIO and PWM duty cycle maps from linear memory.

---

## 7. WasmImports Glue Contract & Interrupt Queues (Gaps 8 & 1)

```typescript
export interface WasmImports {
  env: {
    js_pal_os_sleep_ms: (ms: number) => Promise<void>;
    js_pal_os_get_ms: () => bigint;
    js_pal_os_get_us: () => bigint;
    js_pal_gpio_write: (pin: number, level: boolean) => void;
    js_pal_gpio_read: (pin: number) => boolean;
    js_pal_pwm_set_duty: (channel: number, duty: number) => void;
    js_pal_i2c_transfer: (port: number, addr: number, wPtr: number, wLen: number, rPtr: number, rLen: number) => boolean;
    js_pal_register_interrupt: (pin: number, cbIndex: number, argPtr: number) => void;
    js_pal_poll_interrupt: (outCbPtr: number, outArgPtr: number) => boolean;
  }
}

export interface WasmInterruptQueue {
  registry: Map<number, WasmInterruptInfo>;
  pending: Array<WasmInterruptInfo>;
  maxPending: number;
}
```

---

## 8. Verification Matrix (A1~A13)

- **A1**: Rapier WASM initializes smoothly.
- **A3**: Wheels rotate along revolute joint axes under active motor torques.
- **A5**: PWM duty $= 0.5$ drives wheels at half velocity.
- **A8**: Worker lag $> 3$ frames triggers simulation speed degradation.
- **A12**: `WasmImports` matches Emscripten C runtime exports without undefined symbols.

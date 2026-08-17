# W3b Physics Engine + Actuators — Rapier Integration & SimTime Synchronization

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
| Deliverables | Rapier integration, SimTime sync protocol, ActuatorMirror, Worker protocol extensions |
| Milestone | M3: PWM output $\rightarrow$ 3D wheel rotates proportional to duty cycle $\rightarrow$ Chassis moves |
| Upstream Refs | [00-master-plan.md](./00-master-plan.md) §3 Performance Budget |

---

## 1. Goals

1. Integrate Rapier 3D physics engine (WASM edition), supporting rigid bodies, colliders, and joints.
2. Define a **precise SimTime synchronization protocol**, ensuring physics in the main thread and Wasm execution in the Worker maintain consistent virtual clocks.
3. Implement `ActuatorMirror`: Map Worker GPIO/PWM outputs to 3D joint driving forces.
4. Extend Worker communication protocols: Add `setIdealInputs` / `actuatorOutput`.
5. Establish frame budget telemetry monitors.

> The `ActuatorObservation` delivered in this phase serves as Output Channel ③ in the observation plane hierarchy ([ADR-0027](../../../decisions/unisim/0027-sim-observation-data-planes.md)) (the SSOT for actuator panels / ActuatorMirror); "unification" refers to consuming outputs cleanly through ③, and does not mean `pinStates` (①) / `oledFb` (②) are merged or deleted.

**Out of scope for this phase**: Sensor raycasting (W3c), thermal environmental fields (W4).

> **Blocking Gate**: Must complete **Task 3.0b Wasm Bridge Spike** before entering Task 3.1 (see §2.4).

---

## 2. Rapier Integration

### 2.4 Task 3.0b — Wasm Bridge Spike (Blocking)

| Field | Content |
|---|---|
| Effort Estimate | 4h |
| Priority | 🔴 P0 (Blocks W3b development) |
| Output | Spike findings section + minimal PWM reading pathway |

**Spike Conclusions (Implemented and chosen in PLAN-20260711-AVOID-P1):**
Option **(A)** selected — Extend `STATE_UPDATE` payload with `actuatorOutputs` (including `pwm` keys collecting C-side duty cycles).
1. **PWM Reading Method**: Worker collects `pal_wasm_get_pwm_duty_percent(channel)` exported from Wasm and writes it into `STATE_UPDATE.payload.actuatorOutputs.pwm[channel]`. The main thread receives this payload in `simulation-client.ts` and maps it via a Mapper module into `ActuatorObservation` for read-only consumption by UI / physics engine.
2. **Pins & Clock Rules**: Physical inputs like ultrasonic distance use `SET_ULTRASONIC_DISTANCE` (migrating to unified sensor interfaces later); virtual clocks are stepped by Worker in Phase 1 to ensure high performance and isolation.

**Current vs Target Architecture** (Cross-referenced against `wasm-simulation.worker.ts`):

| Capability | Current State (Phase C) | W3b Target | Spike Conclusion Entry |
|---|---|---|---|
| Ultrasonic Distance | `ultrasonicDistances` Map + `ultrasonicEchoUs(pin)` | Migrated to `setIdealInputs` in W3c | Pin key rules documented |
| GPIO Input | `pal_wasm_set_gpio_input` | Maintained | ✅ Available |
| PWM Output | **No unified export** | `actuatorOutput.pwm[pin]` | ✅ Option (A) chosen: embedded in `STATE_UPDATE.payload.actuatorOutputs` |
| Virtual Clock | Worker `STEP_US=1000n` timer step | Aligned with main thread SimTime (§4.5) | Driven by Worker timer step for now |
| Protocol | `INIT`/`START`/`STATE_UPDATE` strings | `HANDSHAKE` v2 + transition dual stack | `STATE_UPDATE` format extended |

**Spike Verified**: Option (A) is unified across W3b. `STATE_UPDATE.payload.actuatorOutputs.pwm` is used to drive ActuatorMirror.

---

### 2.1 Installation & Loading

```typescript
// Uses compat version to avoid top-level await issues
// package.json: "@dimforge/rapier3d-compat": "^0.14.0"

// components/world/physics-engine.ts
let RAPIER: typeof import('@dimforge/rapier3d-compat') | null = null;

export async function initPhysics(): Promise<PhysicsWorld> {
  if (!RAPIER) {
    RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();  // Initialize WASM
  }
  
  const gravity = new RAPIER.Vector3(0, -9.81, 0);
  const world = new RAPIER.World(gravity);
  
  return new PhysicsWorld(world, RAPIER);
}
```

### 2.2 Vite Configuration

```typescript
// vite.config.ts required configuration
export default defineConfig({
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat']  // Avoid pre-bundling WASM
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three'],
          'rapier-physics': ['@dimforge/rapier3d-compat'],
        }
      }
    }
  }
});
```

### 2.3 Fallback: Kinematic Mode

If Rapier WASM loading fails or bundle size is unacceptable, a pure kinematic fallback is provided:

```typescript
export class KinematicFallback implements IPhysicsEngine {
  step(dt: number) {
    // No collision detection, integrates position only
    for (const body of this.bodies) {
      body.position.addScaledVector(body.velocity, dt);
      body.rotation.z += body.angularVelocity * dt;
    }
  }
}
```

Differences: No collisions, no realistic friction, vehicles can pass through walls. Used strictly as a fallback.

---

## 3. PhysicsWorld Wrapper

### 3.1 Class Definition

```typescript
// components/world/physics-engine.ts

export class PhysicsWorld {
  private world: RAPIER.World;
  private bodyMap: Map<string, RAPIER.RigidBody> = new Map();
  private colliderMap: Map<string, RAPIER.Collider> = new Map();
  private jointMap: Map<string, RAPIER.ImpulseJoint> = new Map();
  
  constructor(world: RAPIER.World, private R: typeof RAPIER) {
    this.world = world;
  }
  
  // ─── Rigid Body Management ───
  
  addDynamicBody(partId: string, position: Vector3, mass: number): RAPIER.RigidBody {
    const bodyDesc = this.R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setAdditionalMass(mass);
    const body = this.world.createRigidBody(bodyDesc);
    this.bodyMap.set(partId, body);
    return body;
  }
  
  addStaticBody(propId: string, position: Vector3): RAPIER.RigidBody {
    const bodyDesc = this.R.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z);
    const body = this.world.createRigidBody(bodyDesc);
    this.bodyMap.set(propId, body);
    return body;
  }
  
  // ─── Colliders ───
  
  addBoxCollider(bodyId: string, halfExtents: Vector3, friction: number): RAPIER.Collider {
    const body = this.bodyMap.get(bodyId)!;
    const colliderDesc = this.R.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setFriction(friction);
    const collider = this.world.createCollider(colliderDesc, body);
    this.colliderMap.set(bodyId, collider);
    return collider;
  }
  
  addCylinderCollider(bodyId: string, radius: number, halfHeight: number): RAPIER.Collider {
    const body = this.bodyMap.get(bodyId)!;
    const colliderDesc = this.R.ColliderDesc.cylinder(halfHeight, radius);
    return this.world.createCollider(colliderDesc, body);
  }
  
  // ─── Joints ───
  
  addRevoluteJoint(jointId: string, parentId: string, childId: string, 
                   anchor: Vector3, axis: Vector3): RAPIER.ImpulseJoint {
    const parent = this.bodyMap.get(parentId)!;
    const child = this.bodyMap.get(childId)!;
    const params = this.R.JointData.revolute(
      new this.R.Vector3(anchor.x, anchor.y, anchor.z),
      new this.R.Vector3(0, 0, 0),  // child local anchor
      new this.R.Vector3(axis.x, axis.y, axis.z)
    );
    const joint = this.world.createImpulseJoint(params, parent, child, true);
    this.jointMap.set(jointId, joint);
    return joint;
  }
  
  // ─── Stepping ───
  
  step(dt: number) {
    this.world.timestep = dt;
    this.world.step();
  }
  
  // ─── Three.js Sync ───
  
  syncToThreeJS(meshRegistry: Map<string, THREE.Mesh>) {
    for (const [partId, body] of this.bodyMap) {
      const mesh = meshRegistry.get(partId);
      if (!mesh) continue;
      const pos = body.translation();
      const rot = body.rotation();
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
  }
  
  // ─── Disposal ───
  
  dispose() {
    this.world.free();
    this.bodyMap.clear();
    this.colliderMap.clear();
    this.jointMap.clear();
  }
}
```

### 3.2 Manifest $\rightarrow$ Physics Conversion

```typescript
function buildPhysicsFromManifest(manifest: EmbeddedProjectManifest, physics: PhysicsWorld) {
  // 1. Create mechanical part rigid bodies
  for (const part of manifest.mechanical?.parts ?? []) {
    if (part.physics?.static) {
      physics.addStaticBody(part.partId, part.transform.position);
    } else {
      physics.addDynamicBody(part.partId, part.transform.position, part.physics?.massKg ?? 0.1);
    }
    
    // Colliders
    const model = MODEL_LIBRARY[part.modelId];
    if (model && part.physics?.collider !== 'none') {
      addColliderFromModel(physics, part.partId, model, part.physics);
    }
  }
  
  // 2. Create joints
  for (const joint of manifest.mechanical?.joints ?? []) {
    if (joint.type === 'revolute') {
      physics.addRevoluteJoint(joint.jointId, joint.parentPartId, joint.childPartId,
        { x: 0, y: 0, z: 0 }, joint.axis);
    }
  }
  
  // 3. Create environmental static colliders
  for (const prop of manifest.environment?.props ?? []) {
    physics.addStaticBody(prop.propId, prop.transform.position);
  }
}
```

---

## 4. SimTime Synchronization Protocol

### 4.1 Master-Slave Time Architecture

```text
┌─────────────────── Time Master: Main Thread ──────────────────┐
│                                                               │
│  simTimeUs: bigint  ←── Increments dtUs per frame             │
│  ↓                                                            │
│  postMessage({ type: 'setIdealInputs',                       │
│                targetSimTimeUs: simTimeUs,                     │
│                inputs: IdealInputBatch })                      │
│                                                               │
└───────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
┌─────────────────── Time Follower: Worker ─────────────────────┐
│                                                               │
│  Receives targetSimTimeUs                                     │
│  while (s_virtual_us < targetSimTimeUs) {                    │
│    pal_wasm_advance_virtual_clock(s_virtual_us + tickStepUs) │
│    run app_loop iteration                                     │
│  }                                                            │
│                                                               │
│  postMessage({ type: 'actuatorOutput',                       │
│                simTimeUs: s_virtual_us,                        │
│                gpio: {...}, pwm: {...} })                      │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 4.2 Frame Timing Sequence

```text
Time ──────────────────────────────────────────────────────►

Frame N                          Frame N+1
├──────── 16ms ─────────────────┤──────── 16ms ──────────┤
│                                │                        │
│ Main:                          │ Main:                  │
│ ├─ render(N)                   │ ├─ applyActuators(N+1)│
│ ├─ physics.step(dt)            │ ├─ render(N+1)        │
│ ├─ envState.tick(N)            │ ├─ physics.step(dt)   │
│ └─ postMsg(idealInputs, N+1)  │ └─ postMsg(..., N+2)  │
│         │                      │         │              │
│         ▼                      │         ▼              │
│ Worker:                        │ Worker:                │
│ ├─ advance_clock(N+1)         │ ├─ advance_clock(N+2) │
│ ├─ app_loop()                  │ ├─ app_loop()         │
│ └─ postMsg(actuatorOutputs)    │ └─ postMsg(...)       │
│                   │            │                        │
│                   ▼            │                        │
│           actuatorBuffer[1]    │                        │
│                   (write)      │  actuatorBuffer[1]     │
│                                │        (read)          │
```

### 4.3 Worker Catch-Up Timeout Protection

```typescript
// Main thread side
const WORKER_TIMEOUT_FRAMES = 3;
let workerMissedFrames = 0;

function onWorkerResponse(event: MessageEvent) {
  workerMissedFrames = 0;
  // Normal actuatorOutput processing...
}

function onAnimationFrame() {
  workerMissedFrames++;
  
  if (workerMissedFrames >= WORKER_TIMEOUT_FRAMES) {
    if (currentSimSpeed > 1) {
      currentSimSpeed = Math.max(1, currentSimSpeed / 2);
      showWarning('Simulation speed reduced automatically due to high Worker load');
    } else {
      showWarning('⚠ Worker response timeout; simulation precision may degrade');
    }
  }
}
```

### 4.4 Worker Catch-Up Budget (Hard Constraint)

The `targetSimTimeUs` delta pushed by the main thread cannot catch up infinitely per frame:

| Parameter | Default Value | Description |
|---|---|---|
| `MAX_CATCHUP_US_PER_FRAME` | `5_000` (5ms virtual time) | Main thread allows Worker to advance at most 5ms per frame |
| `WORKER_TIMEOUT_FRAMES` | `3` | Consecutive dropped frames throttle SimSpeed |
| `STEP_US` (Worker internal) | `1000n` (1ms) | At most 5 loop steps per catch-up frame |

```typescript
// Worker side (pseudocode)
function catchUpTo(targetUs: bigint) {
  const maxSteps = 5;
  let steps = 0;
  while (s_virtual_us < targetUs && steps < maxSteps) {
    advanceOneStep(STEP_US);
    steps++;
  }
  if (s_virtual_us < targetUs) {
    postMessage({ type: 'WORKER_LAG', behindUs: targetUs - s_virtual_us });
  }
}
```

### 4.5 Relationship with Existing Worker Timers

| Mode | Behavior |
|---|---|
| **Transition (Recommended W3b)** | Main thread rAF dispatches `setIdealInputs` + `targetSimTimeUs`; Worker **pauses** `setInterval` self-clocking and adopts passive catch-up |
| Legacy | Retains `setInterval` path; `VITE_WORKER_SELF_CLOCK=true` enables fallback |

### 4.6 Main Thread dt Clamping

```typescript
const MAX_DT = 1 / 30;  // Maximum 33ms
const FIXED_PHYSICS_DT = 1 / 60;  // Fixed 16.67ms physics step

function physicsStep(rawDt: number) {
  const clampedDt = Math.min(rawDt, MAX_DT);
  
  physicsAccumulator += clampedDt;
  while (physicsAccumulator >= FIXED_PHYSICS_DT) {
    physics.step(FIXED_PHYSICS_DT);
    physicsAccumulator -= FIXED_PHYSICS_DT;
    simTimeUs += BigInt(Math.round(FIXED_PHYSICS_DT * 1_000_000));
  }
  
  const alpha = physicsAccumulator / FIXED_PHYSICS_DT;
  physics.syncToThreeJS(meshRegistry, alpha);
}
```

---

## 5. ActuatorMirror

### 5.1 Responsibilities

Maps raw `ActuatorOutputBatch` (GPIO/PWM values) into 3D physics forces:

```typescript
// components/world/ActuatorMirror.ts

export class ActuatorMirror {
  constructor(
    private manifest: EmbeddedProjectManifest,
    private physics: PhysicsWorld,
  ) {}
  
  applyOutputs(outputs: ActuatorOutputBatch) {
    const bindings = this.manifest.bindings?.actuators ?? [];
    
    for (const binding of bindings) {
      const pinKey = this.resolvePinNumber(binding.pin);
      
      switch (binding.mapping.type) {
        case 'pwm_to_angular_velocity': {
          const duty = outputs.pwm[pinKey] ?? 0;
          const mapping = binding.mapping as PwmToAngularVelocity;
          
          // Deadband handling
          const effectiveDuty = duty < mapping.deadband ? 0 : duty;
          const targetRpm = effectiveDuty * mapping.maxRpm * (mapping.invert ? -1 : 1);
          const targetRadPerSec = (targetRpm / 60) * 2 * Math.PI;
          
          // Apply joint motor target velocity; motorMaxTorque comes from MechanicalJoint (W2 §2.5 SSOT)
          const joint = this.manifest.mechanical?.joints.find(
            j => j.jointId === binding.mechanicalJointId,
          );
          const maxTorque = joint?.motorMaxTorque ?? 0.5;

          this.physics.setJointMotorVelocity(
            binding.mechanicalJointId, 
            targetRadPerSec,
            maxTorque,
          );
          break;
        }
        
        case 'gpio_to_binary_state': {
          const level = outputs.gpio[pinKey] ?? false;
          const mapping = binding.mapping as GpioToBinaryState;
          const active = mapping.activeHigh ? level : !level;
          this.physics.setJointLocked(binding.mechanicalJointId, !active);
          break;
        }
        
        case 'pwm_to_brightness': {
          const duty = outputs.pwm[pinKey] ?? 0;
          const mapping = binding.mapping as PwmToBrightness;
          this.updateLightIntensity(binding.mechanicalJointId, duty, mapping);
          break;
        }
      }
    }
  }
}
```

### 5.2 Visual Feedback (Circuit Canvas Side)

| PWM State | Circuit View Feedback |
|---|---|
| duty = 0 | Pin/wire gray |
| 0 < duty < 1 | Pin pulse animation (frequency proportional to duty) |
| duty = 1 | Pin/wire continuously highlighted |

### 5.3 Differential Drive Kinematics (M3 Acceptance Scope)

Dual `pwm_to_angular_velocity` bindings drive the chassis rigid body via differential kinematics:

```text
v = (v_left + v_right) / 2
ω = (v_right - v_left) / trackWidth
```

| Milestone | Acceptance |
|---|---|
| **M3 Minimal** | Both wheels rotate per PWM duty (translational motion optional) |
| **M3 Recommended** | Chassis advances/turns per differential speed (`trackWidth` default 0.12m) |

---

## 6. Worker Protocol Extensions

### 6.1 New Commands

```typescript
// Added to SimulationCommand union
| { type: 'setIdealInputs'; inputs: IdealInputBatch }
```

### 6.2 New Events

```typescript
// Added to SimulationEvent union
| { type: 'actuatorOutput'; outputs: ActuatorOutputBatch }

interface ActuatorOutputBatch {
  simTimeUs: bigint;
  gpio: Record<number, boolean>;  // pin -> level
  pwm: Record<number, number>;   // pin -> duty 0..1
}
```

### 6.3 Protocol Version Handshake

```typescript
// Worker startup handshake
worker.postMessage({ type: 'HANDSHAKE', protocolVersion: 2 });

// Worker response
// { type: 'HANDSHAKE_ACK', supportedVersions: [1, 2] }
```

---

## 7. Frame Budget Monitoring

```typescript
// components/world/perf-monitor.ts

export class FrameBudgetMonitor {
  private frameTimes: number[] = [];
  private readonly WINDOW = 60;  // 60-frame sliding window
  
  markFrameStart() { this.frameStart = performance.now(); }
  
  markPhase(name: 'render' | 'physics' | 'envState' | 'postMessage' | 'vueUpdate') {
    // Records stage timing
  }
  
  markFrameEnd() {
    const total = performance.now() - this.frameStart;
    this.frameTimes.push(total);
    if (this.frameTimes.length > this.WINDOW) this.frameTimes.shift();
    
    if (total > 16) {
      this.overBudgetCount++;
      if (this.overBudgetCount > 10) {
        this.emit('budgetExceeded', { avgMs: this.average, worst: this.worst });
      }
    }
  }
  
  get average() { return this.frameTimes.reduce((a,b) => a+b, 0) / this.frameTimes.length; }
  get worst() { return Math.max(...this.frameTimes); }
}
```

---

## 8. Updated Simulation Loop

```typescript
function startSimulationLoop() {
  const clock = new THREE.Clock();
  const perfMonitor = new FrameBudgetMonitor();
  
  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    if (document.hidden) return;
    
    perfMonitor.markFrameStart();
    
    const rawDt = clock.getDelta();
    
    if (isSimulationRunning.value) {
      // 1. Apply actuator outputs from previous frame
      perfMonitor.markPhase('actuator');
      if (pendingActuatorOutput) {
        actuatorMirror.applyOutputs(pendingActuatorOutput);
        pendingActuatorOutput = null;
      }
      
      // 2. Physics step (fixed timestep + accumulator)
      perfMonitor.markPhase('physics');
      physicsStep(rawDt);
      
      // 3. Sync physics -> Three.js
      physics.syncToThreeJS(meshRegistry);
    }
    
    // 5. Render
    perfMonitor.markPhase('render');
    controls.update();
    renderer.render(scene, camera);
    
    perfMonitor.markFrameEnd();
  }
  
  animate();
}
```

---

## 9. Acceptance Criteria

| # | Acceptance Item | Validation Method |
|---|---|---|
| A1 | Rapier WASM loads properly (or falls back to kinematic mode) | Console logs |
| A2 | Chassis falls under gravity and rests stationary on ground | Visual |
| A3 | Wheels rotate around revolute joints | Visual |
| A4 | Wall static colliders block chassis motion | Visual |
| A5 | PWM duty = 0.5 $\rightarrow$ wheels turn at half speed | Manual + Debug |
| A6 | PWM duty = 0 $\rightarrow$ wheels halt | Manual |
| A7 | SimTime increments monotonically; Main vs Worker delta < 2 frames | Log comparisons |
| A8 | Worker timeout $> 3$ frames $\rightarrow$ auto speed reduction + warning | High load simulation |
| A9 | Frame budget monitor reports breakdown across phases | Chrome DevTools |
| A10 | Total main thread frame time < 16ms (within 50 rigid bodies) | Performance |
| A11 | Worker single frame catch-up $\le 5$ steps; timeouts throttle speed | Logs + Manual |

---

## 10. WASM Module Instantiation Imports Contract & Interrupt Queues (Gap 8 & Gap 1)

### 10.1 WasmImports Contract (Gap 8)

Declared in `../../../../../wink-ai/packages/unisim/src/unisim/types/`:

```typescript
/** Imports contract host JS must provide when instantiating WASM sandbox */
export interface WasmImports {
  env: {
    // --- Async yielding points (Asyncify) ---
    js_pal_os_sleep_ms: (ms: number) => Promise<void>;
    js_pal_os_busy_wait_us: (us: number) => Promise<void>;

    // --- Synchronous System Clocks ---
    js_pal_os_get_ms: () => bigint;
    js_pal_os_get_us: () => bigint;

    // --- PAL HAL Virtual IO R/W ---
    js_pal_gpio_write: (pin: number, level: boolean) => void;
    js_pal_gpio_read: (pin: number) => boolean;
    js_pal_pwm_set_duty: (channel: number, duty: number) => void;
    
    // --- Virtual I2C Bus Transfer (Bypass, Gap 2) ---
    js_pal_i2c_transfer: (
      port: number,
      addr: number,
      writeBufPtr: number,
      writeLen: number,
      readBufPtr: number,
      readLen: number
    ) => boolean;

    // --- Interrupt Control Poll API (Gap 1) ---
    js_pal_register_interrupt: (pin: number, callbackIndex: number, argPtr: number) => void;
    js_pal_deregister_interrupt: (pin: number) => void;
    js_pal_poll_interrupt: (outCallbackIndexPtr: number, outArgPtr: number) => boolean;

    // --- DAL Direct Pass-through ---
    js_sim_trigger_ultrasonic: (trigPin: number) => void;
    js_sim_measure_echo_pulse_us: (trigPin: number) => number;
  }
}
```

### 10.2 Interrupt Bridge Queue (Gap 1)

```typescript
/** Interrupt registration mapping info matching C-side Table index and memory offset */
export interface WasmInterruptInfo {
  callbackIndex: number;
  argPtr: number;
}

/** Interrupt queue state machine managing FIFO cache to prevent sleeping window reentrancy */
export interface WasmInterruptQueue {
  /** pin -> Interrupt routing info map */
  registry: Map<number, WasmInterruptInfo>;
  /** FIFO queue with capacity governed by PAL_WASM_INTERRUPT_QUEUE_SIZE */
  pending: Array<WasmInterruptInfo>;
  maxPending: number;
}
```

---

## 11. Supplemental Acceptance Criteria

| # | Acceptance Item | Validation Method |
|---|---|---|
| A12 | WasmImports completely satisfies Emscripten imports without Undefined Symbol errors | Web Worker Startup Test |
| A13 | Interrupt signals from virtual button clicks dispatch via WasmInterruptQueue and trigger ISRs | Unit + Integration Tests |

---

*Document Revision History:*

- 2026-07-09: Initial creation.
- 2026-07-09: Review revisions—Task 3.0b spike, catch-up budget §4.4–4.5, differential kinematics §5.3.
- 2026-07-09: Readiness alignment—Host WasmImports contract (Gap 8) and WasmInterruptQueue (Gap 1).
- 2026-07-09: W2 review backport—§5.1 `motorMaxTorque` reads from `MechanicalJoint`.

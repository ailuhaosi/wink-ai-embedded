# W3c Sensors + Environment Bridge — Raycaster Distance & EnvStateManager

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
| Prerequisites | W3b Physics Engine + Actuators complete |
| Deliverables | EnvStateManager, Raycaster distance measurement, Distance slider migration, Noise visualization |
| Milestone | M4: Chassis advances $\rightarrow$ Encounters obstacle wall $\rightarrow$ Ultrasonic detects distance $\rightarrow$ Firmware halts motors $\rightarrow$ Vehicle stops |
| Upstream Refs | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §6–§7 |

---

## 1. Goals

1. Implement `EnvStateManager`: Compute ideal values for all sensor bindings each frame.
2. Implement Raycaster distance measurement: Cast rays from the ultrasonic sensor mount and return distance upon hitting environment colliders.
3. Migrate ultrasonic distance inputs from manual sliders to 3D automated detection (preserving override toggles).
4. Send batched ideal inputs into Wasm via Worker `setIdealInputs`.
5. Implement sensor noise visualization (ideal vs degraded comparison).
6. Complete end-to-end closed-loop validation of the obstacle avoidance car template.

> `setIdealInputs` / `IdealInputBatch` serves as Input Injection Channel ④ in the observation plane hierarchy ([ADR-0027](../../../decisions/unisim/0027-sim-observation-data-planes.md)), operating alongside the three output observation channels (①②③); ideal sensor inputs are not merged into `ActuatorObservation` (③).

---

## 1.1 Wasm Bridge Migration Reference Table (SSOT)

Migrates from Phase C architecture to binding-driven ideal inputs. **W3c implementation must strictly follow this table without skipping the dual-stack transition period.**

| Sensor / Actuator | Phase C API | W3c Target API | Migration Steps |
|---|---|---|---|
| HC-SR04 Distance | `setUltrasonicDistance(trig, echo, cm)` $\rightarrow$ Worker `ultrasonicDistances` Map $\rightarrow$ `ultrasonicEchoUs` | `setIdealInputs({ sensors: [{ bindingId, value, unit:'cm' }] })` | ① EnvState calculates distance ② Parallel writes to legacy API (1 week) ③ Legacy API takes precedence under `overrideIdealInputs` ④ Remove slider |
| Button GPIO | `setPinIdeal(pin, level)` | Maintained; merges into `idealBatch.virtualGpio` | Non-blocking for W3c |
| PWM Output (Read) | None | `actuatorOutput` event (W3b spike resolution) | Delivered in W3b |
| DHT Temperature | **Non-existent** | Implemented in W4; does not block W3c | See W4 §2 |

**Worker Internal Mapping** (`bindingId` $\rightarrow$ Physical Pin):

```typescript
// services/binding-pin-resolver.ts — interface defined in W2 §2.5; implemented in Worker in this phase
function resolveUltrasonicPins(manifest, bindingId): { trig: number; echo: number } | null;
```

When `setIdealInputs` receives `bind_radar_front: 32`, Worker invokes `resolveUltrasonicPins()` to write into `ultrasonicDistances` (key = echo pin) until a generic ideal sensor setter exists on the Wasm side. B-10 validation in W2 guarantees pins are resolvable prior to simulate.

---

## 1.2 Collider & Raycast Unification Strategy (Rapier $\leftrightarrow$ Three)

**Problem**: If W3b Rapier colliders and W3c Three.js `Raycaster` diverge in data sources, the vehicle may hit a wall while the sensor still reports `maxRange`.

**Decision: Rapier is the SSOT for colliders; Three rays execute via Rapier castRay**

| Layer | Responsibility |
|---|---|
| Rapier | All environmental/wall colliders; `PhysicsWorld.castRay(origin, dir, maxToi)` |
| Three.js | Rendering meshes only; linked via mesh `userData.rapierColliderHandle` |
| Three Raycaster | **Prohibited** for distance measurement semantics (reserved for UI click-picking) |

```typescript
// EnvStateManager.computeRaycastRange — pseudocode
const hit = physicsWorld.castRay(origin, direction, maxRangeM);
const distanceCm = hit ? hit.timeOfImpact * 100 : mapping.maxRangeCm;
```

Self-collision exclusion: Raycast filtering ignores `ProductGroup` rigid bodies, matching only `EnvironmentGroup` + ground colliders.

---

## 2. EnvStateManager

### 2.1 Responsibilities

`EnvStateManager` is the core calculation engine for the JS environmental domain, positioned between the 3D physics world and Worker Wasm:

```text
3D Physics World ──┐
                   ├──► EnvStateManager.tick() ──► IdealInputBatch ──► Worker
Environmental Fields─┘
```

### 2.2 Class Definition

```typescript
// components/world/EnvStateManager.ts

export interface IdealSensorValue {
  bindingId: string;
  value: number | boolean;
  unit: 'cm' | 'celsius' | 'percent' | 'bool' | 'lux';
  source: 'computed' | 'override';  // override = manual user input
}

export class EnvStateManager {
  private sensorValues: Map<string, IdealSensorValue> = new Map();
  private overrides: Map<string, number | boolean> = new Map();
  private raycastCache: Map<string, { value: number; frameAge: number }> = new Map();
  
  constructor(
    private manifest: EmbeddedProjectManifest,
    private physics: PhysicsWorld,
    private scene: THREE.Scene,
  ) {}
  
  /**
   * Invoked every frame to compute ideal values for all sensors
   * @param simTimeUs Current simulation time
   * @param frameCount Frame counter for raycast rate-limiting
   */
  tick(simTimeUs: bigint, frameCount: number): IdealInputBatch {
    const sensors: IdealSensorValue[] = [];
    
    for (const binding of this.manifest.bindings?.sensors ?? []) {
      let value: IdealSensorValue;
      
      // Check for manual override
      if (this.overrides.has(binding.bindingId)) {
        value = {
          bindingId: binding.bindingId,
          value: this.overrides.get(binding.bindingId)!,
          unit: this.getUnitForMapping(binding.mapping),
          source: 'override',
        };
      } else {
        value = this.computeSensorValue(binding, frameCount);
      }
      
      this.sensorValues.set(binding.bindingId, value);
      sensors.push(value);
    }
    
    return {
      simTimeUs,
      sensors: sensors.map(s => ({
        bindingId: s.bindingId,
        value: s.value,
        unit: s.unit,
      })),
    };
  }
  
  private computeSensorValue(binding: SensorBinding, frameCount: number): IdealSensorValue {
    switch (binding.mapping.type) {
      case 'raycast_range_cm':
        return this.computeRaycastRange(binding, frameCount);
      case 'temperature_field_sample':
        return this.computeTemperature(binding);
      case 'collision_contact_bool':
        return this.computeCollisionContact(binding);
      case 'light_intensity_sample':
        return this.computeLightIntensity(binding);
      default:
        return { bindingId: binding.bindingId, value: 0, unit: 'cm', source: 'computed' };
    }
  }
  
  // ─── Override Management ───
  
  setOverride(bindingId: string, value: number | boolean) {
    this.overrides.set(bindingId, value);
  }
  
  clearOverride(bindingId: string) {
    this.overrides.delete(bindingId);
  }
  
  clearAllOverrides() {
    this.overrides.clear();
  }
}
```

---

## 3. Raycaster Distance Measurement

### 3.1 Raycast Computation

```typescript
// Raycast implementation in EnvStateManager

private computeRaycastRange(binding: SensorBinding, frameCount: number): IdealSensorValue {
  const mapping = binding.mapping as RaycastRangeCm;
  const cacheKey = binding.bindingId;
  
  // Rate limiting optimization: inactive rays update every 2 frames
  const cached = this.raycastCache.get(cacheKey);
  if (cached && cached.frameAge < 2) {
    cached.frameAge++;
    return { bindingId: binding.bindingId, value: cached.value, unit: 'cm', source: 'computed' };
  }
  
  // Retrieve world coordinates of sensor mount point
  const mountPartId = binding.mechanicalPartId!;
  const mountBody = this.physics.getBody(mountPartId);
  if (!mountBody) {
    return { bindingId: binding.bindingId, value: mapping.maxRangeCm, unit: 'cm', source: 'computed' };
  }
  
  const mountPosition = mountBody.translation();
  const mountRotation = mountBody.rotation();
  
  // Compute ray origin and direction in world space
  const origin = new THREE.Vector3(
    mountPosition.x + mapping.rayOriginOffset.x,
    mountPosition.y + mapping.rayOriginOffset.y,
    mountPosition.z + mapping.rayOriginOffset.z,
  );
  
  const localDir = new THREE.Vector3(mapping.rayDirection.x, mapping.rayDirection.y, mapping.rayDirection.z);
  const quat = new THREE.Quaternion(mountRotation.x, mountRotation.y, mountRotation.z, mountRotation.w);
  const worldDir = localDir.clone().applyQuaternion(quat).normalize();
  
  // Cast ray — SSOT: Rapier castRay (§1.2), not Three Raycaster
  const hit = this.physics.castRay(origin, worldDir, mapping.maxRangeCm / 100);
  
  let distanceCm: number;
  if (hit) {
    distanceCm = Math.round(hit.timeOfImpact * 100);
  } else {
    distanceCm = mapping.maxRangeCm; // Miss = Maximum distance
  }
  
  // Update cache
  this.raycastCache.set(cacheKey, { value: distanceCm, frameAge: 0 });
  
  return { bindingId: binding.bindingId, value: distanceCm, unit: 'cm', source: 'computed' };
}
```

### 3.2 Raycast Visualization

```typescript
// Debug helper: Display ray in 3D scene
function updateRayHelper(scene: THREE.Scene, origin: THREE.Vector3, 
                         direction: THREE.Vector3, distance: number, hit: boolean) {
  const helper = scene.getObjectByName('_ray_helper') as THREE.ArrowHelper;
  
  if (!helper) {
    const arrow = new THREE.ArrowHelper(direction, origin, distance / 100, 
      hit ? 0x22d3ee : 0x64748b, 0.02, 0.01);
    arrow.name = '_ray_helper';
    scene.add(arrow);
  } else {
    helper.position.copy(origin);
    helper.setDirection(direction);
    helper.setLength(distance / 100);
    helper.setColor(new THREE.Color(hit ? 0x22d3ee : 0x64748b));
  }
  
  // Hit point marker
  if (hit) {
    const hitPoint = origin.clone().add(direction.clone().multiplyScalar(distance / 100));
    updateHitMarker(scene, hitPoint);
  }
}
```

### 3.3 Collider Interactions

Rays interact strictly with:
- `environment.props` colliders (walls, obstacles)
- Ground plane

Rays never collide with product parts (preventing self-intersections).

---

## 4. Distance Slider Migration

### 4.1 Migration Timeline

| Phase | Behavior |
|---|---|
| **Pre-W3c** | `VirtualUltrasonic.vue` manual slider $\rightarrow$ `setUltrasonicDistance()` |
| **Post-W3c** | 3D Raycaster auto-calculation $\rightarrow$ `EnvStateManager.tick()` $\rightarrow$ `setIdealInputs()` |
| **Transition** | Both coexist, governed by `overrideIdealInputs` toggle |

### 4.2 Override Debugging Toggle

```vue
<!-- Inside right-panel Bindings Tab -->
<template>
  <div v-for="sensor in sensorBindings" :key="sensor.bindingId" class="sensor-row">
    <span>{{ sensor.bindingId }}</span>
    <span class="value-display">
      <span class="ideal">{{ idealValue }}</span>
      <span v-if="isDegraded" class="degraded">→ {{ degradedValue }}</span>
    </span>
    
    <!-- Override Toggle -->
    <label class="override-toggle">
      <input type="checkbox" v-model="overrideEnabled" />
      Manual Override
    </label>
    <input 
      v-if="overrideEnabled" 
      type="range" 
      :min="0" :max="maxRange" 
      v-model="overrideValue"
      @input="envStateManager.setOverride(sensor.bindingId, overrideValue)"
    />
  </div>
</template>
```

### 4.3 VirtualUltrasonic Component Updates

```typescript
// Changes to VirtualUltrasonic.vue:
// Before: Manual slider adjusts distance
// After: Displays EnvStateManager computed distance (read-only), slider active only in override mode

interface UltrasonicDisplayProps {
  distance: number;           // From EnvStateManager
  isOverrideMode: boolean;
  maxRangeCm: number;
}
```

---

## 5. Sensor Noise Visualization

### 5.1 Ideal vs Degraded Comparison

In the 3D viewport, sensor readout bubbles display both ideal and degraded values:

```text
┌──────────────────────┐
│ 📡 Ultrasonic         │
│ ideal:  32.0 cm      │
│ degraded: 31.7 cm    │
│ noise: ±0.3 cm       │
├──────────────────────┤
│ ████████████░░░      │  ← Distance bar (Blue = ideal, Orange = degraded range)
└──────────────────────┘
```

### 5.2 Implementation

```typescript
// Overlay HTML labels in 3D using CSS2DRenderer
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

function createSensorLabel(bindingId: string, idealValue: number): CSS2DObject {
  const div = document.createElement('div');
  div.className = 'sensor-label';
  div.innerHTML = `
    <div class="sensor-name">${bindingId}</div>
    <div class="sensor-value">
      <span class="ideal">${idealValue.toFixed(1)} cm</span>
    </div>
  `;
  
  const label = new CSS2DObject(div);
  label.name = `_label_${bindingId}`;
  return label;
}

// Update label values per frame
function updateSensorLabels(envState: EnvStateManager, degradedValues?: Map<string, number>) {
  for (const [bindingId, ideal] of envState.getSensorValues()) {
    const label = scene.getObjectByName(`_label_${bindingId}`);
    if (!label) continue;
    
    const div = (label as CSS2DObject).element;
    const degraded = degradedValues?.get(bindingId);
    
    div.querySelector('.ideal')!.textContent = `${ideal.value} ${ideal.unit}`;
    if (degraded !== undefined) {
      div.querySelector('.degraded')!.textContent = `→ ${degraded.toFixed(1)} ${ideal.unit}`;
    }
  }
}
```

### 5.3 Causal Chain Degradation Steps

In the Causal Chain panel (W5), clicking `pal` steps inspects active degradation parameters in the right panel:

```text
[pal] +noise → 31.7cm, warmup OK
  ↳ Parameters: bounce_us=2000, adc_noise_v=0.01, warmup_us=50000
  ↳ Current State: warmup complete, PRNG seed=42
```

---

## 6. Complete Simulation Loop (W3c Version)

```typescript
function startSimulationLoop() {
  const clock = new THREE.Clock();
  
  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    if (document.hidden) return;
    
    const rawDt = clock.getDelta();
    
    if (isSimulationRunning.value) {
      // 1. Apply actuator outputs from previous frame
      if (pendingActuatorOutput) {
        actuatorMirror.applyOutputs(pendingActuatorOutput);
        pendingActuatorOutput = null;
      }
      
      // 2. Physics step
      physicsStep(rawDt);
      physics.syncToThreeJS(meshRegistry);
      
      // 3. Compute environmental ideal values
      const idealBatch = envStateManager.tick(simTimeUs, frameCount);
      
      // 4. Update ray helpers
      updateRayHelpers();
      
      // 5. Update sensor labels
      updateSensorLabels(envStateManager);
      
      // 6. Send ideal values to Worker
      simulationClient.sendIdealInputs(idealBatch);
      
      frameCount++;
    }
    
    // 7. Render
    controls.update();
    renderer.render(scene, camera);
    css2dRenderer.render(scene, camera);
  }
  
  animate();
}
```

---

## 7. Obstacle Avoidance Car Template End-to-End

### 7.1 `tpl_avoidance_car` Manifest Patch

```typescript
// components/world/templates/avoidance-car.ts

export const AVOIDANCE_CAR_TEMPLATE: Partial<EmbeddedProjectManifest> = {
  devices: [
    { componentId: 'esp32', modelId: 'esp32-devkit-v1' },
    { componentId: 'motor_driver', modelId: 'motor_driver_stub' },
    { componentId: 'front_radar', modelId: 'hc-sr04' },
  ],
  connections: [ /* PWM/TRIG/ECHO wiring */ ],
  mechanical: {
    parts: [
      { partId: 'chassis', modelId: 'diff_drive_chassis_v1', /* ... */ },
      { partId: 'wheel_left', modelId: 'drive_wheel_v1', parentPartId: 'chassis', /* ... */ },
      { partId: 'wheel_right', modelId: 'drive_wheel_v1', parentPartId: 'chassis', /* ... */ },
      { partId: 'mount_ultrasonic', modelId: 'ultrasonic_mount_v1', parentPartId: 'chassis', /* ... */ },
    ],
    joints: [
      { jointId: 'joint_wheel_left', type: 'revolute', parentPartId: 'chassis', childPartId: 'wheel_left', axis: {x:0,y:0,z:1} },
      { jointId: 'joint_wheel_right', type: 'revolute', parentPartId: 'chassis', childPartId: 'wheel_right', axis: {x:0,y:0,z:1} },
    ],
  },
  environment: {
    props: [
      { propId: 'wall_north', modelId: 'env_wall_segment', transform: { position: {x:0,y:0.15,z:1} }, physics: { static: true, collider: 'box' } },
      { propId: 'wall_south', modelId: 'env_wall_segment', transform: { position: {x:0,y:0.15,z:-1} }, physics: { static: true, collider: 'box' } },
      { propId: 'wall_east', modelId: 'env_wall_segment', transform: { position: {x:1,y:0.15,z:0}, rotation: {x:0,y:90,z:0} }, physics: { static: true, collider: 'box' } },
      { propId: 'wall_west', modelId: 'env_wall_segment', transform: { position: {x:-1,y:0.15,z:0}, rotation: {x:0,y:90,z:0} }, physics: { static: true, collider: 'box' } },
    ],
    fields: [
      { fieldId: 'ambient', type: 'uniform_temperature', valueC: 25 },
    ],
  },
  bindings: {
    actuators: [
      { bindingId: 'bind_motor_left', deviceComponentId: 'motor_driver', pin: 'PWM_LEFT', mechanicalJointId: 'joint_wheel_left', mapping: { type: 'pwm_to_angular_velocity', maxRpm: 200, deadband: 0.05, invert: false } },
      { bindingId: 'bind_motor_right', deviceComponentId: 'motor_driver', pin: 'PWM_RIGHT', mechanicalJointId: 'joint_wheel_right', mapping: { type: 'pwm_to_angular_velocity', maxRpm: 200, deadband: 0.05, invert: false } },
    ],
    sensors: [
      { bindingId: 'bind_radar_front', deviceComponentId: 'front_radar', mechanicalPartId: 'mount_ultrasonic', mapping: { type: 'raycast_range_cm', maxRangeCm: 400, rayOriginOffset: {x:0,y:0,z:0.02}, rayDirection: {x:1,y:0,z:0} } },
    ],
    displays: [],
  },
};
```

### 7.2 End-to-End Causal Chain

```text
[world]      Raycast hit wall_north @ 32cm
  → [env]    ideal_distance_cm = 32
  → [worker] setIdealInputs({ bind_radar_front: 32 })
  → [pal]    +noise → 31.7cm, warmup OK
  → [app]    if (distance < 40) { stop_motors(); }
  → [worker] actuatorOutput: PWM_LEFT=0, PWM_RIGHT=0
  → [mirror] ActuatorMirror → joint_wheel_left velocity=0
  → [world]  wheel_angular_vel = 0, chassis stops
```

---

## 8. Acceptance Criteria

| # | Acceptance Item | Validation Method |
|---|---|---|
| A1 | Ultrasonic ray emits correctly from mount, rotating with the chassis | Visual (Ray helper) |
| A2 | Raycast hitting wall returns accurate distance ($\pm 1\text{cm}$) | Log comparison |
| A3 | Raycast miss returns maxRangeCm | Remove obstacle wall |
| A4 | `EnvStateManager.tick()` takes $< 1\text{ms}$ per frame | Perf monitoring |
| A5 | Ideal distance dispatched to Worker via `setIdealInputs` | Logs |
| A6 | Firmware logic stops motors based on distance $\rightarrow$ Chassis halts in 3D | End-to-end demo |
| A7 | Override toggle switches cleanly between manual and automatic distance | Manual |
| A8 | VirtualUltrasonic component displays automatically computed distance (read-only) | Visual |
| A9 | Sensor labels display ideal vs degraded comparison | Visual |
| A10 | Complete closed-loop execution of obstacle avoidance car template | Full demo |

---

*Document Revision History:*

- 2026-07-09: Initial creation.
- 2026-07-09: Review revisions—§1.1 bridge migration table, §1.2 Rapier raycast SSOT, template ambient `valueC`.
- 2026-07-09: W2 review backport—§1.1 links to W2 §2.5 pin-resolver interface ownership.

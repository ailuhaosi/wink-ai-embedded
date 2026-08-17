# W4 Environment Interaction — Heat Source, Thermal Field & Template

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/03-dual-viewport-phased-design/06-phase-w4-environment-interaction.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Phase | W4 |
| Effort Estimate | ~1.5 days |
| Prerequisites | W3c Sensor Bridge complete |
| Deliverables | Heat source prop, Thermal field model, Runtime editing for environment props, EnvironmentInspector, `tpl_temp_alarm` |
| Milestone | M5: Drag heat source near sensor $\rightarrow$ DHT temperature rises $\rightarrow$ Firmware alarm triggers $\rightarrow$ LED illuminates |
| Upstream Refs | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §8.3, [00-master-plan.md](./00-master-plan.md) §10 |

---

## 1.1 Blocking: DHT Ideal Temperature Injection into Wasm (W4 Spike)

Phase C has **no** DHT temperature bridge. A spike must be completed before W4 coding, selecting one pathway from the table below:

| Option | Approach | Pros | Cons |
|---|---|---|---|
| **A (Recommended)** | Extend Worker: `dhtIdealTempC: Map<componentId, number>` + SimWorker injects PAL / DAL stub | Consistent with ultrasonic Map pattern | Requires Wasm-side read point |
| **B** | Add `js_sim_set_dht_temperature_c(componentKey, tempC)` import | Clear semantics | Requires modifying Emscripten glue |
| **C** | Temporarily simulate temperature via ADC voltage (Transition) | Zero Wasm modifications | Misleading to users; demo only |

**W4 Dataflow (Option A)**:

```text
EnvStateManager.computeTemperature(binding)
  → setIdealInputs({ sensors: [{ bindingId: 'bind_dht_temp', value: 52.3, unit: 'celsius' }] })
  → Worker: dhtIdealTempC.set(deviceComponentId, value)
  → SimWorker / PAL: Degradation (noise, warmup) → DAL dht_read()
```

**Acceptance**: App logic inside Wasm observes temperature changes when dragging the heat source (visible in logs, OLED, or trace).

---

## 1. Goals

1. Implement 3D rendering for heat sources (Emissive body + particle effects) + Transform Gizmo translation.
2. Implement distance attenuation thermal field model supporting multi-source superposition.
3. Support `temperature_field_sample` sensor bindings.
4. Allow environmental props to be **draggable/editable during simulate mode** (runtime scene tweaking).
5. Build the EnvironmentInspector panel.
6. Deliver end-to-end closed-loop execution of the `tpl_temp_alarm` temperature alarm template.

---

## 2. Heat Source Prop

### 2.1 3D Rendering

```typescript
// components/world/env-objects/HeatSource.ts

export function createHeatSourceMesh(prop: EnvironmentProp): THREE.Group {
  const group = new THREE.Group();
  group.name = prop.propId;
  group.userData = { propId: prop.propId, domain: 'environment' };
  
  // Core glowing sphere
  const coreGeometry = new THREE.SphereGeometry(0.05, 16, 16);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xff4400,
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 0.9,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  group.add(core);
  
  // Outer range ring (indicating thermal field radius)
  const radius = prop.properties?.falloffRadiusM ?? 1.5;
  const fieldGeometry = new THREE.RingGeometry(0, radius, 64);
  const fieldMaterial = new THREE.MeshBasicMaterial({
    color: 0xff4400,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
  });
  const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
  field.rotation.x = -Math.PI / 2;
  field.name = '_field_ring';
  group.add(field);
  
  // Point light (visual illumination)
  const light = new THREE.PointLight(0xff4400, 1, radius * 2);
  light.name = '_point_light';
  group.add(light);
  
  // Apply Transform
  const pos = prop.transform.position;
  group.position.set(pos.x, pos.y, pos.z);
  
  return group;
}
```

### 2.2 Particle Effects (Optional Enhancement)

```typescript
// Simple particle system simulating rising heat haze (50 particles, low overhead)
export function createHeatParticles(prop: EnvironmentProp): THREE.Points {
  const count = 50;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 0.1;
    positions[i * 3 + 1] = Math.random() * 0.3;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    velocities[i * 3 + 1] = 0.05 + Math.random() * 0.1;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  const material = new THREE.PointsMaterial({
    color: 0xff6600,
    size: 0.01,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
  });
  
  const points = new THREE.Points(geometry, material);
  points.name = '_particles';
  return points;
}

export function updateHeatParticles(points: THREE.Points, dt: number) {
  const positions = points.geometry.attributes.position.array as Float32Array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] += 0.05 * dt;
    if (positions[i + 1] > 0.5) {
      positions[i + 1] = 0;
    }
  }
  points.geometry.attributes.position.needsUpdate = true;
}
```

---

## 3. Thermal Field Model

### 3.1 Distance Attenuation Calculation

```typescript
// components/world/env-objects/TemperatureField.ts

export interface TemperatureResult {
  temperatureC: number;
  dominantSourceId: string | null;  // Nearest heat source
  distanceM: number;                // Distance to nearest heat source
}

export function sampleTemperature(
  sensorWorldPosition: THREE.Vector3,
  environment: EnvironmentSection,
): TemperatureResult {
  // 1. Retrieve ambient baseline temperature
  const ambientField = environment.fields.find(f => f.type === 'uniform_temperature');
  let temperature = ambientField?.valueC ?? 25;  // Default 25°C (SSOT: valueC)
  let closestSource: string | null = null;
  let closestDistance = Infinity;
  
  // 2. Superpose all point heat sources
  for (const prop of environment.props) {
    if (prop.modelId !== 'env_heat_source') continue;
    
    const coreTemp = (prop.properties?.coreTemperatureC as number) ?? 80;
    const falloffRadius = (prop.properties?.falloffRadiusM as number) ?? 1.5;
    
    const sourcePos = new THREE.Vector3(
      prop.transform.position.x,
      prop.transform.position.y,
      prop.transform.position.z
    );
    
    const distance = sensorWorldPosition.distanceTo(sourcePos);
    
    if (distance < closestDistance) {
      closestDistance = distance;
      closestSource = prop.propId;
    }
    
    if (distance < falloffRadius) {
      // Quadratic attenuation: T = ambient + (core - ambient) * (1 - d/R)^2
      const normalizedDist = distance / falloffRadius;
      const attenuation = Math.pow(1 - normalizedDist, 2);
      const contribution = (coreTemp - (ambientField?.valueC ?? 25)) * attenuation;
      temperature += contribution;
    }
  }
  
  return {
    temperatureC: Math.round(temperature * 10) / 10,  // Precision 0.1°C
    dominantSourceId: closestSource,
    distanceM: closestDistance,
  };
}
```

### 3.2 Multi-Source Superposition Rules

| Scenario | Behavior |
|---|---|
| Single Heat Source | Direct quadratic attenuation |
| Multiple Heat Sources | Contributions from each source **superposed** onto ambient baseline |
| Sensor Inside Heat Source | `temperature = coreTemp` (distance 0) |
| Sensor Outside All Radii | `temperature = ambient` |
| No Ambient Field | Defaults to $25^\circ\text{C}$ |

### 3.3 Thermal Field Visualization

```typescript
function createTemperatureContours(prop: EnvironmentProp): THREE.Group {
  const group = new THREE.Group();
  const coreTemp = (prop.properties?.coreTemperatureC as number) ?? 80;
  const radius = (prop.properties?.falloffRadiusM as number) ?? 1.5;
  
  // 40°C, 50°C, 60°C Isotherms
  const thresholds = [40, 50, 60];
  const ambient = 25;
  
  for (const threshold of thresholds) {
    const attenuation = (threshold - ambient) / (coreTemp - ambient);
    const contourRadius = radius * (1 - Math.sqrt(attenuation));
    
    const ring = new THREE.RingGeometry(contourRadius - 0.01, contourRadius + 0.01, 64);
    const material = new THREE.MeshBasicMaterial({
      color: temperatureToColor(threshold),
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ring, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.01;
    group.add(mesh);
  }
  
  return group;
}

function temperatureToColor(tempC: number): number {
  // 25°C -> Blue(0x3B82F6), 50°C -> Yellow(0xEAB308), 80°C -> Red(0xEF4444)
  const t = Math.max(0, Math.min(1, (tempC - 25) / 55));
  if (t < 0.5) {
    return lerpColor(0x3B82F6, 0xEAB308, t * 2);
  } else {
    return lerpColor(0xEAB308, 0xEF4444, (t - 0.5) * 2);
  }
}
```

---

## 4. Runtime Environment Prop Editing

### 4.1 Gizmo Dragging in Simulation Mode

Environmental props remain **draggable and editable in `simulate` and `diagnose` modes** (Upstream spec §5.3 permission matrix).

```typescript
// components/world/GizmoController.ts

export class GizmoController {
  private gizmo: TransformControls;
  
  constructor(camera: THREE.Camera, renderer: THREE.Renderer) {
    const { TransformControls } = await import('three/addons/controls/TransformControls.js');
    this.gizmo = new TransformControls(camera, renderer.domElement);
    this.gizmo.setMode('translate');
    this.gizmo.setSpace('world');
  }
  
  attachTo(object: THREE.Object3D, mode: 'translate' | 'rotate' | 'scale') {
    this.gizmo.attach(object);
    this.gizmo.setMode(mode);
  }
  
  detach() {
    this.gizmo.detach();
  }
  
  onDragEnd(object: THREE.Object3D) {
    const propId = object.userData.propId;
    if (propId) {
      projectStore.updateEnvironmentPropTransform(propId, {
        position: {
          x: object.position.x,
          y: object.position.y,
          z: object.position.z,
        },
      });
    }
  }
}
```

### 4.2 Dataflow

```text
User drags heat source Gizmo
  → Three.js object.position updates in real time
  → GizmoController.onDragEnd
  → projectStore.updateEnvironmentPropTransform(propId, newTransform)
  → Manifest.environment.props[i].transform updated
  → EnvStateManager.tick() calculates temperature using new position on next frame
  → Thermal ideal value changes
  → Worker receives updated setIdealInputs
  → App logic reacts to temperature mutation
```

---

## 5. EnvironmentInspector

### 5.1 Panel Layout

```text
┌─ Environment Inspector ─────────────────────────────────┐
│                                                          │
│ Selected: fire_01 (Heat Source)                         │
│                                                          │
│ Transform                                         [Reset]│
│   Position: X [1.20] Y [0.00] Z [0.50]                  │
│   Rotation: X [0]    Y [0]    Z [0]                      │
│                                                          │
│ Properties                                               │
│   Core Temperature: [80] °C          ◄────────► [slider] │
│   Falloff Radius:   [1.5] m         ◄────────► [slider] │
│                                                          │
│ Sensor Impact                                            │
│   bind_dht_temp: 52.3°C (distance: 0.8m)               │
│   ████████████████████░░░░  52.3/80°C                   │
│                                                          │
│ Fields                                                   │
│   ambient: uniform_temperature = 25°C           [Edit]   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 5.2 Real-time Property Feedback

When editing `coreTemperatureC` or `falloffRadiusM`:
- 3D thermal contour rings update in **real time** (debounced at 100ms).
- Sensor readout labels reflect temperature changes immediately.
- Parameter adjustment events logged to the bottom Trace console.

---

## 6. Thermal Alarm Starter Template

### 6.1 `tpl_temp_alarm` Manifest Patch

```typescript
export const TEMP_ALARM_TEMPLATE: Partial<EmbeddedProjectManifest> = {
  devices: [
    { componentId: 'esp32', modelId: 'esp32-devkit-v1' },
    { componentId: 'env_sensor', modelId: 'dht22_stub' },
    { componentId: 'alarm_led', modelId: 'led' },
    { componentId: 'buzzer', modelId: 'buzzer_stub' },
  ],
  connections: [ /* ... */ ],
  mechanical: {
    parts: [
      { partId: 'sensor_box', modelId: 'sensor_enclosure_v1',
        transform: { position: { x: 0, y: 0.03, z: 0 } },
        physics: { massKg: 0.1, collider: 'box', static: true } },
      { partId: 'led_window', modelId: 'sensor_enclosure_v1',
        transform: { position: { x: 0.03, y: 0.06, z: 0 } },
        physics: { collider: 'none' } },
    ],
    joints: [],
  },
  environment: {
    props: [
      { propId: 'fire_01', modelId: 'env_heat_source',
        transform: { position: { x: 1.2, y: 0, z: 0.5 } },
        properties: { coreTemperatureC: 80, falloffRadiusM: 1.5 } },
    ],
    fields: [
      { fieldId: 'ambient', type: 'uniform_temperature', valueC: 25 },
    ],
  },
  bindings: {
    actuators: [
      { bindingId: 'bind_led', deviceComponentId: 'alarm_led', pin: 'GPIO_LED',
        mechanicalPartId: 'led_window',
        mapping: { type: 'gpio_to_emissive', activeHigh: true, emissiveColor: 0xff0000 } },
      { bindingId: 'bind_buzzer', deviceComponentId: 'buzzer', pin: 'GPIO_BUZZER',
        mapping: { type: 'gpio_to_binary_state', activeHigh: true } },
    ],
    sensors: [
      { bindingId: 'bind_dht_temp', deviceComponentId: 'env_sensor',
        mechanicalPartId: 'sensor_box',
        environmentPropId: 'fire_01',
        mapping: { type: 'temperature_field_sample', fallbackAmbientFieldId: 'ambient' } },
    ],
    displays: [],
  },
};
```

> LED binding uses `gpio_to_emissive` + `mechanicalPartId` (see W2 B-07); empty `mechanicalJointId` is prohibited.

### 6.2 End-to-End Causal Chain

```text
[world]          fire_01 at position (0.6, 0, 0.3) — 0.7m distance to sensor_box
  → [env]        sampleTemperature = 52.3°C (attenuation model)
  → [worker]     setIdealInputs({ bind_dht_temp: 52.3 })
  → [pal]        +noise → 52.1°C, warmup OK
  → [app]        if (temp > 50) { trigger_alarm(); set_led(HIGH); }
  → [worker]     actuatorOutput: GPIO_LED=HIGH, BUZZER=HIGH
  → [mirror]     LED brightness → 3D indicator lamp glows
  → [world]      led_window emissive intensity increases
```

---

## 7. Acceptance Criteria

| # | Acceptance Item | Validation Method |
|---|---|---|
| A1 | Heat source 3D rendering nominal (Glowing sphere + glow halo + field ring) | Visual |
| A2 | Transform Gizmo drags heat source position | Manual |
| A3 | Dragging heat source closer to sensor raises temperature in real time | Manual + Label display |
| A4 | Dragging heat source away drops temperature to ambient | Manual |
| A5 | Multi-source thermal superposition calculates correctly | Vitest |
| A6 | EnvironmentInspector edits to temperature/radius reflect in real time | Manual |
| A7 | Thermal alarm template executes end-to-end closed loop (Fire $\rightarrow$ Alarm $\rightarrow$ LED) | Full demo |
| A8 | Environmental props remain draggable during simulate mode | Manual |
| A9 | Thermal contour rings update with parameter adjustments | Visual |
| A10 | Environmental prop position edits persist to Manifest | Inspect JSON |

---

*Document Revision History:*

- 2026-07-09: Initial creation.
- 2026-07-09: Review revisions—§1.1 DHT Wasm spike, valueC thermal field, `tpl_temp_alarm` binding fixes.

# W2 Binding Model — Manifest V2 + Binding Validation + Asset Library

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/03-dual-viewport-phased-design/02-phase-w2-binding-model.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Phase | W2 |
| Effort Estimate | ~2.5–3 days (Includes B-09/10 + pin-resolver unit tests) |
| Prerequisites | W1 Layout Skeleton complete |
| Deliverables | Manifest V2 types, Binding validation engine (B-01~B-10), `binding-pin-resolver` interface, Device Catalog `worldCoupling` metadata, BindingsInspector, LayeredAssetLibrary |
| Milestone | M1: Configure ultrasonic raycast binding $\rightarrow$ Missing binding blocks simulate $\rightarrow$ Completing binding unblocks simulate |
| Upstream Refs | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §8, [00-master-plan.md](./00-master-plan.md) §10 Field Alignment Table |

---

## 0. Field Naming Discipline

TypeScript code **must strictly use** formal field names from Master Plan §10:

- `devices[].componentId` (not `id`)
- `name` (not `projectName`)
- `environment.fields[].valueC` (not `intensity`)

`migrateManifest()` normalizes historical draft aliases; newly written code must never generate aliases.

---

## 1. Goals

1. Define TypeScript types for Manifest `schemaVersion: 2` (`mechanical` / `environment` / `bindings`).
2. Implement the binding validation engine (**B-01 ~ B-10**) governing design $\rightarrow$ simulate transitions (mode-aware + Catalog `worldCoupling`).
3. Define the **`binding-pin-resolver` interface** (W2 contract + unit tests; W3c implements Worker writes).
4. Build the BindingsInspector panel: circuit-mechanical-environment mapping table + read-only resolved pin display + auto-suggestions.
5. Define the **mapping type registry**, supporting future extensions.
6. Upgrade the left panel to an Accordion layered asset library (search/tag filters can be deferred to P1).
7. Register stub devices and `simulation.worldCoupling` metadata in Device Catalog (supporting B-06/B-09).

---

## 2. Manifest V2 Type Definitions

### 2.1 Core Types

```typescript
// types/manifest-v2.ts
// ConnectionRouting is imported from W1 types/circuit-routing.ts, not redefined here.
// LogicSection / SimulationSection reuse 02-project-manifest-schema.md §7/§simulation subsets, referenced as types in W2.

import type { ConnectionRouting } from '@/types/circuit-routing';

/** Aligned with 02-project-manifest-schema.md §7 logic subset */
export interface LogicSection {
  sourceType?: 'dsl' | 'c';
  dslPath?: string;
  generatedCPath?: string;
}

/** Aligned with upstream §8.6 simulation extension */
export interface SimulationSection {
  worldStepHz?: number;
  physicsBackend?: 'rapier' | 'none';
  deterministicSeed?: number;
  overrideIdealInputs?: boolean;
  faultScenarios?: unknown[];
  workerLimits?: Record<string, unknown>;
}

export interface EmbeddedProjectManifest {
  schemaVersion: 1 | 2;
  id: string;                         // Corresponds to project UUID in sim-project.json
  name: string;
  target: { boardId: string; targetArch?: string };
  devices: DeviceEntry[];
  connections: ConnectionEntry[];
  
  // V2 Added Sections
  mechanical?: MechanicalSection;
  environment?: EnvironmentSection;
  bindings?: BindingsSection;
  
  logic?: LogicSection;
  simulation?: SimulationSection;
}

/** Pin-level power configuration parameters (maps to C-side wasm_pin_power_model_t, Gap 4) */
export interface PinPowerModel {
  /** Active drive current (uA) */
  activeCurrentUa: number;
  /** Static leakage current (uA) */
  leakageCurrentUa: number;
  /** Transition energy per toggle (nJ) */
  transitionEnergyNj: number;
}

export interface DeviceEntry {
  componentId: string;                // SSOT: Aligned with 02-project-manifest-schema
  modelId: string;
  displayName?: string;
  position?: { x: number; y: number };
  rotation?: number;
  properties?: Record<string, unknown> & {
    powerModel?: Record<string, PinPowerModel>; // pinName -> Power model
  };
}

/** Persistence format (aligned with 02-project-manifest-schema.md §6) */
export interface ConnectionPinRef {
  componentId: string;
  pin: string;
}

export interface ConnectionEntry {
  id: string;
  /**
   * Canvas runtime uses "componentId:pinName" string (W1 CircuitCanvas contract);
   * Serialized to ConnectionPinRef object via normalizeConnectionForPersist() when saving.
   */
  from: string | ConnectionPinRef;
  to: string | ConnectionPinRef;
  color?: string;
  signalType?: string;
  routing: ConnectionRouting;
}

// ─── Mechanical ───────────────────────────────────────────────

export interface MechanicalSection {
  parts: MechanicalPart[];
  joints: MechanicalJoint[];
}

export interface MechanicalPart {
  partId: string;
  modelId: string;                  // Corresponds to built-in model library ID
  displayName: string;
  parentPartId?: string;            // Assembly tree parent node
  transform: Transform3D;
  physics: PhysicsProperties;
}

export interface MechanicalJoint {
  jointId: string;
  type: 'revolute' | 'prismatic' | 'fixed' | 'spherical';
  parentPartId: string;
  childPartId: string;
  axis: Vector3;
  limits?: { minRad: number | null; maxRad: number | null };
  motorMaxTorque?: number;
}

export interface Transform3D {
  position: Vector3;
  rotation?: Vector3;    // Euler angles (degrees)
  scale?: Vector3;       // default {1,1,1}
}

export interface Vector3 { x: number; y: number; z: number; }

export interface PhysicsProperties {
  massKg?: number;       // default 0.1
  friction?: number;     // default 0.5
  restitution?: number;  // default 0.3
  collider: 'box' | 'cylinder' | 'sphere' | 'convex' | 'none';
  static?: boolean;      // Environmental props can be static
}

// ─── Environment ──────────────────────────────────────────────

export interface EnvironmentSection {
  props: EnvironmentProp[];
  fields: EnvironmentField[];
}

export interface EnvironmentProp {
  propId: string;
  modelId: string;
  displayName?: string;
  transform: Transform3D;
  physics?: PhysicsProperties;
  properties?: Record<string, number | string | boolean>;
}

export interface EnvironmentField {
  fieldId: string;
  type: FieldType;
  valueC: number;              // Environmental temperature (°C); SSOT field name
  region?: FieldRegion;
  falloff?: 'linear' | 'quadratic' | 'none';
  falloffRadiusM?: number;
}

export type FieldType = 
  | 'uniform_temperature'    // Global ambient temperature
  | 'point_temperature'      // Point heat source attenuation field
  | 'uniform_light'          // Global ambient light
  | 'directional_light'      // Directional light
  | 'gravity';               // Gravity vector/magnitude

export type FieldRegion = 
  | { type: 'global' }
  | { type: 'sphere'; center: Vector3; radius: number }
  | { type: 'cone'; apex: Vector3; direction: Vector3; halfAngleDeg: number; length: number };

// ─── Bindings ─────────────────────────────────────────────────

export interface BindingsSection {
  actuators: ActuatorBinding[];
  sensors: SensorBinding[];
  displays: DisplayBinding[];
}

export interface ActuatorBinding {
  bindingId: string;
  deviceComponentId: string;           // -> devices[].componentId
  pin: string;
  mechanicalJointId?: string;          // Actuator: Joint drive (pwm_to_angular_velocity, etc.)
  mechanicalPartId?: string;           // Actuator: Part level (pwm_to_brightness / gpio_to_emissive, etc.)
  mapping: ActuatorMapping;
}

export interface SensorBinding {
  bindingId: string;
  deviceComponentId: string;           // -> devices[].componentId
  mechanicalPartId?: string;           // -> mechanical.parts[].partId
  environmentPropId?: string;          // -> environment.props[].propId
  mapping: SensorMapping;
  // Note: Sensors have no binding.pin field; physical pins (TRIG/ECHO) resolve via connections + binding-pin-resolver (§2.5)
}

export interface DisplayBinding {
  bindingId: string;
  deviceComponentId: string;
  mechanicalPartId?: string;
  mapping: DisplayMapping;
}
```

### 2.2 Mapping Type Registry

```typescript
// types/mapping-registry.ts

// ─── Actuator Mappings ────────────────────────────────────────

export type ActuatorMapping = 
  | PwmToAngularVelocity
  | PwmToLinearPosition
  | GpioToBinaryState
  | PwmToBrightness
  | GpioToEmissive;                    // LED/Indicator: Binds to mechanicalPartId, not joint

export interface GpioToEmissive {
  type: 'gpio_to_emissive';
  activeHigh: boolean;
  emissiveColor?: number;             // 0xRRGGBB
}

export interface PwmToAngularVelocity {
  type: 'pwm_to_angular_velocity';
  maxRpm: number;
  deadband: number;       // 0-1, below this duty cycle treated as 0
  invert: boolean;
}

export interface PwmToLinearPosition {
  type: 'pwm_to_linear_position';
  minAngleDeg: number;    // Servo minimum angle
  maxAngleDeg: number;    // Servo maximum angle
  pulseMsRange: [number, number]; // [1.0, 2.0] standard servo
}

export interface GpioToBinaryState {
  type: 'gpio_to_binary_state';
  activeHigh: boolean;
  description?: string;   // e.g. "Relay" / "Solenoid"
}

export interface PwmToBrightness {
  type: 'pwm_to_brightness';
  maxLumens: number;
  curve: 'linear' | 'gamma22'; // gamma 2.2 aligns with human eye perception
}

// ─── Sensor Mappings ──────────────────────────────────────────

export type SensorMapping = 
  | RaycastRangeCm
  | TemperatureFieldSample
  | CollisionContactBool
  | LightIntensitySample
  | AngularPositionToEncoder;

export interface RaycastRangeCm {
  type: 'raycast_range_cm';
  maxRangeCm: number;
  rayOriginOffset: Vector3;
  rayDirection: Vector3;
  beamWidthDeg?: number;  // Optional: ultrasonic dispersion cone angle
}

export interface TemperatureFieldSample {
  type: 'temperature_field_sample';
  fallbackAmbientFieldId: string;
  samplingOffsetM?: Vector3; // Sensor sampling offset relative to part
}

export interface CollisionContactBool {
  type: 'collision_contact_bool';
  contactGroupMask?: number;  // Collision group mask
}

export interface LightIntensitySample {
  type: 'light_intensity_sample';
  sensitivityRange: [number, number]; // [minLux, maxLux]
  direction?: Vector3;    // Photosensitive direction
}

export interface AngularPositionToEncoder {
  type: 'angular_position_to_encoder';
  pulsesPerRevolution: number;
  /** SSOT: Joint reference resides in mapping only; binding.mechanicalPartId is invalid for this type */
  jointId: string;
}

// ─── Display Mappings ─────────────────────────────────────────

export type DisplayMapping = 
  | FramebufferTexture;

export interface FramebufferTexture {
  type: 'framebuffer_texture';
  resolution?: { width: number; height: number };
}
```

### 2.3 Schema Migration

```typescript
// services/manifest-migration.ts

export function migrateManifest(raw: unknown): EmbeddedProjectManifest {
  const obj = raw as Record<string, unknown>;
  
  // Version detection
  const version = (obj.schemaVersion as number) ?? 1;
  
  if (version === 1) {
    return {
      ...obj,
      schemaVersion: 2,
      mechanical: { parts: [], joints: [] },
      environment: { props: [], fields: [] },
      bindings: { actuators: [], sensors: [], displays: [] },
    } as EmbeddedProjectManifest;
  }
  
  if (version === 2) {
    // Fault tolerance: Missing sections treated as empty arrays
    const merged = {
      ...obj,
      mechanical: obj.mechanical ?? { parts: [], joints: [] },
      environment: obj.environment ?? { props: [], fields: [] },
      bindings: obj.bindings ?? { actuators: [], sensors: [], displays: [] },
    } as EmbeddedProjectManifest;
    // Historical draft aliases: fields[].intensity -> valueC
    for (const f of merged.environment?.fields ?? []) {
      const raw = f as EnvironmentField & { intensity?: number };
      if (raw.valueC === undefined && raw.intensity !== undefined) {
        raw.valueC = raw.intensity;
      }
    }
    return merged;
  }
  
  throw new Error(`Unknown manifest schemaVersion: ${version}. Please upgrade your Wink-AI.`);
}
```

> **`PinPowerModel`**: W2 lays type foundations only (aligning with Master Plan ABI Gap #4); Inspector UI editing is deferred to W5 diagnostics.

### 2.4 Connection Format Normalization

Canvas (W1 `CircuitCanvas`) and persistence (`02-project-manifest-schema.md` §6) use two representations for `from`/`to`. W2 provides a normalization layer, **forbidding** manual dual-format branches in business logic:

```typescript
// services/connection-normalize.ts

export function formatPinRef(ref: ConnectionPinRef): string {
  return `${ref.componentId}:${ref.pin}`;
}

export function parsePinRef(s: string): ConnectionPinRef {
  const idx = s.lastIndexOf(':');
  if (idx <= 0) throw new Error(`Invalid pin ref: ${s}`);
  return { componentId: s.slice(0, idx), pin: s.slice(idx + 1) };
}

/** Load wink-project.json -> Canvas string format */
export function normalizeConnectionForCanvas(entry: ConnectionEntry): ConnectionEntry {
  return {
    ...entry,
    from: typeof entry.from === 'string' ? entry.from : formatPinRef(entry.from),
    to: typeof entry.to === 'string' ? entry.to : formatPinRef(entry.to),
  };
}

/** Save canvas state -> Schema §6 object format */
export function normalizeConnectionForPersist(entry: ConnectionEntry): ConnectionEntry {
  return {
    ...entry,
    from: typeof entry.from === 'string' ? parsePinRef(entry.from) : entry.from,
    to: typeof entry.to === 'string' ? parsePinRef(entry.to) : entry.to,
  };
}
```

### 2.5 Pin Resolver Contract (binding-pin-resolver)

**Asymmetric Design** (Data foundation for obstacle avoidance loop):

| Binding Type | Pin Representation in Manifest | Physical GPIO Source |
|---|---|---|
| `ActuatorBinding` | `pin: "PWM_LEFT"` (Device logical pin name) | `connections` + Board Model $\rightarrow$ Board pin number |
| `SensorBinding` | **No `pin` field** | `connections` reverse lookup for TRIG/ECHO (Device Model `pins[]`) |

W2 defines interface and Vitest tests; W3c implements Worker `setIdealInputs` injection (see [05-phase-w3c-sensors-env-bridge.md](./05-phase-w3c-sensors-env-bridge.md) §1.1).

```typescript
// services/binding-pin-resolver.ts

export interface ResolvedActuatorPin {
  deviceComponentId: string;
  logicalPin: string;       // binding.pin, e.g. "PWM_LEFT"
  boardPinNumber: number;   // Resolved via connections + board model
}

export interface ResolvedUltrasonicPins {
  trigPin: number;
  echoPin: number;
}

export interface BindingPinResolver {
  resolveActuatorPin(
    manifest: EmbeddedProjectManifest,
    binding: ActuatorBinding,
  ): ResolvedActuatorPin | null;

  resolveUltrasonicPins(
    manifest: EmbeddedProjectManifest,
    bindingId: string,
  ): ResolvedUltrasonicPins | null;

  /** General sensor pin resolver; keys are Device Model pin names (e.g. TRIG, ECHO) */
  resolveSensorPins(
    manifest: EmbeddedProjectManifest,
    binding: SensorBinding,
  ): Record<string, number> | null;
}
```

**Torque Limit SSOT**: `motorMaxTorque` belongs to `MechanicalJoint` (§2.1), **not** in `PwmToAngularVelocity` mapping. W3b `ActuatorMirror` reads from joint (see [04-phase-w3b-physics-actuators.md](./04-phase-w3b-physics-actuators.md) §5.1).

---

## 3. Binding Validation Engine

### 3.1 Rule Definitions

```typescript
// services/binding-validation.service.ts

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationContext {
  /** Current or target workbench mode; influences B-04/B-09 severity */
  targetMode: 'design' | 'simulate' | 'diagnose';
  /** True during simulate transition: returns blocking results only */
  blockingOnly?: boolean;
  featureFlags?: { manifestSchemaV2: boolean };
}

export interface ValidationResult {
  ruleId: string;
  severity: Severity;
  message: string;
  bindingId?: string;
  componentId?: string;   // Device-level results (B-09, etc.)
  fix?: string;
}

export function validateBindings(
  manifest: EmbeddedProjectManifest,
  context: ValidationContext,
  deps: {
    catalog: DeviceCatalog;
    pinResolver: BindingPinResolver;
  },
): ValidationResult[] { /* ... */ }

/** simulate gate: error is always blocking; warning in design does not block mode switch */
export function isBlockingResult(r: ValidationResult, context: ValidationContext): boolean {
  if (r.severity === 'error') return true;
  if (context.targetMode === 'simulate' && r.severity === 'warning') {
    return ['B-04', 'B-09'].includes(r.ruleId);
  }
  return false;
}
```

### 3.2 Validation Rules Matrix

| Rule ID | Check | Severity | Implementation Detail |
|---|---|---|---|
| **B-01** | `deviceComponentId` must exist in `devices` | Error | Scans devices list for matching IDs |
| **B-02** | `mechanicalJointId` / `mechanicalPartId` must exist in `mechanical` (if field populated) | Error | Actuators must fill at least jointId **or** partId |
| **B-03** | Same PWM pin must not bind to multiple conflicting actuators | Error | Builds pin $\rightarrow$ binding index and detects collisions |
| **B-04** | Ultrasonic binding missing `mechanicalPartId` | Warning (design) / **Error (simulate)** | Elevates severity on simulate entry |
| **B-05** | Heat sensor binding missing `environmentPropId` | Info | Falls back to ambient field + notices |
| **B-06** | Bound pin signal type incompatible with `mapping.type` | Error | Validates against Device Catalog `pins[].type`; PWM $\leftrightarrow$ pwm, GPIO $\leftrightarrow$ gpio |
| **B-07** | Actuator mapping target matching | Error | See table below (Actuator) |
| **B-07s**| Sensor mapping target matching | Error | See table below (Sensor) |
| **B-08** | Unbound optional device (coverage notice) | Info | `worldCoupling: 'optional'` devices only |
| **B-09** | Missing binding on `worldCoupling: 'required'` device | Warning (design) / **Error (simulate)** | Driven by Catalog; hc-sr04, motor_driver_stub, etc. |
| **B-10** | Binding exists but `pinResolver` cannot resolve required pins | Warning (design) / **Error (simulate)** | E.g., ultrasonic missing TRIG/ECHO connections |

**B-07 Actuator (mapping $\rightarrow$ Required Reference)**:

| mapping.type | Required Field | Prohibited |
|---|---|---|
| `pwm_to_angular_velocity` | `mechanicalJointId` (revolute) | Empty jointId |
| `pwm_to_linear_position` | `mechanicalJointId` (revolute/prismatic) | — |
| `gpio_to_binary_state` | `mechanicalJointId` or `mechanicalPartId` | Both empty |
| `pwm_to_brightness` | `mechanicalPartId` | `mechanicalJointId` |
| `gpio_to_emissive` | `mechanicalPartId` | `mechanicalJointId` |

**B-07s Sensor (mapping $\rightarrow$ Required Reference)**:

| mapping.type | Required Field | Additional Constraints |
|---|---|---|
| `raycast_range_cm` | `mechanicalPartId` | Same as B-04 |
| `temperature_field_sample` | `fallbackAmbientFieldId` exists in `environment.fields` | Triggers B-05 Info when `environmentPropId` absent |
| `collision_contact_bool` | `mechanicalPartId` | — |
| `light_intensity_sample` | `mechanicalPartId` | — |
| `angular_position_to_encoder` | `mapping.jointId` $\in$ `mechanical.joints` | **Prohibited** from relying on binding.`mechanicalPartId` |

### 3.3 Gate Integration

When `VITE_MANIFEST_SCHEMA_V2=false`: **Skips** bindings validation (ignoring the 3 sections), executing only W1 static checks.

```typescript
// workbench-mode.store.ts — switchTo('simulate')
async function canEnterSimulate(): Promise<boolean> {
  const staticOk = await staticCheckService.run();
  if (!staticOk) {
    useLayoutStore().activateBottomTab('static-check');
    return false;
  }

  if (!import.meta.env.VITE_MANIFEST_SCHEMA_V2) {
    return true;  // A10: skips bindings validation
  }

  const manifest = useProjectStore().manifest;
  const results = validateBindings(
    manifest,
    { targetMode: 'simulate', blockingOnly: true },
    { catalog: deviceCatalog, pinResolver: bindingPinResolver },
  );

  const blocking = results.filter(r => isBlockingResult(r, { targetMode: 'simulate' }));
  if (blocking.length > 0) {
    useLayoutStore().activateBottomTab('diagnostics');
    useInspectorStore().activateTab('diagnostics');
    return false;
  }
  return true;
}
```

> **Ordering**: First `static-check`, then `binding-validation` (aligning with Master Plan §4.6). In `design` mode, `validateBindings` surfaces warnings/info without blocking editing.

---

## 4. BindingsInspector Panel

### 4.1 UI Layout

```text
┌─ Bindings Inspector ──────────────────────────────────────┐
│                                                            │
│ Actuators (2)                                      [+ Add] │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ 🔗 bind_motor_left                                   │   │
│ │   Device: motor_driver → Pin: PWM_LEFT               │   │
│ │   Joint: joint_wheel_left (revolute)                  │   │
│ │   Mapping: pwm_to_angular_velocity (200 RPM)         │   │
│ │   Status: ✅ OK                              [Edit][🗑] │   │
│ └──────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ 🔗 bind_motor_right                          [...]    │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ Sensors (1)                                        [+ Add] │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ 📡 bind_radar_front                                  │   │
│ │   Device: front_radar → Part: mount_ultrasonic       │   │
│ │   Pins: TRIG→GPIO4, ECHO→GPIO5 (resolved, readonly)  │   │
│ │   Mapping: raycast_range_cm (max 400cm)              │   │
│ │   Status: ✅ OK                              [Edit][🗑] │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ [💡 Auto-Suggest Bindings]                                 │
│                                                            │
│ Validation: 0 errors, 0 warnings                           │
└────────────────────────────────────────────────────────────┘
```

### 4.2 Auto-Suggest Algorithm

```typescript
function suggestBindings(manifest: EmbeddedProjectManifest): SuggestedBinding[] {
  const suggestions: SuggestedBinding[] = [];
  
  for (const device of manifest.devices) {
    // Motor device -> Search revolute joint -> Suggest pwm_to_angular_velocity
    if (isMotorDevice(device)) {
      const joints = manifest.mechanical?.joints.filter(j => j.type === 'revolute') ?? [];
      for (const joint of joints) {
        if (!hasExistingBinding(manifest, device.componentId, joint.jointId)) {
          suggestions.push({
            deviceComponentId: device.componentId,
            mechanicalJointId: joint.jointId,
            suggestedMapping: { type: 'pwm_to_angular_velocity', maxRpm: 200, deadband: 0.05, invert: false },
            confidence: 0.8,
          });
        }
      }
    }
    
    // Ultrasonic device -> Search sensor mount -> Suggest raycast_range_cm
    if (isUltrasonicDevice(device)) {
      const mounts = manifest.mechanical?.parts.filter(p => p.modelId.includes('ultrasonic')) ?? [];
      for (const mount of mounts) {
        suggestions.push({
          deviceComponentId: device.componentId,
          mechanicalPartId: mount.partId,
          suggestedMapping: { type: 'raycast_range_cm', maxRangeCm: 400, rayOriginOffset: {x:0,y:0,z:0.02}, rayDirection: {x:1,y:0,z:0} },
          confidence: 0.9,
        });
      }
    }
  }
  
  return suggestions;
}
```

### 4.3 AI Patch Preview

When AI proposes binding modifications:

- Displayed with a **dashed outline + blue background** in BindingsInspector.
- Each suggestion features `Accept` / `Reject` action buttons.
- Accept writes modifications into Manifest; Reject dismisses the proposal.

### 4.4 Read-Only Display of Resolved Pins

Sensor binding rows invoke `bindingPinResolver.resolveSensorPins()` / `resolveUltrasonicPins()`, displaying read-only text like "TRIG $\rightarrow$ GPIO4, ECHO $\rightarrow$ GPIO5". Resolution failures show a ⚠ badge linking to Diagnostics (B-10).

---

## 5. LayeredAssetLibrary

### 5.1 Accordion Sections

```vue
<!-- components/asset-library/LayeredAssetLibrary.vue -->
<template>
  <div class="asset-library">
    <AccordionSection title="Boards" icon="Cpu" :defaultOpen="true">
      <AssetItem v-for="b in boards" :key="b.id" :item="b" 
        :dragTarget="'circuit'" />
    </AccordionSection>
    
    <AccordionSection title="Peripherals" icon="Zap">
      <AssetItem v-for="p in peripherals" :key="p.id" :item="p" 
        :dragTarget="'circuit'" />
    </AccordionSection>
    
    <AccordionSection title="Mechanical" icon="Box" :disabled="!featureWorld">
      <AssetItem v-for="m in mechanicalParts" :key="m.id" :item="m" 
        :dragTarget="'world'" />
    </AccordionSection>
    
    <AccordionSection title="Environment" icon="Cloud" :disabled="!featureWorld">
      <AssetItem v-for="e in envProps" :key="e.id" :item="e" 
        :dragTarget="'world'" />
    </AccordionSection>
    
    <AccordionSection title="Templates" icon="Layout">
      <TemplateItem v-for="t in templates" :key="t.id" :template="t" />
    </AccordionSection>
    
    <AccordionSection title="Active" icon="Layers" :defaultOpen="true">
      <ActiveObjectTree :manifest="manifest" @select="onSelect" />
    </AccordionSection>
  </div>
</template>
```

### 5.2 Search and Filtering

- Top search input performs cross-section queries.
- Matching sections expand automatically on input.
- Supports tag filtering (e.g. `motor`, `sensor`, `chassis`).

### 5.3 Simulation Mode Behavior

- Left sidebar is **collapsed by default** in simulate/diagnose modes.
- Can be manually expanded to inspect the Active object tree.
- Boards / Peripherals / Mechanical items marked non-draggable during simulation.

---

## 5.4 Device Catalog & `worldCoupling`

W2 populates `simulation.worldCoupling` in catalog for stubs and peripherals (aligning with [01-device-model-registry.md](../../07-platform-governance/01-device-model-registry.md) §3):

```json
{
  "id": "hc-sr04",
  "simulation": {
    "worldCoupling": "required",
    "allowedSensorMappings": ["raycast_range_cm"]
  }
}
```

| modelId | `worldCoupling` | Description |
|---|---|---|
| `hc-sr04` | `required` | Missing sensor binding $\rightarrow$ B-09 blocks simulate |
| `motor_driver_stub` | `required` | Missing actuator binding $\rightarrow$ B-09 blocks simulate |
| `dht22_stub` | `required` | Warning only prior to W4 |
| `led` | `optional` | Emits B-08 Info when unbound |
| `esp32-devkit-v1` | `none` | Excluded from binding coverage checks |

B-06 requires catalog to supply `pins[].type` (`pwm` / `gpio` / `digital_in`, etc.).

## 5.5 Template Prerequisite Device Inventory

Before templates reach **complete assembly** in W3c/W4, the following components must be available. Unready template buttons are **disabled** in the UI with tooltip explanations:

| Template ID | Circuit Peripherals (Catalog) | 3D modelId (MODEL_LIBRARY) | Complete Assembly Phase |
|---|---|---|---|
| `tpl_avoidance_car` | `esp32-devkit`, `hc-sr04`, **`motor_driver_stub`**¹ | `diff_drive_chassis_v1`, `drive_wheel_v1`, `ultrasonic_mount_v1`, `env_wall_segment` | W3c |
| `tpl_temp_alarm` | `esp32-devkit`, **`dht22_stub`**¹, `led`, **`buzzer_stub`**¹ | `sensor_enclosure_v1`, `env_heat_source` | W4 |

¹ **Stub Devices**: W2 registers placeholder types in catalog, ensuring Manifest + binding validation pass; Wasm execution connects in W3c/W4.

**`motor_driver_stub`**: Dual PWM output placeholder mapped to `bind_motor_left/right`, without requiring hardware L298N chip emulation.

### 5.5.1 W2 Minimal Template Patch (M1 / Onboarding Decoupling)

W1 Onboarding Step 2 can present the "Obstacle Car" entry, but **W2 delivers a minimal patch** (not the full W3c mechanical/environmental assembly):

```typescript
// services/templates/avoidance-car-w2-minimal.ts — for M1 validation
export const AVOIDANCE_CAR_W2_MINIMAL: Partial<EmbeddedProjectManifest> = {
  devices: [
    { componentId: 'esp32', modelId: 'esp32-devkit-v1' },
    { componentId: 'front_radar', modelId: 'hc-sr04' },
  ],
  connections: [ /* TRIG/ECHO -> GPIO, for B-10 unit tests */ ],
  mechanical: { parts: [], joints: [] },
  environment: { props: [], fields: [{ fieldId: 'ambient', type: 'uniform_temperature', valueC: 25 }] },
  bindings: { actuators: [], sensors: [], displays: [] },  // Intentionally empty: M1 verifies B-09 blocking
};
```

- **M1 Demo Flow**: Load minimal patch $\rightarrow$ drag/complete `mount_ultrasonic` + `bind_radar_front` $\rightarrow$ simulate mode unlocked.
- **Full Closed-Loop Obstacle Avoidance** (motors, walls, differential kinematics): Delivered in W3c §7.1 `AVOIDANCE_CAR_TEMPLATE`.

---

## 6. Acceptance Criteria

| # | Acceptance Item | Validation Method |
|---|---|---|
| A1 | Manifest V2 types complete and pass TSC compilation | `npm run build` |
| A2 | `schemaVersion: 1 -> 2` migration operates correctly | Vitest |
| A3 | B-01~B-10 validation rules pass 100% of unit tests | Vitest |
| A4 | Configuring ultrasonic raycast binding displays properly in Bindings panel (with resolved pins) | Manual |
| A5 | Unbound `hc-sr04` blocks design $\rightarrow$ simulate transition via B-09 | Vitest |
| A5b | Bound sensor missing TRIG/ECHO wiring blocks simulate via B-10 | Vitest |
| A6 | Completing binding and resolving physical pins unlocks simulation mode | Manual |
| A7 | Auto-suggest algorithm outputs valid recommendations | Vitest |
| A8 | Left asset library Accordion collapses/expands properly | Manual |
| A9 | Search filtering operates across sections (P1, deferrable) | Manual |
| A10 | `VITE_MANIFEST_SCHEMA_V2=false` skips bindings validation | Vitest |
| A11 | `binding-pin-resolver` unit tests cover ultrasonic and actuators | Vitest |
| A12 | `normalizeConnectionForPersist/Canvas` round-trip preserves pin assignments | Vitest |

---

*Document Revision History:*

- 2026-07-09: Initial creation.
- 2026-07-09: Review revisions—§0 field discipline, componentId/valueC, B-07 extensions, gpio_to_emissive, template prerequisite inventory, migration intensity $\rightarrow$ valueC.
- 2026-07-09: Tertiary review revisions—B-09/10, B-07s, ValidationContext, pin-resolver contract, Connection normalization, motorMaxTorque SSOT, worldCoupling catalog, W2 minimal template, gate chaining with static-check.

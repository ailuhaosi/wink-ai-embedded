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
| Effort Estimate | ~2.5–3 days |
| Prerequisites | W1 Layout Skeleton complete |
| Deliverables | Manifest v2 types, Binding validation engine (B-01~B-10), `binding-pin-resolver` interface, Device Catalog `worldCoupling` metadata, BindingsInspector, LayeredAssetLibrary |
| Milestone | M1: Configure ultrasonic raycast binding $\rightarrow$ Missing binding blocks simulation $\rightarrow$ Completing binding unblocks simulation |
| Upstream Refs | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §8, [00-master-plan.md](./00-master-plan.md) §10 Field Alignment Table |

---

## 0. Field Naming Discipline

TypeScript code **must use** canonical field names from Master Plan §10:
- `devices[].componentId`
- `name`
- `environment.fields[].valueC`

---

## 1. Goals

1. Define TypeScript types for Manifest `schemaVersion: 2` (`mechanical`, `environment`, `bindings`).
2. Implement validation rules **B-01 through B-10** for `design -> simulate` gating.
3. Establish the **`binding-pin-resolver`** interface contract.
4. Construct the BindingsInspector panel with auto-suggestions and read-only pin displays.
5. Create the mapping type registry for actuators, sensors, and displays.
6. Upgrade the left asset library to an Accordion hierarchy.

---

## 2. Manifest V2 Type Definitions

```typescript
export interface EmbeddedProjectManifest {
  schemaVersion: 1 | 2;
  id: string;
  name: string;
  target: { boardId: string; targetArch?: string };
  devices: DeviceEntry[];
  connections: ConnectionEntry[];
  mechanical?: MechanicalSection;
  environment?: EnvironmentSection;
  bindings?: BindingsSection;
  logic?: LogicSection;
  simulation?: SimulationSection;
}

export interface MechanicalSection {
  parts: MechanicalPart[];
  joints: MechanicalJoint[];
}

export interface EnvironmentSection {
  props: EnvironmentProp[];
  fields: EnvironmentField[];
}

export interface BindingsSection {
  actuators: ActuatorBinding[];
  sensors: SensorBinding[];
  displays: DisplayBinding[];
}
```

---

## 3. Binding Validation Engine (B-01 ~ B-10)

| Rule ID | Check | Severity | Detail |
|---|---|---|---|
| **B-01** | `deviceComponentId` must exist in `devices` | Error | Scans devices list |
| **B-02** | `mechanicalJointId` / `mechanicalPartId` must exist in `mechanical` | Error | Validates mechanical IDs |
| **B-03** | PWM pin must not be bound to conflicting actuators | Error | Checks pin collision index |
| **B-04** | Ultrasonic binding missing `mechanicalPartId` | Warning (design) / **Error (simulate)** | Elevates severity on simulate entry |
| **B-05** | Heat sensor missing `environmentPropId` | Info | Falls back to ambient field |
| **B-06** | Signal type mismatch with `mapping.type` | Error | PWM vs GPIO pin validation |
| **B-07** | Actuator mapping target matching | Error | Revolute joints vs parts |
| **B-07s**| Sensor mapping target matching | Error | Part mounts vs fields |
| **B-08** | Unbound optional device | Info | Coverage hint |
| **B-09** | Missing binding on `worldCoupling: required` device | Warning (design) / **Error (simulate)** | Blocks simulate mode |
| **B-10** | Unresolved connection pins for active binding | Warning (design) / **Error (simulate)** | Missing TRIG/ECHO wires |

---

## 4. BindingsInspector Panel

- **Actuator Section**: Displays bindings to motor drivers, revolute joints, and PWM channels.
- **Sensor Section**: Displays bindings to raycast mounts and thermal fields with read-only resolved GPIO pins (`TRIG->GPIO4, ECHO->GPIO5`).
- **Auto-Suggest Engine**: Analyzes components and mechanical parts to generate 1-click binding recommendations.

---

## 5. Layered Asset Library (Accordion)

- **Boards**: Development boards (ESP32 DevKit, etc.) targeting the 2D Circuit Canvas.
- **Peripherals**: Circuit components (LEDs, HC-SR04, Motors).
- **Mechanical**: 3D chassis, wheels, caster joints, and sensor mounts targeting the 3D Product World.
- **Environment**: Walls, obstacle blocks, and heat sources.
- **Templates**: 1-click starter projects (Obstacle Avoidance Car, Thermal Alarm).
- **Active Tree**: Live hierarchy of all allocated canvas and 3D objects.

---

## 6. Verification Criteria (A1~A12)

- **A1**: Manifest V2 passes TypeScript compiler checks without warnings.
- **A3**: Unit tests for B-01~B-10 validation rules achieve 100% test pass rate.
- **A5**: Missing ultrasonic bindings trigger B-09, blocking `design -> simulate` transitions.
- **A6**: Gating unlocks once bindings are satisfied and physical pins resolve correctly.
- **A11**: `binding-pin-resolver` successfully resolves actuator and ultrasonic pins from the netlist.

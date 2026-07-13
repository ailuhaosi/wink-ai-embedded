import type { ConnectionRouting } from '@/types/circuit-routing';
import type {
  ActuatorMapping,
  DisplayMapping,
  SensorMapping,
} from '@/types/mapping-registry';

export interface LogicSection {
  sourceType?: 'dsl' | 'c';
  projectCode?: string;
  dslPath?: string;
  generatedCPath?: string;
}

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

export interface PinPowerModel {
  activeCurrentUa: number;
  leakageCurrentUa: number;
  transitionEnergyNj: number;
}

export interface DeviceEntry {
  componentId: string;
  modelId: string;
  displayName?: string;
  position?: { x: number; y: number };
  rotation?: number;
  properties?: Record<string, unknown> & {
    powerModel?: Record<string, PinPowerModel>;
  };
}

export interface ConnectionPinRef {
  componentId: string;
  pin: string;
}

export interface ConnectionEntry {
  id: string;
  from: string | ConnectionPinRef;
  to: string | ConnectionPinRef;
  color?: string;
  signalType?: string;
  routing: ConnectionRouting;
}

export interface MechanicalSection {
  parts: MechanicalPart[];
  joints: MechanicalJoint[];
}

export interface MechanicalPart {
  partId: string;
  modelId: string;
  displayName: string;
  parentPartId?: string;
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
  rotation?: Vector3;
  scale?: Vector3;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsProperties {
  massKg?: number;
  friction?: number;
  restitution?: number;
  collider: 'box' | 'cylinder' | 'sphere' | 'convex' | 'none';
  static?: boolean;
}

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
  valueC: number;
  region?: FieldRegion;
  falloff?: 'linear' | 'quadratic' | 'none';
  falloffRadiusM?: number;
}

export type FieldType
  = | 'uniform_temperature'
    | 'point_temperature'
    | 'uniform_light'
    | 'directional_light'
    | 'gravity';

export type FieldRegion
  = | { type: 'global' }
    | { type: 'sphere'; center: Vector3; radius: number }
    | {
      type: 'cone';
      apex: Vector3;
      direction: Vector3;
      halfAngleDeg: number;
      length: number;
    };

export interface BindingsSection {
  actuators: ActuatorBinding[];
  sensors: SensorBinding[];
  displays: DisplayBinding[];
}

export interface ActuatorBinding {
  bindingId: string;
  deviceComponentId: string;
  pin: string;
  mechanicalJointId?: string;
  mechanicalPartId?: string;
  mapping: ActuatorMapping;
}

export interface SensorBinding {
  bindingId: string;
  deviceComponentId: string;
  mechanicalPartId?: string;
  environmentPropId?: string;
  mapping: SensorMapping;
}

export interface DisplayBinding {
  bindingId: string;
  deviceComponentId: string;
  mechanicalPartId?: string;
  mapping: DisplayMapping;
}

export function emptyBindingsSection(): BindingsSection {
  return { actuators: [], sensors: [], displays: [] };
}

export function emptyMechanicalSection(): MechanicalSection {
  return { parts: [], joints: [] };
}

export function emptyEnvironmentSection(): EnvironmentSection {
  return { props: [], fields: [] };
}

export function createEmptyManifestV2(
  overrides: Partial<EmbeddedProjectManifest> = {},
): EmbeddedProjectManifest {
  return {
    schemaVersion: 2,
    id: crypto.randomUUID?.() ?? `proj-${Date.now()}`,
    name: 'Untitled Project',
    target: { boardId: 'esp32-devkit-v1' },
    devices: [],
    connections: [],
    mechanical: emptyMechanicalSection(),
    environment: emptyEnvironmentSection(),
    bindings: emptyBindingsSection(),
    ...overrides,
  };
}

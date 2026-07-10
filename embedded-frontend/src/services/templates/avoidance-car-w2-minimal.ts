import type { EmbeddedProjectManifest } from '@/types/manifest-v2';
import { DEFAULT_ROUTING } from '@/services/connection-normalize';

/** M1 acceptance: hc-sr04 present, bindings empty → B-09 blocks simulate */
export const AVOIDANCE_CAR_W2_MINIMAL: EmbeddedProjectManifest = {
  schemaVersion: 2,
  id: 'tpl-avoidance-car-w2-minimal',
  name: 'Avoidance Car (W2 Minimal)',
  target: { boardId: 'esp32-devkit-v1' },
  devices: [
    { componentId: 'esp32', modelId: 'esp32-devkit-v1', displayName: 'ESP32' },
    { componentId: 'front_radar', modelId: 'hc-sr04', displayName: 'Front Radar' },
  ],
  connections: [
    {
      id: 'conn_trig',
      from: { componentId: 'front_radar', pin: 'TRIG' },
      to: { componentId: '__board__esp32-devkit-v1', pin: 'GPIO4' },
      routing: DEFAULT_ROUTING,
    },
    {
      id: 'conn_echo',
      from: { componentId: 'front_radar', pin: 'ECHO' },
      to: { componentId: '__board__esp32-devkit-v1', pin: 'GPIO5' },
      routing: DEFAULT_ROUTING,
    },
  ],
  mechanical: { parts: [], joints: [] },
  environment: {
    props: [],
    fields: [{ fieldId: 'ambient', type: 'uniform_temperature', valueC: 25 }],
  },
  bindings: { actuators: [], sensors: [], displays: [] },
};

export function createUltrasonicBinding(
  partId: string,
  deviceComponentId = 'front_radar',
): EmbeddedProjectManifest['bindings'] {
  return {
    actuators: [],
    displays: [],
    sensors: [
      {
        bindingId: 'bind_radar_front',
        deviceComponentId,
        mechanicalPartId: partId,
        mapping: {
          type: 'raycast_range_cm',
          maxRangeCm: 400,
          rayOriginOffset: { x: 0, y: 0, z: 0.02 },
          rayDirection: { x: 1, y: 0, z: 0 },
        },
      },
    ],
  };
}

export function createUltrasonicMount(partId = 'mount_ultrasonic'): EmbeddedProjectManifest['mechanical'] {
  return {
    parts: [
      {
        partId,
        modelId: 'ultrasonic_mount_v1',
        displayName: 'Ultrasonic Mount',
        transform: {
          position: { x: 0, y: 0.1, z: 0.15 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        physics: { collider: 'box', massKg: 0.05 },
      },
    ],
    joints: [],
  };
}

/**
 * Workbench UI template — includes mount + raycast binding so simulate passes
 * after loading. M1 gate tests use AVOIDANCE_CAR_W2_MINIMAL (empty bindings).
 */
export function createAvoidanceCarWorkbenchManifest(): EmbeddedProjectManifest {
  return {
    ...AVOIDANCE_CAR_W2_MINIMAL,
    id: `avoidance-car-${Date.now()}`,
    name: 'Avoidance Car',
    mechanical: createUltrasonicMount(),
    bindings: createUltrasonicBinding('mount_ultrasonic', 'front_radar')!,
  };
}

import type { ActuatorMapping, SensorMapping } from '@/types/mapping-registry';
import '@/peripherals';
import { registry } from '@/peripherals';
import type { PeripheralDefinition } from '@/peripherals/types';

export type PinSignalType = 'pwm' | 'gpio' | 'digital_in' | 'digital_out' | 'i2c' | 'power';

export type WorldCoupling = 'none' | 'optional' | 'required';

export interface CatalogPinDef {
  name: string;
  type: PinSignalType;
  description?: string;
}

export interface DeviceCatalogEntry {
  id: string;
  displayName: string;
  category: 'board' | 'peripheral' | 'stub';
  /** Canvas peripheral type when dragged from library (undefined for boards) */
  canvasType?: string;
  pins: CatalogPinDef[];
  simulation?: {
    worldCoupling: WorldCoupling;
    allowedActuatorMappings?: ActuatorMapping['type'][];
    allowedSensorMappings?: SensorMapping['type'][];
  };
}

export interface BoardCatalogEntry {
  id: string;
  displayName: string;
  gpioPins: number[];
}

export interface DeviceCatalog {
  getDevice: (modelId: string) => DeviceCatalogEntry | undefined;
  getBoard: (boardId: string) => BoardCatalogEntry | undefined;
  listDevices: () => DeviceCatalogEntry[];
  listBoards: () => BoardCatalogEntry[];
  listMechanicalModels: () => Array<{ id: string; displayName: string }>;
  listEnvironmentModels: () => Array<{ id: string; displayName: string }>;
}

const BOARDS: BoardCatalogEntry[] = [
  {
    id: 'esp32-devkit-v1',
    displayName: 'ESP32 DevKit V1',
    gpioPins: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
  },
];

/** Static board + stub entries (registry peripherals are merged at query time). */
const STATIC_DEVICES: DeviceCatalogEntry[] = [
  {
    id: 'esp32-devkit-v1',
    displayName: 'ESP32 DevKit V1',
    category: 'board',
    pins: [],
    simulation: { worldCoupling: 'none' },
  },
  {
    id: 'motor_driver_stub',
    displayName: 'Motor Driver (stub)',
    category: 'stub',
    pins: [
      { name: 'PWM_LEFT', type: 'pwm' },
      { name: 'PWM_RIGHT', type: 'pwm' },
      { name: 'VCC', type: 'power' },
      { name: 'GND', type: 'power' },
    ],
    simulation: {
      worldCoupling: 'required',
      allowedActuatorMappings: ['pwm_to_angular_velocity'],
    },
  },
  {
    id: 'dht22_stub',
    displayName: 'DHT22 (stub)',
    category: 'stub',
    pins: [{ name: 'DATA', type: 'gpio' }],
    simulation: {
      worldCoupling: 'required',
      allowedSensorMappings: ['temperature_field_sample'],
    },
  },
  {
    id: 'buzzer_stub',
    displayName: 'Buzzer (stub)',
    category: 'stub',
    pins: [{ name: 'SIG', type: 'gpio' }],
    simulation: {
      worldCoupling: 'optional',
      allowedActuatorMappings: ['gpio_to_binary_state'],
    },
  },
];

const MECHANICAL_MODELS = [
  { id: 'ultrasonic_mount_v1', displayName: 'Ultrasonic Mount' },
  { id: 'diff_drive_chassis_v1', displayName: 'Diff-Drive Chassis' },
  { id: 'drive_wheel_v1', displayName: 'Drive Wheel' },
];

const ENVIRONMENT_MODELS = [
  { id: 'env_wall_segment', displayName: 'Wall Segment' },
  { id: 'env_heat_source', displayName: 'Heat Source' },
];

export function definitionToCatalogEntry(def: PeripheralDefinition): DeviceCatalogEntry {
  const catalog = def.catalog!;
  const worldCoupling = (catalog.worldCoupling ?? def.simulation?.worldCoupling ?? 'none') as WorldCoupling;
  const entry: DeviceCatalogEntry = {
    id: catalog.id,
    displayName: def.displayName,
    category: 'peripheral',
    canvasType: def.type,
    pins: catalog.pins.map((p) => ({
      name: p.name,
      type: p.type as PinSignalType,
      ...(p.description !== undefined ? { description: p.description } : {}),
    })),
    simulation: { worldCoupling },
  };
  if (catalog.allowedActuatorMappings) {
    entry.simulation!.allowedActuatorMappings =
      catalog.allowedActuatorMappings as ActuatorMapping['type'][];
  }
  if (catalog.allowedSensorMappings) {
    entry.simulation!.allowedSensorMappings =
      catalog.allowedSensorMappings as SensorMapping['type'][];
  }
  return entry;
}

function mergeDevices(): DeviceCatalogEntry[] {
  const fromRegistry = registry
    .list()
    .filter((d) => d.catalog)
    .map(definitionToCatalogEntry);
  return [...STATIC_DEVICES, ...fromRegistry];
}

/** Maps canvas peripheral type → catalog modelId (rebuilt from static + registry). */
export const CANVAS_TYPE_TO_MODEL: Record<string, string> = {};
for (const d of mergeDevices()) {
  if (d.canvasType) CANVAS_TYPE_TO_MODEL[d.canvasType] = d.id;
}

export const deviceCatalog: DeviceCatalog = {
  getDevice(modelId: string) {
    return mergeDevices().find((d) => d.id === modelId);
  },
  getBoard(boardId: string) {
    return BOARDS.find((b) => b.id === boardId);
  },
  listDevices() {
    return mergeDevices();
  },
  listBoards() {
    return [...BOARDS];
  },
  listMechanicalModels() {
    return [...MECHANICAL_MODELS];
  },
  listEnvironmentModels() {
    return [...ENVIRONMENT_MODELS];
  },
};

export function modelIdForCanvasType(canvasType: string): string {
  const entry = mergeDevices().find((d) => d.canvasType === canvasType);
  return entry?.id ?? canvasType;
}

export function canvasTypeForModelId(modelId: string): string | undefined {
  return deviceCatalog.getDevice(modelId)?.canvasType;
}

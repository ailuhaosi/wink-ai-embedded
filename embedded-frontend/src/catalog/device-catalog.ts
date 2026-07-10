import type { ActuatorMapping, SensorMapping } from '@/types/mapping-registry';

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

const DEVICES: DeviceCatalogEntry[] = [
  {
    id: 'esp32-devkit-v1',
    displayName: 'ESP32 DevKit V1',
    category: 'board',
    pins: [],
    simulation: { worldCoupling: 'none' },
  },
  {
    id: 'hc-sr04',
    displayName: 'HC-SR04 Ultrasonic',
    category: 'peripheral',
    canvasType: 'ultrasonic',
    pins: [
      { name: 'TRIG', type: 'gpio', description: 'Trigger input' },
      { name: 'ECHO', type: 'digital_in', description: 'Echo output' },
      { name: 'VCC', type: 'power' },
      { name: 'GND', type: 'power' },
    ],
    simulation: {
      worldCoupling: 'required',
      allowedSensorMappings: ['raycast_range_cm'],
    },
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
    id: 'led',
    displayName: 'Virtual LED',
    category: 'peripheral',
    canvasType: 'led',
    pins: [
      { name: 'A', type: 'gpio' },
      { name: 'C', type: 'power' },
    ],
    simulation: {
      worldCoupling: 'optional',
      allowedActuatorMappings: ['gpio_to_emissive'],
    },
  },
  {
    id: 'button_stub',
    displayName: 'Push Button',
    category: 'peripheral',
    canvasType: 'button',
    pins: [
      { name: '1.l', type: 'gpio' },
      { name: '2.l', type: 'power' },
    ],
    simulation: { worldCoupling: 'none' },
  },
  {
    id: 'oled_stub',
    displayName: 'SSD1306 OLED',
    category: 'peripheral',
    canvasType: 'oled',
    pins: [
      { name: 'DATA', type: 'i2c' },
      { name: 'CLK', type: 'i2c' },
    ],
    simulation: {
      worldCoupling: 'optional',
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

/** Maps canvas peripheral type → catalog modelId */
export const CANVAS_TYPE_TO_MODEL: Record<string, string> = {};
for (const d of DEVICES) {
  if (d.canvasType) CANVAS_TYPE_TO_MODEL[d.canvasType] = d.id;
}

export const deviceCatalog: DeviceCatalog = {
  getDevice(modelId: string) {
    return DEVICES.find(d => d.id === modelId);
  },
  getBoard(boardId: string) {
    return BOARDS.find(b => b.id === boardId);
  },
  listDevices() {
    return [...DEVICES];
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
  return CANVAS_TYPE_TO_MODEL[canvasType] ?? canvasType;
}

export function canvasTypeForModelId(modelId: string): string | undefined {
  return deviceCatalog.getDevice(modelId)?.canvasType;
}

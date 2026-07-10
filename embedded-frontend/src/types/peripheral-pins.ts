export type PinConnectionValue = number | 'VCC' | '3V3' | 'GND' | null;

export interface PeripheralPinDef {
  name: string;
  description: string;
  required: boolean;
  signalType: 'digital' | 'i2c' | 'power';
  default?: PinConnectionValue;
  relX: number;
  relY: number;
}

export interface PeripheralProps {
  [key: string]: {
    type: 'string' | 'boolean' | 'number';
    default: string | boolean | number;
    description: string;
    options?: string[];
  };
}

export interface PeripheralConfig {
  size: {
    width: number;
    height: number;
  };
  pins: PeripheralPinDef[];
  props: PeripheralProps;
}

export const peripheralConfigs: Record<string, PeripheralConfig> = {
  led: {
    size: { width: 50, height: 60 },
    pins: [
      { name: 'A', description: 'Anode (+)', required: true, signalType: 'digital', default: 13, relX: 30, relY: 50 },
      { name: 'C', description: 'Cathode (-)', required: true, signalType: 'power', default: 'GND', relX: 10, relY: 50 },
    ],
    props: {
      color: { type: 'string', default: 'red', description: 'LED color', options: ['red', 'green', 'blue', 'yellow', 'white', 'orange', 'purple'] },
      brightness: { type: 'number', default: 1.0, description: 'Brightness (0-1)' },
      label: { type: 'string', default: '', description: 'Label text' },
      flip: { type: 'boolean', default: false, description: 'Flip orientation' },
    },
  },
  button: {
    size: { width: 80, height: 60 },
    pins: [
      // Signal pins are optional until the user wires a GPIO; demo starts with them open.
      { name: '1.l', description: 'Left pin 1', required: false, signalType: 'digital', default: null, relX: -5, relY: 20 },
      { name: '2.l', description: 'Left pin 2', required: false, signalType: 'power', default: 'VCC', relX: -5, relY: 40 },
      { name: '1.r', description: 'Right pin 1', required: false, signalType: 'digital', default: null, relX: 75, relY: 13 },
      { name: '2.r', description: 'Right pin 2', required: false, signalType: 'digital', default: null, relX: 75, relY: 33 },
    ],
    props: {
      color: { type: 'string', default: 'red', description: 'Button color', options: ['red', 'green', 'blue', 'yellow', 'white', 'black'] },
      label: { type: 'string', default: '', description: 'Label text' },
      xray: { type: 'boolean', default: false, description: 'Show internal structure' },
      activeLow: { type: 'boolean', default: true, description: 'Active low mode (pull-up)' },
    },
  },
  ultrasonic: {
    size: { width: 180, height: 100 },
    pins: [
      { name: 'VCC', description: 'Power 5V', required: true, signalType: 'power', default: 'VCC', relX: 72, relY: 95 },
      { name: 'TRIG', description: 'Trigger input', required: true, signalType: 'digital', default: 12, relX: 82, relY: 95 },
      { name: 'ECHO', description: 'Echo output', required: true, signalType: 'digital', default: 13, relX: 92, relY: 95 },
      { name: 'GND', description: 'Ground', required: true, signalType: 'power', default: 'GND', relX: 102, relY: 95 },
    ],
    props: {
      distance: { type: 'number', default: 25, description: 'Distance in cm' },
    },
  },
  oled: {
    size: { width: 128, height: 64 },
    pins: [
      { name: 'DATA', description: 'I2C SDA', required: true, signalType: 'i2c', default: 21, relX: 40, relY: 75 },
      { name: 'CLK', description: 'I2C SCL', required: true, signalType: 'i2c', default: 22, relX: 50, relY: 75 },
      { name: 'DC', description: 'Data/Command', required: false, signalType: 'digital', default: null, relX: 60, relY: 75 },
      { name: 'RST', description: 'Reset', required: false, signalType: 'digital', default: null, relX: 70, relY: 75 },
      { name: 'CS', description: 'Chip Select', required: false, signalType: 'digital', default: null, relX: 80, relY: 75 },
      { name: '3V3', description: 'Power 3.3V', required: true, signalType: 'power', default: '3V3', relX: 90, relY: 75 },
      { name: 'VIN', description: 'Power Input', required: false, signalType: 'power', default: null, relX: 100, relY: 75 },
      { name: 'GND', description: 'Ground', required: true, signalType: 'power', default: 'GND', relX: 110, relY: 75 },
    ],
    props: {},
  },
};

export const availableGPIOs = [12, 13, 14, 21, 22];

export const powerOptions: ('VCC' | '3V3' | 'GND')[] = ['VCC', '3V3', 'GND'];

export function getDefaultPinConnections(type: string): Record<string, PinConnectionValue> {
  const config = peripheralConfigs[type];
  if (!config) return {};
  
  const connections: Record<string, PinConnectionValue> = {};
  config.pins.forEach(pin => {
    if (pin.default !== null && pin.default !== undefined) {
      connections[pin.name] = pin.default;
    }
  });
  return connections;
}

export function getDefaultProps(type: string): Record<string, any> {
  const config = peripheralConfigs[type];
  if (!config) return {};
  
  const props: Record<string, any> = {};
  Object.keys(config.props).forEach(key => {
    props[key] = config.props[key].default;
  });
  return props;
}

export interface NetDefinition {
  mode: 'primary' | 'secondary' | 'vcc' | 'gnd';
  signalType: 'digital' | 'i2c' | 'power';
  /** Physical pins that may carry this net; resolved at runtime. */
  pinCandidates: string[];
  /** Used when no candidate has an explicit pinConnections entry. */
  defaultConnection?: PinConnectionValue;
}

export interface BoardPin {
  x: number;
  y: number;
}

export interface BoardDescriptor {
  x: number;
  y: number;
  width: number;
  height: number;
  pins: Record<number, BoardPin>;
  powerPins: Record<string, BoardPin>;
}

export const boardDescriptor: BoardDescriptor = {
  x: 310,
  y: 130,
  width: 180,
  height: 200,
  pins: {
    12: { x: 317, y: 162 },
    13: { x: 317, y: 192 },
    14: { x: 317, y: 222 },
    21: { x: 487, y: 162 },
    22: { x: 487, y: 192 },
  },
  powerPins: {
    VCC: { x: 487, y: 222 },
    '3V3': { x: 487, y: 222 },
    GND: { x: 317, y: 252 },
  },
};

export interface BoardOrigin {
  x: number;
  y: number;
}

export interface RoutingChannels {
  leftBus: number;
  rightBus: number;
  topBus: number;
  bottomBus: number;
  /** Horizontal power distribution rail (above the board) */
  powerRailY: number;
}

export interface PowerNodeSlots {
  railY: number;
  positions: Record<'VCC' | '3V3' | 'GND', Point>;
}

export function getRoutingChannels(boardX: number, boardY: number): RoutingChannels {
  const w = boardDescriptor.width;
  const h = boardDescriptor.height;
  return {
    leftBus: boardX - 45,
    rightBus: boardX + w + 45,
    topBus: boardY - 55,
    bottomBus: boardY + h + 55,
    powerRailY: boardY - 50,
  };
}

/** VCC — 3V3 — GND left-to-right above board center (schematic-style power header) */
export function getPowerNodeSlots(boardX: number, boardY: number): PowerNodeSlots {
  const bounds = resolveBoardBounds(boardX, boardY);
  const railY = bounds.top - 50;
  const cx = bounds.centerX;
  const gap = 72;
  return {
    railY,
    positions: {
      VCC: { x: cx - gap, y: railY },
      '3V3': { x: cx, y: railY },
      GND: { x: cx + gap, y: railY },
    },
  };
}

function resolveBoardBounds(boardX?: number, boardY?: number) {
  const bx = boardX ?? boardDescriptor.x;
  const by = boardY ?? boardDescriptor.y;
  const w = boardDescriptor.width;
  const h = boardDescriptor.height;
  return {
    left: bx,
    right: bx + w,
    top: by,
    bottom: by + h,
    centerX: bx + w / 2,
    centerY: by + h / 2,
    channels: getRoutingChannels(bx, by),
  };
}

export function rotatePinOffset(
  relX: number,
  relY: number,
  W: number,
  H: number,
  rotation: number
): { x: number; y: number } {
  const cx = W / 2;
  const cy = H / 2;
  const dx = relX - cx;
  const dy = relY - cy;
  switch (((rotation % 360) + 360) % 360) {
    case 0:
      return { x: relX, y: relY };
    case 90:
      return { x: cx - dy, y: cy + dx };
    case 180:
      return { x: cx - dx, y: cy - dy };
    case 270:
      return { x: cx + dy, y: cy - dx };
    default:
      return { x: relX, y: relY };
  }
}

export function getNetDefinitions(type: string): NetDefinition[] {
  const netMaps: Record<string, NetDefinition[]> = {
    led: [
      { mode: 'primary', signalType: 'digital', pinCandidates: ['A'] },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['C'] },
    ],
    button: [
      {
        mode: 'primary',
        signalType: 'digital',
        pinCandidates: ['1.l', '1.r'],
        defaultConnection: 14,
      },
      {
        mode: 'gnd',
        signalType: 'power',
        pinCandidates: ['2.l', '2.r'],
        defaultConnection: 'GND',
      },
    ],
    oled: [
      { mode: 'primary', signalType: 'i2c', pinCandidates: ['DATA'] },
      { mode: 'secondary', signalType: 'i2c', pinCandidates: ['CLK'] },
      { mode: 'vcc', signalType: 'power', pinCandidates: ['3V3', 'VIN'] },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['GND'] },
    ],
    ultrasonic: [
      { mode: 'primary', signalType: 'digital', pinCandidates: ['ECHO'] },
      { mode: 'secondary', signalType: 'digital', pinCandidates: ['TRIG'] },
      { mode: 'vcc', signalType: 'power', pinCandidates: ['VCC'] },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['GND'] },
    ],
  };
  return netMaps[type] || [];
}

interface Point {
  x: number;
  y: number;
}

export function generateOrthogonalPath(
  start: Point,
  waypoints: Point[] | undefined,
  end: Point,
): string {
  const points: Point[] = [start, ...(waypoints ?? []), end];
  if (points.length < 2) return '';

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;

    if (dx === 0 || dy === 0) {
      d += ` L ${curr.x} ${curr.y}`;
    } else {
      d += ` L ${curr.x} ${prev.y} L ${curr.x} ${curr.y}`;
    }
  }

  return d;
}

export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WirePathResult {
  path: string;
  width: number;
  segments: Array<{ d: string; layer: number }>;
  vias: Array<{ x: number; y: number }>;
  teardrops: Array<string>;
}

export {
  generateSmartPCBPath,
  generatePowerBusTapPath,
  generatePowerBusTrunkPath,
  pointsToRoundedSvgPath,
  pointsToSvgPath,
} from '../routing/wire-routing';

export { generateFallbackOrthogonalPath } from '../routing/wire-routing-legacy';

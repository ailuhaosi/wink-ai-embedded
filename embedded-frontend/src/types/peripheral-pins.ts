import { POWER_RAIL_VALUES } from '@/constants/power-rail';
import type { PowerRailValue } from '@/constants/power-rail';

export type PinConnectionValue = number | PowerRailValue | null;

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

export const availableGPIOs = [12, 13, 14, 21, 22];

export const powerOptions: PowerRailValue[] = [...POWER_RAIL_VALUES];

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
    'VCC': { x: 487, y: 222 },
    '3V3': { x: 487, y: 222 },
    'GND': { x: 317, y: 252 },
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
      'VCC': { x: cx - gap, y: railY },
      '3V3': { x: cx, y: railY },
      'GND': { x: cx + gap, y: railY },
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
  rotation: number,
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
    }
    else {
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
  generatePowerBusTapPath,
  generatePowerBusTrunkPath,
  generateSmartPCBPath,
  pointsToRoundedSvgPath,
  pointsToSvgPath,
} from '../routing/wire-routing';

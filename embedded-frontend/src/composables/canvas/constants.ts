import { boardDescriptor } from '@/types/peripheral-pins';
import type { WireVisualState } from './types';

export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 580;

export const defaultPositions: Record<string, { x: number; y: number }> = {
  led: { x: 100, y: 100 },
  button: { x: 80, y: 240 },
  oled: { x: 530, y: 120 },
  ultrasonic: { x: 90, y: 360 },
};

export const DEFAULT_WIRE_VISUAL: WireVisualState = {
  opacity: 1,
  widthBoost: 0,
  highlighted: false,
  dimmed: false,
  breathing: false,
};

export const boardPinOffsets: Record<number, { x: number; y: number }> = {
  2: { x: boardDescriptor.pins[2].x - boardDescriptor.x, y: boardDescriptor.pins[2].y - boardDescriptor.y },
  10: { x: boardDescriptor.pins[10].x - boardDescriptor.x, y: boardDescriptor.pins[10].y - boardDescriptor.y },
  12: { x: boardDescriptor.pins[12].x - boardDescriptor.x, y: boardDescriptor.pins[12].y - boardDescriptor.y },
  13: { x: boardDescriptor.pins[13].x - boardDescriptor.x, y: boardDescriptor.pins[13].y - boardDescriptor.y },
  14: { x: boardDescriptor.pins[14].x - boardDescriptor.x, y: boardDescriptor.pins[14].y - boardDescriptor.y },
  21: { x: boardDescriptor.pins[21].x - boardDescriptor.x, y: boardDescriptor.pins[21].y - boardDescriptor.y },
  22: { x: boardDescriptor.pins[22].x - boardDescriptor.x, y: boardDescriptor.pins[22].y - boardDescriptor.y },
};

export const boardPowerPinOffsets: Record<string, { x: number; y: number }> = {
  'VCC': { x: boardDescriptor.powerPins.VCC.x - boardDescriptor.x, y: boardDescriptor.powerPins.VCC.y - boardDescriptor.y },
  '3V3': { x: boardDescriptor.powerPins['3V3'].x - boardDescriptor.x, y: boardDescriptor.powerPins['3V3'].y - boardDescriptor.y },
  'GND': { x: boardDescriptor.powerPins.GND.x - boardDescriptor.x, y: boardDescriptor.powerPins.GND.y - boardDescriptor.y },
};

export const INITIAL_COMMON_POWER_NODES: Record<string, { x: number; y: number; id: string; label: string; color: string }> = {
  'VCC': { x: 328, y: 80, id: 'common-vcc', label: 'VCC', color: '#ef4444' },
  '3V3': { x: 400, y: 80, id: 'common-3v3', label: '3V3', color: '#22c55e' },
  'GND': { x: 472, y: 80, id: 'common-gnd', label: 'GND', color: '#64748b' },
};

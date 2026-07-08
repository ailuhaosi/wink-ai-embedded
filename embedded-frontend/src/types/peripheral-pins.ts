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
  pins: PeripheralPinDef[];
  props: PeripheralProps;
}

export const peripheralConfigs: Record<string, PeripheralConfig> = {
  led: {
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
    pins: [
      { name: '1.l', description: 'Left pin 1', required: true, signalType: 'digital', default: 14, relX: -5, relY: 20 },
      { name: '2.l', description: 'Left pin 2', required: false, signalType: 'power', default: 'VCC', relX: -5, relY: 40 },
      { name: '1.r', description: 'Right pin 1', required: true, signalType: 'power', default: 'GND', relX: 75, relY: 20 },
      { name: '2.r', description: 'Right pin 2', required: false, signalType: 'digital', default: null, relX: 75, relY: 40 },
    ],
    props: {
      color: { type: 'string', default: 'red', description: 'Button color', options: ['red', 'green', 'blue', 'yellow', 'white', 'black'] },
      label: { type: 'string', default: '', description: 'Label text' },
      xray: { type: 'boolean', default: false, description: 'Show internal structure' },
      activeLow: { type: 'boolean', default: true, description: 'Active low mode (pull-up)' },
    },
  },
  ultrasonic: {
    pins: [
      { name: 'VCC', description: 'Power 5V', required: true, signalType: 'power', default: 'VCC', relX: 75, relY: 95 },
      { name: 'TRIG', description: 'Trigger input', required: true, signalType: 'digital', default: 12, relX: 85, relY: 95 },
      { name: 'ECHO', description: 'Echo output', required: true, signalType: 'digital', default: 13, relX: 95, relY: 95 },
      { name: 'GND', description: 'Ground', required: true, signalType: 'power', default: 'GND', relX: 105, relY: 95 },
    ],
    props: {
      distance: { type: 'number', default: 25, description: 'Distance in cm' },
    },
  },
  oled: {
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

export function generateSmartOrthogonalPath(
  start: Point,
  end: Point,
  startDir: 'left' | 'right' | 'up' | 'down',
  endDir: 'left' | 'right' | 'up' | 'down',
  lane: number
): string {
  const extDist = 15 + lane * 5;
  const boardLeft = 310;
  const boardRight = 490;
  const boardTop = 130;
  const boardBottom = 330;

  // 1. Calculate extension points
  const p1 = { x: start.x, y: start.y };
  if (startDir === 'left') p1.x -= extDist;
  else if (startDir === 'right') p1.x += extDist;
  else if (startDir === 'up') p1.y -= extDist;
  else if (startDir === 'down') p1.y += extDist;

  const p2 = { x: end.x, y: end.y };
  if (endDir === 'left') p2.x -= extDist;
  else if (endDir === 'right') p2.x += extDist;
  else if (endDir === 'up') p2.y -= extDist;
  else if (endDir === 'down') p2.y += extDist;

  const points: Point[] = [start, p1];

  // 2. Routing logic
  if (start.x < boardLeft && end.x <= boardLeft + 10) {
    // Both on the left side of the board
    const xChan = boardLeft - 25 - lane * 5;
    points.push({ x: xChan, y: p1.y });
    points.push({ x: xChan, y: p2.y });
  } else if (start.x > boardRight && end.x >= boardRight - 10) {
    // Both on the right side of the board
    const xChan = boardRight + 25 + lane * 5;
    points.push({ x: xChan, y: p1.y });
    points.push({ x: xChan, y: p2.y });
  } else {
    // Must bypass the board
    const bypassY = start.y < 200
      ? boardTop - 30 - lane * 5
      : boardBottom + 30 + lane * 5;
    const xLeft = boardLeft - 25 - lane * 5;
    const xRight = boardRight + 25 + lane * 5;

    if (start.x < boardLeft) {
      points.push({ x: xLeft, y: p1.y });
      points.push({ x: xLeft, y: bypassY });
      points.push({ x: xRight, y: bypassY });
      points.push({ x: xRight, y: p2.y });
    } else {
      points.push({ x: xRight, y: p1.y });
      points.push({ x: xRight, y: bypassY });
      points.push({ x: xLeft, y: bypassY });
      points.push({ x: xLeft, y: p2.y });
    }
  }

  points.push(p2);
  points.push(end);

  // 3. Simplify path
  const simplified = simplifyPath(points);

  // 4. Convert to SVG path
  return pointsToSvgPath(simplified);
}

function simplifyPath(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts.map(p => ({ ...p }));
  
  // Dedup consecutive duplicates
  const dedup: Point[] = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) {
      dedup.push({ ...p });
    }
  }

  // Collapse 3-in-a-row on same axis
  let result = dedup;
  let changed = true;
  while (changed && result.length > 2) {
    changed = false;
    for (let i = 1; i < result.length - 1; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];
      if ((prev.x === curr.x && curr.x === next.x) || (prev.y === curr.y && curr.y === next.y)) {
        result = [...result.slice(0, i), ...result.slice(i + 1)];
        changed = true;
        break;
      }
    }
  }
  return result;
}

function pointsToSvgPath(pts: Point[]): string {
  if (pts.length < 2) return '';
  return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
}
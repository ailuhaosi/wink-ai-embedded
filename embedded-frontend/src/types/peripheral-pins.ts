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

export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

class AStarNode {
  x: number;
  y: number;
  g: number = 0;
  h: number = 0;
  f: number = 0;
  parent: AStarNode | null = null;
  dir: { dx: number; dy: number } = { dx: 0, dy: 0 };

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function findAStarPath(
  startPt: Point,
  endPt: Point,
  obstacles: Obstacle[],
  channelOccupancyMap?: Map<string, number>
): Point[] | null {
  const resolution = 10;
  const startGridX = Math.round(startPt.x / resolution);
  const startGridY = Math.round(startPt.y / resolution);
  const endGridX = Math.round(endPt.x / resolution);
  const endGridY = Math.round(endPt.y / resolution);

  const maxGridX = 85;
  const maxGridY = 60;

  const blocked = new Set<string>();
  const padding = 1; // 10px buffer around obstacles

  for (const obs of obstacles) {
    const ox1 = Math.floor(obs.x / resolution) - padding;
    const oy1 = Math.floor(obs.y / resolution) - padding;
    const ox2 = Math.ceil((obs.x + obs.width) / resolution) + padding;
    const oy2 = Math.ceil((obs.y + obs.height) / resolution) + padding;

    for (let x = ox1; x <= ox2; x++) {
      for (let y = oy1; y <= oy2; y++) {
        blocked.add(`${x},${y}`);
      }
    }
  }

  // Escape cells (allow start and end grid points, plus their surrounding cells, to be clear)
  const escapeCells = new Set<string>();
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      escapeCells.add(`${startGridX + dx},${startGridY + dy}`);
      escapeCells.add(`${endGridX + dx},${endGridY + dy}`);
    }
  }

  const openList: AStarNode[] = [];
  const closedSet = new Set<string>();

  const startNode = new AStarNode(startGridX, startGridY);
  startNode.h = Math.abs(startGridX - endGridX) + Math.abs(startGridY - endGridY);
  startNode.f = startNode.h;
  openList.push(startNode);

  const directions = [
    { dx: 0, dy: -1 }, // Up
    { dx: 0, dy: 1 },  // Down
    { dx: -1, dy: 0 }, // Left
    { dx: 1, dy: 0 }   // Right
  ];

  let iterations = 0;
  const maxIterations = 5000;

  while (openList.length > 0) {
    iterations++;
    if (iterations > maxIterations) {
      console.log(`findAStarPath FAILED: exceeded maxIterations (${maxIterations}) from (${startPt.x},${startPt.y}) to (${endPt.x},${endPt.y})`);
      break;
    }

    openList.sort((a, b) => a.f - b.f);
    const curr = openList.shift()!;

    const key = `${curr.x},${curr.y}`;
    closedSet.add(key);

    if (curr.x === endGridX && curr.y === endGridY) {
      const path: Point[] = [];
      let temp: AStarNode | null = curr;
      while (temp) {
        path.push({ x: temp.x * resolution, y: temp.y * resolution });
        if (channelOccupancyMap) {
          const occupancyKey = `${temp.x},${temp.y}`;
          channelOccupancyMap.set(occupancyKey, (channelOccupancyMap.get(occupancyKey) || 0) + 1);
        }
        temp = temp.parent;
      }
      return path.reverse();
    }

    for (const dir of directions) {
      const nx = curr.x + dir.dx;
      const ny = curr.y + dir.dy;
      const nKey = `${nx},${ny}`;

      if (nx < -5 || nx > maxGridX || ny < -5 || ny > maxGridY) {
        continue;
      }

      if (blocked.has(nKey) && !escapeCells.has(nKey)) {
        continue;
      }

      if (closedSet.has(nKey)) {
        continue;
      }

      let stepCost = 1;
      
      const hasTurned = curr.dir.dx !== 0 && (curr.dir.dx !== dir.dx || curr.dir.dy !== dir.dy);
      if (hasTurned) {
        stepCost += 12; // Turn penalty to favor straight paths
      }

      if (channelOccupancyMap) {
        const occupancy = channelOccupancyMap.get(nKey) || 0;
        stepCost += occupancy * 4; // Discourage overlaps, but don't cause A* to search the entire canvas to avoid it
      }

      const gScore = curr.g + stepCost;
      const hScore = Math.abs(nx - endGridX) + Math.abs(ny - endGridY);
      const fScore = gScore + hScore;

      let existingNode = openList.find(n => n.x === nx && n.y === ny);
      if (!existingNode) {
        const nNode = new AStarNode(nx, ny);
        nNode.g = gScore;
        nNode.h = hScore;
        nNode.f = fScore;
        nNode.parent = curr;
        nNode.dir = dir;
        openList.push(nNode);
      } else if (gScore < existingNode.g) {
        existingNode.g = gScore;
        existingNode.f = fScore;
        existingNode.parent = curr;
        existingNode.dir = dir;
      }
    }
  }

  return null;
}

function generateFallbackOrthogonalPath(
  start: Point,
  end: Point,
  startDir: 'left' | 'right' | 'up' | 'down',
  endDir: 'left' | 'right' | 'up' | 'down',
  lane: number
): Point[] {
  const extDist = 15 + lane * 5;
  const boardLeft = 310;
  const boardRight = 490;
  const boardTop = 130;
  const boardBottom = 330;

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

  if (start.x < boardLeft && end.x <= boardLeft + 10) {
    const xChan = boardLeft - 25 - lane * 5;
    points.push({ x: xChan, y: p1.y });
    points.push({ x: xChan, y: p2.y });
  } else if (start.x > boardRight && end.x >= boardRight - 10) {
    const xChan = boardRight + 25 + lane * 5;
    points.push({ x: xChan, y: p1.y });
    points.push({ x: xChan, y: p2.y });
  } else {
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
  return points;
}

export function generateSmartOrthogonalPath(
  start: Point,
  end: Point,
  startDir: 'left' | 'right' | 'up' | 'down',
  endDir: 'left' | 'right' | 'up' | 'down',
  lane: number,
  obstacles?: Obstacle[],
  channelOccupancyMap?: Map<string, number>
): string {
  const extDist = 15 + lane * 4;

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

  let points: Point[] | null = null;

  if (obstacles) {
    const aStarPath = findAStarPath(p1, p2, obstacles, channelOccupancyMap);
    if (aStarPath) {
      points = [start, p1, ...aStarPath, p2, end];
    }
  }

  if (!points) {
    points = generateFallbackOrthogonalPath(start, end, startDir, endDir, lane);
  }

  const simplified = simplifyPath(points);
  return pointsToSmoothSvgPath(simplified, 8);
}

export function pointsToSmoothSvgPath(pts: Point[], radius = 8): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    if (len1 === 0 || len2 === 0) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const r = Math.min(radius, len1 / 2, len2 / 2);

    const xStart = curr.x - (dx1 / len1) * r;
    const yStart = curr.y - (dy1 / len1) * r;
    const xEnd = curr.x + (dx2 / len2) * r;
    const yEnd = curr.y + (dy2 / len2) * r;

    d += ` L ${xStart} ${yStart} Q ${curr.x} ${curr.y} ${xEnd} ${yEnd}`;
  }

  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

function simplifyPath(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts.map(p => ({ ...p }));
  
  const dedup: Point[] = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) {
      dedup.push({ ...p });
    }
  }

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

export function pointsToSvgPath(pts: Point[]): string {
  if (pts.length < 2) return '';
  return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
}
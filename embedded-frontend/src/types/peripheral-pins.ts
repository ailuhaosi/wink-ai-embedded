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

export interface WirePathResult {
  path: string;
  width: number;
  segments: Array<{ d: string; layer: number }>;
  vias: Array<{ x: number; y: number }>;
  teardrops: Array<string>;
}

class AStarNode3D {
  x: number;
  y: number;
  layer: number; // 0 = Top (solid), 1 = Bottom (dashed)
  g: number = 0;
  h: number = 0;
  f: number = 0;
  parent: AStarNode3D | null = null;
  dir: { dx: number; dy: number } = { dx: 0, dy: 0 };

  constructor(x: number, y: number, layer: number) {
    this.x = x;
    this.y = y;
    this.layer = layer;
  }
}

function getDistanceToObstacle(x: number, y: number, obs: Obstacle): number {
  const dx = Math.max(obs.x - x, 0, x - (obs.x + obs.width));
  const dy = Math.max(obs.y - y, 0, y - (obs.y + obs.height));
  return Math.sqrt(dx * dx + dy * dy);
}

function findAStarPath3D(
  startPt: Point,
  endPt: Point,
  obstacles: Obstacle[],
  channelOccupancyMap?: Map<string, number>,
  initDir?: { dx: number; dy: number }
): Array<{ x: number; y: number; layer: number }> | null {
  const resolution = 10;
  const startGridX = Math.round(startPt.x / resolution);
  const startGridY = Math.round(startPt.y / resolution);
  const endGridX = Math.round(endPt.x / resolution);
  const endGridY = Math.round(endPt.y / resolution);

  // Dynamic grid bounds
  let minX = Math.min(startGridX, endGridX);
  let maxX = Math.max(startGridX, endGridX);
  let minY = Math.min(startGridY, endGridY);
  let maxY = Math.max(startGridY, endGridY);

  for (const obs of obstacles) {
    minX = Math.min(minX, Math.floor(obs.x / resolution));
    maxX = Math.max(maxX, Math.ceil((obs.x + obs.width) / resolution));
    minY = Math.min(minY, Math.floor(obs.y / resolution));
    maxY = Math.max(maxY, Math.ceil((obs.y + obs.height) / resolution));
  }

  const gridMinX = minX - 6;
  const gridMaxX = maxX + 6;
  const gridMinY = minY - 6;
  const gridMaxY = maxY + 6;

  // Obstacle cells
  const blocked = new Set<string>();
  const padding = 1;
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

  // Escape cells (exempt from hard block check)
  const escapeCells = new Set<string>();
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      escapeCells.add(`${startGridX + dx},${startGridY + dy}`);
      escapeCells.add(`${endGridX + dx},${endGridY + dy}`);
    }
  }

  const getClearanceCost = (gx: number, gy: number): number => {
    const cx = gx * resolution;
    const cy = gy * resolution;

    if (escapeCells.has(`${gx},${gy}`)) return 0;

    let minD = Infinity;
    for (const obs of obstacles) {
      const d = getDistanceToObstacle(cx, cy, obs);
      if (d < minD) minD = d;
    }

    if (minD < 10) return Infinity; // Blocked
    if (minD < 25) {
      return 1.5 * Math.pow((25 - minD) / 15, 2); // Quadratic potential gradient
    }
    return 0;
  };

  const openList: AStarNode3D[] = [];
  const closedSet = new Set<string>();

  const startNode = new AStarNode3D(startGridX, startGridY, 0);
  if (initDir) {
    startNode.dir = initDir;
  }
  startNode.h = Math.abs(startGridX - endGridX) + Math.abs(startGridY - endGridY);
  startNode.f = startNode.h;
  openList.push(startNode);

  const directions = [
    { dx: 0, dy: -1, isDiag: false }, // Up
    { dx: 0, dy: 1, isDiag: false },  // Down
    { dx: -1, dy: 0, isDiag: false }, // Left
    { dx: 1, dy: 0, isDiag: false },  // Right
    { dx: -1, dy: -1, isDiag: true }, // Up-Left
    { dx: 1, dy: -1, isDiag: true },  // Up-Right
    { dx: -1, dy: 1, isDiag: true },  // Down-Left
    { dx: 1, dy: 1, isDiag: true }    // Down-Right
  ];

  let iterations = 0;
  const maxIterations = 6000;

  while (openList.length > 0) {
    iterations++;
    if (iterations > maxIterations) {
      break;
    }

    openList.sort((a, b) => a.f - b.f);
    const curr = openList.shift()!;

    const key = `${curr.x},${curr.y},${curr.layer}`;
    closedSet.add(key);

    if (curr.x === endGridX && curr.y === endGridY && curr.layer === 0) {
      const path: Array<{ x: number; y: number; layer: number }> = [];
      let temp: AStarNode3D | null = curr;
      while (temp) {
        path.push({ x: temp.x * resolution, y: temp.y * resolution, layer: temp.layer });

        if (channelOccupancyMap && temp.parent) {
          const occupancyKey = `${temp.x},${temp.y}`;
          const dx = temp.x - temp.parent.x;
          const dy = temp.y - temp.parent.y;
          
          let val = channelOccupancyMap.get(occupancyKey) || 0;
          let count = val & 0xFF;
          let dirs = (val >> 8) & 0xF;
          count = Math.min(count + 1, 0xFF);

          if (dx === 0 && dy === -1) dirs |= 1;      // Up
          else if (dx === 0 && dy === 1) dirs |= 2;   // Down
          else if (dx === -1 && dy === 0) dirs |= 4;  // Left
          else if (dx === 1 && dy === 0) dirs |= 8;   // Right

          channelOccupancyMap.set(occupancyKey, (dirs << 8) | count);
        }

        temp = temp.parent;
      }
      return path.reverse();
    }

    const neighbors: Array<{ nx: number; ny: number; nLayer: number; stepCost: number; dir: { dx: number; dy: number } }> = [];

    // Same layer moves
    for (const dir of directions) {
      const nx = curr.x + dir.dx;
      const ny = curr.y + dir.dy;

      if (nx < gridMinX || nx > gridMaxX || ny < gridMinY || ny > gridMaxY) {
        continue;
      }

      if (dir.isDiag) {
        const side1Key = `${curr.x + dir.dx},${curr.y}`;
        const side2Key = `${curr.x},${curr.y + dir.dy}`;
        if (blocked.has(side1Key) && blocked.has(side2Key)) {
          continue;
        }
      }

      const gridKey = `${nx},${ny}`;
      if (blocked.has(gridKey) && !escapeCells.has(gridKey)) {
        continue;
      }

      const cCost = getClearanceCost(nx, ny);
      if (cCost === Infinity) {
        continue;
      }

      let stepCost = dir.isDiag ? 1.414 : 1.0;
      stepCost += cCost;

      const hasTurned = (curr.dir.dx !== 0 || curr.dir.dy !== 0) && (curr.dir.dx !== dir.dx || curr.dir.dy !== dir.dy);
      if (hasTurned) {
        stepCost += 1.5; // Turn penalty (15px equivalent)
      }

      if (channelOccupancyMap) {
        const val = channelOccupancyMap.get(gridKey) || 0;
        const count = val & 0xFF;
        
        if (count > 0) {
          const dirs = (val >> 8) & 0xF;
          let isCrossing = false;
          if (dir.dx !== 0 && (dirs & 3)) isCrossing = true;
          if (dir.dy !== 0 && (dirs & 12)) isCrossing = true;

          if (isCrossing) {
            stepCost += 10.0; // Crossing penalty
          } else {
            stepCost += count * 0.8;
          }
        }

        // Parallel alignment bias (Bus Bundling)
        let sideKeys: string[] = [];
        if (dir.dx !== 0 && dir.dy === 0) {
          sideKeys.push(`${nx},${ny - 1}`, `${nx},${ny + 1}`);
        } else if (dir.dy !== 0 && dir.dx === 0) {
          sideKeys.push(`${nx - 1},${ny}`, `${nx + 1},${ny}`);
        }

        for (const sKey of sideKeys) {
          const sVal = channelOccupancyMap.get(sKey) || 0;
          if (sVal > 0) {
            const sDirs = (sVal >> 8) & 0xF;
            let matchingDir = false;
            if (dir.dx === 0 && dir.dy === -1 && (sDirs & 1)) matchingDir = true;
            else if (dir.dx === 0 && dir.dy === 1 && (sDirs & 2)) matchingDir = true;
            else if (dir.dx === -1 && dir.dy === 0 && (sDirs & 4)) matchingDir = true;
            else if (dir.dx === 1 && dir.dy === 0 && (sDirs & 8)) matchingDir = true;

            if (matchingDir) {
              stepCost -= 0.04; // Parallel bonus
              break;
            }
          }
        }
      }

      neighbors.push({
        nx,
        ny,
        nLayer: curr.layer,
        stepCost,
        dir: { dx: dir.dx, dy: dir.dy }
      });
    }

    // Layer switch (Via)
    const isTerminal = (curr.x === startGridX && curr.y === startGridY) || (curr.x === endGridX && curr.y === endGridY);
    if (!isTerminal) {
      neighbors.push({
        nx: curr.x,
        ny: curr.y,
        nLayer: 1 - curr.layer,
        stepCost: 3.0, // Via cost
        dir: { dx: 0, dy: 0 }
      });
    }

    for (const neighbor of neighbors) {
      const nKey = `${neighbor.nx},${neighbor.ny},${neighbor.nLayer}`;
      if (closedSet.has(nKey)) {
        continue;
      }

      const gScore = curr.g + neighbor.stepCost;
      const hScore = Math.abs(neighbor.nx - endGridX) + Math.abs(neighbor.ny - endGridY) + (neighbor.nLayer !== 0 ? 3.0 : 0);
      const fScore = gScore + hScore;

      let existingNode = openList.find(n => n.x === neighbor.nx && n.y === neighbor.ny && n.layer === neighbor.nLayer);
      if (!existingNode) {
        const nNode = new AStarNode3D(neighbor.nx, neighbor.ny, neighbor.nLayer);
        nNode.g = gScore;
        nNode.h = hScore;
        nNode.f = fScore;
        nNode.parent = curr;
        nNode.dir = neighbor.dir;
        openList.push(nNode);
      } else if (gScore < existingNode.g) {
        existingNode.g = gScore;
        existingNode.f = fScore;
        existingNode.parent = curr;
        existingNode.dir = neighbor.dir;
      }
    }
  }

  return null;
}

function generateTeardropPath(pin: Point, nextPt: Point, padRadius = 5.5, length = 12): string {
  const dx = nextPt.x - pin.x;
  const dy = nextPt.y - pin.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return '';

  const ux = dx / len;
  const uy = dy / len;

  const nx = -uy;
  const ny = ux;

  const p1x = pin.x + nx * padRadius;
  const p1y = pin.y + ny * padRadius;

  const p2x = pin.x - nx * padRadius;
  const p2y = pin.y - ny * padRadius;

  const p3x = pin.x + ux * length;
  const p3y = pin.y + uy * length;

  return `M ${p1x} ${p1y} L ${p3x} ${p3y} L ${p2x} ${p2y} Z`;
}

export function generateFallbackOrthogonalPath(
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

export function generateSmartPCBPath(
  start: Point,
  end: Point,
  startDir: 'left' | 'right' | 'up' | 'down',
  endDir: 'left' | 'right' | 'up' | 'down',
  lane: number,
  obstacles?: Obstacle[],
  channelOccupancyMap?: Map<string, number>,
  signalType?: 'digital' | 'i2c' | 'power',
  waypoints?: Point[],
  wireStyle: 'pcb' | 'curved' = 'pcb'
): WirePathResult {
  const isPower = signalType === 'power';
  const width = isPower ? 4.0 : 2.2;

  const extDistStart = obstacles ? (25 + lane * 5) : (15 + lane * 4);
  const extDistEnd = 15 + lane * 4;

  const p1 = { x: start.x, y: start.y };
  if (startDir === 'left') p1.x -= extDistStart;
  else if (startDir === 'right') p1.x += extDistStart;
  else if (startDir === 'up') p1.y -= extDistStart;
  else if (startDir === 'down') p1.y += extDistStart;

  const p2 = { x: end.x, y: end.y };
  if (endDir === 'left') p2.x -= extDistEnd;
  else if (endDir === 'right') p2.x += extDistEnd;
  else if (endDir === 'up') p2.y -= extDistEnd;
  else if (endDir === 'down') p2.y += extDistEnd;

  let rawPath3D: Array<{ x: number; y: number; layer: number }> = [];

  let initDir = { dx: 0, dy: 0 };
  if (startDir === 'left') initDir = { dx: -1, dy: 0 };
  else if (startDir === 'right') initDir = { dx: 1, dy: 0 };
  else if (startDir === 'up') initDir = { dx: 0, dy: -1 };
  else if (startDir === 'down') initDir = { dx: 0, dy: 1 };

  if (obstacles) {
    const routingPoints: Point[] = [p1, ...(waypoints || []), p2];
    let currentInitDir: { dx: number; dy: number } | undefined = initDir;

    let routeSuccess = true;
    for (let j = 0; j < routingPoints.length - 1; j++) {
      const segStart = routingPoints[j];
      const segEnd = routingPoints[j + 1];
      const subPath = findAStarPath3D(segStart, segEnd, obstacles, channelOccupancyMap, currentInitDir);
      
      if (subPath) {
        if (rawPath3D.length > 0 && subPath.length > 0) {
          rawPath3D = rawPath3D.concat(subPath.slice(1));
        } else {
          rawPath3D = rawPath3D.concat(subPath);
        }

        if (subPath.length >= 2) {
          const penult = subPath[subPath.length - 2];
          const ult = subPath[subPath.length - 1];
          const dx = ult.x - penult.x;
          const dy = ult.y - penult.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            currentInitDir = { dx: Math.round(dx / len), dy: Math.round(dy / len) };
          } else {
            currentInitDir = undefined;
          }
        } else {
          currentInitDir = undefined;
        }
      } else {
        routeSuccess = false;
        break;
      }
    }

    if (!routeSuccess) {
      rawPath3D = [];
    }
  }

  if (rawPath3D.length === 0) {
    const fallback2D = generateFallbackOrthogonalPath(start, end, startDir, endDir, lane);
    rawPath3D = fallback2D.map((p: Point) => ({ x: p.x, y: p.y, layer: 0 }));
  } else {
    rawPath3D = [
      { x: start.x, y: start.y, layer: 0 },
      ...rawPath3D,
      { x: end.x, y: end.y, layer: 0 }
    ];
  }

  const segments: Array<{ d: string; layer: number }> = [];
  const vias: Array<{ x: number; y: number }> = [];

  let currentLayer = rawPath3D[0].layer;
  let currentPts: Point[] = [{ x: rawPath3D[0].x, y: rawPath3D[0].y }];

  for (let i = 1; i < rawPath3D.length; i++) {
    const pt = rawPath3D[i];
    if (pt.layer !== currentLayer) {
      vias.push({ x: pt.x, y: pt.y });

      const simplified = simplifyPath(currentPts);
      let d = '';
      if (wireStyle === 'curved') {
        d = pointsToSmoothSvgPath(simplified, 20);
      } else {
        const chamfered = chamferPathCorners(simplified, 8);
        d = pointsToSvgPath(chamfered);
      }
      segments.push({
        d,
        layer: currentLayer
      });

      currentLayer = pt.layer;
      currentPts = [{ x: pt.x, y: pt.y }];
    } else {
      currentPts.push({ x: pt.x, y: pt.y });
    }
  }

  if (currentPts.length > 0) {
    const simplified = simplifyPath(currentPts);
    let d = '';
    if (wireStyle === 'curved') {
      d = pointsToSmoothSvgPath(simplified, 20);
    } else {
      const chamfered = chamferPathCorners(simplified, 8);
      d = pointsToSvgPath(chamfered);
    }
    segments.push({
      d,
      layer: currentLayer
    });
  }

  const teardrops: string[] = [];
  if (rawPath3D.length > 2) {
    const tStart = generateTeardropPath(start, p1, 5.5, 12);
    if (tStart) teardrops.push(tStart);
    
    const tEnd = generateTeardropPath(end, p2, 5.5, 12);
    if (tEnd) teardrops.push(tEnd);
  }

  const primaryPath = segments.map(seg => seg.d).join(' ');

  return {
    path: primaryPath,
    width,
    segments,
    vias,
    teardrops
  };
}

function chamferPathCorners(pts: Point[], maxOffset = 8): Point[] {
  if (pts.length <= 2) return pts;
  
  const result: Point[] = [pts[0]];
  
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
      result.push(curr);
      continue;
    }

    const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
    const isOrthogonal = Math.abs(dot) < 0.1;

    if (isOrthogonal) {
      const offset = Math.min(maxOffset, len1 / 2, len2 / 2);
      
      const pa = {
        x: curr.x - (dx1 / len1) * offset,
        y: curr.y - (dy1 / len1) * offset
      };
      const pb = {
        x: curr.x + (dx2 / len2) * offset,
        y: curr.y + (dy2 / len2) * offset
      };
      
      result.push(pa, pb);
    } else {
      result.push(curr);
    }
  }

  result.push(pts[pts.length - 1]);
  return result;
}

export function generateSmartOrthogonalPath(
  start: Point,
  end: Point,
  startDir: 'left' | 'right' | 'up' | 'down',
  endDir: 'left' | 'right' | 'up' | 'down',
  lane: number,
  obstacles?: Obstacle[],
  channelOccupancyMap?: Map<string, number>,
  signalType?: 'digital' | 'i2c' | 'power',
  waypoints?: Point[]
): string {
  const res = generateSmartPCBPath(start, end, startDir, endDir, lane, obstacles, channelOccupancyMap, signalType, waypoints);
  return res.path;
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
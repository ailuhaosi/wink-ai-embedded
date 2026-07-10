/**
 * HCTR conflict-resolution fallback (A* + channel routing).
 * Used only when the primary HCTR path cannot resolve segment conflicts.
 */
import {
  boardDescriptor,
  getRoutingChannels,

} from '../types/peripheral-pins';
import type { BoardOrigin, Obstacle, WirePathResult } from '../types/peripheral-pins';

interface Point {
  x: number;
  y: number;
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

class AStarNode3D {
  x: number;
  y: number;
  layer: number;
  g: number = 0;
  h: number = 0;
  f: number = 0;
  parent: AStarNode3D | null = null;
  dir: { dx: number; dy: number } = { dx: 0, dy: 0 };
  heapIndex: number = -1;

  constructor(x: number, y: number, layer: number) {
    this.x = x;
    this.y = y;
    this.layer = layer;
  }
}

class AStarMinHeap {
  private nodes: AStarNode3D[] = [];

  push(node: AStarNode3D): void {
    this.nodes.push(node);
    node.heapIndex = this.nodes.length - 1;
    this.bubbleUp(node.heapIndex);
  }

  pop(): AStarNode3D | undefined {
    if (this.nodes.length === 0) return undefined;

    const root = this.nodes[0];
    const last = this.nodes.pop();

    if (last && this.nodes.length > 0) {
      this.nodes[0] = last;
      last.heapIndex = 0;
      this.bubbleDown(0);
    }

    if (root) root.heapIndex = -1;
    return root;
  }

  update(node: AStarNode3D): void {
    if (node.heapIndex >= 0 && node.heapIndex < this.nodes.length) {
      this.bubbleUp(node.heapIndex);
    }
  }

  get size(): number {
    return this.nodes.length;
  }

  isEmpty(): boolean {
    return this.nodes.length === 0;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.nodes[index].f >= this.nodes[parentIndex].f) break;

      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.nodes.length;

    while (true) {
      const leftChildIndex = 2 * index + 1;
      const rightChildIndex = 2 * index + 2;
      let smallestIndex = index;

      if (leftChildIndex < length && this.nodes[leftChildIndex].f < this.nodes[smallestIndex].f) {
        smallestIndex = leftChildIndex;
      }

      if (rightChildIndex < length && this.nodes[rightChildIndex].f < this.nodes[smallestIndex].f) {
        smallestIndex = rightChildIndex;
      }

      if (smallestIndex === index) break;

      this.swap(index, smallestIndex);
      index = smallestIndex;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.nodes[i];
    this.nodes[i] = this.nodes[j];
    this.nodes[j] = temp;

    this.nodes[i].heapIndex = i;
    this.nodes[j].heapIndex = j;
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
  initDir?: { dx: number; dy: number },
): Array<{ x: number; y: number; layer: number }> | null {
  const resolution = 10;
  const startGridX = Math.round(startPt.x / resolution);
  const startGridY = Math.round(startPt.y / resolution);
  const endGridX = Math.round(endPt.x / resolution);
  const endGridY = Math.round(endPt.y / resolution);

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

    if (minD < 10) return Infinity;
    if (minD < 25) {
      return 1.5 * ((25 - minD) / 15) ** 2;
    }
    return 0;
  };

  const openHeap = new AStarMinHeap();
  const openSet = new Map<string, AStarNode3D>();
  const closedSet = new Set<string>();

  const startNode = new AStarNode3D(startGridX, startGridY, 0);
  if (initDir) {
    startNode.dir = initDir;
  }
  startNode.h = Math.abs(startGridX - endGridX) + Math.abs(startGridY - endGridY);
  startNode.f = startNode.h;
  openHeap.push(startNode);
  openSet.set(`${startGridX},${startGridY},0`, startNode);

  const directions = [
    { dx: 0, dy: -1, isDiag: false },
    { dx: 0, dy: 1, isDiag: false },
    { dx: -1, dy: 0, isDiag: false },
    { dx: 1, dy: 0, isDiag: false },
  ];

  let iterations = 0;
  const maxIterations = 6000;

  while (!openHeap.isEmpty()) {
    iterations++;
    if (iterations > maxIterations) {
      break;
    }

    const curr = openHeap.pop()!;
    openSet.delete(`${curr.x},${curr.y},${curr.layer}`);

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

          const val = channelOccupancyMap.get(occupancyKey) || 0;
          const countBase = val & 0xFF;
          let dirs = (val >> 8) & 0xF;
          const count = Math.min(countBase + 1, 0xFF);

          if (dx === 0 && dy === -1) dirs |= 1;
          else if (dx === 0 && dy === 1) dirs |= 2;
          else if (dx === -1 && dy === 0) dirs |= 4;
          else if (dx === 1 && dy === 0) dirs |= 8;

          channelOccupancyMap.set(occupancyKey, (dirs << 8) | count);
        }

        temp = temp.parent;
      }
      return path.reverse();
    }

    const neighbors: Array<{
      nx: number;
      ny: number;
      nLayer: number;
      stepCost: number;
      dir: { dx: number; dy: number };
    }> = [];

    for (const dir of directions) {
      const nx = curr.x + dir.dx;
      const ny = curr.y + dir.dy;

      if (nx < gridMinX || nx > gridMaxX || ny < gridMinY || ny > gridMaxY) {
        continue;
      }

      const gridKey = `${nx},${ny}`;
      if (blocked.has(gridKey) && !escapeCells.has(gridKey)) {
        continue;
      }

      const cCost = getClearanceCost(nx, ny);
      if (cCost === Infinity) {
        continue;
      }

      let stepCost = 1.0;
      stepCost += cCost;

      const hasTurned
        = (curr.dir.dx !== 0 || curr.dir.dy !== 0)
          && (curr.dir.dx !== dir.dx || curr.dir.dy !== dir.dy);
      if (hasTurned) {
        stepCost += 3.0;
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
            stepCost += 3.0;
          }
          else {
            stepCost += count * 0.3;
          }
        }

        const sideKeys: string[] = [];
        if (dir.dx !== 0 && dir.dy === 0) {
          sideKeys.push(`${nx},${ny - 1}`, `${nx},${ny + 1}`);
        }
        else if (dir.dy !== 0 && dir.dx === 0) {
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
              stepCost -= 0.04;
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
        dir: { dx: dir.dx, dy: dir.dy },
      });
    }

    const isTerminal
      = (curr.x === startGridX && curr.y === startGridY)
        || (curr.x === endGridX && curr.y === endGridY);
    if (!isTerminal) {
      neighbors.push({
        nx: curr.x,
        ny: curr.y,
        nLayer: 1 - curr.layer,
        stepCost: 8.0,
        dir: { dx: 0, dy: 0 },
      });
    }

    for (const neighbor of neighbors) {
      const nKey = `${neighbor.nx},${neighbor.ny},${neighbor.nLayer}`;
      if (closedSet.has(nKey)) {
        continue;
      }

      const gScore = curr.g + neighbor.stepCost;
      const hScore
        = Math.abs(neighbor.nx - endGridX)
          + Math.abs(neighbor.ny - endGridY)
          + (neighbor.nLayer !== 0 ? 3.0 : 0);
      const fScore = gScore + hScore;

      const existingNode = openSet.get(nKey);
      if (!existingNode) {
        const nNode = new AStarNode3D(neighbor.nx, neighbor.ny, neighbor.nLayer);
        nNode.g = gScore;
        nNode.h = hScore;
        nNode.f = fScore;
        nNode.parent = curr;
        nNode.dir = neighbor.dir;
        openHeap.push(nNode);
        openSet.set(nKey, nNode);
      }
      else if (gScore < existingNode.g) {
        existingNode.g = gScore;
        existingNode.f = fScore;
        existingNode.parent = curr;
        existingNode.dir = neighbor.dir;
        openHeap.update(existingNode);
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
  lane: number,
  boardOrigin?: BoardOrigin,
): Point[] {
  const channelSpacing = 12;
  const extDist = 20 + lane * channelSpacing;
  const { centerX: boardCenterX, centerY: boardCenterY, channels } = resolveBoardBounds(
    boardOrigin?.x,
    boardOrigin?.y,
  );

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

  const startSide = start.x < boardCenterX ? 'left' : 'right';
  const endSide = end.x < boardCenterX ? 'left' : 'right';

  if (startSide === endSide) {
    const channelOffset = lane * channelSpacing;

    if (startSide === 'left') {
      const xChan = channels.leftBus - channelOffset;
      points.push({ x: xChan, y: p1.y });
      points.push({ x: xChan, y: p2.y });
    }
    else {
      const xChan = channels.rightBus + channelOffset;
      points.push({ x: xChan, y: p1.y });
      points.push({ x: xChan, y: p2.y });
    }
  }
  else {
    const startAbove = start.y < boardCenterY;
    const bypassY = startAbove
      ? channels.topBus - lane * channelSpacing
      : channels.bottomBus + lane * channelSpacing;

    const xLeft = channels.leftBus;
    const xRight = channels.rightBus;

    if (startSide === 'left') {
      points.push({ x: xLeft, y: p1.y });
      points.push({ x: xLeft, y: bypassY });
      points.push({ x: xRight, y: bypassY });
      points.push({ x: xRight, y: p2.y });
    }
    else {
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

function generateChannelPath(
  start: Point,
  end: Point,
  startDir: 'left' | 'right' | 'up' | 'down',
  endDir: 'left' | 'right' | 'up' | 'down',
  lane: number,
  boardOrigin?: BoardOrigin,
): Point[] {
  const channelSpacing = 12;
  const { centerX: boardCenterX, centerY: boardCenterY, channels } = resolveBoardBounds(
    boardOrigin?.x,
    boardOrigin?.y,
  );

  const extDist = 15 + lane * channelSpacing;

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

  const isStartLeft = start.x < boardCenterX;
  const isEndLeft = end.x < boardCenterX;
  const isStartTop = start.y < boardCenterY;

  const laneOffset = lane * channelSpacing;

  if (isStartLeft && isEndLeft) {
    const xChan = channels.leftBus - laneOffset;
    points.push({ x: xChan, y: p1.y });
    points.push({ x: xChan, y: p2.y });
  }
  else if (!isStartLeft && !isEndLeft) {
    const xChan = channels.rightBus + laneOffset;
    points.push({ x: xChan, y: p1.y });
    points.push({ x: xChan, y: p2.y });
  }
  else {
    const startToEndY = end.y - start.y;
    const absDiffY = Math.abs(startToEndY);

    let bypassY: number;
    if (absDiffY < 60) {
      bypassY = boardCenterY + (isStartTop ? -60 : 60) + laneOffset;
    }
    else {
      bypassY = isStartTop ? channels.topBus - laneOffset : channels.bottomBus + laneOffset;
    }

    const xLeft = channels.leftBus;
    const xRight = channels.rightBus;

    if (isStartLeft) {
      points.push({ x: xLeft, y: p1.y });
      points.push({ x: xLeft, y: bypassY });
      points.push({ x: xRight, y: bypassY });
      points.push({ x: xRight, y: p2.y });
    }
    else {
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

function pointsToRoundedSvgPath(pts: Point[], radius: number = 8): string {
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

    const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
    const isOrthogonal = Math.abs(dot) < 0.1;

    if (isOrthogonal) {
      const r = Math.min(radius, len1 / 2, len2 / 2);

      const entryX = curr.x - (dx1 / len1) * r;
      const entryY = curr.y - (dy1 / len1) * r;
      const exitX = curr.x + (dx2 / len2) * r;
      const exitY = curr.y + (dy2 / len2) * r;

      d += ` L ${entryX} ${entryY}`;
      d += ` Q ${curr.x} ${curr.y} ${exitX} ${exitY}`;
    }
    else {
      d += ` L ${curr.x} ${curr.y}`;
    }
  }

  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

export function generateSmartPCBPathLegacy(
  start: Point,
  end: Point,
  startDir: 'left' | 'right' | 'up' | 'down',
  endDir: 'left' | 'right' | 'up' | 'down',
  lane: number,
  obstacles?: Obstacle[],
  channelOccupancyMap?: Map<string, number>,
  signalType?: 'digital' | 'i2c' | 'power',
  waypoints?: Point[],
  boardOrigin?: BoardOrigin,
): WirePathResult {
  let width = 2.2;
  switch (signalType) {
    case 'power':
      width = 3.5;
      break;
    case 'i2c':
      width = 1.5;
      break;
    case 'digital':
    default:
      width = 2.0;
      break;
  }

  const extDistStart = obstacles ? 25 + lane * 5 : 15 + lane * 4;
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
      const subPath = findAStarPath3D(
        segStart,
        segEnd,
        obstacles,
        channelOccupancyMap,
        currentInitDir,
      );

      if (subPath) {
        if (rawPath3D.length > 0 && subPath.length > 0) {
          rawPath3D = rawPath3D.concat(subPath.slice(1));
        }
        else {
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
          }
          else {
            currentInitDir = undefined;
          }
        }
        else {
          currentInitDir = undefined;
        }
      }
      else {
        routeSuccess = false;
        break;
      }
    }

    if (!routeSuccess) {
      rawPath3D = [];
    }
  }

  if (rawPath3D.length === 0) {
    const channel2D = generateChannelPath(start, end, startDir, endDir, lane, boardOrigin);
    rawPath3D = channel2D.map((p: Point) => ({ x: p.x, y: p.y, layer: 0 }));
  }
  else {
    rawPath3D = [
      { x: start.x, y: start.y, layer: 0 },
      ...rawPath3D,
      { x: p2.x, y: p2.y, layer: 0 },
      { x: end.x, y: end.y, layer: 0 },
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
      const d = pointsToRoundedSvgPath(simplified, 8);
      segments.push({
        d,
        layer: currentLayer,
      });

      currentLayer = pt.layer;
      currentPts = [{ x: pt.x, y: pt.y }];
    }
    else {
      currentPts.push({ x: pt.x, y: pt.y });
    }
  }

  if (currentPts.length > 0) {
    const simplified = simplifyPath(currentPts);
    const d = pointsToRoundedSvgPath(simplified, 8);
    segments.push({
      d,
      layer: currentLayer,
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
    teardrops,
  };
}

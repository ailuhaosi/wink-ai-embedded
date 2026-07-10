import { OBSTACLE_PADDING, ROUND_RADIUS } from './constants';
import { snapTrackCoord, resolveBypassEdgeX, verticalTrackCrossesObstacle } from './geometry';
import type { BoardOrigin, CardinalDirection, Obstacle, Point, WirePathResult } from './types';

export function simplifyPath(pts: Point[]): Point[] {
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
  return `M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')}`;
}

export function pointsToRoundedSvgPath(pts: Point[], radius: number = ROUND_RADIUS): string {
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

export function generateTeardropPath(
  pin: Point,
  nextPt: Point,
  padRadius = 5.5,
  length = 12,
): string {
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

export function buildWirePathResultFrom2D(
  start: Point,
  end: Point,
  p1: Point,
  p2: Point,
  path2D: Point[],
  signalType: 'digital' | 'i2c' | 'power' = 'digital',
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

  const simplified = simplifyPath(path2D);
  const d = pointsToRoundedSvgPath(simplified, ROUND_RADIUS);
  const teardrops: string[] = [];
  if (path2D.length > 2) {
    const tStart = generateTeardropPath(start, p1, 5.5, 12);
    if (tStart) teardrops.push(tStart);
    const tEnd = generateTeardropPath(end, p2, 5.5, 12);
    if (tEnd) teardrops.push(tEnd);
  }

  return {
    path: d,
    width,
    segments: [{ d, layer: 0 }],
    vias: [],
    teardrops,
  };
}

/** Star-bus tap: peripheral → horizontal power rail (top) → power node */
export function buildPowerBusTapPath2D(
  start: Point,
  nodePos: Point,
  railY: number,
  startDir: CardinalDirection,
  sourceObstacle?: Obstacle,
): Point[] {
  const ext = 14;
  const p1 = { x: start.x, y: start.y };
  if (startDir === 'left') p1.x -= ext;
  else if (startDir === 'right') p1.x += ext;
  else if (startDir === 'up') p1.y -= ext;
  else if (startDir === 'down') p1.y += ext;

  if (sourceObstacle) {
    if (startDir === 'left') {
      p1.x = Math.min(p1.x, sourceObstacle.x - OBSTACLE_PADDING);
    }
    else if (startDir === 'right') {
      p1.x = Math.max(p1.x, sourceObstacle.x + sourceObstacle.width + OBSTACLE_PADDING);
    }
    else if (startDir === 'up') {
      p1.y = Math.min(p1.y, sourceObstacle.y - OBSTACLE_PADDING);
    }
    else if (startDir === 'down') {
      p1.y = Math.max(p1.y, sourceObstacle.y + sourceObstacle.height + OBSTACLE_PADDING);
    }
  }

  if (
    sourceObstacle
    && verticalTrackCrossesObstacle(
      p1.x,
      Math.min(p1.y, railY),
      Math.max(p1.y, railY),
      sourceObstacle,
    )
  ) {
    const edgeX = resolveBypassEdgeX(sourceObstacle, nodePos.x);
    return [
      start,
      p1,
      { x: edgeX, y: snapTrackCoord(p1.y) },
      { x: edgeX, y: snapTrackCoord(railY) },
      { x: snapTrackCoord(nodePos.x), y: snapTrackCoord(railY) },
      nodePos,
    ];
  }

  const railTap = { x: p1.x, y: railY };
  const nodeApproach = { x: nodePos.x, y: railY };
  return [start, p1, railTap, nodeApproach, nodePos];
}

export function generatePowerBusTapPath(
  start: Point,
  nodePos: Point,
  railY: number,
  startDir: CardinalDirection,
  sourceObstacle?: Obstacle,
): WirePathResult {
  const path2D = buildPowerBusTapPath2D(start, nodePos, railY, startDir, sourceObstacle);
  const p1 = path2D[1];
  const p2 = { x: nodePos.x, y: railY };
  return buildWirePathResultFrom2D(start, nodePos, p1, p2, path2D, 'power');
}

/** Trunk: power node on top rail → route along board edge → board power pin */
export function generatePowerBusTrunkPath(
  nodePos: Point,
  boardPin: Point,
  railY: number,
  boardOrigin?: BoardOrigin,
  boardWidth = 180,
): WirePathResult {
  const bx = boardOrigin?.x ?? 310;
  const edgeX = boardPin.x < bx + boardWidth / 2 ? bx - 12 : bx + boardWidth + 12;
  const p1 = { x: nodePos.x, y: railY };
  const p2 = { x: edgeX, y: boardPin.y };
  const path2D = [nodePos, p1, { x: edgeX, y: railY }, p2, boardPin];
  return buildWirePathResultFrom2D(nodePos, boardPin, p1, p2, path2D, 'power');
}

import { GRID_SNAP, OBSTACLE_PADDING } from './constants';
import type { CardinalDirection, Obstacle, Point } from './types';

export function snapTrackCoord(v: number): number {
  return Math.round(v / GRID_SNAP) * GRID_SNAP;
}

export function pinCoord(v: number): number {
  return v;
}

export function rotateCardinalDirection(
  dir: CardinalDirection,
  angleDeg: number,
): CardinalDirection {
  const dirs: CardinalDirection[] = ['up', 'right', 'down', 'left'];
  const idx = dirs.indexOf(dir);
  if (idx < 0) return dir;
  const steps = (((Math.round(angleDeg / 90)) % 4) + 4) % 4;
  return dirs[(idx + steps) % 4];
}

export function expandObstacle(obs: Obstacle, padding = OBSTACLE_PADDING): Obstacle {
  return {
    x: obs.x - padding,
    y: obs.y - padding,
    width: obs.width + padding * 2,
    height: obs.height + padding * 2,
  };
}

export function segmentIntersectsObstacle(
  p1: Point,
  p2: Point,
  obstacles: Obstacle[],
  padding = OBSTACLE_PADDING,
): boolean {
  const expanded = obstacles.map((obs) => expandObstacle(obs, padding));

  for (const obs of expanded) {
    const left = obs.x;
    const right = obs.x + obs.width;
    const top = obs.y;
    const bottom = obs.y + obs.height;

    if (p1.x === p2.x) {
      const x = p1.x;
      if (x <= left || x >= right) continue;
      const segTop = Math.min(p1.y, p2.y);
      const segBottom = Math.max(p1.y, p2.y);
      if (segBottom > top && segTop < bottom) return true;
    } else if (p1.y === p2.y) {
      const y = p1.y;
      if (y <= top || y >= bottom) continue;
      const segLeft = Math.min(p1.x, p2.x);
      const segRight = Math.max(p1.x, p2.x);
      if (segRight > left && segLeft < right) return true;
    }
  }

  return false;
}

export function manhattanDistance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function classifyTopology(
  start: Point,
  end: Point,
  boardCenterX: number,
  localThreshold: number,
): 'same-side' | 'cross-side' | 'local' {
  const dist = manhattanDistance(start, end);
  const startLeft = start.x < boardCenterX;
  const endLeft = end.x < boardCenterX;

  if (dist < localThreshold && startLeft === endLeft) {
    return 'local';
  }
  if (startLeft === endLeft) {
    return 'same-side';
  }
  return 'cross-side';
}

export interface BoardBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export function resolveBoardBounds(
  boardOrigin: Point,
  width: number,
  height: number,
): BoardBounds {
  return {
    left: boardOrigin.x,
    right: boardOrigin.x + width,
    top: boardOrigin.y,
    bottom: boardOrigin.y + height,
    centerX: boardOrigin.x + width / 2,
    centerY: boardOrigin.y + height / 2,
  };
}

/**
 * HCTR endDir = direction of the final segment (p2 → pin).
 * Stub anchor p2 is placed at reverseDir(endDir), i.e. outward from the board edge.
 */
export function resolveBoardPinEndDir(end: Point, bounds: BoardBounds): CardinalDirection {
  return resolveOutwardDirFromNearestEdge(end, bounds, 'inward');
}

/**
 * HCTR startDir = direction the stub extends from the peripheral pin (p1).
 * Stub anchor p1 is placed outward from the nearest component edge.
 */
export function resolvePeripheralPinStartDir(pin: Point, bounds: BoardBounds): CardinalDirection {
  return resolveOutwardDirFromNearestEdge(pin, bounds, 'outward');
}

function resolveOutwardDirFromNearestEdge(
  point: Point,
  bounds: BoardBounds,
  mode: 'inward' | 'outward',
): CardinalDirection {
  const distLeft = Math.abs(point.x - bounds.left);
  const distRight = Math.abs(point.x - bounds.right);
  const distTop = Math.abs(point.y - bounds.top);
  const distBottom = Math.abs(point.y - bounds.bottom);
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  let outward: CardinalDirection;
  if (minDist === distLeft) outward = 'left';
  else if (minDist === distRight) outward = 'right';
  else if (minDist === distTop) outward = 'up';
  else outward = 'down';

  if (mode === 'outward') return outward;

  switch (outward) {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'up':
      return 'down';
    case 'down':
      return 'up';
  }
}

function dedupeCollinearPoints(points: Point[]): Point[] {
  if (points.length <= 2) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const last = result.length >= 2 ? result[result.length - 2] : null;
    if (last && ((last.x === prev.x && prev.x === curr.x) || (last.y === prev.y && prev.y === curr.y))) {
      result[result.length - 1] = curr;
    } else if (prev.x !== curr.x || prev.y !== curr.y) {
      result.push(curr);
    }
  }
  return result;
}

export interface RouteAroundOptions {
  /** Allow the final segment to enter the pin pad (board/peripheral landing). */
  skipLastSegment?: boolean;
  /** Allow the first segment to leave the pin pad. */
  skipFirstSegment?: boolean;
}

/** Reroute segments that cut through an obstacle body along the nearest outside edge. */
export function routePathAroundObstacle(
  points: Point[],
  obstacle: Obstacle,
  options: RouteAroundOptions = { skipLastSegment: true },
): Point[] {
  if (points.length < 2) return points;

  const expanded = expandObstacle(obstacle, OBSTACLE_PADDING);
  const edgeLeft = expanded.x;
  const edgeRight = expanded.x + expanded.width;
  const edgeTop = expanded.y;
  const edgeBottom = expanded.y + expanded.height;

  const result: Point[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const isPinLanding = options.skipLastSegment && i === points.length - 1;
    const isPinExit = options.skipFirstSegment && i === 1;

    if (
      !isPinLanding &&
      !isPinExit &&
      segmentIntersectsObstacle(prev, curr, [obstacle], 0)
    ) {
      const useLeftEdge = prev.x < obstacle.x + obstacle.width / 2;
      const edgeX = snapTrackCoord(useLeftEdge ? edgeLeft : edgeRight);

      const horizontalCross =
        prev.y === curr.y &&
        Math.min(prev.x, curr.x) < obstacle.x + obstacle.width &&
        Math.max(prev.x, curr.x) > obstacle.x;
      const verticalCross =
        prev.x === curr.x &&
        Math.min(prev.y, curr.y) < obstacle.y + obstacle.height &&
        Math.max(prev.y, curr.y) > obstacle.y;

      if (horizontalCross) {
        if (prev.x !== edgeX) {
          result.push({ x: edgeX, y: snapTrackCoord(prev.y) });
        }
        if (result[result.length - 1].y !== curr.y) {
          result.push({ x: edgeX, y: snapTrackCoord(curr.y) });
        }
      } else if (verticalCross) {
        // Detour via left/right edge (not top/bottom) when a vertical segment cuts through the body.
        if (prev.x !== edgeX) {
          result.push({ x: edgeX, y: snapTrackCoord(prev.y) });
        }
        if (result[result.length - 1].y !== curr.y) {
          result.push({ x: edgeX, y: snapTrackCoord(curr.y) });
        }
      }
    }

    const tail = result[result.length - 1];
    if (tail.x !== curr.x || tail.y !== curr.y) {
      result.push(curr);
    }
  }

  return dedupeCollinearPoints(result);
}

/** @deprecated Use routePathAroundObstacle — kept for call-site clarity at board end. */
export function routePathAroundBoard(
  points: Point[],
  board: Obstacle,
  _end: Point,
): Point[] {
  return routePathAroundObstacle(points, board, { skipLastSegment: true });
}

export function isPinNearBottomEdge(pin: Point, obstacle: Obstacle, margin = 24): boolean {
  const bottom = obstacle.y + obstacle.height;
  return pin.y >= bottom - margin;
}

/** True when a vertical track at trackX spans the obstacle body in Y. */
export function verticalTrackCrossesObstacle(
  trackX: number,
  yA: number,
  yB: number,
  obstacle: Obstacle,
): boolean {
  const xInside = trackX > obstacle.x && trackX < obstacle.x + obstacle.width;
  if (!xInside) return false;
  const yLo = Math.min(yA, yB);
  const yHi = Math.max(yA, yB);
  return yLo < obstacle.y + obstacle.height && yHi > obstacle.y;
}

/** Pick left or right bypass edge based on where the wire approaches from (bus / power node). */
export function resolveBypassEdgeX(obstacle: Obstacle, approachX: number): number {
  const pad = OBSTACLE_PADDING;
  const left = obstacle.x - pad;
  const right = obstacle.x + obstacle.width + pad;
  const centerX = obstacle.x + obstacle.width / 2;
  return snapTrackCoord(approachX >= centerX ? right : left);
}

/**
 * Bottom-edge pin fed from an upper track: route down the outside left/right edge,
 * then connect to the vertical bus — avoids dropping through the component body.
 */
export function buildBottomPinSideApproachPath(
  start: Point,
  p1: Point,
  trackX: number,
  p2y: number,
  p2: Point,
  end: Point,
  obstacle: Obstacle,
): Point[] {
  const edgeX = resolveBypassEdgeX(obstacle, trackX);
  const yStub = snapTrackCoord(p1.y);
  const yTrack = snapTrackCoord(p2y);
  const busX = snapTrackCoord(trackX);

  return dedupeCollinearPoints([
    start,
    p1,
    { x: edgeX, y: yStub },
    { x: edgeX, y: yTrack },
    { x: busX, y: yTrack },
    p2,
    end,
  ]);
}

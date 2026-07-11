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
  const expanded = obstacles.map(obs => expandObstacle(obs, padding));

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
    }
    else if (p1.y === p2.y) {
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

export type BoardPinEdge = 'left' | 'right' | 'top' | 'bottom';

const BOARD_PIN_EDGE_MARGIN = 24;

/** True when the point sits on a board header edge (within margin). */
export function pinTouchesBoardEdge(pin: Point, bounds: BoardBounds): boolean {
  if (pin.x < bounds.left - 1 || pin.x > bounds.right + 1) return false;
  if (pin.y < bounds.top - 1 || pin.y > bounds.bottom + 1) return false;
  const distEdge = Math.min(
    pin.x - bounds.left,
    bounds.right - pin.x,
    pin.y - bounds.top,
    bounds.bottom - pin.y,
  );
  return distEdge <= BOARD_PIN_EDGE_MARGIN;
}

/** Classify a board pin by its header edge (column/row), not euclidean nearest edge. */
export function resolveBoardPinEdge(pin: Point, bounds: BoardBounds): BoardPinEdge {
  const fromLeft = pin.x - bounds.left;
  const fromRight = bounds.right - pin.x;
  const fromTop = pin.y - bounds.top;
  const fromBottom = bounds.bottom - pin.y;

  if (fromLeft <= BOARD_PIN_EDGE_MARGIN && fromLeft <= fromRight) return 'left';
  if (fromRight <= BOARD_PIN_EDGE_MARGIN && fromRight <= fromLeft) return 'right';
  if (fromTop <= BOARD_PIN_EDGE_MARGIN && fromTop <= fromBottom) return 'top';
  return 'bottom';
}

/** Stub anchor outside the pin, on the allowed approach side. */
export function resolveBoardPinApproachPoint(
  pin: Point,
  bounds: BoardBounds,
  stubLength = 18,
): Point {
  switch (resolveBoardPinEdge(pin, bounds)) {
    case 'left':
      return { x: pinCoord(pin.x - stubLength), y: pinCoord(pin.y) };
    case 'right':
      return { x: pinCoord(pin.x + stubLength), y: pinCoord(pin.y) };
    case 'top':
      return { x: pinCoord(pin.x), y: pinCoord(pin.y - stubLength) };
    case 'bottom':
      return { x: pinCoord(pin.x), y: pinCoord(pin.y + stubLength) };
  }
}

/** Routing channel coordinate just outside the given board edge. */
export function boardEdgeChannelCoord(
  bounds: BoardBounds,
  edge: BoardPinEdge,
  offset = 12,
): number {
  switch (edge) {
    case 'left':
      return snapTrackCoord(bounds.left - offset);
    case 'right':
      return snapTrackCoord(bounds.right + offset);
    case 'top':
      return snapTrackCoord(bounds.top - offset);
    case 'bottom':
      return snapTrackCoord(bounds.bottom + offset);
  }
}

/**
 * HCTR endDir = direction of the final segment (p2 → pin).
 * Stub anchor p2 is placed at reverseDir(endDir), i.e. outward from the board edge.
 */
export function resolveBoardPinEndDir(end: Point, bounds: BoardBounds): CardinalDirection {
  switch (resolveBoardPinEdge(end, bounds)) {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'top':
      return 'down';
    case 'bottom':
      return 'up';
  }
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
    }
    else if (prev.x !== curr.x || prev.y !== curr.y) {
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

  const result: Point[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const isPinLanding = options.skipLastSegment && i === points.length - 1;
    const isPinExit = options.skipFirstSegment && i === 1;

    if (
      !isPinLanding
      && !isPinExit
      && segmentIntersectsObstacle(prev, curr, [obstacle], 0)
    ) {
      const useLeftEdge = prev.x < obstacle.x + obstacle.width / 2;
      const edgeX = snapTrackCoord(useLeftEdge ? edgeLeft : edgeRight);

      const horizontalCross
        = prev.y === curr.y
          && Math.min(prev.x, curr.x) < obstacle.x + obstacle.width
          && Math.max(prev.x, curr.x) > obstacle.x;
      const verticalCross
        = prev.x === curr.x
          && Math.min(prev.y, curr.y) < obstacle.y + obstacle.height
          && Math.max(prev.y, curr.y) > obstacle.y;

      if (horizontalCross) {
        const overY = snapTrackCoord(expanded.y - 4);
        const underY = snapTrackCoord(expanded.y + expanded.height + 4);
        const bypassY = prev.y <= obstacle.y + obstacle.height / 2 ? overY : underY;

        if (prev.x !== edgeX) {
          result.push({ x: edgeX, y: snapTrackCoord(prev.y) });
        }
        result.push({ x: edgeX, y: bypassY });
        const targetX = snapTrackCoord(curr.x);
        result.push({ x: targetX, y: bypassY });
        if (bypassY !== curr.y) {
          result.push({ x: targetX, y: snapTrackCoord(curr.y) });
        }
      }
      else if (verticalCross) {
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

/** Force the final approach segment to enter the pin from its header edge only. */
export function normalizeBoardPinLanding(
  points: Point[],
  pin: Point,
  bounds: BoardBounds,
  stubLength = 18,
): Point[] {
  if (points.length < 2) return points;

  const approach = resolveBoardPinApproachPoint(pin, bounds, stubLength);
  const edge = resolveBoardPinEdge(pin, bounds);
  const result = points.slice(0, -1);
  const prev = result[result.length - 1] ?? points[0];

  if (edge === 'left' || edge === 'right') {
    if (prev.y !== approach.y) {
      result.push({ x: prev.x, y: approach.y });
    }
    const tail = result[result.length - 1];
    if (tail.x !== approach.x) {
      result.push({ x: approach.x, y: approach.y });
    }
  }
  else {
    if (prev.x !== approach.x) {
      result.push({ x: approach.x, y: prev.y });
    }
    const tail = result[result.length - 1];
    if (tail.y !== approach.y) {
      result.push({ x: approach.x, y: approach.y });
    }
  }

  result.push({ x: pin.x, y: pin.y });
  if (result.length <= 3) return result;
  const landing = result.slice(-2);
  const body = dedupeCollinearPoints(result.slice(0, -2));
  return [...body, ...landing];
}

/** Reroute interior segments clear of all given obstacles (pin stubs exempt at ends). */
export function routePathClearOfObstacles(
  points: Point[],
  obstacles: Obstacle[],
  options: RouteAroundOptions = { skipFirstSegment: true, skipLastSegment: true },
): Point[] {
  let result = points;
  for (const obstacle of obstacles) {
    for (let pass = 0; pass < 4; pass++) {
      const next = routePathAroundObstacle(result, obstacle, options);
      const unchanged = next.length === result.length
        && next.every((p, i) => p.x === result[i].x && p.y === result[i].y);
      result = next;
      if (unchanged) break;
    }
  }
  return result;
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

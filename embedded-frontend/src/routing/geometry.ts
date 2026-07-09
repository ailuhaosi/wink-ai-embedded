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
  const distLeft = Math.abs(end.x - bounds.left);
  const distRight = Math.abs(end.x - bounds.right);
  const distTop = Math.abs(end.y - bounds.top);
  const distBottom = Math.abs(end.y - bounds.bottom);
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  if (minDist === distLeft) return 'right';
  if (minDist === distRight) return 'left';
  if (minDist === distTop) return 'down';
  return 'up';
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

/** Reroute segments that cut through the board body along the nearest outside edge. */
export function routePathAroundBoard(
  points: Point[],
  board: Obstacle,
  end: Point,
): Point[] {
  if (points.length < 2) return points;

  const expanded = expandObstacle(board, OBSTACLE_PADDING);
  const edgeLeft = expanded.x;
  const edgeRight = expanded.x + expanded.width;
  const edgeTop = expanded.y;
  const edgeBottom = expanded.y + expanded.height;

  const result: Point[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const isPinLanding = i === points.length - 1;

    if (
      !isPinLanding &&
      segmentIntersectsObstacle(prev, curr, [board], 0)
    ) {
      const useLeftEdge = prev.x < board.x + board.width / 2;
      const edgeX = snapTrackCoord(useLeftEdge ? edgeLeft : edgeRight);

      if (prev.x !== edgeX) {
        result.push({ x: edgeX, y: snapTrackCoord(prev.y) });
      }
      if (result[result.length - 1].y !== curr.y) {
        result.push({ x: edgeX, y: snapTrackCoord(curr.y) });
      }
    }

    const tail = result[result.length - 1];
    if (tail.x !== curr.x || tail.y !== curr.y) {
      result.push(curr);
    }
  }

  return dedupeCollinearPoints(result);
}

import { LOCAL_THRESHOLD } from './constants';
import {
  buildBottomPinSideApproachPath,
  classifyTopology,
  isPinNearBottomEdge,
  manhattanDistance,
  pinCoord,
  routePathAroundObstacle,
  segmentIntersectsObstacle,
  snapTrackCoord,
  verticalTrackCrossesObstacle,
} from './geometry'; import type {
  CardinalDirection,
  Obstacle,
  Point,
  TrackAssignment,
  WireTopology,
} from './types';

export interface TemplateInput {
  start: Point;
  end: Point;
  startDir: CardinalDirection;
  endDir: CardinalDirection;
  assignment: TrackAssignment;
  boardCenterX: number;
  obstacles: Obstacle[];
}

function extendStub(
  point: Point,
  dir: CardinalDirection,
  length: number,
): Point {
  switch (dir) {
    case 'left':
      return { x: pinCoord(point.x - length), y: pinCoord(point.y) };
    case 'right':
      return { x: pinCoord(point.x + length), y: pinCoord(point.y) };
    case 'up':
      return { x: pinCoord(point.x), y: pinCoord(point.y - length) };
    case 'down':
      return { x: pinCoord(point.x), y: pinCoord(point.y + length) };
  }
}

function reverseDir(dir: CardinalDirection): CardinalDirection {
  switch (dir) {
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

function canSeeEnd(start: Point, end: Point, startDir: CardinalDirection): boolean {
  switch (startDir) {
    case 'left':
      return end.x <= start.x;
    case 'right':
      return end.x >= start.x;
    case 'up':
      return end.y <= start.y;
    case 'down':
      return end.y >= start.y;
  }
}

function countBends(points: Point[]): number {
  if (points.length < 3) return 0;
  let bends = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const hv = prev.x === curr.x && curr.y === next.y;
    const vh = prev.y === curr.y && curr.x === next.x;
    if (!hv && !vh) bends++;
  }
  return bends;
}

function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += manhattanDistance(points[i], points[i + 1]);
  }
  return len;
}

function isOrthogonalPath(points: Point[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (p1.x !== p2.x && p1.y !== p2.y) return false;
  }
  return true;
}

function findObstacleNear(obstacles: Obstacle[], point: Point): Obstacle | null {
  for (const obs of obstacles) {
    const margin = 24;
    if (
      point.x >= obs.x - margin
      && point.x <= obs.x + obs.width + margin
      && point.y >= obs.y - margin
      && point.y <= obs.y + obs.height + margin
    ) {
      return obs;
    }
  }
  return null;
}

function finalizeTemplatePath(
  points: Point[],
  obstacles: Obstacle[],
  start: Point,
  end: Point,
): Point[] {
  let result = points;
  const endObstacle = findObstacleNear(obstacles, end);
  const startObstacle = findObstacleNear(obstacles, start);

  if (endObstacle) {
    result = routePathAroundObstacle(result, endObstacle, { skipLastSegment: true });
  }
  if (startObstacle) {
    result = routePathAroundObstacle(result, startObstacle, {
      skipFirstSegment: true,
      skipLastSegment: false,
    });
  }
  return result;
}

export function buildStubPoints(
  start: Point,
  end: Point,
  startDir: CardinalDirection,
  endDir: CardinalDirection,
  assignment: TrackAssignment,
): { p1: Point; p2: Point } {
  const p1 = extendStub(start, startDir, assignment.stubLengthStart);
  const p2 = extendStub(end, reverseDir(endDir), assignment.stubLengthEnd);
  return { p1, p2 };
}

export function templateLocal(input: TemplateInput): Point[] | null {
  const { start, end, startDir, obstacles, assignment } = input;
  const dist = manhattanDistance(start, end);

  if (dist >= LOCAL_THRESHOLD) return null;
  if (!canSeeEnd(start, end, startDir)) return null;

  const { p1, p2 } = buildStubPoints(
    start,
    end,
    startDir,
    input.endDir,
    assignment,
  );

  const candidates: Point[][] = [
    [start, p1, { x: pinCoord(end.x), y: pinCoord(p1.y) }, p2, end],
    [start, p1, { x: pinCoord(p1.x), y: pinCoord(end.y) }, p2, end],
  ];

  const valid = candidates.filter((points) => {
    for (let i = 0; i < points.length - 1; i++) {
      if (segmentIntersectsObstacle(points[i], points[i + 1], obstacles)) {
        return false;
      }
    }
    return true;
  });

  if (valid.length === 0) return null;

  valid.sort((a, b) => {
    const bendDiff = countBends(a) - countBends(b);
    if (bendDiff !== 0) return bendDiff;
    return pathLength(a) - pathLength(b);
  });

  return valid[0];
}

function needsBottomPinSideApproach(
  start: Point,
  p1: Point,
  trackX: number,
  p2y: number,
  obstacle: Obstacle,
  startDir: CardinalDirection,
): boolean {
  if (startDir !== 'down' && !isPinNearBottomEdge(start, obstacle)) {
    return false;
  }
  return verticalTrackCrossesObstacle(trackX, p1.y, p2y, obstacle);
}

export function templateSameSide(input: TemplateInput): Point[] {
  const { start, end, startDir, endDir, assignment, obstacles } = input;
  const trackX = snapTrackCoord(assignment.verticalTrackX ?? start.x);
  const { p1, p2 } = buildStubPoints(start, end, startDir, endDir, assignment);
  const p2y = snapTrackCoord(p2.y);
  const startObstacle = findObstacleNear(obstacles, start);

  if (startObstacle && needsBottomPinSideApproach(start, p1, trackX, p2y, startObstacle, startDir)) {
    return finalizeTemplatePath(
      buildBottomPinSideApproachPath(start, p1, trackX, p2y, p2, end, startObstacle),
      obstacles,
      start,
      end,
    );
  }

  return finalizeTemplatePath(
    [
      start,
      p1,
      { x: trackX, y: snapTrackCoord(p1.y) },
      { x: trackX, y: snapTrackCoord(p2.y) },
      p2,
      end,
    ],
    obstacles,
    start,
    end,
  );
}

export function templateCrossSide(input: TemplateInput): Point[] {
  const { start, end, startDir, endDir, assignment, obstacles } = input;
  const { p1, p2 } = buildStubPoints(start, end, startDir, endDir, assignment);

  const startLeft = start.x <= input.boardCenterX;
  const entryTrackX = snapTrackCoord(assignment.verticalTrackX ?? (startLeft ? start.x : end.x));
  const exitTrackX = snapTrackCoord(
    assignment.exitTrackX ?? (startLeft ? entryTrackX + 90 : entryTrackX - 90),
  );
  const bypassY = snapTrackCoord(assignment.horizontalTrackY ?? p1.y);

  if (startLeft) {
    return finalizeTemplatePath(
      [
        start,
        p1,
        { x: entryTrackX, y: snapTrackCoord(p1.y) },
        { x: entryTrackX, y: bypassY },
        { x: exitTrackX, y: bypassY },
        { x: exitTrackX, y: snapTrackCoord(p2.y) },
        p2,
        end,
      ],
      obstacles,
      start,
      end,
    );
  }

  return finalizeTemplatePath(
    [
      start,
      p1,
      { x: exitTrackX, y: snapTrackCoord(p1.y) },
      { x: exitTrackX, y: bypassY },
      { x: entryTrackX, y: bypassY },
      { x: entryTrackX, y: snapTrackCoord(p2.y) },
      p2,
      end,
    ],
    obstacles,
    start,
    end,
  );
}

export function buildTemplatePath(
  topology: WireTopology,
  input: TemplateInput,
): Point[] {
  if (topology === 'local') {
    const local = templateLocal(input);
    if (local) return local;
    return templateSameSide(input);
  }
  if (topology === 'same-side') {
    return templateSameSide(input);
  }
  return templateCrossSide(input);
}

export function countTemplateBends(points: Point[]): number {
  return countBends(points);
}

export function isOrthogonal(points: Point[]): boolean {
  return isOrthogonalPath(points);
}

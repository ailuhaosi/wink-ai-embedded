import { GRID_SNAP, MAX_BUMP_COUNT, TRACK_SPACING } from './constants';
import { segmentIntersectsObstacle, snapTrackCoord } from './geometry';
import { extractSegmentsFromPoints } from './segment-occupancy';
import type { SegmentOccupancyRegistry } from './segment-occupancy';
import type { Obstacle, Point, TrackAssignment } from './types';

export interface ResolveConflictOptions {
  points: Point[];
  wireId: string;
  assignment: TrackAssignment;
  obstacles: Obstacle[];
  occupancy: SegmentOccupancyRegistry;
  viewport?: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface ResolveConflictResult {
  points: Point[];
  resolved: boolean;
  bumpCount: number;
}

function inViewport(x: number, y: number, viewport?: ResolveConflictOptions['viewport']): boolean {
  if (!viewport) return true;
  return x >= viewport.minX && x <= viewport.maxX && y >= viewport.minY && y <= viewport.maxY;
}

function pathHasObstacleCollision(points: Point[], obstacles: Obstacle[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsObstacle(points[i], points[i + 1], obstacles)) {
      return true;
    }
  }
  return false;
}

function pathHasOccupancyConflict(
  points: Point[],
  wireId: string,
  occupancy: SegmentOccupancyRegistry,
): boolean {
  const segments = extractSegmentsFromPoints(wireId, points);
  return segments.some(segment => occupancy.hasConflict(segment));
}

function bumpAssignment(
  assignment: TrackAssignment,
  attempt: number,
  direction: 1 | -1,
): TrackAssignment {
  const next = { ...assignment };
  const delta = direction * TRACK_SPACING;

  if (next.topology === 'cross-side') {
    if (attempt % 2 === 0 && next.verticalTrackX !== undefined) {
      next.verticalTrackX = snapTrackCoord(next.verticalTrackX + delta);
    }
    else if (next.exitTrackX !== undefined) {
      next.exitTrackX = snapTrackCoord(next.exitTrackX - delta);
    }
    else if (next.horizontalTrackY !== undefined) {
      const bumpDir = next.bypassSide === 'top' ? -GRID_SNAP : GRID_SNAP;
      next.horizontalTrackY = snapTrackCoord(next.horizontalTrackY + bumpDir);
    }
  }
  else if (next.verticalTrackX !== undefined) {
    const isLeft = next.verticalTrackX < 400;
    next.verticalTrackX = snapTrackCoord(next.verticalTrackX + (isLeft ? -delta : delta));
  }

  next.stubLengthStart = next.stubLengthStart + GRID_SNAP;
  next.stubLengthEnd = next.stubLengthEnd + GRID_SNAP;
  return next;
}

export function resolveConflicts(
  options: ResolveConflictOptions,
  rebuildPath: (assignment: TrackAssignment) => Point[],
): ResolveConflictResult {
  let assignment = { ...options.assignment };
  let points = options.points;
  let bumpCount = 0;

  if (
    !pathHasObstacleCollision(points, options.obstacles)
    && !pathHasOccupancyConflict(points, options.wireId, options.occupancy)
  ) {
    return { points, resolved: true, bumpCount: 0 };
  }

  while (bumpCount < MAX_BUMP_COUNT) {
    bumpCount++;
    const direction: 1 | -1 = bumpCount % 2 === 0 ? -1 : 1;
    assignment = bumpAssignment(assignment, bumpCount, direction);
    points = rebuildPath(assignment);

    const trackX = assignment.verticalTrackX ?? 0;
    const trackY = assignment.horizontalTrackY ?? 0;
    if (!inViewport(trackX, trackY, options.viewport)) {
      continue;
    }

    if (
      !pathHasObstacleCollision(points, options.obstacles)
      && !pathHasOccupancyConflict(points, options.wireId, options.occupancy)
    ) {
      return { points, resolved: true, bumpCount };
    }
  }

  return { points, resolved: false, bumpCount };
}

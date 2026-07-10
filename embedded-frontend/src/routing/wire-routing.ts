import { LOCAL_THRESHOLD } from './constants';
import { resolveConflicts } from './conflict-resolver';
import { classifyTopology } from './geometry';
import { buildStubPoints, buildTemplatePath } from './path-templates';
import { buildWirePathResultFrom2D } from './post-process';
import { extractSegmentsFromPoints, SegmentOccupancyRegistry } from './segment-occupancy';
import { generateSmartPCBPathLegacy } from './wire-routing-legacy';
import type {
  BoardOrigin,
  CardinalDirection,
  Obstacle,
  Point,
  TrackAssignment,
  WirePathResult,
  WireTopology,
} from './types';

export interface GenerateWirePathOptions {
  start: Point;
  end: Point;
  startDir: CardinalDirection;
  endDir: CardinalDirection;
  wireId: string;
  signalType: 'digital' | 'i2c' | 'power';
  assignment: TrackAssignment;
  obstacles: Obstacle[];
  occupancy: SegmentOccupancyRegistry;
  waypoints?: Point[];
  forcedPoints?: Point[];
  boardOrigin?: BoardOrigin;
  boardCenterX: number;
  lane?: number;
  channelOccupancyMap?: Map<string, number>;
}

function warnDeprecatedChannelMap(channelOccupancyMap?: Map<string, number>): void {
  if (import.meta.env.DEV && channelOccupancyMap) {
    console.warn(
      '[wire-routing] channelOccupancyMap is deprecated and ignored by HCTR; use SegmentOccupancyRegistry.',
    );
  }
}

function buildManualPath(
  start: Point,
  end: Point,
  startDir: CardinalDirection,
  endDir: CardinalDirection,
  assignment: TrackAssignment,
  waypoints: Point[],
): Point[] {
  const { p1, p2 } = buildStubPoints(start, end, startDir, endDir, assignment);
  return [start, p1, ...waypoints, p2, end];
}

function resolveTopology(
  start: Point,
  end: Point,
  boardCenterX: number,
  _obstacles: Obstacle[],
  assignment: TrackAssignment,
  _startDir: CardinalDirection,
  _endDir: CardinalDirection,
): WireTopology {
  if (assignment.topology === 'local' || assignment.topology === 'same-side' || assignment.topology === 'cross-side') {
    const classified = classifyTopology(start, end, boardCenterX, LOCAL_THRESHOLD);
    if (classified === 'local') return 'local';
    if (assignment.topology === 'cross-side') return 'cross-side';
    return classified === 'cross-side' ? 'cross-side' : 'same-side';
  }
  return assignment.topology;
}

export function generateWirePath(options: GenerateWirePathOptions): WirePathResult {
  warnDeprecatedChannelMap(options.channelOccupancyMap);

  if (options.start.x === options.end.x && options.start.y === options.end.y) {
    return buildWirePathResultFrom2D(
      options.start,
      options.end,
      options.start,
      options.end,
      [options.start],
      options.signalType,
    );
  }

  const manualPoints = options.forcedPoints ?? options.waypoints;
  if (manualPoints && manualPoints.length > 0) {
    const path2D = buildManualPath(
      options.start,
      options.end,
      options.startDir,
      options.endDir,
      options.assignment,
      manualPoints,
    );
    const { p1, p2 } = buildStubPoints(
      options.start,
      options.end,
      options.startDir,
      options.endDir,
      options.assignment,
    );
    return buildWirePathResultFrom2D(
      options.start,
      options.end,
      p1,
      p2,
      path2D,
      options.signalType,
    );
  }

  const topology = resolveTopology(
    options.start,
    options.end,
    options.boardCenterX,
    options.obstacles,
    options.assignment,
    options.startDir,
    options.endDir,
  );

  const rebuild = (assignment: TrackAssignment) =>
    buildTemplatePath(topology, {
      start: options.start,
      end: options.end,
      startDir: options.startDir,
      endDir: options.endDir,
      assignment,
      boardCenterX: options.boardCenterX,
      obstacles: options.obstacles,
    });

  let path2D = rebuild(options.assignment);
  const resolved = resolveConflicts(
    {
      points: path2D,
      wireId: options.wireId,
      assignment: options.assignment,
      obstacles: options.obstacles,
      occupancy: options.occupancy,
    },
    rebuild,
  );

  if (!resolved.resolved) {
    return generateSmartPCBPathLegacy(
      options.start,
      options.end,
      options.startDir,
      options.endDir,
      options.lane ?? 0,
      options.obstacles,
      options.channelOccupancyMap,
      options.signalType,
      options.waypoints,
      options.boardOrigin,
    );
  }

  path2D = resolved.points;
  const segments = extractSegmentsFromPoints(options.wireId, path2D);
  for (const segment of segments) {
    options.occupancy.register(segment);
  }

  const { p1, p2 } = buildStubPoints(
    options.start,
    options.end,
    options.startDir,
    options.endDir,
    options.assignment,
  );

  return buildWirePathResultFrom2D(
    options.start,
    options.end,
    p1,
    p2,
    path2D,
    options.signalType,
  );
}

export function generateSmartPCBPath(
  start: Point,
  end: Point,
  startDir: CardinalDirection,
  endDir: CardinalDirection,
  lane: number,
  obstacles?: Obstacle[],
  channelOccupancyMap?: Map<string, number>,
  signalType?: 'digital' | 'i2c' | 'power',
  waypoints?: Point[],
  boardOrigin?: BoardOrigin,
): WirePathResult {
  const occupancy = new SegmentOccupancyRegistry();
  const boardX = boardOrigin?.x ?? 310;
  const boardY = boardOrigin?.y ?? 130;
  const boardCenterX = boardX + 90;

  return generateWirePath({
    start,
    end,
    startDir,
    endDir,
    wireId: `legacy-${start.x}-${start.y}-${end.x}-${end.y}`,
    signalType: signalType ?? 'digital',
    assignment: {
      wireId: 'legacy',
      topology: 'cross-side',
      priority: 2,
      stubLengthStart: 18 + lane * 4,
      stubLengthEnd: 18 + lane * 4,
      verticalTrackX: boardX - 45 - lane * 10,
      exitTrackX: boardX + 180 + 45 + lane * 10,
      horizontalTrackY: boardY - 55 - lane * 10,
    },
    obstacles: obstacles ?? [],
    occupancy,
    waypoints,
    boardOrigin,
    boardCenterX,
    lane,
    channelOccupancyMap,
  });
}

export {
  generatePowerBusTapPath,
  generatePowerBusTrunkPath,
  pointsToRoundedSvgPath,
  pointsToSvgPath,
} from './post-process';

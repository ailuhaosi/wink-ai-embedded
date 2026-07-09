import { describe, expect, it } from 'vitest';
import { boardDescriptor } from '../../types/peripheral-pins';
import { OBSTACLE_PADDING } from '../constants';
import {
  resolveBoardBounds,
  resolveBoardPinEndDir,
  resolvePeripheralPinStartDir,
  routePathAroundBoard,
  routePathAroundObstacle,
  segmentIntersectsObstacle,
  verticalTrackCrossesObstacle,
} from '../geometry';
import { buildPowerBusTapPath2D } from '../post-process';
import { buildStubPoints, templateSameSide } from '../path-templates';
import { buildTrackAssignments } from '../track-allocator';
import { generateWirePath } from '../wire-routing';
import { SegmentOccupancyRegistry } from '../segment-occupancy';
import type { WireRouteRequest } from '../types';

const BOARD_X = boardDescriptor.x;
const BOARD_Y = boardDescriptor.y;
const BOARD_ORIGIN = { x: BOARD_X, y: BOARD_Y };
const BOARD_CENTER_X = BOARD_X + boardDescriptor.width / 2;
const BOARD_CENTER_Y = BOARD_Y + boardDescriptor.height / 2;
const BOARD_BOUNDS = resolveBoardBounds(BOARD_ORIGIN, boardDescriptor.width, boardDescriptor.height);
const BOARD_OBSTACLE = {
  x: BOARD_X,
  y: BOARD_Y,
  width: boardDescriptor.width,
  height: boardDescriptor.height,
};

function interiorCrossesObstacle(
  points: Array<{ x: number; y: number }>,
  obstacle: { x: number; y: number; width: number; height: number },
): boolean {
  // Allow the first stub segment leaving the pin pad.
  for (let i = 1; i < points.length - 2; i++) {
    if (segmentIntersectsObstacle(points[i], points[i + 1], [obstacle], 0)) {
      return true;
    }
  }
  return false;
}

function interiorCrossesBoard(points: Array<{ x: number; y: number }>): boolean {
  return interiorCrossesObstacle(points, BOARD_OBSTACLE);
}

describe('board edge routing', () => {
  it('resolveBoardPinEndDir places stub anchor outside left-edge pins', () => {
    const pin = { x: 317, y: 192 };
    const endDir = resolveBoardPinEndDir(pin, BOARD_BOUNDS);
    expect(endDir).toBe('right');

    const { p2 } = buildStubPoints(pin, pin, 'down', endDir, {
      wireId: 't',
      topology: 'same-side',
      priority: 2,
      stubLengthStart: 18,
      stubLengthEnd: 18,
    });
    expect(p2.x).toBeLessThan(BOARD_BOUNDS.left);
  });

  it('resolveBoardPinEndDir places stub anchor outside right-edge pins', () => {
    const pin = { x: 487, y: 162 };
    const endDir = resolveBoardPinEndDir(pin, BOARD_BOUNDS);
    expect(endDir).toBe('left');

    const { p2 } = buildStubPoints(pin, pin, 'down', endDir, {
      wireId: 't',
      topology: 'same-side',
      priority: 2,
      stubLengthStart: 18,
      stubLengthEnd: 18,
    });
    expect(p2.x).toBeGreaterThan(BOARD_BOUNDS.right);
  });

  it('default LED → GPIO13 path does not cut through board interior', () => {
    const start = { x: 130, y: 150 };
    const end = { x: 317, y: 192 };
    const endDir = resolveBoardPinEndDir(end, BOARD_BOUNDS);
    const requests: WireRouteRequest[] = [
      {
        wireId: 'led-primary',
        start,
        end,
        startDir: 'down',
        endDir,
        priority: 2,
        channel: 'left',
        signalType: 'digital',
      },
    ];
    const channels = {
      leftBus: BOARD_X - 45,
      rightBus: BOARD_X + boardDescriptor.width + 45,
      topBus: BOARD_Y - 55,
      bottomBus: BOARD_Y + boardDescriptor.height + 55,
      powerRailY: BOARD_Y - 50,
    };
    const assignments = buildTrackAssignments(requests, channels, BOARD_CENTER_X, BOARD_CENTER_Y);

    const result = generateWirePath({
      start,
      end,
      startDir: 'down',
      endDir,
      wireId: 'led-primary',
      signalType: 'digital',
      assignment: assignments.get('led-primary')!,
      obstacles: [BOARD_OBSTACLE],
      occupancy: new SegmentOccupancyRegistry(),
      boardOrigin: BOARD_ORIGIN,
      boardCenterX: BOARD_CENTER_X,
    });

    const points = templateSameSide({
      start,
      end,
      startDir: 'down',
      endDir,
      assignment: assignments.get('led-primary')!,
      boardCenterX: BOARD_CENTER_X,
      obstacles: [BOARD_OBSTACLE],
    });

    expect(interiorCrossesBoard(points)).toBe(false);
    expect(result.path.length).toBeGreaterThan(0);
  });

  it('routePathAroundBoard reroutes a penetrating horizontal segment along the edge', () => {
    const repaired = routePathAroundBoard(
      [
        { x: 265, y: 192 },
        { x: 335, y: 192 },
        { x: 317, y: 192 },
      ],
      BOARD_OBSTACLE,
      { x: 317, y: 192 },
    );

    expect(interiorCrossesBoard(repaired)).toBe(false);
    expect(repaired[0].x).toBeLessThan(BOARD_BOUNDS.left);
  });
});

describe('peripheral edge routing', () => {
  const ULTRASONIC_ORIGIN = { x: 90, y: 360 };
  const ULTRASONIC_BOUNDS = resolveBoardBounds(ULTRASONIC_ORIGIN, 180, 107);
  const ULTRASONIC_OBSTACLE = { x: 90, y: 360, width: 180, height: 107 };

  it('power VCC tap from ultrasonic bottom pin routes via side edge', () => {
    const start = { x: 165, y: 455 };
    const node = { x: 328, y: 80 };
    const railY = 80;
    const points = buildPowerBusTapPath2D(start, node, railY, 'down', ULTRASONIC_OBSTACLE);

    expect(interiorCrossesObstacle(points, ULTRASONIC_OBSTACLE)).toBe(false);
    expect(points.some((p) => p.x >= ULTRASONIC_BOUNDS.right)).toBe(true);
  });

  it('power taps from same module use the same bypass side (by node position)', () => {
    const obstacle = ULTRASONIC_OBSTACLE;
    const railY = 80;
    const vcc = buildPowerBusTapPath2D({ x: 165, y: 455 }, { x: 328, y: 80 }, railY, 'down', obstacle);
    const gnd = buildPowerBusTapPath2D({ x: 195, y: 455 }, { x: 472, y: 80 }, railY, 'down', obstacle);
    const vccEdge = vcc.find((p) => p.y === railY && p.x !== 328)?.x;
    const gndEdge = gnd.find((p) => p.y === railY && p.x !== 472)?.x;
    expect(vccEdge).toBeDefined();
    expect(gndEdge).toBe(vccEdge);
    expect(vccEdge!).toBeGreaterThanOrEqual(ULTRASONIC_BOUNDS.right);
  });

  it('button right-pin power tap keeps first vertical segment outside component edge', () => {
    const buttonObstacle = { x: 63, y: 228, width: 104, height: 84 };
    const points = buildPowerBusTapPath2D(
      { x: 155, y: 260 },
      { x: 472, y: 80 },
      80,
      'right',
      buttonObstacle,
    );
    const p1 = points[1];
    expect(p1.x).toBeGreaterThanOrEqual(
      buttonObstacle.x + buttonObstacle.width + OBSTACLE_PADDING,
    );
    expect(interiorCrossesObstacle(points, buttonObstacle)).toBe(false);
  });

  it('resolvePeripheralPinStartDir places stub anchor outside right-edge pins', () => {
    const pin = { x: 155, y: 260 };
    const bounds = resolveBoardBounds({ x: 80, y: 240 }, 80, 60);
    const startDir = resolvePeripheralPinStartDir(pin, bounds);
    expect(startDir).toBe('right');

    const { p1 } = buildStubPoints(pin, pin, startDir, 'left', {
      wireId: 't',
      topology: 'same-side',
      priority: 2,
      stubLengthStart: 18,
      stubLengthEnd: 18,
    });
    expect(p1.x).toBeGreaterThan(bounds.right);
  });

  it('resolvePeripheralPinStartDir uses bottom edge for ultrasonic header pins', () => {
    const pin = { x: 175, y: 455 };
    const startDir = resolvePeripheralPinStartDir(pin, ULTRASONIC_BOUNDS);
    expect(startDir).toBe('down');

    const { p1 } = buildStubPoints(pin, pin, startDir, 'right', {
      wireId: 't',
      topology: 'same-side',
      priority: 2,
      stubLengthStart: 18,
      stubLengthEnd: 18,
    });
    expect(p1.y).toBeGreaterThan(ULTRASONIC_BOUNDS.bottom);
  });

  it('ultrasonic TRIG → GPIO12 path does not cut through sensor body', () => {
    const start = { x: 175, y: 455 };
    const end = { x: 317, y: 162 };
    const startDir = resolvePeripheralPinStartDir(start, ULTRASONIC_BOUNDS);
    const endDir = resolveBoardPinEndDir(end, BOARD_BOUNDS);
    const requests: WireRouteRequest[] = [
      {
        wireId: 'sonar-trig',
        start,
        end,
        startDir,
        endDir,
        priority: 2,
        channel: 'left',
        signalType: 'digital',
      },
    ];
    const channels = {
      leftBus: BOARD_X - 45,
      rightBus: BOARD_X + boardDescriptor.width + 45,
      topBus: BOARD_Y - 55,
      bottomBus: BOARD_Y + boardDescriptor.height + 55,
      powerRailY: BOARD_Y - 50,
    };
    const assignments = buildTrackAssignments(requests, channels, BOARD_CENTER_X, BOARD_CENTER_Y);
    const obstacles = [ULTRASONIC_OBSTACLE, BOARD_OBSTACLE];

    const points = templateSameSide({
      start,
      end,
      startDir,
      endDir,
      assignment: assignments.get('sonar-trig')!,
      boardCenterX: BOARD_CENTER_X,
      obstacles,
    });

    expect(interiorCrossesObstacle(points, ULTRASONIC_OBSTACLE)).toBe(false);
    expect(interiorCrossesBoard(points)).toBe(false);
  });

  it('bottom-pin side approach when vertical bus falls inside module width', () => {
    const start = { x: 175, y: 455 };
    const end = { x: 317, y: 162 };
    const startDir = resolvePeripheralPinStartDir(start, ULTRASONIC_BOUNDS);
    const endDir = resolveBoardPinEndDir(end, BOARD_BOUNDS);
    const assignment = {
      wireId: 'sonar-trig',
      topology: 'same-side' as const,
      priority: 2,
      stubLengthStart: 18,
      stubLengthEnd: 18,
      verticalTrackX: 215,
    };

    expect(verticalTrackCrossesObstacle(215, 473, 162, ULTRASONIC_OBSTACLE)).toBe(true);

    const points = templateSameSide({
      start,
      end,
      startDir,
      endDir,
      assignment,
      boardCenterX: BOARD_CENTER_X,
      obstacles: [ULTRASONIC_OBSTACLE, BOARD_OBSTACLE],
    });

    expect(interiorCrossesObstacle(points, ULTRASONIC_OBSTACLE)).toBe(false);
    const edgePoint = points.find((p) => p.x > ULTRASONIC_BOUNDS.right && p.y > 440);
    expect(edgePoint).toBeDefined();
  });

  it('dense left-bucket lanes keep ultrasonic wires outside module body', () => {
    const channels = {
      leftBus: BOARD_X - 45,
      rightBus: BOARD_X + boardDescriptor.width + 45,
      topBus: BOARD_Y - 55,
      bottomBus: BOARD_Y + boardDescriptor.height + 55,
      powerRailY: BOARD_Y - 50,
    };
    const requests: WireRouteRequest[] = [
      {
        wireId: 'w0',
        start: { x: 100, y: 80 },
        end: { x: 317, y: 162 },
        startDir: 'down',
        endDir: 'right',
        priority: 2,
        channel: 'left',
        signalType: 'digital',
      },
      {
        wireId: 'w1',
        start: { x: 100, y: 120 },
        end: { x: 317, y: 192 },
        startDir: 'down',
        endDir: 'right',
        priority: 2,
        channel: 'left',
        signalType: 'digital',
      },
      {
        wireId: 'w2',
        start: { x: 100, y: 160 },
        end: { x: 317, y: 222 },
        startDir: 'down',
        endDir: 'right',
        priority: 2,
        channel: 'left',
        signalType: 'digital',
      },
      {
        wireId: 'w3',
        start: { x: 100, y: 200 },
        end: { x: 317, y: 252 },
        startDir: 'down',
        endDir: 'right',
        priority: 2,
        channel: 'left',
        signalType: 'digital',
      },
      {
        wireId: 'sonar-trig',
        start: { x: 175, y: 455 },
        end: { x: 317, y: 162 },
        startDir: resolvePeripheralPinStartDir({ x: 175, y: 455 }, ULTRASONIC_BOUNDS),
        endDir: resolveBoardPinEndDir({ x: 317, y: 162 }, BOARD_BOUNDS),
        priority: 2,
        channel: 'left',
        signalType: 'digital',
      },
    ];
    const assignments = buildTrackAssignments(requests, channels, BOARD_CENTER_X, BOARD_CENTER_Y);
    const sonarAssignment = assignments.get('sonar-trig')!;
    expect((sonarAssignment.verticalTrackX ?? 0) <= ULTRASONIC_BOUNDS.right).toBe(true);

    const points = templateSameSide({
      start: { x: 175, y: 455 },
      end: { x: 317, y: 162 },
      startDir: requests[4].startDir,
      endDir: requests[4].endDir,
      assignment: sonarAssignment,
      boardCenterX: BOARD_CENTER_X,
      obstacles: [ULTRASONIC_OBSTACLE, BOARD_OBSTACLE],
    });

    expect(interiorCrossesObstacle(points, ULTRASONIC_OBSTACLE)).toBe(false);
  });

  it('routePathAroundObstacle reroutes vertical penetration via side edge', () => {
    const repaired = routePathAroundObstacle(
      [
        { x: 215, y: 160 },
        { x: 215, y: 480 },
        { x: 265, y: 480 },
      ],
      ULTRASONIC_OBSTACLE,
      { skipLastSegment: true },
    );

    expect(interiorCrossesObstacle(repaired, ULTRASONIC_OBSTACLE)).toBe(false);
    expect(repaired.some((p) => p.x >= ULTRASONIC_BOUNDS.right)).toBe(true);
  });

  it('routePathAroundObstacle reroutes start-side approach along component edge', () => {
    const repaired = routePathAroundObstacle(
      [
        { x: 155, y: 260 },
        { x: 173, y: 260 },
        { x: 265, y: 260 },
      ],
      { x: 80, y: 240, width: 80, height: 60 },
      { skipFirstSegment: true },
    );

    expect(interiorCrossesObstacle(repaired, { x: 80, y: 240, width: 80, height: 60 })).toBe(
      false,
    );
  });

  it('button 1.l -> GPIO14 route does not cut through button body', () => {
    const buttonObstacle = { x: 80, y: 240, width: 80, height: 60 };
    const buttonBounds = resolveBoardBounds({ x: 80, y: 240 }, 80, 60);
    const start = { x: 75, y: 260 };
    const end = { x: 317, y: 222 };
    const startDir = resolvePeripheralPinStartDir(start, buttonBounds);
    const endDir = resolveBoardPinEndDir(end, BOARD_BOUNDS);

    const channels = {
      leftBus: BOARD_X - 45,
      rightBus: BOARD_X + boardDescriptor.width + 45,
      topBus: BOARD_Y - 55,
      bottomBus: BOARD_Y + boardDescriptor.height + 55,
      powerRailY: BOARD_Y - 50,
    };
    const requests: WireRouteRequest[] = [
      {
        wireId: 'btn-primary',
        start,
        end,
        startDir,
        endDir,
        priority: 2,
        channel: 'left',
        signalType: 'digital',
      },
    ];
    const assignments = buildTrackAssignments(requests, channels, BOARD_CENTER_X, BOARD_CENTER_Y);

    const points = templateSameSide({
      start,
      end,
      startDir,
      endDir,
      assignment: assignments.get('btn-primary')!,
      boardCenterX: BOARD_CENTER_X,
      obstacles: [buttonObstacle, BOARD_OBSTACLE],
    });

    expect(interiorCrossesObstacle(points, buttonObstacle)).toBe(false);
  });
});

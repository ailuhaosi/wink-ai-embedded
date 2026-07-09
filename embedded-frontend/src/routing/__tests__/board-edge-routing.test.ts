import { describe, expect, it } from 'vitest';
import { boardDescriptor } from '../../types/peripheral-pins';
import {
  resolveBoardBounds,
  resolveBoardPinEndDir,
  routePathAroundBoard,
  segmentIntersectsObstacle,
} from '../geometry';
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

function interiorCrossesBoard(points: Array<{ x: number; y: number }>): boolean {
  for (let i = 0; i < points.length - 2; i++) {
    if (segmentIntersectsObstacle(points[i], points[i + 1], [BOARD_OBSTACLE], 0)) {
      return true;
    }
  }
  return false;
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

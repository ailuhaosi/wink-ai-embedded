import { describe, expect, it } from 'vitest';
import { boardDescriptor, getRoutingChannels } from '../../types/peripheral-pins';
import { rotateCardinalDirection } from '../geometry';
import { buildStubPoints, templateSameSide } from '../path-templates';
import { SegmentOccupancyRegistry } from '../segment-occupancy';
import { buildTrackAssignments } from '../track-allocator';
import { generateWirePath } from '../wire-routing';
import type { WireRouteRequest } from '../types';

const BOARD_X = boardDescriptor.x;
const BOARD_Y = boardDescriptor.y;
const BOARD_ORIGIN = { x: BOARD_X, y: BOARD_Y };
const BOARD_CENTER_X = BOARD_X + boardDescriptor.width / 2;
const BOARD_CENTER_Y = BOARD_Y + boardDescriptor.height / 2;
const CHANNELS = getRoutingChannels(BOARD_X, BOARD_Y);

function defaultObstacles() {
  return [{ x: BOARD_X, y: BOARD_Y, width: boardDescriptor.width, height: boardDescriptor.height }];
}

function mkLeftRequest(overrides: Partial<WireRouteRequest>): WireRouteRequest {
  return {
    wireId: 'w0',
    start: { x: 100, y: 100 },
    end: { x: 317, y: 192 },
    startDir: 'down',
    endDir: 'left',
    priority: 2,
    channel: 'left',
    signalType: 'digital',
    ...overrides,
  };
}

describe('boundary cases UT-B01–B06', () => {
  it('UT-B01: start.x === boardCenterX classifies into left bucket', () => {
    const requests = [
      mkLeftRequest({
        wireId: 'center-edge',
        start: { x: BOARD_CENTER_X, y: 150 },
        end: { x: 317, y: 192 },
      }),
    ];
    const assignments = buildTrackAssignments(requests, CHANNELS, BOARD_CENTER_X, BOARD_CENTER_Y);
    const assignment = assignments.get('center-edge');
    expect(assignment).toBeDefined();
    expect(assignment!.verticalTrackX).toBeLessThan(BOARD_CENTER_X);
  });

  it('UT-B02: equal start/end Y degenerates Z to vertical + horizontal', () => {
    const y = 180;
    const points = templateSameSide({
      start: { x: 130, y },
      end: { x: 317, y },
      startDir: 'down',
      endDir: 'left',
      assignment: {
        wireId: 'flat-y',
        topology: 'same-side',
        priority: 2,
        stubLengthStart: 18,
        stubLengthEnd: 18,
        verticalTrackX: 264,
      },
      boardCenterX: BOARD_CENTER_X,
      obstacles: defaultObstacles(),
    });

    const uniqueY = new Set(points.map((p) => p.y));
    expect(uniqueY.size).toBeLessThanOrEqual(4);
    expect(points.some((p) => p.y === y || Math.abs(p.y - y) <= 20)).toBe(true);
  });

  it('UT-B03: ten left-bucket wires get distinct track lanes', () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      mkLeftRequest({
        wireId: `left-${i}`,
        start: { x: 90, y: 80 + i * 18 },
        end: { x: 317, y: 162 + i * 18 },
      }),
    );
    const assignments = buildTrackAssignments(requests, CHANNELS, BOARD_CENTER_X, BOARD_CENTER_Y);
    const xs = requests.map((r) => assignments.get(r.wireId)?.verticalTrackX);
    expect(xs.every((x) => x !== undefined)).toBe(true);
    const unique = new Set(xs);
    expect(unique.size).toBe(10);
  });

  it('UT-B04: 90°/180° rotation yields correct stub direction', () => {
    const baseDir = 'down';
    const rotated90 = rotateCardinalDirection(baseDir, 90);
    const rotated180 = rotateCardinalDirection(baseDir, 180);
    expect(rotated90).toBe('left');
    expect(rotated180).toBe('up');

    const start = { x: 130, y: 150 };
    const end = { x: 317, y: 192 };
    const assignment = {
      wireId: 'rot',
      topology: 'same-side' as const,
      priority: 2,
      stubLengthStart: 18,
      stubLengthEnd: 18,
    };

    const downStub = buildStubPoints(start, end, 'down', 'left', assignment);
    const leftStub = buildStubPoints(start, end, rotated90, 'left', assignment);
    expect(downStub.p1.y).toBeGreaterThan(start.y);
    expect(leftStub.p1.x).toBeLessThan(start.x);
  });

  it('UT-B05: start === end returns minimal path without divide-by-zero', () => {
    const point = { x: 200, y: 200 };
    const result = generateWirePath({
      start: point,
      end: point,
      startDir: 'down',
      endDir: 'left',
      wireId: 'degenerate',
      signalType: 'digital',
      assignment: {
        wireId: 'degenerate',
        topology: 'local',
        priority: 2,
        stubLengthStart: 18,
        stubLengthEnd: 18,
      },
      obstacles: defaultObstacles(),
      occupancy: new SegmentOccupancyRegistry(),
      boardOrigin: BOARD_ORIGIN,
      boardCenterX: BOARD_CENTER_X,
    });

    expect(result.path).toBe('');
    expect(result.segments.length).toBeLessThanOrEqual(1);
    expect(result.vias).toEqual([]);
  });

  it('UT-B06: I2C cross-side horizontal segments stay 8px apart', () => {
    const requests: WireRouteRequest[] = [
      mkLeftRequest({
        wireId: 'oled-sda',
        channel: 'cross',
        priority: 1,
        signalType: 'i2c',
        bundleId: 'oled-i2c',
        start: { x: 570, y: 195 },
        end: { x: 487, y: 162 },
        startDir: 'down',
        endDir: 'right',
      }),
      mkLeftRequest({
        wireId: 'oled-scl',
        channel: 'cross',
        priority: 1,
        signalType: 'i2c',
        bundleId: 'oled-i2c',
        start: { x: 580, y: 195 },
        end: { x: 487, y: 192 },
        startDir: 'down',
        endDir: 'right',
      }),
    ];
    const assignments = buildTrackAssignments(requests, CHANNELS, BOARD_CENTER_X, BOARD_CENTER_Y);
    const sdaY = assignments.get('oled-sda')?.horizontalTrackY;
    const sclY = assignments.get('oled-scl')?.horizontalTrackY;
    expect(sdaY).toBeDefined();
    expect(sclY).toBeDefined();
    expect(Math.abs(sdaY! - sclY!)).toBe(8);
  });
});

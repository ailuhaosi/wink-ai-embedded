import { describe, expect, it } from 'vitest';
import { boardDescriptor, getRoutingChannels } from '../../types/peripheral-pins';
import { SegmentOccupancyRegistry } from '../segment-occupancy';
import { buildTrackAssignments } from '../track-allocator';
import { generateWirePath } from '../wire-routing';
import type { WireRouteRequest } from '../types';

const BOARD_X = boardDescriptor.x;
const BOARD_Y = boardDescriptor.y;
const BOARD_ORIGIN = { x: BOARD_X, y: BOARD_Y };
const BOARD_CENTER_X = BOARD_X + boardDescriptor.width / 2;
const BOARD_CENTER_Y = BOARD_Y + boardDescriptor.height / 2;

function defaultObstacles() {
  return [{ x: BOARD_X, y: BOARD_Y, width: boardDescriptor.width, height: boardDescriptor.height }];
}

/** Default-layout wire set extended to 20 routes for perf harness. */
function build20WireRequests(): WireRouteRequest[] {
  const base: WireRouteRequest[] = [
    {
      wireId: 'led-primary',
      start: { x: 130, y: 150 },
      end: { x: 317, y: 192 },
      startDir: 'down',
      endDir: 'left',
      priority: 2,
      channel: 'left',
      signalType: 'digital',
    },
    {
      wireId: 'btn-primary',
      start: { x: 110, y: 290 },
      end: { x: 317, y: 222 },
      startDir: 'right',
      endDir: 'left',
      priority: 2,
      channel: 'left',
      signalType: 'digital',
    },
    {
      wireId: 'oled-sda',
      start: { x: 570, y: 195 },
      end: { x: 487, y: 162 },
      startDir: 'down',
      endDir: 'right',
      priority: 1,
      channel: 'cross',
      signalType: 'i2c',
      bundleId: 'oled-i2c',
    },
    {
      wireId: 'oled-scl',
      start: { x: 580, y: 195 },
      end: { x: 487, y: 192 },
      startDir: 'down',
      endDir: 'right',
      priority: 1,
      channel: 'cross',
      signalType: 'i2c',
      bundleId: 'oled-i2c',
    },
    {
      wireId: 'sonar-primary',
      start: { x: 120, y: 410 },
      end: { x: 317, y: 252 },
      startDir: 'down',
      endDir: 'left',
      priority: 2,
      channel: 'left',
      signalType: 'digital',
    },
  ];

  const extras: WireRouteRequest[] = [];
  for (let i = 0; i < 15; i++) {
    extras.push({
      wireId: `extra-${i}`,
      start: { x: 95 + (i % 5) * 8, y: 90 + i * 14 },
      end: { x: 317, y: 170 + i * 12 },
      startDir: 'down',
      endDir: 'left',
      priority: 2,
      channel: 'left',
      signalType: 'digital',
    });
  }
  return [...base, ...extras];
}

function routeAllWires(requests: WireRouteRequest[]): void {
  const channels = getRoutingChannels(BOARD_X, BOARD_Y);
  const assignments = buildTrackAssignments(requests, channels, BOARD_CENTER_X, BOARD_CENTER_Y);
  const occupancy = new SegmentOccupancyRegistry();
  const obstacles = defaultObstacles();

  for (const req of requests) {
    const assignment = assignments.get(req.wireId);
    if (!assignment) continue;
    generateWirePath({
      start: req.start,
      end: req.end,
      startDir: req.startDir,
      endDir: req.endDir,
      wireId: req.wireId,
      signalType: req.signalType,
      assignment,
      obstacles,
      occupancy,
      boardOrigin: BOARD_ORIGIN,
      boardCenterX: BOARD_CENTER_X,
    });
  }
}

describe('wire-routing benchmark', () => {
  it('uT-14: benchmarks 20-wire full recalc under 16ms avg', () => {
    const requests = build20WireRequests();
    expect(requests).toHaveLength(20);

    // warm run
    routeAllWires(requests);

    const iterations = 10;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      routeAllWires(requests);
    }
    const avg = (performance.now() - t0) / iterations;
    expect(avg).toBeLessThan(16);
  });
});

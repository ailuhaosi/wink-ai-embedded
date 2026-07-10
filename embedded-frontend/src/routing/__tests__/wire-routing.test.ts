import { describe, expect, it, vi } from 'vitest';
import { boardDescriptor, getRoutingChannels } from '../../types/peripheral-pins';
import { SegmentOccupancyRegistry } from '../segment-occupancy';
import { buildTrackAssignments } from '../track-allocator';
import { generateSmartPCBPath, generateWirePath } from '../wire-routing';
import type { WireRouteRequest } from '../types';

const BOARD_X = boardDescriptor.x;
const BOARD_Y = boardDescriptor.y;
const BOARD_ORIGIN = { x: BOARD_X, y: BOARD_Y };
const BOARD_CENTER_X = BOARD_X + boardDescriptor.width / 2;
const BOARD_CENTER_Y = BOARD_Y + boardDescriptor.height / 2;
const CHANNELS = getRoutingChannels(BOARD_X, BOARD_Y);

function defaultObstacles() {
  return [
    {
      x: BOARD_X,
      y: BOARD_Y,
      width: boardDescriptor.width,
      height: boardDescriptor.height,
    },
  ];
}

describe('wire-routing', () => {
  it('routes same-side digital wire with HCTR', () => {
    const requests: WireRouteRequest[] = [
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
    ];
    const assignments = buildTrackAssignments(requests, CHANNELS, BOARD_CENTER_X, BOARD_CENTER_Y);
    const assignment = assignments.get('led-primary')!;

    const result = generateWirePath({
      start: requests[0].start,
      end: requests[0].end,
      startDir: 'down',
      endDir: 'left',
      wireId: 'led-primary',
      signalType: 'digital',
      assignment,
      obstacles: defaultObstacles(),
      occupancy: new SegmentOccupancyRegistry(),
      boardOrigin: BOARD_ORIGIN,
      boardCenterX: BOARD_CENTER_X,
      lane: 0,
    });

    expect(result.path.length).toBeGreaterThan(0);
    expect(result.vias).toEqual([]);
    expect(result.segments.every(s => s.layer === 0)).toBe(true);
  });

  it('routes cross-side i2c wire', () => {
    const requests: WireRouteRequest[] = [
      {
        wireId: 'oled-sda',
        start: { x: 570, y: 195 },
        end: { x: 487, y: 162 },
        startDir: 'down',
        endDir: 'right',
        priority: 1,
        channel: 'cross',
        signalType: 'i2c',
        bundleId: 'oled1-i2c',
      },
    ];
    const assignments = buildTrackAssignments(requests, CHANNELS, BOARD_CENTER_X, BOARD_CENTER_Y);
    const result = generateWirePath({
      start: requests[0].start,
      end: requests[0].end,
      startDir: 'down',
      endDir: 'right',
      wireId: 'oled-sda',
      signalType: 'i2c',
      assignment: assignments.get('oled-sda')!,
      obstacles: defaultObstacles(),
      occupancy: new SegmentOccupancyRegistry(),
      boardOrigin: BOARD_ORIGIN,
      boardCenterX: BOARD_CENTER_X,
    });

    expect(result.width).toBe(1.5);
    expect(result.path).toContain('M');
  });

  it('manual mode preserves waypoint order', () => {
    const requests: WireRouteRequest[] = [
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
    ];
    const assignments = buildTrackAssignments(requests, CHANNELS, BOARD_CENTER_X, BOARD_CENTER_Y);
    const waypoint = { x: 200, y: 120 };

    const result = generateWirePath({
      start: requests[0].start,
      end: requests[0].end,
      startDir: 'down',
      endDir: 'left',
      wireId: 'led-primary',
      signalType: 'digital',
      assignment: assignments.get('led-primary')!,
      obstacles: defaultObstacles(),
      occupancy: new SegmentOccupancyRegistry(),
      waypoints: [waypoint],
      boardOrigin: BOARD_ORIGIN,
      boardCenterX: BOARD_CENTER_X,
    });

    expect(result.path).toContain(`${waypoint.x}`);
    expect(result.path).toContain(`${waypoint.y}`);
  });
});

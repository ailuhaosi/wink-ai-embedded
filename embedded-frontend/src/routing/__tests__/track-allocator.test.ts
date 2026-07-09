import { describe, expect, it } from 'vitest';
import { getRoutingChannels } from '../../types/peripheral-pins';
import {
  countTemplateBends,
  isOrthogonal,
  templateCrossSide,
  templateLocal,
  templateSameSide,
  type TemplateInput,
} from '../path-templates';
import { buildTrackAssignments } from '../track-allocator';
import type { WireRouteRequest } from '../types';

const BOARD_X = 310;
const BOARD_Y = 130;
const BOARD_CENTER_X = BOARD_X + 90;
const BOARD_CENTER_Y = BOARD_Y + 100;
const CHANNELS = getRoutingChannels(BOARD_X, BOARD_Y);

function baseAssignment(overrides: Partial<TemplateInput['assignment']> = {}) {
  return {
    wireId: 'w1',
    topology: 'same-side' as const,
    priority: 2,
    stubLengthStart: 18,
    stubLengthEnd: 18,
    verticalTrackX: 265,
    ...overrides,
  };
}

describe('path-templates', () => {
  it('templateSameSide uses one vertical track segment', () => {
    const points = templateSameSide({
      start: { x: 130, y: 150 },
      end: { x: 317, y: 192 },
      startDir: 'down',
      endDir: 'left',
      assignment: baseAssignment({ verticalTrackX: 265 }),
      boardCenterX: BOARD_CENTER_X,
      obstacles: [],
    });

    expect(points[2].x).toBe(points[3].x);
    expect(points[2].x).toBe(264);
    expect(isOrthogonal(points)).toBe(true);
  });

  it('templateCrossSide includes horizontal bypass segment', () => {
    const points = templateCrossSide({
      start: { x: 570, y: 195 },
      end: { x: 487, y: 162 },
      startDir: 'down',
      endDir: 'right',
      assignment: baseAssignment({
        topology: 'cross-side',
        verticalTrackX: 265,
        exitTrackX: 535,
        horizontalTrackY: 75,
      }),
      boardCenterX: BOARD_CENTER_X,
      obstacles: [],
    });

    const bypassY = points[3].y;
    expect(points[4].y).toBe(bypassY);
    expect(points[2].x).not.toBe(points[4].x);
  });

  it('templateLocal keeps bends <= 1 for short distance', () => {
    const points =
      templateLocal({
        start: { x: 500, y: 160 },
        end: { x: 520, y: 180 },
        startDir: 'right',
        endDir: 'left',
        assignment: baseAssignment({ topology: 'local' }),
        boardCenterX: BOARD_CENTER_X,
        obstacles: [],
      }) ?? [];

    expect(points.length).toBeGreaterThan(0);
    expect(countTemplateBends(points)).toBeLessThanOrEqual(1);
  });

  it('snaps track coordinates to 4px grid', () => {
    const points = templateSameSide({
      start: { x: 130, y: 150 },
      end: { x: 317, y: 192 },
      startDir: 'down',
      endDir: 'left',
      assignment: baseAssignment({ verticalTrackX: 263 }),
      boardCenterX: BOARD_CENTER_X,
      obstacles: [],
    });

    const trackPoints = points.slice(2, 4);
    for (const p of trackPoints) {
      expect(p.x % 4).toBe(0);
      expect(p.y % 4).toBe(0);
    }
  });
});

describe('track-allocator', () => {
  const mkRequest = (overrides: Partial<WireRouteRequest>): WireRouteRequest => ({
    wireId: 'w1',
    start: { x: 100, y: 100 },
    end: { x: 317, y: 192 },
    startDir: 'down',
    endDir: 'left',
    priority: 2,
    channel: 'left',
    signalType: 'digital',
    ...overrides,
  });

  it('assigns decreasing verticalTrackX for left bucket lanes', () => {
    const requests = [
      mkRequest({ wireId: 'w0', priority: 2, start: { x: 100, y: 80 }, end: { x: 317, y: 162 } }),
      mkRequest({ wireId: 'w1', priority: 2, start: { x: 100, y: 120 }, end: { x: 317, y: 192 } }),
      mkRequest({ wireId: 'w2', priority: 2, start: { x: 100, y: 160 }, end: { x: 317, y: 222 } }),
    ];
    const assignments = buildTrackAssignments(requests, CHANNELS, BOARD_CENTER_X, BOARD_CENTER_Y);
    const xs = ['w0', 'w1', 'w2'].map((id) => assignments.get(id)?.verticalTrackX ?? 0);
    expect(xs[0]).toBeGreaterThan(xs[1]);
    expect(xs[1]).toBeGreaterThan(xs[2]);
  });

  it('assigns different horizontalTrackY for cross bucket wires', () => {
    const requests = [
      mkRequest({
        wireId: 'c0',
        channel: 'cross',
        priority: 2,
        start: { x: 100, y: 100 },
        end: { x: 570, y: 180 },
      }),
      mkRequest({
        wireId: 'c1',
        channel: 'cross',
        priority: 2,
        start: { x: 100, y: 200 },
        end: { x: 570, y: 260 },
      }),
    ];
    const assignments = buildTrackAssignments(requests, CHANNELS, BOARD_CENTER_X, BOARD_CENTER_Y);
    const y0 = assignments.get('c0')?.horizontalTrackY;
    const y1 = assignments.get('c1')?.horizontalTrackY;
    expect(y0).toBeDefined();
    expect(y1).toBeDefined();
    expect(y0).not.toBe(y1);
  });

  it('I2C bundle outputs parallel tracks 8px apart', () => {
    const requests = [
      mkRequest({
        wireId: 'oled-sda',
        channel: 'cross',
        priority: 1,
        signalType: 'i2c',
        bundleId: 'oled1-i2c',
        compId: 'oled1',
        start: { x: 570, y: 195 },
        end: { x: 487, y: 162 },
        startDir: 'down',
        endDir: 'right',
      }),
      mkRequest({
        wireId: 'oled-scl',
        channel: 'cross',
        priority: 1,
        signalType: 'i2c',
        bundleId: 'oled1-i2c',
        compId: 'oled1',
        start: { x: 580, y: 195 },
        end: { x: 487, y: 192 },
        startDir: 'down',
        endDir: 'right',
      }),
    ];
    const assignments = buildTrackAssignments(requests, CHANNELS, BOARD_CENTER_X, BOARD_CENTER_Y);
    const sda = assignments.get('oled-sda');
    const scl = assignments.get('oled-scl');
    expect(sda?.verticalTrackX).toBeDefined();
    expect(scl?.verticalTrackX).toBeDefined();
    expect(Math.abs((sda!.verticalTrackX ?? 0) - (scl!.verticalTrackX ?? 0))).toBe(8);
    expect(Math.abs((sda!.horizontalTrackY ?? 0) - (scl!.horizontalTrackY ?? 0))).toBe(8);
  });
});

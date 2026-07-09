import { describe, expect, it } from 'vitest';
import {
  extractSegmentsFromPoints,
  SegmentOccupancyRegistry,
} from '../segment-occupancy';

describe('SegmentOccupancyRegistry', () => {
  it('registers without conflict on empty registry', () => {
    const registry = new SegmentOccupancyRegistry();
    const segment = {
      wireId: 'w1',
      orientation: 'v' as const,
      fixed: 100,
      rangeStart: 50,
      rangeEnd: 150,
      layer: 0 as const,
    };
    expect(registry.hasConflict(segment)).toBe(false);
    registry.register(segment);
    expect(registry.getSegments()).toHaveLength(1);
  });

  it('detects overlap on same vertical track', () => {
    const registry = new SegmentOccupancyRegistry();
    registry.register({
      wireId: 'w1',
      orientation: 'v',
      fixed: 100,
      rangeStart: 50,
      rangeEnd: 150,
      layer: 0,
    });

    expect(
      registry.hasConflict({
        wireId: 'w2',
        orientation: 'v',
        fixed: 100,
        rangeStart: 120,
        rangeEnd: 200,
        layer: 0,
      }),
    ).toBe(true);
  });

  it('allows parallel tracks with different fixed coordinate', () => {
    const registry = new SegmentOccupancyRegistry();
    registry.register({
      wireId: 'w1',
      orientation: 'v',
      fixed: 100,
      rangeStart: 50,
      rangeEnd: 150,
      layer: 0,
    });

    expect(
      registry.hasConflict({
        wireId: 'w2',
        orientation: 'v',
        fixed: 110,
        rangeStart: 50,
        rangeEnd: 150,
        layer: 0,
      }),
    ).toBe(false);
  });

  it('extracts orthogonal segments from point path', () => {
    const segments = extractSegmentsFromPoints('w1', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ orientation: 'h', fixed: 0 });
    expect(segments[1]).toMatchObject({ orientation: 'v', fixed: 100 });
  });
});

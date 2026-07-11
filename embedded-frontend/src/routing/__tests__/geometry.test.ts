import { describe, expect, it } from 'vitest';
import {
  classifyTopology,
  normalizeBoardPinLanding,
  pinCoord,
  resolveBoardBounds,
  resolveBoardPinEndDir,
  resolvePeripheralPinStartDir,
  rotateCardinalDirection,
  segmentIntersectsObstacle,
  snapTrackCoord,
} from '../geometry';

describe('geometry', () => {
  it('snapTrackCoord aligns to 4px grid', () => {
    expect(snapTrackCoord(0)).toBe(0);
    expect(snapTrackCoord(7)).toBe(8);
    expect(snapTrackCoord(13)).toBe(12);
    expect(snapTrackCoord(15) % 4).toBe(0);
  });

  it('pinCoord passes through unchanged', () => {
    expect(pinCoord(30)).toBe(30);
    expect(pinCoord(75)).toBe(75);
  });

  it('rotateCardinalDirection handles 90/180/270 degree steps', () => {
    expect(rotateCardinalDirection('up', 0)).toBe('up');
    expect(rotateCardinalDirection('up', 90)).toBe('right');
    expect(rotateCardinalDirection('left', 180)).toBe('right');
    expect(rotateCardinalDirection('down', 270)).toBe('right');
  });

  it('segmentIntersectsObstacle detects vertical crossing', () => {
    const obstacles = [{ x: 100, y: 100, width: 50, height: 50 }];
    expect(segmentIntersectsObstacle({ x: 125, y: 80 }, { x: 125, y: 170 }, obstacles)).toBe(
      true,
    );
    expect(segmentIntersectsObstacle({ x: 200, y: 80 }, { x: 200, y: 170 }, obstacles)).toBe(
      false,
    );
  });

  it('classifyTopology buckets same-side and cross-side', () => {
    const center = 400;
    expect(classifyTopology({ x: 100, y: 100 }, { x: 130, y: 140 }, center, 80)).toBe('local');
    expect(classifyTopology({ x: 100, y: 100 }, { x: 150, y: 300 }, center, 80)).toBe('same-side');
    expect(classifyTopology({ x: 100, y: 100 }, { x: 500, y: 200 }, center, 80)).toBe('cross-side');
  });

  it('resolveBoardPinEndDir picks outward final segment for edge pins', () => {
    const bounds = resolveBoardBounds({ x: 310, y: 130 }, 180, 200);
    expect(resolveBoardPinEndDir({ x: 317, y: 192 }, bounds)).toBe('right');
    expect(resolveBoardPinEndDir({ x: 487, y: 162 }, bounds)).toBe('left');
    // GPIO2 on left header — horizontal approach, not vertical from above
    expect(resolveBoardPinEndDir({ x: 317, y: 132 }, bounds)).toBe('right');
  });

  it('normalizeBoardPinLanding forces horizontal entry for left-edge pins', () => {
    const bounds = resolveBoardBounds({ x: 310, y: 130 }, 180, 200);
    const pin = { x: 317, y: 132 };
    const repaired = normalizeBoardPinLanding(
      [
        { x: 400, y: 100 },
        { x: 400, y: 132 },
        pin,
      ],
      pin,
      bounds,
    );
    const prev = repaired[repaired.length - 2];
    expect(prev.y).toBe(pin.y);
    expect(prev.x).toBeLessThan(pin.x);
  });

  it('resolvePeripheralPinStartDir picks outward stub for edge pins', () => {
    const bounds = resolveBoardBounds({ x: 80, y: 240 }, 80, 60);
    expect(resolvePeripheralPinStartDir({ x: 75, y: 260 }, bounds)).toBe('left');
    expect(resolvePeripheralPinStartDir({ x: 155, y: 260 }, bounds)).toBe('right');
  });
});

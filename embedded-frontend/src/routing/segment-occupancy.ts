import type { OccupiedSegment, Point } from './types';

const FIXED_TOLERANCE = 1;

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

function fixedMatches(a: number, b: number): boolean {
  return Math.abs(a - b) <= FIXED_TOLERANCE;
}

export class SegmentOccupancyRegistry {
  private segments: OccupiedSegment[] = [];

  register(segment: OccupiedSegment): void {
    this.segments.push({ ...segment });
  }

  hasConflict(candidate: OccupiedSegment): boolean {
    return this.segments.some((existing) => {
      if (existing.orientation !== candidate.orientation) return false;
      if (!fixedMatches(existing.fixed, candidate.fixed)) return false;
      return rangesOverlap(
        existing.rangeStart,
        existing.rangeEnd,
        candidate.rangeStart,
        candidate.rangeEnd,
      );
    });
  }

  getSegments(): readonly OccupiedSegment[] {
    return this.segments;
  }

  clear(): void {
    this.segments = [];
  }
}

export function extractSegmentsFromPoints(wireId: string, points: Point[]): OccupiedSegment[] {
  const segments: OccupiedSegment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (p1.x === p2.x && p1.y === p2.y) continue;

    if (p1.x === p2.x) {
      segments.push({
        wireId,
        orientation: 'v',
        fixed: p1.x,
        rangeStart: p1.y,
        rangeEnd: p2.y,
        layer: 0,
      });
    }
    else if (p1.y === p2.y) {
      segments.push({
        wireId,
        orientation: 'h',
        fixed: p1.y,
        rangeStart: p1.x,
        rangeEnd: p2.x,
        layer: 0,
      });
    }
  }

  return segments;
}

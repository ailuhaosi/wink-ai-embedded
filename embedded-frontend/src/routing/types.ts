export interface Point {
  x: number;
  y: number;
}

export type CardinalDirection = 'left' | 'right' | 'up' | 'down';

export type WireTopology =
  | 'power-tap'
  | 'power-trunk'
  | 'same-side'
  | 'cross-side'
  | 'local';

export type RoutingChannel = 'left' | 'right' | 'cross';

export interface TrackAssignment {
  wireId: string;
  topology: WireTopology;
  priority: number;
  bundleId?: string;
  bundleOffset?: number;
  verticalTrackX?: number;
  exitTrackX?: number;
  horizontalTrackY?: number;
  bypassSide?: 'top' | 'bottom';
  stubLengthStart: number;
  stubLengthEnd: number;
}

export interface OccupiedSegment {
  wireId: string;
  orientation: 'h' | 'v';
  fixed: number;
  rangeStart: number;
  rangeEnd: number;
  layer: 0;
}

export interface BoardOrigin {
  x: number;
  y: number;
}

export interface RoutingChannels {
  leftBus: number;
  rightBus: number;
  topBus: number;
  bottomBus: number;
  powerRailY: number;
}

export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WirePathResult {
  path: string;
  width: number;
  segments: Array<{ d: string; layer: number }>;
  vias: Array<{ x: number; y: number }>;
  teardrops: Array<string>;
}

export interface RoutingContext {
  boardOrigin: BoardOrigin;
  channels: RoutingChannels;
  obstacles: Obstacle[];
  assignments: Map<string, TrackAssignment>;
  occupancy: {
    register(segment: OccupiedSegment): void;
    hasConflict(segment: OccupiedSegment): boolean;
  };
  gpioFanout?: { index: number; total: number };
  waypoints?: Point[];
}

export interface WireRouteRequest {
  wireId: string;
  start: Point;
  end: Point;
  startDir: CardinalDirection;
  endDir: CardinalDirection;
  priority: number;
  channel: RoutingChannel;
  signalType: 'digital' | 'i2c' | 'power';
  compId?: string;
  bundleId?: string;
}

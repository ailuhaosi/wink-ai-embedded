export type WireRouteMode = 'orthogonal' | 'custom';

export interface CircuitPoint {
  x: number;
  y: number;
}

export type OrthogonalCommand = `v${number}` | `h${number}` | '*';

export interface ConnectionRouting {
  mode: WireRouteMode;
  path?: OrthogonalCommand[];
  points?: CircuitPoint[];
}

export interface PinRef {
  componentId: string;
  pinName: string;
}

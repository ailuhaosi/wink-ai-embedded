import type { NetDefinition, PinConnectionValue } from '../types/peripheral-pins';

export interface Point {
  x: number;
  y: number;
}

export interface ResolveNetPinContext {
  pinConnections: Record<string, PinConnectionValue>;
  getPinPosition: (pinName: string) => Point;
  targetPosition: Point;
}

function manhattanDistance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Whether a pin connection value can carry this net. */
export function connectionMatchesNet(
  connection: PinConnectionValue | undefined,
  net: NetDefinition,
): boolean {
  if (connection === null || connection === undefined) return false;
  if (net.signalType === 'digital' || net.signalType === 'i2c') {
    return typeof connection === 'number';
  }
  if (net.mode === 'vcc') {
    return connection === 'VCC' || connection === '3V3';
  }
  if (net.mode === 'gnd') {
    return connection === 'GND';
  }
  return connection === 'VCC' || connection === '3V3' || connection === 'GND';
}

/** Logical connection value for a net (explicit pin entry or net default). */
export function resolveNetConnection(
  net: NetDefinition,
  pinConnections: Record<string, PinConnectionValue>,
): PinConnectionValue | null {
  for (const name of net.pinCandidates) {
    const conn = pinConnections[name];
    if (connectionMatchesNet(conn, net)) {
      return conn!;
    }
  }
  if (net.defaultConnection !== undefined && net.defaultConnection !== null) {
    return net.defaultConnection;
  }
  return null;
}

function pickClosestPin(
  candidates: string[],
  getPinPosition: (pinName: string) => Point,
  target: Point,
): string {
  let best = candidates[0];
  let bestDist = Infinity;
  for (const name of candidates) {
    const dist = manhattanDistance(getPinPosition(name), target);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

/**
 * Pick the physical pin for a net.
 * 1. One explicit candidate with matching connection → user override.
 * 2. Multiple explicit candidates → closest to routing target.
 * 3. No explicit match but defaultConnection → closest candidate (auto).
 */
export function resolveNetPin(
  net: NetDefinition,
  ctx: ResolveNetPinContext,
): string | null {
  const explicit = net.pinCandidates.filter(name =>
    connectionMatchesNet(ctx.pinConnections[name], net),
  );

  if (explicit.length === 1) {
    return explicit[0];
  }
  if (explicit.length > 1) {
    return pickClosestPin(explicit, ctx.getPinPosition, ctx.targetPosition);
  }
  if (net.defaultConnection !== undefined && net.defaultConnection !== null) {
    return pickClosestPin(net.pinCandidates, ctx.getPinPosition, ctx.targetPosition);
  }
  return null;
}

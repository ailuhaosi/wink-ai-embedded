/**
 * Thin worker-facing pin APIs for peripheral WorldWidgets.
 * Kept separate from simulation-client to avoid a cycle:
 * simulation-client → @/peripherals → WorldWidget → (this module).
 */
import type { SimWorkerInbound } from '../types/sim-worker-protocol';
import { SimWorkerInboundType } from '../types/sim-worker-protocol';

let worker: Worker | null = null;

export function getSimWorker(): Worker | null {
  return worker;
}

export function setSimWorker(next: Worker | null): void {
  worker = next;
}

export interface SetPinIdealOptions {
  timestampUs?: string;
  drive?: 'strong' | 'weak';
}

export interface SetUltrasonicDistanceOptions {
  timestampUs?: string;
}

export function setPinIdeal(
  pin: number,
  level: boolean,
  _options?: SetPinIdealOptions,
): void {
  if (!worker) return;
  const msg: SimWorkerInbound = {
    type: SimWorkerInboundType.SET_PIN_IDEAL,
    payload: { pin, level },
  };
  worker.postMessage(msg);
}

export function setUltrasonicDistance(
  trigPin: number,
  echoPin: number,
  distanceCm: number,
  _options?: SetUltrasonicDistanceOptions,
): void {
  if (!worker) return;
  const msg: SimWorkerInbound = {
    type: SimWorkerInboundType.SET_ULTRASONIC_DISTANCE,
    payload: { trigPin, echoPin, distanceCm },
  };
  worker.postMessage(msg);
}

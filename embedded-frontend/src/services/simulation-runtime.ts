import { shallowRef } from 'vue';
import { MAX_SIM_LOG_ENTRIES } from '@/constants/simulation';
import type { SimStatePayload } from '@/types/sim-worker-protocol';
import type { ActuatorObservation, ActuatorObserveSource } from '@/types/actuator-observation';

export interface SimTrace {
  timestamp: number;
  type: number;
  pinOrBus: number;
  sequence?: number;
}

export interface SimLogEntry {
  level: string;
  message: string;
  timestamp: number;
}

/** Data-plane SSOT — high-frequency sim outputs stay out of Pinia. */
export const clockUs = shallowRef('0');
export const pinStates = shallowRef<Record<number, boolean>>({});
export const oledFb = shallowRef<Uint8Array | null>(null);
export const traces = shallowRef<SimTrace[]>([]);
export const logs = shallowRef<SimLogEntry[]>([]);
export const actuatorObservations = shallowRef<ActuatorObservation[]>([]);
export const lastActuatorSources = shallowRef<ActuatorObserveSource[]>([]);
export const lastComponents = shallowRef<any[]>([]);

function normalizePinStates(
  raw: Record<number, unknown> | undefined | null,
): Record<number, boolean> {
  const out: Record<number, boolean> = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    // Worker may post 0/1 from C READ_GPIO; coerce at the data-plane boundary.
    out[Number(key)] = value === true || value === 1;
  }
  return out;
}

export function applyStateUpdate(payload: SimStatePayload) {
  clockUs.value = payload.us;
  pinStates.value = normalizePinStates(
    payload.pinStates as Record<number, unknown> | undefined,
  );
  oledFb.value = payload.oledFb ?? null;
  traces.value = (payload.traces ?? []) as SimTrace[];
}

export function appendLog(entry: SimLogEntry) {
  const next = logs.value.length >= MAX_SIM_LOG_ENTRIES
    ? logs.value.slice(logs.value.length - MAX_SIM_LOG_ENTRIES + 1)
    : logs.value.slice();
  next.push(entry);
  logs.value = next;
}

export function clearLogs() {
  logs.value = [];
}

export function resetDataPlane() {
  clockUs.value = '0';
  pinStates.value = {};
  oledFb.value = null;
  traces.value = [];
  actuatorObservations.value = [];
  lastActuatorSources.value = [];
  lastComponents.value = [];
}

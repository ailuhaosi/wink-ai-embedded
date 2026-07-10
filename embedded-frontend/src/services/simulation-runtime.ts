import { shallowRef } from 'vue';
import { MAX_SIM_LOG_ENTRIES } from '@/constants/simulation';
import type { SimStatePayload } from '@/types/sim-worker-protocol';

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

export function applyStateUpdate(payload: SimStatePayload) {
  clockUs.value = payload.us;
  pinStates.value = payload.pinStates ?? {};
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
}

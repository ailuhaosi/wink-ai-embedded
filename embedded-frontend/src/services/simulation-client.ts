import '@/peripherals';
import { registry } from '@/peripherals/registry';
import { ObserveBuilderImpl } from '@/peripherals/observe-builder';
import WasmWorker from '../workers/wasm-simulation.worker?worker';
import type { PinConnectionValue } from '../types/peripheral-pins';
import type { CircuitComponentInstance } from '../types/circuit-component';
import type {
  SimFaultsConfig,
  SimWorkerInbound,
  SimWorkerOutbound,
} from '../types/sim-worker-protocol';
import { SimWorkerInboundType } from '../types/sim-worker-protocol';
import {
  applyStateUpdate,
  appendLog,
  clearLogs as clearRuntimeLogs,
  resetDataPlane,
} from './simulation-runtime';
import {
  getSimWorker,
  setSimWorker,
  setPinIdeal,
  setUltrasonicDistance,
} from './simulation-pin-api';

export type { SimFaultsConfig } from '../types/sim-worker-protocol';
export type { SimTrace } from './simulation-runtime';
export { setPinIdeal, setUltrasonicDistance };

export interface PeripheralConfig {
  type: string;
  pinConnections: Record<string, PinConnectionValue>;
}

/** Control-plane sink bound by simulation.store (avoids circular imports). */
export interface SimulationControlApi {
  resetForInit: () => void;
  onInitDone: () => void;
  onError: (message: string) => void;
  onResetDone: () => void;
  setFaulted: (faulted: boolean) => void;
  setRunning: (running: boolean) => void;
  isInitialized: () => boolean;
  isRunning: () => boolean;
}

let control: SimulationControlApi | null = null;

export function bindSimulationControl(api: SimulationControlApi) {
  control = api;
}

function requireControl(): SimulationControlApi {
  if (!control) {
    throw new Error('[SimulationClient] control plane not bound — call store.init() first');
  }
  return control;
}

/** Worker postMessage requires plain data — Vue reactive proxies cannot be cloned. */
export function cloneFaultsConfig(faults: SimFaultsConfig): SimFaultsConfig {
  return {
    bounce_us: Number(faults.bounce_us),
    warmup_us: Number(faults.warmup_us),
    sample_interval_us: Number(faults.sample_interval_us),
    adc_noise_v: Number(faults.adc_noise_v),
    rc_tau_s: Number(faults.rc_tau_s),
    i2c_drop_permil: Number(faults.i2c_drop_permil),
    prng_seed: Number(faults.prng_seed),
  };
}

export function initSimulation() {
  const ctrl = requireControl();
  const prev = getSimWorker();

  if (prev) {
    prev.terminate();
  }

  ctrl.resetForInit();
  resetDataPlane();

  console.log('[SimulationClient] Spawning simulation worker...');
  const worker = new WasmWorker();
  setSimWorker(worker);

  worker.onmessage = (e: MessageEvent<SimWorkerOutbound>) => {
    const { type, payload, message } = e.data as SimWorkerOutbound & {
      payload?: unknown;
      message?: string;
    };
    const c = requireControl();

    switch (type) {
      case 'INIT_DONE':
        c.onInitDone();
        console.log('[SimulationClient] Simulator initialized successfully!');
        break;

      case 'STATE_UPDATE':
        if (payload) {
          const state = payload as Extract<SimWorkerOutbound, { type: 'STATE_UPDATE' }>['payload'];
          applyStateUpdate(state);
          c.setFaulted(state.isFaulted || false);
        }
        break;

      case 'LOG':
        if (payload) {
          appendLog(payload as Extract<SimWorkerOutbound, { type: 'LOG' }>['payload']);
        }
        break;

      case 'ERROR':
        console.error(`[SimulationClient Worker Error] ${message}`);
        c.onError(message ?? 'Unknown worker error');
        break;

      case 'RESET_DONE':
        c.onResetDone();
        resetDataPlane();
        break;
    }
  };

  const initMsg: SimWorkerInbound = { type: SimWorkerInboundType.INIT };
  worker.postMessage(initMsg);
}

export function startSimulation() {
  const ctrl = requireControl();
  const worker = getSimWorker();
  if (worker && ctrl.isInitialized()) {
    const msg: SimWorkerInbound = { type: SimWorkerInboundType.START };
    worker.postMessage(msg);
    ctrl.setRunning(true);
  }
}

export function pauseSimulation() {
  const ctrl = requireControl();
  const worker = getSimWorker();
  if (worker && ctrl.isRunning()) {
    const msg: SimWorkerInbound = { type: SimWorkerInboundType.PAUSE };
    worker.postMessage(msg);
    ctrl.setRunning(false);
  }
}

export function resetSimulation() {
  const worker = getSimWorker();
  if (worker) {
    const msg: SimWorkerInbound = { type: SimWorkerInboundType.RESET };
    worker.postMessage(msg);
    requireControl().setRunning(false);
  }
}

/** Preferred: components-only. Collects GPIO pins + plugin observe. */
export function observePins(
  components: Array<{ type: string; pinConnections: Record<string, PinConnectionValue> }>,
): void {
  const worker = getSimWorker();
  if (!worker) return;

  const builder = new ObserveBuilderImpl();

  const pins: number[] = [];
  for (const comp of components) {
    for (const val of Object.values(comp.pinConnections)) {
      if (typeof val === 'number') {
        pins.push(val);
      }
    }
  }
  builder.watchGpio(pins);

  for (const comp of components) {
    const def = registry.get(comp.type);
    def?.simulation?.observe?.(comp as CircuitComponentInstance, builder);
  }

  const msg: SimWorkerInbound = {
    type: SimWorkerInboundType.OBSERVE_PINS,
    payload: builder.build(),
  };
  worker.postMessage(msg);
}

export function setFaults(faults: SimFaultsConfig) {
  const worker = getSimWorker();
  if (worker) {
    const msg: SimWorkerInbound = {
      type: SimWorkerInboundType.SET_FAULTS,
      payload: cloneFaultsConfig(faults),
    };
    worker.postMessage(msg);
  }
}

export function setSpeed(speed: number) {
  const worker = getSimWorker();
  if (worker) {
    const msg: SimWorkerInbound = {
      type: SimWorkerInboundType.SET_SPEED,
      payload: speed,
    };
    worker.postMessage(msg);
  }
}

export function clearLogs() {
  clearRuntimeLogs();
}

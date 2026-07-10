import WasmWorker from '../workers/wasm-simulation.worker?worker';
import type { PinConnectionValue } from '../types/peripheral-pins';
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

export type { SimFaultsConfig } from '../types/sim-worker-protocol';
export type { SimTrace } from './simulation-runtime';

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
let worker: Worker | null = null;

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

  if (worker) {
    worker.terminate();
  }

  ctrl.resetForInit();
  resetDataPlane();

  console.log('[SimulationClient] Spawning simulation worker...');
  worker = new WasmWorker();

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
  if (worker && ctrl.isInitialized()) {
    const msg: SimWorkerInbound = { type: SimWorkerInboundType.START };
    worker.postMessage(msg);
    ctrl.setRunning(true);
  }
}

export function pauseSimulation() {
  const ctrl = requireControl();
  if (worker && ctrl.isRunning()) {
    const msg: SimWorkerInbound = { type: SimWorkerInboundType.PAUSE };
    worker.postMessage(msg);
    ctrl.setRunning(false);
  }
}

export function resetSimulation() {
  if (worker) {
    const msg: SimWorkerInbound = { type: SimWorkerInboundType.RESET };
    worker.postMessage(msg);
    requireControl().setRunning(false);
  }
}

export function setPinIdeal(pin: number, level: boolean) {
  if (worker) {
    const msg: SimWorkerInbound = {
      type: SimWorkerInboundType.SET_PIN_IDEAL,
      payload: { pin, level },
    };
    worker.postMessage(msg);
  }
}

export function setUltrasonicDistance(trigPin: number, echoPin: number, distanceCm: number) {
  if (worker) {
    const msg: SimWorkerInbound = {
      type: SimWorkerInboundType.SET_ULTRASONIC_DISTANCE,
      payload: { trigPin, echoPin, distanceCm },
    };
    worker.postMessage(msg);
  }
}

export function observePins(pins: number[], peripherals: PeripheralConfig[]) {
  if (worker) {
    const oledPeripheral = peripherals.find(p => p.type === 'oled');
    const ultrasonicPeripheral = peripherals.find(p => p.type === 'ultrasonic');

    const oledConfig = oledPeripheral
      ? {
          sda: oledPeripheral.pinConnections.DATA ?? null,
          scl: oledPeripheral.pinConnections.CLK ?? null,
        }
      : null;

    const ultrasonicConfig = ultrasonicPeripheral
      ? {
          trig: ultrasonicPeripheral.pinConnections.TRIG ?? null,
          echo: ultrasonicPeripheral.pinConnections.ECHO ?? null,
        }
      : null;

    const msg: SimWorkerInbound = {
      type: SimWorkerInboundType.OBSERVE_PINS,
      payload: {
        pins: [...pins],
        oled: !!oledPeripheral,
        oledConfig,
        ultrasonicConfig,
      },
    };
    worker.postMessage(msg);
  }
}

export function setFaults(faults: SimFaultsConfig) {
  if (worker) {
    const msg: SimWorkerInbound = {
      type: SimWorkerInboundType.SET_FAULTS,
      payload: cloneFaultsConfig(faults),
    };
    worker.postMessage(msg);
  }
}

export function setSpeed(speed: number) {
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

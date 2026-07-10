import { ref } from 'vue';
import WasmWorker from '../workers/wasm-simulation.worker?worker';
import type { PinConnectionValue } from '../types/peripheral-pins';
import type {
  SimFaultsConfig,
  SimWorkerInbound,
  SimWorkerOutbound,
} from '../types/sim-worker-protocol';
import { SimWorkerInboundType } from '../types/sim-worker-protocol';

export type { SimFaultsConfig } from '../types/sim-worker-protocol';

export interface PeripheralConfig {
  type: string;
  pinConnections: Record<string, PinConnectionValue>;
}

export interface SimTrace {
  timestamp: number;
  type: number;
  pinOrBus: number;
  sequence?: number;
}

export const isInitialized = ref(false);
export const isRunning = ref(false);
export const isFaulted = ref(false);
export const initError = ref<string | null>(null);
export const clockUs = ref('0');
export const pinStates = ref<Record<number, boolean>>({});
export const oledFb = ref<Uint8Array | null>(null);
export const logs = ref<Array<{ level: string; message: string; timestamp: number }>>([]);
export const traces = ref<SimTrace[]>([]);

let worker: Worker | null = null;

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
  if (worker) {
    worker.terminate();
  }

  isInitialized.value = false;
  isRunning.value = false;
  isFaulted.value = false;
  initError.value = null;
  clockUs.value = '0';
  pinStates.value = {};
  oledFb.value = null;
  traces.value = [];

  console.log('[SimulationClient] Spawning simulation worker...');
  worker = new WasmWorker();

  worker.onmessage = (e: MessageEvent<SimWorkerOutbound>) => {
    const { type, payload, message } = e.data as SimWorkerOutbound & {
      payload?: unknown;
      message?: string;
    };

    switch (type) {
      case 'INIT_DONE':
        isInitialized.value = true;
        initError.value = null;
        console.log('[SimulationClient] Simulator initialized successfully!');
        break;

      case 'STATE_UPDATE':
        if (payload) {
          const state = payload as Extract<SimWorkerOutbound, { type: 'STATE_UPDATE' }>['payload'];
          clockUs.value = state.us;
          pinStates.value = state.pinStates || {};
          oledFb.value = state.oledFb || null;
          traces.value = (state.traces || []) as SimTrace[];
          isFaulted.value = state.isFaulted || false;
        }
        break;

      case 'LOG':
        if (payload) {
          logs.value.push(payload as Extract<SimWorkerOutbound, { type: 'LOG' }>['payload']);
          // Keep only last 1000 logs to prevent memory bloat
          if (logs.value.length > 1000) {
            logs.value.shift();
          }
        }
        break;

      case 'ERROR':
        console.error(`[SimulationClient Worker Error] ${message}`);
        isInitialized.value = false;
        initError.value = message ?? 'Unknown worker error';
        break;

      case 'RESET_DONE':
        isRunning.value = false;
        clockUs.value = '0';
        pinStates.value = {};
        oledFb.value = null;
        traces.value = [];
        isFaulted.value = false;
        break;
    }
  };

  const initMsg: SimWorkerInbound = { type: SimWorkerInboundType.INIT };
  worker.postMessage(initMsg);
}

export function startSimulation() {
  if (worker && isInitialized.value) {
    const msg: SimWorkerInbound = { type: SimWorkerInboundType.START };
    worker.postMessage(msg);
    isRunning.value = true;
  }
}

export function pauseSimulation() {
  if (worker && isRunning.value) {
    const msg: SimWorkerInbound = { type: SimWorkerInboundType.PAUSE };
    worker.postMessage(msg);
    isRunning.value = false;
  }
}

export function resetSimulation() {
  if (worker) {
    const msg: SimWorkerInbound = { type: SimWorkerInboundType.RESET };
    worker.postMessage(msg);
    isRunning.value = false;
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
  logs.value = [];
}

import { ref } from 'vue';
import WasmWorker from '../workers/wasm-simulation.worker?worker';
import { PinConnectionValue } from '../types/peripheral-pins';

export interface SimFaultsConfig {
  bounce_us: number;
  warmup_us: number;
  sample_interval_us: number;
  adc_noise_v: number;
  rc_tau_s: number;
  i2c_drop_permil: number;
  prng_seed: number;
}

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
  
  worker.onmessage = (e) => {
    const { type, payload, message } = e.data;
    
    switch (type) {
      case 'INIT_DONE':
        isInitialized.value = true;
        initError.value = null;
        console.log('[SimulationClient] Simulator initialized successfully!');
        break;
        
      case 'STATE_UPDATE':
        if (payload) {
          clockUs.value = payload.us;
          pinStates.value = payload.pinStates || {};
          oledFb.value = payload.oledFb || null;
          traces.value = payload.traces || [];
          isFaulted.value = payload.isFaulted || false;
        }
        break;
        
      case 'LOG':
        if (payload) {
          logs.value.push(payload);
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
  
  worker.postMessage({ type: 'INIT' });
}

export function startSimulation() {
  if (worker && isInitialized.value) {
    worker.postMessage({ type: 'START' });
    isRunning.value = true;
  }
}

export function pauseSimulation() {
  if (worker && isRunning.value) {
    worker.postMessage({ type: 'PAUSE' });
    isRunning.value = false;
  }
}

export function resetSimulation() {
  if (worker) {
    worker.postMessage({ type: 'RESET' });
    isRunning.value = false;
  }
}

export function setPinIdeal(pin: number, level: boolean) {
  if (worker) {
    worker.postMessage({
      type: 'SET_PIN_IDEAL',
      payload: { pin, level }
    });
  }
}

export function setUltrasonicDistance(trigPin: number, echoPin: number, distanceCm: number) {
  if (worker) {
    worker.postMessage({
      type: 'SET_ULTRASONIC_DISTANCE',
      payload: { trigPin, echoPin, distanceCm }
    });
  }
}

export function observePins(pins: number[], peripherals: PeripheralConfig[]) {
  if (worker) {
    const oledPeripheral = peripherals.find(p => p.type === 'oled');
    const ultrasonicPeripheral = peripherals.find(p => p.type === 'ultrasonic');
    
    const oledConfig = oledPeripheral ? {
      sda: oledPeripheral.pinConnections.DATA,
      scl: oledPeripheral.pinConnections.CLK
    } : null;
    
    const ultrasonicConfig = ultrasonicPeripheral ? {
      trig: ultrasonicPeripheral.pinConnections.TRIG,
      echo: ultrasonicPeripheral.pinConnections.ECHO
    } : null;
    
    worker.postMessage({
      type: 'OBSERVE_PINS',
      payload: { 
        pins, 
        oled: !!oledPeripheral, 
        oledConfig,
        ultrasonicConfig 
      }
    });
  }
}

export function setFaults(faults: SimFaultsConfig) {
  if (worker) {
    worker.postMessage({
      type: 'SET_FAULTS',
      payload: faults
    });
  }
}

export function setSpeed(speed: number) {
  if (worker) {
    worker.postMessage({
      type: 'SET_SPEED',
      payload: speed
    });
  }
}

export function clearLogs() {
  logs.value = [];
}

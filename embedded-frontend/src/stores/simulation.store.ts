import { watch } from 'vue';
import { defineStore } from 'pinia';
import {
  initSimulation,
  startSimulation,
  pauseSimulation,
  resetSimulation,
  setPinIdeal,
  observePins,
  setFaults,
  setSpeed,
  clearLogs,
  setUltrasonicDistance,
  initError,
  isInitialized,
  isRunning,
  isFaulted,
  clockUs,
  pinStates,
  oledFb,
  logs,
  traces,
  type SimFaultsConfig,
  type PeripheralConfig,
  type SimTrace,
} from '../services/simulation-client';

interface SimulationState {
  simSpeed: number;
  lastError: string | null;
  /** Mirrored from simulation-client refs for Pinia reactivity */
  initError: string | null;
  isInitialized: boolean;
  isRunning: boolean;
  isFaulted: boolean;
  clockUs: string;
  pinStates: Record<number, boolean>;
  oledFb: Uint8Array | null;
  logs: Array<{ level: string; message: string; timestamp: number }>;
  traces: SimTrace[];
  activeAppId: string;
}

let runtimeSyncStarted = false;

export const useSimulationStore = defineStore('simulation', {
  state: (): SimulationState => ({
    simSpeed: 1,
    lastError: null,
    initError: null,
    isInitialized: false,
    isRunning: false,
    isFaulted: false,
    clockUs: '0',
    pinStates: {},
    oledFb: null,
    logs: [],
    traces: [],
    activeAppId: 'unknown',
  }),

  getters: {
    simTimeUs: (state) => state.clockUs,
  },

  actions: {
    ensureRuntimeSync() {
      if (runtimeSyncStarted) return;
      runtimeSyncStarted = true;

      watch(isInitialized, (value) => {
        this.isInitialized = value;
      }, { immediate: true });

      watch(initError, (value) => {
        this.initError = value;
      }, { immediate: true });

      watch(isRunning, (value) => {
        this.isRunning = value;
      }, { immediate: true });

      watch(isFaulted, (value) => {
        this.isFaulted = value;
      }, { immediate: true });

      watch(clockUs, (value) => {
        this.clockUs = value;
      }, { immediate: true });

      watch(pinStates, (value) => {
        this.pinStates = value;
      }, { immediate: true, deep: true });

      watch(oledFb, (value) => {
        this.oledFb = value;
      }, { immediate: true });

      watch(logs, (value) => {
        this.logs = value;
      }, { immediate: true, deep: true });

      watch(traces, (value) => {
        this.traces = value;
      }, { immediate: true, deep: true });
    },

    async fetchActiveAppId() {
      try {
        const res = await fetch(`/wasm/wasm-app-id.txt?t=${Date.now()}`);
        if (res.ok) {
          this.activeAppId = (await res.text()).trim();
        } else {
          this.activeAppId = 'unknown';
        }
      } catch (e) {
        console.warn('Failed to fetch active wasm app id:', e);
        this.activeAppId = 'unknown';
      }
    },

    init() {
      this.ensureRuntimeSync();
      initSimulation();
      void this.fetchActiveAppId();
    },

    toggle() {
      if (isRunning.value) {
        pauseSimulation();
      } else {
        startSimulation();
      }
    },

    start() {
      startSimulation();
    },

    pause() {
      pauseSimulation();
    },

    reset() {
      resetSimulation();
    },

    stopAndClear() {
      if (isRunning.value) {
        pauseSimulation();
      }
      resetSimulation();
    },

    setSpeed(speed: number) {
      this.simSpeed = speed;
      setSpeed(speed);
    },

    setFaults(faults: SimFaultsConfig) {
      setFaults(faults);
    },

    setPinIdeal(pin: number, level: boolean) {
      setPinIdeal(pin, level);
    },

    observePins(pins: number[], peripherals: PeripheralConfig[]) {
      observePins(pins, peripherals);
    },

    setUltrasonicDistance(trigPin: number, echoPin: number, distanceCm: number) {
      setUltrasonicDistance(trigPin, echoPin, distanceCm);
    },

    clearLogs() {
      clearLogs();
    },
  },
});

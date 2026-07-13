import { defineStore } from 'pinia';
import {
  bindSimulationControl,
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
} from '../services/simulation-client';
import type { SimFaultsConfig } from '../services/simulation-client';
import type { PinConnectionValue } from '../types/peripheral-pins';

interface SimulationControlState {
  simSpeed: number;
  initError: string | null;
  isInitialized: boolean;
  isRunning: boolean;
  isFaulted: boolean;
  activeAppId: string;
}

let controlBound = false;

export const useSimulationStore = defineStore('simulation', {
  state: (): SimulationControlState => ({
    simSpeed: 1,
    initError: null,
    isInitialized: false,
    isRunning: false,
    isFaulted: false,
    activeAppId: 'unknown',
  }),

  actions: {
    ensureControlBound() {
      if (controlBound) return;
      controlBound = true;

      bindSimulationControl({
        resetForInit: () => {
          this.isInitialized = false;
          this.isRunning = false;
          this.isFaulted = false;
          this.initError = null;
        },
        onInitDone: () => {
          this.isInitialized = true;
          this.initError = null;
        },
        onError: (message: string) => {
          this.isInitialized = false;
          this.initError = message;
        },
        onResetDone: () => {
          this.isRunning = false;
          this.isFaulted = false;
        },
        setFaulted: (faulted: boolean) => {
          this.isFaulted = faulted;
        },
        setRunning: (running: boolean) => {
          this.isRunning = running;
        },
        isInitialized: () => this.isInitialized,
        isRunning: () => this.isRunning,
      });
    },

    async fetchActiveAppId() {
      try {
        const projectStore = useProjectStore();
        const projectCode = projectStore.manifest.logic?.projectCode;
        const subDir = projectCode ? `${projectCode}/` : '';
        const res = await fetch(`/simulator/wasm/${subDir}wasm-app-id.txt?t=${Date.now()}`);
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            this.activeAppId = 'unknown';
          } else {
            this.activeAppId = (await res.text()).trim();
          }
        }
        else {
          this.activeAppId = 'unknown';
        }
      }
      catch (e) {
        console.warn('Failed to fetch active wasm app id:', e);
        this.activeAppId = 'unknown';
      }
    },

    async checkWasmExists(projectCode: string): Promise<boolean> {
      try {
        const res = await fetch(`/simulator/wasm/${projectCode}/wink_simulator.wasm`, { method: 'HEAD' });
        if (!res.ok) return false;
        
        // Ensure we didn't hit Vite's SPA fallback that returns HTML with status 200
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          return false;
        }
        return true;
      }
      catch {
        return false;
      }
    },

    init() {
      this.ensureControlBound();
      initSimulation();
      void this.fetchActiveAppId();
    },

    /** Re-spawn worker after a recoverable init / runtime error. */
    retryInit() {
      this.ensureControlBound();
      initSimulation();
      void this.fetchActiveAppId();
    },

    toggle() {
      if (this.isRunning) {
        pauseSimulation();
      }
      else {
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
      if (this.isRunning) {
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

    observePins(
      components: Array<{ type: string; pinConnections: Record<string, PinConnectionValue> }>,
    ) {
      observePins(components);
    },

    setUltrasonicDistance(trigPin: number, echoPin: number, distanceCm: number) {
      setUltrasonicDistance(trigPin, echoPin, distanceCm);
    },

    clearLogs() {
      clearLogs();
    },
  },
});

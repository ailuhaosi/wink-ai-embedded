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
} from '../services/simulation-client';

interface SimulationState {
  simSpeed: number;
  lastError: string | null;
}

export const useSimulationStore = defineStore('simulation', {
  state: (): SimulationState => ({
    simSpeed: 1,
    lastError: null,
  }),

  getters: {
    isInitialized: () => isInitialized.value,
    isRunning: () => isRunning.value,
    isFaulted: () => isFaulted.value,
    clockUs: () => clockUs.value,
    pinStates: () => pinStates.value,
    oledFb: () => oledFb.value,
    logs: () => logs.value,
    traces: () => traces.value,
    simTimeUs: () => clockUs.value,
  },

  actions: {
    init() {
      initSimulation();
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

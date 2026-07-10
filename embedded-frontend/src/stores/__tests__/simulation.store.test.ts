import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/services/simulation-client', () => ({
  bindSimulationControl: vi.fn(),
  initSimulation: vi.fn(),
  startSimulation: vi.fn(),
  pauseSimulation: vi.fn(),
  resetSimulation: vi.fn(),
  setPinIdeal: vi.fn(),
  observePins: vi.fn(),
  setFaults: vi.fn(),
  setSpeed: vi.fn(),
  clearLogs: vi.fn(),
  setUltrasonicDistance: vi.fn(),
}));

describe('simulation.store control plane', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('exposes control fields only (no data-plane state)', async () => {
    const { useSimulationStore } = await import('../simulation.store');
    const store = useSimulationStore();

    expect(store.isInitialized).toBe(false);
    expect(store.isRunning).toBe(false);
    expect(store.isFaulted).toBe(false);
    expect(store.initError).toBeNull();
    expect(store).not.toHaveProperty('pinStates');
    expect(store).not.toHaveProperty('oledFb');
    expect(store).not.toHaveProperty('traces');
    expect(store).not.toHaveProperty('logs');
    expect(store).not.toHaveProperty('clockUs');
  });

  it('retryInit rebinds control and respawns worker', async () => {
    const client = await import('@/services/simulation-client');
    const { useSimulationStore } = await import('../simulation.store');
    const store = useSimulationStore();

    store.retryInit();

    expect(client.bindSimulationControl).toHaveBeenCalled();
    expect(client.initSimulation).toHaveBeenCalled();
  });
});

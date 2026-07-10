import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimWorkerInboundType } from '@/types/sim-worker-protocol';

const postMessage = vi.fn();

vi.mock('../../workers/wasm-simulation.worker?worker', () => ({
  default: class MockWorker {
    postMessage = postMessage;
    terminate = vi.fn();
    onmessage: ((e: MessageEvent) => void) | null = null;
  },
}));

describe('observePins aggregation via ObserveBuilder', () => {
  beforeEach(async () => {
    postMessage.mockClear();
    vi.resetModules();
    // Re-apply mock after resetModules
    vi.doMock('../../workers/wasm-simulation.worker?worker', () => ({
      default: class MockWorker {
        postMessage = postMessage;
        terminate = vi.fn();
        onmessage: ((e: MessageEvent) => void) | null = null;
      },
    }));
  });

  async function setupWorker() {
    const client = await import('@/services/simulation-client');
    client.bindSimulationControl({
      resetForInit: vi.fn(),
      onInitDone: vi.fn(),
      onError: vi.fn(),
      onResetDone: vi.fn(),
      setFaulted: vi.fn(),
      setRunning: vi.fn(),
      isInitialized: () => true,
      isRunning: () => false,
    });
    client.initSimulation();
    postMessage.mockClear(); // drop INIT message
    return client;
  }

  it('posts OBSERVE_PINS with pins + oledConfig + ultrasonicConfig for led+oled+ultrasonic', async () => {
    const { observePins } = await setupWorker();

    observePins([
      {
        type: 'led',
        pinConnections: { A: 2, C: 'GND' },
      },
      {
        type: 'oled',
        pinConnections: { DATA: 21, CLK: 22, GND: 'GND' },
      },
      {
        type: 'ultrasonic',
        pinConnections: { TRIG: 12, ECHO: 13, VCC: 'VCC', GND: 'GND' },
      },
    ]);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const msg = postMessage.mock.calls[0][0];
    expect(msg.type).toBe(SimWorkerInboundType.OBSERVE_PINS);
    expect(msg.payload.pins).toEqual(expect.arrayContaining([2, 21, 22, 12, 13]));
    expect(msg.payload.pins).toHaveLength(5);
    expect(msg.payload.oled).toBe(true);
    expect(msg.payload.oledConfig).toEqual({ sda: 21, scl: 22 });
    expect(msg.payload.ultrasonicConfig).toEqual({ trig: 12, echo: 13 });
  });

  it('sets oled false and oledConfig null when no oled component', async () => {
    const { observePins } = await setupWorker();

    observePins([
      {
        type: 'led',
        pinConnections: { A: 5, C: 'GND' },
      },
      {
        type: 'ultrasonic',
        pinConnections: { TRIG: 12, ECHO: 13 },
      },
    ]);

    const msg = postMessage.mock.calls[0][0];
    expect(msg.payload.oled).toBe(false);
    expect(msg.payload.oledConfig).toBeNull();
    expect(msg.payload.ultrasonicConfig).toEqual({ trig: 12, echo: 13 });
    expect(msg.payload.pins).toEqual([5, 12, 13]);
  });

  it('no-ops when worker is not initialized', async () => {
    const { observePins } = await import('@/services/simulation-client');
    observePins([{ type: 'led', pinConnections: { A: 1 } }]);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('simulation-client source has no type === oled/ultrasonic hardcoding', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../simulation-client.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/type\s*===\s*['"]oled['"]/);
    expect(src).not.toMatch(/type\s*===\s*['"]ultrasonic['"]/);
    expect(src).not.toMatch(/p\.type\s*===\s*['"]oled['"]/);
    expect(src).not.toMatch(/p\.type\s*===\s*['"]ultrasonic['"]/);
  });
});

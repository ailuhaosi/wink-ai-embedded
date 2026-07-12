import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_SIM_LOG_ENTRIES } from '@/constants/simulation';
import {
  applyStateUpdate,
  appendLog,
  actuatorObservations,
  clearLogs,
  clockUs,
  lastActuatorSources,
  lastComponents,
  logs,
  oledFb,
  pinStates,
  resetDataPlane,
  traces,
} from '@/services/simulation-runtime';

describe('simulation-runtime', () => {
  beforeEach(() => {
    clearLogs();
    resetDataPlane();
  });

  it('applyStateUpdate writes shallow data plane', () => {
    const fb = new Uint8Array([1, 2, 3]);
    applyStateUpdate({
      us: '12345',
      pinStates: { 13: true },
      oledFb: fb,
      traces: [{ timestamp: 1, type: 1, pinOrBus: 13 }],
      isFaulted: false,
    });

    expect(clockUs.value).toBe('12345');
    expect(pinStates.value[13]).toBe(true);
    expect(oledFb.value).toBe(fb);
    expect(traces.value).toHaveLength(1);
  });

  it('applyStateUpdate coerces Worker 0/1 pin levels to boolean', () => {
    applyStateUpdate({
      us: '1',
      pinStates: { 2: 0 as unknown as boolean, 10: 1 as unknown as boolean },
      oledFb: null,
      traces: [],
      isFaulted: false,
    });

    expect(pinStates.value).toEqual({ 2: false, 10: true });
    expect(typeof pinStates.value[2]).toBe('boolean');
    expect(typeof pinStates.value[10]).toBe('boolean');
  });

  it('appendLog caps at MAX_SIM_LOG_ENTRIES', () => {
    for (let i = 0; i < MAX_SIM_LOG_ENTRIES + 5; i++) {
      appendLog({ level: 'info', message: `m${i}`, timestamp: i });
    }
    expect(logs.value).toHaveLength(MAX_SIM_LOG_ENTRIES);
    expect(logs.value[0].message).toBe('m5');
    expect(logs.value.at(-1)?.message).toBe(`m${MAX_SIM_LOG_ENTRIES + 4}`);
  });

  it('resetDataPlane clears outputs but leaves logs', () => {
    appendLog({ level: 'info', message: 'keep', timestamp: 1 });
    applyStateUpdate({
      us: '9',
      pinStates: { 1: true },
      oledFb: new Uint8Array([0]),
      traces: [{ timestamp: 1, type: 0, pinOrBus: 0 }],
      isFaulted: true,
    });

    resetDataPlane();

    expect(clockUs.value).toBe('0');
    expect(pinStates.value).toEqual({});
    expect(oledFb.value).toBeNull();
    expect(traces.value).toEqual([]);
    expect(logs.value).toHaveLength(1);
  });

  it('resetDataPlane clears lastActuatorSources and actuatorObservations', () => {
    lastActuatorSources.value = [
      { deviceComponentId: 'neck_servo', transport: 'pwm_channel', transportKey: 0 },
    ];
    actuatorObservations.value = [
      {
        deviceComponentId: 'neck_servo',
        quantity: 'angular_position',
        value: 90,
        unit: 'deg',
        role: 'command',
        simTimeUs: '1',
      },
    ];
    lastComponents.value = [{ id: 'neck_servo' }];

    resetDataPlane();

    expect(lastActuatorSources.value).toEqual([]);
    expect(actuatorObservations.value).toEqual([]);
    expect(lastComponents.value).toEqual([]);
  });
});

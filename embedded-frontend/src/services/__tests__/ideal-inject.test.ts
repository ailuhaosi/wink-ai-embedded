import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import * as pinApi from '../simulation-pin-api';
import { runInject, runInjectIdle, syncIdealInputs } from '../ideal-inject';

vi.mock('../simulation-pin-api', () => ({
  setPinIdeal: vi.fn(),
  setUltrasonicDistance: vi.fn(),
}));

function makeButton(
  overrides: Partial<CircuitComponentInstance> = {},
): CircuitComponentInstance {
  return {
    id: 'btn-1',
    type: 'button',
    name: 'Button',
    rotation: 0,
    pinConnections: { '1.l': 4, '2.l': 'VCC', '1.r': null, '2.r': null },
    props: { color: 'red', label: '', xray: false, activeLow: true },
    ...overrides,
  };
}

function makeUltrasonic(
  overrides: Partial<CircuitComponentInstance> = {},
): CircuitComponentInstance {
  return {
    id: 'us-1',
    type: 'ultrasonic',
    name: 'Ultrasonic',
    rotation: 0,
    pinConnections: { VCC: 'VCC', TRIG: 12, ECHO: 13, GND: 'GND' },
    props: { distance: 25 },
    ...overrides,
  };
}

function makeLed(
  overrides: Partial<CircuitComponentInstance> = {},
): CircuitComponentInstance {
  return {
    id: 'led-1',
    type: 'led',
    name: 'LED',
    rotation: 0,
    pinConnections: { A: 13, C: 'GND' },
    props: { color: 'red', brightness: 1, label: '', flip: false },
    ...overrides,
  };
}

describe('ideal-inject', () => {
  beforeEach(() => {
    vi.mocked(pinApi.setPinIdeal).mockClear();
    vi.mocked(pinApi.setUltrasonicDistance).mockClear();
  });

  it.skip('syncIdealInputs applies ultrasonic distance from props', () => {
    // Task 3.3 enables when definition.inject lands
    const comp = makeUltrasonic();
    syncIdealInputs([comp]);
    expect(pinApi.setUltrasonicDistance).toHaveBeenCalledTimes(1);
    expect(pinApi.setUltrasonicDistance).toHaveBeenCalledWith(12, 13, 25, undefined);
  });

  it.skip('runInject press sets active pin level for button', () => {
    // Task 3.2 enables when definition.inject lands
    const comp = makeButton();
    runInject(comp, { event: 'press' });
    expect(pinApi.setPinIdeal).toHaveBeenCalledTimes(1);
    expect(pinApi.setPinIdeal).toHaveBeenCalledWith(4, false, undefined);
  });

  it.skip('runInjectIdle restores idle level for button', () => {
    // Task 3.2 enables when definition.inject lands
    const comp = makeButton();
    runInjectIdle([comp]);
    expect(pinApi.setPinIdeal).toHaveBeenCalledTimes(1);
    expect(pinApi.setPinIdeal).toHaveBeenCalledWith(4, true, undefined);
  });

  it('ignores peripherals without inject', () => {
    const led = makeLed();
    expect(() => {
      syncIdealInputs([led]);
      runInject(led, { event: 'press' });
      runInjectIdle([led]);
    }).not.toThrow();
    expect(pinApi.setPinIdeal).not.toHaveBeenCalled();
    expect(pinApi.setUltrasonicDistance).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/peripherals';
import { registry } from '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { PeripheralDefinition } from '@/peripherals/types';
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

  it('syncIdealInputs applies ultrasonic distance from props', () => {
    const comp = makeUltrasonic();
    syncIdealInputs([comp]);
    expect(pinApi.setUltrasonicDistance).toHaveBeenCalledTimes(1);
    const [trig, echo, dist, options] = vi.mocked(pinApi.setUltrasonicDistance).mock.calls[0]!;
    expect(trig).toBe(12);
    expect(echo).toBe(13);
    expect(dist).toBe(25);
    expect(options).toEqual(expect.any(Object));
  });

  it('runInject press sets active pin level for button', () => {
    const comp = makeButton();
    runInject(comp, { event: 'press' });
    expect(pinApi.setPinIdeal).toHaveBeenCalledTimes(1);
    const [pin, level, options] = vi.mocked(pinApi.setPinIdeal).mock.calls[0]!;
    expect(pin).toBe(4);
    expect(level).toBe(false);
    expect(options).toEqual(expect.any(Object));
  });

  it('runInjectIdle restores idle level for button', () => {
    const comp = makeButton();
    runInjectIdle([comp]);
    expect(pinApi.setPinIdeal).toHaveBeenCalledTimes(1);
    expect(pinApi.setPinIdeal).toHaveBeenCalledWith(4, true, expect.objectContaining({ drive: 'strong' }));
  });

  it('arbiter: strong overrides weak on same pin', () => {
    const buttonDef = registry.get('button') as PeripheralDefinition;
    const origGet = registry.get.bind(registry);
    const weakType = '_arb_test_weak';
    const strongType = '_arb_test_strong';
    const weakDef: PeripheralDefinition = {
      ...buttonDef,
      type: weakType,
      simulation: {
        inject: {
          kind: 'gpio_ideal',
          apply: () => {},
          idle(_comp, ctx) {
            ctx.apis.setPinIdeal(5, true, { drive: 'weak' });
          },
        },
      },
    };
    const strongDef: PeripheralDefinition = {
      ...buttonDef,
      type: strongType,
      simulation: {
        inject: {
          kind: 'gpio_ideal',
          apply: () => {},
          idle(_comp, ctx) {
            ctx.apis.setPinIdeal(5, false, { drive: 'strong' });
          },
        },
      },
    };
    const getSpy = vi.spyOn(registry, 'get').mockImplementation((type: string) => {
      if (type === weakType) return weakDef;
      if (type === strongType) return strongDef;
      return origGet(type);
    });
    try {
      runInjectIdle([
        { ...makeButton({ id: 'weak-1', type: weakType }), pinConnections: { '1.l': 5 } },
        { ...makeButton({ id: 'strong-1', type: strongType }), pinConnections: { '1.l': 5 } },
      ]);
      expect(pinApi.setPinIdeal).toHaveBeenCalledTimes(1);
      expect(pinApi.setPinIdeal).toHaveBeenCalledWith(5, false, expect.objectContaining({ drive: 'strong' }));
    }
    finally {
      getSpy.mockRestore();
    }
  });

  it('arbiter: same-drive last write wins', () => {
    const buttonDef = registry.get('button') as PeripheralDefinition;
    const origGet = registry.get.bind(registry);
    const firstType = '_arb_test_first';
    const secondType = '_arb_test_second';
    const firstDef: PeripheralDefinition = {
      ...buttonDef,
      type: firstType,
      simulation: {
        inject: {
          kind: 'gpio_ideal',
          apply: () => {},
          idle(_comp, ctx) {
            ctx.apis.setPinIdeal(6, true, { drive: 'weak' });
          },
        },
      },
    };
    const secondDef: PeripheralDefinition = {
      ...buttonDef,
      type: secondType,
      simulation: {
        inject: {
          kind: 'gpio_ideal',
          apply: () => {},
          idle(_comp, ctx) {
            ctx.apis.setPinIdeal(6, false, { drive: 'weak' });
          },
        },
      },
    };
    const getSpy = vi.spyOn(registry, 'get').mockImplementation((type: string) => {
      if (type === firstType) return firstDef;
      if (type === secondType) return secondDef;
      return origGet(type);
    });
    try {
      runInjectIdle([
        { ...makeButton({ id: 'first-1', type: firstType }), pinConnections: { '1.l': 6 } },
        { ...makeButton({ id: 'second-1', type: secondType }), pinConnections: { '1.l': 6 } },
      ]);
      expect(pinApi.setPinIdeal).toHaveBeenCalledTimes(1);
      expect(pinApi.setPinIdeal).toHaveBeenCalledWith(6, false, expect.objectContaining({ drive: 'weak' }));
    }
    finally {
      getSpy.mockRestore();
    }
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

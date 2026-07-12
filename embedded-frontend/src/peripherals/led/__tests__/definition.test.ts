import { describe, expect, it } from 'vitest';
import { registry } from '@/peripherals';
import '@/peripherals/led';
import { ObserveBuilderImpl } from '@/peripherals/observe-builder';
import type { CircuitComponentInstance } from '@/types/circuit-component';

describe('led peripheral definition', () => {
  it('declares optional actuator observation through gpio_to_state', () => {
    const def = registry.get('led');

    expect(def?.actuatorObserve?.profile).toEqual({
      defaultQuantity: 'state',
      unit: 'bool',
      convert: 'gpio_to_state',
    });
  });

  it('observes the anode pin as an actuator source', () => {
    const def = registry.get('led');
    const comp: CircuitComponentInstance = {
      id: 'status_led',
      type: 'led',
      props: {},
      pinConnections: { A: 13, C: 'GND' },
      position: { x: 0, y: 0 },
    };

    const builder = new ObserveBuilderImpl();
    def?.simulation?.observe?.(comp, builder);

    expect(builder.build().actuatorSources).toEqual([
      {
        deviceComponentId: 'status_led',
        transport: 'gpio_pin',
        transportKey: 13,
      },
    ]);
  });

  it('keeps ui bindings sourced from pinStates', () => {
    const def = registry.get('led');
    const comp: CircuitComponentInstance = {
      id: 'status_led',
      type: 'led',
      props: { color: 'red', brightness: 1, label: 'LED', flip: false },
      pinConnections: { A: 13, C: 'GND' },
      position: { x: 0, y: 0 },
    };
    const ctx = {
      pinStates: { 13: true },
      displayFb: null,
      actuatorObservations: [
        {
          deviceComponentId: 'status_led',
          quantity: 'state',
          value: 'off',
          unit: 'bool',
          role: 'command',
          simTimeUs: '1',
        },
      ],
    } as const;

    expect(def?.ui?.canvasProps?.(comp, ctx).pinStates).toBe(ctx.pinStates);
    expect(def?.ui?.worldProps?.(comp, ctx).level).toBe(true);
  });
});

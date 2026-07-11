import { describe, expect, it } from 'vitest';
import { registry } from '@/peripherals';
import '@/peripherals/servo';
import { ObserveBuilderImpl } from '@/peripherals/observe-builder';
import type { CircuitComponentInstance } from '@/types/circuit-component';

describe('servo peripheral definition', () => {
  it('registers in registry with correct type and metadata', () => {
    const def = registry.get('servo');
    expect(def).toBeDefined();
    expect(def?.displayName).toBe('SG90 Servo');
    expect(def?.category).toBe('actuator');
    expect(def?.catalog?.id).toBe('servo_stub');
  });

  it('declares correct actuatorObserve profile', () => {
    const def = registry.get('servo');
    expect(def?.actuatorObserve?.profile).toEqual({
      defaultQuantity: 'angular_position',
      unit: 'deg',
      convert: 'sg90_from_duty',
    });
  });

  it('observes the correct PWM channel in simulation.observe', () => {
    const def = registry.get('servo');
    expect(def?.simulation?.observe).toBeDefined();

    const comp: CircuitComponentInstance = {
      id: 'neck_servo_123',
      type: 'servo',
      props: {
        pwmChannel: 3,
      },
      pinConnections: {},
      position: { x: 0, y: 0 },
    };

    const builder = new ObserveBuilderImpl();
    def?.simulation?.observe?.(comp, builder);

    const result = builder.build();
    expect(result.actuatorSources).toEqual([
      {
        deviceComponentId: 'neck_servo_123',
        transport: 'pwm_channel',
        transportKey: 3,
      },
    ]);
  });
});

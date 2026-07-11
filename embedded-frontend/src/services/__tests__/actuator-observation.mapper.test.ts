import { describe, expect, it } from 'vitest';
import { mapActuatorOutputs } from '../actuator-observation.mapper';
import '@/peripherals/servo';
import type { ActuatorOutputBatch, ActuatorObserveSource } from '@/types/actuator-observation';
import type { CircuitComponentInstance } from '@/types/circuit-component';

describe('actuator-observation mapper', () => {
  it('correctly maps raw pwm duty percent to angular position using sg90_from_duty converter', () => {
    const batch: ActuatorOutputBatch = {
      simTimeUs: '123456',
      pwm: { 0: 7.5, 1: 12.5 },
      gpio: {},
    };

    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'neck_servo', transport: 'pwm_channel', transportKey: 0 },
      { deviceComponentId: 'other_servo', transport: 'pwm_channel', transportKey: 1 },
    ];

    const components: CircuitComponentInstance[] = [
      {
        id: 'neck_servo',
        type: 'servo',
        props: { pwmChannel: 0 },
        pinConnections: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'other_servo',
        type: 'servo',
        props: { pwmChannel: 1 },
        pinConnections: {},
        position: { x: 0, y: 0 },
      },
    ];

    const observations = mapActuatorOutputs(batch, sources, components);
    expect(observations).toHaveLength(2);

    expect(observations[0]).toMatchObject({
      deviceComponentId: 'neck_servo',
      quantity: 'angular_position',
      value: 90,
      unit: 'deg',
      role: 'command',
      simTimeUs: '123456',
    });

    expect(observations[1]).toMatchObject({
      deviceComponentId: 'other_servo',
      quantity: 'angular_position',
      value: 180,
      unit: 'deg',
      role: 'command',
      simTimeUs: '123456',
    });
  });
});

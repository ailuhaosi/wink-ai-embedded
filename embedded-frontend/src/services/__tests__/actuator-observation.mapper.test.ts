import { describe, expect, it, vi } from 'vitest';
import {
  clearActuatorConverterSessionStates,
  mapActuatorOutputs,
} from '../actuator-observation.mapper';
import { actuatorConverterRegistry } from '../actuator-converter-registry';
import { registry } from '@/peripherals';
import '@/peripherals/servo';
import '@/peripherals/motor_driver_stub';
import type { ActuatorOutputBatch, ActuatorObserveSource } from '@/types/actuator-observation';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { PeripheralDefinition } from '@/peripherals/types';

function servoComp(
  id: string,
  props: Record<string, unknown> = { pwmChannel: 0 },
): CircuitComponentInstance {
  return {
    id,
    type: 'servo',
    props,
    pinConnections: {},
    position: { x: 0, y: 0 },
  };
}

function motorComp(
  id: string,
  props: Record<string, unknown> = { pwmChannelLeft: 0, pwmChannelRight: 1, maxRpm: 120 },
): CircuitComponentInstance {
  return {
    id,
    type: 'motor_driver_stub',
    props,
    pinConnections: {},
    position: { x: 0, y: 0 },
  };
}

describe('actuator-observation mapper', () => {
  it('maps default-pulse duty 7.5%/12.5% to 90°/180°', () => {
    const batch: ActuatorOutputBatch = {
      simTimeUs: '123456',
      pwm: { 0: 7.5, 1: 12.5 },
      gpio: {},
    };
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'neck_servo', transport: 'pwm_channel', transportKey: 0 },
      { deviceComponentId: 'other_servo', transport: 'pwm_channel', transportKey: 1 },
    ];
    const components = [
      servoComp('neck_servo', { pwmChannel: 0 }),
      servoComp('other_servo', { pwmChannel: 1 }),
    ];

    const observations = mapActuatorOutputs(batch, sources, components);
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      deviceComponentId: 'neck_servo',
      value: 90,
      unit: 'deg',
      role: 'command',
      simTimeUs: '123456',
    });
    expect(observations[1]).toMatchObject({
      deviceComponentId: 'other_servo',
      value: 180,
      unit: 'deg',
      role: 'command',
    });
  });

  it('reads minPulseMs/maxPulseMs from props for non-default pulse range', () => {
    // 1.0–2.0 ms @ 50Hz → duty 5%–10%
    const batch: ActuatorOutputBatch = {
      simTimeUs: '1',
      pwm: { 0: 5, 1: 7.5, 2: 10 },
      gpio: {},
    };
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'a', transport: 'pwm_channel', transportKey: 0 },
      { deviceComponentId: 'b', transport: 'pwm_channel', transportKey: 1 },
      { deviceComponentId: 'c', transport: 'pwm_channel', transportKey: 2 },
    ];
    const pulseProps = { pwmChannel: 0, minPulseMs: 1.0, maxPulseMs: 2.0 };
    const components = [
      servoComp('a', { ...pulseProps, pwmChannel: 0 }),
      servoComp('b', { ...pulseProps, pwmChannel: 1 }),
      servoComp('c', { ...pulseProps, pwmChannel: 2 }),
    ];

    const obs = mapActuatorOutputs(batch, sources, components);
    expect(obs[0].value).toBe(0);
    expect(obs[1].value).toBe(90);
    expect(obs[2].value).toBe(180);
  });

  it('clamps angle to 0-180 for out-of-range duty', () => {
    const batch: ActuatorOutputBatch = {
      simTimeUs: '0',
      pwm: { 0: -5, 1: 200 },
      gpio: {},
    };
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'a', transport: 'pwm_channel', transportKey: 0 },
      { deviceComponentId: 'b', transport: 'pwm_channel', transportKey: 1 },
    ];
    const components = [
      servoComp('a', { pwmChannel: 0 }),
      servoComp('b', { pwmChannel: 1 }),
    ];

    const obs = mapActuatorOutputs(batch, sources, components);
    expect(obs[0].value).toBe(0);
    expect(obs[1].value).toBe(180);
  });

  it('uses rawValue 0 when pwm key is missing', () => {
    const batch: ActuatorOutputBatch = { simTimeUs: '0', pwm: {}, gpio: {} };
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'a', transport: 'pwm_channel', transportKey: 0 },
    ];
    const obs = mapActuatorOutputs(batch, sources, [servoComp('a')]);
    expect(obs).toHaveLength(1);
    expect(obs[0].value).toBe(0);
  });

  it('clears converter session so remapped motor rpm starts near zero', () => {
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'drive_motor', transport: 'pwm_channel', transportKey: 0, subAddress: 0 },
      { deviceComponentId: 'drive_motor', transport: 'pwm_channel', transportKey: 1, subAddress: 1 },
    ];
    const components = [motorComp('drive_motor')];
    const batch = { simTimeUs: '0', pwm: { 0: 50, 1: 100 }, gpio: {} };

    let obs = mapActuatorOutputs(batch, sources, components);
    for (let step = 1; step <= 60; step += 1) {
      obs = mapActuatorOutputs(
        { simTimeUs: String(step * 100_000), pwm: { 0: 50, 1: 100 }, gpio: {} },
        sources,
        components,
      );
    }
    expect(obs[0].value).toBeCloseTo(60, 1);
    expect(obs[1].value).toBeCloseTo(120, 1);

    clearActuatorConverterSessionStates();

    obs = mapActuatorOutputs(
      { simTimeUs: '6100000', pwm: { 0: 50, 1: 100 }, gpio: {} },
      sources,
      components,
    );
    expect(obs[0].value).toBeLessThan(5);
    expect(obs[1].value).toBeLessThan(5);
  });

  it('maps dual pwm sources to angular_velocity for motor stub', () => {
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'drive_motor', transport: 'pwm_channel', transportKey: 0, subAddress: 0 },
      { deviceComponentId: 'drive_motor', transport: 'pwm_channel', transportKey: 1, subAddress: 1 },
    ];
    const components = [motorComp('drive_motor')];

    let obs = mapActuatorOutputs(
      { simTimeUs: '0', pwm: { 0: 50, 1: 100 }, gpio: {} },
      sources,
      components,
    );

    for (let step = 1; step <= 60; step += 1) {
      obs = mapActuatorOutputs(
        { simTimeUs: String(step * 100_000), pwm: { 0: 50, 1: 100 }, gpio: {} },
        sources,
        components,
      );
    }

    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({
      deviceComponentId: 'drive_motor',
      quantity: 'angular_velocity',
      unit: 'rpm',
      role: 'command',
      subAddress: 0,
    });
    expect(obs[1]).toMatchObject({
      deviceComponentId: 'drive_motor',
      quantity: 'angular_velocity',
      unit: 'rpm',
      role: 'command',
      subAddress: 1,
    });
    expect(obs[0].value).toBeCloseTo(60, 1);
    expect(obs[1].value).toBeCloseTo(120, 1);
  });

  it('returns empty array for empty actuatorSources', () => {
    const batch: ActuatorOutputBatch = { simTimeUs: '0', pwm: { 0: 7.5 }, gpio: {} };
    expect(mapActuatorOutputs(batch, [], [servoComp('a')])).toEqual([]);
  });

  it('skips sources when deviceComponentId is not in components', () => {
    const batch: ActuatorOutputBatch = { simTimeUs: '0', pwm: { 0: 7.5 }, gpio: {} };
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'missing', transport: 'pwm_channel', transportKey: 0 },
    ];
    expect(mapActuatorOutputs(batch, sources, [servoComp('a')])).toEqual([]);
  });

  it('skips sources when peripheral has no actuatorObserve', () => {
    const batch: ActuatorOutputBatch = { simTimeUs: '0', pwm: { 0: 7.5 }, gpio: {} };
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'x', transport: 'pwm_channel', transportKey: 0 },
    ];
    const components: CircuitComponentInstance[] = [
      {
        id: 'x',
        type: 'unknown_type_no_observe',
        props: {},
        pinConnections: {},
        position: { x: 0, y: 0 },
      },
    ];
    expect(mapActuatorOutputs(batch, sources, components)).toEqual([]);
  });

  it('skips sources with unregistered converter', () => {
    const def: PeripheralDefinition = {
      type: 'test_unreg_conv',
      displayName: 'Test',
      category: 'actuator',
      size: { width: 1, height: 1 },
      wireColor: '#000',
      pins: [],
      props: {},
      actuatorObserve: {
        profile: {
          defaultQuantity: 'duty_cycle',
          unit: 'percent',
          convert: 'not_registered_converter',
        },
      },
    };
    registry.register(def);

    const batch: ActuatorOutputBatch = { simTimeUs: '0', pwm: { 0: 7.5 }, gpio: {} };
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'x', transport: 'pwm_channel', transportKey: 0 },
    ];
    const components: CircuitComponentInstance[] = [
      {
        id: 'x',
        type: 'test_unreg_conv',
        props: {},
        pinConnections: {},
        position: { x: 0, y: 0 },
      },
    ];
    expect(mapActuatorOutputs(batch, sources, components)).toEqual([]);
  });

  it('reads gpio_pin transport from batch.gpio', () => {
    const def: PeripheralDefinition = {
      type: 'test_gpio_act',
      displayName: 'GPIO Act',
      category: 'actuator',
      size: { width: 1, height: 1 },
      wireColor: '#000',
      pins: [],
      props: {},
      actuatorObserve: {
        profile: {
          defaultQuantity: 'state',
          unit: 'bool',
          convert: 'test_gpio_to_state',
        },
      },
    };
    registry.register(def);
    actuatorConverterRegistry.register('test_gpio_to_state', (raw) => ({
      quantity: 'state',
      value: raw ? 'on' : 'off',
      unit: 'bool',
      role: 'command',
    }));

    const batch: ActuatorOutputBatch = {
      simTimeUs: '42',
      pwm: {},
      gpio: { 7: true },
    };
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 'g', transport: 'gpio_pin', transportKey: 7 },
    ];
    const components: CircuitComponentInstance[] = [
      {
        id: 'g',
        type: 'test_gpio_act',
        props: {},
        pinConnections: {},
        position: { x: 0, y: 0 },
      },
    ];

    const obs = mapActuatorOutputs(batch, sources, components);
    expect(obs).toEqual([
      {
        deviceComponentId: 'g',
        quantity: 'state',
        value: 'on',
        unit: 'bool',
        role: 'command',
        simTimeUs: '42',
      },
    ]);
  });

  it('skips source and logs when converter throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const def: PeripheralDefinition = {
      type: 'test_throw_conv',
      displayName: 'Throw',
      category: 'actuator',
      size: { width: 1, height: 1 },
      wireColor: '#000',
      pins: [],
      props: {},
      actuatorObserve: {
        profile: {
          defaultQuantity: 'duty_cycle',
          unit: 'percent',
          convert: 'test_throws',
        },
      },
    };
    registry.register(def);
    actuatorConverterRegistry.register('test_throws', () => {
      throw new Error('boom');
    });

    const batch: ActuatorOutputBatch = { simTimeUs: '0', pwm: { 0: 7.5 }, gpio: {} };
    const sources: ActuatorObserveSource[] = [
      { deviceComponentId: 't', transport: 'pwm_channel', transportKey: 0 },
    ];
    const components: CircuitComponentInstance[] = [
      {
        id: 't',
        type: 'test_throw_conv',
        props: {},
        pinConnections: {},
        position: { x: 0, y: 0 },
      },
    ];

    expect(mapActuatorOutputs(batch, sources, components)).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

import { describe, expect, it } from 'vitest';
import { OLED_WIDTH, OLED_HEIGHT } from '@/constants/oled';
import {
  getDefaultProps,
  getDefaultPinConnections,
  getComponentSize,
  registry,
} from '../index';

describe('peripheral registry helpers', () => {
  it.each([
    ['led', { width: 50, height: 60 }],
    ['button', { width: 80, height: 60 }],
    ['oled', { width: OLED_WIDTH, height: OLED_HEIGHT }],
    ['ultrasonic', { width: 180, height: 100 }],
  ] as const)('%s size matches definition', (type, size) => {
    expect(getComponentSize(type)).toEqual(size);
    expect(registry.get(type)?.size).toEqual(size);
  });

  it('led pin relX/relY match definition (A, C)', () => {
    const pins = registry.get('led')!.pins;
    const pinA = pins.find(p => p.name === 'A');
    const pinC = pins.find(p => p.name === 'C');
    expect(pinA).toMatchObject({ relX: 30, relY: 50 });
    expect(pinC).toMatchObject({ relX: 10, relY: 50 });
  });

  it('ultrasonic TRIG relX/relY match definition', () => {
    const trig = registry.get('ultrasonic')!.pins.find(p => p.name === 'TRIG');
    expect(trig).toMatchObject({ relX: 82, relY: 95, catalogType: 'gpio' });
  });

  it('getDefaultProps for led matches schema defaults', () => {
    expect(getDefaultProps('led')).toMatchObject({ color: 'red', brightness: 1 });
  });

  it('getDefaultPinConnections for led', () => {
    expect(getDefaultPinConnections('led')).toEqual({ A: 13, C: 'GND' });
  });

  it('unknown type: getDefault* → {} / size fallback', () => {
    expect(getDefaultProps('no-such-type')).toEqual({});
    expect(getDefaultPinConnections('no-such-type')).toEqual({});
    expect(getComponentSize('no-such-type')).toEqual({ width: 0, height: 0 });
  });
});

describe('definition pin layout + catalog meta', () => {
  it('led definition has relX/relY and catalog block', () => {
    const def = registry.get('led')!;
    expect(def.pins.find(p => p.name === 'A')).toMatchObject({ relX: 30, relY: 50 });
    expect(def.pins.find(p => p.name === 'C')).toMatchObject({ relX: 10, relY: 50 });
    expect(def.catalog).toMatchObject({
      id: 'led',
      worldCoupling: 'optional',
      allowedActuatorMappings: ['gpio_to_emissive'],
    });
    expect(def.pins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'A', catalogType: 'gpio' }),
        expect.objectContaining({ name: 'C', catalogType: 'power' }),
      ]),
    );
  });

  it('button / oled / ultrasonic catalog ids and couplings', () => {
    expect(registry.get('button')?.catalog).toMatchObject({
      id: 'button_stub',
      worldCoupling: 'none',
    });
    expect(registry.get('oled')?.catalog).toMatchObject({
      id: 'oled_stub',
      worldCoupling: 'optional',
    });
    expect(registry.get('ultrasonic')?.catalog).toMatchObject({
      id: 'hc-sr04',
      worldCoupling: 'required',
      allowedSensorMappings: ['raycast_range_cm'],
    });
  });
});

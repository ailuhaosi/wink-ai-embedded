import { describe, expect, it } from 'vitest';
import { peripheralConfigs } from '@/types/peripheral-pins';
import {
  peripheralConfigsAdapter,
  getDefaultProps,
  getDefaultPinConnections,
  getComponentSize,
} from '../legacy-adapter';
import { registry } from '../registry';

describe('peripheralConfigsAdapter', () => {
  it.each(['led', 'button', 'oled', 'ultrasonic'] as const)(
    '%s size matches legacy peripheralConfigs',
    (type) => {
      expect(peripheralConfigsAdapter[type]?.size).toEqual(peripheralConfigs[type].size);
    },
  );

  it('led pin relX/relY match legacy (A, C)', () => {
    const adapted = peripheralConfigsAdapter.led!;
    const legacy = peripheralConfigs.led;
    const pinA = adapted.pins.find((p) => p.name === 'A');
    const pinC = adapted.pins.find((p) => p.name === 'C');
    const legacyA = legacy.pins.find((p) => p.name === 'A')!;
    const legacyC = legacy.pins.find((p) => p.name === 'C')!;
    expect(pinA).toMatchObject({ relX: legacyA.relX, relY: legacyA.relY });
    expect(pinC).toMatchObject({ relX: legacyC.relX, relY: legacyC.relY });
  });

  it('ultrasonic TRIG relX/relY match legacy', () => {
    const adapted = peripheralConfigsAdapter.ultrasonic!;
    const legacyTrig = peripheralConfigs.ultrasonic.pins.find((p) => p.name === 'TRIG')!;
    const trig = adapted.pins.find((p) => p.name === 'TRIG');
    expect(trig).toMatchObject({ relX: legacyTrig.relX, relY: legacyTrig.relY });
  });

  it('maps props schema enum/color to string and preserves options', () => {
    const adapted = peripheralConfigsAdapter.led!;
    expect(adapted.props.color).toMatchObject({
      type: 'string',
      default: 'red',
      description: 'LED color',
      options: ['red', 'green', 'blue', 'yellow', 'white', 'orange', 'purple'],
    });
    expect(adapted.props.brightness).toMatchObject({
      type: 'number',
      default: 1.0,
      description: 'Brightness (0-1)',
    });
    expect(adapted.props).not.toHaveProperty('range');
  });

  it('unknown type returns undefined', () => {
    expect(peripheralConfigsAdapter['no-such-type']).toBeUndefined();
  });
});

describe('legacy-adapter helpers', () => {
  it("getDefaultProps('led') matches registry", () => {
    expect(getDefaultProps('led')).toEqual(registry.getDefaultProps('led'));
  });

  it("getDefaultPinConnections('led') matches registry", () => {
    expect(getDefaultPinConnections('led')).toEqual(registry.getDefaultPinConnections('led'));
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
    expect(def.pins.find((p) => p.name === 'A')).toMatchObject({ relX: 30, relY: 50 });
    expect(def.pins.find((p) => p.name === 'C')).toMatchObject({ relX: 10, relY: 50 });
    expect(def.catalog).toMatchObject({
      id: 'led',
      worldCoupling: 'optional',
      allowedActuatorMappings: ['gpio_to_emissive'],
    });
    expect(def.catalog?.pins).toEqual(
      expect.arrayContaining([
        { name: 'A', type: 'gpio' },
        { name: 'C', type: 'power' },
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

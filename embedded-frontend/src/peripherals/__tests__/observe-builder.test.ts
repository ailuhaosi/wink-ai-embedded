import { describe, expect, it } from 'vitest';
import { ObserveBuilderImpl } from '@/peripherals/observe-builder';
import { oledDefinition } from '@/peripherals/oled/definition';
import { ultrasonicDefinition } from '@/peripherals/ultrasonic/definition';
import type { CircuitComponentInstance } from '@/types/circuit-component';

function makeComp(
  type: string,
  pinConnections: CircuitComponentInstance['pinConnections'],
): CircuitComponentInstance {
  return {
    id: `${type}-1`,
    type,
    name: type,
    pinConnections,
    props: {},
    rotation: 0,
  };
}

describe('ObserveBuilderImpl', () => {
  it('watchGpio aggregates pins', () => {
    const builder = new ObserveBuilderImpl();
    builder.watchGpio([1, 2]);
    builder.watchGpio([3]);
    expect(builder.build().pins).toEqual([1, 2, 3]);
  });

  it('watchI2C alone keeps display collection disabled', () => {
    const builder = new ObserveBuilderImpl();
    builder.watchI2C(21, 22);
    const result = builder.build();
    expect(result.oled).toBe(false);
    expect(result.displayKinds ?? []).toEqual([]);
    expect(result.oledConfig).toEqual({ sda: 21, scl: 22 });
  });

  it('watchDisplay enables the requested display kind', () => {
    const builder = new ObserveBuilderImpl();
    builder.watchDisplay('ssd1306_fb');
    const result = builder.build();
    expect(result.displayKinds).toContain('ssd1306_fb');
    expect(result.oled).toBe(true);
  });

  it('watchUltrasonic sets ultrasonicConfig from first config', () => {
    const builder = new ObserveBuilderImpl();
    builder.watchUltrasonic(12, 13);
    expect(builder.build().ultrasonicConfig).toEqual({ trig: 12, echo: 13 });
  });

  it('setParam passes through to build()', () => {
    const builder = new ObserveBuilderImpl();
    builder.setParam('hasOled', true);
    builder.setParam('custom', 42);
    const result = builder.build();
    expect(result.hasOled).toBe(true);
    expect(result.custom).toBe(42);
  });

  it('multi-peripheral: I2C then ultrasonic uses first of each config', () => {
    const builder = new ObserveBuilderImpl();
    builder.watchI2C(21, 22);
    builder.watchI2C(18, 19);
    builder.watchUltrasonic(12, 13);
    builder.watchUltrasonic(14, 15);
    const result = builder.build();
    expect(result.oled).toBe(false);
    expect(result.displayKinds ?? []).toEqual([]);
    expect(result.oledConfig).toEqual({ sda: 21, scl: 22 });
    expect(result.ultrasonicConfig).toEqual({ trig: 12, echo: 13 });
  });

  it('build defaults: empty pins, oled false, null configs', () => {
    const result = new ObserveBuilderImpl().build();
    expect(result.pins).toEqual([]);
    expect(result.oled).toBe(false);
    expect(result.oledConfig).toBeNull();
    expect(result.ultrasonicConfig).toBeNull();
  });
});

describe('definition.simulation.observe hooks', () => {
  it('oled observe watches I2C from DATA/CLK', () => {
    const builder = new ObserveBuilderImpl();
    const comp = makeComp('oled', { DATA: 21, CLK: 22 });
    expect(oledDefinition.simulation?.observe).toBeTypeOf('function');
    oledDefinition.simulation!.observe!(comp, builder);
    const result = builder.build();
    expect(result.oled).toBe(true);
    expect(result.oledConfig).toEqual({ sda: 21, scl: 22 });
  });

  it('oled observe coerces non-number pins to null', () => {
    const builder = new ObserveBuilderImpl();
    const comp = makeComp('oled', { DATA: '3V3', CLK: null });
    oledDefinition.simulation!.observe!(comp, builder);
    expect(builder.build().oledConfig).toEqual({ sda: null, scl: null });
  });

  it('ultrasonic observe watches TRIG/ECHO', () => {
    const builder = new ObserveBuilderImpl();
    const comp = makeComp('ultrasonic', { TRIG: 12, ECHO: 13 });
    expect(ultrasonicDefinition.simulation?.observe).toBeTypeOf('function');
    ultrasonicDefinition.simulation!.observe!(comp, builder);
    expect(builder.build().ultrasonicConfig).toEqual({ trig: 12, echo: 13 });
  });

  it('ultrasonic observe coerces non-number pins to null', () => {
    const builder = new ObserveBuilderImpl();
    const comp = makeComp('ultrasonic', { TRIG: 'VCC', ECHO: null });
    ultrasonicDefinition.simulation!.observe!(comp, builder);
    expect(builder.build().ultrasonicConfig).toEqual({ trig: null, echo: null });
  });
});

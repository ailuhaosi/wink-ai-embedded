import type { Component } from 'vue';
import { describe, expect, it } from 'vitest';
import '@/peripherals';
import { registry } from '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { PeripheralDefinition } from '@/peripherals/types';
import { bindWorldProps, type WorldPropsContext } from '../bindWorldProps';

const StubComponent = {} as unknown as Component;

function makeComp(
  overrides: Partial<CircuitComponentInstance> & Pick<CircuitComponentInstance, 'type'>,
): CircuitComponentInstance {
  return {
    id: overrides.id ?? 'comp-1',
    type: overrides.type,
    name: overrides.name ?? overrides.type,
    pinConnections: overrides.pinConnections ?? {},
    props: overrides.props ?? {},
    rotation: overrides.rotation ?? 0,
  };
}

const ctx: WorldPropsContext = {
  pinStates: { 13: true, 12: false },
  oledFb: new Uint8Array([1, 2, 3]),
};

describe('bindWorldProps', () => {
  it('dispatches to registry definition ui.worldProps — led props incl. level from pinStates', () => {
    const comp = makeComp({
      type: 'led',
      pinConnections: { A: 13, C: 'GND' },
      props: { color: 'red', brightness: 0.8, label: 'L1', flip: true },
    });

    // Intentionally red until Task 2.3 fills led's ui.worldProps.
    expect(bindWorldProps(comp, ctx)).toEqual({
      pinConnections: { A: 13, C: 'GND' },
      color: 'red',
      level: true,
      brightness: 0.8,
      label: 'L1',
      flip: true,
    });
  });

  it('dispatches to registry definition ui.worldProps — button props', () => {
    const comp = makeComp({
      type: 'button',
      pinConnections: { '1.l': 14, '2.l': 'VCC' },
      props: { color: 'blue', label: 'BTN', xray: true, activeLow: false },
    });

    // Intentionally red until Task 2.3 fills button's ui.worldProps.
    expect(bindWorldProps(comp, ctx)).toEqual({
      pinConnections: { '1.l': 14, '2.l': 'VCC' },
      color: 'blue',
      label: 'BTN',
      xray: true,
      activeLow: false,
    });
  });

  it('dispatches to registry definition ui.worldProps — oled props with framebuffer', () => {
    const comp = makeComp({
      type: 'oled',
      pinConnections: { DATA: 21, CLK: 22 },
    });

    // Intentionally red until Task 2.3 fills oled's ui.worldProps.
    expect(bindWorldProps(comp, ctx)).toEqual({
      pinConnections: { DATA: 21, CLK: 22 },
      framebuffer: ctx.oledFb,
    });
  });

  it('dispatches to registry definition ui.worldProps — ultrasonic props with distance', () => {
    const comp = makeComp({
      type: 'ultrasonic',
      pinConnections: { TRIG: 12, ECHO: 13 },
      props: { distance: 42 },
    });

    // Intentionally red until Task 2.3 fills ultrasonic's ui.worldProps.
    expect(bindWorldProps(comp, ctx)).toEqual({
      pinConnections: { TRIG: 12, ECHO: 13 },
      distance: 42,
    });
  });

  it('returns {} for a registered type with world.component but no ui.worldProps binder', () => {
    const def: PeripheralDefinition = {
      type: 'test-no-ui',
      displayName: 'No UI',
      category: 'other',
      size: { width: 1, height: 1 },
      pins: [],
      props: {},
      world: { component: StubComponent },
    };
    registry.register(def);

    expect(bindWorldProps(makeComp({ type: 'test-no-ui' }), ctx)).toEqual({});
  });

  it('returns null for a registered type without world.component (e.g. servo)', () => {
    expect(bindWorldProps(makeComp({ type: 'servo' }), ctx)).toBeNull();
  });

  it('returns null for unknown type without throwing', () => {
    expect(() =>
      bindWorldProps(makeComp({ type: 'unknown-gadget' }), ctx),
    ).not.toThrow();
    expect(bindWorldProps(makeComp({ type: 'unknown-gadget' }), ctx)).toBeNull();
  });
});

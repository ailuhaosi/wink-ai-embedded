import { describe, expect, it } from 'vitest';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { bindWorldProps, type WorldPropsContext } from '../bindWorldProps';

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
  it('maps led props including level from pinStates', () => {
    const comp = makeComp({
      type: 'led',
      pinConnections: { A: 13, C: 'GND' },
      props: { color: 'red', brightness: 0.8, label: 'L1', flip: true },
    });

    expect(bindWorldProps(comp, ctx)).toEqual({
      pinConnections: { A: 13, C: 'GND' },
      color: 'red',
      level: true,
      brightness: 0.8,
      label: 'L1',
      flip: true,
    });
  });

  it('maps led level to false when anode is not a numeric pin or pin is low', () => {
    expect(
      bindWorldProps(
        makeComp({
          type: 'led',
          pinConnections: { A: 'GND', C: 'GND' },
          props: { color: 'green', brightness: 1, label: '', flip: false },
        }),
        ctx,
      ),
    ).toMatchObject({ level: false });

    expect(
      bindWorldProps(
        makeComp({
          type: 'led',
          pinConnections: { A: 12, C: 'GND' },
          props: { color: 'green', brightness: 1, label: '', flip: false },
        }),
        ctx,
      ),
    ).toMatchObject({ level: false });

    expect(
      bindWorldProps(
        makeComp({
          type: 'led',
          pinConnections: { A: 99, C: 'GND' },
          props: { color: 'green', brightness: 1, label: '', flip: false },
        }),
        ctx,
      ),
    ).toMatchObject({ level: false });
  });

  it('maps button props', () => {
    const comp = makeComp({
      type: 'button',
      pinConnections: { '1.l': 14, '2.l': 'VCC' },
      props: { color: 'blue', label: 'BTN', xray: true, activeLow: false },
    });

    expect(bindWorldProps(comp, ctx)).toEqual({
      pinConnections: { '1.l': 14, '2.l': 'VCC' },
      color: 'blue',
      label: 'BTN',
      xray: true,
      activeLow: false,
    });
  });

  it('maps oled props with framebuffer from context', () => {
    const comp = makeComp({
      type: 'oled',
      pinConnections: { DATA: 21, CLK: 22 },
    });

    expect(bindWorldProps(comp, ctx)).toEqual({
      pinConnections: { DATA: 21, CLK: 22 },
      framebuffer: ctx.oledFb,
    });
  });

  it('maps ultrasonic props with distance', () => {
    const comp = makeComp({
      type: 'ultrasonic',
      pinConnections: { TRIG: 12, ECHO: 13 },
      props: { distance: 42 },
    });

    expect(bindWorldProps(comp, ctx)).toEqual({
      pinConnections: { TRIG: 12, ECHO: 13 },
      distance: 42,
    });
  });

  it('returns null for unknown type without throwing', () => {
    expect(() =>
      bindWorldProps(makeComp({ type: 'unknown-gadget' }), ctx),
    ).not.toThrow();
    expect(bindWorldProps(makeComp({ type: 'unknown-gadget' }), ctx)).toBeNull();
  });
});

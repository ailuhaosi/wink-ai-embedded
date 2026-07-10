import { describe, expect, it } from 'vitest';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { bindCanvasProps, type CanvasPropsContext } from '../bindCanvasProps';

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

const ctx: CanvasPropsContext = {
  pinStates: { 13: true, 12: false },
};

describe('bindCanvasProps', () => {
  it('maps led props including pinStates from context', () => {
    const comp = makeComp({
      type: 'led',
      pinConnections: { A: 13, C: 'GND' },
      props: { color: 'red', brightness: 0.8, label: 'L1', flip: true },
    });

    expect(bindCanvasProps(comp, ctx)).toEqual({
      pinConnections: { A: 13, C: 'GND' },
      color: 'red',
      brightness: 0.8,
      label: 'L1',
      flip: true,
      pinStates: ctx.pinStates,
    });
  });

  it('maps button props', () => {
    const comp = makeComp({
      type: 'button',
      pinConnections: { '1.l': 14, '2.l': 'VCC' },
      props: { color: 'blue', label: 'BTN', xray: true, activeLow: false },
    });

    expect(bindCanvasProps(comp, ctx)).toEqual({
      color: 'blue',
      label: 'BTN',
      xray: true,
    });
  });

  it('maps oled to empty props (glyph self-paints)', () => {
    const comp = makeComp({
      type: 'oled',
      pinConnections: { DATA: 21, CLK: 22 },
    });

    expect(bindCanvasProps(comp, ctx)).toEqual({});
  });

  it('maps ultrasonic to empty props', () => {
    const comp = makeComp({
      type: 'ultrasonic',
      pinConnections: { TRIG: 12, ECHO: 13 },
      props: { distance: 42 },
    });

    expect(bindCanvasProps(comp, ctx)).toEqual({});
  });

  it('returns null for unknown type without throwing', () => {
    expect(() =>
      bindCanvasProps(makeComp({ type: 'unknown-gadget' }), ctx),
    ).not.toThrow();
    expect(bindCanvasProps(makeComp({ type: 'unknown-gadget' }), ctx)).toBeNull();
  });
});

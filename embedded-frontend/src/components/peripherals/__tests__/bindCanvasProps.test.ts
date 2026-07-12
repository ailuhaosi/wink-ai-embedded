import type { Component } from 'vue';
import { describe, expect, it } from 'vitest';
import '@/peripherals';
import { registry } from '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { PeripheralDefinition } from '@/peripherals/types';
import { bindCanvasProps, type CanvasPropsContext } from '../bindCanvasProps';

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

const ctx: CanvasPropsContext = {
  pinStates: { 13: true, 12: false },
};

describe('bindCanvasProps', () => {
  it('dispatches to registry definition ui.canvasProps — led props incl. pinStates', () => {
    const comp = makeComp({
      type: 'led',
      pinConnections: { A: 13, C: 'GND' },
      props: { color: 'red', brightness: 0.8, label: 'L1', flip: true },
    });

    // NOTE: expects the shape ui.canvasProps should produce once Task 2.3 fills
    // led's definition — this is intentionally red until then.
    expect(bindCanvasProps(comp, ctx)).toEqual({
      pinConnections: { A: 13, C: 'GND' },
      color: 'red',
      brightness: 0.8,
      label: 'L1',
      flip: true,
      pinStates: ctx.pinStates,
    });
  });

  it('dispatches to registry definition ui.canvasProps — button props', () => {
    const comp = makeComp({
      type: 'button',
      pinConnections: { '1.l': 14, '2.l': 'VCC' },
      props: { color: 'blue', label: 'BTN', xray: true, activeLow: false },
    });

    // Intentionally red until Task 2.3 fills button's ui.canvasProps.
    expect(bindCanvasProps(comp, ctx)).toEqual({
      color: 'blue',
      label: 'BTN',
      xray: true,
    });
  });

  it('maps oled canvasProps to framebuffer from ctx.displayFb ?? ctx.oledFb (Task 2.4)', () => {
    const comp = makeComp({
      type: 'oled',
      pinConnections: { DATA: 21, CLK: 22 },
    });
    const fb = new Uint8Array([1, 2, 3]);

    expect(bindCanvasProps(comp, ctx)).toEqual({ framebuffer: null });
    expect(bindCanvasProps(comp, { ...ctx, oledFb: fb })).toEqual({ framebuffer: fb });
    expect(bindCanvasProps(comp, { ...ctx, displayFb: fb })).toEqual({ framebuffer: fb });
  });

  it('maps ultrasonic to empty props — already green (no ui binder needed)', () => {
    const comp = makeComp({
      type: 'ultrasonic',
      pinConnections: { TRIG: 12, ECHO: 13 },
      props: { distance: 42 },
    });

    expect(bindCanvasProps(comp, ctx)).toEqual({});
  });

  it('returns {} for a registered type with canvas.component but no ui.canvasProps binder', () => {
    const def: PeripheralDefinition = {
      type: 'test-no-ui',
      displayName: 'No UI',
      category: 'other',
      size: { width: 1, height: 1 },
      pins: [],
      props: {},
      canvas: { component: StubComponent },
    };
    registry.register(def);

    expect(bindCanvasProps(makeComp({ type: 'test-no-ui' }), ctx)).toEqual({});
  });

  it('returns null for a registered type without canvas.component', () => {
    const def: PeripheralDefinition = {
      type: 'test-no-canvas',
      displayName: 'No Canvas',
      category: 'other',
      size: { width: 1, height: 1 },
      pins: [],
      props: {},
    };
    registry.register(def);

    expect(bindCanvasProps(makeComp({ type: 'test-no-canvas' }), ctx)).toBeNull();
  });

  it('returns null for unknown type without throwing', () => {
    expect(() =>
      bindCanvasProps(makeComp({ type: 'unknown-gadget' }), ctx),
    ).not.toThrow();
    expect(bindCanvasProps(makeComp({ type: 'unknown-gadget' }), ctx)).toBeNull();
  });

  it('does not eagerly read oledFb/actuatorObservations when binder ignores ctx (button)', () => {
    let oledReads = 0;
    let displayReads = 0;
    let obsReads = 0;
    const lazyCtx: CanvasPropsContext = {
      pinStates: {},
      get oledFb() {
        oledReads += 1;
        return null;
      },
      get displayFb() {
        displayReads += 1;
        return null;
      },
      get actuatorObservations() {
        obsReads += 1;
        return [];
      },
    };

    bindCanvasProps(
      makeComp({
        type: 'button',
        props: { color: 'green', label: '', xray: false, activeLow: true },
      }),
      lazyCtx,
    );

    expect(oledReads).toBe(0);
    expect(displayReads).toBe(0);
    expect(obsReads).toBe(0);
  });

  it('reads displayFb when oled binder runs', () => {
    let displayReads = 0;
    const lazyCtx: CanvasPropsContext = {
      pinStates: {},
      get displayFb() {
        displayReads += 1;
        return new Uint8Array([1]);
      },
      get oledFb() {
        return null;
      },
    };

    const props = bindCanvasProps(makeComp({ type: 'oled' }), lazyCtx);

    expect(displayReads).toBeGreaterThan(0);
    expect(props).toEqual({ framebuffer: new Uint8Array([1]) });
  });
});

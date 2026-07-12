import { describe, expect, it } from 'vitest';
import '@/peripherals';
import { registry } from '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { PeripheralDefinition } from '@/peripherals/types';
import { resolveCanvasEntry } from '../resolveCanvasEntry';
import type { CanvasPropsContext } from '../bindCanvasProps';

function makeComp(
  overrides: Partial<CircuitComponentInstance> & Pick<CircuitComponentInstance, 'type' | 'id'>,
): CircuitComponentInstance {
  return {
    id: overrides.id,
    type: overrides.type,
    name: overrides.name ?? overrides.type,
    pinConnections: overrides.pinConnections ?? {},
    props: overrides.props ?? {},
    rotation: overrides.rotation ?? 0,
  };
}

const ctx: CanvasPropsContext = {
  pinStates: { 13: true },
};

describe('resolveCanvasEntry', () => {
  it('resolves led with canvas component and bound props', () => {
    const entry = resolveCanvasEntry(
      makeComp({
        id: 'led-1',
        type: 'led',
        pinConnections: { A: 13, C: 'GND' },
        props: { color: 'red', brightness: 1, label: '', flip: false },
      }),
      ctx,
    );

    expect(entry).not.toBeNull();
    expect(entry!.component).toBe(registry.get('led')!.canvas!.component);
    expect(entry!.boundProps).toMatchObject({
      color: 'red',
      pinStates: ctx.pinStates,
    });
  });

  it('resolves button/oled/ultrasonic with registry canvas components', () => {
    const button = resolveCanvasEntry(
      makeComp({
        id: 'btn-1',
        type: 'button',
        props: { color: 'red', label: '', xray: false, activeLow: true },
      }),
      ctx,
    );
    expect(button!.component).toBe(registry.get('button')!.canvas!.component);
    expect(button!.boundProps).toEqual({ color: 'red', label: '', xray: false });

    const oled = resolveCanvasEntry(
      makeComp({ id: 'oled-1', type: 'oled' }),
      ctx,
    );
    expect(oled!.component).toBe(registry.get('oled')!.canvas!.component);
    expect(oled!.boundProps).toEqual({ framebuffer: null });

    const us = resolveCanvasEntry(
      makeComp({
        id: 'us-1',
        type: 'ultrasonic',
        props: { distance: 25 },
      }),
      ctx,
    );
    expect(us!.component).toBe(registry.get('ultrasonic')!.canvas!.component);
    expect(us!.boundProps).toEqual({});
  });

  it('returns null for unknown types without throwing', () => {
    expect(() =>
      resolveCanvasEntry(makeComp({ id: 'x', type: 'nope' }), ctx),
    ).not.toThrow();
    expect(resolveCanvasEntry(makeComp({ id: 'x', type: 'nope' }), ctx)).toBeNull();
  });

  it('returns null for registered types that lack canvas.component', () => {
    const def: PeripheralDefinition = {
      type: 'test-no-canvas',
      displayName: 'No Canvas',
      category: 'other',
      size: { width: 1, height: 1 },
      pins: [],
      props: {},
    };
    registry.register(def);

    expect(
      resolveCanvasEntry(makeComp({ id: 'a', type: 'test-no-canvas' }), ctx),
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import '@/peripherals';
import { registry } from '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { PeripheralDefinition } from '@/peripherals/types';
import { resolveWorldEntries } from '../resolveWorldEntries';
import type { WorldPropsContext } from '../bindWorldProps';

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

const ctx: WorldPropsContext = {
  pinStates: { 13: true },
  oledFb: new Uint8Array([9]),
};

describe('resolveWorldEntries', () => {
  it('resolves led/button/oled/ultrasonic with registry world components and bound props', () => {
    const components = [
      makeComp({
        id: 'led-1',
        type: 'led',
        name: 'LED A',
        pinConnections: { A: 13, C: 'GND' },
        props: { color: 'red', brightness: 1, label: '', flip: false },
      }),
      makeComp({
        id: 'btn-1',
        type: 'button',
        name: 'BTN',
        pinConnections: { '1.l': 14 },
        props: { color: 'red', label: '', xray: false, activeLow: true },
      }),
      makeComp({
        id: 'oled-1',
        type: 'oled',
        name: 'OLED',
        pinConnections: { DATA: 21, CLK: 22 },
      }),
      makeComp({
        id: 'us-1',
        type: 'ultrasonic',
        name: 'Sonar',
        pinConnections: { TRIG: 12, ECHO: 13 },
        props: { distance: 25 },
      }),
    ];

    const entries = resolveWorldEntries(components, ctx);

    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.id)).toEqual(['led-1', 'btn-1', 'oled-1', 'us-1']);
    expect(entries.map((e) => e.name)).toEqual(['LED A', 'BTN', 'OLED', 'Sonar']);

    expect(entries[0].component).toBe(registry.get('led')!.world!.component);
    expect(entries[0].boundProps).toMatchObject({ level: true, color: 'red' });

    expect(entries[1].component).toBe(registry.get('button')!.world!.component);
    expect(entries[1].boundProps).toMatchObject({ activeLow: true, color: 'red' });

    expect(entries[2].component).toBe(registry.get('oled')!.world!.component);
    expect(entries[2].boundProps).toEqual({
      pinConnections: { DATA: 21, CLK: 22 },
      framebuffer: ctx.oledFb,
    });

    expect(entries[3].component).toBe(registry.get('ultrasonic')!.world!.component);
    expect(entries[3].boundProps).toMatchObject({ distance: 25 });
  });

  it('skips unknown types without throwing', () => {
    expect(() =>
      resolveWorldEntries([makeComp({ id: 'x', type: 'nope' })], ctx),
    ).not.toThrow();
    expect(resolveWorldEntries([makeComp({ id: 'x', type: 'nope' })], ctx)).toEqual([]);
  });

  it('skips registered types that lack world.component', () => {
    const def: PeripheralDefinition = {
      type: 'test-no-world',
      displayName: 'No World',
      category: 'other',
      size: { width: 1, height: 1 },
      pins: [],
      props: {},
    };
    registry.register(def);

    const entries = resolveWorldEntries(
      [
        makeComp({ id: 'a', type: 'test-no-world' }),
        makeComp({
          id: 'b',
          type: 'led',
          pinConnections: { A: 13, C: 'GND' },
          props: { color: 'red', brightness: 1, label: '', flip: false },
        }),
      ],
      ctx,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('b');
  });
});

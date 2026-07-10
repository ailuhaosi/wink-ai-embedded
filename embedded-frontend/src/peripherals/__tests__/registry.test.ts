import { describe, expect, it } from 'vitest';
import { registry } from '@/peripherals';
import type { PeripheralDefinition } from '@/peripherals/types';

function makeDef(overrides: Partial<PeripheralDefinition> & Pick<PeripheralDefinition, 'type'>): PeripheralDefinition {
  return {
    displayName: overrides.displayName ?? overrides.type,
    category: overrides.category ?? 'other',
    size: overrides.size ?? { width: 10, height: 20 },
    pins: overrides.pins ?? [],
    props: overrides.props ?? {},
    ...overrides,
  };
}

describe('peripheral registry', () => {
  it('register + get returns the same definition', () => {
    const def = makeDef({
      type: 'test-led',
      displayName: 'Test LED',
      category: 'actuator',
      wireColor: '#00ff88',
    });
    registry.register(def);
    expect(registry.get('test-led')).toBe(def);
  });

  it('get returns undefined for unknown type', () => {
    expect(registry.get('no-such-type')).toBeUndefined();
  });

  it('list returns all registered definitions', () => {
    const before = registry.list().length;
    const a = makeDef({ type: 'test-list-a', category: 'input' });
    const b = makeDef({ type: 'test-list-b', category: 'sensor' });
    registry.register(a);
    registry.register(b);
    const listed = registry.list();
    expect(listed).toEqual(expect.arrayContaining([a, b]));
    expect(listed.length).toBe(before + 2);
  });

  it('listByCategory groups by category', () => {
    registry.register(makeDef({ type: 'test-cat-btn', category: 'input', displayName: 'Btn' }));
    registry.register(makeDef({ type: 'test-cat-led', category: 'actuator', displayName: 'Led' }));
    registry.register(makeDef({ type: 'test-cat-sw', category: 'input', displayName: 'Sw' }));

    const groups = registry.listByCategory();
    const input = groups.find((g) => g.category === 'input');
    const actuator = groups.find((g) => g.category === 'actuator');

    expect(input?.items.map((i) => i.type)).toEqual(
      expect.arrayContaining(['test-cat-btn', 'test-cat-sw']),
    );
    expect(actuator?.items.map((i) => i.type)).toEqual(
      expect.arrayContaining(['test-cat-led']),
    );
  });

  it('getWireColor returns definition color or #ffffff fallback', () => {
    registry.register(makeDef({ type: 'test-colored', wireColor: '#38bdf8' }));
    expect(registry.getWireColor('test-colored')).toBe('#38bdf8');
    expect(registry.getWireColor('missing')).toBe('#ffffff');
  });

  it('getSize returns definition size or zero fallback', () => {
    registry.register(makeDef({ type: 'test-sized', size: { width: 50, height: 60 } }));
    expect(registry.getSize('test-sized')).toEqual({ width: 50, height: 60 });
    expect(registry.getSize('missing')).toEqual({ width: 0, height: 0 });
  });

  it('getDefaultProps derives defaults from props schema', () => {
    registry.register(
      makeDef({
        type: 'test-with-props',
        props: {
          color: { type: 'string', default: 'red', description: 'Color' },
          brightness: { type: 'number', default: 1, description: 'Brightness' },
          flip: { type: 'boolean', default: false, description: 'Flip' },
        },
      }),
    );
    expect(registry.getDefaultProps('test-with-props')).toEqual({
      color: 'red',
      brightness: 1,
      flip: false,
    });
    expect(registry.getDefaultProps('missing')).toEqual({});
  });

  it('getDefaultPinConnections derives from pin defaultConnection', () => {
    registry.register(
      makeDef({
        type: 'test-with-pins',
        pins: [
          { name: 'A', signalType: 'digital', defaultConnection: 13 },
          { name: 'C', signalType: 'power', defaultConnection: 'GND' },
          { name: 'X', signalType: 'digital', defaultConnection: null },
          { name: 'Y', signalType: 'digital' },
        ],
      }),
    );
    expect(registry.getDefaultPinConnections('test-with-pins')).toEqual({
      A: 13,
      C: 'GND',
    });
    expect(registry.getDefaultPinConnections('missing')).toEqual({});
  });
});

describe('built-in peripheral packages', () => {
  it('registers led, button, oled, ultrasonic with expected metadata', () => {
    expect(registry.get('led')?.wireColor).toBe('#00ff88');
    expect(registry.get('button')?.wireColor).toBe('#38bdf8');
    expect(registry.get('oled')?.wireColor).toBe('#a855f7');
    expect(registry.get('ultrasonic')?.wireColor).toBe('#eab308');

    expect(registry.getSize('led')).toEqual({ width: 50, height: 60 });
    expect(registry.getDefaultProps('led')).toMatchObject({ color: 'red', brightness: 1 });
    expect(registry.getDefaultPinConnections('led')).toMatchObject({ A: 13, C: 'GND' });

    expect(registry.get('led')?.world?.component).toBeTruthy();
    expect(registry.get('button')?.world?.component).toBeTruthy();
    expect(registry.get('oled')?.world?.component).toBeTruthy();
    expect(registry.get('ultrasonic')?.world?.component).toBeTruthy();

    expect(registry.get('led')?.canvas?.component).toBeTruthy();
    expect(registry.get('button')?.canvas?.component).toBeTruthy();
    expect(registry.get('oled')?.canvas?.component).toBeTruthy();
    expect(registry.get('ultrasonic')?.canvas?.component).toBeTruthy();
  });
});

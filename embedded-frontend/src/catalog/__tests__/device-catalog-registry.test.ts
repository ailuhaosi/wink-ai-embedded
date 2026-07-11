import { describe, expect, it } from 'vitest';
import {
  deviceCatalog,
  modelIdForCanvasType,
  canvasTypeForModelId,
  definitionToCatalogEntry,
} from '@/catalog/device-catalog';
import { registry } from '@/peripherals';
import type { PeripheralDefinition } from '@/peripherals/types';

function makeDef(
  overrides: Partial<PeripheralDefinition> & Pick<PeripheralDefinition, 'type'>,
): PeripheralDefinition {
  return {
    displayName: overrides.displayName ?? overrides.type,
    category: overrides.category ?? 'other',
    size: overrides.size ?? { width: 10, height: 20 },
    pins: overrides.pins ?? [],
    props: overrides.props ?? {},
    ...overrides,
  };
}

describe('device-catalog from registry', () => {
  it('lists every registry peripheral that has a catalog block by canvasType', () => {
    const withCatalog = registry.list().filter((d) => d.catalog);
    expect(withCatalog.length).toBeGreaterThan(0);

    const canvasTypes = deviceCatalog.listDevices().map((d) => d.canvasType);
    for (const def of withCatalog) {
      expect(canvasTypes).toContain(def.type);
    }
  });

  it('every catalog peripheral (category=peripheral) has registry.get(canvasType)', () => {
    const peripherals = deviceCatalog
      .listDevices()
      .filter((d) => d.category === 'peripheral');
    expect(peripherals.length).toBeGreaterThan(0);

    for (const entry of peripherals) {
      expect(entry.canvasType, `${entry.id} missing canvasType`).toBeDefined();
      expect(
        registry.get(entry.canvasType!),
        `catalog peripheral ${entry.id} canvasType=${entry.canvasType} not in registry`,
      ).toBeDefined();
    }
  });

  it('modelIdForCanvasType ↔ canvasTypeForModelId round-trips for registry peripherals', () => {
    const withCatalog = registry.list().filter((d) => d.catalog);
    for (const def of withCatalog) {
      const modelId = modelIdForCanvasType(def.type);
      expect(modelId).toBe(def.catalog!.id);
      expect(canvasTypeForModelId(modelId)).toBe(def.type);
    }
  });

  it('definitionToCatalogEntry maps definition catalog fields from unified pins', () => {
    const def = makeDef({
      type: 'test-map-p22',
      displayName: 'Mapped Peripheral',
      category: 'sensor',
      catalog: {
        id: 'mapped_stub',
        description: 'Mapped',
        worldCoupling: 'required',
        allowedSensorMappings: ['raycast_range_cm'],
        allowedActuatorMappings: ['gpio_to_emissive'],
      },
      pins: [
        {
          name: 'SIG',
          catalogType: 'gpio',
          description: 'Signal',
          signalType: 'digital',
        },
        { name: 'GND', catalogType: 'power', signalType: 'power' },
      ],
    });

    expect(definitionToCatalogEntry(def)).toEqual({
      id: 'mapped_stub',
      displayName: 'Mapped Peripheral',
      category: 'peripheral',
      canvasType: 'test-map-p22',
      pins: [
        { name: 'SIG', type: 'gpio', description: 'Signal' },
        { name: 'GND', type: 'power' },
      ],
      simulation: {
        worldCoupling: 'required',
        allowedSensorMappings: ['raycast_range_cm'],
        allowedActuatorMappings: ['gpio_to_emissive'],
      },
    });
  });

  it('includes a newly registered peripheral that has catalog', () => {
    const type = `test-with-catalog-p22-${Date.now()}`;
    registry.register(
      makeDef({
        type,
        displayName: 'Dynamic Catalog Peripheral',
        catalog: {
          id: `${type}_id`,
          description: 'Dynamic',
          worldCoupling: 'optional',
        },
        pins: [{ name: 'A', catalogType: 'gpio', signalType: 'digital' }],
      }),
    );

    const entry = deviceCatalog.listDevices().find((d) => d.canvasType === type);
    expect(entry).toMatchObject({
      id: `${type}_id`,
      displayName: 'Dynamic Catalog Peripheral',
      category: 'peripheral',
      canvasType: type,
    });
    expect(modelIdForCanvasType(type)).toBe(`${type}_id`);
    expect(canvasTypeForModelId(`${type}_id`)).toBe(type);
  });

  it('skips registry peripherals that lack a catalog block', () => {
    const type = `test-no-catalog-p22-${Date.now()}`;
    registry.register(
      makeDef({
        type,
        displayName: 'No Catalog Peripheral',
      }),
    );

    const entry = deviceCatalog.listDevices().find((d) => d.canvasType === type);
    expect(entry).toBeUndefined();
    expect(deviceCatalog.getDevice(type)).toBeUndefined();
  });

  it('preserves builtin canvasType → modelId mappings', () => {
    expect(modelIdForCanvasType('led')).toBe('led');
    expect(modelIdForCanvasType('button')).toBe('button_stub');
    expect(modelIdForCanvasType('oled')).toBe('oled_stub');
    expect(modelIdForCanvasType('ultrasonic')).toBe('hc-sr04');
    expect(modelIdForCanvasType('motor_driver_stub')).toBe('motor_driver_stub');
    expect(modelIdForCanvasType('dht22_stub')).toBe('dht22_stub');
    expect(modelIdForCanvasType('buzzer_stub')).toBe('buzzer_stub');
  });

  it('board devices come from boardRegistry', () => {
    const board = deviceCatalog.getDevice('esp32-devkit-v1');
    expect(board).toMatchObject({
      id: 'esp32-devkit-v1',
      category: 'board',
      simulation: { worldCoupling: 'none' },
    });
    expect(deviceCatalog.getBoard('esp32-devkit-v1')?.gpioPins.length).toBeGreaterThan(0);
  });

  it('stub peripherals come from registry (not catalog hardcoding)', () => {
    for (const id of ['motor_driver_stub', 'dht22_stub', 'buzzer_stub'] as const) {
      const entry = deviceCatalog.getDevice(id);
      expect(entry, id).toBeDefined();
      expect(entry?.canvasType).toBe(id);
      expect(entry?.category).toBe('peripheral');
      expect(registry.get(id)?.canvas?.component).toBeTruthy();
    }
  });
});

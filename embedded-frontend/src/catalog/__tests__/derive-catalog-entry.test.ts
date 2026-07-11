import { describe, expect, it } from 'vitest';
import { definitionToCatalogEntry, pinsToCatalogPins } from '@/catalog/derive-catalog-entry';
import { ultrasonicDefinition } from '@/peripherals/ultrasonic/definition';
import type { PeripheralDefinition } from '@/peripherals/types';

describe('derive-catalog-entry', () => {
  it('pinsToCatalogPins maps unified pins to catalog pin defs', () => {
    expect(pinsToCatalogPins(ultrasonicDefinition.pins)).toEqual([
      { name: 'VCC', type: 'power', description: 'Power 5V' },
      { name: 'TRIG', type: 'gpio', description: 'Trigger input' },
      { name: 'ECHO', type: 'digital_in', description: 'Echo output' },
      { name: 'GND', type: 'power', description: 'Ground' },
    ]);
  });

  it('definitionToCatalogEntry derives hc-sr04 catalog from ultrasonic definition', () => {
    expect(definitionToCatalogEntry(ultrasonicDefinition)).toEqual({
      id: 'hc-sr04',
      displayName: 'HC-SR04 Ultrasonic',
      category: 'peripheral',
      canvasType: 'ultrasonic',
      pins: [
        { name: 'VCC', type: 'power', description: 'Power 5V' },
        { name: 'TRIG', type: 'gpio', description: 'Trigger input' },
        { name: 'ECHO', type: 'digital_in', description: 'Echo output' },
        { name: 'GND', type: 'power', description: 'Ground' },
      ],
      simulation: {
        worldCoupling: 'required',
        allowedSensorMappings: ['raycast_range_cm'],
      },
    });
  });

  it('uses catalog.worldCoupling only (not simulation)', () => {
    const def: PeripheralDefinition = {
      type: 'coupling-test',
      displayName: 'Coupling Test',
      category: 'other',
      size: { width: 1, height: 1 },
      props: {},
      catalog: {
        id: 'coupling_test',
        worldCoupling: 'optional',
      },
      pins: [{ name: 'SIG', catalogType: 'gpio', signalType: 'digital' }],
      simulation: {
        observe: () => {},
      },
    };
    expect(definitionToCatalogEntry(def).simulation?.worldCoupling).toBe('optional');
  });
});

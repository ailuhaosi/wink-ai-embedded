import type { PeripheralDefinition } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';

export const dht22StubDefinition: PeripheralDefinition = {
  type: 'dht22_stub',
  displayName: 'DHT22 (stub)',
  category: 'sensor',
  catalog: {
    id: 'dht22_stub',
    description: 'DHT22 temperature/humidity sensor placeholder',
    worldCoupling: 'required',
    allowedSensorMappings: ['temperature_field_sample'],
  },
  size: { width: 70, height: 60 },
  wireColor: '#22d3ee',
  pins: [
    {
      name: 'DATA',
      catalogType: 'gpio',
      description: 'Single-wire data',
      required: true,
      signalType: 'digital',
      defaultConnection: 4,
      relX: 35,
      relY: 52,
    },
  ],
  props: {},
  canvas: { component: CanvasGlyph },
  ui: {
    canvasProps: () => ({}),
  },
};

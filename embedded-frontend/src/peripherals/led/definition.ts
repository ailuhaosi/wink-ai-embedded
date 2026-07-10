import type { PeripheralDefinition, PeripheralPropsSchema } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';
import WorldWidget from './WorldWidget.vue';

const ledProps: PeripheralPropsSchema = {
  color: {
    type: 'string',
    default: 'red',
    description: 'LED color',
    options: ['red', 'green', 'blue', 'yellow', 'white', 'orange', 'purple'],
  },
  brightness: {
    type: 'number',
    default: 1.0,
    description: 'Brightness (0-1)',
  },
  label: {
    type: 'string',
    default: '',
    description: 'Label text',
  },
  flip: {
    type: 'boolean',
    default: false,
    description: 'Flip orientation',
  },
};

export const ledDefinition: PeripheralDefinition = {
  type: 'led',
  displayName: 'Virtual LED',
  category: 'actuator',
  catalog: {
    id: 'led',
    description: 'Virtual LED',
    pins: [
      { name: 'A', type: 'gpio' },
      { name: 'C', type: 'power' },
    ],
    worldCoupling: 'optional',
    allowedActuatorMappings: ['gpio_to_emissive'],
  },
  size: { width: 50, height: 60 },
  wireColor: '#00ff88',
  pins: [
    { name: 'A', description: 'Anode (+)', required: true, signalType: 'digital', defaultConnection: 13, relX: 30, relY: 50 },
    { name: 'C', description: 'Cathode (-)', required: true, signalType: 'power', defaultConnection: 'GND', relX: 10, relY: 50 },
  ],
  props: ledProps,
  canvas: { component: CanvasGlyph },
  world: { component: WorldWidget },
};

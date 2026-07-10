import type { PeripheralDefinition, PeripheralPropsSchema } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';
import WorldWidget from './WorldWidget.vue';

const ultrasonicProps: PeripheralPropsSchema = {
  distance: {
    type: 'number',
    default: 25,
    description: 'Distance in cm',
    range: { min: 2, max: 400, step: 1 },
  },
};

export const ultrasonicDefinition: PeripheralDefinition = {
  type: 'ultrasonic',
  displayName: 'HC-SR04 Ultrasonic',
  category: 'sensor',
  size: { width: 180, height: 100 },
  wireColor: '#eab308',
  pins: [
    { name: 'VCC', description: 'Power 5V', required: true, signalType: 'power', defaultConnection: 'VCC' },
    { name: 'TRIG', description: 'Trigger input', required: true, signalType: 'digital', defaultConnection: 12 },
    { name: 'ECHO', description: 'Echo output', required: true, signalType: 'digital', defaultConnection: 13 },
    { name: 'GND', description: 'Ground', required: true, signalType: 'power', defaultConnection: 'GND' },
  ],
  props: ultrasonicProps,
  canvas: { component: CanvasGlyph },
  world: { component: WorldWidget },
};

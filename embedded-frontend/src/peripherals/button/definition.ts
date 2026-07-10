import type { PeripheralDefinition, PeripheralPropsSchema } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';
import WorldWidget from './WorldWidget.vue';

const buttonProps: PeripheralPropsSchema = {
  color: {
    type: 'string',
    default: 'red',
    description: 'Button color',
    options: ['red', 'green', 'blue', 'yellow', 'white', 'black'],
  },
  label: {
    type: 'string',
    default: '',
    description: 'Label text',
  },
  xray: {
    type: 'boolean',
    default: false,
    description: 'Show internal structure',
  },
  activeLow: {
    type: 'boolean',
    default: true,
    description: 'Active low mode (pull-up)',
  },
};

export const buttonDefinition: PeripheralDefinition = {
  type: 'button',
  displayName: 'Push Button',
  category: 'input',
  catalog: {
    id: 'button_stub',
    description: 'Push Button',
    pins: [
      { name: '1.l', type: 'gpio' },
      { name: '2.l', type: 'power' },
    ],
    worldCoupling: 'none',
  },
  size: { width: 80, height: 60 },
  wireColor: '#38bdf8',
  pins: [
    { name: '1.l', description: 'Left pin 1', required: false, signalType: 'digital', defaultConnection: null, relX: -5, relY: 20 },
    { name: '2.l', description: 'Left pin 2', required: false, signalType: 'power', defaultConnection: 'VCC', relX: -5, relY: 40 },
    { name: '1.r', description: 'Right pin 1', required: false, signalType: 'digital', defaultConnection: null, relX: 75, relY: 13 },
    { name: '2.r', description: 'Right pin 2', required: false, signalType: 'digital', defaultConnection: null, relX: 75, relY: 33 },
  ],
  props: buttonProps,
  canvas: { component: CanvasGlyph },
  world: { component: WorldWidget },
};

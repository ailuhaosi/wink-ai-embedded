import type { PeripheralDefinition, PeripheralPropsSchema } from '../types';
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
  size: { width: 80, height: 60 },
  wireColor: '#38bdf8',
  pins: [
    { name: '1.l', description: 'Left pin 1', required: false, signalType: 'digital', defaultConnection: null },
    { name: '2.l', description: 'Left pin 2', required: false, signalType: 'power', defaultConnection: 'VCC' },
    { name: '1.r', description: 'Right pin 1', required: false, signalType: 'digital', defaultConnection: null },
    { name: '2.r', description: 'Right pin 2', required: false, signalType: 'digital', defaultConnection: null },
  ],
  props: buttonProps,
  world: { component: WorldWidget },
};

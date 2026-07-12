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
    worldCoupling: 'none',
  },
  size: { width: 80, height: 60 },
  wireColor: '#38bdf8',
  pins: [
    {
      name: '1.l',
      catalogType: 'gpio',
      description: 'Left pin 1',
      required: false,
      signalType: 'digital',
      defaultConnection: null,
      relX: -5,
      relY: 20,
    },
    {
      name: '2.l',
      catalogType: 'power',
      description: 'Left pin 2',
      required: false,
      signalType: 'power',
      defaultConnection: 'VCC',
      relX: -5,
      relY: 40,
    },
    {
      name: '1.r',
      catalogType: 'gpio',
      description: 'Right pin 1',
      required: false,
      signalType: 'digital',
      defaultConnection: null,
      relX: 75,
      relY: 13,
    },
    {
      name: '2.r',
      catalogType: 'gpio',
      description: 'Right pin 2',
      required: false,
      signalType: 'digital',
      defaultConnection: null,
      relX: 75,
      relY: 33,
    },
  ],
  props: buttonProps,
  canvas: { component: CanvasGlyph },
  world: { component: WorldWidget },
  simulation: {
    inject: {
      kind: 'gpio_ideal',
      apply(comp, ctx) {
        const signalPin = comp.pinConnections['1.l'];
        if (typeof signalPin !== 'number') return;
        const activeLow = comp.props.activeLow !== false;
        if (ctx.event === 'press') ctx.apis.setPinIdeal(signalPin, !activeLow);
        if (ctx.event === 'release') ctx.apis.setPinIdeal(signalPin, activeLow);
      },
      idle(comp, ctx) {
        const signalPin = comp.pinConnections['1.l'];
        if (typeof signalPin !== 'number') return;
        const activeLow = comp.props.activeLow !== false;
        ctx.apis.setPinIdeal(signalPin, activeLow);
      },
    },
  },
  ui: {
    canvasProps: (comp) => ({
      color: comp.props.color,
      label: comp.props.label,
      xray: comp.props.xray,
    }),
    worldProps: (comp) => ({
      pinConnections: comp.pinConnections,
      color: comp.props.color,
      label: comp.props.label,
      xray: comp.props.xray,
      activeLow: comp.props.activeLow,
    }),
  },
};

import type { PeripheralDefinition, PeripheralPropsSchema } from '../types';
import { isPinHigh } from '../types';
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
    worldCoupling: 'optional',
    allowedActuatorMappings: ['gpio_to_emissive'],
  },
  size: { width: 50, height: 60 },
  wireColor: '#00ff88',
  pins: [
    {
      name: 'A',
      catalogType: 'gpio',
      description: 'Anode (+)',
      required: true,
      signalType: 'digital',
      defaultConnection: 13,
      relX: 30,
      relY: 50,
    },
    {
      name: 'C',
      catalogType: 'power',
      description: 'Cathode (-)',
      required: true,
      signalType: 'power',
      defaultConnection: 'GND',
      relX: 10,
      relY: 50,
    },
  ],
  props: ledProps,
  actuatorObserve: {
    profile: {
      defaultQuantity: 'state',
      unit: 'bool',
      convert: 'gpio_to_state',
    },
  },
  simulation: {
    observe: (comp, builder) => {
      const anode = comp.pinConnections.A;
      if (typeof anode === 'number') {
        builder.watchActuatorSource({
          deviceComponentId: comp.id,
          transport: 'gpio_pin',
          transportKey: anode,
        });
      }
    },
  },
  canvas: { component: CanvasGlyph },
  world: { component: WorldWidget },
  ui: {
    canvasProps: (comp, ctx) => ({
      pinConnections: comp.pinConnections,
      color: comp.props.color,
      brightness: comp.props.brightness,
      label: comp.props.label,
      flip: comp.props.flip,
      pinStates: ctx.pinStates,
    }),
    worldProps: (comp, ctx) => ({
      pinConnections: comp.pinConnections,
      color: comp.props.color,
      level:
        typeof comp.pinConnections.A === 'number'
          ? isPinHigh(ctx.pinStates[comp.pinConnections.A])
          : false,
      brightness: comp.props.brightness,
      label: comp.props.label,
      flip: comp.props.flip,
    }),
  },
};

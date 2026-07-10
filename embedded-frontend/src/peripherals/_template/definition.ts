import type { PeripheralDefinition, PeripheralPropsSchema } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';
import WorldWidget from './WorldWidget.vue';
import InspectorExtra from './InspectorExtra.vue';

/**
 * Copy this file when creating a new peripheral package.
 * Replace 'example' with your peripheral type and fill in real metadata.
 */

const exampleProps: PeripheralPropsSchema = {
  label: {
    type: 'string',
    default: 'Example',
    description: 'Display label',
  },
  enabled: {
    type: 'boolean',
    default: true,
    description: 'Enable component',
  },
  mode: {
    type: 'enum',
    default: 'normal',
    description: 'Operating mode',
    options: ['normal', 'debug'],
  },
  intensity: {
    type: 'number',
    default: 50,
    description: 'Signal intensity (0-100)',
    range: { min: 0, max: 100, step: 1 },
    advanced: true,
  },
  accentColor: {
    type: 'color',
    default: '#38bdf8',
    description: 'Accent color',
    advanced: true,
  },
};

export const templateDefinition: PeripheralDefinition = {
  type: 'example',
  displayName: 'Example Peripheral',
  category: 'other',
  catalog: {
    id: 'example_stub',
    description: 'Example peripheral scaffold — copy and customize',
    pins: [
      { name: 'SIG', type: 'gpio', description: 'Signal pin', required: true },
      { name: 'VCC', type: 'power', description: 'Power supply', required: true },
      { name: 'GND', type: 'power', description: 'Ground', required: true },
    ],
    worldCoupling: 'optional',
    allowedActuatorMappings: ['gpio_to_emissive'],
    allowedSensorMappings: ['raycast_range_cm'],
  },
  size: { width: 80, height: 60 },
  wireColor: '#94a3b8',
  pins: [
    {
      name: 'SIG',
      description: 'Signal pin',
      required: true,
      signalType: 'digital',
      defaultConnection: 13,
      relX: 40,
      relY: 55,
    },
    {
      name: 'VCC',
      description: 'Power 3.3V',
      required: true,
      signalType: 'power',
      defaultConnection: '3V3',
      relX: 20,
      relY: 55,
    },
    {
      name: 'GND',
      description: 'Ground',
      required: true,
      signalType: 'power',
      defaultConnection: 'GND',
      relX: 60,
      relY: 55,
    },
  ],
  props: exampleProps,
  canvas: { component: CanvasGlyph },
  world: { component: WorldWidget },
  inspectorExtra: InspectorExtra,
  simulation: {
    worldCoupling: 'optional',
    observe(comp, builder) {
      const sig = comp.pinConnections.SIG;
      if (typeof sig === 'number') {
        builder.watchGpio([sig]);
      }
      // Alternative patterns (uncomment as needed):
      // builder.watchI2C(sda, scl);
      // builder.watchUltrasonic(trig, echo);
      // builder.setParam('customKey', comp.props.someValue);
    },
  },
};

import type { PeripheralDefinition, PeripheralPropsSchema } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';
import WorldWidget from './WorldWidget.vue';
import InspectorExtra from './InspectorExtra.vue';

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
  catalog: {
    id: 'hc-sr04',
    description: 'HC-SR04 Ultrasonic',
    worldCoupling: 'required',
    allowedSensorMappings: ['raycast_range_cm'],
  },
  size: { width: 180, height: 100 },
  wireColor: '#eab308',
  pins: [
    {
      name: 'VCC',
      catalogType: 'power',
      description: 'Power 5V',
      required: true,
      signalType: 'power',
      defaultConnection: 'VCC',
      relX: 72,
      relY: 95,
      wireNet: 'vcc',
    },
    {
      name: 'TRIG',
      catalogType: 'gpio',
      description: 'Trigger input',
      required: true,
      signalType: 'digital',
      defaultConnection: 12,
      relX: 82,
      relY: 95,
      wireNet: 'secondary',
    },
    {
      name: 'ECHO',
      catalogType: 'digital_in',
      description: 'Echo output',
      required: true,
      signalType: 'digital',
      defaultConnection: 13,
      relX: 92,
      relY: 95,
      wireNet: 'primary',
    },
    {
      name: 'GND',
      catalogType: 'power',
      description: 'Ground',
      required: true,
      signalType: 'power',
      defaultConnection: 'GND',
      relX: 102,
      relY: 95,
      wireNet: 'gnd',
    },
  ],
  props: ultrasonicProps,
  canvas: { component: CanvasGlyph },
  world: { component: WorldWidget },
  inspectorExtra: InspectorExtra,
  ui: {
    worldProps: (comp) => ({
      pinConnections: comp.pinConnections,
      distance: comp.props.distance,
    }),
  },
  simulation: {
    inject: {
      kind: 'ultrasonic_distance',
      apply(comp, ctx) {
        const trig = comp.pinConnections.TRIG;
        const echo = comp.pinConnections.ECHO;
        const dist = comp.props.distance;
        if (typeof trig !== 'number' || typeof echo !== 'number') return;
        if (typeof dist !== 'number') return;
        ctx.apis.setUltrasonicDistance(trig, echo, dist);
      },
    },
  },
};

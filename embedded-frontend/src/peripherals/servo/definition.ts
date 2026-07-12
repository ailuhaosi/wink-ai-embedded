import type { PeripheralDefinition } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';

export const servoDefinition: PeripheralDefinition = {
  type: 'servo',
  displayName: 'SG90 Servo',
  category: 'actuator',
  catalog: {
    id: 'servo_stub',
    description: 'SG90 Servo simulation component',
    worldCoupling: 'none',
  },
  size: { width: 80, height: 60 },
  wireColor: '#3b82f6',
  pins: [
    {
      name: 'SIG',
      catalogType: 'pwm',
      description: 'PWM signal pin',
      required: true,
      signalType: 'digital',
      defaultConnection: null,
      relX: -5,
      relY: 15,
      wireNet: 'primary',
    },
    {
      name: 'VCC',
      catalogType: 'power',
      description: 'Power VCC (5V)',
      required: true,
      signalType: 'power',
      defaultConnection: 'VCC',
      relX: -5,
      relY: 30,
      wireNet: 'vcc',
    },
    {
      name: 'GND',
      catalogType: 'power',
      description: 'Power GND',
      required: true,
      signalType: 'power',
      defaultConnection: 'GND',
      relX: -5,
      relY: 45,
      wireNet: 'gnd',
    },
  ],
  props: {
    pwmChannel: {
      type: 'number',
      default: 0,
      description: 'PWM Channel',
      range: { min: 0, max: 15, step: 1 },
    },
    minPulseMs: {
      type: 'number',
      default: 0.5,
      description: 'Min Pulse Width (ms)',
    },
    maxPulseMs: {
      type: 'number',
      default: 2.5,
      description: 'Max Pulse Width (ms)',
    },
  },
  actuatorObserve: {
    profile: {
      defaultQuantity: 'angular_position',
      unit: 'deg',
      convert: 'sg90_from_duty',
    },
  },
  simulation: {
    observe: (comp, builder) => {
      const pwmChannel = (comp.props.pwmChannel as number) ?? 0;
      builder.watchActuatorSource({
        deviceComponentId: comp.id,
        transport: 'pwm_channel',
        transportKey: pwmChannel,
      });
    },
  },
  canvas: { component: CanvasGlyph },
  ui: {
    canvasProps: (comp, ctx) => {
      const obs = ctx.actuatorObservations.find(
        (o) => o.deviceComponentId === comp.id && o.quantity === 'angular_position',
      );
      const angle = typeof obs?.value === 'number' ? obs.value : 90;
      return {
        id: comp.id,
        label: comp.props.label ?? comp.id,
        pwmChannel: comp.props.pwmChannel,
        angle,
      };
    },
  },
};

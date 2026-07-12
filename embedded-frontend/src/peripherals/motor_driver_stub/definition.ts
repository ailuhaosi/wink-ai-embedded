import type { PeripheralDefinition } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';

export const motorDriverStubDefinition: PeripheralDefinition = {
  type: 'motor_driver_stub',
  displayName: 'Motor Driver (stub)',
  category: 'actuator',
  catalog: {
    id: 'motor_driver_stub',
    description: 'Dual PWM motor driver placeholder',
    worldCoupling: 'required',
    allowedActuatorMappings: ['pwm_to_angular_velocity'],
  },
  size: { width: 120, height: 70 },
  wireColor: '#f97316',
  pins: [
    {
      name: 'PWM_LEFT',
      catalogType: 'pwm',
      description: 'Left motor PWM',
      required: true,
      signalType: 'digital',
      defaultConnection: 14,
      relX: 20,
      relY: 62,
      wireNet: 'primary',
    },
    {
      name: 'PWM_RIGHT',
      catalogType: 'pwm',
      description: 'Right motor PWM',
      required: true,
      signalType: 'digital',
      defaultConnection: 15,
      relX: 50,
      relY: 62,
      wireNet: 'secondary',
    },
    {
      name: 'VCC',
      catalogType: 'power',
      description: 'Power supply',
      required: true,
      signalType: 'power',
      defaultConnection: 'VCC',
      relX: 80,
      relY: 62,
      wireNet: 'vcc',
    },
    {
      name: 'GND',
      catalogType: 'power',
      description: 'Ground',
      required: true,
      signalType: 'power',
      defaultConnection: 'GND',
      relX: 100,
      relY: 62,
      wireNet: 'gnd',
    },
  ],
  props: {
    pwmChannelLeft: {
      type: 'number',
      default: 0,
      description: 'Left PWM channel',
      range: { min: 0, max: 15, step: 1 },
    },
    pwmChannelRight: {
      type: 'number',
      default: 1,
      description: 'Right PWM channel',
      range: { min: 0, max: 15, step: 1 },
    },
    maxRpm: {
      type: 'number',
      default: 120,
      description: 'RPM at 100% duty',
    },
  },
  actuatorObserve: {
    profile: {
      defaultQuantity: 'angular_velocity',
      unit: 'rpm',
      convert: 'pwm_duty_to_rpm',
    },
  },
  simulation: {
    observe: (comp, builder) => {
      const pwmChannelLeft = (comp.props.pwmChannelLeft as number) ?? 0;
      const pwmChannelRight = (comp.props.pwmChannelRight as number) ?? 1;
      builder.watchActuatorSource({
        deviceComponentId: comp.id,
        transport: 'pwm_channel',
        transportKey: pwmChannelLeft,
        subAddress: 0,
      });
      builder.watchActuatorSource({
        deviceComponentId: comp.id,
        transport: 'pwm_channel',
        transportKey: pwmChannelRight,
        subAddress: 1,
      });
    },
  },
  canvas: { component: CanvasGlyph },
  ui: {
    canvasProps: (comp, ctx) => {
      const observations = ctx.actuatorObservations.filter(
        (o) => o.deviceComponentId === comp.id && o.quantity === 'angular_velocity',
      );
      const left = observations.find((o) => o.subAddress === 0);
      const right = observations.find((o) => o.subAddress === 1);
      return {
        id: comp.id,
        label: comp.props.label ?? comp.id,
        rpmLeft: typeof left?.value === 'number' ? left.value : 0,
        rpmRight: typeof right?.value === 'number' ? right.value : 0,
      };
    },
  },
};

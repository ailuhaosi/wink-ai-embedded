import { registry } from '../registry';
import { servoDefinition } from './definition';
import { actuatorConverterRegistry } from '@/services/actuator-converter-registry';

registry.register(servoDefinition);

// Register the converter for sg90_from_duty
actuatorConverterRegistry.register('sg90_from_duty', (duty, ctx) => {
  const minPulseMs = typeof ctx.props?.minPulseMs === 'number' ? ctx.props.minPulseMs : 0.5;
  const maxPulseMs = typeof ctx.props?.maxPulseMs === 'number' ? ctx.props.maxPulseMs : 2.5;
  const periodMs = 20; // 50Hz PWM
  const minDuty = (minPulseMs / periodMs) * 100;
  const maxDuty = (maxPulseMs / periodMs) * 100;
  const dutyRange = maxDuty - minDuty;
  const rawAngle = dutyRange > 0 ? ((duty - minDuty) / dutyRange) * 180 : 0;
  const value = Math.max(0, Math.min(180, rawAngle));
  return {
    quantity: 'angular_position',
    value,
    unit: 'deg',
    role: 'command',
  };
});

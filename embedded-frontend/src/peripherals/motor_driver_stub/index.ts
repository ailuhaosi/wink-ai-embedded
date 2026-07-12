import { registry } from '../registry';
import { motorDriverStubDefinition } from './definition';
import { actuatorConverterRegistry } from '@/services/actuator-converter-registry';

registry.register(motorDriverStubDefinition);

actuatorConverterRegistry.register('pwm_duty_to_rpm', (duty, ctx) => {
  const maxRpm = typeof ctx.props?.maxRpm === 'number' ? ctx.props.maxRpm : 120;
  const targetRpm = (Math.max(0, Math.min(100, duty)) / 100) * maxRpm;
  const stateStore = ctx.stateStore ?? {};

  const key = `rpm_${ctx.subAddress ?? 0}`;
  const prevRpm = typeof stateStore[key] === 'number' ? stateStore[key] : 0;

  const timeKey = `t_${key}`;
  const lastTime = typeof stateStore[timeKey] === 'string' ? stateStore[timeKey] : ctx.simTimeUs;
  const elapsedUs = BigInt(ctx.simTimeUs) - BigInt(lastTime);
  const dtSec = elapsedUs > 0n ? Number(elapsedUs) / 1e6 : 0.01;

  const inertiaConst = 0.25;
  const alpha = dtSec / (dtSec + inertiaConst);
  const value = prevRpm + alpha * (targetRpm - prevRpm);

  stateStore[key] = value;
  stateStore[timeKey] = ctx.simTimeUs;

  return {
    quantity: 'angular_velocity',
    value,
    unit: 'rpm',
    role: 'command',
  };
});

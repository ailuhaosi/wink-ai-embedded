import { describe, expect, it } from 'vitest';
import { bindingPinResolver } from '@/services/binding-pin-resolver';
import {
  AVOIDANCE_CAR_W2_MINIMAL,
  createUltrasonicBinding,
} from '@/services/templates/avoidance-car-w2-minimal';

describe('binding-pin-resolver', () => {
  it('resolves ultrasonic TRIG/ECHO from manifest connections', () => {
    const manifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      bindings: createUltrasonicBinding('mount_ultrasonic'),
    };
    const binding = manifest.bindings!.sensors[0];
    const pins = bindingPinResolver.resolveSensorPins(manifest, binding);
    expect(pins?.TRIG).toBe(4);
    expect(pins?.ECHO).toBe(5);

    const ultrasonic = bindingPinResolver.resolveUltrasonicPins(
      manifest,
      binding.bindingId,
    );
    expect(ultrasonic).toEqual({ trigPin: 4, echoPin: 5 });
  });

  it('returns null when connections missing', () => {
    const manifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      connections: [],
      bindings: createUltrasonicBinding('mount_ultrasonic'),
    };
    const binding = manifest.bindings!.sensors[0];
    expect(bindingPinResolver.resolveSensorPins(manifest, binding)).toBeNull();
  });

  it('resolves actuator PWM pin', () => {
    const manifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      devices: [
        ...AVOIDANCE_CAR_W2_MINIMAL.devices,
        { componentId: 'motors', modelId: 'motor_driver_stub' },
      ],
      connections: [
        {
          id: 'pwm_l',
          from: { componentId: 'motors', pin: 'PWM_LEFT' },
          to: { componentId: '__board__esp32-devkit-v1', pin: 'GPIO14' },
          routing: { mode: 'orthogonal' as const },
        },
      ],
      bindings: {
        actuators: [
          {
            bindingId: 'bind_motor_left',
            deviceComponentId: 'motors',
            pin: 'PWM_LEFT',
            mechanicalJointId: 'joint_wheel_left',
            mapping: {
              type: 'pwm_to_angular_velocity' as const,
              maxRpm: 200,
              deadband: 0.05,
              invert: false,
            },
          },
        ],
        sensors: [],
        displays: [],
      },
    };
    const a = manifest.bindings!.actuators[0];
    const resolved = bindingPinResolver.resolveActuatorPin(manifest, a);
    expect(resolved?.boardPinNumber).toBe(14);
    expect(resolved?.logicalPin).toBe('PWM_LEFT');
  });
});

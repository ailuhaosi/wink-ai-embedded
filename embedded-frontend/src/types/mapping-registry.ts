import type { Vector3 } from './manifest-v2';

export type ActuatorMapping =
  | PwmToAngularVelocity
  | PwmToLinearPosition
  | GpioToBinaryState
  | PwmToBrightness
  | GpioToEmissive;

export interface GpioToEmissive {
  type: 'gpio_to_emissive';
  activeHigh: boolean;
  emissiveColor?: number;
}

export interface PwmToAngularVelocity {
  type: 'pwm_to_angular_velocity';
  maxRpm: number;
  deadband: number;
  invert: boolean;
}

export interface PwmToLinearPosition {
  type: 'pwm_to_linear_position';
  minAngleDeg: number;
  maxAngleDeg: number;
  pulseMsRange: [number, number];
}

export interface GpioToBinaryState {
  type: 'gpio_to_binary_state';
  activeHigh: boolean;
  description?: string;
}

export interface PwmToBrightness {
  type: 'pwm_to_brightness';
  maxLumens: number;
  curve: 'linear' | 'gamma22';
}

export type SensorMapping =
  | RaycastRangeCm
  | TemperatureFieldSample
  | CollisionContactBool
  | LightIntensitySample
  | AngularPositionToEncoder;

export interface RaycastRangeCm {
  type: 'raycast_range_cm';
  maxRangeCm: number;
  rayOriginOffset: Vector3;
  rayDirection: Vector3;
  beamWidthDeg?: number;
}

export interface TemperatureFieldSample {
  type: 'temperature_field_sample';
  fallbackAmbientFieldId: string;
  samplingOffsetM?: Vector3;
}

export interface CollisionContactBool {
  type: 'collision_contact_bool';
  contactGroupMask?: number;
}

export interface LightIntensitySample {
  type: 'light_intensity_sample';
  sensitivityRange: [number, number];
  direction?: Vector3;
}

export interface AngularPositionToEncoder {
  type: 'angular_position_to_encoder';
  pulsesPerRevolution: number;
  jointId: string;
}

export type DisplayMapping = FramebufferTexture;

export interface FramebufferTexture {
  type: 'framebuffer_texture';
  resolution?: { width: number; height: number };
}

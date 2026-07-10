import type {
  ActuatorMapping,
  SensorMapping,
} from '@/types/mapping-registry';
import type { EmbeddedProjectManifest } from '@/types/manifest-v2';
import { deviceCatalog, modelIdForCanvasType } from '@/catalog/device-catalog';

export interface SuggestedBinding {
  deviceComponentId: string;
  mechanicalJointId?: string;
  mechanicalPartId?: string;
  suggestedMapping: ActuatorMapping | SensorMapping;
  confidence: number;
  pin?: string;
}

function isMotorDevice(modelId: string): boolean {
  const entry = deviceCatalog.getDevice(modelId);
  return (
    entry?.simulation?.allowedActuatorMappings?.includes('pwm_to_angular_velocity') ?? false
  );
}

function isUltrasonicDevice(modelId: string): boolean {
  return modelId === 'hc-sr04';
}

function hasExistingActuatorBinding(
  manifest: EmbeddedProjectManifest,
  deviceComponentId: string,
  jointId: string,
): boolean {
  return (manifest.bindings?.actuators ?? []).some(
    a => a.deviceComponentId === deviceComponentId && a.mechanicalJointId === jointId,
  );
}

function hasExistingSensorBinding(
  manifest: EmbeddedProjectManifest,
  deviceComponentId: string,
  partId: string,
): boolean {
  return (manifest.bindings?.sensors ?? []).some(
    s => s.deviceComponentId === deviceComponentId && s.mechanicalPartId === partId,
  );
}

export function suggestBindings(manifest: EmbeddedProjectManifest): SuggestedBinding[] {
  const suggestions: SuggestedBinding[] = [];

  for (const device of manifest.devices) {
    if (isMotorDevice(device.modelId)) {
      const joints = manifest.mechanical?.joints.filter(j => j.type === 'revolute') ?? [];
      for (const joint of joints) {
        if (!hasExistingActuatorBinding(manifest, device.componentId, joint.jointId)) {
          suggestions.push({
            deviceComponentId: device.componentId,
            mechanicalJointId: joint.jointId,
            pin: 'PWM_LEFT',
            suggestedMapping: {
              type: 'pwm_to_angular_velocity',
              maxRpm: 200,
              deadband: 0.05,
              invert: false,
            },
            confidence: 0.8,
          });
        }
      }
    }

    if (isUltrasonicDevice(device.modelId)) {
      const mounts
        = manifest.mechanical?.parts.filter(p => p.modelId.includes('ultrasonic')) ?? [];
      for (const mount of mounts) {
        if (!hasExistingSensorBinding(manifest, device.componentId, mount.partId)) {
          suggestions.push({
            deviceComponentId: device.componentId,
            mechanicalPartId: mount.partId,
            suggestedMapping: {
              type: 'raycast_range_cm',
              maxRangeCm: 400,
              rayOriginOffset: { x: 0, y: 0, z: 0.02 },
              rayDirection: { x: 1, y: 0, z: 0 },
            },
            confidence: 0.9,
          });
        }
      }
    }
  }

  return suggestions;
}

export { modelIdForCanvasType };

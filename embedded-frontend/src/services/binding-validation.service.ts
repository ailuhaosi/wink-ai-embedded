import { deviceCatalog } from '@/catalog/device-catalog';
import type { DeviceCatalog } from '@/catalog/device-catalog';
import { bindingPinResolver } from '@/services/binding-pin-resolver';
import type {
  ActuatorBinding,
  EmbeddedProjectManifest,
  SensorBinding,
} from '@/types/manifest-v2';
import type { BindingPinResolver } from '@/services/binding-pin-resolver';

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationContext {
  targetMode: 'design' | 'simulate' | 'diagnose';
  blockingOnly?: boolean;
  featureFlags?: { manifestSchemaV2: boolean };
}

export interface ValidationResult {
  ruleId: string;
  severity: Severity;
  message: string;
  bindingId?: string;
  componentId?: string;
  fix?: string;
}

function deviceIds(manifest: EmbeddedProjectManifest): Set<string> {
  return new Set(manifest.devices.map((d) => d.componentId));
}

function jointIds(manifest: EmbeddedProjectManifest): Set<string> {
  return new Set(manifest.mechanical?.joints.map((j) => j.jointId) ?? []);
}

function partIds(manifest: EmbeddedProjectManifest): Set<string> {
  return new Set(manifest.mechanical?.parts.map((p) => p.partId) ?? []);
}

function fieldIds(manifest: EmbeddedProjectManifest): Set<string> {
  return new Set(manifest.environment?.fields.map((f) => f.fieldId) ?? []);
}

function elevate(severity: Severity, context: ValidationContext, ruleId: string): Severity {
  if (context.targetMode !== 'simulate') return severity;
  if (severity === 'warning' && ['B-04', 'B-09', 'B-10'].includes(ruleId)) {
    return 'error';
  }
  return severity;
}

function checkB01(manifest: EmbeddedProjectManifest, context: ValidationContext): ValidationResult[] {
  const results: ValidationResult[] = [];
  const ids = deviceIds(manifest);
  const allBindings = [
    ...(manifest.bindings?.actuators ?? []),
    ...(manifest.bindings?.sensors ?? []),
    ...(manifest.bindings?.displays ?? []),
  ];
  for (const b of allBindings) {
    const compId = 'deviceComponentId' in b ? b.deviceComponentId : '';
    if (!ids.has(compId)) {
      results.push({
        ruleId: 'B-01',
        severity: 'error',
        message: `Device "${compId}" not found in manifest.devices`,
        bindingId: b.bindingId,
        componentId: compId,
        fix: 'Add the device or remove the binding',
      });
    }
  }
  return results;
}

function checkB02(manifest: EmbeddedProjectManifest, context: ValidationContext): ValidationResult[] {
  const results: ValidationResult[] = [];
  const joints = jointIds(manifest);
  const parts = partIds(manifest);

  for (const a of manifest.bindings?.actuators ?? []) {
    if (a.mechanicalJointId && !joints.has(a.mechanicalJointId)) {
      results.push({
        ruleId: 'B-02',
        severity: 'error',
        message: `Joint "${a.mechanicalJointId}" not found`,
        bindingId: a.bindingId,
      });
    }
    if (a.mechanicalPartId && !parts.has(a.mechanicalPartId)) {
      results.push({
        ruleId: 'B-02',
        severity: 'error',
        message: `Part "${a.mechanicalPartId}" not found`,
        bindingId: a.bindingId,
      });
    }
  }

  for (const s of manifest.bindings?.sensors ?? []) {
    if (s.mechanicalPartId && !parts.has(s.mechanicalPartId)) {
      results.push({
        ruleId: 'B-02',
        severity: 'error',
        message: `Part "${s.mechanicalPartId}" not found`,
        bindingId: s.bindingId,
      });
    }
  }

  return results;
}

function checkB03(manifest: EmbeddedProjectManifest): ValidationResult[] {
  const results: ValidationResult[] = [];
  const pinIndex = new Map<string, ActuatorBinding[]>();

  for (const a of manifest.bindings?.actuators ?? []) {
    const key = `${a.deviceComponentId}:${a.pin}`;
    const existing = pinIndex.get(key) ?? [];
    existing.push(a);
    pinIndex.set(key, existing);
  }

  for (const [key, bindings] of pinIndex) {
    if (bindings.length > 1) {
      results.push({
        ruleId: 'B-03',
        severity: 'error',
        message: `Pin ${key} bound by ${bindings.length} actuators`,
        bindingId: bindings[0].bindingId,
        fix: 'Remove duplicate actuator bindings on the same pin',
      });
    }
  }
  return results;
}

function checkB04(manifest: EmbeddedProjectManifest, context: ValidationContext): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const s of manifest.bindings?.sensors ?? []) {
    if (s.mapping.type === 'raycast_range_cm' && !s.mechanicalPartId) {
      results.push({
        ruleId: 'B-04',
        severity: elevate('warning', context, 'B-04'),
        message: 'Ultrasonic raycast binding missing mechanicalPartId',
        bindingId: s.bindingId,
        fix: 'Assign a mechanical mount part',
      });
    }
  }
  return results;
}

function checkB05(manifest: EmbeddedProjectManifest): ValidationResult[] {
  const results: ValidationResult[] = [];
  const fields = fieldIds(manifest);
  for (const s of manifest.bindings?.sensors ?? []) {
    if (s.mapping.type !== 'temperature_field_sample') continue;
    const m = s.mapping;
    if (!fields.has(m.fallbackAmbientFieldId)) {
      results.push({
        ruleId: 'B-05',
        severity: 'error',
        message: `Ambient field "${m.fallbackAmbientFieldId}" not found`,
        bindingId: s.bindingId,
      });
    } else if (!s.environmentPropId) {
      results.push({
        ruleId: 'B-05',
        severity: 'info',
        message: 'Temperature sensor using ambient field fallback (no environmentPropId)',
        bindingId: s.bindingId,
      });
    }
  }
  return results;
}

function checkB06(
  manifest: EmbeddedProjectManifest,
  catalog: DeviceCatalog,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const pwmMappings = new Set(['pwm_to_angular_velocity', 'pwm_to_linear_position', 'pwm_to_brightness']);
  const gpioMappings = new Set(['gpio_to_binary_state', 'gpio_to_emissive']);

  for (const a of manifest.bindings?.actuators ?? []) {
    const device = manifest.devices.find((d) => d.componentId === a.deviceComponentId);
    if (!device) continue;
    const entry = catalog.getDevice(device.modelId);
    if (!entry) continue;
    const pinDef = entry.pins.find((p) => p.name === a.pin);
    if (!pinDef) {
      results.push({
        ruleId: 'B-06',
        severity: 'error',
        message: `Pin "${a.pin}" not defined on device model ${device.modelId}`,
        bindingId: a.bindingId,
      });
      continue;
    }
    const mappingType = a.mapping.type;
    if (pwmMappings.has(mappingType) && pinDef.type !== 'pwm') {
      results.push({
        ruleId: 'B-06',
        severity: 'error',
        message: `PWM mapping on non-PWM pin ${a.pin} (${pinDef.type})`,
        bindingId: a.bindingId,
      });
    }
    if (gpioMappings.has(mappingType) && pinDef.type !== 'gpio') {
      results.push({
        ruleId: 'B-06',
        severity: 'error',
        message: `GPIO mapping on non-GPIO pin ${a.pin} (${pinDef.type})`,
        bindingId: a.bindingId,
      });
    }
  }
  return results;
}

function checkB07(manifest: EmbeddedProjectManifest): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const a of manifest.bindings?.actuators ?? []) {
    const m = a.mapping;
    switch (m.type) {
      case 'pwm_to_angular_velocity':
      case 'pwm_to_linear_position':
        if (!a.mechanicalJointId) {
          results.push({
            ruleId: 'B-07',
            severity: 'error',
            message: `${m.type} requires mechanicalJointId`,
            bindingId: a.bindingId,
          });
        }
        break;
      case 'gpio_to_binary_state':
        if (!a.mechanicalJointId && !a.mechanicalPartId) {
          results.push({
            ruleId: 'B-07',
            severity: 'error',
            message: 'gpio_to_binary_state requires mechanicalJointId or mechanicalPartId',
            bindingId: a.bindingId,
          });
        }
        break;
      case 'pwm_to_brightness':
      case 'gpio_to_emissive':
        if (!a.mechanicalPartId) {
          results.push({
            ruleId: 'B-07',
            severity: 'error',
            message: `${m.type} requires mechanicalPartId`,
            bindingId: a.bindingId,
          });
        }
        if (a.mechanicalJointId) {
          results.push({
            ruleId: 'B-07',
            severity: 'error',
            message: `${m.type} must not use mechanicalJointId`,
            bindingId: a.bindingId,
          });
        }
        break;
    }
  }
  return results;
}

function checkB07s(manifest: EmbeddedProjectManifest): ValidationResult[] {
  const results: ValidationResult[] = [];
  const joints = jointIds(manifest);
  const parts = partIds(manifest);

  for (const s of manifest.bindings?.sensors ?? []) {
    const m = s.mapping;
    switch (m.type) {
      case 'raycast_range_cm':
      case 'collision_contact_bool':
      case 'light_intensity_sample':
        if (!s.mechanicalPartId) {
          results.push({
            ruleId: 'B-07s',
            severity: 'error',
            message: `${m.type} requires mechanicalPartId`,
            bindingId: s.bindingId,
          });
        }
        break;
      case 'temperature_field_sample':
        break;
      case 'angular_position_to_encoder':
        if (!joints.has(m.jointId)) {
          results.push({
            ruleId: 'B-07s',
            severity: 'error',
            message: `Encoder joint "${m.jointId}" not found`,
            bindingId: s.bindingId,
          });
        }
        if (s.mechanicalPartId) {
          results.push({
            ruleId: 'B-07s',
            severity: 'error',
            message: 'angular_position_to_encoder must not use binding.mechanicalPartId',
            bindingId: s.bindingId,
          });
        }
        break;
    }
    if (m.type !== 'angular_position_to_encoder' && s.mechanicalPartId && !parts.has(s.mechanicalPartId)) {
      results.push({
        ruleId: 'B-07s',
        severity: 'error',
        message: `Part "${s.mechanicalPartId}" not found`,
        bindingId: s.bindingId,
      });
    }
  }
  return results;
}

function hasBindingForDevice(
  manifest: EmbeddedProjectManifest,
  componentId: string,
): boolean {
  const bindings = manifest.bindings;
  if (!bindings) return false;
  return (
    bindings.actuators.some((a) => a.deviceComponentId === componentId) ||
    bindings.sensors.some((s) => s.deviceComponentId === componentId) ||
    bindings.displays.some((d) => d.deviceComponentId === componentId)
  );
}

function checkB08B09(
  manifest: EmbeddedProjectManifest,
  catalog: DeviceCatalog,
  context: ValidationContext,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const device of manifest.devices) {
    const entry = catalog.getDevice(device.modelId);
    if (!entry?.simulation) continue;
    const coupling = entry.simulation.worldCoupling;
    if (coupling === 'none') continue;

    const hasBinding = hasBindingForDevice(manifest, device.componentId);
    if (hasBinding) continue;

    if (coupling === 'optional') {
      results.push({
        ruleId: 'B-08',
        severity: 'info',
        message: `Device ${device.componentId} (${device.modelId}) has no binding (optional)`,
        componentId: device.componentId,
      });
    } else if (coupling === 'required') {
      results.push({
        ruleId: 'B-09',
        severity: elevate('warning', context, 'B-09'),
        message: `Device ${device.componentId} (${device.modelId}) requires a world binding`,
        componentId: device.componentId,
        fix: 'Add actuator or sensor binding for this device',
      });
    }
  }
  return results;
}

function checkB10(
  manifest: EmbeddedProjectManifest,
  context: ValidationContext,
  pinResolver: BindingPinResolver,
): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const a of manifest.bindings?.actuators ?? []) {
    const resolved = pinResolver.resolveActuatorPin(manifest, a);
    if (!resolved) {
      results.push({
        ruleId: 'B-10',
        severity: elevate('warning', context, 'B-10'),
        message: `Cannot resolve pin ${a.pin} for actuator ${a.bindingId}`,
        bindingId: a.bindingId,
        fix: 'Wire the pin to a board GPIO in connections',
      });
    }
  }

  for (const s of manifest.bindings?.sensors ?? []) {
    const device = manifest.devices.find((d) => d.componentId === s.deviceComponentId);
    if (!device) continue;

    if (device.modelId === 'hc-sr04' || s.mapping.type === 'raycast_range_cm') {
      const pins = pinResolver.resolveSensorPins(manifest, s);
      if (!pins?.TRIG || !pins?.ECHO) {
        results.push({
          ruleId: 'B-10',
          severity: elevate('warning', context, 'B-10'),
          message: `Ultrasonic TRIG/ECHO pins not resolved for ${s.bindingId}`,
          bindingId: s.bindingId,
          fix: 'Connect TRIG and ECHO to board GPIOs',
        });
      }
    } else {
      const pins = pinResolver.resolveSensorPins(manifest, s);
      if (!pins || Object.keys(pins).length === 0) {
        results.push({
          ruleId: 'B-10',
          severity: elevate('warning', context, 'B-10'),
          message: `Sensor pins not resolved for ${s.bindingId}`,
          bindingId: s.bindingId,
        });
      }
    }
  }

  return results;
}

export function isBlockingResult(r: ValidationResult, context: ValidationContext): boolean {
  if (r.severity === 'error') return true;
  if (context.targetMode === 'simulate' && r.severity === 'warning') {
    return ['B-04', 'B-09', 'B-10'].includes(r.ruleId);
  }
  return false;
}

export function validateBindings(
  manifest: EmbeddedProjectManifest,
  context: ValidationContext,
  deps: {
    catalog: DeviceCatalog;
    pinResolver: BindingPinResolver;
  },
): ValidationResult[] {
  const results: ValidationResult[] = [
    ...checkB01(manifest, context),
    ...checkB02(manifest, context),
    ...checkB03(manifest),
    ...checkB04(manifest, context),
    ...checkB05(manifest),
    ...checkB06(manifest, deps.catalog),
    ...checkB07(manifest),
    ...checkB07s(manifest),
    ...checkB08B09(manifest, deps.catalog, context),
    ...checkB10(manifest, context, deps.pinResolver),
  ];

  if (context.blockingOnly) {
    return results.filter((r) => isBlockingResult(r, context));
  }
  return results;
}

export function validateBindingsBlocking(
  manifest: EmbeddedProjectManifest,
  targetMode: ValidationContext['targetMode'] = 'simulate',
  deps: {
    catalog: DeviceCatalog;
    pinResolver: BindingPinResolver;
  } = { catalog: deviceCatalog, pinResolver: bindingPinResolver },
): ValidationResult[] {
  return validateBindings(
    manifest,
    { targetMode, blockingOnly: true },
    deps,
  );
}

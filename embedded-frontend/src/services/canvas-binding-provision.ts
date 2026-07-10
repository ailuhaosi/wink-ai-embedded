import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { EmbeddedProjectManifest } from '@/types/manifest-v2';
import { deviceCatalog, modelIdForCanvasType } from '@/catalog/device-catalog';
import {
  AVOIDANCE_CAR_W2_MINIMAL,
  createUltrasonicBinding,
  createUltrasonicMount,
} from '@/services/templates/avoidance-car-w2-minimal';

/** Templates that intentionally ship with empty bindings for M1 gate demo */
const TEMPLATE_IDS_SKIP_AUTO_BIND = new Set([AVOIDANCE_CAR_W2_MINIMAL.id]);

function hasBindingForDevice(manifest: EmbeddedProjectManifest, componentId: string): boolean {
  const b = manifest.bindings;
  if (!b) return false;
  return (
    b.actuators.some((a) => a.deviceComponentId === componentId) ||
    b.sensors.some((s) => s.deviceComponentId === componentId) ||
    b.displays.some((d) => d.deviceComponentId === componentId)
  );
}

/**
 * Auto-provision raycast bindings for canvas peripherals (e.g. default demo sonar1)
 * so simulate is not blocked by B-09. Skipped for onboarding templates that
 * deliberately start with empty bindings.
 */
export function provisionImplicitCanvasBindings(
  manifest: EmbeddedProjectManifest,
  components: CircuitComponentInstance[],
): EmbeddedProjectManifest {
  if (TEMPLATE_IDS_SKIP_AUTO_BIND.has(manifest.id)) {
    return manifest;
  }

  let next = manifest;
  const mechanicalParts = [...(next.mechanical?.parts ?? [])];
  const sensorBindings = [...(next.bindings?.sensors ?? [])];
  let changed = false;

  for (const comp of components) {
    const modelId = modelIdForCanvasType(comp.type);
    const entry = deviceCatalog.getDevice(modelId);
    if (entry?.simulation?.worldCoupling !== 'required') continue;
    if (hasBindingForDevice(next, comp.id)) continue;

    // hc-sr04 on canvas → implicit virtual mount + raycast binding
    if (modelId === 'hc-sr04') {
      const partId = `mount_${comp.id}`;
      if (!mechanicalParts.some((p) => p.partId === partId)) {
        const mount = createUltrasonicMount(partId);
        mechanicalParts.push(...mount!.parts);
        changed = true;
      }
      const bindings = createUltrasonicBinding(partId, comp.id);
      const sensor = bindings!.sensors[0];
      if (sensor && !sensorBindings.some((s) => s.deviceComponentId === comp.id)) {
        sensorBindings.push({
          ...sensor,
          bindingId: `bind_${comp.id}`,
        });
        changed = true;
      }
    }
  }

  if (!changed) return manifest;

  return {
    ...next,
    mechanical: {
      parts: mechanicalParts,
      joints: next.mechanical?.joints ?? [],
    },
    bindings: {
      actuators: next.bindings?.actuators ?? [],
      displays: next.bindings?.displays ?? [],
      sensors: sensorBindings,
    },
  };
}

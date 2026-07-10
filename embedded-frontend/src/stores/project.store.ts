import { defineStore } from 'pinia';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type {
  ConnectionEntry,
  DeviceEntry,
  EmbeddedProjectManifest,
  SensorBinding,
  ActuatorBinding,
} from '@/types/manifest-v2';
import { createEmptyManifestV2 } from '@/types/manifest-v2';
import { migrateManifest } from '@/services/manifest-migration';
import {
  buildConnectionFromPin,
  buildConnectionFromPowerPin,
  bindingPinResolver,
} from '@/services/binding-pin-resolver';
import {
  modelIdForCanvasType,
  deviceCatalog,
} from '@/catalog/device-catalog';
import {
  validateBindings,

} from '@/services/binding-validation.service';
import type { ValidationResult } from '@/services/binding-validation.service';

import { suggestBindings } from '@/services/binding-suggest.service';
import type { SuggestedBinding } from '@/services/binding-suggest.service';
import { provisionImplicitCanvasBindings } from '@/services/canvas-binding-provision';
import { isPowerConnection } from '@/constants/power-rail';

function resolveBoardDeviceEntry(
  manifest: EmbeddedProjectManifest,
): DeviceEntry {
  const boardId = manifest.target.boardId;
  const existing = manifest.devices.find(
    d => deviceCatalog.getDevice(d.modelId)?.category === 'board',
  );
  return (
    existing ?? {
      componentId: 'esp32',
      modelId: boardId,
      displayName: 'ESP32',
    }
  );
}

function buildCanvasDeviceEntries(
  components: CircuitComponentInstance[],
  layoutPositions?: Record<string, { x: number; y: number }>,
): DeviceEntry[] {
  return components.map((c) => {
    const entry: DeviceEntry = {
      componentId: c.id,
      modelId: modelIdForCanvasType(c.type),
      displayName: c.name,
      rotation: c.rotation,
    };
    const pos = layoutPositions?.[c.id];
    if (pos) {
      entry.position = { x: pos.x, y: pos.y };
    }
    if (Object.keys(c.props).length > 0) {
      entry.properties = { ...c.props };
    }
    return entry;
  });
}

function isManifestSchemaV2Enabled(): boolean {
  return import.meta.env.VITE_MANIFEST_SCHEMA_V2 === 'true';
}

interface ProjectState {
  manifest: EmbeddedProjectManifest;
  lastValidationResults: ValidationResult[];
  safetyLevel: string;
}

export const useProjectStore = defineStore('project', {
  state: (): ProjectState => ({
    manifest: createEmptyManifestV2(),
    lastValidationResults: [],
    safetyLevel: 'S2',
  }),

  getters: {
    projectName: state => state.manifest.name,
    targetBoard: state => state.manifest.target.boardId,
    manifestSchemaV2Enabled: () => isManifestSchemaV2Enabled(),
    bindingValidationSummary(state): { errors: number; warnings: number; infos: number } {
      const r = state.lastValidationResults;
      return {
        errors: r.filter(x => x.severity === 'error').length,
        warnings: r.filter(x => x.severity === 'warning').length,
        infos: r.filter(x => x.severity === 'info').length,
      };
    },
  },

  actions: {
    loadManifest(raw: unknown) {
      this.manifest = migrateManifest(raw);
      this.refreshValidation('design');
    },

    applyManifestPatch(patch: Partial<EmbeddedProjectManifest>) {
      this.manifest = migrateManifest({ ...this.manifest, ...patch });
      this.refreshValidation('design');
    },

    setManifest(manifest: EmbeddedProjectManifest) {
      this.manifest = migrateManifest(manifest);
      this.refreshValidation('design');
    },

    syncFromCanvas(
      components: CircuitComponentInstance[],
      layoutPositions?: Record<string, { x: number; y: number }>,
    ) {
      const boardEntry = resolveBoardDeviceEntry(this.manifest);
      const canvasDevices = buildCanvasDeviceEntries(components, layoutPositions);
      const devices = [
        boardEntry,
        ...canvasDevices.filter(d => d.componentId !== boardEntry.componentId),
      ];

      const connections: ConnectionEntry[] = [];
      for (const comp of components) {
        for (const [pinName, value] of Object.entries(comp.pinConnections)) {
          if (typeof value === 'number') {
            connections.push(
              buildConnectionFromPin(comp.id, pinName, value, this.manifest),
            );
          }
          else if (isPowerConnection(value)) {
            connections.push(
              buildConnectionFromPowerPin(comp.id, pinName, value, this.manifest),
            );
          }
        }
      }

      this.manifest = provisionImplicitCanvasBindings(
        {
          ...this.manifest,
          devices,
          connections,
        },
        components,
      );
      this.refreshValidation('design');
    },

    /** SSOT write path: canvas snapshot → Manifest (alias of syncFromCanvas). */
    commitCanvasSnapshot(
      components: CircuitComponentInstance[],
      layoutPositions?: Record<string, { x: number; y: number }>,
    ) {
      this.syncFromCanvas(components, layoutPositions);
    },

    addSensorBinding(binding: SensorBinding) {
      if (!this.manifest.bindings) {
        this.manifest.bindings = { actuators: [], sensors: [], displays: [] };
      }
      this.manifest.bindings.sensors.push(binding);
      this.refreshValidation('design');
    },

    addActuatorBinding(binding: ActuatorBinding) {
      if (!this.manifest.bindings) {
        this.manifest.bindings = { actuators: [], sensors: [], displays: [] };
      }
      this.manifest.bindings.actuators.push(binding);
      this.refreshValidation('design');
    },

    removeBinding(bindingId: string) {
      if (!this.manifest.bindings) return;
      this.manifest.bindings.actuators = this.manifest.bindings.actuators.filter(
        b => b.bindingId !== bindingId,
      );
      this.manifest.bindings.sensors = this.manifest.bindings.sensors.filter(
        b => b.bindingId !== bindingId,
      );
      this.manifest.bindings.displays = this.manifest.bindings.displays.filter(
        b => b.bindingId !== bindingId,
      );
      this.refreshValidation('design');
    },

    applySuggestion(suggestion: SuggestedBinding) {
      const bindingId = `bind_${Date.now()}`;
      if (suggestion.suggestedMapping.type === 'raycast_range_cm') {
        this.addSensorBinding({
          bindingId,
          deviceComponentId: suggestion.deviceComponentId,
          mechanicalPartId: suggestion.mechanicalPartId,
          mapping: suggestion.suggestedMapping,
        });
      }
      else if (
        suggestion.suggestedMapping.type === 'pwm_to_angular_velocity'
        || suggestion.suggestedMapping.type === 'pwm_to_linear_position'
        || suggestion.suggestedMapping.type === 'gpio_to_binary_state'
        || suggestion.suggestedMapping.type === 'pwm_to_brightness'
        || suggestion.suggestedMapping.type === 'gpio_to_emissive'
      ) {
        this.addActuatorBinding({
          bindingId,
          deviceComponentId: suggestion.deviceComponentId,
          pin: suggestion.pin ?? 'PWM_LEFT',
          mechanicalJointId: suggestion.mechanicalJointId,
          mechanicalPartId: suggestion.mechanicalPartId,
          mapping: suggestion.suggestedMapping,
        });
      }
    },

    refreshValidation(targetMode: 'design' | 'simulate' | 'diagnose') {
      if (!isManifestSchemaV2Enabled()) {
        this.lastValidationResults = [];
        return;
      }
      this.lastValidationResults = validateBindings(
        this.manifest,
        { targetMode },
        { catalog: deviceCatalog, pinResolver: bindingPinResolver },
      );
    },

    getBlockingValidationResults(
      targetMode: 'design' | 'simulate' | 'diagnose' = 'simulate',
    ): ValidationResult[] {
      if (!isManifestSchemaV2Enabled()) return [];
      return validateBindings(
        this.manifest,
        { targetMode, blockingOnly: true },
        { catalog: deviceCatalog, pinResolver: bindingPinResolver },
      );
    },

    getSuggestions(): SuggestedBinding[] {
      return suggestBindings(this.manifest);
    },
  },
});

export { isManifestSchemaV2Enabled };

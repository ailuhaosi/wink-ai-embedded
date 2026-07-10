<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { Link, Trash2, Lightbulb, CheckCircle, AlertTriangle } from 'lucide-vue-next';
import { useProjectStore } from '@/stores/project.store';
import { bindingPinResolver } from '@/services/binding-pin-resolver';
import {
  isBlockingResult,
  validateBindings,
} from '@/services/binding-validation.service';
import { deviceCatalog } from '@/catalog/device-catalog';
import { useWorkbenchModeStore } from '@/stores/workbench-mode.store';
import type { SensorBinding } from '@/types/manifest-v2';

const { t } = useI18n();
const projectStore = useProjectStore();
const modeStore = useWorkbenchModeStore();
const { manifest, lastValidationResults } = storeToRefs(projectStore);

const suggestions = computed(() => projectStore.getSuggestions());

const validationSummary = computed(() => {
  const targetMode = modeStore.current === 'design' ? 'design' : 'simulate';
  const results = validateBindings(
    manifest.value,
    { targetMode },
    { catalog: deviceCatalog, pinResolver: bindingPinResolver },
  );
  return {
    errors: results.filter(r => r.severity === 'error').length,
    warnings: results.filter(r => r.severity === 'warning').length,
    infos: results.filter(r => r.severity === 'info').length,
    results,
  };
});

function deviceLabel(componentId: string): string {
  const d = manifest.value.devices.find(x => x.componentId === componentId);
  return d?.displayName ?? d?.modelId ?? componentId;
}

function resolveSensorPinDisplay(binding: SensorBinding): string {
  const pins = bindingPinResolver.resolveSensorPins(manifest.value, binding);
  if (!pins) return t('workbench.bindings.pinsUnresolved');
  return Object.entries(pins)
    .map(([name, gpio]) => `${name}→GPIO${gpio}`)
    .join(', ');
}

function bindingStatus(bindingId: string): 'ok' | 'warn' | 'error' {
  const issues = validationSummary.value.results.filter(r => r.bindingId === bindingId);
  if (issues.some(r => r.severity === 'error')) return 'error';
  if (issues.some(r => r.severity === 'warning')) return 'warn';
  return 'ok';
}

function applySuggestion(index: number) {
  const s = suggestions.value[index];
  if (s) projectStore.applySuggestion(s);
}

function removeBinding(bindingId: string) {
  projectStore.removeBinding(bindingId);
}

function addUltrasonicBinding() {
  const mount = manifest.value.mechanical?.parts.find(p =>
    p.modelId.includes('ultrasonic'),
  );
  if (!mount) {
    projectStore.applyManifestPatch({
      mechanical: {
        parts: [
          ...(manifest.value.mechanical?.parts ?? []),
          {
            partId: 'mount_ultrasonic',
            modelId: 'ultrasonic_mount_v1',
            displayName: 'Ultrasonic Mount',
            transform: {
              position: { x: 0, y: 0.1, z: 0.15 },
              rotation: { x: 0, y: 0, z: 0 },
            },
            physics: { collider: 'box', massKg: 0.05 },
          },
        ],
        joints: manifest.value.mechanical?.joints ?? [],
      },
    });
  }
  const partId
    = mount?.partId
      ?? manifest.value.mechanical?.parts.find(p => p.modelId.includes('ultrasonic'))
        ?.partId
        ?? 'mount_ultrasonic';
  const radar = manifest.value.devices.find(d => d.modelId === 'hc-sr04');
  if (!radar) return;
  projectStore.addSensorBinding({
    bindingId: `bind_radar_${Date.now()}`,
    deviceComponentId: radar.componentId,
    mechanicalPartId: partId,
    mapping: {
      type: 'raycast_range_cm',
      maxRangeCm: 400,
      rayOriginOffset: { x: 0, y: 0, z: 0.02 },
      rayDirection: { x: 1, y: 0, z: 0 },
    },
  });
}
</script>

<template>
  <div class="bindings-inspector">
    <div class="section-header">
      <Link class="section-icon" />
      <span>{{ t('workbench.bindings.title') }}</span>
    </div>

    <div class="binding-group">
      <div class="group-title">
        {{ t('workbench.bindings.actuators') }}
        ({{ manifest.bindings?.actuators.length ?? 0 }})
      </div>
      <div
        v-for="a in manifest.bindings?.actuators ?? []"
        :key="a.bindingId"
        class="binding-card"
      >
        <div class="binding-id">{{ a.bindingId }}</div>
        <div class="binding-detail">
          {{ t('workbench.bindings.device') }}: {{ deviceLabel(a.deviceComponentId) }} →
          {{ t('workbench.bindings.pin') }}: {{ a.pin }}
        </div>
        <div v-if="a.mechanicalJointId" class="binding-detail">
          Joint: {{ a.mechanicalJointId }}
        </div>
        <div class="binding-detail">Mapping: {{ a.mapping.type }}</div>
        <div class="binding-footer">
          <span class="status" :class="bindingStatus(a.bindingId)">
            <CheckCircle v-if="bindingStatus(a.bindingId) === 'ok'" class="status-icon" />
            <AlertTriangle v-else class="status-icon" />
            {{ bindingStatus(a.bindingId) === 'ok' ? 'OK' : 'Issue' }}
          </span>
          <button class="icon-btn" @click="removeBinding(a.bindingId)">
            <Trash2 class="icon-sm" />
          </button>
        </div>
      </div>
    </div>

    <div class="binding-group">
      <div class="group-title">
        {{ t('workbench.bindings.sensors') }}
        ({{ manifest.bindings?.sensors.length ?? 0 }})
        <button class="add-btn" @click="addUltrasonicBinding">+ Add</button>
      </div>
      <div
        v-for="s in manifest.bindings?.sensors ?? []"
        :key="s.bindingId"
        class="binding-card"
      >
        <div class="binding-id">{{ s.bindingId }}</div>
        <div class="binding-detail">
          {{ t('workbench.bindings.device') }}: {{ deviceLabel(s.deviceComponentId) }}
        </div>
        <div v-if="s.mechanicalPartId" class="binding-detail">
          Part: {{ s.mechanicalPartId }}
        </div>
        <div class="binding-detail pins">
          {{ t('workbench.bindings.pins') }}: {{ resolveSensorPinDisplay(s) }}
        </div>
        <div class="binding-detail">Mapping: {{ s.mapping.type }}</div>
        <div class="binding-footer">
          <span class="status" :class="bindingStatus(s.bindingId)">
            <CheckCircle v-if="bindingStatus(s.bindingId) === 'ok'" class="status-icon" />
            <AlertTriangle v-else class="status-icon" />
            {{ bindingStatus(s.bindingId) === 'ok' ? 'OK' : 'Issue' }}
          </span>
          <button class="icon-btn" @click="removeBinding(s.bindingId)">
            <Trash2 class="icon-sm" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="suggestions.length > 0" class="suggestions">
      <button class="suggest-btn" @click="applySuggestion(0)">
        <Lightbulb class="icon-sm" />
        {{ t('workbench.bindings.autoSuggest') }} ({{ suggestions.length }})
      </button>
    </div>

    <div class="validation-summary">
      Validation:
      {{ validationSummary.errors }} errors,
      {{ validationSummary.warnings }} warnings
    </div>

    <ul v-if="lastValidationResults.length > 0" class="issue-list">
      <li
        v-for="(r, i) in lastValidationResults.filter((x) => isBlockingResult(x, { targetMode: 'simulate' }) || x.severity !== 'info')"
        :key="`${r.ruleId}-${i}`"
        :class="r.severity"
      >
        [{{ r.ruleId }}] {{ r.message }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bindings-inspector { font-size: 12px; }

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.section-icon { width: 16px; height: 16px; }

.binding-group { margin-bottom: 16px; }

.group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.add-btn {
  margin-left: auto;
  border: 1px solid rgba(56, 189, 248, 0.3);
  background: transparent;
  color: var(--color-highlight);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 11px;
}

.binding-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.binding-id {
  font-family: monospace;
  color: var(--color-highlight);
  margin-bottom: 4px;
}

.binding-detail {
  color: var(--text-secondary);
  margin: 2px 0;
}

.binding-detail.pins { font-family: monospace; font-size: 11px; }

.binding-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.status.ok { color: #4ade80; }
.status.warn { color: #fbbf24; }
.status.error { color: #f87171; }

.status-icon { width: 12px; height: 12px; }

.icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-muted);
  padding: 4px;
}

.icon-btn:hover { color: #f87171; }
.icon-sm { width: 14px; height: 14px; }

.suggestions { margin: 12px 0; }

.suggest-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px;
  border: 1px dashed rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.06);
  color: var(--color-highlight);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.validation-summary {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.issue-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}

.issue-list li {
  padding: 4px 0;
  font-size: 11px;
}

.issue-list li.error { color: #f87171; }
.issue-list li.warning { color: #fbbf24; }
</style>

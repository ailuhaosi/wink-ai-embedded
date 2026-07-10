<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import AccordionSection from './AccordionSection.vue';
import AssetItem from './AssetItem.vue';
import { deviceCatalog } from '@/catalog/device-catalog';
import { useProjectStore } from '@/stores/project.store';
import { useWorkbenchModeStore } from '@/stores/workbench-mode.store';

const emit = defineEmits<{
  'add-peripheral': [payload: { type: string; name: string }];
  'select-object': [payload: { kind: string; id: string }];
}>();
const { t } = useI18n();
const projectStore = useProjectStore();
const modeStore = useWorkbenchModeStore();
const { manifest } = storeToRefs(projectStore);

const canDrag = computed(() => modeStore.canEditCircuit);

const boards = computed(() =>
  deviceCatalog.listBoards().map(b => ({
    id: b.id,
    name: b.displayName,
    desc: t('workbench.assets.boardDesc'),
  })),
);

const peripherals = computed(() =>
  deviceCatalog
    .listDevices()
    .filter(d => d.category !== 'board')
    .map(d => ({
      id: d.id,
      canvasType: d.canvasType ?? d.id,
      name: d.displayName,
      desc: d.category,
    })),
);

const mechanicalParts = computed(() => deviceCatalog.listMechanicalModels());
const envProps = computed(() => deviceCatalog.listEnvironmentModels());

function onAddPeripheral(item: { canvasType: string; name: string }) {
  if (!canDrag.value) return;
  emit('add-peripheral', { type: item.canvasType, name: item.name });
}

function activeDevices() {
  return manifest.value.devices;
}
</script>

<template>
  <div class="asset-library">
    <AccordionSection :title="t('workbench.assets.boards')" :default-open="true">
      <AssetItem
        v-for="b in boards"
        :key="b.id"
        :name="b.name"
        :desc="b.desc"
        :disabled="!canDrag"
      />
    </AccordionSection>

    <AccordionSection :title="t('workbench.assets.peripherals')">
      <AssetItem
        v-for="p in peripherals"
        :key="p.id"
        :name="p.name"
        :desc="p.desc"
        :disabled="!canDrag"
        @click="onAddPeripheral(p)"
      />
    </AccordionSection>

    <AccordionSection :title="t('workbench.assets.mechanical')">
      <AssetItem
        v-for="m in mechanicalParts"
        :key="m.id"
        :name="m.displayName"
        :desc="t('workbench.assets.mechanicalDesc')"
        :disabled="!canDrag"
      />
    </AccordionSection>

    <AccordionSection :title="t('workbench.assets.environment')">
      <AssetItem
        v-for="e in envProps"
        :key="e.id"
        :name="e.displayName"
        :desc="t('workbench.assets.environmentDesc')"
        :disabled="!canDrag"
      />
    </AccordionSection>

    <AccordionSection :title="t('workbench.assets.active')" :default-open="true">
      <div v-if="activeDevices().length === 0" class="empty">{{ t('workbench.assets.noActive') }}</div>
      <div
        v-for="d in activeDevices()"
        :key="d.componentId"
        class="active-row"
        @click="emit('select-object', { kind: 'device', id: d.componentId })"
      >
        <span>{{ d.displayName ?? d.componentId }}</span>
        <span class="model-id">{{ d.modelId }}</span>
      </div>
    </AccordionSection>
  </div>
</template>

<style scoped>
.asset-library {
  display: flex;
  flex-direction: column;
}

.empty {
  color: var(--text-muted);
  font-size: 12px;
  padding: 8px;
  text-align: center;
}

.active-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
}

.active-row:hover {
  background: rgba(56, 189, 248, 0.08);
}

.model-id {
  color: var(--text-muted);
  font-size: 10px;
  font-family: monospace;
}
</style>

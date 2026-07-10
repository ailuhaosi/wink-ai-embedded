<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useInspectorStore, type InspectorTabId } from '@/stores/inspector.store';
import { useLayoutStore } from '@/stores/layout.store';
import { Zap, Wrench, Link, TreePine, AlertTriangle, Stethoscope, Pin } from 'lucide-vue-next';

const { t } = useI18n();
const inspectorStore = useInspectorStore();
const layoutStore = useLayoutStore();
const { activeTab, pinnedTab } = storeToRefs(inspectorStore);
const { rightPanelMode, rightPanelCollapsed } = storeToRefs(layoutStore);

const tabs: Array<{ id: InspectorTabId; label: string; icon: typeof Zap }> = [
  { id: 'circuit', label: t('workbench.inspector.circuit'), icon: Zap },
  { id: 'mechanical', label: t('workbench.inspector.mechanical'), icon: Wrench },
  { id: 'bindings', label: t('workbench.inspector.bindings'), icon: Link },
  { id: 'environment', label: t('workbench.inspector.environment'), icon: TreePine },
  { id: 'faults', label: t('workbench.inspector.faults'), icon: AlertTriangle },
  { id: 'diagnostics', label: t('workbench.inspector.diagnostics'), icon: Stethoscope },
];

const isIconMode = computed(() => rightPanelMode.value === 'icon');

function activateTab(id: InspectorTabId) {
  inspectorStore.activateTab(id, true);
  if (isIconMode.value) {
    layoutStore.rightPanelCollapsed = false;
  }
}

function closeOverlay() {
  if (isIconMode.value) {
    layoutStore.rightPanelCollapsed = true;
  }
}
</script>

<template>
  <aside
    class="inspector-panel"
    :class="{ 'inspector-panel--icon': isIconMode && rightPanelCollapsed, 'inspector-panel--overlay': isIconMode && !rightPanelCollapsed }"
  >
    <div class="inspector-tabs" :class="{ 'inspector-tabs--icon': isIconMode }">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="inspector-tab"
        :class="{ active: activeTab === tab.id }"
        :title="tab.label"
        @click="activateTab(tab.id)"
      >
        <component :is="tab.icon" class="tab-icon" />
        <span v-if="!isIconMode || !rightPanelCollapsed" class="tab-label">{{ tab.label }}</span>
        <button
          v-if="!isIconMode || !rightPanelCollapsed"
          class="pin-btn"
          :class="{ pinned: pinnedTab === tab.id }"
          @click.stop="inspectorStore.pinTab(tab.id)"
        >
          <Pin class="pin-icon" />
        </button>
      </button>
    </div>

    <div v-if="!isIconMode || !rightPanelCollapsed" class="inspector-content">
      <div v-if="activeTab === 'circuit'"><slot name="circuit" /></div>
      <div v-else-if="activeTab === 'mechanical'" class="placeholder">{{ t('workbench.world.placeholderW3a') }}</div>
      <div v-else-if="activeTab === 'bindings'" class="placeholder">{{ t('workbench.world.placeholderW2') }}</div>
      <div v-else-if="activeTab === 'environment'" class="placeholder">{{ t('workbench.world.placeholderW4') }}</div>
      <div v-else-if="activeTab === 'faults'"><slot name="faults" /></div>
      <div v-else-if="activeTab === 'diagnostics'" class="placeholder">{{ t('workbench.world.placeholderW5') }}</div>
    </div>

    <div v-if="isIconMode && !rightPanelCollapsed" class="overlay-backdrop" @click="closeOverlay" />
  </aside>
</template>

<style scoped>
.inspector-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-color);
  min-width: 280px;
  height: 100%;
}

.inspector-panel--icon {
  min-width: 48px;
  width: 48px;
}

.inspector-panel--overlay {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 320px;
  z-index: 100;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.4);
}

.overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  background: rgba(0, 0, 0, 0.3);
}

.inspector-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.inspector-tabs--icon {
  flex-direction: column;
}

.inspector-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  font-size: 12px;
}

.inspector-tab.active {
  background: rgba(56, 189, 248, 0.15);
  color: var(--color-highlight);
}

.tab-icon { width: 14px; height: 14px; flex-shrink: 0; }

.pin-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px;
  opacity: 0.4;
}

.pin-btn.pinned { opacity: 1; color: var(--color-highlight); }
.pin-icon { width: 12px; height: 12px; }

.inspector-content {
  flex: 1;
  overflow: auto;
  padding: 12px;
}

.placeholder {
  color: var(--text-muted);
  text-align: center;
  padding: 32px 16px;
  font-size: 13px;
}
</style>

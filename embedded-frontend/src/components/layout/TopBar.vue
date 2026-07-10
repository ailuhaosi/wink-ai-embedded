<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Cpu,
  Play,
  Pause,
  RotateCcw,
  FolderOpen,
  Save,
  HelpCircle,
  ChevronDown,
  ArrowLeft,
} from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useWorkbenchModeStore } from '@/stores/workbench-mode.store';
import { useSimulationStore } from '@/stores/simulation.store';
import { useProjectStore } from '@/stores/project.store';
import { clockUs } from '@/services/simulation-runtime';

const emit = defineEmits<{
  modeChange: [mode: 'design' | 'simulate' | 'diagnose'];
  toggleSimulation: [];
  reset: [];
  replayOnboarding: [];
  saveProject: [];
  openProject: [file: File];
}>();

const { t } = useI18n();
const modeStore = useWorkbenchModeStore();
const simStore = useSimulationStore();
const projectStore = useProjectStore();
const { current, designSubMode } = storeToRefs(modeStore);
const { isInitialized, isRunning, isFaulted, activeAppId, initError } = storeToRefs(simStore);

const fileInputRef = ref<HTMLInputElement | null>(null);
const projectDetailsOpen = ref(false);
const helpMenuOpen = ref(false);
const projectDetailsRef = ref<HTMLElement | null>(null);
const helpMenuRef = ref<HTMLElement | null>(null);

const modes = [
  { id: 'design' as const, label: t('workbench.mode.design'), hint: t('workbench.mode.designHint') },
  { id: 'simulate' as const, label: t('workbench.mode.simulate'), hint: t('workbench.mode.simulateHint') },
  { id: 'diagnose' as const, label: t('workbench.mode.diagnose'), hint: t('workbench.mode.diagnoseHint') },
];

function formatTime(val: string | number): string {
  const us = BigInt(val.toString());
  return (Number(us) / 1000).toFixed(2);
}

function onModeClick(mode: 'design' | 'simulate' | 'diagnose') {
  emit('modeChange', mode);
}

function setSubMode(subMode: 'circuit-first' | 'structure-first') {
  modeStore.setDesignSubMode(subMode);
}

function triggerOpenProject() {
  fileInputRef.value?.click();
}

function onProjectFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    emit('openProject', file);
  }
  input.value = '';
}

function toggleProjectDetails() {
  projectDetailsOpen.value = !projectDetailsOpen.value;
  helpMenuOpen.value = false;
}

function toggleHelpMenu() {
  helpMenuOpen.value = !helpMenuOpen.value;
  projectDetailsOpen.value = false;
}

function closePopovers() {
  projectDetailsOpen.value = false;
  helpMenuOpen.value = false;
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node;
  if (projectDetailsRef.value?.contains(target) || helpMenuRef.value?.contains(target)) {
    return;
  }
  closePopovers();
}

function onSaveShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    emit('saveProject');
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onSaveShortcut);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onSaveShortcut);
});
</script>

<template>
  <header class="top-bar">
    <!-- Context row: brand + project + file IO + help + engine status -->
    <div class="top-bar__row top-bar__row--context">
      <div class="brand">
        <Cpu class="brand-icon" />
        <span class="brand-name">{{ t('workbench.brand') }}</span>
        <span class="brand-sep">/</span>
        <div ref="projectDetailsRef" class="project-trigger-wrap">
          <button
            type="button"
            class="project-trigger"
            :aria-expanded="projectDetailsOpen"
            @click.stop="toggleProjectDetails"
          >
            <span class="project-name">{{ projectStore.projectName }}</span>
            <ChevronDown class="chevron" :class="{ open: projectDetailsOpen }" />
          </button>
          <div v-if="projectDetailsOpen" class="popover project-popover" @click.stop>
            <div class="popover-title">{{ t('workbench.project.details') }}</div>
            <dl class="detail-list">
              <div class="detail-row">
                <dt>{{ t('workbench.project.targetBoard') }}</dt>
                <dd class="font-mono">{{ projectStore.targetBoard }}</dd>
              </div>
              <div class="detail-row">
                <dt>{{ t('workbench.project.safetyLevel') }}</dt>
                <dd class="font-mono">{{ projectStore.safetyLevel }}</dd>
              </div>
              <div class="detail-row">
                <dt>{{ t('workbench.project.wasmApp') }}</dt>
                <dd class="font-mono">{{ activeAppId }}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div class="context-actions">
        <button type="button" class="toolbar-btn" @click="emit('saveProject')">
          <Save class="icon" />
          <span>{{ t('workbench.project.save') }}</span>
          <kbd class="kbd">Ctrl+S</kbd>
        </button>
        <button type="button" class="toolbar-btn" @click="triggerOpenProject">
          <FolderOpen class="icon" />
          <span>{{ t('workbench.project.open') }}</span>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".json,application/json"
          class="project-file-input"
          @change="onProjectFileChange"
        />

        <div ref="helpMenuRef" class="help-wrap">
          <button
            type="button"
            class="toolbar-btn toolbar-btn--icon"
            :aria-expanded="helpMenuOpen"
            :title="t('workbench.help.menu')"
            @click.stop="toggleHelpMenu"
          >
            <HelpCircle class="icon" />
          </button>
          <div v-if="helpMenuOpen" class="popover help-popover" @click.stop>
            <button type="button" class="menu-item" @click="emit('replayOnboarding'); closePopovers()">
              {{ t('workbench.help.replayOnboarding') }}
            </button>
          </div>
        </div>

        <span
          v-if="!isInitialized && initError"
          class="status-tag status-danger"
          :title="initError"
        >{{ t('workbench.status.engineFailed') }}</span>
        <span v-else-if="!isInitialized" class="status-tag status-warn">{{ t('workbench.status.engineLoading') }}</span>
        <span v-else-if="isFaulted" class="status-tag status-danger">{{ t('workbench.status.faulted') }}</span>
        <span v-else-if="isRunning" class="status-tag status-success">{{ t('workbench.status.simulating') }}</span>
        <span v-else class="status-tag status-idle">{{ t('workbench.status.standby') }}</span>
      </div>
    </div>

    <!-- Toolbar row: mode + task area + meters -->
    <div class="top-bar__row top-bar__row--toolbar">
      <div class="toolbar-left">
        <div class="mode-switcher" role="tablist" :aria-label="t('workbench.mode.switcherLabel')">
          <button
            v-for="mode in modes"
            :key="mode.id"
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ active: current === mode.id }"
            :aria-selected="current === mode.id"
            :title="mode.hint"
            @click="onModeClick(mode.id)"
          >
            {{ mode.label }}
          </button>
        </div>

        <div v-if="current === 'design'" class="segmented" role="group" :aria-label="t('workbench.designSubMode.groupLabel')">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: designSubMode === 'circuit-first' }"
            :title="t('workbench.designSubMode.circuitFirstHint')"
            @click="setSubMode('circuit-first')"
          >
            {{ t('workbench.designSubMode.circuitFirst') }}
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: designSubMode === 'structure-first' }"
            :title="t('workbench.designSubMode.structureFirstHint')"
            @click="setSubMode('structure-first')"
          >
            {{ t('workbench.designSubMode.structureFirst') }}
          </button>
        </div>
      </div>

      <div class="toolbar-center">
        <template v-if="current === 'simulate'">
          <div class="transport-group">
            <button
              type="button"
              class="toolbar-btn toolbar-btn--primary"
              :class="{ 'is-running': isRunning, 'is-disabled-hint': !isInitialized && !isRunning }"
              :disabled="!isInitialized"
              :title="!isInitialized ? t('workbench.staticCheck.notInitialized') : undefined"
              @click="emit('toggleSimulation')"
            >
              <Play v-if="!isRunning" class="icon" />
              <Pause v-else class="icon" />
              <span>{{
                !isInitialized && !isRunning
                  ? t('workbench.status.engineLoading')
                  : isRunning
                    ? t('workbench.controls.pause')
                    : t('workbench.controls.play')
              }}</span>
            </button>
            <button
              type="button"
              class="toolbar-btn"
              :disabled="!isInitialized"
              @click="emit('reset')"
            >
              <RotateCcw class="icon" />
              <span>{{ t('workbench.controls.reset') }}</span>
            </button>
          </div>
        </template>

        <template v-else-if="current === 'diagnose'">
          <div class="diagnose-banner">
            <span class="diagnose-hint">{{ t('workbench.diagnose.readOnlyHint') }}</span>
            <button type="button" class="toolbar-btn" @click="onModeClick('design')">
              <ArrowLeft class="icon" />
              <span>{{ t('workbench.diagnose.backToDesign') }}</span>
            </button>
          </div>
        </template>
      </div>

      <div class="toolbar-right">
        <div v-if="current === 'simulate'" class="meter-group">
          <label class="meter">
            <span class="meter-label">{{ t('workbench.controls.speed') }}</span>
            <select
              :value="simStore.simSpeed"
              class="meter-select font-mono"
              @change="simStore.setSpeed(Number(($event.target as HTMLSelectElement).value))"
            >
              <option :value="1">1×</option>
              <option :value="2">2×</option>
              <option :value="5">5×</option>
              <option :value="10">10×</option>
            </select>
          </label>
          <div class="meter meter--readonly">
            <span class="meter-label">{{ t('workbench.controls.time') }}</span>
            <span class="meter-value font-mono">{{ formatTime(clockUs) }} ms</span>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.top-bar__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 12px;
  min-height: 40px;
}

.top-bar__row--context {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.top-bar__row--toolbar {
  min-height: 44px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
}

/* ── Context row ── */
.brand {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.brand-icon {
  width: 18px;
  height: 18px;
  color: var(--color-highlight);
  flex-shrink: 0;
}

.brand-name {
  font-weight: 600;
  font-size: 13px;
  flex-shrink: 0;
}

.brand-sep {
  color: var(--text-muted);
  font-size: 12px;
  flex-shrink: 0;
}

.project-trigger-wrap {
  position: relative;
  min-width: 0;
}

.project-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  max-width: 240px;
}

.project-trigger:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.project-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  transition: transform 150ms ease;
  opacity: 0.6;
}

.chevron.open {
  transform: rotate(180deg);
}

.context-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.project-file-input {
  display: none;
}

.help-wrap {
  position: relative;
}

/* ── Shared toolbar control (32px) ── */
.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition: border-color 150ms ease, color 150ms ease, background 150ms ease;
}

.toolbar-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: rgba(56, 189, 248, 0.35);
  background: rgba(255, 255, 255, 0.06);
}

.toolbar-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar-btn--icon {
  width: 32px;
  padding: 0;
  justify-content: center;
}

.toolbar-btn--primary {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.toolbar-btn--primary.is-running {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.toolbar-btn--primary.is-disabled-hint:disabled {
  opacity: 0.55;
}

.icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.kbd {
  font-size: 10px;
  font-family: ui-monospace, monospace;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-muted);
  border: 1px solid rgba(255, 255, 255, 0.1);
  line-height: 1.4;
}

/* ── Popovers ── */
.popover {
  position: absolute;
  top: calc(100% + 6px);
  z-index: 100;
  min-width: 220px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1e293b;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.project-popover {
  left: 0;
}

.help-popover {
  right: 0;
  min-width: 180px;
  padding: 4px;
}

.popover-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}

.detail-list {
  margin: 0;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  font-size: 12px;
}

.detail-row dt {
  color: var(--text-muted);
}

.detail-row dd {
  margin: 0;
  color: var(--text-primary);
  text-align: right;
}

.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.menu-item:hover {
  background: rgba(56, 189, 248, 0.1);
  color: var(--color-highlight);
}

/* ── Toolbar grid columns ── */
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-self: start;
}

.toolbar-center {
  display: flex;
  align-items: center;
  justify-content: center;
  justify-self: center;
}

.toolbar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  justify-self: end;
}

.mode-switcher {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.25);
  padding: 3px;
  border-radius: 8px;
}

.mode-btn {
  height: 32px;
  padding: 0 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: background 150ms ease, color 150ms ease;
}

.mode-btn:hover:not(.active) {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.mode-btn.active {
  background: var(--color-highlight);
  color: #fff;
}

.segmented {
  display: flex;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  overflow: hidden;
}

.seg-btn {
  height: 100%;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: background 150ms ease, color 150ms ease;
}

.seg-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
}

.seg-btn.active {
  background: rgba(56, 189, 248, 0.18);
  color: var(--color-highlight);
}

.transport-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.diagnose-banner {
  display: flex;
  align-items: center;
  gap: 12px;
}

.diagnose-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.meter-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.meter {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
}

.meter-label {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.meter-select {
  height: 32px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 0 8px;
  font-size: 12px;
}

.meter-value {
  font-size: 12px;
  color: var(--color-highlight);
  min-width: 72px;
  text-align: right;
}

.meter--readonly {
  padding: 0 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

/* ── Status tags ── */
.status-tag {
  font-size: 11px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 4px;
  font-weight: 600;
}

.status-success { background: rgba(0, 255, 136, 0.15); color: var(--color-accent); }
.status-danger { background: rgba(255, 74, 90, 0.15); color: var(--color-danger); }
.status-warn { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
.status-idle { background: rgba(255, 255, 255, 0.06); color: var(--text-muted); }

@media (max-width: 960px) {
  .kbd {
    display: none;
  }

  .top-bar__row--toolbar {
    grid-template-columns: 1fr;
    gap: 8px;
    padding-bottom: 8px;
  }

  .toolbar-left,
  .toolbar-center,
  .toolbar-right {
    justify-self: stretch;
    justify-content: center;
  }

  .toolbar-right .meter-group {
    justify-content: center;
  }
}
</style>

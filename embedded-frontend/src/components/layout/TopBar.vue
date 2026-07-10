<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Cpu, Play, Pause, RotateCcw, Zap, MousePointer2, LayoutGrid } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useWorkbenchModeStore } from '@/stores/workbench-mode.store';
import { useSimulationStore } from '@/stores/simulation.store';
import { useCanvasStore } from '@/stores/canvas.store';
import { useProjectStore } from '@/stores/project.store';

const emit = defineEmits<{
  modeChange: [mode: 'design' | 'simulate' | 'diagnose'];
  toggleSimulation: [];
  reset: [];
  tidy: [];
  replayOnboarding: [];
}>();

const { t } = useI18n();
const modeStore = useWorkbenchModeStore();
const simStore = useSimulationStore();
const canvasStore = useCanvasStore();
const projectStore = useProjectStore();
const { current, designSubMode } = storeToRefs(modeStore);
const { isInitialized, isRunning, isFaulted, clockUs } = storeToRefs(simStore);

const modes = [
  { id: 'design' as const, label: t('workbench.mode.design'), desc: t('workbench.mode.designDesc') },
  { id: 'simulate' as const, label: t('workbench.mode.simulate'), desc: t('workbench.mode.simulateDesc') },
  { id: 'diagnose' as const, label: t('workbench.mode.diagnose'), desc: t('workbench.mode.diagnoseDesc') },
];

function formatTime(val: string | number): string {
  const us = BigInt(val.toString());
  return (Number(us) / 1000).toFixed(2);
}

async function onModeClick(mode: 'design' | 'simulate' | 'diagnose') {
  emit('modeChange', mode);
}

function setSubMode(subMode: 'circuit-first' | 'structure-first') {
  modeStore.setDesignSubMode(subMode);
}
</script>

<template>
  <header class="top-bar">
    <div class="top-bar__row top-bar__row--context">
      <div class="brand">
        <Cpu class="brand-icon" />
        <span>{{ t('workbench.brand') }}</span>
        <span class="project-name">{{ projectStore.projectName }}</span>
        <span class="badge font-mono">Target: {{ projectStore.targetBoard }}</span>
        <span class="badge font-mono">Safety: {{ projectStore.safetyLevel }}</span>
      </div>
      <div class="status-indicators">
        <button type="button" class="replay-onboarding-btn" @click="emit('replayOnboarding')">
          {{ t('workbench.onboarding.replay') }}
        </button>
        <span v-if="isFaulted" class="status-tag status-danger">{{ t('workbench.status.faulted') }}</span>
        <span v-else-if="isRunning" class="status-tag status-success">{{ t('workbench.status.simulating') }}</span>
        <span v-else class="status-tag status-idle">{{ t('workbench.status.standby') }}</span>
      </div>
    </div>

    <div class="top-bar__row top-bar__row--toolbar">
      <div class="mode-switcher">
        <button
          v-for="mode in modes"
          :key="mode.id"
          class="mode-btn"
          :class="{ active: current === mode.id }"
          @click="onModeClick(mode.id)"
        >
          <span class="mode-label">{{ mode.label }}</span>
          <span class="mode-desc">{{ mode.desc }}</span>
        </button>
      </div>

      <div class="mode-toolbar">
        <template v-if="current === 'design'">
          <div class="segmented">
            <button
              class="seg-btn"
              :class="{ active: designSubMode === 'circuit-first' }"
              @click="setSubMode('circuit-first')"
            >{{ t('workbench.designSubMode.circuitFirst') }}</button>
            <button
              class="seg-btn"
              :class="{ active: designSubMode === 'structure-first' }"
              @click="setSubMode('structure-first')"
            >{{ t('workbench.designSubMode.structureFirst') }}</button>
          </div>
          <div class="control-group">
            <div class="mode-switch">
              <button class="mode-switch-btn" :class="{ active: canvasStore.routingMode === 'auto' }" @click="canvasStore.setRoutingMode('auto')">
                <Zap class="icon" /><span>{{ t('workbench.controls.wireAuto') }}</span>
              </button>
              <button class="mode-switch-btn" :class="{ active: canvasStore.routingMode === 'manual' }" @click="canvasStore.setRoutingMode('manual')">
                <MousePointer2 class="icon" /><span>{{ t('workbench.controls.wireManual') }}</span>
              </button>
            </div>
          </div>
          <button class="btn btn-secondary btn-small" @click="$emit('tidy')">
            <LayoutGrid class="icon" /><span>{{ t('workbench.controls.tidy') }}</span>
          </button>
        </template>

        <template v-else>
          <button class="btn" :class="{ 'btn-running': isRunning }" :disabled="!isInitialized" @click="emit('toggleSimulation')">
            <Play v-if="!isRunning" class="icon" />
            <Pause v-else class="icon" />
            <span>{{ isRunning ? t('workbench.controls.pause') : t('workbench.controls.play') }}</span>
          </button>
          <button class="btn btn-secondary" :disabled="!isInitialized" @click="emit('reset')">
            <RotateCcw class="icon" /><span>{{ t('workbench.controls.reset') }}</span>
          </button>
          <div class="control-group">
            <label>{{ t('workbench.controls.speed') }}:</label>
            <select :value="simStore.simSpeed" class="select font-mono" @change="simStore.setSpeed(Number(($event.target as HTMLSelectElement).value))">
              <option :value="1">1x</option>
              <option :value="2">2x</option>
              <option :value="5">5x</option>
              <option :value="10">10x</option>
            </select>
          </div>
          <div class="control-group">
            <label>{{ t('workbench.controls.time') }}:</label>
            <span class="time-display font-mono">{{ formatTime(clockUs) }} ms</span>
          </div>
        </template>
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
  padding: 8px 16px;
  gap: 12px;
}

.top-bar__row--context {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.brand-icon {
  width: 20px;
  height: 20px;
  color: var(--color-highlight);
}

.project-name {
  color: var(--text-secondary);
  font-weight: 500;
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.mode-switcher {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.2);
  padding: 4px;
  border-radius: 8px;
}

.mode-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 200ms ease;
}

.mode-btn.active {
  background: var(--color-highlight);
  color: #fff;
}

.mode-label { font-size: 13px; font-weight: 600; }
.mode-desc { font-size: 10px; opacity: 0.8; }

.mode-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.segmented {
  display: flex;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  overflow: hidden;
}

.seg-btn {
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
}

.seg-btn.active {
  background: rgba(56, 189, 248, 0.2);
  color: var(--color-highlight);
}

.control-group {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.mode-switch {
  display: flex;
  gap: 4px;
}

.mode-switch-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.mode-switch-btn.active {
  border-color: var(--color-highlight);
  color: var(--color-highlight);
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.btn-running {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-secondary {
  background: transparent;
}

.btn-small { padding: 4px 10px; }

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon { width: 14px; height: 14px; }

.select {
  background: var(--bg-secondary);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
}

.time-display { color: var(--color-highlight); }

.status-indicators { display: flex; align-items: center; gap: 8px; }

.replay-onboarding-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.replay-onboarding-btn:hover {
  color: var(--color-highlight);
  background: rgba(56, 189, 248, 0.1);
}

.status-tag {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  font-weight: 600;
}

.status-success { background: rgba(0, 255, 136, 0.15); color: var(--color-accent); }
.status-danger { background: rgba(255, 74, 90, 0.15); color: var(--color-danger); }
.status-idle { background: rgba(255, 255, 255, 0.06); color: var(--text-muted); }
</style>

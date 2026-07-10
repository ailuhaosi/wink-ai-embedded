<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useLayoutStore } from '@/stores/layout.store';
import { useSimulationStore } from '@/stores/simulation.store';
import { useWorkbenchModeStore } from '@/stores/workbench-mode.store';
import { Activity, Terminal, GitBranch, Hammer, ShieldCheck } from 'lucide-vue-next';

const { t } = useI18n();
const layoutStore = useLayoutStore();
const simStore = useSimulationStore();
const modeStore = useWorkbenchModeStore();
const { bottomPanelActiveTab, bottomPanelHeight, bottomPanelExpanded } = storeToRefs(layoutStore);
const { traces, logs } = storeToRefs(simStore);
const { lastStaticCheckIssues } = storeToRefs(modeStore);

const tabs = computed(() => [
  { id: 'trace' as const, label: t('workbench.console.trace'), icon: Activity },
  { id: 'causal' as const, label: t('workbench.console.causal'), icon: GitBranch },
  { id: 'logs' as const, label: t('workbench.console.logs'), icon: Terminal },
  { id: 'build' as const, label: t('workbench.console.build'), icon: Hammer },
  { id: 'static-check' as const, label: t('workbench.console.staticCheck'), icon: ShieldCheck },
]);

let resizeStartY = 0;
let resizeStartHeight = 0;

function onResizeStart(event: PointerEvent) {
  resizeStartY = event.clientY;
  resizeStartHeight = bottomPanelHeight.value;
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
}

function onResizeMove(event: PointerEvent) {
  const delta = resizeStartY - event.clientY;
  layoutStore.setBottomPanelHeight(Math.max(120, Math.min(window.innerHeight * 0.7, resizeStartHeight + delta)));
}

function onResizeEnd(event: PointerEvent) {
  (event.target as HTMLElement).releasePointerCapture(event.pointerId);
}

function getTraceLabel(type: number): string {
  switch (type) {
    case 1: return 'GPIO EDGE';
    case 2: return 'I2C PKT';
    case 3: return 'FAULT DISCONNECT';
    case 4: return 'DEGRADE BOUNCE';
    default: return 'SYS TICK';
  }
}

function formatTime(val: number): string {
  return (val / 1000).toFixed(2);
}
</script>

<template>
  <footer class="bottom-console" :style="{ height: bottomPanelExpanded ? `${bottomPanelHeight}px` : '36px' }">
    <div
      class="resize-handle"
      @pointerdown="onResizeStart"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
    />
    <div class="tabs-header">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: bottomPanelActiveTab === tab.id }"
        @click="layoutStore.activateBottomTab(tab.id)"
      >
        <component :is="tab.icon" class="tab-icon" />
        <span>{{ tab.label }}</span>
      </button>
      <button class="collapse-btn" @click="bottomPanelExpanded = !bottomPanelExpanded">
        {{ bottomPanelExpanded ? '▼' : '▲' }}
      </button>
    </div>

    <div v-if="bottomPanelExpanded" class="tab-content scrollable font-mono">
      <div v-show="bottomPanelActiveTab === 'trace'" class="console">
        <div v-if="traces.length === 0" class="empty-console">No simulation traces captured yet.</div>
        <div v-else class="trace-list">
          <div v-for="(trace, index) in [...traces].reverse()" :key="'trace-' + index" class="trace-line">
            <span class="trace-time">[{{ formatTime(trace.timestamp) }} ms]</span>
            <span class="trace-type">{{ getTraceLabel(trace.type) }}</span>
            <span class="trace-details">Pin/Bus: {{ trace.pinOrBus }}</span>
          </div>
        </div>
      </div>

      <div v-show="bottomPanelActiveTab === 'logs'" class="console">
        <button class="btn-clear" @click="simStore.clearLogs()">Clear</button>
        <div v-if="logs.length === 0" class="empty-console">Console is clear.</div>
        <div v-else class="log-list">
          <div v-for="(log, idx) in logs" :key="'log-' + idx" class="log-line" :class="'log-' + log.level">
            <span class="log-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
            <span>{{ log.message }}</span>
          </div>
        </div>
      </div>

      <div v-show="bottomPanelActiveTab === 'static-check'" class="console">
        <div v-if="lastStaticCheckIssues.length === 0" class="empty-console">{{ t('workbench.staticCheck.passed') }}</div>
        <ul v-else class="issue-list">
          <li v-for="issue in lastStaticCheckIssues" :key="issue.id" class="issue-item">
            {{ issue.id === 'sim-init-failed' ? issue.message : t(issue.message) }}
          </li>
        </ul>
      </div>

      <div v-show="bottomPanelActiveTab === 'causal'" class="console placeholder-panel">
        {{ t('workbench.world.placeholderW5') }}
      </div>

      <div v-show="bottomPanelActiveTab === 'build'" class="console placeholder-panel">
        Build output — W2+
      </div>
    </div>
  </footer>
</template>

<style scoped>
.bottom-console {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-color);
  background: var(--bg-primary);
  min-height: 36px;
  flex-shrink: 0;
  position: relative;
}

.resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  cursor: row-resize;
  z-index: 2;
}

.resize-handle:hover {
  background: rgba(59, 130, 246, 0.4);
}

.tabs-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
}

.tab-btn.active {
  background: rgba(56, 189, 248, 0.15);
  color: var(--color-highlight);
}

.tab-icon { width: 14px; height: 14px; }

.collapse-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
}

.tab-content {
  flex: 1;
  overflow: auto;
  padding: 8px 12px;
  font-size: 12px;
}

.console { min-height: 80px; }

.empty-console {
  color: var(--text-muted);
  padding: 16px;
  text-align: center;
}

.trace-line, .log-line {
  padding: 2px 0;
  color: var(--text-secondary);
}

.trace-time { color: var(--text-muted); margin-right: 8px; }
.trace-type { color: var(--color-highlight); margin-right: 8px; }

.issue-list { list-style: none; padding: 0; margin: 0; }
.issue-item { color: var(--color-danger); padding: 4px 0; }

.placeholder-panel {
  color: var(--text-muted);
  padding: 24px;
  text-align: center;
}

.btn-clear {
  margin-bottom: 8px;
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
}
</style>

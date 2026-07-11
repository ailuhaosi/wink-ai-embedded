<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { actuatorObservations } from '@/services/simulation-runtime';
import { useSimulationStore } from '@/stores/simulation.store';

const simStore = useSimulationStore();
const { isRunning, isInitialized } = storeToRefs(simStore);

const hasData = computed(() => actuatorObservations.value.length > 0);
</script>

<template>
  <div class="actuator-panel" :class="{ 'is-running': isRunning }">
    <div class="section-title">
      Actuator Observations
    </div>

    <div v-if="!isInitialized" class="empty-state">
      Waiting for simulation...
    </div>

    <div v-else-if="!hasData" class="empty-state">
      —
    </div>

    <div v-else class="actuator-list">
      <div
        v-for="obs in actuatorObservations"
        :key="obs.deviceComponentId"
        class="actuator-item"
      >
        <span class="component-id">{{ obs.deviceComponentId }}</span>
        <span class="separator">·</span>
        <span class="value font-mono">
          {{ typeof obs.value === 'number' ? Math.round(obs.value) : obs.value }}
          <span class="unit">{{ obs.unit === 'deg' ? '°' : obs.unit }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.actuator-panel {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
  transition: opacity 0.2s ease;
}

.actuator-panel:not(.is-running) {
  opacity: 0.6;
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.empty-state {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 10px;
  border: 1px dashed var(--border-color);
  border-radius: 4px;
}

.actuator-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #0f172a;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px;
}

.actuator-item {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: var(--text-primary);
}

.component-id {
  font-weight: 500;
}

.separator {
  margin: 0 8px;
  color: var(--text-muted);
}

.value {
  color: var(--color-highlight);
  font-weight: 600;
}

.unit {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: 1px;
}

.is-running .value {
  color: var(--color-accent);
}
</style>

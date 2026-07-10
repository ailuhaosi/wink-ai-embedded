<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useSimulationStore } from '@/stores/simulation.store';

const { t } = useI18n();
const simStore = useSimulationStore();
const { initError } = storeToRefs(simStore);

function retry() {
  simStore.retryInit();
}

function reset() {
  simStore.reset();
  simStore.retryInit();
}
</script>

<template>
  <div
    v-if="initError"
    class="sim-error-banner"
    role="alert"
  >
    <div class="sim-error-banner__text">
      <strong>{{ t('workbench.error.engineTitle') }}</strong>
      <span class="sim-error-banner__detail">{{ initError }}</span>
    </div>
    <div class="sim-error-banner__actions">
      <button type="button" class="sim-error-banner__btn" @click="retry">
        {{ t('workbench.error.retry') }}
      </button>
      <button type="button" class="sim-error-banner__btn sim-error-banner__btn--secondary" @click="reset">
        {{ t('workbench.error.reset') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sim-error-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #c45c5c;
  background: #2a1818;
  color: #f0d0d0;
  z-index: 40;
}

.sim-error-banner__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sim-error-banner__detail {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  opacity: 0.9;
  word-break: break-word;
}

.sim-error-banner__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.sim-error-banner__btn {
  padding: 6px 12px;
  border: 1px solid #c45c5c;
  background: #3a2020;
  color: inherit;
  cursor: pointer;
}

.sim-error-banner__btn:hover {
  background: #4a2828;
}

.sim-error-banner__btn--secondary {
  background: transparent;
}
</style>

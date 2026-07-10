<script setup lang="ts">
import { computed } from 'vue';

import '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { resolveWorldEntries } from './resolveWorldEntries';

const props = defineProps<{
  components: CircuitComponentInstance[];
  pinStates: Record<number, boolean>;
  oledFb: Uint8Array | null;
}>();

const entries = computed(() =>
  resolveWorldEntries(props.components, {
    pinStates: props.pinStates,
    oledFb: props.oledFb,
  }),
);
</script>

<template>
  <div class="virtual-peripherals-grid">
    <div v-for="entry in entries" :key="`sim-${entry.id}`" class="grid-card">
      <div class="card-header">
        <span class="card-title">{{ entry.name }}</span>
      </div>
      <div class="card-body">
        <component :is="entry.component" v-bind="entry.boundProps" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-peripherals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;
}
.grid-card {
  background: #0f172a;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
}
.card-header {
  background: #1e293b;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}
.card-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}
.card-body {
  padding: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>

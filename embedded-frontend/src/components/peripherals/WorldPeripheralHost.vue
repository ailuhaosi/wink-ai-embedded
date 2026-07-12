<script setup lang="ts">
import { computed } from 'vue';

import '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { ActuatorObservation } from '@/types/actuator-observation';
import { bindWorldProps } from './bindWorldProps';
import { registry } from '@/peripherals/registry';

const props = defineProps<{
  comp: CircuitComponentInstance;
  pinStates: Record<number, boolean>;
  oledFb: Uint8Array | null;
  displayFb?: Uint8Array | null;
  actuatorObservations?: readonly ActuatorObservation[];
}>();

/**
 * Per-widget host with getter ctx — same rationale as CanvasPeripheralsHost:
 * a shared `entries` computed that touches oledFb for OLED would rebind the
 * button WorldWidget every frame and break wokwi-pushbutton gestures.
 */
const entry = computed(() => {
  const def = registry.get(props.comp.type);
  const component = def?.world?.component;
  if (!component) return null;

  const boundProps = bindWorldProps(props.comp, {
    get pinStates() {
      return props.pinStates;
    },
    get oledFb() {
      return props.oledFb;
    },
    get displayFb() {
      return props.displayFb ?? null;
    },
    get actuatorObservations() {
      return props.actuatorObservations ?? [];
    },
  });
  if (!boundProps) return null;

  return { component, boundProps };
});
</script>

<template>
  <div v-if="entry" class="grid-card">
    <div class="card-header">
      <span class="card-title">{{ comp.name }}</span>
    </div>
    <div class="card-body">
      <component :is="entry.component" v-bind="entry.boundProps" />
    </div>
  </div>
</template>

<style scoped>
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

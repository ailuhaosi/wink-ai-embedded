<script setup lang="ts">
import { computed } from 'vue';

import '@/peripherals';
import { registry } from '@/peripherals/registry';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import WorldPeripheralHost from './WorldPeripheralHost.vue';

const props = defineProps<{
  components: CircuitComponentInstance[];
  pinStates: Record<number, boolean>;
  oledFb: Uint8Array | null;
}>();

/** Only comps that have a world widget — host owns lazy bind deps. */
const worldComps = computed(() =>
  props.components.filter((c) => registry.get(c.type)?.world?.component),
);
</script>

<template>
  <div class="virtual-peripherals-grid">
    <WorldPeripheralHost
      v-for="comp in worldComps"
      :key="`sim-${comp.id}`"
      :comp="comp"
      :pin-states="pinStates"
      :oled-fb="oledFb"
    />
  </div>
</template>

<style scoped>
.virtual-peripherals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;
}
</style>

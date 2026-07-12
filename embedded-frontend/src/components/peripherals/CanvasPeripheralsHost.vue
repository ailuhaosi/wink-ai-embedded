<script setup lang="ts">
import { computed } from 'vue';

import '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { ActuatorObservation } from '@/types/actuator-observation';
import { resolveCanvasEntry } from './resolveCanvasEntry';

const props = defineProps<{
  comp: CircuitComponentInstance;
  pinStates: Record<number, boolean>;
  oledFb?: Uint8Array | null;
  displayFb?: Uint8Array | null;
  actuatorObservations?: readonly ActuatorObservation[];
}>();

const emit = defineEmits<{
  buttonPress: [];
  buttonRelease: [];
}>();

// Getter ctx so Vue only tracks surfaces each binder actually reads.
// Eager `{ oledFb: props.oledFb }` would rebind EVERY glyph on each OLED frame
// and break wokwi-pushbutton press gestures (M2 regression).
const entry = computed(() =>
  resolveCanvasEntry(props.comp, {
    get pinStates() {
      return props.pinStates;
    },
    get oledFb() {
      return props.oledFb ?? null;
    },
    get displayFb() {
      return props.displayFb ?? null;
    },
    get actuatorObservations() {
      return props.actuatorObservations ?? [];
    },
  }),
);
</script>

<template>
  <component
    v-if="entry"
    :is="entry.component"
    v-bind="entry.boundProps"
    @button-press="emit('buttonPress')"
    @button-release="emit('buttonRelease')"
  />
</template>

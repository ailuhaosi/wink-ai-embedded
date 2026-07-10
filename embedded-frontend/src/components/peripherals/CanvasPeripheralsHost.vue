<script setup lang="ts">
import { computed } from 'vue';

import '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { resolveCanvasEntry } from './resolveCanvasEntry';

const props = defineProps<{
  comp: CircuitComponentInstance;
  pinStates: Record<number, boolean>;
}>();

const emit = defineEmits<{
  buttonPress: [];
  buttonRelease: [];
}>();

const entry = computed(() =>
  resolveCanvasEntry(props.comp, { pinStates: props.pinStates }),
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

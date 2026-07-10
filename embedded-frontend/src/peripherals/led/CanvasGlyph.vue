<script setup lang="ts">
import '@wokwi/elements';

import type { PinConnectionValue } from '@/types/peripheral-pins';

defineProps<{
  pinConnections: Record<string, PinConnectionValue>;
  color: string;
  brightness: number;
  label: string;
  flip: boolean;
  pinStates: Record<number, boolean>;
}>();
</script>

<template>
  <wokwi-led
    :pin="typeof pinConnections.A === 'number' ? pinConnections.A : 1"
    :color="color"
    :value="typeof pinConnections.A === 'number' ? pinStates[pinConnections.A] || false : false"
    :brightness="brightness"
    :label="label"
    :flip="flip"
  />
</template>

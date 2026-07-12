<script setup lang="ts">
import '@wokwi/elements';

import type { PinConnectionValue } from '@/types/peripheral-pins';
import { isPinHigh } from '../types';

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
    :value="typeof pinConnections.A === 'number' ? isPinHigh(pinStates[pinConnections.A]) : false"
    :brightness="brightness"
    :label="label"
    :flip="flip"
  />
</template>

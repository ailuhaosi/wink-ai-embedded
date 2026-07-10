<script setup lang="ts">
import '@wokwi/elements';
import { ref, watch } from 'vue';
import { oledFb } from '@/services/simulation-runtime';
import { paintOledFramebuffer, type OledElementLike } from './paintFramebuffer';

const oledEl = ref<OledElementLike | null>(null);

watch(
  oledFb,
  (newFb) => {
    if (!oledEl.value)
      return;
    paintOledFramebuffer(oledEl.value, newFb);
  },
  { immediate: true },
);
</script>

<template>
  <wokwi-ssd1306 ref="oledEl" />
</template>

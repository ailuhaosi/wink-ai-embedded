<script setup lang="ts">
import '@wokwi/elements';
import { ref, watch } from 'vue';
import { paintOledFramebuffer, type OledElementLike } from './paintFramebuffer';

const props = defineProps<{
  framebuffer?: Uint8Array | null;
}>();

const oledEl = ref<OledElementLike | null>(null);

watch(
  () => [props.framebuffer, oledEl.value] as const,
  ([newFb, el]) => {
    if (!el) return;
    paintOledFramebuffer(el, newFb ?? null);
  },
  { immediate: true },
);
</script>

<template>
  <wokwi-ssd1306 ref="oledEl" />
</template>

<script setup lang="ts">
/**
 * Canvas glyph — rendered on the breadboard canvas.
 *
 * Option A: use a Wokwi element (uncomment import + template block below)
 * Option B: use a simple div stub (default for scaffold)
 */
// import '@wokwi/elements';

import type { PinConnectionValue } from '@/types/peripheral-pins';

defineProps<{
  pinConnections: Record<string, PinConnectionValue>;
  label: string;
  enabled: boolean;
  mode: string;
  intensity: number;
  accentColor: string;
  pinStates: Record<number, boolean>;
}>();
</script>

<template>
  <!-- Option B: minimal stub -->
  <div class="example-glyph" :style="{ borderColor: accentColor }">
    <span class="label">{{ label }}</span>
    <span v-if="!enabled" class="badge">off</span>
  </div>

  <!-- Option A: Wokwi element (replace with your peripheral's element)
  <wokwi-led
    :pin="typeof pinConnections.SIG === 'number' ? pinConnections.SIG : 1"
    :color="accentColor"
    :value="enabled"
    :label="label"
  />
  -->
</template>

<style scoped>
.example-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 60px;
  height: 40px;
  border: 2px solid #94a3b8;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 10px;
  color: #cbd5e1;
}
.badge {
  font-size: 8px;
  color: #64748b;
}
</style>

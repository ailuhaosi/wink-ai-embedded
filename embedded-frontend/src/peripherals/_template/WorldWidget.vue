<script setup lang="ts">
/**
 * World widget — rendered in the 3D world viewport panel.
 * Wire simulation interactions here via peripheral simulation plugins.
 */
import type { PinConnectionValue } from '@/types/peripheral-pins';

defineProps<{
  pinConnections: Record<string, PinConnectionValue>;
  label: string;
  enabled: boolean;
  mode: string;
  intensity: number;
  accentColor: string;
}>();
</script>

<template>
  <div class="example-world" :style="{ borderColor: accentColor }">
    <div class="component-label">{{ label }} ({{ mode }})</div>
    <div class="status">{{ enabled ? 'active' : 'inactive' }} · {{ intensity }}%</div>
  </div>
</template>

<style scoped>
.example-world {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  width: 100px;
}
.component-label {
  font-size: 11px;
  color: #8fa0a8;
  margin-bottom: 4px;
}
.status {
  font-size: 10px;
  color: #64748b;
}
</style>

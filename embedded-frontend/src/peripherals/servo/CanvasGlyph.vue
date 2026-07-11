<script setup lang="ts">
import '@wokwi/elements';
import { computed } from 'vue';
import { actuatorObservations } from '@/services/simulation-runtime';

const props = defineProps<{
  id: string;
  label?: string;
  pwmChannel?: number;
}>();

const angle = computed(() => {
  const obs = actuatorObservations.value.find(
    (o) => o.deviceComponentId === props.id && o.quantity === 'angular_position'
  );
  return typeof obs?.value === 'number' ? obs.value : 90; // Default / fallback to 90 degrees
});
</script>

<template>
  <div class="servo-container">
    <wokwi-servo :angle="angle" />
    <span class="label">{{ label || id }} ({{ Math.round(angle) }}°)</span>
  </div>
</template>

<style scoped>
.servo-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.label {
  font-size: 9px;
  color: #94a3b8;
  margin-top: 2px;
  text-align: center;
}
</style>

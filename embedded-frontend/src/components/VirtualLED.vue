<template>
  <div class="virtual-led">
    <div class="component-label">LED (Pin {{ pin }})</div>
    <div class="led-wrapper">
      <wokwi-led :color="color" :value="level" />
    </div>
  </div>
</template>

<script setup lang="ts">
import '@wokwi/elements';

defineProps<{
  pin: number;
  color: 'red' | 'green' | 'blue' | 'yellow' | 'white' | 'orange';
  level: boolean;
}>();
</script>

<style scoped>
.virtual-led {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  width: 100px;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  transition: border-color 0.2s;
}
.virtual-led:hover {
  border-color: rgba(0, 255, 136, 0.3);
}
.component-label {
  font-size: 11px;
  color: #8fa0a8;
  margin-bottom: 8px;
  font-weight: 500;
}
.led-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 50px;
}
</style>

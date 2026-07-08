<template>
  <div class="virtual-ultrasonic">
    <div class="component-label">HC-SR04 (TRIG:{{ trigPin }}, ECHO:{{ echoPin }})</div>
    <div class="sensor-wrapper">
      <wokwi-hc-sr04 />
    </div>
    <div class="slider-container">
      <div class="slider-header">
        <span>Distance:</span>
        <span class="value-display">{{ localDistance }} cm</span>
      </div>
      <input
        type="range"
        min="2"
        max="400"
        v-model.number="localDistance"
        @input="updateDistance"
        class="distance-slider"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import '@wokwi/elements';
import { ref, computed, onMounted, watch } from 'vue';
import { setUltrasonicDistance } from '../services/simulation-client';

import type { PinConnectionValue } from '../types/peripheral-pins';

const props = defineProps<{
  pinConnections: Record<string, PinConnectionValue>;
  distance: number;
}>();

const localDistance = ref(props.distance);

const trigPin = computed(() => {
  const pin = props.pinConnections.TRIG;
  return typeof pin === 'number' ? pin : 'N/A';
});

const echoPin = computed(() => {
  const pin = props.pinConnections.ECHO;
  return typeof pin === 'number' ? pin : 'N/A';
});

function updateDistance() {
  const trig = trigPin.value;
  const echo = echoPin.value;
  if (typeof trig === 'number' && typeof echo === 'number') {
    setUltrasonicDistance(trig, echo, localDistance.value);
  }
}

watch(() => props.distance, (newVal) => {
  localDistance.value = newVal;
});

onMounted(() => {
  updateDistance();
});
</script>

<style scoped>
.virtual-ultrasonic {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  width: 180px;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  transition: border-color 0.2s;
}
.virtual-ultrasonic:hover {
  border-color: rgba(0, 255, 136, 0.3);
}
.component-label {
  font-size: 11px;
  color: #8fa0a8;
  margin-bottom: 8px;
  font-weight: 500;
}
.sensor-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 50px;
  margin-bottom: 12px;
}
.slider-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.slider-header {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #8fa0a8;
}
.value-display {
  color: #00ff88;
  font-weight: 600;
}
.distance-slider {
  width: 100%;
  -webkit-appearance: none;
  background: rgba(255,255,255,0.1);
  height: 4px;
  border-radius: 2px;
  outline: none;
}
.distance-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #00ff88;
  cursor: pointer;
  box-shadow: 0 0 4px #00ff88;
  transition: transform 0.1s;
}
.distance-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}
</style>
<template>
  <div class="virtual-button">
    <div class="component-label">Button (Pin {{ pin }})</div>
    <div class="btn-wrapper">
      <wokwi-pushbutton
        :color="color"
        @button-press="handlePress"
        @button-release="handleRelease"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import '@wokwi/elements';
import { setPinIdeal } from '../services/simulation-client';

const props = defineProps<{
  pin: number;
  color: 'red' | 'green' | 'blue' | 'yellow' | 'white' | 'black';
  activeLow?: boolean; // If true, pressing button drives pin LOW, releasing drives HIGH (typical pull-up button)
}>();

function handlePress() {
  // Active low button drives pin LOW (false) on press, otherwise HIGH (true)
  const level = props.activeLow ? false : true;
  setPinIdeal(props.pin, level);
}

function handleRelease() {
  const level = props.activeLow ? true : false;
  setPinIdeal(props.pin, level);
}
</script>

<style scoped>
.virtual-button {
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
.virtual-button:hover {
  border-color: rgba(0, 255, 136, 0.3);
}
.component-label {
  font-size: 11px;
  color: #8fa0a8;
  margin-bottom: 8px;
  font-weight: 500;
}
.btn-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 50px;
}
</style>

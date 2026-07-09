<template>
  <div class="virtual-button">
    <div class="component-label">Button ({{ pinLabel }})</div>
    <div class="btn-wrapper">
      <wokwi-pushbutton
        :color="color"
        :label="label"
        :xray="xray"
        @button-press="handlePress"
        @button-release="handleRelease"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import '@wokwi/elements';
import { computed } from 'vue';
import { setPinIdeal } from '../services/simulation-client';

import type { PinConnectionValue } from '../types/peripheral-pins';
import { getNetDefinitions } from '../types/peripheral-pins';
import { resolveNetConnection } from '../routing/net-pin-resolver';

const props = defineProps<{
  pinConnections: Record<string, PinConnectionValue>;
  color: 'red' | 'green' | 'blue' | 'yellow' | 'white' | 'black';
  label: string;
  xray: boolean;
  activeLow: boolean;
}>();

const signalPin = computed(() => {
  const primary = getNetDefinitions('button').find((n) => n.mode === 'primary');
  if (!primary) return null;
  const conn = resolveNetConnection(primary, props.pinConnections);
  return typeof conn === 'number' ? conn : null;
});

const pinLabel = computed(() => {
  const left1 = props.pinConnections['1.l'];
  const left2 = props.pinConnections['2.l'];
  const right1 = props.pinConnections['1.r'];
  const right2 = props.pinConnections['2.r'];
  return `1.l:${left1}, 2.l:${left2}, 1.r:${right1}, 2.r:${right2}`;
});

function handlePress() {
  if (signalPin.value === null) return;
  const level = props.activeLow ? false : true;
  setPinIdeal(signalPin.value, level);
}

function handleRelease() {
  if (signalPin.value === null) return;
  const level = props.activeLow ? true : false;
  setPinIdeal(signalPin.value, level);
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
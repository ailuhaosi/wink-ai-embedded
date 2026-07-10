<script setup lang="ts">
/* Shared object from parent canvas list — intentional in-place edits. */
/* eslint-disable vue/no-mutating-props */
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { peripheralConfigsAdapter } from '@/peripherals';
import {
  availableGPIOs,
  powerOptions,
} from '@/types/peripheral-pins';

defineProps<{
  selectedComp: CircuitComponentInstance | undefined;
  canEdit: boolean;
  ultrasonicDistance: number;
}>();

const emit = defineEmits<{
  'update:ultrasonicDistance': [value: number];
  'set-rotation': [comp: CircuitComponentInstance, deg: number];
}>();

const rotationDegrees = [0, 90, 180, 270] as const;
</script>

<template>
  <div class="inspector-section">
    <div class="section-title">
      Property Inspector
    </div>

    <div v-if="!selectedComp" class="empty-state">
      Select a peripheral on the left or click canvas node to edit properties.
    </div>

    <div v-else class="property-form">
      <div class="form-group">
        <label>Component Name</label>
        <input
          v-model="selectedComp.name"
          type="text"
          class="input"
          :disabled="!canEdit"
        >
      </div>

      <div class="section-title">
        Pin Connections
      </div>
      <div
        v-for="pinDef in peripheralConfigsAdapter[selectedComp.type]?.pins"
        :key="pinDef.name"
        class="form-group"
      >
        <label>{{ pinDef.name }} - {{ pinDef.description }}</label>
        <select
          v-model="selectedComp.pinConnections[pinDef.name]"
          class="select font-mono"
          :disabled="!canEdit"
        >
          <option v-if="!pinDef.required" :value="null">
            Not Connected
          </option>
          <template v-if="pinDef.signalType === 'power' || pinDef.signalType === 'i2c'">
            <option v-for="opt in powerOptions" :key="opt" :value="opt">
              {{ opt }}
            </option>
          </template>
          <template v-if="pinDef.signalType === 'digital' || pinDef.signalType === 'i2c'">
            <option v-for="gpio in availableGPIOs" :key="gpio" :value="gpio">
              IO{{ gpio }}
            </option>
          </template>
        </select>
      </div>

      <div class="section-title">
        Properties
      </div>
      <div
        v-for="(propDef, propKey) in peripheralConfigsAdapter[selectedComp.type]?.props"
        :key="propKey"
        class="form-group"
      >
        <label>{{ propDef.description }}</label>
        <select
          v-if="propDef.options"
          v-model="selectedComp.props[propKey]"
          class="select"
          :disabled="!canEdit"
        >
          <option v-for="opt in propDef.options" :key="opt" :value="opt">
            {{ opt }}
          </option>
        </select>
        <input
          v-else-if="propDef.type === 'number'"
          v-model.number="selectedComp.props[propKey]"
          type="number"
          class="input font-mono"
          :disabled="!canEdit"
        >
        <input
          v-else-if="propDef.type === 'boolean'"
          v-model="selectedComp.props[propKey]"
          type="checkbox"
          :disabled="!canEdit"
        >
        <input
          v-else
          v-model="selectedComp.props[propKey]"
          type="text"
          class="input"
          :disabled="!canEdit"
        >
      </div>

      <div v-if="selectedComp.type === 'ultrasonic'" class="form-group">
        <div class="slider-label">
          <span>Distance (cm):</span>
          <span class="val">{{ ultrasonicDistance }} cm</span>
        </div>
        <input
          type="range"
          min="2"
          max="400"
          class="slider"
          :value="ultrasonicDistance"
          @input="emit('update:ultrasonicDistance', Number(($event.target as HTMLInputElement).value))"
        >
      </div>

      <div class="form-group">
        <label>Rotation</label>
        <div class="rotation-btn-group">
          <button
            v-for="deg in rotationDegrees"
            :key="deg"
            class="rotation-btn"
            :class="{ active: (selectedComp.rotation || 0) === deg }"
            :disabled="!canEdit"
            @click="emit('set-rotation', selectedComp, deg)"
          >
            {{ deg }}°
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style src="./workbench-inspector.css"></style>

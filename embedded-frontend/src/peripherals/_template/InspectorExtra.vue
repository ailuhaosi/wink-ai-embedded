<script setup lang="ts">
/**
 * Optional inspector extra — custom controls in the property panel.
 * Wire via `inspectorExtra` in definition.ts.
 *
 * Props / emits must match what PeripheralInspector passes.
 */
defineProps<{
  modelValue: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number];
}>();
</script>

<template>
  <div class="form-group">
    <div class="slider-label">
      <span>Intensity:</span>
      <span class="val">{{ modelValue }}%</span>
    </div>
    <input
      type="range"
      min="0"
      max="100"
      class="slider"
      :value="modelValue"
      :disabled="disabled"
      @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    >
  </div>
</template>

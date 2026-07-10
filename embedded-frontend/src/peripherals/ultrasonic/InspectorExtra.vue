<script setup lang="ts">
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
      <span>Distance (cm):</span>
      <span class="val">{{ modelValue }} cm</span>
    </div>
    <input
      type="range"
      min="2"
      max="400"
      class="slider"
      :value="modelValue"
      :disabled="disabled"
      @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    >
  </div>
</template>

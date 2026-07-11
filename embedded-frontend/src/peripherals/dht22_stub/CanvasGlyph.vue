<script setup lang="ts">
defineProps<{
  label?: string;
}>();
</script>

<template>
  <div class="stub-glyph dht22-glyph">
    <span class="title">DHT22</span>
    <span v-if="label" class="label">{{ label }}</span>
  </div>
</template>

<style scoped>
.stub-glyph {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border: 2px dashed #22d3ee;
  border-radius: 6px;
  background: rgba(34, 211, 238, 0.08);
  color: #67e8f9;
  font-size: 10px;
  line-height: 1.2;
  text-align: center;
  padding: 4px;
  box-sizing: border-box;
}
.title {
  font-weight: 600;
}
.label {
  font-size: 9px;
  color: #94a3b8;
}
</style>

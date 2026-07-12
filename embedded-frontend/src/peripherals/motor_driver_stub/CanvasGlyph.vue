<script setup lang="ts">
defineProps<{
  id: string;
  label?: string;
  rpmLeft?: number;
  rpmRight?: number;
}>();
</script>

<template>
  <div class="stub-glyph motor-driver-glyph">
    <span class="title">Motor Driver</span>
    <span v-if="label" class="label">{{ label }}</span>
    <span class="rpm">L {{ Math.round(rpmLeft ?? 0) }} · R {{ Math.round(rpmRight ?? 0) }} rpm</span>
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
  border: 2px dashed #f97316;
  border-radius: 6px;
  background: rgba(249, 115, 22, 0.08);
  color: #fdba74;
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
.rpm {
  font-size: 9px;
  color: #fdba74;
  margin-top: 2px;
}
</style>

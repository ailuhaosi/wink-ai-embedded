<script setup lang="ts">
import { Plus } from 'lucide-vue-next';

defineProps<{
  name: string;
  desc?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <div
    class="asset-item"
    :class="{ disabled }"
    @click="!disabled && emit('click')"
  >
    <div class="asset-item-info">
      <span class="asset-item-name">{{ name }}</span>
      <span v-if="desc" class="asset-item-desc">{{ desc }}</span>
    </div>
    <Plus v-if="!disabled" class="asset-item-add" />
  </div>
</template>

<style scoped>
.asset-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.asset-item:hover:not(.disabled) {
  background: rgba(56, 189, 248, 0.08);
}

.asset-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.asset-item-info { flex: 1; min-width: 0; }

.asset-item-name {
  display: block;
  font-size: 13px;
  color: var(--text-primary);
}

.asset-item-desc {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.asset-item-add {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.asset-item:hover:not(.disabled) .asset-item-add {
  color: var(--color-highlight);
}
</style>

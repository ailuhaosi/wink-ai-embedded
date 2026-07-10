<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next';
import { ref } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    icon?: string;
    defaultOpen?: boolean;
    disabled?: boolean;
  }>(),
  { defaultOpen: false, disabled: false },
);

const open = ref(props.defaultOpen && !props.disabled);

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
}
</script>

<template>
  <section class="accordion-section" :class="{ disabled }">
    <button class="accordion-header" :disabled="disabled" @click="toggle">
      <component :is="open ? ChevronDown : ChevronRight" class="chevron" />
      <span class="title">{{ title }}</span>
    </button>
    <div v-show="open && !disabled" class="accordion-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.accordion-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.accordion-section.disabled {
  opacity: 0.45;
}

.accordion-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}

.accordion-header:hover:not(:disabled) {
  color: var(--color-highlight);
}

.chevron { width: 14px; height: 14px; flex-shrink: 0; }

.accordion-body {
  padding: 4px 8px 10px;
}
</style>

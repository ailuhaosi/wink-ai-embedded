<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const error = ref<Error | null>(null);

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err : new Error(String(err));
  console.error('[ErrorBoundary]', err);
  return false;
});

function retry() {
  error.value = null;
}
</script>

<template>
  <div class="error-boundary">
    <slot v-if="!error" />
    <div v-else class="error-boundary__fallback" role="alert">
      <p class="error-boundary__title">{{ t('workbench.error.boundaryTitle') }}</p>
      <p class="error-boundary__message">{{ error.message }}</p>
      <button type="button" class="error-boundary__retry" @click="retry">
        {{ t('workbench.error.retry') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.error-boundary {
  display: contents;
}

.error-boundary__fallback {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  padding: 16px;
  margin: 8px;
  border: 1px solid #c45c5c;
  background: #2a1818;
  color: #f0d0d0;
}

.error-boundary__title {
  margin: 0;
  font-weight: 600;
}

.error-boundary__message {
  margin: 0;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  opacity: 0.9;
  word-break: break-word;
}

.error-boundary__retry {
  padding: 6px 12px;
  border: 1px solid #c45c5c;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.error-boundary__retry:hover {
  background: #3a2020;
}
</style>

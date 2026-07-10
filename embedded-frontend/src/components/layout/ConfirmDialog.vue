<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const { t } = useI18n();
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="confirm-overlay" @click.self="emit('cancel')">
      <div class="confirm-dialog">
        <h3>{{ t('workbench.confirm.stopSimulationTitle') }}</h3>
        <p>{{ t('workbench.confirm.stopSimulationBody') }}</p>
        <div class="confirm-actions">
          <button class="btn btn-primary" @click="emit('cancel')">{{ t('workbench.confirm.cancel') }}</button>
          <button class="btn btn-danger" @click="emit('confirm')">{{ t('workbench.confirm.stopAndReturn') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.confirm-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
}

.confirm-dialog h3 {
  margin: 0 0 12px;
  font-size: 16px;
}

.confirm-dialog p {
  margin: 0 0 20px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.btn-danger {
  background: rgba(255, 74, 90, 0.2);
  color: var(--color-danger);
  border-color: rgba(255, 74, 90, 0.4);
}
</style>

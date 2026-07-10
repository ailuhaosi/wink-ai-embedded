<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const emit = defineEmits<{
  loadTemplate: [id: string];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="world-placeholder">
    <div class="placeholder-card">
      <div class="placeholder-icon">🌐</div>
      <h3>{{ t('workbench.world.title') }}</h3>
      <p>{{ t('workbench.world.subtitle') }}</p>
      <div class="quick-actions">
        <button @click="emit('loadTemplate', 'tpl_oled_dashboard')">
          📟 {{ t('workbench.world.templateOledDashboard') }}
        </button>
        <button @click="emit('loadTemplate', 'tpl_avoidance_car')">
          🚗 {{ t('workbench.world.templateAvoidance') }}
        </button>
        <button @click="emit('loadTemplate', 'tpl_temp_alarm')">
          🌡️ {{ t('workbench.world.templateTempAlarm') }}
        </button>
      </div>
      <p class="hint">{{ t('workbench.world.hint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.world-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, rgba(56, 189, 248, 0.06) 0%, transparent 70%);
  padding: 24px;
}

.placeholder-card {
  text-align: center;
  max-width: 360px;
}

.placeholder-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.placeholder-card h3 {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--text-primary);
}

.placeholder-card p {
  margin: 0 0 16px;
  color: var(--text-secondary);
  font-size: 14px;
}

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.quick-actions button {
  padding: 10px 16px;
  border: 1px solid rgba(56, 189, 248, 0.3);
  background: rgba(56, 189, 248, 0.08);
  color: var(--text-primary);
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s ease;
}

.quick-actions button:hover {
  background: rgba(56, 189, 248, 0.15);
  border-color: var(--color-highlight);
}

.hint {
  font-size: 12px !important;
  color: var(--text-muted) !important;
}
</style>

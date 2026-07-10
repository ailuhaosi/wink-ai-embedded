<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { isOnboardingCompleted, markOnboardingCompleted } from '@/composables/useOnboarding';

const emit = defineEmits<{ complete: []; skip: [] }>();
const { t } = useI18n();

const visible = ref(false);
const step = ref(1);

onMounted(() => {
  if (!isOnboardingCompleted()) {
    visible.value = true;
  }
});

function next() {
  if (step.value < 3) {
    step.value += 1;
  } else {
    finish();
  }
}

function skip() {
  markOnboardingCompleted();
  visible.value = false;
  emit('skip');
}

function finish() {
  markOnboardingCompleted();
  visible.value = false;
  emit('complete');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="onboarding-overlay">
      <div class="spotlight-card">
        <div class="step-indicator">Step {{ step }} / 3</div>
        <h3 v-if="step === 1">{{ t('workbench.onboarding.step1Title') }}</h3>
        <h3 v-else-if="step === 2">{{ t('workbench.onboarding.step2Title') }}</h3>
        <h3 v-else>{{ t('workbench.onboarding.step3Title') }}</h3>

        <p v-if="step === 1">{{ t('workbench.onboarding.step1Body') }}</p>
        <p v-else-if="step === 2">{{ t('workbench.onboarding.step2Body') }}</p>
        <p v-else>{{ t('workbench.onboarding.step3Body') }}</p>

        <div class="actions">
          <button class="btn-skip" @click="skip">{{ t('workbench.onboarding.skip') }}</button>
          <button class="btn-next" @click="next">
            {{ step < 3 ? t('workbench.onboarding.next') : t('workbench.onboarding.done') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
}

.spotlight-card {
  background: var(--bg-secondary);
  border: 1px solid var(--color-highlight);
  border-radius: 16px;
  padding: 32px;
  max-width: 440px;
  box-shadow: 0 0 40px rgba(56, 189, 248, 0.2);
}

.step-indicator {
  font-size: 12px;
  color: var(--color-highlight);
  margin-bottom: 12px;
}

.spotlight-card h3 {
  margin: 0 0 12px;
  font-size: 20px;
}

.spotlight-card p {
  margin: 0 0 24px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-skip {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.btn-next {
  padding: 8px 20px;
  border: none;
  background: var(--color-highlight);
  color: #fff;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}
</style>

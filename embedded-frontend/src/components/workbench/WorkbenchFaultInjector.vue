<script setup lang="ts">
import type { SimFaultsConfig } from '@/types/sim-worker-protocol';

defineProps<{
  faults: SimFaultsConfig;
  wireBroken: boolean;
}>();

const emit = defineEmits<{
  'update:faults': [value: SimFaultsConfig];
  'update:wireBroken': [value: boolean];
  'inject': [];
  'toggle-wire-break': [];
}>();

function onFaultInput<K extends keyof SimFaultsConfig>(
  faults: SimFaultsConfig,
  key: K,
  event: Event,
) {
  const value = Number((event.target as HTMLInputElement).value);
  emit('update:faults', { ...faults, [key]: value });
  emit('inject');
}

function onWireBreakChange(event: Event) {
  emit('update:wireBroken', (event.target as HTMLInputElement).checked);
  emit('toggle-wire-break');
}
</script>

<template>
  <div class="inspector-section fault-section">
    <div class="section-title text-danger">
      Fault Injector
    </div>
    <div class="property-form">
      <div class="form-group">
        <div class="slider-label">
          <span>Debounce Window (bounce_us):</span>
          <span class="val">{{ faults.bounce_us }} us</span>
        </div>
        <input
          type="range"
          min="0"
          max="5000"
          step="50"
          class="slider"
          :value="faults.bounce_us"
          @input="onFaultInput(faults, 'bounce_us', $event)"
        >
      </div>
      <div class="form-group">
        <div class="slider-label">
          <span>Warm-up Period (warmup_us):</span>
          <span class="val">{{ faults.warmup_us }} us</span>
        </div>
        <input
          type="range"
          min="0"
          max="10000"
          step="100"
          class="slider"
          :value="faults.warmup_us"
          @input="onFaultInput(faults, 'warmup_us', $event)"
        >
      </div>
      <div class="form-group">
        <div class="slider-label">
          <span>ADC Sample Interval (us):</span>
          <span class="val">{{ faults.sample_interval_us }} us</span>
        </div>
        <input
          type="range"
          min="0"
          max="5000"
          step="50"
          class="slider"
          :value="faults.sample_interval_us"
          @input="onFaultInput(faults, 'sample_interval_us', $event)"
        >
      </div>
      <div class="form-group">
        <div class="slider-label">
          <span>ADC Noise (adc_noise_v):</span>
          <span class="val">{{ faults.adc_noise_v.toFixed(3) }} V</span>
        </div>
        <input
          type="range"
          min="0"
          max="1.0"
          step="0.05"
          class="slider"
          :value="faults.adc_noise_v"
          @input="onFaultInput(faults, 'adc_noise_v', $event)"
        >
      </div>
      <div class="form-group">
        <div class="slider-label">
          <span>RC Time Constant (rc_tau_s):</span>
          <span class="val">{{ faults.rc_tau_s.toFixed(3) }} s</span>
        </div>
        <input
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          class="slider"
          :value="faults.rc_tau_s"
          @input="onFaultInput(faults, 'rc_tau_s', $event)"
        >
      </div>
      <div class="form-group">
        <div class="slider-label">
          <span>I2C Drop Rate:</span>
          <span class="val">{{ (faults.i2c_drop_permil / 10).toFixed(1) }} %</span>
        </div>
        <input
          type="range"
          min="0"
          max="1000"
          step="10"
          class="slider"
          :value="faults.i2c_drop_permil"
          @input="onFaultInput(faults, 'i2c_drop_permil', $event)"
        >
      </div>
      <div class="form-group checkbox-group danger-checkbox">
        <input
          id="breakWire"
          type="checkbox"
          :checked="wireBroken"
          @change="onWireBreakChange"
        >
        <label for="breakWire">Cut Output Signal Wire (Hi-Z)</label>
      </div>
    </div>
  </div>
</template>

<style src="./workbench-inspector.css"></style>

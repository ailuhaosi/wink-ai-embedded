<template>
  <div class="virtual-oled">
    <div class="component-label">SSD1306 (SDA:{{ sdaPin }}, SCL:{{ sclPin }})</div>
    <div class="oled-wrapper">
      <wokwi-ssd1306 ref="oledRef" />
    </div>
  </div>
</template>

<script setup lang="ts">
import '@wokwi/elements';
import { ref, computed, watch } from 'vue';

import type { PinConnectionValue } from '../types/peripheral-pins';

const props = defineProps<{
  pinConnections: Record<string, PinConnectionValue>;
  framebuffer: Uint8Array | null;
}>();

const oledRef = ref<any>(null);

const sdaPin = computed(() => {
  const pin = props.pinConnections.DATA;
  return typeof pin === 'number' ? pin : 'N/A';
});

const sclPin = computed(() => {
  const pin = props.pinConnections.CLK;
  return typeof pin === 'number' ? pin : 'N/A';
});

watch(() => props.framebuffer, (newFb) => {
  if (!oledRef.value) return;
  const el = oledRef.value;
  
  let imgData = el.imageData;
  if (!imgData || imgData.width !== 128 || imgData.height !== 64) {
    try {
      imgData = new ImageData(128, 64);
    } catch {
      return;
    }
  }
  
  const px = imgData.data;
  
  if (newFb && newFb.length === 1024) {
    for (let page = 0; page < 8; page++) {
      for (let col = 0; col < 128; col++) {
        const byte = newFb[page * 128 + col];
        for (let bit = 0; bit < 8; bit++) {
          const row = page * 8 + bit;
          const lit = (byte >> bit) & 1;
          const idx = (row * 128 + col) * 4;
          
          px[idx]     = lit ? 0   : 8;
          px[idx + 1] = lit ? 210 : 12;
          px[idx + 2] = lit ? 255 : 24;
          px[idx + 3] = 255;
        }
      }
    }
  } else {
    px.fill(0);
    for (let i = 3; i < px.length; i += 4) {
      px[i] = 255;
    }
  }
  
  el.imageData = imgData;
  if (typeof el.redraw === 'function') {
    el.redraw();
  }
}, { immediate: true });
</script>

<style scoped>
.virtual-oled {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  transition: border-color 0.2s;
  width: fit-content;
}
.virtual-oled:hover {
  border-color: rgba(0, 255, 136, 0.3);
}
.component-label {
  font-size: 11px;
  color: #8fa0a8;
  margin-bottom: 8px;
  font-weight: 500;
}
.oled-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  background: #050b11;
  border: 4px solid #1a2530;
  border-radius: 6px;
  padding: 4px;
}
</style>
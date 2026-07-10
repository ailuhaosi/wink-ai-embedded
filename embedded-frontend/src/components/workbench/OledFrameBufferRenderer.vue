<script setup lang="ts">
import { watch } from 'vue';
import {
  OLED_WIDTH,
  OLED_HEIGHT,
  OLED_FB_BYTES,
  OLED_PAGE_COUNT,
} from '@/constants/oled';

interface OledElementLike {
  tagName?: string;
  imageData?: ImageData;
  redraw?: () => void;
}

const props = defineProps<{
  framebuffer: Uint8Array | null;
  /** CircuitCanvas exposed canvasOledRef (element or array). */
  canvasOledRef: OledElementLike | OledElementLike[] | null | undefined;
}>();

function resolveOledElement(
  canvasOled: OledElementLike | OledElementLike[] | null | undefined,
): OledElementLike | undefined {
  if (!canvasOled)
    return undefined;
  if (Array.isArray(canvasOled)) {
    return canvasOled.find(el => el && el.tagName === 'WOKWI-SSD1306');
  }
  return canvasOled;
}

function paintFramebuffer(oledEl: OledElementLike, newFb: Uint8Array | null) {
  let imgData = oledEl.imageData;
  if (!imgData || imgData.width !== OLED_WIDTH || imgData.height !== OLED_HEIGHT) {
    try {
      imgData = new ImageData(OLED_WIDTH, OLED_HEIGHT);
    }
    catch {
      return;
    }
  }

  const px = imgData.data;
  if (newFb && newFb.length === OLED_FB_BYTES) {
    for (let page = 0; page < OLED_PAGE_COUNT; page++) {
      for (let col = 0; col < OLED_WIDTH; col++) {
        const byte = newFb[page * OLED_WIDTH + col];
        for (let bit = 0; bit < 8; bit++) {
          const row = page * 8 + bit;
          const lit = (byte >> bit) & 1;
          const idx = (row * OLED_WIDTH + col) * 4;

          px[idx] = lit ? 0 : 8;
          px[idx + 1] = lit ? 210 : 12;
          px[idx + 2] = lit ? 255 : 24;
          px[idx + 3] = 255;
        }
      }
    }
  }
  else {
    px.fill(0);
    for (let i = 3; i < px.length; i += 4) {
      px[i] = 255;
    }
  }

  oledEl.imageData = imgData;
  if (typeof oledEl.redraw === 'function') {
    oledEl.redraw();
  }
}

watch(
  () => [props.framebuffer, props.canvasOledRef] as const,
  ([newFb, canvasOled]) => {
    const oledEl = resolveOledElement(canvasOled);
    if (!oledEl)
      return;
    paintFramebuffer(oledEl, newFb);
  },
);
</script>

<template>
  <span class="oled-fb-renderer" hidden aria-hidden="true" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    direction?: 'horizontal' | 'vertical';
    ratio: number;
    minSizePx?: number;
    storageKey?: string;
    animate?: boolean;
  }>(),
  {
    direction: 'horizontal',
    minSizePx: 280,
    animate: false,
  },
);

const emit = defineEmits<{
  ratioChange: [ratio: number];
  collapse: [side: 'left' | 'right'];
}>();

const containerRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const fullscreenSide = ref<'left' | 'right' | null>(null);
const dragRatio = ref(props.ratio);
const showTooltip = ref(false);

const isHorizontal = computed(() => props.direction === 'horizontal');

watch(
  () => props.ratio,
  (value) => {
    if (!dragging.value) dragRatio.value = value;
  },
);

const displayRatio = computed(() => {
  if (fullscreenSide.value === 'left') return 1;
  if (fullscreenSide.value === 'right') return 0;
  if (leftCollapsed.value) return 0;
  if (rightCollapsed.value) return 1;
  return dragRatio.value;
});

const leftPercent = computed(() => `${(displayRatio.value * 100).toFixed(1)}%`);
const rightPercent = computed(() => `${((1 - displayRatio.value) * 100).toFixed(1)}%`);

const tooltipText = computed(() => {
  const left = Math.round(displayRatio.value * 100);
  return `${left} : ${100 - left}`;
});

function getContainerSize(): number {
  const el = containerRef.value;
  if (!el) return 0;
  return isHorizontal.value ? el.clientWidth : el.clientHeight;
}

function clampRatio(next: number): number {
  const size = getContainerSize();
  if (size <= 0) return next;
  const minRatio = props.minSizePx / size;
  const maxRatio = 1 - minRatio;
  if (minRatio >= maxRatio) return 0.5;
  return Math.min(maxRatio, Math.max(minRatio, next));
}

function onPointerDown(event: PointerEvent) {
  if (leftCollapsed.value || rightCollapsed.value || fullscreenSide.value) return;
  dragging.value = true;
  showTooltip.value = true;
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value || !containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const raw = isHorizontal.value
    ? (event.clientX - rect.left) / rect.width
    : (event.clientY - rect.top) / rect.height;
  const next = clampRatio(raw);
  dragRatio.value = next;
  emit('ratioChange', next);
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  showTooltip.value = false;
  (event.target as HTMLElement).releasePointerCapture(event.pointerId);

  const size = getContainerSize();
  const minRatio = size > 0 ? props.minSizePx / size : 0.1;
  if (dragRatio.value <= minRatio + 0.01) {
    leftCollapsed.value = true;
    emit('collapse', 'left');
  } else if (dragRatio.value >= 1 - minRatio - 0.01) {
    rightCollapsed.value = true;
    emit('collapse', 'right');
  }
}

function onDividerDblClick() {
  if (fullscreenSide.value) {
    fullscreenSide.value = null;
    return;
  }
  fullscreenSide.value = displayRatio.value >= 0.5 ? 'left' : 'right';
}

function expandCollapsed(side: 'left' | 'right') {
  if (side === 'left') leftCollapsed.value = false;
  if (side === 'right') rightCollapsed.value = false;
  fullscreenSide.value = null;
}
</script>

<template>
  <div
    ref="containerRef"
    class="split-pane"
    :class="[
      `split-pane--${direction}`,
      { 'split-pane--dragging': dragging, 'split-pane--animate': animate && !dragging },
    ]"
  >
    <div class="split-pane__pane split-pane__pane--primary" :style="isHorizontal ? { width: leftPercent } : { height: leftPercent }">
      <button v-if="leftCollapsed" class="split-pane__expand" @click="expandCollapsed('left')">›</button>
      <slot v-else name="primary" />
    </div>

    <div
      v-if="!leftCollapsed && !rightCollapsed"
      class="split-pane__divider"
      :class="{ 'split-pane__divider--active': dragging }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @dblclick="onDividerDblClick"
    >
      <span v-if="showTooltip" class="split-pane__tooltip">{{ tooltipText }}</span>
    </div>

    <div class="split-pane__pane split-pane__pane--secondary" :style="isHorizontal ? { width: rightPercent } : { height: rightPercent }">
      <button v-if="rightCollapsed" class="split-pane__expand split-pane__expand--right" @click="expandCollapsed('right')">‹</button>
      <slot v-else name="secondary" />
    </div>

    <div v-if="dragging" class="split-pane__overlay" />
  </div>
</template>

<style scoped>
.split-pane {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
}

.split-pane--horizontal {
  flex-direction: row;
}

.split-pane--vertical {
  flex-direction: column;
}

.split-pane__pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.split-pane--animate .split-pane__pane {
  transition: width 300ms ease-out, height 300ms ease-out;
}

.split-pane__divider {
  flex: 0 0 6px;
  background: rgba(148, 163, 184, 0.2);
  cursor: col-resize;
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.split-pane--vertical .split-pane__divider {
  cursor: row-resize;
  width: 100%;
  height: 6px;
}

.split-pane__divider:hover,
.split-pane__divider--active {
  background: rgba(59, 130, 246, 0.5);
  flex-basis: 10px;
}

.split-pane__divider--active {
  background: #3b82f6;
}

.split-pane__tooltip {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(15, 23, 42, 0.95);
  color: #f8fafc;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
}

.split-pane__overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: col-resize;
}

.split-pane--vertical .split-pane__overlay {
  cursor: row-resize;
}

.split-pane__expand {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  right: 0;
  width: 20px;
  height: 48px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(15, 23, 42, 0.9);
  color: #94a3b8;
  cursor: pointer;
  border-radius: 4px 0 0 4px;
  z-index: 3;
}

.split-pane__expand--right {
  left: 0;
  right: auto;
  border-radius: 0 4px 4px 0;
}
</style>

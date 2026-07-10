<script setup lang="ts">
import { computed, onMounted, onUnmounted, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { RotateCcw, RotateCw } from 'lucide-vue-next';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { useCircuitCanvas } from '@/composables/useCircuitCanvas';
import CanvasPeripheralsHost from '@/components/peripherals/CanvasPeripheralsHost.vue';

const props = defineProps<{
  pinStates: Record<number, boolean>;
  readonly: boolean;
}>();
const emit = defineEmits<{
  buttonPress: [comp: CircuitComponentInstance];
  buttonRelease: [comp: CircuitComponentInstance];
  layoutChange: [];
}>();
const components = defineModel<CircuitComponentInstance[]>('components', { required: true });
const selectedComponentId = defineModel<string>('selectedComponentId', { required: true });

const { t } = useI18n();

const readonlyRef = computed(() => props.readonly);
const pinStatesRef = toRef(props, 'pinStates');

const {
  canvasContainerRef,
  circuitSvgRef,
  viewWidth,
  viewHeight,
  peripheralScaleX,
  peripheralScaleY,
  boardPosition,
  isDraggingBoard,
  commonPowerNodes,
  draggedPowerNodeId,
  draggedCompId,
  isComponentDragging,
  wiresToRender,
  routingChannels,
  routingDebugOverlay,
  powerBusVisual,
  syncPowerBusLayout,
  updateCanvasScale,
  assignLayoutForNewComponent,
  removeLayoutForComponent,
  getLayoutPositions,
  setLayoutPositions,
  selectComponent,
  setRotation,
  rotateComponent,
  handlePowerNodeClick,
  startDragBoard,
  onPeripheralMouseDown,
  getCanvasX,
  getCanvasY,
  getComponentSize,
  getWireVisual,
} = useCircuitCanvas({
  components,
  selectedComponentId,
  pinStates: pinStatesRef,
  readonly: readonlyRef,
  onLayoutChange: () => emit('layoutChange'),
});

let canvasResizeObserver: ResizeObserver | null = null;

onMounted(() => {
  syncPowerBusLayout(true);
  requestAnimationFrame(() => {
    updateCanvasScale();
    const container = canvasContainerRef.value;
    if (container && typeof ResizeObserver !== 'undefined') {
      canvasResizeObserver = new ResizeObserver(() => {
        updateCanvasScale();
      });
      canvasResizeObserver.observe(container);
    }
  });
});

onUnmounted(() => {
  canvasResizeObserver?.disconnect();
  canvasResizeObserver = null;
});

defineExpose({
  updateCanvasScale,
  setRotation,
  rotateComponent,
  selectComponent,
  assignLayoutForNewComponent,
  removeLayoutForComponent,
  getLayoutPositions,
  setLayoutPositions,
});
</script>

<template>
  <div ref="canvasContainerRef" class="canvas-container">
    <svg ref="circuitSvgRef" class="circuit-svg" width="100%" height="100%" :viewBox="`0 0 ${viewWidth} ${viewHeight}`" preserveAspectRatio="none">
      <!-- Grid background -->
      <defs>
        <pattern id="grid" :width="20" :height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1" />
        </pattern>
        <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect :width="viewWidth" :height="viewHeight" fill="url(#grid)" />

      <!-- Power rail (horizontal, above board — breadboard / schematic convention) -->
      <line
        :x1="powerBusVisual.x1"
        :y1="powerBusVisual.y"
        :x2="powerBusVisual.x2"
        :y2="powerBusVisual.y"
        stroke="rgba(100, 116, 139, 0.22)"
        stroke-width="8"
        stroke-linecap="round"
      />
      <text
        :x="powerBusVisual.x1 - 8"
        :y="powerBusVisual.y - 14"
        fill="rgba(148, 163, 184, 0.45)"
        font-size="8"
        font-family="monospace"
        text-anchor="end"
      >PWR</text>
      <line
        :x1="routingChannels.leftBus"
        :y1="routingChannels.topBus"
        :x2="routingChannels.leftBus"
        :y2="routingChannels.bottomBus"
        stroke="rgba(56, 189, 248, 0.08)"
        stroke-width="4"
        stroke-linecap="round"
      />
      <line
        :x1="routingChannels.rightBus"
        :y1="routingChannels.topBus"
        :x2="routingChannels.rightBus"
        :y2="routingChannels.bottomBus"
        stroke="rgba(56, 189, 248, 0.08)"
        stroke-width="4"
        stroke-linecap="round"
      />

      <!-- ESP32 Board Node -->
      <g
        :transform="`translate(${boardPosition.x}, ${boardPosition.y})`"
        class="board-node board-draggable"
        :class="{ 'board-dragging': isDraggingBoard }"
        style="pointer-events: all;"
        @mousedown="startDragBoard($event)"
      >
        <!-- Outer board shadow and body -->
        <rect x="0" y="0" width="180" height="200" rx="10" fill="#1e293b" stroke="#334155" stroke-width="2" />
        <rect x="15" y="-10" width="150" height="25" rx="3" fill="#0f172a" />
        <text x="90" y="8" fill="#64748b" font-size="9" text-anchor="middle" font-weight="bold">USB-C INTERFACE</text>

        <!-- MCU Chip -->
        <rect x="40" y="50" width="100" height="90" rx="6" fill="#0f172a" stroke="#475569" stroke-width="2" />
        <text x="90" y="90" fill="#38bdf8" font-size="14" text-anchor="middle" font-weight="bold" letter-spacing="1">ESP32-S3</text>
        <text x="90" y="110" fill="#475569" font-size="9" text-anchor="middle" class="font-mono">Wink-MicroOS</text>

        <!-- Pin Headers Left -->
        <g transform="translate(5, 20)">
          <text x="10" y="15" fill="#94a3b8" font-size="8" font-family="monospace">IO12</text>
          <circle cx="2" cy="12" r="3.5" fill="#475569" />

          <text x="10" y="45" fill="#94a3b8" font-size="8" font-family="monospace">IO13</text>
          <circle cx="2" cy="42" r="3.5" fill="#475569" />

          <text x="10" y="75" fill="#94a3b8" font-size="8" font-family="monospace">IO14</text>
          <circle cx="2" cy="72" r="3.5" fill="#475569" />

          <text x="10" y="105" fill="#94a3b8" font-size="8" font-family="monospace">GND</text>
          <circle cx="2" cy="102" r="3.5" fill="#64748b" />
        </g>

        <!-- Pin Headers Right -->
        <g transform="translate(175, 20)">
          <text x="-32" y="15" fill="#94a3b8" font-size="8" font-family="monospace">IO21 (SDA)</text>
          <circle cx="2" cy="12" r="3.5" fill="#475569" />

          <text x="-32" y="45" fill="#94a3b8" font-size="8" font-family="monospace">IO22 (SCL)</text>
          <circle cx="2" cy="42" r="3.5" fill="#475569" />

          <text x="-32" y="75" fill="#94a3b8" font-size="8" font-family="monospace">3V3</text>
          <circle cx="2" cy="72" r="3.5" fill="#64748b" />
        </g>
      </g>

      <!-- HCTR debug overlay (?routing_debug=true) -->
      <g v-if="routingDebugOverlay" class="routing-debug-overlay" pointer-events="none">
        <line
          v-for="(track, idx) in routingDebugOverlay.verticalTracks"
          :key="`dbg-v-${idx}`"
          :x1="track.x1"
          :y1="track.y1"
          :x2="track.x2"
          :y2="track.y2"
          :stroke="track.stroke"
          stroke-width="1"
          stroke-dasharray="4,4"
          opacity="0.75"
        />
        <line
          v-for="(track, idx) in routingDebugOverlay.horizontalTracks"
          :key="`dbg-h-${idx}`"
          :x1="track.x1"
          :y1="track.y1"
          :x2="track.x2"
          :y2="track.y2"
          stroke="#f87171"
          stroke-width="1"
          stroke-dasharray="6,3"
          opacity="0.75"
        />
        <rect
          v-for="(seg, idx) in routingDebugOverlay.occupiedRects"
          :key="`dbg-occ-${idx}`"
          :x="seg.x"
          :y="seg.y"
          :width="seg.width"
          :height="seg.height"
          fill="rgba(250, 204, 21, 0.22)"
          stroke="rgba(250, 204, 21, 0.45)"
          stroke-width="0.5"
        />
        <text
          v-for="(label, idx) in routingDebugOverlay.labels"
          :key="`dbg-lbl-${idx}`"
          :x="label.x"
          :y="label.y"
          fill="#a5f3fc"
          font-size="7"
          font-family="monospace"
        >{{ label.wireId }} ({{ label.topology }})</text>
      </g>

      <!-- Connection Wires -->
      <g
        v-for="wire in wiresToRender"
        :key="wire.id"
        class="smart-wire-group"
        :class="{
          'highlighted-wire': getWireVisual(wire).highlighted,
          'dimmed-wire': getWireVisual(wire).dimmed,
          'power-wire': wire.signalType === 'power',
          'i2c-wire': wire.signalType === 'i2c',
        }"
      >
        <g v-for="(seg, idx) in wire.segments" :key="`seg-${idx}`">
          <path
            v-if="getWireVisual(wire).highlighted"
            :d="seg.d"
            fill="none"
            :stroke="seg.layer === 0 ? wire.color : '#3b82f6'"
            :stroke-width="wire.width + getWireVisual(wire).widthBoost + 3"
            :stroke-opacity="getWireVisual(wire).opacity * (seg.layer === 0 ? 0.2 : 0.1)"
            :stroke-dasharray="seg.layer === 1 ? '6,4' : undefined"
            stroke-linecap="round"
            stroke-linejoin="round"
            filter="url(#neon-glow)"
          />
          <path
            :d="seg.d"
            fill="none"
            stroke="#080c14"
            :stroke-width="wire.width + getWireVisual(wire).widthBoost + (wire.signalType === 'power' ? 1.5 : 1)"
            :stroke-opacity="getWireVisual(wire).opacity"
            stroke-linecap="round"
            stroke-linejoin="round"
            :stroke-dasharray="seg.layer === 1 ? '6,4' : undefined"
          />
          <path
            :d="seg.d"
            fill="none"
            :stroke="seg.layer === 0 ? wire.color : '#6366f1'"
            :stroke-width="wire.width + getWireVisual(wire).widthBoost"
            :stroke-opacity="getWireVisual(wire).opacity"
            stroke-linecap="round"
            stroke-linejoin="round"
            :stroke-dasharray="seg.layer === 1 ? '6,4' : (wire.signalType === 'i2c' ? '4,3' : undefined)"
          />
        </g>

        <circle :cx="wire.start.x" :cy="wire.start.y" :r="wire.width + getWireVisual(wire).widthBoost + 1.2" :fill="wire.color" :fill-opacity="getWireVisual(wire).opacity" stroke="#080c14" stroke-width="1.2" />
        <circle :cx="wire.end.x" :cy="wire.end.y" :r="wire.width + getWireVisual(wire).widthBoost + 1.2" :fill="wire.color" :fill-opacity="getWireVisual(wire).opacity" stroke="#080c14" stroke-width="1.2" />
      </g>
    </svg>

    <!-- Common Power Nodes -->
    <svg class="power-nodes-layer" pointer-events="none">
      <g v-for="(node, powerType) in commonPowerNodes" :key="node.id">
        <circle
          :cx="node.x"
          :cy="node.y"
          r="18"
          :fill="node.color"
          stroke="#080c14"
          stroke-width="2"
          style="cursor: move; pointer-events: all;"
          :class="{ dragging: draggedPowerNodeId === powerType }"
          @mousedown="handlePowerNodeClick($event, powerType)"
        />
        <circle
          :cx="node.x"
          :cy="node.y"
          r="12"
          fill="#1e293b"
          stroke="#080c14"
          stroke-width="1.5"
        />
        <text
          :x="node.x"
          :y="node.y + 4"
          fill="white"
          font-size="9"
          font-weight="bold"
          font-family="monospace"
          text-anchor="middle"
          dominant-baseline="middle"
          style="pointer-events: none;"
        >{{ node.label }}</text>
        <circle
          :cx="node.x"
          :cy="node.y"
          r="22"
          fill="transparent"
          stroke="transparent"
          stroke-width="10"
          style="cursor: move; pointer-events: all;"
          @mousedown="handlePowerNodeClick($event, powerType)"
        />
      </g>
    </svg>

    <!-- Real-time Interactive Peripherals Positioned on Canvas -->
    <div class="peripherals-layer" :style="{ transform: `scale(${peripheralScaleX}, ${peripheralScaleY})`, transformOrigin: 'top left', width: `${viewWidth}px`, height: `${viewHeight}px` }">
      <div
        v-for="comp in components"
        :key="`canvas-comp-${comp.id}`"
        :style="{
          'position': 'absolute',
          'left': `${getCanvasX(comp)}px`,
          'top': `${getCanvasY(comp)}px`,
          '--rot': `${comp.rotation || 0}deg`,
          'transformOrigin': `${getComponentSize(comp.type).width / 2}px ${getComponentSize(comp.type).height / 2}px`,
          'zIndex': 10,
        }"
        class="canvas-peripheral-wrapper"
        :class="{ 'selected-peripheral': selectedComponentId === comp.id, 'dragging': draggedCompId === comp.id && isComponentDragging }"
        @mousedown.capture="onPeripheralMouseDown($event, comp)"
      >
        <!-- Rotation toolbar (visible when selected) -->
        <div v-if="selectedComponentId === comp.id" class="rotation-toolbar" @mousedown.stop>
          <button class="rot-btn" :title="t('workbench.canvas.rotateCcw')" @click.stop="rotateComponent(comp, -90)">
            <RotateCcw class="rot-icon" />
          </button>
          <button class="rot-btn" :title="t('workbench.canvas.rotateCw')" @click.stop="rotateComponent(comp, 90)">
            <RotateCw class="rot-icon" />
          </button>
        </div>
        <CanvasPeripheralsHost
          :comp="comp"
          :pin-states="pinStates"
          @button-press="emit('buttonPress', comp)"
          @button-release="emit('buttonRelease', comp)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.board-draggable {
  cursor: grab;
  transition: filter 0.15s ease;
}
.board-draggable:hover {
  filter: brightness(1.08) drop-shadow(0 0 6px rgba(56, 189, 248, 0.35));
}
.board-dragging {
  cursor: grabbing;
  filter: brightness(1.12) drop-shadow(0 0 10px rgba(56, 189, 248, 0.55));
}
.canvas-peripheral-wrapper {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  cursor: pointer;
  border-radius: 8px;
  transform: rotate(var(--rot, 0deg));
  transform-origin: center center;
}
.canvas-peripheral-wrapper:hover {
  transform: rotate(var(--rot, 0deg)) scale(1.03) translateY(-2px);
  box-shadow: 0 8px 16px rgba(56, 189, 248, 0.25);
  filter: brightness(1.1);
}
.selected-peripheral {
  outline: 2px solid var(--color-highlight);
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.4);
}
.dragging {
  cursor: grabbing;
  transform: rotate(var(--rot, 0deg)) scale(1.05);
  box-shadow: 0 12px 24px rgba(56, 189, 248, 0.35);
  z-index: 100 !important;
}
.rotation-toolbar {
  position: absolute;
  top: -40px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 6px;
  transform: rotate(calc(-1 * var(--rot, 0deg)));
  transform-origin: center center;
  z-index: 20;
}
.rot-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(56, 189, 248, 0.4);
  background: rgba(15, 23, 42, 0.92);
  color: #38bdf8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  backdrop-filter: blur(4px);
}
.rot-btn:hover {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.8);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.4);
}
.rot-icon {
  width: 16px;
  height: 16px;
}

.waypoint-handle {
  transition: transform 0.15s ease, r 0.15s ease, fill 0.15s ease;
  cursor: grab;
}
.waypoint-handle:hover {
  r: 8px;
  fill: #fbbf24;
  filter: drop-shadow(0 0 4px #fbbf24);
}
.waypoint-handle:active {
  cursor: grabbing;
}

.smart-wire-group {
  transition: filter 0.15s ease;
}

.smart-wire-group.inactive-wire {
  pointer-events: none;
}

.smart-wire-group.dimmed-wire path,
.smart-wire-group.dimmed-wire circle {
  transition: stroke-opacity 0.15s ease, fill-opacity 0.15s ease;
}

.smart-wire-group.highlighted-wire {
  filter: drop-shadow(0 0 3px currentColor) drop-shadow(0 0 8px rgba(56, 189, 248, 0.45));
}

.smart-wire-group.power-wire path[stroke]:not([stroke="transparent"]) {
  stroke-linecap: round;
}

.canvas-container {
  width: 100%;
  height: 100%;
  position: relative;
}
.circuit-svg {
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 5;
}
.power-nodes-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 20;
}
.power-nodes-layer circle.dragging {
  filter: brightness(1.3);
  stroke-width: 3;
}
.peripherals-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 30;
}
.peripherals-layer > .canvas-peripheral-wrapper {
  pointer-events: auto;
}
</style>

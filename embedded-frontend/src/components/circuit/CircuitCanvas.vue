<template>
  <div class="canvas-container" ref="canvasContainerRef">
    <svg class="circuit-svg" width="100%" height="100%" :viewBox="`0 0 ${viewWidth} ${viewHeight}`" preserveAspectRatio="none" @click="handleCanvasClick">
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
      <g :transform="`translate(${boardPosition.x}, ${boardPosition.y})`" class="board-node board-draggable" :class="{ 'board-dragging': isDraggingBoard }" @mousedown="startDragBoard($event)">
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
          :key="'dbg-v-' + idx"
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
          :key="'dbg-h-' + idx"
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
          :key="'dbg-occ-' + idx"
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
          :key="'dbg-lbl-' + idx"
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
          'selected-wire': selectedWireId === wire.id,
          'inactive-wire': !wire.isActive,
          'highlighted-wire': getWireVisual(wire).highlighted,
          'dimmed-wire': getWireVisual(wire).dimmed,
          'power-wire': wire.signalType === 'power',
          'i2c-wire': wire.signalType === 'i2c',
        }"
      >
        <!-- Teardrops: only when wire is selected or being dragged -->
        <template v-if="selectedWireId === wire.id || wire.isDragged">
          <path
            v-for="(td, idx) in wire.teardrops"
            :key="'td-' + idx"
            :d="td"
            :fill="wire.color"
            opacity="0.8"
          />
        </template>

        <!-- Wire Segments (Top / Bottom Layers) -->
        <g v-for="(seg, idx) in wire.segments" :key="'seg-' + idx">
          <!-- Glow: selected wire, dragged, or highlighted component bundle -->
          <path
            v-if="selectedWireId === wire.id || wire.isDragged || getWireVisual(wire).highlighted"
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
          <!-- Dark outline for crossings -->
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
          <!-- Visible wire segment -->
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
          <!-- Thick transparent path for click strike zone -->
          <path
            :d="seg.d"
            fill="none"
            stroke="transparent"
            stroke-width="12"
            stroke-linecap="round"
            class="wire-click-zone"
            @click="handleWireClick($event, wire.id)"
          />
        </g>

        <!-- Vias: only when selected or dragged -->
        <template v-if="selectedWireId === wire.id || wire.isDragged">
          <g v-for="(via, idx) in wire.vias" :key="'via-' + idx">
            <circle :cx="via.x" :cy="via.y" r="5.5" fill="#e2e8f0" stroke="#d97706" stroke-width="1.2" />
            <circle :cx="via.x" :cy="via.y" r="2.5" fill="#1e293b" />
          </g>
        </template>

        <!-- Start & End connection dots -->
        <circle :cx="wire.start.x" :cy="wire.start.y" :r="wire.width + getWireVisual(wire).widthBoost + 1.2" :fill="wire.color" :fill-opacity="getWireVisual(wire).opacity" stroke="#080c14" stroke-width="1.2" />
        <circle :cx="wire.end.x" :cy="wire.end.y" :r="wire.width + getWireVisual(wire).widthBoost + 1.2" :fill="wire.color" :fill-opacity="getWireVisual(wire).opacity" stroke="#080c14" stroke-width="1.2" />

        <!-- Waypoint draggable handles -->
        <circle
          v-for="(wp, wpIdx) in (wireWaypoints[wire.id] || [])"
          :key="'wp-' + wpIdx"
          :cx="wp.x"
          :cy="wp.y"
          r="5.5"
          fill="#f59e0b"
          stroke="#080c14"
          stroke-width="1.5"
          class="waypoint-handle"
          style="cursor: move;"
          @mousedown="startDragWaypoint(wire.id, wpIdx)"
          @dblclick.stop="removeWaypoint(wire.id, wpIdx)"
        />
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
          @mousedown="handlePowerNodeClick($event, powerType)"
          :class="{ 'dragging': draggedPowerNodeId === powerType }"
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
    <div class="peripherals-layer" :style="{ transform: `scale(${peripheralScaleX}, ${peripheralScaleY})`, transformOrigin: 'top left', width: viewWidth + 'px', height: viewHeight + 'px' }">
      <div
        v-for="comp in components"
        :key="'canvas-comp-' + comp.id"
        :style="{
          position: 'absolute',
          left: `${getCanvasX(comp)}px`,
          top: `${getCanvasY(comp)}px`,
          '--rot': `${comp.rotation || 0}deg`,
          transformOrigin: `${getComponentSize(comp.type).width / 2}px ${getComponentSize(comp.type).height / 2}px`,
          zIndex: 10
        }"
        @mousedown.capture="onPeripheralMouseDown($event, comp)"
        class="canvas-peripheral-wrapper"
        :class="{ 'selected-peripheral': selectedComponentId === comp.id, 'dragging': draggedCompId === comp.id && isComponentDragging }"
      >
        <!-- Rotation toolbar (visible when selected) -->
        <div v-if="selectedComponentId === comp.id" class="rotation-toolbar" @mousedown.stop>
          <button @click.stop="rotateComponent(comp, -90)" class="rot-btn" title="逆时针旋转 90°">
            <RotateCcw class="rot-icon" />
          </button>
          <button @click.stop="rotateComponent(comp, 90)" class="rot-btn" title="顺时针旋转 90°">
            <RotateCw class="rot-icon" />
          </button>
        </div>
        <!-- Raw visual components on the Canvas -->
        <wokwi-led
          v-if="comp.type === 'led'"
          :pin="typeof comp.pinConnections.A === 'number' ? comp.pinConnections.A : 1"
          :color="comp.props.color"
          :value="typeof comp.pinConnections.A === 'number' ? pinStates[comp.pinConnections.A] || false : false"
          :brightness="comp.props.brightness"
          :label="comp.props.label"
          :flip="comp.props.flip"
        />
        <wokwi-pushbutton
          v-else-if="comp.type === 'button'"
          :color="comp.props.color"
          :label="comp.props.label"
          :xray="comp.props.xray"
          @button-press="emit('buttonPress', comp)"
          @button-release="emit('buttonRelease', comp)"
        />
        <wokwi-ssd1306
          v-else-if="comp.type === 'oled'"
          ref="canvasOledRef"
        />
        <wokwi-hc-sr04
          v-else-if="comp.type === 'ultrasonic'"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef } from 'vue';
import { RotateCcw, RotateCw } from 'lucide-vue-next';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { useCircuitCanvas } from '@/composables/useCircuitCanvas';

const components = defineModel<CircuitComponentInstance[]>('components', { required: true });
const selectedComponentId = defineModel<string>('selectedComponentId', { required: true });

const props = defineProps<{
  pinStates: Record<number, boolean>;
  readonly: boolean;
  routingMode: 'auto' | 'manual';
}>();

const emit = defineEmits<{
  buttonPress: [comp: CircuitComponentInstance];
  buttonRelease: [comp: CircuitComponentInstance];
}>();

const readonlyRef = computed(() => props.readonly);
const routingModeRef = computed(() => props.routingMode);
const pinStatesRef = toRef(props, 'pinStates');

const {
  canvasContainerRef,
  canvasOledRef,
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
  wireWaypoints,
  selectedWireId,
  wiresToRender,
  routingChannels,
  routingDebugOverlay,
  powerBusVisual,
  syncPowerBusLayout,
  tidyRouting,
  updateCanvasScale,
  assignLayoutForNewComponent,
  removeLayoutForComponent,
  selectComponent,
  setRotation,
  rotateComponent,
  handlePowerNodeClick,
  handleWireClick,
  handleCanvasClick,
  startDragBoard,
  onPeripheralMouseDown,
  removeWaypoint,
  startDragWaypoint,
  getCanvasX,
  getCanvasY,
  getComponentSize,
  getWireVisual,
} = useCircuitCanvas({
  components,
  selectedComponentId,
  pinStates: pinStatesRef,
  routingMode: routingModeRef,
  readonly: readonlyRef,
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
  tidyRouting,
  updateCanvasScale,
  canvasOledRef,
  setRotation,
  rotateComponent,
  selectComponent,
  assignLayoutForNewComponent,
  removeLayoutForComponent,
});
</script>

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

.smart-wire-group.inactive-wire path,
.smart-wire-group.inactive-wire circle {
  stroke-opacity: 0.15;
  fill-opacity: 0.15;
}

.smart-wire-group.highlighted-wire {
  filter: drop-shadow(0 0 3px currentColor) drop-shadow(0 0 8px rgba(56, 189, 248, 0.45));
}

.smart-wire-group.power-wire path[stroke]:not([stroke="transparent"]) {
  stroke-linecap: round;
}

.smart-wire-group.selected-wire {
  filter: drop-shadow(0 0 4px rgba(56, 189, 248, 1)) drop-shadow(0 0 12px rgba(56, 189, 248, 0.8)) drop-shadow(0 0 20px rgba(56, 189, 248, 0.5));
  animation: wirePulse 1.5s ease-in-out infinite;
}

.smart-wire-group.selected-wire path {
  stroke-width: calc(var(--wire-width, 2) + 2);
}

.wire-click-zone {
  cursor: copy;
}

@keyframes wirePulse {
  0%, 100% {
    filter: drop-shadow(0 0 4px rgba(56, 189, 248, 1)) drop-shadow(0 0 12px rgba(56, 189, 248, 0.8)) drop-shadow(0 0 20px rgba(56, 189, 248, 0.5));
  }
  50% {
    filter: drop-shadow(0 0 6px rgba(56, 189, 248, 1)) drop-shadow(0 0 18px rgba(56, 189, 248, 0.9)) drop-shadow(0 0 30px rgba(56, 189, 248, 0.7));
  }
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
.circuit-svg .wire-click-zone {
  pointer-events: stroke;
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

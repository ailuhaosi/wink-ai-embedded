<template>
  <div class="workbench">
    <!-- Top Control Bar -->
    <header class="top-bar">
      <div class="brand">
        <Cpu class="brand-icon" />
        <span>Wink-AI Simulation Workbench</span>
        <span class="badge font-mono">Phase C</span>
      </div>

      <div class="sim-controls">
        <button 
          @click="toggleSimulation" 
          :disabled="!isInitialized" 
          class="btn" 
          :class="{ 'btn-running': isRunning, 'btn-paused': !isRunning }"
        >
          <Play v-if="!isRunning" class="icon" />
          <Pause v-else class="icon" />
          <span>{{ isRunning ? 'Running' : 'Paused' }}</span>
        </button>

        <button @click="handleReset" :disabled="!isInitialized" class="btn btn-secondary">
          <RotateCcw class="icon" />
          <span>Reset</span>
        </button>

        <div class="control-group">
          <label>Speed:</label>
          <select v-model="simSpeed" @change="updateSpeed" class="select font-mono">
            <option :value="1">1x (1ms/tick)</option>
            <option :value="2">2x</option>
            <option :value="5">5x</option>
            <option :value="10">10x</option>
          </select>
        </div>

        <div class="control-group">
          <label>Wire Style:</label>
          <select v-model="wireStyle" class="select font-mono">
            <option value="pcb">45° PCB Trace</option>
            <option value="curved">Fritzing Curved</option>
            <option value="bus">Bus Strip (Parallel)</option>
          </select>
        </div>
        <div class="control-group">
          <label>Routing Mode:</label>
          <div class="mode-switch">
            <button 
              @click="setRoutingMode('auto')" 
              class="mode-btn" 
              :class="{ active: routingMode === 'auto' }"
            >
              <Zap class="mode-icon" />
              <span>Auto</span>
            </button>
            <button 
              @click="setRoutingMode('manual')" 
              class="mode-btn" 
              :class="{ active: routingMode === 'manual' }"
            >
              <MousePointer2 class="mode-icon" />
              <span>Manual</span>
            </button>
          </div>
        </div>

        <div class="control-group">
          <label>Time:</label>
          <span class="time-display font-mono">{{ formatTime(clockUs) }} ms</span>
        </div>
      </div>

      <div class="status-indicators">
        <span v-if="isFaulted" class="status-tag status-danger anim-glow-danger">
          <Zap class="icon" /> FAULTED
        </span>
        <span v-else-if="isRunning" class="status-tag status-success anim-glow-success">
          <Activity class="icon" /> SIMULATING
        </span>
        <span v-else class="status-tag status-idle">
          STANDBY
        </span>
      </div>
    </header>

    <div class="main-layout">
      <!-- Left Panel: Device Catalog -->
      <aside class="panel left-panel">
        <div class="panel-header">
          <Layers class="panel-header-icon" />
          <span>Device Library</span>
        </div>
        <div class="panel-content scrollable">
          <p class="section-desc">Click to add peripherals to the workbench workspace:</p>
          <div class="catalog-list">
            <div 
              v-for="item in catalog" 
              :key="item.type" 
              @click="addComponent(item)"
              class="catalog-item"
            >
              <div class="catalog-item-info">
                <span class="catalog-item-name">{{ item.name }}</span>
                <span class="catalog-item-desc">{{ item.desc }}</span>
              </div>
              <Plus class="catalog-item-add" />
            </div>
          </div>

          <div class="active-components-section">
            <div class="section-title">Active Peripherals</div>
            <div v-if="activeComponents.length === 0" class="empty-state">No peripherals active</div>
            <div v-else class="active-list">
              <div 
                v-for="comp in activeComponents" 
                :key="comp.id" 
                @click="selectComponent(comp)"
                class="active-item"
                :class="{ 'active-item-selected': selectedCompId === comp.id }"
              >
                <span>{{ comp.name }} (Pin {{ getPinLabel(comp) }})</span>
                <button @click.stop="removeComponent(comp.id)" class="btn-icon">
                  <Trash class="icon icon-danger" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Center Workspace (Canvas and Visuals) -->
      <main class="center-workspace">
        <div class="workspace-tabs">
          <button 
            @click="activeTab = 'canvas'" 
            class="tab-btn" 
            :class="{ active: activeTab === 'canvas' }"
          >
            <Activity class="tab-icon" />
            <span>Circuit Canvas</span>
          </button>
          <button 
            @click="activeTab = 'sim'" 
            class="tab-btn" 
            :class="{ active: activeTab === 'sim' }"
          >
            <Layers class="tab-icon" />
            <span>Simulation View</span>
          </button>
        </div>

        <div class="workspace-content">
          <!-- Canvas Tab -->
          <div v-show="activeTab === 'canvas'" class="canvas-container" ref="canvasContainerRef">
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

              <!-- Connection Wires -->
              <g v-for="wire in wiresToRender" :key="wire.id" class="smart-wire-group" :class="{ 'selected-wire': selectedWireId === wire.id, 'inactive-wire': !wire.isActive }">
                <!-- 0. Teardrops (Pads transitions) -->
                <path 
                  v-for="(td, idx) in wire.teardrops" 
                  :key="'td-' + idx" 
                  :d="td" 
                  :fill="wire.color" 
                  opacity="0.8" 
                />

                <!-- Wire Segments (Top / Bottom Layers) -->
                <g v-for="(seg, idx) in wire.segments" :key="'seg-' + idx">
                  <!-- Neon Glow Underlying -->
                  <path 
                    :d="seg.d" 
                    fill="none" 
                    :stroke="seg.layer === 0 ? wire.color : '#3b82f6'" 
                    :stroke-width="wire.width + 3" 
                    :opacity="seg.layer === 0 ? 0.15 : 0.08"
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
                    :stroke-width="wire.width + 2" 
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    :stroke-dasharray="seg.layer === 1 ? '6,4' : undefined"
                  />
                  <!-- Visible wire segment -->
                  <path 
                    :d="seg.d" 
                    fill="none" 
                    :stroke="seg.layer === 0 ? wire.color : '#3b82f6'" 
                    :stroke-width="wire.width" 
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    :stroke-dasharray="seg.layer === 1 ? '6,4' : undefined"
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

                <!-- Vias (Transitions Layer 0 <-> Layer 1) -->
                <g v-for="(via, idx) in wire.vias" :key="'via-' + idx">
                  <!-- Outer copper ring -->
                  <circle :cx="via.x" :cy="via.y" r="5.5" fill="#e2e8f0" stroke="#d97706" stroke-width="1.2" />
                  <!-- Inner drill hole -->
                  <circle :cx="via.x" :cy="via.y" r="2.5" fill="#1e293b" />
                </g>

                <!-- Start & End connection dots -->
                <circle :cx="wire.start.x" :cy="wire.start.y" :r="wire.width + 1.2" :fill="wire.color" stroke="#080c14" stroke-width="1.2" />
                <circle :cx="wire.end.x" :cy="wire.end.y" :r="wire.width + 1.2" :fill="wire.color" stroke="#080c14" stroke-width="1.2" />

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

            <!-- Real-time Interactive Peripherals Positioned on Canvas -->
            <div class="peripherals-layer" :style="{ transform: `scale(${peripheralScaleX}, ${peripheralScaleY})`, transformOrigin: 'top left', width: viewWidth + 'px', height: viewHeight + 'px' }">
            <div
              v-for="comp in activeComponents"
              :key="'canvas-comp-' + comp.id"
              :style="{
                position: 'absolute',
                left: `${getCanvasX(comp)}px`,
                top: `${getCanvasY(comp)}px`,
                '--rot': `${comp.rotation || 0}deg`,
                transformOrigin: `${(componentSizes[comp.type]?.width ?? 80) / 2}px ${(componentSizes[comp.type]?.height ?? 60) / 2}px`,
                zIndex: 10
              }"
              @click="selectComponent(comp)"
              @mousedown="startDragComponent($event, comp)"
              class="canvas-peripheral-wrapper"
              :class="{ 'selected-peripheral': selectedCompId === comp.id, 'dragging': draggedCompId === comp.id }"
            >
              <!-- Rotation toolbar (visible when selected) -->
              <div v-if="selectedCompId === comp.id" class="rotation-toolbar" @mousedown.stop>
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
                @button-press="handleButtonPress(comp)"
                @button-release="handleButtonRelease(comp)"
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

          <!-- Simulation Grid Tab -->
          <div v-show="activeTab === 'sim'" class="sim-grid-container scrollable">
            <div class="virtual-peripherals-grid">
              <div v-for="comp in activeComponents" :key="comp.id" class="grid-card">
                <div class="card-header">
                  <span class="card-title">{{ comp.name }}</span>
                </div>
                
                <div class="card-body">
                  <VirtualLED 
                    v-if="comp.type === 'led'"
                    :pin-connections="comp.pinConnections"
                    :color="comp.props.color"
                    :level="typeof comp.pinConnections.A === 'number' ? pinStates[comp.pinConnections.A] || false : false"
                    :brightness="comp.props.brightness"
                    :label="comp.props.label"
                    :flip="comp.props.flip"
                  />
                  <VirtualButton
                    v-else-if="comp.type === 'button'"
                    :pin-connections="comp.pinConnections"
                    :color="comp.props.color"
                    :label="comp.props.label"
                    :xray="comp.props.xray"
                    :active-low="comp.props.activeLow"
                  />
                  <VirtualOLED
                    v-else-if="comp.type === 'oled'"
                    :pin-connections="comp.pinConnections"
                    :framebuffer="oledFb"
                  />
                  <VirtualUltrasonic
                    v-else-if="comp.type === 'ultrasonic'"
                    :pin-connections="comp.pinConnections"
                    :distance="comp.props.distance"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <!-- Right Panel: Inspector and Fault Injector -->
      <aside class="panel right-panel">
        <div class="panel-header">
          <Settings class="panel-header-icon" />
          <span>Properties & Faults</span>
        </div>

        <div class="panel-content scrollable">
          <!-- Property Inspector Section -->
          <div class="inspector-section">
            <div class="section-title">Property Inspector</div>
            
            <div v-if="!selectedComp" class="empty-state">
              Select a peripheral on the left or click canvas node to edit properties.
            </div>
            
            <div v-else class="property-form">
              <div class="form-group">
                <label>Component Name</label>
                <input type="text" v-model="selectedComp.name" class="input" />
              </div>

              <!-- Dynamic Pin Configuration -->
              <div class="section-title">Pin Connections</div>
              <div 
                v-for="pinDef in peripheralConfigs[selectedComp.type]?.pins" 
                :key="pinDef.name"
                class="form-group"
              >
                <label>{{ pinDef.name }} - {{ pinDef.description }}</label>
                <select 
                  v-model="selectedComp.pinConnections[pinDef.name]" 
                  class="select font-mono"
                >
                  <option v-if="!pinDef.required" :value="null">Not Connected</option>
                  <template v-if="pinDef.signalType === 'power' || pinDef.signalType === 'i2c'">
                    <option v-for="opt in powerOptions" :key="opt" :value="opt">{{ opt }}</option>
                  </template>
                  <template v-if="pinDef.signalType === 'digital' || pinDef.signalType === 'i2c'">
                    <option v-for="gpio in availableGPIOs" :key="gpio" :value="gpio">IO{{ gpio }}</option>
                  </template>
                </select>
              </div>

              <!-- Dynamic Properties -->
              <div class="section-title">Properties</div>
              <div 
                v-for="(propDef, propKey) in peripheralConfigs[selectedComp.type]?.props" 
                :key="propKey"
                class="form-group"
              >
                <label>{{ propDef.description }}</label>
                <select v-if="propDef.options" v-model="selectedComp.props[propKey]" class="select">
                  <option v-for="opt in propDef.options" :key="opt" :value="opt">{{ opt }}</option>
                </select>
                <input 
                  v-else-if="propDef.type === 'number'" 
                  type="number" 
                  v-model.number="selectedComp.props[propKey]" 
                  class="input font-mono"
                />
                <input 
                  v-else-if="propDef.type === 'boolean'" 
                  type="checkbox" 
                  v-model="selectedComp.props[propKey]" 
                />
                <input 
                  v-else 
                  type="text" 
                  v-model="selectedComp.props[propKey]" 
                  class="input"
                />
              </div>

              <!-- Ultrasonic distance slider (special handling) -->
              <div v-if="selectedComp.type === 'ultrasonic'" class="form-group">
                <div class="slider-label">
                  <span>Distance (cm):</span>
                  <span class="val">{{ ultrasonicDistance }} cm</span>
                </div>
                <input 
                  type="range" 
                  min="2" 
                  max="400" 
                  v-model.number="ultrasonicDistance"
                  class="slider"
                />
              </div>

              <!-- Rotation Control -->
              <div class="form-group">
                <label>Rotation</label>
                <div class="rotation-btn-group">
                  <button
                    v-for="deg in [0, 90, 180, 270]"
                    :key="deg"
                    @click="setRotation(selectedComp, deg)"
                    class="rotation-btn"
                    :class="{ active: (selectedComp.rotation || 0) === deg }"
                  >
                    {{ deg }}°
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Fault Injector Section -->
          <div class="inspector-section fault-section">
            <div class="section-title text-danger">Fault Injector</div>
            
            <div class="property-form">
              <div class="form-group">
                <div class="slider-label">
                  <span>Debounce Window (bounce_us):</span>
                  <span class="val">{{ faults.bounce_us }} us</span>
                </div>
                <input type="range" min="0" max="5000" step="50" v-model.number="faults.bounce_us" @input="injectFaults" class="slider" />
              </div>

              <div class="form-group">
                <div class="slider-label">
                  <span>Warm-up Period (warmup_us):</span>
                  <span class="val">{{ faults.warmup_us }} us</span>
                </div>
                <input type="range" min="0" max="10000" step="100" v-model.number="faults.warmup_us" @input="injectFaults" class="slider" />
              </div>

              <div class="form-group">
                <div class="slider-label">
                  <span>ADC Sample Interval (us):</span>
                  <span class="val">{{ faults.sample_interval_us }} us</span>
                </div>
                <input type="range" min="100" max="5000" step="50" v-model.number="faults.sample_interval_us" @input="injectFaults" class="slider" />
              </div>

              <div class="form-group">
                <div class="slider-label">
                  <span>ADC Noise (adc_noise_v):</span>
                  <span class="val">{{ faults.adc_noise_v.toFixed(3) }} V</span>
                </div>
                <input type="range" min="0" max="1.0" step="0.05" v-model.number="faults.adc_noise_v" @input="injectFaults" class="slider" />
              </div>

              <div class="form-group">
                <div class="slider-label">
                  <span>RC Time Constant (rc_tau_s):</span>
                  <span class="val">{{ faults.rc_tau_s.toFixed(3) }} s</span>
                </div>
                <input type="range" min="0" max="0.5" step="0.01" v-model.number="faults.rc_tau_s" @input="injectFaults" class="slider" />
              </div>

              <div class="form-group">
                <div class="slider-label">
                  <span>I2C Drop Rate:</span>
                  <span class="val">{{ (faults.i2c_drop_permil / 10).toFixed(1) }} %</span>
                </div>
                <input type="range" min="0" max="1000" step="10" v-model.number="faults.i2c_drop_permil" @input="injectFaults" class="slider" />
              </div>

              <div class="form-group checkbox-group danger-checkbox">
                <input type="checkbox" id="breakWire" v-model="wireBroken" @change="toggleWireBreak" />
                <label for="breakWire">Cut Output Signal Wire (Hi-Z)</label>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- Bottom Panel: Trace and Logs -->
    <footer class="bottom-panel">
      <div class="panel-header tabs-header">
        <button 
          @click="bottomTab = 'traces'" 
          class="tab-btn" 
          :class="{ active: bottomTab === 'traces' }"
        >
          <Activity class="tab-icon" />
          <span>Trace Logs</span>
        </button>
        <button 
          @click="bottomTab = 'logs'" 
          class="tab-btn" 
          :class="{ active: bottomTab === 'logs' }"
        >
          <Terminal class="tab-icon" />
          <span>Diagnostics / Logs</span>
        </button>
      </div>

      <div class="panel-content tab-content scrollable font-mono">
        <!-- Trace Console -->
        <div v-show="bottomTab === 'traces'" class="console traces-console">
          <div v-if="traces.length === 0" class="empty-console">No simulation traces captured yet. Start simulation.</div>
          <div v-else class="trace-list">
            <div 
              v-for="(t, index) in traces.slice().reverse()" 
              :key="'trace-' + index" 
              class="trace-line"
              :class="getTraceClass(t.type)"
            >
              <span class="trace-time">[{{ formatTime(t.timestamp) }} ms]</span>
              <span class="trace-seq">#{{ t.sequence }}</span>
              <span class="trace-type">{{ getTraceLabel(t.type) }}</span>
              <span class="trace-details">Pin/Bus ID: {{ t.pinOrBus }}</span>
            </div>
          </div>
        </div>

        <!-- Raw Logs -->
        <div v-show="bottomTab === 'logs'" class="console logs-console">
          <div class="console-actions">
            <button @click="clearLogs" class="btn btn-secondary btn-small">Clear Logs</button>
          </div>
          <div v-if="logs.length === 0" class="empty-console">Console is clear.</div>
          <div v-else class="log-list">
            <div 
              v-for="(log, idx) in logs" 
              :key="'log-' + idx" 
              class="log-line"
              :class="'log-' + log.level"
            >
              <span class="log-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
              <span class="log-msg">{{ log.message }}</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { 
  Play, Pause, RotateCcw, RotateCw, Cpu, Layers, Settings, Zap, Terminal, Activity, Plus, Trash, MousePointer2
} from 'lucide-vue-next';
import {
  initSimulation, startSimulation, pauseSimulation, resetSimulation,
  setPinIdeal, observePins, setFaults, setSpeed, clearLogs, setUltrasonicDistance,
  isInitialized, isRunning, isFaulted, clockUs, pinStates, oledFb, logs, traces
} from '../services/simulation-client';

import VirtualLED from '../components/VirtualLED.vue';
import VirtualButton from '../components/VirtualButton.vue';
import VirtualOLED from '../components/VirtualOLED.vue';
import VirtualUltrasonic from '../components/VirtualUltrasonic.vue';
import { 
  peripheralConfigs, 
  getDefaultPinConnections, 
  getDefaultProps, 
  getNetDefinitions,
  boardDescriptor,
  availableGPIOs,
  powerOptions,
  PinConnectionValue,
  generateSmartOrthogonalPath,
  generateSmartPCBPath,
  generateBusStripPath,
  rotatePinOffset,
  Obstacle,
  WirePathResult,
  NetDefinition
} from '../types/peripheral-pins';

// Local Types
interface CatalogItem {
  type: string;
  name: string;
  desc: string;
}

interface ComponentInstance {
  id: string;
  type: string;
  name: string;
  pinConnections: Record<string, PinConnectionValue>;
  props: Record<string, any>;
  rotation: number;
}

interface LayoutPosition {
  x: number;
  y: number;
}

const defaultPositions: Record<string, { x: number; y: number }> = {
  led: { x: 50, y: 60 },
  button: { x: 50, y: 200 },
  oled: { x: 580, y: 80 },
  ultrasonic: { x: 50, y: 340 },
};

const layoutState = ref<Record<string, LayoutPosition>>({});

const nextPositionOffset = ref<Record<string, number>>({});

// Scaffolding components list
const catalog = ref<CatalogItem[]>([
  { type: 'led', name: 'Virtual LED', desc: 'Outputs HIGH/LOW voltage state.' },
  { type: 'button', name: 'Push Button', desc: 'Injects HIGH/LOW ideal digital inputs.' },
  { type: 'oled', name: 'SSD1306 Display', desc: '128x64 pixels screen using I2C lines.' },
  { type: 'ultrasonic', name: 'HC-SR04 Sensor', desc: 'Ultrasonic distance range sensor.' }
]);

const wireStyle = ref<'pcb' | 'curved' | 'bus'>('bus');
const routingMode = ref<'auto' | 'manual'>('auto');
const canvasContainerRef = ref<HTMLElement | null>(null);

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 580;
const viewWidth = ref(CANVAS_WIDTH);
const viewHeight = ref(CANVAS_HEIGHT);
const peripheralScaleX = ref(1);
const peripheralScaleY = ref(1);

function setRoutingMode(mode: 'auto' | 'manual') {
  routingMode.value = mode;
  inactiveWireCache.value = {};
}

function updateCanvasScale() {
  const container = canvasContainerRef.value;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const containerRatio = rect.width / rect.height;
  const baseRatio = CANVAS_WIDTH / CANVAS_HEIGHT;

  if (containerRatio > baseRatio) {
    viewHeight.value = CANVAS_HEIGHT;
    viewWidth.value = Math.round(CANVAS_HEIGHT * containerRatio);
  } else {
    viewWidth.value = CANVAS_WIDTH;
    viewHeight.value = Math.round(CANVAS_WIDTH / containerRatio);
  }

  peripheralScaleX.value = rect.width / viewWidth.value;
  peripheralScaleY.value = rect.height / viewHeight.value;
}

function getCanvasScale() {
  const svg = document.querySelector('.circuit-svg');
  if (!svg) return { scale: 1, offsetX: 0, offsetY: 0 };
  const rect = svg.getBoundingClientRect();
  const scale = rect.width / CANVAS_WIDTH;
  const offsetX = rect.left;
  const offsetY = rect.top;
  return { scale, offsetX, offsetY };
}

function clientToCanvas(clientX: number, clientY: number) {
  const svg = document.querySelector('.circuit-svg');
  if (!svg) return { x: clientX, y: clientY };
  const rect = svg.getBoundingClientRect();
  const x = (clientX - rect.left) * (viewWidth.value / rect.width);
  const y = (clientY - rect.top) * (viewHeight.value / rect.height);
  return { x, y };
}

const activeComponents = ref<ComponentInstance[]>([
  {
    id: 'led1',
    type: 'led',
    name: 'Virtual LED',
    pinConnections: { A: 13, C: 'GND' },
    props: { color: 'red', brightness: 1.0, label: '', flip: false },
    rotation: 0
  },
  {
    id: 'btn1',
    type: 'button',
    name: 'Push Button',
    pinConnections: { '1.l': 14, '2.l': 'VCC', '1.r': 'GND', '2.r': null },
    props: { color: 'green', label: '', xray: false, activeLow: true },
    rotation: 0
  },
  {
    id: 'oled1',
    type: 'oled',
    name: 'SSD1306 Display',
    pinConnections: { DATA: 21, CLK: 22, DC: null, RST: null, CS: null, '3V3': '3V3', VIN: null, GND: 'GND' },
    props: {},
    rotation: 0
  },
  {
    id: 'sonar1',
    type: 'ultrasonic',
    name: 'HC-SR04 Sensor',
    pinConnections: { VCC: 'VCC', TRIG: 12, ECHO: 13, GND: 'GND' },
    props: { distance: 25 },
    rotation: 0
  }
]);

const selectedCompId = ref<string>('led1');
const selectedComp = computed(() => activeComponents.value.find(c => c.id === selectedCompId.value));

const activeTab = ref<'canvas' | 'sim'>('canvas');
const bottomTab = ref<'traces' | 'logs'>('traces');
const simSpeed = ref<number>(1);
const wireBroken = ref<boolean>(false);
const canvasOledRef = ref<any>(null);
const ultrasonicDistance = ref<number>(25);

const faults = ref({
  bounce_us: 0,
  warmup_us: 0,
  sample_interval_us: 1000,
  adc_noise_v: 0.0,
  rc_tau_s: 0.0,
  i2c_drop_permil: 0,
  prng_seed: 1
});

// Watch framebuffer and copy to the canvas OLED element dynamically
watch(oledFb, (newFb) => {
  const oledEl = Array.isArray(canvasOledRef.value) 
    ? canvasOledRef.value.find(el => el && el.tagName === 'WOKWI-SSD1306')
    : canvasOledRef.value;
  if (!oledEl) return;
  
  let imgData = oledEl.imageData;
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
  
  oledEl.imageData = imgData;
  if (typeof oledEl.redraw === 'function') {
    oledEl.redraw();
  }
});

// Watch ultrasonic distance and synchronize to simulator client
watch([ultrasonicDistance, activeComponents], ([dist, comps]) => {
  const sonar = (comps as ComponentInstance[]).find(c => c.type === 'ultrasonic');
  if (sonar) {
    const trigPin = sonar.pinConnections.TRIG;
    const echoPin = sonar.pinConnections.ECHO;
    if (typeof trigPin === 'number' && typeof echoPin === 'number') {
      setUltrasonicDistance(trigPin, echoPin, dist as number);
    }
  }
}, { deep: true, immediate: true });

// Component management
function addComponent(item: CatalogItem) {
  const newId = `${item.type}_${Date.now()}`;
  
  const newItem: ComponentInstance = {
    id: newId,
    type: item.type,
    name: item.name,
    pinConnections: getDefaultPinConnections(item.type),
    props: getDefaultProps(item.type),
    rotation: 0
  };
  
  activeComponents.value.push(newItem);
  selectedCompId.value = newId;

  const offset = nextPositionOffset.value[item.type] || 0;
  const basePos = defaultPositions[item.type];
  layoutState.value[newId] = {
    x: basePos.x + offset * 80,
    y: basePos.y + (offset % 3) * 20,
  };
  nextPositionOffset.value[item.type] = offset + 1;
}

function removeComponent(id: string) {
  activeComponents.value = activeComponents.value.filter(c => c.id !== id);
  delete layoutState.value[id];
  if (selectedCompId.value === id && activeComponents.value.length > 0) {
    selectedCompId.value = activeComponents.value[0].id;
  }
}

function selectComponent(comp: ComponentInstance) {
  selectedCompId.value = comp.id;
}

function setRotation(comp: ComponentInstance, deg: number) {
  comp.rotation = deg;
  inactiveWireCache.value = {};
}

function rotateComponent(comp: ComponentInstance, delta: number) {
  comp.rotation = (((comp.rotation || 0) + delta) % 360 + 360) % 360;
  inactiveWireCache.value = {};
}

function handleButtonPress(comp: ComponentInstance) {
  const signalPin = comp.pinConnections['1.l'];
  if (typeof signalPin === 'number') {
    setPinIdeal(signalPin, comp.props.activeLow ? false : true);
  }
}

function handleButtonRelease(comp: ComponentInstance) {
  const signalPin = comp.pinConnections['1.l'];
  if (typeof signalPin === 'number') {
    setPinIdeal(signalPin, comp.props.activeLow ? true : false);
  }
}

function getPinLabel(comp: ComponentInstance) {
  const connections = comp.pinConnections;
  const digitalPins = Object.entries(connections)
    .filter(([, val]) => typeof val === 'number')
    .map(([name, val]) => `${name}:${val}`);
  if (digitalPins.length === 0) return 'No GPIO';
  return digitalPins.join(', ');
}

// Watch active components to register them in worker
watch(activeComponents, (comps) => {
  const pins: number[] = [];
  
  comps.forEach(c => {
    Object.values(c.pinConnections).forEach(val => {
      if (typeof val === 'number') {
        pins.push(val);
      }
    });
  });
  
  observePins(pins, comps);
}, { deep: true, immediate: true });

// Simulation handlers
function toggleSimulation() {
  if (isRunning.value) {
    pauseSimulation();
  } else {
    startSimulation();
  }
}

function handleReset() {
  resetSimulation();
  setTimeout(() => {
    const pins: number[] = [];
    activeComponents.value.forEach(c => {
      Object.values(c.pinConnections).forEach(val => {
        if (typeof val === 'number') {
          pins.push(val);
        }
      });
    });
    observePins(pins, activeComponents.value);
    injectFaults();
  }, 100);
}

function updateSpeed() {
  setSpeed(simSpeed.value);
}

function injectFaults() {
  setFaults(faults.value);
}

function toggleWireBreak() {
  const led = activeComponents.value.find(c => c.type === 'led');
  if (led) {
    const anodePin = led.pinConnections.A;
    if (typeof anodePin === 'number') {
      setPinIdeal(anodePin, !wireBroken.value);
    }
  }
}

// Waypoint Routing & Drag-Priority Shoving State
interface Point {
  x: number;
  y: number;
}
interface WireRenderItem {
  id: string;
  path: string;
  color: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  width: number;
  segments: Array<{ d: string; layer: number }>;
  vias: Array<{ x: number; y: number }>;
  teardrops: Array<string>;
  isActive?: boolean;
  isDragged?: boolean;
}
const wireWaypoints = ref<Record<string, Point[]>>({});
const draggedWireId = ref<string | null>(null);
const draggingWaypoint = ref<{ wireId: string; index: number } | null>(null);
const selectedWireId = ref<string | null>(null);
const dragThreshold = 8;
const wireDragStart = ref({ x: 0, y: 0 });
const pendingWaypoint = ref<{ wireId: string; x: number; y: number } | null>(null);
const draggingSegment = ref<{ wireId: string; startIndex: number; endIndex: number; startOffset: number } | null>(null);
const inactiveWireCache = ref<Record<string, WireRenderItem>>({});
let clickTimer: ReturnType<typeof setTimeout> | null = null;
let clickCount = 0;

function handleWireClick(event: MouseEvent, wireId: string) {
  event.preventDefault();
  event.stopPropagation();
  
  draggedWireId.value = wireId;
  
  clickCount++;
  
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  
  if (clickCount === 2) {
    clickCount = 0;
    selectedWireId.value = selectedWireId.value === wireId ? null : wireId;
    draggedWireId.value = null;
    return;
  }
  
  clickTimer = setTimeout(() => {
    clickCount = 0;
    
    const { x: clickX, y: clickY } = clientToCanvas(event.clientX, event.clientY);
    
    const existingWaypoints = wireWaypoints.value[wireId] || [];
    const waypointThreshold = 12;
    
    let nearestWaypointIndex = -1;
    let minDistance = waypointThreshold;
    
    for (let i = 0; i < existingWaypoints.length; i++) {
      const wp = existingWaypoints[i];
      const dx = clickX - wp.x;
      const dy = clickY - wp.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDistance) {
        minDistance = dist;
        nearestWaypointIndex = i;
      }
    }
    
    if (nearestWaypointIndex !== -1) {
      startDragWaypoint(wireId, nearestWaypointIndex);
      return;
    }
    
    const pts = getWirePointsById(wireId);
    if (pts) {
      const segmentThreshold = 12;
      const nearestSegment = findNearestSegment(clickX, clickY, pts);
      
      if (nearestSegment && nearestSegment.distance < segmentThreshold) {
        wireDragStart.value = { x: clickX, y: clickY };
        
        let { startIndex, endIndex } = nearestSegment;
        const waypoints = wireWaypoints.value[wireId] || [];
        
        if (startIndex === 0 && endIndex === 1 && waypoints.length === 0) {
          const pts = getWirePointsById(wireId);
          if (pts && pts.length >= 2) {
            const p1 = pts[0];
            const p2 = pts[1];
            waypoints.push({ x: p1.x, y: clickY });
            waypoints.push({ x: clickX, y: p2.y });
            wireWaypoints.value[wireId] = waypoints;
            startIndex = 1;
            endIndex = 2;
          }
        } else if (startIndex === 0 && endIndex === 1) {
          startIndex = 1;
          endIndex = 2;
        }
        
        draggingSegment.value = {
          wireId,
          startIndex,
          endIndex,
          startOffset: nearestSegment.offset
        };
        window.addEventListener('mousemove', handleWaypointMouseMove);
        window.addEventListener('mouseup', handleWaypointMouseUp);
        return;
      }
    }
    
    wireDragStart.value = { x: clickX, y: clickY };
    pendingWaypoint.value = { wireId, x: clickX, y: clickY };
    
    window.addEventListener('mousemove', handleWaypointMouseMove);
    window.addEventListener('mouseup', handleWaypointMouseUp);
  }, 250);
}

function getWirePointsById(wireId: string): Point[] | null {
  const [compId, mode] = wireId.split('-');
  const comp = activeComponents.value.find(c => c.id === compId);
  if (!comp) return null;
  
  const pts = getWirePoints(comp, mode as 'primary' | 'secondary' | 'vcc' | 'gnd');
  if (!pts) return null;
  
  const waypoints = wireWaypoints.value[wireId] || [];
  return [pts.start, ...waypoints, pts.end];
}

function findNearestSegment(x: number, y: number, points: Point[]): { startIndex: number; endIndex: number; distance: number; offset: number } | null {
  if (points.length < 2) return null;
  
  let nearest = null;
  let minDistance = Infinity;
  
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len === 0) continue;
    
    const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / (len * len)));
    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;
    
    const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
    
    if (dist < minDistance) {
      minDistance = dist;
      nearest = {
        startIndex: i,
        endIndex: i + 1,
        distance: dist,
        offset: t
      };
    }
  }
  
  return nearest;
}

function startDragWaypoint(wireId: string, index: number) {
  draggingWaypoint.value = { wireId, index };
  draggedWireId.value = wireId;
  
  window.addEventListener('mousemove', handleWaypointMouseMove);
  window.addEventListener('mouseup', handleWaypointMouseUp);
}

function handleWaypointMouseMove(event: MouseEvent) {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    clickCount = 0;
  }
  
  const { x: currentX, y: currentY } = clientToCanvas(event.clientX, event.clientY);

  const dx = Math.abs(currentX - wireDragStart.value.x);
  const dy = Math.abs(currentY - wireDragStart.value.y);
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (pendingWaypoint.value && distance > dragThreshold) {
    const { wireId, x, y } = pendingWaypoint.value;
    
    if (!wireWaypoints.value[wireId]) {
      wireWaypoints.value[wireId] = [];
    }
    
    const index = wireWaypoints.value[wireId].length;
    wireWaypoints.value[wireId].push({ x, y });
    
    startDragWaypoint(wireId, index);
    pendingWaypoint.value = null;
  }

  if (draggingWaypoint.value) {
    const { wireId, index } = draggingWaypoint.value;

    let x = currentX;
    let y = currentY;

    x = Math.max(10, Math.min(viewWidth.value - 10, x));
    y = Math.max(10, Math.min(viewHeight.value - 10, y));

    x = Math.round(x / 10) * 10;
    y = Math.round(y / 10) * 10;

    if (wireWaypoints.value[wireId] && wireWaypoints.value[wireId][index]) {
      wireWaypoints.value[wireId][index] = { x, y };
    }
  }

  if (draggingSegment.value) {
    const { wireId, startIndex, endIndex } = draggingSegment.value;
    
    const deltaX = currentX - wireDragStart.value.x;
    const deltaY = currentY - wireDragStart.value.y;
    
    const waypoints = wireWaypoints.value[wireId] || [];
    
    if (startIndex > 0 && startIndex <= waypoints.length) {
      waypoints[startIndex - 1] = {
        x: Math.round((waypoints[startIndex - 1].x + deltaX) / 10) * 10,
        y: Math.round((waypoints[startIndex - 1].y + deltaY) / 10) * 10
      };
    }
    
    if (endIndex >= 2 && endIndex <= waypoints.length + 1) {
      waypoints[endIndex - 2] = {
        x: Math.round((waypoints[endIndex - 2].x + deltaX) / 10) * 10,
        y: Math.round((waypoints[endIndex - 2].y + deltaY) / 10) * 10
      };
    }
    
    wireWaypoints.value[wireId] = waypoints;
    wireDragStart.value = { x: currentX, y: currentY };
  }
}

function handleWaypointMouseUp() {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    clickCount = 0;
  }
  
  if (pendingWaypoint.value && !draggingWaypoint.value) {
    const { wireId } = pendingWaypoint.value;
    if (wireWaypoints.value[wireId] && wireWaypoints.value[wireId].length > 0) {
      wireWaypoints.value[wireId].pop();
    }
    pendingWaypoint.value = null;
  }
  
  draggingWaypoint.value = null;
  draggingSegment.value = null;
  draggedWireId.value = null;
  inactiveWireCache.value = {};
  
  window.removeEventListener('mousemove', handleWaypointMouseMove);
  window.removeEventListener('mouseup', handleWaypointMouseUp);
}

function handleCanvasClick(event: MouseEvent) {
  const target = event.target as Element;
  if (target.tagName === 'svg' || target.classList.contains('circuit-svg')) {
    selectedWireId.value = null;
  }
}

function removeWaypoint(wireId: string, index: number) {
  if (wireWaypoints.value[wireId]) {
    wireWaypoints.value[wireId].splice(index, 1);
  }
}

// Board Drag State
const boardPosition = ref({ x: boardDescriptor.x, y: boardDescriptor.y });
const isDraggingBoard = ref(false);
const boardDragOffset = ref({ x: 0, y: 0 });

const boardPinOffsets: Record<number, { x: number; y: number }> = {
  12: { x: boardDescriptor.pins[12].x - boardDescriptor.x, y: boardDescriptor.pins[12].y - boardDescriptor.y },
  13: { x: boardDescriptor.pins[13].x - boardDescriptor.x, y: boardDescriptor.pins[13].y - boardDescriptor.y },
  14: { x: boardDescriptor.pins[14].x - boardDescriptor.x, y: boardDescriptor.pins[14].y - boardDescriptor.y },
  21: { x: boardDescriptor.pins[21].x - boardDescriptor.x, y: boardDescriptor.pins[21].y - boardDescriptor.y },
  22: { x: boardDescriptor.pins[22].x - boardDescriptor.x, y: boardDescriptor.pins[22].y - boardDescriptor.y },
};
const boardPowerPinOffsets: Record<string, { x: number; y: number }> = {
  VCC: { x: boardDescriptor.powerPins.VCC.x - boardDescriptor.x, y: boardDescriptor.powerPins.VCC.y - boardDescriptor.y },
  '3V3': { x: boardDescriptor.powerPins['3V3'].x - boardDescriptor.x, y: boardDescriptor.powerPins['3V3'].y - boardDescriptor.y },
  GND: { x: boardDescriptor.powerPins.GND.x - boardDescriptor.x, y: boardDescriptor.powerPins.GND.y - boardDescriptor.y },
};

function startDragBoard(event: MouseEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const { x: mouseX, y: mouseY } = clientToCanvas(event.clientX, event.clientY);
  boardDragOffset.value = {
    x: mouseX - boardPosition.value.x,
    y: mouseY - boardPosition.value.y,
  };
  isDraggingBoard.value = true;
  window.addEventListener('mousemove', handleBoardMouseMove);
  window.addEventListener('mouseup', handleBoardMouseUp);
}

function handleBoardMouseMove(event: MouseEvent) {
  if (!isDraggingBoard.value) return;

  const { x: mouseX, y: mouseY } = clientToCanvas(event.clientX, event.clientY);

  let x = Math.round(mouseX - boardDragOffset.value.x);
  let y = Math.round(mouseY - boardDragOffset.value.y);

  const maxX = viewWidth.value - boardDescriptor.width - 10;
  const maxY = viewHeight.value - boardDescriptor.height - 10;
  x = Math.max(10, Math.min(maxX, x));
  y = Math.max(10, Math.min(maxY, y));

  x = Math.round(x / 10) * 10;
  y = Math.round(y / 10) * 10;

  boardPosition.value = { x, y };
}

function handleBoardMouseUp() {
  isDraggingBoard.value = false;
  window.removeEventListener('mousemove', handleBoardMouseMove);
  window.removeEventListener('mouseup', handleBoardMouseUp);
}

// Component Drag State
const draggedCompId = ref<string | null>(null);
const dragOffset = ref({ x: 0, y: 0 });

function startDragComponent(event: MouseEvent, comp: ComponentInstance) {
  if (event.button !== 0) return;
  
  event.preventDefault();
  event.stopPropagation();

  draggedCompId.value = comp.id;
  selectComponent(comp);

  const { x: mouseX, y: mouseY } = clientToCanvas(event.clientX, event.clientY);

  const currentX = getCanvasX(comp);
  const currentY = getCanvasY(comp);
  
  dragOffset.value = {
    x: mouseX - currentX,
    y: mouseY - currentY,
  };

  window.addEventListener('mousemove', handleComponentMouseMove);
  window.addEventListener('mouseup', handleComponentMouseUp);
}

function handleComponentMouseMove(event: MouseEvent) {
  if (!draggedCompId.value) return;

  const { x: mouseX, y: mouseY } = clientToCanvas(event.clientX, event.clientY);

  let x = Math.round(mouseX - dragOffset.value.x);
  let y = Math.round(mouseY - dragOffset.value.y);

  const draggedComp = activeComponents.value.find(c => c.id === draggedCompId.value);
  const maxX = viewWidth.value - (draggedComp ? getComponentWidth(draggedComp) : 100) - 10;
  const maxY = viewHeight.value - (draggedComp ? getComponentHeight(draggedComp) : 80) - 10;
  x = Math.max(10, Math.min(maxX, x));
  y = Math.max(10, Math.min(maxY, y));

  x = Math.round(x / 10) * 10;
  y = Math.round(y / 10) * 10;

  if (!layoutState.value[draggedCompId.value]) {
    layoutState.value[draggedCompId.value] = { x: 0, y: 0 };
  }
  layoutState.value[draggedCompId.value] = { x, y };
}

function handleComponentMouseUp() {
  draggedCompId.value = null;
  window.removeEventListener('mousemove', handleComponentMouseMove);
  window.removeEventListener('mouseup', handleComponentMouseUp);
}

// Canvas layouts helpers - Using SVG viewBox coordinate system (0-800, 0-500)
function getCanvasX(comp: ComponentInstance): number {
  if (layoutState.value[comp.id]) {
    return layoutState.value[comp.id].x;
  }
  return defaultPositions[comp.type]?.x ?? 50;
}

function getCanvasY(comp: ComponentInstance): number {
  if (layoutState.value[comp.id]) {
    return layoutState.value[comp.id].y;
  }
  return defaultPositions[comp.type]?.y ?? 50;
}

const componentSizes: Record<string, { width: number; height: number }> = {
  led: { width: 50, height: 60 },
  button: { width: 80, height: 60 },
  oled: { width: 128, height: 64 },
  ultrasonic: { width: 140, height: 80 },
};

function getComponentWidth(comp: ComponentInstance): number {
  const s = componentSizes[comp.type] ?? { width: 80, height: 60 };
  const r = comp.rotation || 0;
  return (r === 90 || r === 270) ? s.height : s.width;
}

function getComponentHeight(comp: ComponentInstance): number {
  const s = componentSizes[comp.type] ?? { width: 80, height: 60 };
  const r = comp.rotation || 0;
  return (r === 90 || r === 270) ? s.width : s.height;
}

function getComponentObstacle(comp: ComponentInstance): Obstacle {
  const s = componentSizes[comp.type] ?? { width: 80, height: 60 };
  const baseX = getCanvasX(comp);
  const baseY = getCanvasY(comp);
  const r = comp.rotation || 0;
  if (r === 90 || r === 270) {
    return {
      x: baseX + (s.width - s.height) / 2,
      y: baseY + (s.height - s.width) / 2,
      width: s.height,
      height: s.width,
    };
  }
  return { x: baseX, y: baseY, width: s.width, height: s.height };
}

function getWireColor(comp: ComponentInstance): string {
  if (comp.type === 'led') return '#00ff88';
  if (comp.type === 'button') return '#38bdf8';
  if (comp.type === 'oled') return '#a855f7';
  if (comp.type === 'ultrasonic') return '#eab308';
  return '#ffffff';
}

function getPinPosition(pin: number): { x: number; y: number } {
  const offset = boardPinOffsets[pin];
  if (offset) {
    return { x: boardPosition.value.x + offset.x, y: boardPosition.value.y + offset.y };
  }
  return { x: boardPosition.value.x + 7, y: boardPosition.value.y + 122 };
}

function getPowerPinPosition(powerType: string): { x: number; y: number } {
  const offset = boardPowerPinOffsets[powerType];
  if (offset) {
    return { x: boardPosition.value.x + offset.x, y: boardPosition.value.y + offset.y };
  }
  return { x: boardPosition.value.x + 7, y: boardPosition.value.y + 122 };
}

function rotateDir(
  dir: 'left' | 'right' | 'up' | 'down',
  rotation: number
): 'left' | 'right' | 'up' | 'down' {
  const dirs = ['up', 'right', 'down', 'left'] as const;
  const idx = dirs.indexOf(dir);
  if (idx < 0) return dir;
  const steps = (((Math.round(rotation / 90)) % 4) + 4) % 4;
  return dirs[(idx + steps) % 4];
}

function getPeripheralPinPosition(comp: ComponentInstance, pinName: string): { x: number; y: number } {
  const baseX = getCanvasX(comp);
  const baseY = getCanvasY(comp);
  const config = peripheralConfigs[comp.type];
  const pinDef = config?.pins.find(p => p.name === pinName);
  const offsetX = pinDef ? pinDef.relX : 0;
  const offsetY = pinDef ? pinDef.relY : 0;

  const rotation = comp.rotation || 0;
  if (rotation === 0) {
    return { x: baseX + offsetX, y: baseY + offsetY };
  }
  const W = componentSizes[comp.type]?.width ?? 80;
  const H = componentSizes[comp.type]?.height ?? 60;
  const rotated = rotatePinOffset(offsetX, offsetY, W, H, rotation);
  return { x: baseX + rotated.x, y: baseY + rotated.y };
}

function getAllWires(): Array<{ comp: ComponentInstance; mode: 'primary' | 'secondary' | 'vcc' | 'gnd' }> {
  const allWires: Array<{ comp: ComponentInstance; mode: 'primary' | 'secondary' | 'vcc' | 'gnd' }> = [];
  activeComponents.value.forEach(comp => {
    getNetDefinitions(comp.type).forEach(net => {
      if (comp.pinConnections[net.pinName] !== null) {
        allWires.push({ comp, mode: net.mode });
      }
    });
  });
  return allWires;
}

function getWirePoints(comp: ComponentInstance, mode: 'primary' | 'secondary' | 'vcc' | 'gnd'): { start: { x: number; y: number }, end: { x: number; y: number } } | null {
  const netDef = getNetDefinitions(comp.type).find(n => n.mode === mode);
  if (!netDef) return null;
  
  const pinName = netDef.pinName;
  const connection = comp.pinConnections[pinName];
  if (connection === null || connection === undefined) return null;

  const start = getPeripheralPinPosition(comp, pinName);
  let end = { x: 307, y: 272 };
  
  if (typeof connection === 'number') {
    end = getPinPosition(connection);
  } else if (connection === 'VCC' || connection === '3V3') {
    end = getPowerPinPosition(connection);
  } else if (connection === 'GND') {
    end = getPowerPinPosition('GND');
  } else {
    return null;
  }
  
  return { start, end };
}

function getWireLane(comp: ComponentInstance, mode: 'primary' | 'secondary' | 'vcc' | 'gnd'): number {
  const allWires = getAllWires();
  const index = allWires.findIndex(w => w.comp.id === comp.id && w.mode === mode);
  return index >= 0 ? index : 0;
}

function getWirePCBPath(
  comp: ComponentInstance,
  mode: 'primary' | 'secondary' | 'vcc' | 'gnd' = 'primary',
  obstacles?: Obstacle[],
  channelOccupancyMap?: Map<string, number>,
  waypoints?: Point[]
): WirePathResult | null {
  const pts = getWirePoints(comp, mode);
  if (!pts) return null;

  const netDef = getNetDefinitions(comp.type).find(n => n.mode === mode);
  const pinName = netDef?.pinName || '';

  const lane = getWireLane(comp, mode);

  let baseStartDir: 'left' | 'right' | 'up' | 'down' = 'down';
  if (comp.type === 'button') {
    if (pinName.endsWith('.l')) baseStartDir = 'left';
    else if (pinName.endsWith('.r')) baseStartDir = 'right';
  } else if (comp.type === 'oled') {
    baseStartDir = 'left';
  } else if (comp.type === 'led' || comp.type === 'ultrasonic') {
    baseStartDir = 'down';
  }
  const startDir = rotateDir(baseStartDir, comp.rotation || 0);

  const endDir = pts.end.x < boardPosition.value.x + boardDescriptor.width / 2 ? 'left' : 'right';

  const signalType = netDef?.signalType || 'digital';

  if (wireStyle.value === 'bus' && routingMode.value === 'auto') {
    const boardCenterX = boardPosition.value.x + boardDescriptor.width / 2;
    const boardCenterY = boardPosition.value.y + boardDescriptor.height / 2;
    return generateBusStripPath(pts.start, pts.end, startDir, endDir, lane, signalType, channelOccupancyMap, boardCenterX, boardCenterY);
  }
  return generateSmartPCBPath(pts.start, pts.end, startDir, endDir, lane, obstacles, channelOccupancyMap, signalType, waypoints, wireStyle.value as 'pcb' | 'curved');
}

const wiresToRender = computed(() => {
  const obstacles: Obstacle[] = [
    { x: boardPosition.value.x, y: boardPosition.value.y, width: boardDescriptor.width, height: boardDescriptor.height }
  ];
  activeComponents.value.forEach(comp => {
    obstacles.push(getComponentObstacle(comp));
  });

  interface NetRequest {
    compId: string;
    comp: ComponentInstance;
    mode: 'primary' | 'secondary' | 'vcc' | 'gnd';
    color: string;
    signalType: 'digital' | 'i2c' | 'power';
  }
  const requests: NetRequest[] = [];

  activeComponents.value.forEach(comp => {
    getNetDefinitions(comp.type).forEach(net => {
      const pinName = net.pinName;
      if (!pinName || comp.pinConnections[pinName] === null || comp.pinConnections[pinName] === undefined) {
        return;
      }

      let color = '#ffffff';
      if (net.mode === 'vcc') {
        color = '#ef4444';
      } else if (net.mode === 'gnd') {
        color = '#475569';
      } else if (net.mode === 'secondary') {
        color = comp.type === 'oled' ? '#c084fc' : '#f59e0b';
      } else {
        color = getWireColor(comp);
      }

      const signalType = net.signalType || 'digital';

      requests.push({
        compId: comp.id,
        comp,
        mode: net.mode,
        color,
        signalType
      });
    });
  });

  const priorityOrder = { power: 0, i2c: 1, digital: 2 };
  
  requests.sort((a, b) => {
    const aId = `${a.compId}-${a.mode}`;
    const bId = `${b.compId}-${b.mode}`;
    
    if (draggedWireId.value) {
      if (aId === draggedWireId.value) return -1;
      if (bId === draggedWireId.value) return 1;
    }
    
    return priorityOrder[a.signalType] - priorityOrder[b.signalType];
  });

  // Route each net and populate lists
  const list: Array<{
    id: string;
    path: string;
    color: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    width: number;
    segments: Array<{ d: string; layer: number }>;
    vias: Array<{ x: number; y: number }>;
    teardrops: Array<string>;
    isActive?: boolean;
    isDragged?: boolean;
  }> = [];

  const channelOccupancyMap = new Map<string, number>();

  requests.forEach(req => {
    const pts = getWirePoints(req.comp, req.mode);
    if (!pts) return;

    const wireId = `${req.compId}-${req.mode}`;
    const waypoints = wireWaypoints.value[wireId] || [];
    
    const isActive = !(routingMode.value === 'manual' && draggedWireId.value && wireId !== draggedWireId.value);
    const isDragged = wireId === draggedWireId.value;
    
    let pcbResult: WirePathResult | null = null;
    let cachedWire: WireRenderItem | undefined;
    
    if (isActive) {
      pcbResult = getWirePCBPath(req.comp, req.mode, obstacles, channelOccupancyMap, waypoints);
      if (pcbResult && !isDragged) {
        inactiveWireCache.value[wireId] = {
          id: wireId,
          path: pcbResult.path,
          color: req.color,
          start: pts.start,
          end: pts.end,
          width: pcbResult.width,
          segments: pcbResult.segments,
          vias: pcbResult.vias,
          teardrops: pcbResult.teardrops,
          isActive: true,
          isDragged: false
        };
      }
    } else {
      cachedWire = inactiveWireCache.value[wireId];
      if (cachedWire) {
        list.push({ ...cachedWire, isActive: false, isDragged: false });
        return;
      }
      pcbResult = getWirePCBPath(req.comp, req.mode, obstacles, undefined, waypoints);
      if (pcbResult) {
        inactiveWireCache.value[wireId] = {
          id: wireId,
          path: pcbResult.path,
          color: req.color,
          start: pts.start,
          end: pts.end,
          width: pcbResult.width,
          segments: pcbResult.segments,
          vias: pcbResult.vias,
          teardrops: pcbResult.teardrops,
          isActive: false,
          isDragged: false
        };
      }
    }
    
    if (!pcbResult) return;

    list.push({
      id: wireId,
      path: pcbResult.path,
      color: req.color,
      start: pts.start,
      end: pts.end,
      width: pcbResult.width,
      segments: pcbResult.segments,
      vias: pcbResult.vias,
      teardrops: pcbResult.teardrops,
      isActive,
      isDragged
    });
  });

  return list;
});

// Helpers
function formatTime(val: string | bigint): string {
  const us = BigInt(val.toString());
  return (Number(us) / 1000).toFixed(2);
}

function getTraceLabel(type: number): string {
  switch (type) {
    case 1: return 'GPIO EDGE';
    case 2: return 'I2C PKT';
    case 3: return 'FAULT DISCONNECT';
    case 4: return 'DEGRADE BOUNCE';
    default: return 'SYS TICK';
  }
}

function getTraceClass(type: number): string {
  switch (type) {
    case 1: return 'trace-gpio';
    case 2: return 'trace-i2c';
    case 3: return 'trace-danger';
    default: return '';
  }
}

// Initialize on mount
onMounted(() => {
  initSimulation();
  updateCanvasScale();
  window.addEventListener('resize', handleWindowResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleWindowResize);
});

let resizeTimer: ReturnType<typeof setTimeout> | null = null;
function handleWindowResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    updateCanvasScale();
    inactiveWireCache.value = {};
  }, 100);
}
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
.rotation-btn-group {
  display: flex;
  gap: 4px;
}
.rotation-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.03);
  color: #8fa0a8;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: monospace;
  transition: all 0.15s ease;
}
.rotation-btn:hover {
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
}
.rotation-btn.active {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.6);
  color: #38bdf8;
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
}
.waypoint-handle:hover {
  r: 8px;
  fill: #fbbf24;
  filter: drop-shadow(0 0 4px #fbbf24);
}

.smart-wire-group {
  transition: filter 0.15s ease;
}

.smart-wire-group.inactive-wire {
  opacity: 0.15;
  pointer-events: none;
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

.waypoint-handle {
  cursor: grab;
  transition: r 0.15s ease, fill 0.15s ease;
}

.waypoint-handle:hover {
  r: 7;
  fill: #fbbf24;
}

.waypoint-handle:active {
  cursor: grabbing;
}

@keyframes wirePulse {
  0%, 100% {
    filter: drop-shadow(0 0 4px rgba(56, 189, 248, 1)) drop-shadow(0 0 12px rgba(56, 189, 248, 0.8)) drop-shadow(0 0 20px rgba(56, 189, 248, 0.5));
  }
  50% {
    filter: drop-shadow(0 0 6px rgba(56, 189, 248, 1)) drop-shadow(0 0 18px rgba(56, 189, 248, 0.9)) drop-shadow(0 0 30px rgba(56, 189, 248, 0.7));
  }
}

.workbench {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #080c14;
}

/* Top Bar */
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  background-color: #0b0f19;
  border-bottom: 1px solid var(--border-color);
  z-index: 10;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}
.brand-icon {
  color: #38bdf8;
}
.badge {
  font-size: 10px;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(56, 189, 248, 0.2);
}
.sim-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}
.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.mode-switch {
  display: flex;
  background: #050b11;
  border-radius: 6px;
  padding: 2px;
  border: 1px solid var(--border-color);
}
.mode-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.mode-btn:hover {
  background: rgba(56, 189, 248, 0.1);
}
.mode-btn.active {
  background: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
}
.mode-icon {
  width: 14px;
  height: 14px;
}
.time-display {
  background: #050b11;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  color: #00ff88;
  font-weight: 600;
  min-width: 80px;
  text-align: right;
}
.status-indicators {
  display: flex;
  align-items: center;
}
.status-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 4px;
}
.status-success {
  background: rgba(0, 255, 136, 0.1);
  color: #00ff88;
  border: 1px solid rgba(0, 255, 136, 0.2);
}
.status-danger {
  background: rgba(255, 74, 90, 0.1);
  color: var(--color-danger);
  border: 1px solid rgba(255, 74, 90, 0.2);
}
.status-idle {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}

/* Common Layout Components */
.main-layout {
  flex: 1;
  display: flex;
  overflow: hidden;
  height: calc(100vh - 120px);
}
.panel {
  display: flex;
  flex-direction: column;
  background-color: #0b0f19;
  border-right: 1px solid var(--border-color);
  height: 100%;
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  background-color: #0e1422;
  border-bottom: 1px solid var(--border-color);
}
.panel-header-icon {
  width: 14px;
  height: 14px;
  color: #64748b;
}
.panel-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.scrollable {
  overflow-y: auto;
}

/* Sidebar left */
.left-panel {
  width: 240px;
  flex-shrink: 0;
}
.section-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0 0 10px 0;
}
.catalog-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.catalog-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.catalog-item:hover {
  background: rgba(56, 189, 248, 0.05);
  border-color: rgba(56, 189, 248, 0.3);
}
.catalog-item-info {
  display: flex;
  flex-direction: column;
}
.catalog-item-name {
  font-size: 12px;
  font-weight: 600;
  color: #f8fafc;
}
.catalog-item-desc {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}
.catalog-item-add {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
}
.catalog-item:hover .catalog-item-add {
  color: #00ff88;
}

.active-components-section {
  margin-top: 24px;
  border-top: 1px solid var(--border-color);
  padding-top: 16px;
}
.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.active-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.active-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  font-size: 11px;
  background: rgba(255,255,255,0.01);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
}
.active-item:hover {
  border-color: var(--color-highlight);
}
.active-item-selected {
  background: rgba(56, 189, 248, 0.05);
  border-color: rgba(56, 189, 248, 0.5);
  color: var(--color-highlight);
}

/* Center Area */
.center-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #080c14;
}
.workspace-tabs {
  display: flex;
  background-color: #0b0f19;
  border-bottom: 1px solid var(--border-color);
}
.tab-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}
.tab-btn:hover {
  color: #fff;
  background: rgba(255,255,255,0.02);
}
.tab-btn.active {
  color: var(--color-highlight);
  border-bottom-color: var(--color-highlight);
  background: rgba(56, 189, 248, 0.02);
}
.tab-icon {
  width: 14px;
  height: 14px;
}
.workspace-content {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #080c14;
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
}
.peripherals-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
.peripherals-layer > .canvas-peripheral-wrapper {
  pointer-events: auto;
}
.sim-grid-container {
  padding: 20px;
  height: 100%;
}
.virtual-peripherals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;
}
.grid-card {
  background: #0f172a;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
}
.card-header {
  background: #1e293b;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}
.card-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}
.card-body {
  padding: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* Right Panel */
.right-panel {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color);
  border-right: none;
}
.inspector-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.property-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-group label {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--text-secondary);
  font-weight: 600;
}
.input, .select {
  background: #0f172a;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: #fff;
  outline: none;
  transition: border-color 0.2s;
}
.input:focus, .select:focus {
  border-color: var(--color-highlight);
}
.checkbox-group {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.checkbox-group input {
  margin: 0;
}
.checkbox-group label {
  text-transform: none;
  font-size: 12px;
  color: var(--text-primary);
  font-weight: normal;
}
.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-secondary);
}
.slider-label .val {
  color: var(--color-highlight);
  font-family: var(--font-mono);
}
.slider {
  -webkit-appearance: none;
  background: rgba(255,255,255,0.05);
  height: 4px;
  border-radius: 2px;
  outline: none;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-highlight);
  cursor: pointer;
}

.danger-checkbox {
  margin-top: 12px;
  border: 1px solid rgba(255,74,90,0.2);
  padding: 8px;
  border-radius: 6px;
  background: rgba(255,74,90,0.02);
}
.danger-checkbox label {
  color: var(--color-danger);
  font-weight: 500;
}

/* Bottom Console Panel */
.bottom-panel {
  height: 180px;
  border-top: 1px solid var(--border-color);
  background-color: #0b0f19;
  display: flex;
  flex-direction: column;
}
.tabs-header {
  padding: 0;
  background: #0e1422;
}
.tabs-header .tab-btn {
  padding: 8px 16px;
  border-radius: 0;
}
.tab-content {
  flex: 1;
  background: #050b11;
  padding: 10px;
  font-size: 11px;
}
.console {
  height: 100%;
}
.empty-console {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: var(--text-muted);
}
.trace-list, .log-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.trace-line {
  display: flex;
  gap: 12px;
  color: var(--text-secondary);
}
.trace-time {
  color: var(--text-muted);
}
.trace-seq {
  color: #3b82f6;
}
.trace-type {
  font-weight: 600;
  color: #f8fafc;
}
.trace-details {
  color: var(--text-muted);
}

.trace-gpio {
  color: #00ff88;
}
.trace-i2c {
  color: #a855f7;
}
.trace-danger {
  color: var(--color-danger);
}

.console-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.log-line {
  display: flex;
  gap: 12px;
}
.log-time {
  color: var(--text-muted);
}
.log-log {
  color: var(--text-secondary);
}
.log-info {
  color: var(--color-highlight);
}
.log-warn {
  color: var(--color-warn);
}
.log-error {
  color: var(--color-danger);
}

/* Button & Common styling rules */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}
.btn .icon {
  width: 14px;
  height: 14px;
}
.btn-running {
  background: var(--color-accent);
  color: #050b11;
  box-shadow: 0 0 8px rgba(0,255,136,0.3);
}
.btn-running:hover {
  background: var(--color-accent-hover);
}
.btn-paused {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-color);
  color: var(--text-secondary);
}
.btn-paused:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-color);
  color: var(--text-secondary);
}
.btn-secondary:hover:not(:disabled) {
  background: rgba(255,255,255,0.08);
  color: #fff;
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-small {
  padding: 3px 8px;
  font-size: 10px;
}

.btn-icon {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-icon:hover {
  background: rgba(255,255,255,0.05);
}
.btn-icon .icon {
  width: 14px;
  height: 14px;
}
.icon-danger {
  color: var(--text-muted);
}
.btn-icon:hover .icon-danger {
  color: var(--color-danger);
}
.empty-state {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 10px;
  border: 1px dashed var(--border-color);
  border-radius: 4px;
}

/* Animations Trigger */
.anim-glow-success {
  animation: pulse-glow 2s infinite;
}
.anim-glow-danger {
  animation: pulse-glow-danger 1.5s infinite;
}
</style>

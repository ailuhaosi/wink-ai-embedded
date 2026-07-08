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
          <div v-show="activeTab === 'canvas'" class="canvas-container">
            <svg class="circuit-svg" width="100%" height="100%" viewBox="0 0 800 500">
              <!-- Grid background -->
              <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.02)" stroke-width="1" />
                </pattern>
                <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />

              <!-- ESP32 Board Node -->
              <g transform="translate(300, 150)" class="board-node">
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
              <g v-for="comp in activeComponents" :key="'wire-' + comp.id">
                <!-- Primary / signal wire -->
                <path 
                  :d="getWirePath(comp, 'primary')" 
                  fill="none" 
                  :stroke="getWireColor(comp)" 
                  stroke-width="2.5" 
                  filter="url(#neon-glow)"
                />
                <!-- SCL wire (for OLED only) -->
                <path 
                  v-if="comp.type === 'oled'"
                  :d="getWirePath(comp, 'secondary')" 
                  fill="none" 
                  stroke="#c084fc" 
                  stroke-width="2.5" 
                  filter="url(#neon-glow)"
                />
                <!-- VCC Power wires (for OLED and Ultrasonic) -->
                <path 
                  v-if="comp.type === 'oled' || comp.type === 'ultrasonic'"
                  :d="getWirePath(comp, 'vcc')" 
                  fill="none" 
                  stroke="#ef4444" 
                  stroke-width="2.5" 
                  filter="url(#neon-glow)"
                />
                <!-- GND Ground wires (for all peripherals) -->
                <path 
                  :d="getWirePath(comp, 'gnd')" 
                  fill="none" 
                  stroke="#475569" 
                  stroke-width="2.5" 
                  filter="url(#neon-glow)"
                />
              </g>
            </svg>

            <!-- Real-time Interactive Peripherals Positioned on Canvas -->
            <div 
              v-for="comp in activeComponents" 
              :key="'canvas-comp-' + comp.id"
              :style="{
                position: 'absolute',
                left: `${getCanvasX(comp)}px`,
                top: `${getCanvasY(comp)}px`,
                zIndex: 10
              }"
              @click="selectComponent(comp)"
              class="canvas-peripheral-wrapper"
              :class="{ 'selected-peripheral': selectedCompId === comp.id }"
            >
              <!-- Raw visual components on the Canvas -->
              <wokwi-led 
                v-if="comp.type === 'led'"
                :color="comp.color"
                :value="pinStates[comp.pin] || false"
              />
              <wokwi-pushbutton
                v-else-if="comp.type === 'button'"
                :color="comp.color"
                @button-press="setPinIdeal(comp.pin, comp.activeLow ? false : true)"
                @button-release="setPinIdeal(comp.pin, comp.activeLow ? true : false)"
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
                    :pin="comp.pin"
                    :color="(comp.color as any)"
                    :level="pinStates[comp.pin] || false"
                  />
                  <VirtualButton
                    v-else-if="comp.type === 'button'"
                    :pin="comp.pin"
                    :color="(comp.color as any)"
                    :activeLow="comp.activeLow"
                  />
                  <VirtualOLED
                    v-else-if="comp.type === 'oled'"
                    :framebuffer="oledFb"
                  />
                  <VirtualUltrasonic
                    v-else-if="comp.type === 'ultrasonic'"
                    :pin="comp.pin"
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

              <!-- LED properties -->
              <template v-if="selectedComp.type === 'led'">
                <div class="form-group">
                  <label>GPIO Pin</label>
                  <select v-model.number="selectedComp.pin" class="select font-mono">
                    <option :value="13">IO13 (Recommended)</option>
                    <option :value="12">IO12</option>
                    <option :value="14">IO14</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Color</label>
                  <select v-model="selectedComp.color" class="select">
                    <option value="red">Red</option>
                    <option value="green">Green</option>
                    <option value="blue">Blue</option>
                    <option value="yellow">Yellow</option>
                    <option value="white">White</option>
                    <option value="orange">Orange</option>
                  </select>
                </div>
              </template>

              <!-- Button properties -->
              <template v-if="selectedComp.type === 'button'">
                <div class="form-group">
                  <label>GPIO Pin</label>
                  <select v-model.number="selectedComp.pin" class="select font-mono">
                    <option :value="14">IO14 (Recommended)</option>
                    <option :value="12">IO12</option>
                    <option :value="13">IO13</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Button Cap Color</label>
                  <select v-model="selectedComp.color" class="select">
                    <option value="red">Red</option>
                    <option value="green">Green</option>
                    <option value="blue">Blue</option>
                    <option value="yellow">Yellow</option>
                    <option value="white">White</option>
                    <option value="black">Black</option>
                  </select>
                </div>
                <div class="form-group checkbox-group">
                  <input type="checkbox" v-model="selectedComp.activeLow" id="activeLow" />
                  <label for="activeLow">Active Low (Pull-Up)</label>
                </div>
              </template>

              <!-- Ultrasonic properties -->
              <template v-if="selectedComp.type === 'ultrasonic'">
                <div class="form-group">
                  <label>Trig/Echo Pin</label>
                  <select v-model.number="selectedComp.pin" class="select font-mono">
                    <option :value="12">IO12 (Recommended)</option>
                    <option :value="13">IO13</option>
                    <option :value="14">IO14</option>
                  </select>
                </div>
                <div class="form-group">
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
              </template>
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
import { ref, computed, watch, onMounted } from 'vue';
import { 
  Play, Pause, RotateCcw, Cpu, Layers, Settings, Zap, Terminal, Activity, Plus, Trash
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
  pin: number;
  color?: string;
  activeLow?: boolean;
}

// Scaffolding components list
const catalog = ref<CatalogItem[]>([
  { type: 'led', name: 'Virtual LED', desc: 'Outputs HIGH/LOW voltage state.' },
  { type: 'button', name: 'Push Button', desc: 'Injects HIGH/LOW ideal digital inputs.' },
  { type: 'oled', name: 'SSD1306 Display', desc: '128x64 pixels screen using I2C lines.' },
  { type: 'ultrasonic', name: 'HC-SR04 Sensor', desc: 'Ultrasonic distance range sensor.' }
]);

const activeComponents = ref<ComponentInstance[]>([
  { id: 'led1', type: 'led', name: 'Virtual LED', pin: 13, color: 'red' },
  { id: 'btn1', type: 'button', name: 'Push Button', pin: 14, color: 'green', activeLow: true },
  { id: 'oled1', type: 'oled', name: 'SSD1306 Display', pin: 21 }, // Maps to SDA=21, SCL=22
  { id: 'sonar1', type: 'ultrasonic', name: 'HC-SR04 Sensor', pin: 12 } // echo pin 12
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
    setUltrasonicDistance(sonar.pin, dist as number);
  }
}, { deep: true, immediate: true });

// Component management
function addComponent(item: CatalogItem) {
  const newId = `${item.type}_${Date.now()}`;
  let pin = 12;
  
  if (item.type === 'led') pin = 13;
  else if (item.type === 'button') pin = 14;
  else if (item.type === 'oled') pin = 21;
  
  const newItem: ComponentInstance = {
    id: newId,
    type: item.type,
    name: item.name,
    pin
  };
  
  if (item.type === 'led' || item.type === 'button') {
    newItem.color = 'red';
  }
  if (item.type === 'button') {
    newItem.activeLow = true;
  }
  
  activeComponents.value.push(newItem);
  selectedCompId.value = newId;
}

function removeComponent(id: string) {
  activeComponents.value = activeComponents.value.filter(c => c.id !== id);
  if (selectedCompId.value === id && activeComponents.value.length > 0) {
    selectedCompId.value = activeComponents.value[0].id;
  }
}

function selectComponent(comp: ComponentInstance) {
  selectedCompId.value = comp.id;
}

function getPinLabel(comp: ComponentInstance) {
  if (comp.type === 'oled') return 'SDA:21/SCL:22';
  return comp.pin.toString();
}

// Watch active components to register them in worker
watch(activeComponents, (comps) => {
  const pins: number[] = [];
  let oledActive = false;
  
  comps.forEach(c => {
    if (c.type === 'led') pins.push(c.pin);
    if (c.type === 'button') pins.push(c.pin);
    if (c.type === 'ultrasonic') pins.push(c.pin);
    if (c.type === 'oled') oledActive = true;
  });
  
  observePins(pins, oledActive);
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
    // Re-register components and restart
    const pins: number[] = [];
    let oledActive = false;
    activeComponents.value.forEach(c => {
      if (c.type === 'led') pins.push(c.pin);
      if (c.type === 'button') pins.push(c.pin);
      if (c.type === 'ultrasonic') pins.push(c.pin);
      if (c.type === 'oled') oledActive = true;
    });
    observePins(pins, oledActive);
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
  // If wire cut, inject Hi-Z (false state) on LED pin 13 to mock cut wire
  const led = activeComponents.value.find(c => c.type === 'led');
  if (led) {
    setPinIdeal(led.pin, !wireBroken.value);
  }
}

// Canvas layouts helpers
function getCanvasX(comp: ComponentInstance): number {
  if (comp.type === 'led') return 80;
  if (comp.type === 'button') return 80;
  if (comp.type === 'oled') return 580;
  if (comp.type === 'ultrasonic') return 80;
  return 50;
}

function getCanvasY(comp: ComponentInstance): number {
  if (comp.type === 'led') return 80;
  if (comp.type === 'button') return 220;
  if (comp.type === 'oled') return 120;
  if (comp.type === 'ultrasonic') return 360;
  return 50;
}

function getWireColor(comp: ComponentInstance): string {
  if (comp.type === 'led') return '#00ff88';
  if (comp.type === 'button') return '#38bdf8';
  if (comp.type === 'oled') return '#a855f7';
  if (comp.type === 'ultrasonic') return '#eab308';
  return '#ffffff';
}

function getWirePath(comp: ComponentInstance, mode: 'primary' | 'secondary' | 'vcc' | 'gnd' = 'primary'): string {
  const peripheralX = getCanvasX(comp);
  const peripheralY = getCanvasY(comp);
  
  let startX = peripheralX;
  let startY = peripheralY + 40;
  
  // Board input pins
  let destX = 307;
  let destY = 272; // default to GND
  
  if (comp.type === 'led') {
    if (mode === 'primary') {
      startX = peripheralX + 25;
      startY = peripheralY + 42; // Anode
      
      const targetPin = comp.pin;
      if (targetPin === 12) { destX = 307; destY = 182; }
      else if (targetPin === 13) { destX = 307; destY = 212; }
      else if (targetPin === 14) { destX = 307; destY = 242; }
    } else if (mode === 'gnd') {
      startX = peripheralX + 15;
      startY = peripheralY + 42; // Cathode
      destX = 307;
      destY = 272; // GND
    }
  } 
  
  else if (comp.type === 'button') {
    if (mode === 'primary') {
      startX = peripheralX + 67;
      startY = peripheralY + 13; // Right pin (1.r)
      
      const targetPin = comp.pin;
      if (targetPin === 12) { destX = 307; destY = 182; }
      else if (targetPin === 13) { destX = 307; destY = 212; }
      else if (targetPin === 14) { destX = 307; destY = 242; }
    } else if (mode === 'gnd') {
      startX = peripheralX + 0;
      startY = peripheralY + 13; // Left pin (1.l)
      destX = 307;
      destY = 272; // GND
    }
  } 
  
  else if (comp.type === 'oled') {
    if (mode === 'primary') {
      startX = peripheralX + 36.5;
      startY = peripheralY + 12.5; // SDA
      destX = 477;
      destY = 182; // IO21
    } else if (mode === 'secondary') {
      startX = peripheralX + 45.5;
      startY = peripheralY + 12.5; // SCL
      destX = 477;
      destY = 212; // IO22
    } else if (mode === 'vcc') {
      startX = peripheralX + 83.5;
      startY = peripheralY + 12.5; // 3V3
      destX = 477;
      destY = 242; // 3V3
    } else if (mode === 'gnd') {
      startX = peripheralX + 103.5;
      startY = peripheralY + 12; // GND
      destX = 307;
      destY = 272; // GND
    }
  } 
  
  else if (comp.type === 'ultrasonic') {
    if (mode === 'primary') {
      startX = peripheralX + 91.3;
      startY = peripheralY + 94.5; // Echo
      
      const targetPin = comp.pin;
      if (targetPin === 12) { destX = 307; destY = 182; }
      else if (targetPin === 13) { destX = 307; destY = 212; }
      else if (targetPin === 14) { destX = 307; destY = 242; }
    } else if (mode === 'vcc') {
      startX = peripheralX + 71.3;
      startY = peripheralY + 94.5; // VCC
      destX = 477;
      destY = 242; // 3V3
    } else if (mode === 'gnd') {
      startX = peripheralX + 101.3;
      startY = peripheralY + 94.5; // GND
      destX = 307;
      destY = 272; // GND
    }
  }
  
  return `M ${startX} ${startY} C ${(startX+destX)/2} ${startY}, ${(startX+destX)/2} ${destY}, ${destX} ${destY}`;
}

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
});
</script>

<style scoped>
.canvas-peripheral-wrapper {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  cursor: pointer;
  border-radius: 8px;
}
.canvas-peripheral-wrapper:hover {
  transform: scale(1.03) translateY(-2px);
  box-shadow: 0 8px 16px rgba(56, 189, 248, 0.25);
  filter: brightness(1.1);
}
.selected-peripheral {
  outline: 2px solid var(--color-highlight);
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.4);
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
}
.canvas-container {
  width: 100%;
  height: 100%;
}
.circuit-svg {
  display: block;
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

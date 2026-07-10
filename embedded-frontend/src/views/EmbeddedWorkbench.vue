<template>
  <div class="workbench">
    <TopBar
      v-if="!legacyMode"
      @mode-change="handleModeChange"
      @toggle-simulation="toggleSimulation"
      @reset="handleReset"
      @tidy="tidyRouting"
      @replay-onboarding="replayOnboarding"
      @save-project="onSaveProject"
      @open-project="onOpenProject"
    />

    <!-- Legacy Top Control Bar -->
    <header v-else class="top-bar">
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
          <span class="text-sm font-mono text-gray-400">45° PCB Trace</span>
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

        <button @click="tidyRouting" class="btn btn-secondary btn-small" title="重置走线并整理布局">
          <LayoutGrid class="icon" />
          <span>Tidy Wires</span>
        </button>

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

    <div class="main-layout" :class="{ 'left-collapsed': !legacyMode && layoutStore.leftPanelCollapsed }">
      <!-- Left Panel: Layered Asset Library (W2) or legacy catalog -->
      <aside v-show="legacyMode || !layoutStore.leftPanelCollapsed" class="panel left-panel">
        <template v-if="legacyMode">
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
        </template>
        <template v-else>
          <div class="panel-header">
            <Layers class="panel-header-icon" />
            <span>{{ t('workbench.assets.peripherals') }}</span>
          </div>
          <div class="panel-content scrollable">
            <LayeredAssetLibrary @add-peripheral="addFromLibrary" />
          </div>
        </template>
      </aside>

      <!-- Center Workspace (Canvas and Visuals) -->
      <main class="center-workspace">
        <div v-if="legacyMode" class="workspace-tabs">
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

        <SplitPane
          v-if="!legacyMode"
          class="workspace-split"
          :direction="layoutStore.splitDirection"
          :ratio="layoutStore.splitRatio"
          :animate="modeAnimating"
          @ratio-change="onSplitRatioChange"
        >
          <template #primary>
            <CircuitCanvas
              ref="circuitCanvasRef"
              v-model:components="activeComponents"
              v-model:selected-component-id="selectedCompId"
              :pin-states="pinStates"
              :readonly="!modeStore.canEditCircuit"
              :routing-mode="routingMode"
              @button-press="handleButtonPress"
              @button-release="handleButtonRelease"
              @layout-change="syncCanvasToManifest"
            />
          </template>
          <template #secondary>
            <div class="world-pane scrollable">
              <ProductWorldPlaceholder @load-template="onLoadTemplate" />
              <div v-if="modeStore.current !== 'design'" class="virtual-peripherals-grid">
                <div v-for="comp in activeComponents" :key="'sim-' + comp.id" class="grid-card">
                  <div class="card-header"><span class="card-title">{{ comp.name }}</span></div>
                  <div class="card-body">
                    <VirtualLED v-if="comp.type === 'led'" :pin-connections="comp.pinConnections" :color="comp.props.color" :level="typeof comp.pinConnections.A === 'number' ? pinStates[comp.pinConnections.A] || false : false" :brightness="comp.props.brightness" :label="comp.props.label" :flip="comp.props.flip" />
                    <VirtualButton v-else-if="comp.type === 'button'" :pin-connections="comp.pinConnections" :color="comp.props.color" :label="comp.props.label" :xray="comp.props.xray" :active-low="comp.props.activeLow" />
                    <VirtualOLED v-else-if="comp.type === 'oled'" :pin-connections="comp.pinConnections" :framebuffer="oledFb" />
                    <VirtualUltrasonic v-else-if="comp.type === 'ultrasonic'" :pin-connections="comp.pinConnections" :distance="comp.props.distance" />
                  </div>
                </div>
              </div>
            </div>
          </template>
        </SplitPane>

        <div v-else class="workspace-content">
          <!-- Canvas Tab -->
          <div v-show="activeTab === 'canvas'">
            <CircuitCanvas
              ref="circuitCanvasRef"
              v-model:components="activeComponents"
              v-model:selected-component-id="selectedCompId"
              :pin-states="pinStates"
              :readonly="!modeStore.canEditCircuit"
              :routing-mode="routingMode"
              @button-press="handleButtonPress"
              @button-release="handleButtonRelease"
              @layout-change="syncCanvasToManifest"
            />
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

      <ContextInspector v-if="!legacyMode" class="panel right-panel">
        <template #circuit>
          <div class="inspector-section">
            <div class="section-title">Property Inspector</div>
            
            <div v-if="!selectedComp" class="empty-state">
              Select a peripheral on the left or click canvas node to edit properties.
            </div>
            
            <div v-else class="property-form">
              <div class="form-group">
                <label>Component Name</label>
                <input type="text" v-model="selectedComp.name" class="input" :disabled="!modeStore.canEditCircuit" />
              </div>

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
                  :disabled="!modeStore.canEditCircuit"
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

              <div class="section-title">Properties</div>
              <div 
                v-for="(propDef, propKey) in peripheralConfigs[selectedComp.type]?.props" 
                :key="propKey"
                class="form-group"
              >
                <label>{{ propDef.description }}</label>
                <select v-if="propDef.options" v-model="selectedComp.props[propKey]" class="select" :disabled="!modeStore.canEditCircuit">
                  <option v-for="opt in propDef.options" :key="opt" :value="opt">{{ opt }}</option>
                </select>
                <input 
                  v-else-if="propDef.type === 'number'" 
                  type="number" 
                  v-model.number="selectedComp.props[propKey]" 
                  class="input font-mono"
                  :disabled="!modeStore.canEditCircuit"
                />
                <input 
                  v-else-if="propDef.type === 'boolean'" 
                  type="checkbox" 
                  v-model="selectedComp.props[propKey]"
                  :disabled="!modeStore.canEditCircuit"
                />
                <input 
                  v-else 
                  type="text" 
                  v-model="selectedComp.props[propKey]" 
                  class="input"
                  :disabled="!modeStore.canEditCircuit"
                />
              </div>

              <div v-if="selectedComp.type === 'ultrasonic'" class="form-group">
                <div class="slider-label">
                  <span>Distance (cm):</span>
                  <span class="val">{{ ultrasonicDistance }} cm</span>
                </div>
                <input type="range" min="2" max="400" v-model.number="ultrasonicDistance" class="slider" />
              </div>

              <div class="form-group">
                <label>Rotation</label>
                <div class="rotation-btn-group">
                  <button
                    v-for="deg in [0, 90, 180, 270]"
                    :key="deg"
                    @click="setRotation(selectedComp, deg)"
                    class="rotation-btn"
                    :class="{ active: (selectedComp.rotation || 0) === deg }"
                    :disabled="!modeStore.canEditCircuit"
                  >
                    {{ deg }}°
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template #bindings>
          <BindingsInspector />
        </template>
        <template #diagnostics>
          <BindingsInspector />
        </template>
        <template #faults>
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
                <input type="range" min="0" max="5000" step="50" v-model.number="faults.sample_interval_us" @input="injectFaults" class="slider" />
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
        </template>
      </ContextInspector>

      <!-- Legacy Right Panel -->
      <aside v-else class="panel right-panel">
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

    <div
      v-if="!legacyMode && modeSwitchBanner"
      class="mode-switch-banner"
      role="alert"
    >
      {{ modeSwitchBanner }}
    </div>

    <BottomConsole v-if="!legacyMode" />

    <!-- Legacy Bottom Panel -->
    <footer v-else class="bottom-panel">
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

    <ConfirmDialog
      :visible="showStopConfirm"
      @confirm="confirmStopSimulation"
      @cancel="cancelStopSimulation"
    />
    <OnboardingWizard
      v-if="!legacyMode"
      ref="onboardingRef"
      @complete="onOnboardingComplete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { 
  Play, Pause, RotateCcw, Cpu, Layers, Settings, Zap, Terminal, Activity, Plus, Trash, MousePointer2, LayoutGrid
} from 'lucide-vue-next';
import {
  initSimulation, startSimulation, pauseSimulation, resetSimulation,
  setPinIdeal, observePins, setFaults, setSpeed, clearLogs, setUltrasonicDistance,
  isInitialized, isRunning, isFaulted, clockUs, pinStates, oledFb, logs, traces
} from '../services/simulation-client';

import TopBar from '@/components/layout/TopBar.vue';
import SplitPane from '@/components/layout/SplitPane.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import BottomConsole from '@/components/console/BottomConsole.vue';
import ContextInspector from '@/components/inspector/ContextInspector.vue';
import BindingsInspector from '@/components/inspector/BindingsInspector.vue';
import LayeredAssetLibrary from '@/components/asset-library/LayeredAssetLibrary.vue';
import ProductWorldPlaceholder from '@/components/world/ProductWorldPlaceholder.vue';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard.vue';
import { resetOnboarding } from '@/composables/useOnboarding';
import { useWorkbenchModeStore } from '@/stores/workbench-mode.store';
import { useLayoutStore } from '@/stores/layout.store';
import { useCanvasStore } from '@/stores/canvas.store';
import { useSimulationStore } from '@/stores/simulation.store';
import { useInspectorStore } from '@/stores/inspector.store';
import { useProjectStore } from '@/stores/project.store';
import {
  createWorkbenchTemplateManifest,
  isOledDashboardTemplate,
} from '@/services/manifest-patch.service';
import { downloadManifest, readManifestFromFile } from '@/services/manifest.service';
import { manifestToCanvas } from '@/services/manifest-to-canvas.service';
import type { EmbeddedProjectManifest } from '@/types/manifest-v2';

import VirtualLED from '../components/VirtualLED.vue';
import VirtualButton from '../components/VirtualButton.vue';
import VirtualOLED from '../components/VirtualOLED.vue';
import VirtualUltrasonic from '../components/VirtualUltrasonic.vue';
import CircuitCanvas from '@/components/circuit/CircuitCanvas.vue';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import {
  peripheralConfigs,
  getDefaultPinConnections,
  getDefaultProps,
  availableGPIOs,
  powerOptions,
} from '../types/peripheral-pins';

const { t } = useI18n();
const legacyMode = import.meta.env.VITE_LEGACY_SIM_TAB === 'true';
const modeStore = useWorkbenchModeStore();
const layoutStore = useLayoutStore();
const canvasStore = useCanvasStore();
const simStore = useSimulationStore();
const inspectorStore = useInspectorStore();
const projectStore = useProjectStore();
const { pendingSwitchTarget } = storeToRefs(modeStore);

const modeAnimating = ref(false);
const modeSwitchBanner = ref<string | null>(null);
const pendingSimulateAfterInit = ref(false);
let modeSwitchBannerTimer: ReturnType<typeof setTimeout> | null = null;
const showStopConfirm = computed(() => pendingSwitchTarget.value === 'design');

const routingMode = computed({
  get: () => canvasStore.routingMode,
  set: (mode: 'auto' | 'manual') => canvasStore.setRoutingMode(mode),
});

// Local Types
interface CatalogItem {
  type: string;
  name: string;
  desc: string;
}

const circuitCanvasRef = ref<InstanceType<typeof CircuitCanvas> | null>(null);
const onboardingRef = ref<InstanceType<typeof OnboardingWizard> | null>(null);

function setRoutingMode(mode: 'auto' | 'manual') {
  canvasStore.setRoutingMode(mode);
}

function tidyRouting() {
  circuitCanvasRef.value?.tidyRouting();
}

// Scaffolding components list
const catalog = ref<CatalogItem[]>([
  { type: 'led', name: 'Virtual LED', desc: 'Outputs HIGH/LOW voltage state.' },
  { type: 'button', name: 'Push Button', desc: 'Injects HIGH/LOW ideal digital inputs.' },
  { type: 'oled', name: 'SSD1306 Display', desc: '128x64 pixels screen using I2C lines.' },
  { type: 'ultrasonic', name: 'HC-SR04 Sensor', desc: 'Ultrasonic distance range sensor.' }
]);


const activeComponents = ref<CircuitComponentInstance[]>([]);

const selectedCompId = ref<string>('');
const selectedComp = computed(() => activeComponents.value.find(c => c.id === selectedCompId.value));

const activeTab = ref<'canvas' | 'sim'>('canvas');
const bottomTab = ref<'traces' | 'logs'>('traces');
const simSpeed = ref<number>(1);
const wireBroken = ref<boolean>(false);

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
  const canvasOled = circuitCanvasRef.value?.canvasOledRef;
  const oledEl = Array.isArray(canvasOled)
    ? canvasOled.find(el => el && el.tagName === 'WOKWI-SSD1306')
    : canvasOled;
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
  const sonar = (comps as CircuitComponentInstance[]).find(c => c.type === 'ultrasonic');
  if (sonar) {
    const trigPin = sonar.pinConnections.TRIG;
    const echoPin = sonar.pinConnections.ECHO;
    if (typeof trigPin === 'number' && typeof echoPin === 'number') {
      setUltrasonicDistance(trigPin, echoPin, dist as number);
    }
  }
}, { deep: true, immediate: true });

function addFromLibrary(payload: { type: string; name: string }) {
  addComponent({ type: payload.type, name: payload.name, desc: '' });
}

// Component management
function addComponent(item: CatalogItem) {
  if (!modeStore.canEditCircuit) return;
  const newId = `${item.type}_${Date.now()}`;
  
  const newItem: CircuitComponentInstance = {
    id: newId,
    type: item.type,
    name: item.name,
    pinConnections: getDefaultPinConnections(item.type),
    props: getDefaultProps(item.type),
    rotation: 0
  };
  
  activeComponents.value.push(newItem);
  selectedCompId.value = newId;
  circuitCanvasRef.value?.assignLayoutForNewComponent(newId, item.type);
}

function removeComponent(id: string) {
  activeComponents.value = activeComponents.value.filter(c => c.id !== id);
  circuitCanvasRef.value?.removeLayoutForComponent(id);
  if (selectedCompId.value === id && activeComponents.value.length > 0) {
    selectedCompId.value = activeComponents.value[0].id;
  }
}

function selectComponent(comp: CircuitComponentInstance) {
  circuitCanvasRef.value?.selectComponent(comp);
}

function setRotation(comp: CircuitComponentInstance, deg: number) {
  circuitCanvasRef.value?.setRotation(comp, deg);
}

function rotateComponent(comp: CircuitComponentInstance, delta: number) {
  circuitCanvasRef.value?.rotateComponent(comp, delta);
}

function handleButtonPress(comp: CircuitComponentInstance) {
  const signalPin = comp.pinConnections['1.l'];
  if (typeof signalPin === 'number') {
    setPinIdeal(signalPin, comp.props.activeLow ? false : true);
  }
}

function handleButtonRelease(comp: CircuitComponentInstance) {
  const signalPin = comp.pinConnections['1.l'];
  if (typeof signalPin === 'number') {
    setPinIdeal(signalPin, comp.props.activeLow ? true : false);
  }
}

function getPinLabel(comp: CircuitComponentInstance) {
  const connections = comp.pinConnections;
  const digitalPins = Object.entries(connections)
    .filter(([, val]) => typeof val === 'number')
    .map(([name, val]) => `${name}:${val}`);
  if (digitalPins.length === 0) return 'No GPIO';
  return digitalPins.join(', ');
}

function syncCanvasToManifest() {
  const positions = circuitCanvasRef.value?.getLayoutPositions() ?? {};
  projectStore.syncFromCanvas(activeComponents.value, positions);
}

// Watch active components to register them in worker + sync manifest
watch(activeComponents, (comps) => {
  const positions = circuitCanvasRef.value?.getLayoutPositions() ?? {};
  projectStore.syncFromCanvas(comps, positions);
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

function syncSimulationFromCanvas() {
  const pins: number[] = [];
  activeComponents.value.forEach((c) => {
    Object.values(c.pinConnections).forEach((val) => {
      if (typeof val === 'number') {
        pins.push(val);
      }
    });
  });
  observePins(pins, activeComponents.value);
  injectFaults();
}

// Simulation handlers
function toggleSimulation() {
  if (isRunning.value) {
    pauseSimulation();
    return;
  }
  if (!isInitialized.value) {
    const msg = simStore.initError ?? t('workbench.staticCheck.notInitialized');
    showModeSwitchBanner(msg);
    return;
  }
  syncSimulationFromCanvas();
  startSimulation();
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

// Helpers
function formatTime(val: string | number | bigint): string {
  const us = typeof val === 'number' ? BigInt(val) : BigInt(val.toString());
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
function buildStaticCheckContext() {
  return {
    isSimulationReady: isInitialized.value,
    initError: simStore.initError,
    components: activeComponents.value.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      pinConnections: c.pinConnections,
    })),
  };
}

function showModeSwitchBanner(message: string) {
  modeSwitchBanner.value = message;
  if (modeSwitchBannerTimer) clearTimeout(modeSwitchBannerTimer);
  modeSwitchBannerTimer = setTimeout(() => {
    modeSwitchBanner.value = null;
  }, 6000);
}

async function handleModeChange(mode: 'design' | 'simulate' | 'diagnose'): Promise<boolean> {
  modeAnimating.value = true;
  const ok = await modeStore.switchTo(mode, buildStaticCheckContext());
  if (ok) {
    pendingSimulateAfterInit.value = false;
    modeSwitchBanner.value = null;
  } else if (mode === 'simulate') {
    const bindingIssues = modeStore.lastBindingValidationIssues;
    if (bindingIssues.length > 0) {
      showModeSwitchBanner(`[${bindingIssues[0].ruleId}] ${bindingIssues[0].message}`);
    } else {
      const issues = modeStore.lastStaticCheckIssues;
      const waitingForSim = issues.some((issue) => issue.id === 'sim-not-ready');
      if (waitingForSim) {
        pendingSimulateAfterInit.value = true;
        showModeSwitchBanner(t('workbench.staticCheck.waitingForEngine'));
      } else if (issues.length > 0) {
        showModeSwitchBanner(t(issues[0].message));
      } else {
        showModeSwitchBanner(t('workbench.staticCheck.failed'));
      }
    }
  }
  setTimeout(() => {
    modeAnimating.value = false;
    // Mode change animates split/bottom heights — rescale after layout settles.
    circuitCanvasRef.value?.updateCanvasScale();
  }, 320);
  return ok;
}

function onSplitRatioChange(ratio: number) {
  layoutStore.setSplitRatio(ratio);
  modeStore.markRatioOverridden();
  requestAnimationFrame(() => circuitCanvasRef.value?.updateCanvasScale());
}

function applyManifestToWorkbench(manifest: EmbeddedProjectManifest) {
  projectStore.setManifest(manifest);
  const { components, layoutPositions } = manifestToCanvas(manifest);
  activeComponents.value = components;
  selectedCompId.value = components[0]?.id ?? '';

  const sonar = components.find((c) => c.type === 'ultrasonic');
  if (sonar && typeof sonar.props.distance === 'number') {
    ultrasonicDistance.value = sonar.props.distance;
  }

  void nextTick(() => {
    if (Object.keys(layoutPositions).length > 0) {
      circuitCanvasRef.value?.setLayoutPositions(layoutPositions);
    } else {
      for (const comp of components) {
        circuitCanvasRef.value?.assignLayoutForNewComponent(comp.id, comp.type);
      }
    }
    circuitCanvasRef.value?.updateCanvasScale();
  });
}

function onSaveProject() {
  syncCanvasToManifest();
  downloadManifest(projectStore.manifest);
  showModeSwitchBanner(t('workbench.project.saved'));
}

async function onOpenProject(file: File) {
  try {
    const manifest = await readManifestFromFile(file);
    applyManifestToWorkbench(manifest);
    showModeSwitchBanner(t('workbench.project.loaded'));
  } catch (err) {
    const message = err instanceof Error ? err.message : t('workbench.project.loadError');
    showModeSwitchBanner(`${t('workbench.project.loadError')}: ${message}`);
  }
}

function onLoadTemplate(templateId: string) {
  const manifest = createWorkbenchTemplateManifest(templateId);
  if (!manifest) return;

  applyManifestToWorkbench(manifest);

  if (isOledDashboardTemplate(templateId)) {
    selectedCompId.value = 'btn1';
    faults.value = { ...faults.value, bounce_us: 0, i2c_drop_permil: 0 };
  } else {
    ultrasonicDistance.value = 25;
  }

  modeStore.setDesignSubMode('structure-first');
  if (isInitialized.value) {
    syncSimulationFromCanvas();
  }
}

function confirmStopSimulation() {
  modeStore.confirmPendingSwitch();
}

function cancelStopSimulation() {
  modeStore.cancelPendingSwitch();
}

async function onOnboardingComplete() {
  const ok = await handleModeChange('simulate');
  if (ok) toggleSimulation();
}

function replayOnboarding() {
  resetOnboarding();
  onboardingRef.value?.restart();
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === '\\') {
    event.preventDefault();
    layoutStore.splitDirection = layoutStore.splitDirection === 'horizontal' ? 'vertical' : 'horizontal';
    requestAnimationFrame(() => circuitCanvasRef.value?.updateCanvasScale());
  }
}

let resizeTimer: ReturnType<typeof setTimeout> | null = null;

function handleWindowResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    layoutStore.updateResponsiveLayout(window.innerWidth);
    circuitCanvasRef.value?.updateCanvasScale();
  }, 100);
}

watch(isInitialized, (ready) => {
  if (!ready) return;
  syncSimulationFromCanvas();
  if (pendingSimulateAfterInit.value) {
    void handleModeChange('simulate');
  }
});

onMounted(() => {
  simStore.init();
  layoutStore.applyModeDefaults(modeStore.current);
  layoutStore.updateResponsiveLayout(window.innerWidth);
  window.addEventListener('resize', handleWindowResize);
  window.addEventListener('keydown', onGlobalKeydown);

  requestAnimationFrame(() => {
    circuitCanvasRef.value?.updateCanvasScale();
  });
});

onUnmounted(() => {
  if (modeSwitchBannerTimer) clearTimeout(modeSwitchBannerTimer);
  window.removeEventListener('resize', handleWindowResize);
  window.removeEventListener('keydown', onGlobalKeydown);
});
</script>

<style scoped>
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

.workbench {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background-color: #080c14;
  overflow: hidden;
}

.mode-switch-banner {
  flex-shrink: 0;
  padding: 8px 16px;
  background: rgba(255, 74, 90, 0.12);
  border-bottom: 1px solid rgba(255, 74, 90, 0.35);
  color: #fecaca;
  font-size: 13px;
  text-align: center;
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
  min-height: 0;
  display: flex;
  overflow: hidden;
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
.workspace-split {
  flex: 1;
  min-height: 0;
}
.world-pane {
  height: 100%;
  overflow: auto;
  background: #0a0f18;
}
.main-layout.left-collapsed .left-panel {
  display: none;
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

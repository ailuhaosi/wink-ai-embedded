<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { Layers } from 'lucide-vue-next';
import {
  startSimulation,
  pauseSimulation,
  resetSimulation,
  setPinIdeal,
  observePins,
  setFaults,
  setUltrasonicDistance,
  syncIdleGpioFromComponents,
} from '../services/simulation-client';
import { pinStates, oledFb } from '../services/simulation-runtime';

import TopBar from '@/components/layout/TopBar.vue';
import SplitPane from '@/components/layout/SplitPane.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import BottomConsole from '@/components/console/BottomConsole.vue';
import ContextInspector from '@/components/inspector/ContextInspector.vue';
import BindingsInspector from '@/components/inspector/BindingsInspector.vue';
import LayeredAssetLibrary from '@/components/asset-library/LayeredAssetLibrary.vue';
import ProductWorldPlaceholder from '@/components/world/ProductWorldPlaceholder.vue';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard.vue';
import WorkbenchPropertyInspector from '@/components/workbench/WorkbenchPropertyInspector.vue';
import WorkbenchFaultInjector from '@/components/workbench/WorkbenchFaultInjector.vue';
import SimulationErrorBanner from '@/components/workbench/SimulationErrorBanner.vue';
import ErrorBoundary from '@/components/ErrorBoundary.vue';
import { resetOnboarding } from '@/composables/useOnboarding';
import { WorkbenchModeId } from '@/constants/workbench-mode';
import type { WorkbenchModeValue } from '@/constants/workbench-mode';
import { useWorkbenchModeStore } from '@/stores/workbench-mode.store';
import { useLayoutStore } from '@/stores/layout.store';
import { useSimulationStore } from '@/stores/simulation.store';
import { useProjectStore } from '@/stores/project.store';
import {
  createWorkbenchTemplateManifest,
  isOledDashboardTemplate,
} from '@/services/manifest-patch.service';
import { downloadManifest, readManifestFromFile } from '@/services/manifest.service';
import { manifestToCanvas } from '@/services/manifest-to-canvas.service';
import type { EmbeddedProjectManifest } from '@/types/manifest-v2';

import WorldPeripheralsPane from '@/components/peripherals/WorldPeripheralsPane.vue';
import CircuitCanvas from '@/components/circuit/CircuitCanvas.vue';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import {
  getDefaultPinConnections,
  getDefaultProps,
} from '@/peripherals';

const { t } = useI18n();
const modeStore = useWorkbenchModeStore();
const layoutStore = useLayoutStore();
const simStore = useSimulationStore();
const projectStore = useProjectStore();
const { pendingSwitchTarget } = storeToRefs(modeStore);
const { isInitialized, isRunning } = storeToRefs(simStore);

const modeAnimating = ref(false);
const modeSwitchBanner = ref<string | null>(null);
const pendingSimulateAfterInit = ref(false);
let modeSwitchBannerTimer: ReturnType<typeof setTimeout> | null = null;
const showStopConfirm = computed(() => pendingSwitchTarget.value === WorkbenchModeId.Design);

const circuitCanvasRef = ref<InstanceType<typeof CircuitCanvas> | null>(null);
const onboardingRef = ref<InstanceType<typeof OnboardingWizard> | null>(null);

const activeComponents = ref<CircuitComponentInstance[]>([]);

const selectedCompId = ref<string>('');
const selectedComp = computed(() => activeComponents.value.find(c => c.id === selectedCompId.value));

const wireBroken = ref<boolean>(false);
const ultrasonicDistance = ref<number>(25);

const faults = ref({
  bounce_us: 0,
  warmup_us: 0,
  sample_interval_us: 1000,
  adc_noise_v: 0.0,
  rc_tau_s: 0.0,
  i2c_drop_permil: 0,
  prng_seed: 1,
});

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
  addComponent(payload);
}

function addComponent(item: { type: string; name: string }) {
  if (!modeStore.canEditCircuit) return;
  const newId = `${item.type}_${Date.now()}`;

  const newItem: CircuitComponentInstance = {
    id: newId,
    type: item.type,
    name: item.name,
    pinConnections: getDefaultPinConnections(item.type),
    props: getDefaultProps(item.type),
    rotation: 0,
  };

  activeComponents.value.push(newItem);
  selectedCompId.value = newId;
  circuitCanvasRef.value?.assignLayoutForNewComponent(newId, item.type);
}

function setRotation(comp: CircuitComponentInstance, deg: number) {
  circuitCanvasRef.value?.setRotation(comp, deg);
}

function handleButtonPress(comp: CircuitComponentInstance) {
  const signalPin = comp.pinConnections['1.l'];
  if (typeof signalPin === 'number') {
    setPinIdeal(signalPin, !comp.props.activeLow);
  }
}

function handleButtonRelease(comp: CircuitComponentInstance) {
  const signalPin = comp.pinConnections['1.l'];
  if (typeof signalPin === 'number') {
    setPinIdeal(signalPin, !!comp.props.activeLow);
  }
}

function syncCanvasToManifest() {
  const positions = circuitCanvasRef.value?.getLayoutPositions() ?? {};
  projectStore.commitCanvasSnapshot(activeComponents.value, positions);
}

watch(activeComponents, (comps) => {
  const positions = circuitCanvasRef.value?.getLayoutPositions() ?? {};
  projectStore.commitCanvasSnapshot(comps, positions);
  observePins(comps);
}, { deep: true, immediate: true });

function syncSimulationFromCanvas() {
  observePins(activeComponents.value);
  syncIdleGpioFromComponents(activeComponents.value);
  injectFaults();
}

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
    observePins(activeComponents.value);
    syncIdleGpioFromComponents(activeComponents.value);
    injectFaults();
  }, 100);
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

function buildStaticCheckContext() {
  return {
    isSimulationReady: isInitialized.value,
    initError: simStore.initError,
    components: activeComponents.value.map(c => ({
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

async function handleModeChange(mode: WorkbenchModeValue): Promise<boolean> {
  modeAnimating.value = true;
  const ok = await modeStore.switchTo(mode, buildStaticCheckContext());
  if (ok) {
    pendingSimulateAfterInit.value = false;
    modeSwitchBanner.value = null;
  }
  else if (mode === WorkbenchModeId.Simulate) {
    const bindingIssues = modeStore.lastBindingValidationIssues;
    if (bindingIssues.length > 0) {
      showModeSwitchBanner(`[${bindingIssues[0].ruleId}] ${bindingIssues[0].message}`);
    }
    else {
      const issues = modeStore.lastStaticCheckIssues;
      const waitingForSim = issues.some(issue => issue.id === 'sim-not-ready');
      if (waitingForSim) {
        pendingSimulateAfterInit.value = true;
        showModeSwitchBanner(t('workbench.staticCheck.waitingForEngine'));
      }
      else if (issues.length > 0) {
        showModeSwitchBanner(t(issues[0].message));
      }
      else {
        showModeSwitchBanner(t('workbench.staticCheck.failed'));
      }
    }
  }
  setTimeout(() => {
    modeAnimating.value = false;
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

  const sonar = components.find(c => c.type === 'ultrasonic');
  if (sonar && typeof sonar.props.distance === 'number') {
    ultrasonicDistance.value = sonar.props.distance;
  }

  void nextTick(() => {
    if (Object.keys(layoutPositions).length > 0) {
      circuitCanvasRef.value?.setLayoutPositions(layoutPositions);
    }
    else {
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
  }
  catch (err) {
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
  }
  else {
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
  const ok = await handleModeChange(WorkbenchModeId.Simulate);
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
    void handleModeChange(WorkbenchModeId.Simulate);
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

<template>
  <div class="workbench">
    <TopBar
      @mode-change="handleModeChange"
      @toggle-simulation="toggleSimulation"
      @reset="handleReset"
      @replay-onboarding="replayOnboarding"
      @save-project="onSaveProject"
      @open-project="onOpenProject"
    />

    <SimulationErrorBanner />

    <div class="main-layout" :class="{ 'left-collapsed': layoutStore.leftPanelCollapsed }">
      <aside v-show="!layoutStore.leftPanelCollapsed" class="panel left-panel">
        <div class="panel-header">
          <Layers class="panel-header-icon" />
          <span>{{ t('workbench.assets.peripherals') }}</span>
        </div>
        <div class="panel-content scrollable">
          <LayeredAssetLibrary @add-peripheral="addFromLibrary" />
        </div>
      </aside>

      <main class="center-workspace">
        <SplitPane
          class="workspace-split"
          :direction="layoutStore.splitDirection"
          :ratio="layoutStore.splitRatio"
          :animate="modeAnimating"
          @ratio-change="onSplitRatioChange"
        >
          <template #primary>
            <ErrorBoundary>
              <CircuitCanvas
                ref="circuitCanvasRef"
                v-model:components="activeComponents"
                v-model:selected-component-id="selectedCompId"
                :pin-states="pinStates"
                :readonly="!modeStore.canEditCircuit"
                @button-press="handleButtonPress"
                @button-release="handleButtonRelease"
                @layout-change="syncCanvasToManifest"
              />
            </ErrorBoundary>
          </template>
          <template #secondary>
            <ErrorBoundary>
              <div class="world-pane scrollable">
                <ProductWorldPlaceholder @load-template="onLoadTemplate" />
                <WorldPeripheralsPane
                  v-if="modeStore.current !== WorkbenchModeId.Design"
                  :components="activeComponents"
                  :pin-states="pinStates"
                  :oled-fb="oledFb"
                />
              </div>
            </ErrorBoundary>
          </template>
        </SplitPane>
      </main>

      <ContextInspector class="panel right-panel">
        <template #circuit>
          <WorkbenchPropertyInspector
            :selected-comp="selectedComp"
            :can-edit="modeStore.canEditCircuit"
            v-model:ultrasonic-distance="ultrasonicDistance"
            @set-rotation="setRotation"
          />
        </template>
        <template #bindings>
          <BindingsInspector />
        </template>
        <template #diagnostics>
          <BindingsInspector />
        </template>
        <template #faults>
          <WorkbenchFaultInjector
            v-model:faults="faults"
            v-model:wire-broken="wireBroken"
            @inject="injectFaults"
            @toggle-wire-break="toggleWireBreak"
          />
        </template>
      </ContextInspector>
    </div>

    <div
      v-if="modeSwitchBanner"
      class="mode-switch-banner"
      role="alert"
    >
      {{ modeSwitchBanner }}
    </div>

    <BottomConsole />

    <ConfirmDialog
      :visible="showStopConfirm"
      @confirm="confirmStopSimulation"
      @cancel="cancelStopSimulation"
    />
    <OnboardingWizard
      ref="onboardingRef"
      @complete="onOnboardingComplete"
    />
  </div>
</template>

<style scoped>
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

.left-panel {
  width: 240px;
  flex-shrink: 0;
}

.center-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #080c14;
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

.right-panel {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color);
  border-right: none;
}
</style>

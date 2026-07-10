import { defineStore } from 'pinia';
import { useLayoutStore } from './layout.store';
import { useInspectorStore } from './inspector.store';
import { useProjectStore, isManifestSchemaV2Enabled } from './project.store';
import { staticCheckService } from '../services/static-check.service';
import type { StaticCheckContext } from '../services/static-check.service';
import {
  isBlockingResult,
  validateBindings,

} from '../services/binding-validation.service';
import type { ValidationResult } from '../services/binding-validation.service';
import { deviceCatalog } from '@/catalog/device-catalog';
import { bindingPinResolver } from '@/services/binding-pin-resolver';
import { useSimulationStore } from './simulation.store';

export type WorkbenchMode = 'design' | 'simulate' | 'diagnose';
export type DesignSubMode = 'circuit-first' | 'structure-first';

interface ModeState {
  current: WorkbenchMode;
  previous: WorkbenchMode | null;
  designSubMode: DesignSubMode;
  userOverriddenRatio: boolean;
  pendingSwitchTarget: WorkbenchMode | null;
  lastStaticCheckIssues: ReturnType<typeof staticCheckService.runDetailed>['issues'];
  lastBindingValidationIssues: ValidationResult[];
}

export async function canEnterSimulate(context?: StaticCheckContext): Promise<boolean> {
  const simStore = useSimulationStore();
  const checkContext: StaticCheckContext = context ?? {
    isSimulationReady: simStore.isInitialized,
    initError: simStore.initError,
    components: [],
  };

  const staticResult = staticCheckService.runDetailed(checkContext);
  if (!staticResult.ok) return false;

  if (!isManifestSchemaV2Enabled()) return true;

  const projectStore = useProjectStore();
  if (checkContext.components.length > 0) {
    projectStore.syncFromCanvas(
      checkContext.components.map(c => ({
        id: c.id,
        type: c.type,
        name: c.name,
        pinConnections: c.pinConnections as Record<
          string,
          number | 'VCC' | '3V3' | 'GND' | null
        >,
        props: {},
        rotation: 0,
      })),
    );
  }
  const results = validateBindings(
    projectStore.manifest,
    { targetMode: 'simulate', blockingOnly: true },
    { catalog: deviceCatalog, pinResolver: bindingPinResolver },
  );
  const blocking = results.filter(r => isBlockingResult(r, { targetMode: 'simulate' }));
  return blocking.length === 0;
}

export const useWorkbenchModeStore = defineStore('workbench-mode', {
  state: (): ModeState => ({
    current: 'design',
    previous: null,
    designSubMode: 'circuit-first',
    userOverriddenRatio: false,
    pendingSwitchTarget: null,
    lastStaticCheckIssues: [],
    lastBindingValidationIssues: [],
  }),

  getters: {
    canEditCircuit: state => state.current === 'design',
    canEditMechanical: state => state.current === 'design',
    canEditEnvironment: state => state.current !== 'diagnose',
    canEditFaults: state => state.current !== 'design',
    showTransportControls: state => state.current !== 'design',
  },

  actions: {
    setDesignSubMode(subMode: DesignSubMode) {
      this.designSubMode = subMode;
      if (!this.userOverriddenRatio) {
        useLayoutStore().applyModeDefaults(this.current);
      }
    },

    markRatioOverridden() {
      this.userOverriddenRatio = true;
    },

    async switchTo(
      target: WorkbenchMode,
      context?: StaticCheckContext,
    ): Promise<boolean> {
      if (target === this.current) return true;

      if (target === 'simulate' && this.current !== 'simulate') {
        const simStore = useSimulationStore();
        const checkContext: StaticCheckContext = context ?? {
          isSimulationReady: simStore.isInitialized,
          initError: simStore.initError,
          components: [],
        };

        const staticResult = staticCheckService.runDetailed(checkContext);
        if (!staticResult.ok) {
          this.lastStaticCheckIssues = staticResult.issues;
          this.lastBindingValidationIssues = [];
          const layout = useLayoutStore();
          layout.bottomPanelExpanded = true;
          layout.bottomPanelActiveTab = 'static-check';
          return false;
        }
        this.lastStaticCheckIssues = [];

        if (isManifestSchemaV2Enabled()) {
          const projectStore = useProjectStore();
          if (checkContext.components.length > 0) {
            projectStore.syncFromCanvas(
              checkContext.components.map(c => ({
                id: c.id,
                type: c.type,
                name: c.name,
                pinConnections: c.pinConnections as Record<string, number | 'VCC' | '3V3' | 'GND' | null>,
                props: {},
                rotation: 0,
              })),
            );
          }

          const results = validateBindings(
            projectStore.manifest,
            { targetMode: 'simulate', blockingOnly: true },
            { catalog: deviceCatalog, pinResolver: bindingPinResolver },
          );
          const blocking = results.filter(r =>
            isBlockingResult(r, { targetMode: 'simulate' }),
          );

          if (blocking.length > 0) {
            this.lastBindingValidationIssues = blocking;
            projectStore.lastValidationResults = validateBindings(
              projectStore.manifest,
              { targetMode: 'simulate' },
              { catalog: deviceCatalog, pinResolver: bindingPinResolver },
            );
            const layout = useLayoutStore();
            layout.bottomPanelExpanded = true;
            layout.activateBottomTab('diagnostics');
            useInspectorStore().activateTab('diagnostics', true);
            return false;
          }
          this.lastBindingValidationIssues = [];
        }
      }

      if (target === 'design' && this.current === 'simulate') {
        this.pendingSwitchTarget = target;
        return false;
      }

      return this.commitSwitch(target);
    },

    confirmPendingSwitch(): boolean {
      if (!this.pendingSwitchTarget) return false;
      const target = this.pendingSwitchTarget;
      this.pendingSwitchTarget = null;
      if (target === 'design') {
        useSimulationStore().stopAndClear();
      }
      return this.commitSwitch(target);
    },

    cancelPendingSwitch() {
      this.pendingSwitchTarget = null;
    },

    commitSwitch(target: WorkbenchMode): boolean {
      this.previous = this.current;
      this.current = target;
      useLayoutStore().applyModeDefaults(target);
      return true;
    },

    resetToDesign() {
      this.previous = this.current;
      this.current = 'design';
      this.pendingSwitchTarget = null;
      useSimulationStore().stopAndClear();
      useLayoutStore().applyModeDefaults('design');
    },
  },
});

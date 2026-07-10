import { defineStore } from 'pinia';
import { useLayoutStore } from './layout.store';
import { staticCheckService, type StaticCheckContext } from '../services/static-check.service';
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
}

export const useWorkbenchModeStore = defineStore('workbench-mode', {
  state: (): ModeState => ({
    current: 'design',
    previous: null,
    designSubMode: 'circuit-first',
    userOverriddenRatio: false,
    pendingSwitchTarget: null,
    lastStaticCheckIssues: [],
  }),

  getters: {
    canEditCircuit: (state) => state.current === 'design',
    canEditMechanical: (state) => state.current === 'design',
    canEditEnvironment: (state) => state.current !== 'diagnose',
    canEditFaults: (state) => state.current !== 'design',
    showTransportControls: (state) => state.current !== 'design',
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

      // W1 gate: entering simulate from design (or diagnose→simulate after edit) needs static check.
      // diagnose → simulate is allowed without re-check only when already validated earlier;
      // still run check if context is provided so UI stays consistent.
      if (target === 'simulate' && this.current !== 'simulate') {
        const simStore = useSimulationStore();
        const checkContext: StaticCheckContext = context ?? {
          isSimulationReady: simStore.isInitialized,
          components: [],
        };
        const result = staticCheckService.runDetailed(checkContext);
        if (!result.ok) {
          this.lastStaticCheckIssues = result.issues;
          const layout = useLayoutStore();
          layout.bottomPanelExpanded = true;
          layout.bottomPanelActiveTab = 'static-check';
          return false;
        }
        this.lastStaticCheckIssues = [];
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

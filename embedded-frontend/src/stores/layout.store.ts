import { defineStore } from 'pinia';
import type { WorkbenchMode } from './workbench-mode.store';
import { useWorkbenchModeStore } from './workbench-mode.store';

export type BottomPanelTab = 'trace' | 'causal' | 'logs' | 'build' | 'static-check' | 'diagnostics';
export type RightPanelMode = 'full' | 'icon';
export type SplitDirection = 'horizontal' | 'vertical';
export type PipPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface LayoutState {
  splitDirection: SplitDirection;
  splitRatio: number;
  leftPanelCollapsed: boolean;
  leftPanelCollapsedBeforeSimulate: boolean;
  rightPanelCollapsed: boolean;
  rightPanelMode: RightPanelMode;
  bottomPanelHeight: number;
  bottomPanelExpanded: boolean;
  bottomPanelUserResized: boolean;
  bottomPanelActiveTab: BottomPanelTab;
  pipEnabled: boolean;
  pipPosition: PipPosition;
  pipScale: number;
}

export const useLayoutStore = defineStore('layout', {
  state: (): LayoutState => ({
    splitDirection: 'horizontal',
    splitRatio: 0.7,
    leftPanelCollapsed: false,
    leftPanelCollapsedBeforeSimulate: false,
    rightPanelCollapsed: false,
    rightPanelMode: 'full',
    bottomPanelHeight: 200,
    bottomPanelExpanded: true,
    bottomPanelUserResized: false,
    bottomPanelActiveTab: 'static-check',
    pipEnabled: false,
    pipPosition: 'bottom-right',
    pipScale: 0.3,
  }),

  actions: {
    applyModeDefaults(mode: WorkbenchMode) {
      const modeStore = useWorkbenchModeStore();

      if (!modeStore.userOverriddenRatio) {
        const ratioByMode: Record<WorkbenchMode, number> = {
          design: modeStore.designSubMode === 'structure-first' ? 0.3 : 0.7,
          simulate: 0.4,
          diagnose: 0.5,
        };
        this.splitRatio = ratioByMode[mode];
      }

      if (!this.bottomPanelUserResized) {
        const heightByMode: Record<WorkbenchMode, number> = {
          design: 0.25,
          simulate: 0.3,
          diagnose: 0.5,
        };
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
        this.bottomPanelHeight = Math.round(viewportHeight * heightByMode[mode]);
      }

      const tabByMode: Record<WorkbenchMode, BottomPanelTab> = {
        design: 'static-check',
        simulate: 'trace',
        diagnose: 'causal',
      };
      this.bottomPanelActiveTab = tabByMode[mode];

      if (mode === 'simulate') {
        this.leftPanelCollapsedBeforeSimulate = this.leftPanelCollapsed;
        this.leftPanelCollapsed = true;
        this.bottomPanelExpanded = true;
      }

      if (mode === 'design') {
        this.leftPanelCollapsed = this.leftPanelCollapsedBeforeSimulate;
      }
    },

    setSplitRatio(ratio: number) {
      this.splitRatio = ratio;
    },

    setBottomPanelHeight(height: number) {
      this.bottomPanelHeight = height;
      this.bottomPanelUserResized = true;
    },

    activateBottomTab(tab: BottomPanelTab) {
      this.bottomPanelActiveTab = tab;
      this.bottomPanelExpanded = true;
    },

    resetLayout() {
      this.$reset();
      useWorkbenchModeStore().userOverriddenRatio = false;
      this.bottomPanelUserResized = false;
    },

    updateResponsiveLayout(windowWidth: number) {
      if (windowWidth < 1440) {
        this.rightPanelMode = 'icon';
        this.rightPanelCollapsed = true;
      }
      else {
        this.rightPanelMode = 'full';
        this.rightPanelCollapsed = false;
      }
    },
  },

  persist: {
    key: 'wink-layout',
    pick: [
      'splitDirection',
      'splitRatio',
      'leftPanelCollapsed',
      'rightPanelCollapsed',
      'bottomPanelHeight',
      'bottomPanelUserResized',
      'bottomPanelActiveTab',
      'pipEnabled',
      'pipPosition',
      'pipScale',
    ],
  },
});

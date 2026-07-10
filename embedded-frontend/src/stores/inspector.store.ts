import { defineStore } from 'pinia';

export type InspectorTabId
  = | 'circuit'
    | 'mechanical'
    | 'bindings'
    | 'environment'
    | 'faults'
    | 'diagnostics';

interface InspectorState {
  activeTab: InspectorTabId;
  pinnedTab: InspectorTabId | null;
  userPinned: boolean;
}

export const useInspectorStore = defineStore('inspector', {
  state: (): InspectorState => ({
    activeTab: 'circuit',
    pinnedTab: null,
    userPinned: false,
  }),

  actions: {
    activateTab(tab: InspectorTabId, force = false) {
      if (!force && this.pinnedTab && this.pinnedTab !== tab) return;
      this.activeTab = tab;
    },

    pinTab(tab: InspectorTabId) {
      this.pinnedTab = this.pinnedTab === tab ? null : tab;
      this.userPinned = this.pinnedTab !== null;
      if (this.pinnedTab) {
        this.activeTab = tab;
      }
    },

    focusForSelection(kind: 'circuit' | 'mechanical' | 'environment' | 'binding' | null) {
      const tabMap: Record<string, InspectorTabId> = {
        circuit: 'circuit',
        mechanical: 'mechanical',
        environment: 'environment',
        binding: 'bindings',
      };
      if (!kind) return;
      const tab = tabMap[kind];
      if (tab) this.activateTab(tab);
    },
  },
});

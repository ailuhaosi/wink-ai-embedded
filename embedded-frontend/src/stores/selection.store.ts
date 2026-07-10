import { defineStore } from 'pinia';

export type SelectionKind = 'circuit' | 'mechanical' | 'environment' | 'binding' | null;

interface SelectionState {
  selectedComponentId: string | null;
  selectedWireId: string | null;
  selectionKind: SelectionKind;
}

export const useSelectionStore = defineStore('selection', {
  state: (): SelectionState => ({
    selectedComponentId: null,
    selectedWireId: null,
    selectionKind: null,
  }),

  actions: {
    selectComponent(id: string | null) {
      this.selectedComponentId = id;
      this.selectedWireId = null;
      this.selectionKind = id ? 'circuit' : null;
    },

    selectWire(id: string | null) {
      this.selectedWireId = id;
      this.selectionKind = id ? 'circuit' : null;
    },

    clear() {
      this.selectedComponentId = null;
      this.selectedWireId = null;
      this.selectionKind = null;
    },
  },
});

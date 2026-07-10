import { defineStore } from 'pinia';

interface CanvasState {
  showGrid: boolean;
  showRoutingDebug: boolean;
}

export const useCanvasStore = defineStore('canvas', {
  state: (): CanvasState => ({
    showGrid: true,
    showRoutingDebug: false,
  }),

  actions: {
    toggleGrid() {
      this.showGrid = !this.showGrid;
    },
  },
});

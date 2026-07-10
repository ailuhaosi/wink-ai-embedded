import { defineStore } from 'pinia';

interface CanvasState {
  routingMode: 'auto' | 'manual';
  showGrid: boolean;
  showRoutingDebug: boolean;
}

export const useCanvasStore = defineStore('canvas', {
  state: (): CanvasState => ({
    routingMode: 'auto',
    showGrid: true,
    showRoutingDebug: false,
  }),

  actions: {
    setRoutingMode(mode: 'auto' | 'manual') {
      this.routingMode = mode;
    },

    toggleGrid() {
      this.showGrid = !this.showGrid;
    },
  },
});

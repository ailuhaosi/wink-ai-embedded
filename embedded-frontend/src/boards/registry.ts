import type {
  BoardCanvasDescriptor,
  BoardDefinition,
  BoardRegistry,
} from './types';

const boards = new Map<string, BoardDefinition>();

export const boardRegistry: BoardRegistry = {
  register(def) {
    boards.set(def.id, def);
  },

  get(id) {
    return boards.get(id);
  },

  list() {
    return Array.from(boards.values());
  },

  getCanvasDescriptor(id) {
    return boards.get(id)?.canvas;
  },
};

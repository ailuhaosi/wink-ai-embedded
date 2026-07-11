export interface BoardPinLayout {
  x: number;
  y: number;
}

/** Canvas layout for a fixed board region (not a draggable peripheral). */
export interface BoardCanvasDescriptor {
  x: number;
  y: number;
  width: number;
  height: number;
  pins: Record<number, BoardPinLayout>;
  powerPins: Record<string, BoardPinLayout>;
}

export interface BoardDefinition {
  id: string;
  displayName: string;
  gpioPins: number[];
  canvas: BoardCanvasDescriptor;
}

export interface BoardRegistry {
  register: (def: BoardDefinition) => void;
  get: (id: string) => BoardDefinition | undefined;
  list: () => BoardDefinition[];
  getCanvasDescriptor: (id: string) => BoardCanvasDescriptor | undefined;
}

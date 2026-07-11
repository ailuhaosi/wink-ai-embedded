import { boardRegistry } from './registry';
import { esp32DevkitV1Definition } from './esp32-devkit-v1/definition';

boardRegistry.register(esp32DevkitV1Definition);

export { boardRegistry } from './registry';
export type {
  BoardCanvasDescriptor,
  BoardDefinition,
  BoardPinLayout,
  BoardRegistry,
} from './types';

/** Default workbench board canvas layout (single-board workbench today). */
export function getDefaultBoardCanvasDescriptor() {
  return boardRegistry.getCanvasDescriptor(esp32DevkitV1Definition.id);
}

export const DEFAULT_BOARD_ID = esp32DevkitV1Definition.id;

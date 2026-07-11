import type { ActuatorMapping, SensorMapping } from '@/types/mapping-registry';
import '@/peripherals';
import { registry } from '@/peripherals';
import { definitionToCatalogEntry } from '@/catalog/derive-catalog-entry';
import { boardToCatalogEntry } from '@/catalog/derive-board-catalog-entry';
import '@/world-assets';
import { worldRegistry } from '@/world-assets';
import '@/boards';
import { boardRegistry } from '@/boards';

export { definitionToCatalogEntry, pinsToCatalogPins } from '@/catalog/derive-catalog-entry';
export { boardToCatalogEntry } from '@/catalog/derive-board-catalog-entry';

export type PinSignalType = 'pwm' | 'gpio' | 'digital_in' | 'digital_out' | 'i2c' | 'power';

export type WorldCoupling = 'none' | 'optional' | 'required';

export interface CatalogPinDef {
  name: string;
  type: PinSignalType;
  description?: string;
}

export interface DeviceCatalogEntry {
  id: string;
  displayName: string;
  category: 'board' | 'peripheral' | 'stub';
  /** Canvas peripheral type when dragged from library (undefined for boards) */
  canvasType?: string;
  pins: CatalogPinDef[];
  simulation?: {
    worldCoupling: WorldCoupling;
    allowedActuatorMappings?: ActuatorMapping['type'][];
    allowedSensorMappings?: SensorMapping['type'][];
  };
}

export interface BoardCatalogEntry {
  id: string;
  displayName: string;
  gpioPins: number[];
}

export interface DeviceCatalog {
  getDevice: (modelId: string) => DeviceCatalogEntry | undefined;
  getBoard: (boardId: string) => BoardCatalogEntry | undefined;
  listDevices: () => DeviceCatalogEntry[];
  listBoards: () => BoardCatalogEntry[];
  listMechanicalModels: () => Array<{ id: string; displayName: string }>;
  listEnvironmentModels: () => Array<{ id: string; displayName: string }>;
}

function mergeDevices(): DeviceCatalogEntry[] {
  const fromBoards = boardRegistry.list().map(boardToCatalogEntry);
  const fromRegistry = registry
    .list()
    .filter((d) => d.catalog)
    .map(definitionToCatalogEntry);
  return [...fromBoards, ...fromRegistry];
}

/** Maps canvas peripheral type → catalog modelId (rebuilt from static + registry). */
export const CANVAS_TYPE_TO_MODEL: Record<string, string> = {};
for (const d of mergeDevices()) {
  if (d.canvasType) CANVAS_TYPE_TO_MODEL[d.canvasType] = d.id;
}

export const deviceCatalog: DeviceCatalog = {
  getDevice(modelId: string) {
    return mergeDevices().find((d) => d.id === modelId);
  },
  getBoard(boardId: string) {
    const board = boardRegistry.get(boardId);
    if (!board) return undefined;
    return {
      id: board.id,
      displayName: board.displayName,
      gpioPins: board.gpioPins,
    };
  },
  listDevices() {
    return mergeDevices();
  },
  listBoards() {
    return boardRegistry.list().map(b => ({
      id: b.id,
      displayName: b.displayName,
      gpioPins: b.gpioPins,
    }));
  },
  listMechanicalModels() {
    return worldRegistry.listMechanical().map(m => ({
      id: m.id,
      displayName: m.displayName,
    }));
  },
  listEnvironmentModels() {
    return worldRegistry.listEnvironment().map(e => ({
      id: e.id,
      displayName: e.displayName,
    }));
  },
};

export function modelIdForCanvasType(canvasType: string): string {
  const entry = mergeDevices().find((d) => d.canvasType === canvasType);
  return entry?.id ?? canvasType;
}

export function canvasTypeForModelId(modelId: string): string | undefined {
  return deviceCatalog.getDevice(modelId)?.canvasType;
}

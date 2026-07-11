import type { BoardDefinition } from '@/boards/types';
import type { DeviceCatalogEntry } from '@/catalog/device-catalog';

export function boardToCatalogEntry(def: BoardDefinition): DeviceCatalogEntry {
  return {
    id: def.id,
    displayName: def.displayName,
    category: 'board',
    pins: [],
    simulation: { worldCoupling: 'none' },
  };
}

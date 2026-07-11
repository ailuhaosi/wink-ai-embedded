import type { ActuatorMapping, SensorMapping } from '@/types/mapping-registry';
import type { PeripheralDefinition, UnifiedPinDef } from '@/peripherals/types';
import type {
  CatalogPinDef,
  DeviceCatalogEntry,
  WorldCoupling,
} from '@/catalog/device-catalog';

export function pinsToCatalogPins(pins: UnifiedPinDef[]): CatalogPinDef[] {
  return pins.map((p) => ({
    name: p.name,
    type: p.catalogType,
    ...(p.description !== undefined ? { description: p.description } : {}),
  }));
}

export function definitionToCatalogEntry(def: PeripheralDefinition): DeviceCatalogEntry {
  const catalog = def.catalog!;
  const entry: DeviceCatalogEntry = {
    id: catalog.id,
    displayName: def.displayName,
    category: 'peripheral',
    canvasType: def.type,
    pins: pinsToCatalogPins(def.pins),
    simulation: { worldCoupling: catalog.worldCoupling as WorldCoupling },
  };
  if (catalog.allowedActuatorMappings) {
    entry.simulation!.allowedActuatorMappings =
      catalog.allowedActuatorMappings as ActuatorMapping['type'][];
  }
  if (catalog.allowedSensorMappings) {
    entry.simulation!.allowedSensorMappings =
      catalog.allowedSensorMappings as SensorMapping['type'][];
  }
  return entry;
}

import {
  canvasTypeForModelId,
  deviceCatalog,
} from '@/catalog/device-catalog';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type {
  ConnectionEntry,
  ConnectionPinRef,
  EmbeddedProjectManifest,
} from '@/types/manifest-v2';
import {
  getDefaultPinConnections,
  getDefaultProps,

} from '@/types/peripheral-pins';
import type { PinConnectionValue } from '@/types/peripheral-pins';
import { parsePinRef } from '@/services/connection-normalize';

export interface ManifestToCanvasResult {
  components: CircuitComponentInstance[];
  layoutPositions: Record<string, { x: number; y: number }>;
}

/** Legacy / schema aliases → catalog modelId */
const MODEL_ID_ALIASES: Record<string, string> = {
  'push-button': 'button_stub',
  'ssd1306': 'oled_stub',
};

function resolveCatalogModelId(modelId: string): string {
  return MODEL_ID_ALIASES[modelId] ?? modelId;
}

function resolveCanvasType(modelId: string): string | undefined {
  return canvasTypeForModelId(resolveCatalogModelId(modelId));
}

const BOARD_COMPONENT_PREFIX = '__board__';

function boardComponentId(manifest: EmbeddedProjectManifest): string {
  return `${BOARD_COMPONENT_PREFIX}${manifest.target.boardId}`;
}

function isBoardEndpoint(
  manifest: EmbeddedProjectManifest,
  componentId: string,
): boolean {
  return (
    componentId === manifest.target.boardId
    || componentId === boardComponentId(manifest)
    || componentId === 'esp32'
  );
}

function parseConnectionEndpoints(
  entry: ConnectionEntry,
): { from: ConnectionPinRef; to: ConnectionPinRef } {
  return {
    from: typeof entry.from === 'string' ? parsePinRef(entry.from) : entry.from,
    to: typeof entry.to === 'string' ? parsePinRef(entry.to) : entry.to,
  };
}

function parseGpioPin(pinName: string): number | null {
  const m = /^GPIO(\d+)$/i.exec(pinName);
  if (m) return Number(m[1]);
  const n = Number(pinName);
  return Number.isFinite(n) ? n : null;
}

function parseBoardPinValue(pinName: string): PinConnectionValue | null {
  const gpio = parseGpioPin(pinName);
  if (gpio !== null) return gpio;
  if (pinName === 'VCC' || pinName === '3V3' || pinName === 'GND') {
    return pinName;
  }
  return null;
}

function applyConnectionToPinMap(
  manifest: EmbeddedProjectManifest,
  pinMap: Record<string, PinConnectionValue>,
  deviceComponentId: string,
  entry: ConnectionEntry,
): void {
  const { from, to } = parseConnectionEndpoints(entry);

  let devicePin: string | null = null;
  let boardPin: string | null = null;

  if (from.componentId === deviceComponentId && isBoardEndpoint(manifest, to.componentId)) {
    devicePin = from.pin;
    boardPin = to.pin;
  }
  else if (to.componentId === deviceComponentId && isBoardEndpoint(manifest, from.componentId)) {
    devicePin = to.pin;
    boardPin = from.pin;
  }

  if (!devicePin || !boardPin) return;

  const value = parseBoardPinValue(boardPin);
  if (value !== null) {
    pinMap[devicePin] = value;
  }
}

function buildPropsFromDevice(
  canvasType: string,
  properties?: Record<string, unknown>,
): Record<string, unknown> {
  const props = { ...getDefaultProps(canvasType) };
  if (!properties) return props;

  const config = Object.keys(props);
  for (const key of config) {
    if (key in properties) {
      props[key] = properties[key];
    }
  }
  return props;
}

/**
 * Hydrate circuit canvas components from Manifest devices + connections.
 */
export function manifestToCanvas(
  manifest: EmbeddedProjectManifest,
): ManifestToCanvasResult {
  const components: CircuitComponentInstance[] = [];
  const layoutPositions: Record<string, { x: number; y: number }> = {};

  for (const device of manifest.devices) {
    const catalogModelId = resolveCatalogModelId(device.modelId);
    const entry = deviceCatalog.getDevice(catalogModelId);
    if (!entry || entry.category === 'board') continue;

    const canvasType = resolveCanvasType(device.modelId);
    if (!canvasType) continue;

    const pinConnections = { ...getDefaultPinConnections(canvasType) };

    for (const conn of manifest.connections) {
      applyConnectionToPinMap(manifest, pinConnections, device.componentId, conn);
    }

    components.push({
      id: device.componentId,
      type: canvasType,
      name: device.displayName ?? entry.displayName,
      pinConnections,
      props: buildPropsFromDevice(canvasType, device.properties),
      rotation: device.rotation ?? 0,
    });

    if (device.position) {
      layoutPositions[device.componentId] = { ...device.position };
    }
  }

  return { components, layoutPositions };
}

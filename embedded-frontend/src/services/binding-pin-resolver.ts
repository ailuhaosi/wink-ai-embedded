import type {
  ActuatorBinding,
  ConnectionEntry,
  EmbeddedProjectManifest,
  SensorBinding,
} from '@/types/manifest-v2';
import { deviceCatalog } from '@/catalog/device-catalog';
import {
  formatPinRef,
  parsePinRef,
} from '@/services/connection-normalize';

export interface ResolvedActuatorPin {
  deviceComponentId: string;
  logicalPin: string;
  boardPinNumber: number;
}

export interface ResolvedUltrasonicPins {
  trigPin: number;
  echoPin: number;
}

export interface BindingPinResolver {
  resolveActuatorPin(
    manifest: EmbeddedProjectManifest,
    binding: ActuatorBinding,
  ): ResolvedActuatorPin | null;

  resolveUltrasonicPins(
    manifest: EmbeddedProjectManifest,
    bindingId: string,
  ): ResolvedUltrasonicPins | null;

  resolveSensorPins(
    manifest: EmbeddedProjectManifest,
    binding: SensorBinding,
  ): Record<string, number> | null;
}

const BOARD_COMPONENT_PREFIX = '__board__';

function boardComponentId(manifest: EmbeddedProjectManifest): string {
  return `${BOARD_COMPONENT_PREFIX}${manifest.target.boardId}`;
}

function normalizeConnections(manifest: EmbeddedProjectManifest): Array<{
  from: { componentId: string; pin: string };
  to: { componentId: string; pin: string };
}> {
  return manifest.connections.map((c) => ({
    from: typeof c.from === 'string' ? parsePinRef(c.from) : c.from,
    to: typeof c.to === 'string' ? parsePinRef(c.to) : c.to,
  }));
}

function parseGpioPin(pinName: string): number | null {
  const m = /^GPIO(\d+)$/.exec(pinName);
  if (m) return Number(m[1]);
  const n = Number(pinName);
  return Number.isFinite(n) ? n : null;
}

function resolvePinToBoardNumber(
  manifest: EmbeddedProjectManifest,
  componentId: string,
  pinName: string,
  connections: ReturnType<typeof normalizeConnections>,
): number | null {
  const boardId = boardComponentId(manifest);
  const board = deviceCatalog.getBoard(manifest.target.boardId);

  for (const conn of connections) {
    const endpoints = [
      { comp: conn.from.componentId, pin: conn.from.pin },
      { comp: conn.to.componentId, pin: conn.to.pin },
    ];

    const deviceEnd = endpoints.find(
      (e) => e.comp === componentId && e.pin === pinName,
    );
    if (!deviceEnd) continue;

    const other = endpoints.find((e) => e !== deviceEnd);
    if (!other) continue;

    if (other.comp === boardId || other.comp === manifest.target.boardId) {
      const gpio = parseGpioPin(other.pin);
      if (gpio !== null && board?.gpioPins.includes(gpio)) return gpio;
    }

    const directGpio = parseGpioPin(other.pin);
    if (directGpio !== null && board?.gpioPins.includes(directGpio)) {
      return directGpio;
    }
  }

  return null;
}

export function buildConnectionFromPin(
  deviceComponentId: string,
  pinName: string,
  gpio: number,
  manifest: EmbeddedProjectManifest,
  id?: string,
): ConnectionEntry {
  const boardId = boardComponentId(manifest);
  return {
    id: id ?? `conn_${deviceComponentId}_${pinName}`,
    from: formatPinRef({ componentId: deviceComponentId, pin: pinName }),
    to: formatPinRef({ componentId: boardId, pin: `GPIO${gpio}` }),
    routing: { mode: 'orthogonal' },
  };
}

export function buildConnectionFromPowerPin(
  deviceComponentId: string,
  pinName: string,
  power: 'VCC' | '3V3' | 'GND',
  manifest: EmbeddedProjectManifest,
  id?: string,
): ConnectionEntry {
  const boardId = boardComponentId(manifest);
  return {
    id: id ?? `conn_${deviceComponentId}_${pinName}_pwr`,
    from: formatPinRef({ componentId: deviceComponentId, pin: pinName }),
    to: formatPinRef({ componentId: boardId, pin: power }),
    signalType: 'power',
    routing: { mode: 'orthogonal' },
  };
}

export const bindingPinResolver: BindingPinResolver = {
  resolveActuatorPin(manifest, binding) {
    const connections = normalizeConnections(manifest);
    const boardPin = resolvePinToBoardNumber(
      manifest,
      binding.deviceComponentId,
      binding.pin,
      connections,
    );
    if (boardPin === null) return null;
    return {
      deviceComponentId: binding.deviceComponentId,
      logicalPin: binding.pin,
      boardPinNumber: boardPin,
    };
  },

  resolveUltrasonicPins(manifest, bindingId) {
    const binding = manifest.bindings?.sensors.find((s) => s.bindingId === bindingId);
    if (!binding) return null;
    const pins = this.resolveSensorPins(manifest, binding);
    if (!pins || pins.TRIG === undefined || pins.ECHO === undefined) return null;
    return { trigPin: pins.TRIG, echoPin: pins.ECHO };
  },

  resolveSensorPins(manifest, binding) {
    const device = manifest.devices.find(
      (d) => d.componentId === binding.deviceComponentId,
    );
    if (!device) return null;

    const catalogEntry = deviceCatalog.getDevice(device.modelId);
    if (!catalogEntry) return null;

    const connections = normalizeConnections(manifest);
    const resolved: Record<string, number> = {};

    for (const pinDef of catalogEntry.pins) {
      if (pinDef.type === 'power' || pinDef.type === 'i2c') continue;
      const boardPin = resolvePinToBoardNumber(
        manifest,
        binding.deviceComponentId,
        pinDef.name,
        connections,
      );
      if (boardPin !== null) {
        resolved[pinDef.name] = boardPin;
      }
    }

    return Object.keys(resolved).length > 0 ? resolved : null;
  },
};

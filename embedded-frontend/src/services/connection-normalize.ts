import type { ConnectionEntry, ConnectionPinRef } from '@/types/manifest-v2';

export function formatPinRef(ref: ConnectionPinRef): string {
  return `${ref.componentId}:${ref.pin}`;
}

export function parsePinRef(s: string): ConnectionPinRef {
  const idx = s.lastIndexOf(':');
  if (idx <= 0) throw new Error(`Invalid pin ref: ${s}`);
  return { componentId: s.slice(0, idx), pin: s.slice(idx + 1) };
}

export function normalizeConnectionForCanvas(entry: ConnectionEntry): ConnectionEntry {
  return {
    ...entry,
    from: typeof entry.from === 'string' ? entry.from : formatPinRef(entry.from),
    to: typeof entry.to === 'string' ? entry.to : formatPinRef(entry.to),
  };
}

export function normalizeConnectionForPersist(entry: ConnectionEntry): ConnectionEntry {
  return {
    ...entry,
    from: typeof entry.from === 'string' ? parsePinRef(entry.from) : entry.from,
    to: typeof entry.to === 'string' ? parsePinRef(entry.to) : entry.to,
  };
}

export const DEFAULT_ROUTING = { mode: 'orthogonal' as const };

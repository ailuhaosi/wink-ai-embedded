export const SSD1306_DISPLAY_KIND = 'ssd1306_fb';
export const DISPLAY_FRAME_INTERVAL_MS = 33;

export interface DisplayObservePayload {
  displayKinds?: string[];
  oled?: boolean;
}

export interface DisplayFramebufferPost {
  frame: Uint8Array;
  transferables: Transferable[];
}

export function resolveDisplayKinds(payload: DisplayObservePayload): string[] {
  return payload.displayKinds ?? (payload.oled ? [SSD1306_DISPLAY_KIND] : []);
}

export function shouldCollectDisplayFramebuffer(displayKinds: readonly string[]): boolean {
  return displayKinds.includes(SSD1306_DISPLAY_KIND);
}

function equalBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class DisplayFramebufferGate {
  private lastPostMs = Number.NEGATIVE_INFINITY;
  private lastSnapshot: Uint8Array | null = null;

  accept(frame: Uint8Array, nowMs: number): DisplayFramebufferPost | null {
    if (nowMs - this.lastPostMs < DISPLAY_FRAME_INTERVAL_MS) {
      return null;
    }
    if (equalBytes(this.lastSnapshot, frame)) {
      return null;
    }

    const payloadFrame = new Uint8Array(frame);
    this.lastSnapshot = new Uint8Array(frame);
    this.lastPostMs = nowMs;
    return {
      frame: payloadFrame,
      transferables: [payloadFrame.buffer],
    };
  }

  reset(): void {
    this.lastPostMs = Number.NEGATIVE_INFINITY;
    this.lastSnapshot = null;
  }
}

import { describe, expect, it } from 'vitest';
import {
  DISPLAY_FRAME_INTERVAL_MS,
  DisplayFramebufferGate,
  resolveDisplayKinds,
  shouldCollectDisplayFramebuffer,
  SSD1306_DISPLAY_KIND,
} from '../display-framebuffer';

describe('display framebuffer collection policy', () => {
  it('resolves displayKinds with oled boolean as one-version fallback', () => {
    expect(resolveDisplayKinds({ displayKinds: ['custom_fb'], oled: true })).toEqual(['custom_fb']);
    expect(resolveDisplayKinds({ oled: true })).toEqual([SSD1306_DISPLAY_KIND]);
    expect(resolveDisplayKinds({ oled: false })).toEqual([]);
  });

  it('collects framebuffer only for the SSD1306 display kind', () => {
    expect(shouldCollectDisplayFramebuffer([SSD1306_DISPLAY_KIND])).toBe(true);
    expect(shouldCollectDisplayFramebuffer(['other_display'])).toBe(false);
  });

  it('returns the framebuffer buffer as a transferable for dirty frames', () => {
    const gate = new DisplayFramebufferGate();
    const result = gate.accept(new Uint8Array([1, 2, 3]), 100);

    expect(result?.frame).toEqual(new Uint8Array([1, 2, 3]));
    expect(result?.transferables).toEqual([result?.frame.buffer]);
  });

  it('suppresses dirty frames faster than the 30Hz interval', () => {
    const gate = new DisplayFramebufferGate();
    expect(gate.accept(new Uint8Array([1]), 100)).not.toBeNull();
    expect(gate.accept(new Uint8Array([2]), 100 + DISPLAY_FRAME_INTERVAL_MS - 1)).toBeNull();
  });

  it('suppresses unchanged frames after the 30Hz interval', () => {
    const gate = new DisplayFramebufferGate();
    expect(gate.accept(new Uint8Array([1, 2]), 100)).not.toBeNull();
    expect(gate.accept(new Uint8Array([1, 2]), 100 + DISPLAY_FRAME_INTERVAL_MS)).toBeNull();
  });
});

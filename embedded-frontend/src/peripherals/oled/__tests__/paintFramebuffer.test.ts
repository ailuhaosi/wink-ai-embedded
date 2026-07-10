import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  OLED_WIDTH,
  OLED_HEIGHT,
  OLED_FB_BYTES,
} from '@/constants/oled';
import type { paintOledFramebuffer as PaintFn } from '../paintFramebuffer';

/** Minimal ImageData stand-in for Node vitest (no canvas). */
class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

vi.stubGlobal('ImageData', FakeImageData);

const { paintOledFramebuffer } = await import('../paintFramebuffer') as {
  paintOledFramebuffer: typeof PaintFn;
};

function makeOledEl(existing?: FakeImageData) {
  return {
    imageData: existing as unknown as ImageData | undefined,
    redraw: vi.fn(),
  };
}

describe('paintOledFramebuffer', () => {
  beforeAll(() => {
    vi.stubGlobal('ImageData', FakeImageData);
  });

  it('paints opaque black screen when fb is null', () => {
    const el = makeOledEl();
    paintOledFramebuffer(el, null);

    expect(el.imageData).toBeTruthy();
    expect(el.imageData!.width).toBe(OLED_WIDTH);
    expect(el.imageData!.height).toBe(OLED_HEIGHT);

    const px = el.imageData!.data;
    for (const idx of [0, 100, 500, OLED_WIDTH * OLED_HEIGHT - 1]) {
      const i = idx * 4;
      expect(px[i]).toBe(0);
      expect(px[i + 1]).toBe(0);
      expect(px[i + 2]).toBe(0);
      expect(px[i + 3]).toBe(255);
    }
    expect(el.redraw).toHaveBeenCalledOnce();
  });

  it('paints opaque black screen when fb length is wrong', () => {
    const el = makeOledEl();
    paintOledFramebuffer(el, new Uint8Array(10));

    const px = el.imageData!.data;
    expect(px[3]).toBe(255);
    expect(px[0]).toBe(0);
    expect(el.redraw).toHaveBeenCalledOnce();
  });

  it('lights pixels per SSD1306 page/column/bit packing', () => {
    const fb = new Uint8Array(OLED_FB_BYTES);
    fb[0] = 0b0000_0001;
    fb[1 * OLED_WIDTH + 2] = 0b0000_1000;

    const el = makeOledEl();
    paintOledFramebuffer(el, fb);

    const px = el.imageData!.data;
    const litColor = [0, 210, 255, 255] as const;
    const darkColor = [8, 12, 24, 255] as const;

    const at = (col: number, row: number) => {
      const i = (row * OLED_WIDTH + col) * 4;
      return [px[i], px[i + 1], px[i + 2], px[i + 3]];
    };

    expect(at(0, 0)).toEqual([...litColor]);
    expect(at(2, 11)).toEqual([...litColor]);
    expect(at(1, 0)).toEqual([...darkColor]);
    expect(at(0, 1)).toEqual([...darkColor]);
    expect(el.redraw).toHaveBeenCalledOnce();
  });

  it('reuses existing ImageData when dimensions match', () => {
    const existing = new FakeImageData(OLED_WIDTH, OLED_HEIGHT);
    const el = makeOledEl(existing);
    paintOledFramebuffer(el, null);
    expect(el.imageData).toBe(existing as unknown as ImageData);
  });
});

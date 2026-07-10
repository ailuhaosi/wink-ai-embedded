/** SSD1306 framebuffer geometry — single source for canvas/sim OLED rendering. */
export const OLED_WIDTH = 128;
export const OLED_HEIGHT = 64;
export const OLED_PAGE_COUNT = OLED_HEIGHT / 8;
export const OLED_FB_BYTES = (OLED_WIDTH * OLED_HEIGHT) / 8;

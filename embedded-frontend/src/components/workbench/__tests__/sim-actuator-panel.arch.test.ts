import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SimActuatorPanel.vue architecture guard', () => {
  it('does not directly access raw worker batch types, pwm channels, or C bridge exports', () => {
    const filePath = path.resolve(__dirname, '../SimActuatorPanel.vue');
    const src = readFileSync(filePath, 'utf8');

    expect(src).not.toMatch(/ActuatorOutputBatch/);
    expect(src).not.toMatch(/pal_wasm_get_/);
    expect(src).not.toMatch(/pwm_channel/);
  });
});

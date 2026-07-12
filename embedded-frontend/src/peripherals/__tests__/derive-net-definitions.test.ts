import { describe, expect, it } from 'vitest';
import { deriveNetDefinitions } from '../derive-net-definitions';
import type { UnifiedPinDef } from '../types';
import { registry } from '../registry';
import '@/peripherals'; // Load registry definitions

describe('deriveNetDefinitions', () => {
  it('groups by explicit wireNet and orders modes primary -> secondary -> vcc -> gnd', () => {
    const pins: UnifiedPinDef[] = [
      { name: 'GND', catalogType: 'power', signalType: 'power', defaultConnection: 'GND', wireNet: 'gnd' },
      { name: 'VCC', catalogType: 'power', signalType: 'power', defaultConnection: 'VCC', wireNet: 'vcc' },
      { name: 'SIG', catalogType: 'pwm', signalType: 'digital', wireNet: 'primary' },
    ];
    const nets = deriveNetDefinitions(pins);
    expect(nets).toEqual([
      { mode: 'primary', signalType: 'digital', pinCandidates: ['SIG'] },
      { mode: 'vcc', signalType: 'power', pinCandidates: ['VCC'], defaultConnection: 'VCC' },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['GND'], defaultConnection: 'GND' },
    ]);
  });

  it('merges candidates with same wireNet and takes first non-empty defaultConnection', () => {
    const pins: UnifiedPinDef[] = [
      { name: '1.l', catalogType: 'gpio', signalType: 'digital', defaultConnection: 14, wireNet: 'primary' },
      { name: '1.r', catalogType: 'gpio', signalType: 'digital', defaultConnection: null, wireNet: 'primary' },
    ];
    const nets = deriveNetDefinitions(pins);
    expect(nets).toEqual([
      { mode: 'primary', signalType: 'digital', pinCandidates: ['1.l', '1.r'], defaultConnection: 14 },
    ]);
  });

  it('falls back to heuristics for power pins when wireNet is omitted', () => {
    const pins: UnifiedPinDef[] = [
      { name: 'GND', catalogType: 'power', signalType: 'power', defaultConnection: 'GND' },
      { name: 'VCC', catalogType: 'power', signalType: 'power', defaultConnection: 'VCC' },
    ];
    const nets = deriveNetDefinitions(pins);
    expect(nets).toEqual([
      { mode: 'vcc', signalType: 'power', pinCandidates: ['VCC'], defaultConnection: 'VCC' },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['GND'], defaultConnection: 'GND' },
    ]);
  });

  it('falls back to heuristics for signal pins and ignores 3rd and subsequent signal pins', () => {
    const pins: UnifiedPinDef[] = [
      { name: 'PIN1', catalogType: 'gpio', signalType: 'digital' },
      { name: 'PIN2', catalogType: 'gpio', signalType: 'digital' },
      { name: 'PIN3', catalogType: 'gpio', signalType: 'digital' },
    ];
    const nets = deriveNetDefinitions(pins);
    expect(nets).toEqual([
      { mode: 'primary', signalType: 'digital', pinCandidates: ['PIN1'] },
      { mode: 'secondary', signalType: 'digital', pinCandidates: ['PIN2'] },
    ]);
  });

  it('enforces that all core/registered peripherals with 2 or more signal pins explicitly declare wireNet', () => {
    const peripherals = registry.list();
    expect(peripherals.length).toBeGreaterThan(0);

    for (const p of peripherals) {
      const signalPins = p.pins.filter(
        (pin) => pin.signalType === 'digital' || pin.signalType === 'i2c' || pin.signalType === 'custom'
      );
      if (signalPins.length >= 2) {
        for (const pin of signalPins) {
          expect(pin.wireNet).toBeDefined();
          expect(['primary', 'secondary']).toContain(pin.wireNet);
        }
      }
    }
  });
});

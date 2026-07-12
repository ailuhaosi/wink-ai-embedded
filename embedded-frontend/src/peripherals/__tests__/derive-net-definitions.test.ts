import { describe, expect, it } from 'vitest';
import { deriveNetDefinitions } from '../derive-net-definitions';
import type { UnifiedPinDef } from '../types';
import { registry } from '../registry';
import { getNetDefinitions } from '@/types/peripheral-pins';
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

  it('enforces that all core/registered peripherals with 2 or more signal pins explicitly declare wireNet for their routed signal nets', () => {
    const peripherals = registry.list();
    expect(peripherals.length).toBeGreaterThan(0);

    for (const p of peripherals) {
      const signalPins = p.pins.filter(
        (pin) => pin.signalType === 'digital' || pin.signalType === 'i2c' || pin.signalType === 'custom'
      );
      if (signalPins.length >= 2) {
        const derivedNets = deriveNetDefinitions(p.pins);
        const primaryNet = derivedNets.find(n => n.mode === 'primary');
        const secondaryNet = derivedNets.find(n => n.mode === 'secondary');

        if (primaryNet) {
          for (const pinName of primaryNet.pinCandidates) {
            const pin = p.pins.find(pin => pin.name === pinName);
            expect(pin?.wireNet, `Peripheral '${p.type}' pin '${pinName}' should explicitly declare wireNet`).toBe('primary');
          }
        }
        if (secondaryNet) {
          for (const pinName of secondaryNet.pinCandidates) {
            const pin = p.pins.find(pin => pin.name === pinName);
            expect(pin?.wireNet, `Peripheral '${p.type}' pin '${pinName}' should explicitly declare wireNet`).toBe('secondary');
          }
        }
      }
    }
  });

  it('verifies getNetDefinitions parity for registered peripherals', () => {
    // LED
    expect(getNetDefinitions('led')).toEqual([
      { mode: 'primary', signalType: 'digital', pinCandidates: ['A'], defaultConnection: 13 },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['C'], defaultConnection: 'GND' },
    ]);

    // Button
    expect(getNetDefinitions('button')).toEqual([
      { mode: 'primary', signalType: 'digital', pinCandidates: ['1.l', '1.r'] },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['2.l', '2.r'], defaultConnection: 'GND' },
    ]);

    // OLED
    expect(getNetDefinitions('oled')).toEqual([
      { mode: 'primary', signalType: 'i2c', pinCandidates: ['DATA'], defaultConnection: 21 },
      { mode: 'secondary', signalType: 'i2c', pinCandidates: ['CLK'], defaultConnection: 22 },
      { mode: 'vcc', signalType: 'power', pinCandidates: ['3V3', 'VIN'], defaultConnection: '3V3' },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['GND'], defaultConnection: 'GND' },
    ]);

    // Ultrasonic
    expect(getNetDefinitions('ultrasonic')).toEqual([
      { mode: 'primary', signalType: 'digital', pinCandidates: ['ECHO'], defaultConnection: 13 },
      { mode: 'secondary', signalType: 'digital', pinCandidates: ['TRIG'], defaultConnection: 12 },
      { mode: 'vcc', signalType: 'power', pinCandidates: ['VCC'], defaultConnection: 'VCC' },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['GND'], defaultConnection: 'GND' },
    ]);

    // Servo
    expect(getNetDefinitions('servo')).toEqual([
      { mode: 'primary', signalType: 'digital', pinCandidates: ['SIG'] },
      { mode: 'vcc', signalType: 'power', pinCandidates: ['VCC'], defaultConnection: 'VCC' },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['GND'], defaultConnection: 'GND' },
    ]);

    // Motor Driver Stub
    expect(getNetDefinitions('motor_driver_stub')).toEqual([
      { mode: 'primary', signalType: 'digital', pinCandidates: ['PWM_LEFT'], defaultConnection: 14 },
      { mode: 'secondary', signalType: 'digital', pinCandidates: ['PWM_RIGHT'], defaultConnection: 15 },
      { mode: 'vcc', signalType: 'power', pinCandidates: ['VCC'], defaultConnection: 'VCC' },
      { mode: 'gnd', signalType: 'power', pinCandidates: ['GND'], defaultConnection: 'GND' },
    ]);
  });

  it('getNetDefinitions returns empty array for unknown peripheral type', () => {
    expect(getNetDefinitions('unknown_xyz')).toEqual([]);
  });
});

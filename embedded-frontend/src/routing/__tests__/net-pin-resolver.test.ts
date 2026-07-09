import { describe, expect, it } from 'vitest';
import type { NetDefinition } from '../../types/peripheral-pins';
import {
  connectionMatchesNet,
  resolveNetConnection,
  resolveNetPin,
} from '../net-pin-resolver';

const buttonPrimary: NetDefinition = {
  mode: 'primary',
  signalType: 'digital',
  pinCandidates: ['1.l', '1.r'],
  defaultConnection: 14,
};

const buttonGnd: NetDefinition = {
  mode: 'gnd',
  signalType: 'power',
  pinCandidates: ['2.l', '2.r'],
  defaultConnection: 'GND',
};

const positions: Record<string, { x: number; y: number }> = {
  '1.l': { x: 75, y: 260 },
  '1.r': { x: 155, y: 260 },
  '2.l': { x: 75, y: 280 },
  '2.r': { x: 155, y: 280 },
};

describe('net-pin-resolver', () => {
  it('connectionMatchesNet distinguishes digital and power', () => {
    expect(connectionMatchesNet(14, buttonPrimary)).toBe(true);
    expect(connectionMatchesNet('GND', buttonPrimary)).toBe(false);
    expect(connectionMatchesNet('GND', buttonGnd)).toBe(true);
  });

  it('resolveNetConnection uses explicit pin before default', () => {
    expect(
      resolveNetConnection(buttonPrimary, { '1.l': 14, '1.r': null, '2.l': null, '2.r': null }),
    ).toBe(14);
    expect(resolveNetConnection(buttonPrimary, { '1.l': null, '1.r': null })).toBe(14);
  });

  it('resolveNetPin honors user override on a single explicit candidate', () => {
    const pin = resolveNetPin(buttonPrimary, {
      pinConnections: { '1.l': 14, '1.r': null, '2.l': null, '2.r': null },
      getPinPosition: (name) => positions[name],
      targetPosition: { x: 487, y: 192 },
    });
    expect(pin).toBe('1.l');
  });

  it('resolveNetPin auto-picks closest candidate when only defaultConnection is set', () => {
    const leftBoard = resolveNetPin(buttonPrimary, {
      pinConnections: { '1.l': null, '1.r': null, '2.l': 'VCC', '2.r': null },
      getPinPosition: (name) => positions[name],
      targetPosition: { x: 50, y: 220 },
    });
    const rightBoard = resolveNetPin(buttonPrimary, {
      pinConnections: { '1.l': null, '1.r': null, '2.l': 'VCC', '2.r': null },
      getPinPosition: (name) => positions[name],
      targetPosition: { x: 487, y: 192 },
    });
    expect(leftBoard).toBe('1.l');
    expect(rightBoard).toBe('1.r');
  });

  it('resolveNetPin picks closest among multiple explicit candidates', () => {
    const pin = resolveNetPin(buttonPrimary, {
      pinConnections: { '1.l': 14, '1.r': 14, '2.l': null, '2.r': null },
      getPinPosition: (name) => positions[name],
      targetPosition: { x: 487, y: 192 },
    });
    expect(pin).toBe('1.r');
  });
});

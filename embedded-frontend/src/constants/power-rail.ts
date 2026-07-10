export const PowerRail = {
  VCC: 'VCC',
  V3V3: '3V3',
  GND: 'GND',
} as const;

export type PowerRailValue = (typeof PowerRail)[keyof typeof PowerRail];

export const POWER_RAIL_VALUES: readonly PowerRailValue[] = [
  PowerRail.VCC,
  PowerRail.V3V3,
  PowerRail.GND,
] as const;

export function isPowerConnection(value: unknown): value is PowerRailValue {
  return value === PowerRail.VCC
    || value === PowerRail.V3V3
    || value === PowerRail.GND;
}

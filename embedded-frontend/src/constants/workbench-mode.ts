export const WorkbenchModeId = {
  Design: 'design',
  Simulate: 'simulate',
  Diagnose: 'diagnose',
} as const;

export type WorkbenchModeValue = (typeof WorkbenchModeId)[keyof typeof WorkbenchModeId];

export const WORKBENCH_MODE_IDS: readonly WorkbenchModeValue[] = [
  WorkbenchModeId.Design,
  WorkbenchModeId.Simulate,
  WorkbenchModeId.Diagnose,
] as const;

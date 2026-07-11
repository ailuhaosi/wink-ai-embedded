import type { Transform3D } from '@/types/manifest-v2';

export type MechanicalAssetCategory = 'mount' | 'chassis' | 'wheel' | 'enclosure';

export type EnvironmentAssetCategory = 'obstacle' | 'field' | 'prop';

export interface MechanicalAssetDef {
  id: string;
  displayName: string;
  category: MechanicalAssetCategory;
  defaultTransform?: Transform3D;
}

export interface EnvironmentAssetDef {
  id: string;
  displayName: string;
  category: EnvironmentAssetCategory;
}

export interface WorldAssetRegistry {
  registerMechanical: (def: MechanicalAssetDef) => void;
  registerEnvironment: (def: EnvironmentAssetDef) => void;
  getMechanical: (id: string) => MechanicalAssetDef | undefined;
  getEnvironment: (id: string) => EnvironmentAssetDef | undefined;
  listMechanical: () => MechanicalAssetDef[];
  listEnvironment: () => EnvironmentAssetDef[];
}

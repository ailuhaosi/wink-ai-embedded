import type {
  EnvironmentAssetDef,
  MechanicalAssetDef,
  WorldAssetRegistry,
} from './types';

const mechanical = new Map<string, MechanicalAssetDef>();
const environment = new Map<string, EnvironmentAssetDef>();

export const worldRegistry: WorldAssetRegistry = {
  registerMechanical(def) {
    mechanical.set(def.id, def);
  },

  registerEnvironment(def) {
    environment.set(def.id, def);
  },

  getMechanical(id) {
    return mechanical.get(id);
  },

  getEnvironment(id) {
    return environment.get(id);
  },

  listMechanical() {
    return Array.from(mechanical.values());
  },

  listEnvironment() {
    return Array.from(environment.values());
  },
};

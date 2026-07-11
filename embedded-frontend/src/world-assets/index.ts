import { worldRegistry } from './registry';
import {
  diffDriveChassisV1,
  driveWheelV1,
  sensorEnclosureV1,
  ultrasonicMountV1,
} from './mechanical/builtin';
import { envHeatSource, envWallSegment } from './environment/builtin';

for (const def of [
  ultrasonicMountV1,
  diffDriveChassisV1,
  driveWheelV1,
  sensorEnclosureV1,
]) {
  worldRegistry.registerMechanical(def);
}

for (const def of [envWallSegment, envHeatSource]) {
  worldRegistry.registerEnvironment(def);
}

export { worldRegistry } from './registry';
export type {
  EnvironmentAssetDef,
  MechanicalAssetDef,
  WorldAssetRegistry,
} from './types';

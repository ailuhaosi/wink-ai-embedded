import type {
  EmbeddedProjectManifest,
  EnvironmentField,
} from '@/types/manifest-v2';
import {
  emptyBindingsSection,
  emptyEnvironmentSection,
  emptyMechanicalSection,
} from '@/types/manifest-v2';

export function migrateManifest(raw: unknown): EmbeddedProjectManifest {
  const obj = raw as Record<string, unknown>;
  const version = (obj.schemaVersion as number) ?? 1;

  if (version === 1) {
    return {
      ...(obj as object),
      schemaVersion: 2,
      mechanical: emptyMechanicalSection(),
      environment: emptyEnvironmentSection(),
      bindings: emptyBindingsSection(),
    } as EmbeddedProjectManifest;
  }

  if (version === 2) {
    const merged = {
      ...obj,
      mechanical: obj.mechanical ?? emptyMechanicalSection(),
      environment: obj.environment ?? emptyEnvironmentSection(),
      bindings: obj.bindings ?? emptyBindingsSection(),
    } as EmbeddedProjectManifest;

    for (const f of merged.environment?.fields ?? []) {
      const rawField = f as EnvironmentField & { intensity?: number };
      if (rawField.valueC === undefined && rawField.intensity !== undefined) {
        rawField.valueC = rawField.intensity;
      }
    }
    return merged;
  }

  throw new Error(`Unknown manifest schemaVersion: ${version}. Please upgrade your Wink-AI.`);
}

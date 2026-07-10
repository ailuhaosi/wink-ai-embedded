import { migrateManifest } from '@/services/manifest-migration';
import { normalizeConnectionForPersist } from '@/services/connection-normalize';
import type { EmbeddedProjectManifest } from '@/types/manifest-v2';

export const WINK_PROJECT_FILENAME = 'wink-project.json';

export function prepareManifestForExport(
  manifest: EmbeddedProjectManifest,
): EmbeddedProjectManifest {
  return {
    ...manifest,
    connections: manifest.connections.map(normalizeConnectionForPersist),
  };
}

export function parseManifestJson(raw: unknown): EmbeddedProjectManifest {
  return migrateManifest(raw);
}

export async function readManifestFromFile(
  file: File,
): Promise<EmbeddedProjectManifest> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  }
  catch {
    throw new Error('Invalid JSON project file');
  }
  return parseManifestJson(parsed);
}

export function downloadManifest(
  manifest: EmbeddedProjectManifest,
  filename = WINK_PROJECT_FILENAME,
): void {
  const payload = prepareManifestForExport(manifest);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

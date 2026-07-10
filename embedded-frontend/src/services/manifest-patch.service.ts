import type { EmbeddedProjectManifest } from '@/types/manifest-v2';
import { createAvoidanceCarWorkbenchManifest } from '@/services/templates/avoidance-car-w2-minimal';
import {
  createOledDashboardWorkbenchManifest,
  OLED_DASHBOARD_TEMPLATE_ID,
} from '@/services/templates/oled-dashboard-demo';

export const WORKBENCH_TEMPLATE_IDS = {
  AVOIDANCE_CAR: 'tpl_avoidance_car',
  OLED_DASHBOARD: OLED_DASHBOARD_TEMPLATE_ID,
} as const;

export type WorkbenchTemplateId =
  (typeof WORKBENCH_TEMPLATE_IDS)[keyof typeof WORKBENCH_TEMPLATE_IDS];

const TEMPLATE_ALIASES: Record<string, WorkbenchTemplateId> = {
  tpl_avoidance_car: WORKBENCH_TEMPLATE_IDS.AVOIDANCE_CAR,
  tpl_oled_dashboard: WORKBENCH_TEMPLATE_IDS.OLED_DASHBOARD,
};

export function normalizeTemplateId(templateId: string): WorkbenchTemplateId | null {
  const normalized = TEMPLATE_ALIASES[templateId] ?? templateId;
  if (
    normalized === WORKBENCH_TEMPLATE_IDS.AVOIDANCE_CAR ||
    normalized === WORKBENCH_TEMPLATE_IDS.OLED_DASHBOARD
  ) {
    return normalized;
  }
  return null;
}

/**
 * Create a fresh manifest for a built-in workbench template.
 * Each invocation gets a unique project id (except static demo ids in template defs).
 */
export function createWorkbenchTemplateManifest(
  templateId: string,
): EmbeddedProjectManifest | null {
  const id = normalizeTemplateId(templateId);
  if (!id) return null;

  switch (id) {
    case WORKBENCH_TEMPLATE_IDS.AVOIDANCE_CAR:
      return createAvoidanceCarWorkbenchManifest();
    case WORKBENCH_TEMPLATE_IDS.OLED_DASHBOARD:
      return createOledDashboardWorkbenchManifest();
    default:
      return null;
  }
}

/**
 * Apply a template patch onto the current manifest (replaces topology sections).
 */
export function applyTemplatePatch(
  _current: EmbeddedProjectManifest,
  templateId: string,
): EmbeddedProjectManifest | null {
  return createWorkbenchTemplateManifest(templateId);
}

export function isOledDashboardTemplate(templateId: string): boolean {
  return normalizeTemplateId(templateId) === WORKBENCH_TEMPLATE_IDS.OLED_DASHBOARD;
}

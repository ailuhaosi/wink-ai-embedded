import { peripheralConfigs } from '../types/peripheral-pins';

export interface StaticCheckIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface StaticCheckContext {
  isSimulationReady: boolean;
  initError?: string | null;
  components: Array<{
    id: string;
    type: string;
    name: string;
    pinConnections: Record<string, unknown>;
  }>;
}

export interface StaticCheckResult {
  ok: boolean;
  issues: StaticCheckIssue[];
}

function hasConnectedValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

export function runStaticCheck(context: StaticCheckContext): StaticCheckResult {
  const issues: StaticCheckIssue[] = [];

  if (!context.isSimulationReady) {
    issues.push({
      id: context.initError ? 'sim-init-failed' : 'sim-not-ready',
      severity: 'error',
      message: context.initError ?? 'workbench.staticCheck.notInitialized',
    });
  }

  if (context.components.length === 0) {
    issues.push({
      id: 'no-components',
      severity: 'error',
      message: 'workbench.staticCheck.noComponents',
    });
  }

  for (const comp of context.components) {
    const pinDefs = peripheralConfigs[comp.type]?.pins ?? [];
    for (const pinDef of pinDefs) {
      // Only enforce required pins that ship with a default connection.
      // Pins with default:null are user-wired later and must not block simulate.
      if (!pinDef.required) continue;
      if (pinDef.default === null || pinDef.default === undefined) continue;
      const value = comp.pinConnections[pinDef.name];
      if (!hasConnectedValue(value)) {
        issues.push({
          id: `unconnected-${comp.id}-${pinDef.name}`,
          severity: 'error',
          message: 'workbench.staticCheck.unconnectedPins',
        });
      }
    }
  }

  const blocking = issues.filter((i) => i.severity === 'error');
  return { ok: blocking.length === 0, issues };
}

export const staticCheckService = {
  run(context: StaticCheckContext): Promise<boolean> {
    return Promise.resolve(runStaticCheck(context).ok);
  },
  runDetailed(context: StaticCheckContext): StaticCheckResult {
    return runStaticCheck(context);
  },
};

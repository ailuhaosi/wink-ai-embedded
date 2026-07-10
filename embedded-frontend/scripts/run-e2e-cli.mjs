/**
 * W1 Task 1.6 / A18 — run smoke + onboarding via playwright-cli only.
 * Does not use @playwright/test.
 *
 * Usage: node scripts/run-e2e-cli.mjs
 * Env: WB_URL (default http://127.0.0.1:5174), SKIP_DEV=1 to reuse existing server
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const baseUrl = process.env.WB_URL ?? 'http://127.0.0.1:5174';
const skipDev = process.env.SKIP_DEV === '1';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WB_URL: baseUrl },
      ...opts,
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
    child.on('error', reject);
  });
}

/** Resolve playwright-cli binary (global or local via npx --no-install). */
async function resolveCli() {
  const direct = await run('playwright-cli', ['--version']);
  if (direct.code === 0) return (args) => run('playwright-cli', args);

  const npx = await run('npx', ['--no-install', 'playwright-cli', '--version']);
  if (npx.code === 0) return (args) => run('npx', ['--no-install', 'playwright-cli', ...args]);

  console.error(
    '[e2e-cli] playwright-cli not found. Install globally: npm install -g @playwright/cli@latest',
  );
  process.exit(1);
}

async function waitForServer(url, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server not ready: ${url}`);
}

function parseResult(out) {
  const matches = out.match(/\{[\s\S]*\}/g);
  if (!matches) return null;
  try {
    return JSON.parse(matches[matches.length - 1]);
  } catch {
    return null;
  }
}

let devProc = null;

try {
  const cli = await resolveCli();

  if (!skipDev) {
    console.log('[e2e-cli] starting vite on', baseUrl);
    devProc = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174'], {
      cwd: root,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer(baseUrl);
  }

  console.log('[e2e-cli] smoke');
  await cli(['open', baseUrl]);
  const smoke = await cli(['run-code', `--filename=${path.join('scripts', 'e2e-sim-smoke.mjs')}`]);
  const smokeResult = parseResult(smoke.out);
  console.log('[e2e-cli] smoke result:', smokeResult);
  await cli(['close']);

  console.log('[e2e-cli] onboarding');
  await cli(['open', baseUrl]);
  const onboard = await cli(['run-code', `--filename=${path.join('scripts', 'e2e-onboarding.mjs')}`]);
  const onboardResult = parseResult(onboard.out);
  console.log('[e2e-cli] onboarding result:', onboardResult);
  await cli(['close']);

  const ok = smokeResult?.ok && onboardResult?.ok;
  if (!ok) {
    console.error('[e2e-cli] FAILED');
    process.exit(1);
  }
  console.log('[e2e-cli] PASSED');
  process.exit(0);
} finally {
  if (devProc && !devProc.killed) {
    devProc.kill('SIGTERM');
  }
}

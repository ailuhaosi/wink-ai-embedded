/**
 * Playwright smoke: workbench simulate mode — no fault badge after run.
 * Usage: npx @playwright/cli run-code --filename=scripts/e2e-sim-smoke.mjs
 */
export default async (page) => {
  const baseUrl = process.env.WB_URL ?? 'http://localhost:5174';
  const logs = [];
  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  // Dismiss onboarding if present
  const skipBtn = page.getByRole('button', { name: /跳过|Skip/i });
  if (await skipBtn.isVisible().catch(() => false)) {
    await skipBtn.click();
  }

  // Switch to simulate mode
  const simModeBtn = page.locator('.mode-btn').filter({ hasText: '仿真' });
  await simModeBtn.click();

  // Wait for wasm worker init
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.status-tag');
      return el && !el.textContent?.includes('引擎');
    },
    { timeout: 30000 },
  );

  // Start simulation (play button in toolbar)
  const playBtn = page.locator('.btn-running, .mode-toolbar .btn').filter({ has: page.locator('svg') }).first();
  const toolbarPlay = page.locator('.mode-toolbar button.btn').first();
  await toolbarPlay.click();

  // Let sim loop run a few seconds
  await page.waitForTimeout(4000);

  const statusText = await page.locator('.status-indicators .status-tag').first().textContent();
  const faultVisible = await page.locator('.status-tag.status-danger', { hasText: '故障' }).isVisible().catch(() => false);

  const workerErrors = logs.filter((l) => l.includes('Worker Error') || l.includes('SimWorker') || l.includes('fault') || l.includes('Fault') || l.includes('8003') || l.includes('8002'));
  const initOk = logs.some((l) => l.includes('Simulator initialized successfully'));

  return {
    baseUrl,
    statusText: statusText?.trim(),
    faultVisible,
    initOk,
    workerErrors: workerErrors.slice(-20),
    recentLogs: logs.slice(-30),
  };
};

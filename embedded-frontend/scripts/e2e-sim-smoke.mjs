async (page) => {
  const baseUrl = 'http://127.0.0.1:5174';
  const logs = [];
  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.addInitScript(() => {
    localStorage.setItem('wink_onboarding_completed', 'true');
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  const skipBtn = page.getByRole('button', { name: /跳过|Skip/i });
  if (await skipBtn.isVisible().catch(() => false)) {
    await skipBtn.click();
  }

  const splitVisible = await page.locator('.split-pane').isVisible().catch(() => false);

  const simModeBtn = page.locator('.mode-btn').filter({ hasText: '仿真' });
  await simModeBtn.click();

  await page.waitForFunction(
    () => {
      const el = document.querySelector('.status-tag');
      return el && !el.textContent?.includes('引擎');
    },
    { timeout: 30000 },
  );

  const worldVisible = await page.locator('.world-pane').isVisible().catch(() => false);

  const toolbarPlay = page.locator('.mode-toolbar button.btn').first();
  await toolbarPlay.click();
  await page.waitForTimeout(4000);

  const statusText = await page.locator('.status-indicators .status-tag').first().textContent();
  const faultVisible = await page
    .locator('.status-tag.status-danger', { hasText: '故障' })
    .isVisible()
    .catch(() => false);

  const workerErrors = logs.filter(
    (l) =>
      l.includes('Worker Error') ||
      /\[error\].*SimWorker/i.test(l) ||
      /\[error\].*fault/i.test(l) ||
      l.includes('8003') ||
      l.includes('8002'),
  );
  const initOk = logs.some((l) => l.includes('Simulator initialized successfully'));

  const ok = splitVisible && worldVisible && !faultVisible && workerErrors.length === 0;

  return {
    ok,
    baseUrl,
    splitVisible,
    worldVisible,
    statusText: statusText?.trim(),
    faultVisible,
    initOk,
    workerErrors: workerErrors.slice(-20),
    recentLogs: logs.slice(-30),
  }
}

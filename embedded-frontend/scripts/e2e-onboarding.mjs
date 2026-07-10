async (page) => {
  const baseUrl = 'http://127.0.0.1:5174';

  await page.addInitScript(() => {
    localStorage.removeItem('wink_onboarding_completed');
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const overlay = page.locator('.onboarding-overlay');
  await overlay.waitFor({ state: 'visible', timeout: 15000 });

  const step1 = await page.getByText('Step 1 / 3').isVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  const step2 = await page.getByText('Step 2 / 3').isVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  const step3 = await page.getByText('Step 3 / 3').isVisible();
  await page.getByRole('button', { name: '完成' }).click();
  await overlay.waitFor({ state: 'hidden', timeout: 5000 });

  const completed = await page.evaluate(() => localStorage.getItem('wink_onboarding_completed'));

  return {
    ok: step1 && step2 && step3 && completed === 'true',
    step1,
    step2,
    step3,
    wink_onboarding_completed: completed,
  }
}

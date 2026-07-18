import { expect, test as setup } from '@playwright/test';
import fs from 'node:fs';

const authFile = 'e2e/.auth/user.json';

setup('authenticate for tournament scenarios', async ({ page }) => {
  fs.mkdirSync('e2e/.auth', { recursive: true });
  if (fs.existsSync(authFile) && !process.env.E2E_REAUTH) {
    return;
  }
  await page.goto('/login');

  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (username && password) {
    await page.getByPlaceholder(/Wesnoth Forum Username/i).fill(username);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole('button', { name: /log in|login/i }).click();
  } else {
    console.log('Complete the login manually in the visible browser window.');
  }

  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 300_000 });
  await expect(page.locator('body')).not.toContainText('Login failed');
  await page.context().storageState({ path: authFile });
});

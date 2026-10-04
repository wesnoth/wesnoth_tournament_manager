import { expect, type Page } from '@playwright/test';

/**
 * Log in through the real login form as a forum user of the local stack.
 *
 * Local dev forum users share one password (E2E_PLAYER_PASSWORD, `password`
 * by default), so specs can act as any replay participant without stored
 * sessions. Never point this at a shared environment.
 */
export async function loginAs(page: Page, nickname: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/Wesnoth Forum Username/i).fill(nickname);
  await page.getByPlaceholder(/password/i).fill(process.env.E2E_PLAYER_PASSWORD || 'password');
  await page.getByRole('button', { name: /log in|login/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 });
  await expect(page.locator('body')).not.toContainText('Login failed');
}

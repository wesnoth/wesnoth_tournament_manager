import { expect, type Browser } from '@playwright/test';
import { loginAs } from './login';

export interface ConfirmationClick {
  nickname: string;
  /** Replay confirmation button, e.g. action-confirm-confidence-one-replay-won. */
  choice: string;
}

/**
 * Submit several replay confirmations at the same moment from separate
 * browsers, as players would when they race to confirm one result.
 *
 * Every player is first brought to the last step (logged in, confirmation
 * modal open) so only the final submit runs concurrently; this keeps the
 * race on the backend instead of on page loads.
 *
 * @param rowTexts when the page lists several games, texts that identify the
 *   tournament game row to act on (for example both team names).
 * @returns the HTTP status of each confirm-winner request, in click order.
 */
export async function confirmTogether(
  browser: Browser,
  path: string,
  clicks: ConfirmationClick[],
  rowTexts: string[] = [],
): Promise<number[]> {
  const pages = await Promise.all(clicks.map(async (click) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, click.nickname);
    await page.goto(path);
    let scope = page.locator('[data-help-id="region-tournament-game-row"]');
    for (const text of rowTexts) scope = scope.filter({ hasText: text });
    const target = rowTexts.length ? scope.locator(`[data-help-id="${click.choice}"]`) : page.locator(`[data-help-id="${click.choice}"]`);
    await expect(target).toHaveCount(1, { timeout: 30_000 });
    await target.click();
    await expect(page.locator('[data-help-id="action-submit-replay-confirmation"]')).toBeEnabled();
    return page;
  }));
  return Promise.all(pages.map(async (page) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/confirm-winner')),
      page.locator('[data-help-id="action-submit-replay-confirmation"]').click(),
    ]);
    return response.status();
  }));
}

export interface RankedConfirmationClick extends ConfirmationClick {
  /** Replay file name shown in the player's /matches pending list. */
  replayName: string;
}

/**
 * Confirm standalone ranked replays from /matches at the same moment, one
 * browser per click. Unlike confirmTogether, each click may target a
 * different replay, which is how players racing on a shared opponent behave.
 *
 * @returns the HTTP status of each confirm-winner request, in click order.
 */
export async function confirmRankedTogether(browser: Browser, clicks: RankedConfirmationClick[]): Promise<number[]> {
  const pages = await Promise.all(clicks.map(async (click) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, click.nickname);
    await page.goto('/matches');
    const row = page.locator('tr').filter({ hasText: click.replayName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.locator(`[data-help-id="${click.choice}"]`).click();
    await expect(page.locator('[data-help-id="action-submit-replay-confirmation"]')).toBeEnabled();
    return page;
  }));
  return Promise.all(pages.map(async (page) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/confirm-winner')),
      page.locator('[data-help-id="action-submit-replay-confirmation"]').click(),
    ]);
    await page.context().close();
    return response.status();
  }));
}

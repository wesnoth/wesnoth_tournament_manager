import { expect, test } from '@playwright/test';

test('guided per-group counts generate a reviewable elimination mapping', async ({ page }) => {
  await page.goto('/login');
  // Some local runs lack a persisted storageState; authenticate in this same
  // page context when needed so the editor and preview endpoint are exercised.
  if (!(await page.evaluate(() => Boolean(localStorage.getItem('token'))))) {
    const username = process.env.E2E_USERNAME;
    const password = process.env.E2E_PASSWORD;
    if (!username || !password) throw new Error('E2E_USERNAME and E2E_PASSWORD are required when no saved login state exists');
    await page.getByPlaceholder(/Wesnoth Forum Username/i).fill(username);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole('button', { name: /log in|login/i }).click();
    await page.waitForURL(url => !url.pathname.endsWith('/login'));
  }
  await page.goto('/my-tournaments');
  const createButton = page.locator('[data-help-id="action-open-create-tournament"]');
  await expect(createButton).toBeVisible({ timeout: 30_000 });
  await createButton.click();

  const phaseSection = page.locator('[data-help-id="action-toggle-tournament-phase-configuration"]');
  await expect(phaseSection).toBeVisible();
  if (!(await phaseSection.evaluate(element => element.parentElement?.hasAttribute('open') || false))) {
    await phaseSection.click();
  }

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-help-id="option-tournament-format-template"]').selectOption('swiss');
  const groupCount = page.locator('[data-help-id="field-tournament-phase-group-count"]').first();
  await groupCount.fill('');
  await expect(groupCount).toHaveValue('');
  await groupCount.pressSequentially('4');
  await expect(groupCount).toHaveValue('4');
  const swissRounds = page.locator('[data-help-id="field-tournament-swiss-rounds"]');
  await swissRounds.fill('');
  await expect(swissRounds).toHaveValue('');
  await swissRounds.pressSequentially('4');
  await expect(swissRounds).toHaveValue('4');
  await page.locator('[data-help-id="action-toggle-advanced-phase-builder"]').click();
  await page.locator('[data-help-id="action-add-tournament-phase"]').click();

  const directCapacity = page.locator('[data-help-id="field-group-direct-advancement-capacity"]');
  await directCapacity.fill('');
  await expect(directCapacity).toHaveValue('');
  await directCapacity.pressSequentially('2');
  await expect(directCapacity).toHaveValue('2');
  await directCapacity.fill('0');

  const qualifierInputs = page.locator('[data-help-id="field-group-advance-count"]');
  await expect(qualifierInputs).toHaveCount(4);
  for (let index = 0; index < await qualifierInputs.count(); index += 1) {
    await qualifierInputs.nth(index).fill('2');
  }
  await expect(page.getByText('Configured total: 8 qualifier(s)')).toBeVisible();

  await page.locator('[data-help-id="action-generate-advancement-mappings"]').click();
  const mappingRegion = page.locator('[data-help-id="region-tournament-advancement-mappings"]');
  await expect(mappingRegion).toBeVisible();
  await expect.poll(async () => (await mappingRegion.innerText()).match(/^\d+\. .* position \d+ → /gm)?.length || 0).toBe(8);
  await expect(mappingRegion.getByText(/same source group/i)).toHaveCount(0);
  await expect(mappingRegion.getByText(/same first-round match/i)).toHaveCount(0);

  const sourceGroups = mappingRegion.locator('[data-help-id="option-advancement-source-group"]');
  const sourceRanks = mappingRegion.locator('[data-help-id="field-advancement-source-rank"]');
  const targetSeeds = mappingRegion.locator('[data-help-id="field-advancement-target-seed"]');
  const firstSeed = await targetSeeds.first().inputValue();
  await targetSeeds.first().fill('');
  await expect(targetSeeds.first()).toHaveValue('');
  await targetSeeds.first().pressSequentially(firstSeed);
  await expect(targetSeeds.first()).toHaveValue(firstSeed);
  const originalSource = await sourceGroups.nth(1).inputValue();
  const firstRank = await sourceRanks.nth(0).inputValue();
  await sourceRanks.nth(0).fill('');
  await expect(sourceRanks.nth(0)).toHaveValue('');
  await sourceRanks.nth(0).pressSequentially(firstRank);
  await sourceGroups.nth(1).selectOption(await sourceGroups.nth(0).inputValue());
  await sourceRanks.nth(1).fill(firstRank);
  await expect(sourceRanks.nth(0)).toHaveAttribute('aria-invalid', 'true');
  await expect(sourceRanks.nth(1)).toHaveAttribute('aria-invalid', 'true');
  await sourceGroups.nth(1).selectOption(originalSource);
  await expect(sourceRanks.nth(1)).toHaveAttribute('aria-invalid', 'false');
});

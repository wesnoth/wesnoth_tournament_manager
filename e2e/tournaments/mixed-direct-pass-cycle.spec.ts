import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const players = [
  'Blair', 'Caritas', 'newbieA', 'clmates', 'StonyDrew', 'Danniel_BR',
  'KhorneflakesBA', 'NanRoig', 'Blop', 'Haldiel', 'matto', 'Skyend',
];

async function selectSimulatedPlayer(page: Page, nickname: string) {
  const input = page.locator('[data-help-id="field-test-user-search"]').first();
  await input.fill(nickname);
  await page.locator('[data-help-id="action-test-select-user"]')
    .filter({ hasText: nickname }).first().click();
}

async function savePass(page: Page, nickname: string, groupId: string, round: string) {
  const row = page.locator('tr').filter({ has: page.getByRole('link', { name: nickname, exact: true }) });
  await row.locator('[data-help-id="option-participant-direct-pass-group"]').selectOption(groupId);
  await row.locator('[data-help-id="field-participant-direct-pass-round"]').fill(round);
  const responsePromise = page.waitForResponse(response => response.request().method() === 'PUT'
    && response.url().includes('/direct-pass/'));
  await row.locator('[data-help-id="action-save-participant-direct-pass"]').click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

/** Use the browser's test-only simulator, not direct API writes, for every played game. */
async function simulateOpenPhaseGame(context: BrowserContext, tournamentId: string, phaseName: string) {
  const page = await context.newPage();
  try {
    await page.goto('/admin/replays');
    const mode = page.locator('[data-help-id="option-test-match-mode"]');
    if (!(await mode.count())) await page.locator('[data-help-id="action-open-test-simulate-match"]').click();
    const tournamentList = page.waitForResponse(response => response.url().includes('/test-tools/tournaments?mode=tournament_unranked'));
    await mode.selectOption('tournament_unranked');
    await tournamentList;
    const tournaments = page.locator('[data-help-id="field-test-tournament"]');
    await page.waitForTimeout(250);
    // Finished tournaments deliberately disappear from the active simulator.
    if (!(await tournaments.locator(`option[value="${tournamentId}"]`).count())) return false;
    await tournaments.selectOption(tournamentId);
    const matches = page.locator('[data-help-id="field-test-open-match"]');
    let options: Array<{ value: string; text: string }> = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      options = await matches.locator('option').evaluateAll(nodes => nodes.map(node => ({
        value: (node as HTMLOptionElement).value,
        text: node.textContent || '',
      })));
      if (options.some(option => option.text.startsWith(`${phaseName} /`))) break;
      await page.waitForTimeout(250);
    }
    const match = options.find(option => option.text.startsWith(`${phaseName} /`));
    if (!match) return false;
    await matches.selectOption(match.value);
    await page.locator('[data-help-id="option-test-match-winner"]').first().check();
    const responsePromise = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith('/test-tools/simulate-match'));
    await page.locator('[data-help-id="action-test-simulate-match"]').click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBe(true);
    return true;
  } finally {
    await page.close();
  }
}

test('mixed round-one and semifinal passes preserve drafts and produce playable bracket', async ({ page }) => {
  test.setTimeout(420_000);
  const tournamentName = `Mixed pass cycle ${Date.now()}`;
  let tournamentId = process.env.E2E_REUSE_TOURNAMENT_ID;
  if (!tournamentId) {
  await page.goto('/my-tournaments');
  await page.locator('[data-help-id="action-open-create-tournament"]').click();
  await page.locator('[data-help-id="field-tournament-name"]').fill(tournamentName);
  await page.locator('[data-help-id="field-tournament-description"]').fill('Playwright mixed-round direct-pass cycle.');
  await page.locator('[data-help-id="option-tournament-mode-unranked"]').check();
  await page.locator('[data-help-id="action-toggle-tournament-phase-configuration"]').click();
  page.on('dialog', dialog => dialog.accept());
  const builder = page.locator('[data-help-id="region-tournament-phase-builder"]');
  await builder.locator('[data-help-id="option-tournament-format-template"]').selectOption('swiss');
  await builder.locator('[data-help-id="action-toggle-advanced-phase-builder"]').click();
  await builder.locator('[data-help-id="field-tournament-phase-group-count"]').first().fill('2');
  await builder.locator('[data-help-id="field-tournament-swiss-rounds"]').fill('3');
  await builder.locator('[data-help-id="option-tournament-phase-best-of"]').first().selectOption('1');
  await builder.locator('[data-help-id="action-add-tournament-phase"]').click();
  await builder.locator('[data-help-id="field-tournament-phase-name"]').nth(1).fill('Elimination');
  await builder.locator('[data-help-id="option-tournament-phase-best-of"]').nth(1).selectOption('1');
  for (const input of await builder.locator('[data-help-id="field-group-advance-count"]').all()) await input.fill('2');
  await builder.locator('[data-help-id="field-group-direct-advancement-capacity"]').fill('2');
  await builder.locator('[data-help-id="action-generate-advancement-mappings"]').click();
  await expect(builder.locator('[data-help-id="field-advancement-target-seed"]')).toHaveCount(4);
  await page.locator('[data-help-id="action-toggle-tournament-format-settings"]').click();
  await page.locator('[data-help-id="field-tournament-max-participants"]').fill('12');
  await page.locator('[data-help-id="action-toggle-tournament-assets"]').click();
  for (const hook of ['option-tournament-faction', 'option-tournament-map']) {
    const boxes = page.locator(`[data-help-id="${hook}"]`);
    for (let index = 0; index < await boxes.count(); index += 1) {
      if (!(await boxes.nth(index).isChecked())) await boxes.nth(index).check();
    }
  }
  await page.locator('[data-help-id="action-create-tournament"]').click();
  const row = page.locator('tr').filter({ hasText: tournamentName });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('[data-help-id="action-open-tournament-from-name"]').click();
  tournamentId = page.url().split('/').pop()!;

  for (const nickname of players) {
    const countText = await page.getByText(/^Participants \(\d+\)$/).first().innerText();
    const before = Number(countText.match(/\d+/)?.[0] || 0);
    await selectSimulatedPlayer(page, nickname);
    await page.locator('[data-help-id="action-test-simulate-join"]').click();
    await expect(page.getByText(`Participants (${before + 1})`, { exact: true })).toBeVisible();
  }
  } else {
    await page.goto(`/tournament/${tournamentId}`);
  }
  await page.locator('[data-help-id="action-tab-participants"]').click();
  const mattoRow = page.locator('tr').filter({ has: page.getByRole('link', { name: 'matto', exact: true }) });
  const skyendRow = page.locator('tr').filter({ has: page.getByRole('link', { name: 'Skyend', exact: true }) });
  const spareRow = page.locator('tr').filter({ has: page.getByRole('link', { name: 'Blair', exact: true }) });
  await expect(spareRow.locator('[data-help-id="action-save-participant-direct-pass"]')).toHaveCount(0);
  const groupOptions = await mattoRow.locator('[data-help-id="option-participant-direct-pass-group"] option')
    .evaluateAll(nodes => nodes.map(node => ({ value: (node as HTMLOptionElement).value, label: node.textContent || '' })));
  const eliminationGroup = groupOptions.find(option => option.label.includes('Elimination ('));
  expect(eliminationGroup).toBeTruthy();
  await mattoRow.locator('[data-help-id="option-participant-direct-pass-group"]').selectOption(eliminationGroup!.value);
  await mattoRow.locator('[data-help-id="field-participant-direct-pass-round"]').fill('1');
  await savePass(page, 'Skyend', eliminationGroup!.value, '2');
  await expect(mattoRow.locator('[data-help-id="option-participant-direct-pass-group"]')).toHaveValue(eliminationGroup!.value);
  await expect(mattoRow.locator('[data-help-id="field-participant-direct-pass-round"]')).toHaveValue('1');
  const savedMatto = await savePass(page, 'matto', eliminationGroup!.value, '1');
  expect(savedMatto.adjusted_mappings).toBe(1);
  await expect(mattoRow).toContainText('qualifier mapping(s) adjusted');

  const formatResponse = await page.request.get(`/api/tournaments/${tournamentId}/format`);
  expect(formatResponse.ok()).toBe(true);
  const format = await formatResponse.json();
  expect(format.advancement_rules.map((rule: any) => Number(rule.target_seed)).sort((a: number, b: number) => a - b)).toEqual([1, 4, 6, 8]);

  await page.locator('[data-help-id="action-close-registration"]').click();
  await expect(page.getByText('Registration Closed', { exact: true })).toBeVisible();
  await page.locator('[data-help-id="action-prepare-tournament"]').click();
  await expect(page.getByText('Prepared', { exact: true })).toBeVisible();
  await page.locator('[data-help-id="action-start-tournament"]').click();
  await expect(page.getByText('In Progress', { exact: true })).toBeVisible();

  let swissGames = 0;
  while (swissGames < 20 && await simulateOpenPhaseGame(page.context(), tournamentId, 'Swiss')) swissGames += 1;
  expect(swissGames).toBe(12);
  await page.reload();
  await page.locator('[data-help-id="action-tab-competition"]').click();
  await expect(page.getByText('Start phase', { exact: true })).toBeVisible();
  const competition = await page.request.get(`/api/tournaments/${tournamentId}/competition`);
  expect(competition.ok()).toBe(true);
  const snapshot = await competition.json();
  const elimination = snapshot.phases.find((phase: any) => phase.phase_name === 'Elimination');
  expect(elimination.phase_status).toBe('ready');
  const bracketResponse = await page.request.get(`/api/tournaments/${tournamentId}/phases/${elimination.phase_id}/bracket`);
  expect(bracketResponse.ok()).toBe(true);
  const bracket = await bracketResponse.json();
  const mattoSlot = bracket.slots.find((slot: any) => slot.round_number === 1 && slot.resolved_entry_name === 'matto');
  expect(mattoSlot).toBeTruthy();
  expect(bracket.slots.find((slot: any) => slot.series_id === mattoSlot.series_id
    && slot.slot_number !== mattoSlot.slot_number)?.resolved_entry_name).toBeTruthy();

  await page.getByText('Start phase', { exact: true }).click();
  let eliminationGames = 0;
  while (eliminationGames < 10 && await simulateOpenPhaseGame(page.context(), tournamentId, 'Elimination')) eliminationGames += 1;
  expect(eliminationGames).toBe(6);
  await page.reload();
  await expect(page.getByText('Finished', { exact: true })).toBeVisible();
});

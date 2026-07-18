import { expect, test } from '@playwright/test';

const tournamentName = process.env.E2E_TOURNAMENT_NAME || 'test_003_ranked_complex_template';
const autoAdvanceRounds = process.env.E2E_AUTO_ADVANCE === '1';
const formatTemplate = process.env.E2E_FORMAT_TEMPLATE || 'swiss_brackets_final';
const tournamentMode = process.env.E2E_TOURNAMENT_MODE || 'ranked';
const swissRounds = process.env.E2E_SWISS_ROUNDS || '3';
const participantCount = Number(process.env.E2E_PARTICIPANTS || 16);
const preliminaryBestOf = process.env.E2E_PRELIMINARY_BEST_OF || '1';
const finalBestOf = process.env.E2E_FINAL_BEST_OF || '3';
const skipJoin = process.env.E2E_SKIP_JOIN === '1';

async function findRealPlayers(page: import('@playwright/test').Page, rankedOnly: boolean, requiredCount: number) {
  const configuredNames = process.env.E2E_PLAYER_NAMES?.split(',').map((name) => name.trim()).filter(Boolean) || [];
  if (configuredNames.length >= requiredCount) return configuredNames.slice(0, requiredCount);

  console.log('Navigating to /players');
  await page.goto('/players');
  console.log(`Players page loaded at ${page.url()}`);
  await expect(page.locator('table').first()).toBeVisible({ timeout: 30_000 });
  console.log('Players table is visible');
  if (rankedOnly) {
    await page.locator('#ranked_only').check();
    console.log('Ranked-only filter applied');
    await expect(page.locator('table').first()).toBeVisible({ timeout: 30_000 });
  }

  const names: string[] = [];
  while (names.length < requiredCount) {
    const pageNames = await page.locator('table').first().locator('tr').evaluateAll((rows) =>
      rows.map((row) => row.querySelector('a[data-help-id="action-view-player-profile"]')?.textContent?.trim())
        .filter((name): name is string => Boolean(name))
    );
    for (const name of pageNames) {
      if (!names.includes(name)) names.push(name);
    }
    if (names.length >= requiredCount) break;

    // Team scenarios need twice as many users as entries. Follow the public
    // player pagination instead of silently limiting the fixture pool to the
    // first 20 rows rendered by the page.
    const nextPage = page.locator('[data-help-id="action-players-pagination-next"]').first();
    if (!(await nextPage.count()) || await nextPage.isDisabled()) break;
    const playersResponse = page.waitForResponse(response =>
      response.request().method() === 'GET' && response.url().includes('/api/public/players')
    );
    await nextPage.click();
    await playersResponse;
    await expect(page.locator('table').first()).toBeVisible();
  }
  if (names.length < requiredCount) {
    throw new Error(`Players page returned ${names.length} eligible players; ${requiredCount} are required`);
  }
  return names.slice(0, requiredCount);
}

function action(page: import('@playwright/test').Page, helpId: string, label: RegExp) {
  return page.locator(`[data-help-id="${helpId}"]`)
    .or(page.getByRole('button', { name: label }))
    .or(page.locator('button').filter({ hasText: /create|crear|close|cerrar|prepare|preparar|start|iniciar|simulate|simular/i }))
    .first();
}

async function openTournamentSection(page: import('@playwright/test').Page, helpId: string) {
  const summary = page.locator(`[data-help-id="${helpId}"]`);
  await expect(summary).toBeVisible();
  const isOpen = await summary.evaluate(element => element.parentElement?.hasAttribute('open') || false);
  if (!isOpen) await summary.click();
}

async function selectUser(page: import('@playwright/test').Page, inputIndex: number, nickname: string) {
  const searchInputs = page.locator('input[data-help-id="field-test-user-search"]');
  const input = searchInputs.nth(inputIndex);
  console.log(`Selecting ${nickname}; search inputs: ${await searchInputs.count()}`);
  await input.fill(nickname);
  const option = page.locator('[data-help-id="action-test-select-user"]')
    .filter({ hasText: nickname })
    .first();
  console.log(`Waiting for autocomplete option ${nickname}`);
  await expect(option).toBeVisible();
  await option.click();
  await expect(input).toHaveValue(nickname);
  console.log(`Selected autocomplete option ${nickname}`);
}

async function simulateJoin(page: import('@playwright/test').Page, nickname: string) {
  const participantsLabel = page.getByText(/^Participants \(\d+\)$/).first();
  const before = await participantsLabel.textContent();
  const beforeCount = Number(before?.match(/\d+/)?.[0] || 0);
  await selectUser(page, 0, nickname);
  const joinAction = page.locator('[data-help-id="action-test-simulate-join"]');
  const visibleJoinAction = joinAction.or(page.getByRole('button', { name: /simulate join/i })).first();
  console.log(`Waiting for Simulate Join for ${nickname}`);
  await expect(visibleJoinAction).toBeEnabled();
  await visibleJoinAction.click();
  console.log(`Submitted Simulate Join for ${nickname}`);
  // The detail refresh can remount the test panel, so its transient success
  // message is not a reliable completion signal. The participant counter is.
  await expect(page.getByText(`Participants (${beforeCount + 1})`, { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function simulateTeamJoin(page: import('@playwright/test').Page, firstNickname: string, secondNickname: string, teamName: string) {
  const teamNameInput = page.locator('[data-help-id="field-test-team-name"]');
  await expect(teamNameInput).toBeVisible();
  await teamNameInput.fill(teamName);
  await selectUser(page, 0, firstNickname);
  await selectUser(page, 1, secondNickname);
  const joinAction = page.locator('[data-help-id="action-test-simulate-join"]');
  await expect(joinAction).toBeEnabled();
  const joinResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && response.url().includes('/test-tools/tournaments/')
      && response.url().endsWith('/simulate-join')
  );
  await joinAction.click();
  const response = await joinResponse;
  expect(response.ok()).toBe(true);
  // Phase-engine refreshes return to Competition by default. Reopen the team
  // list before asserting the materialized join result.
  await page.locator('[data-help-id="action-tab-participants"]').click();
  await expect(page.locator('h3').filter({ hasText: teamName }).first()).toBeVisible({ timeout: 30_000 });
}

async function registeredTeamNames(page: import('@playwright/test').Page): Promise<string[]> {
  const teamsTab = page.locator('[data-help-id="action-tab-participants"]');
  if (await teamsTab.count()) await teamsTab.click();
  return page.locator('h3').evaluateAll((headings) =>
    headings.map((heading) => heading.textContent?.trim() || '')
      .filter((name) => /^team_\d+$/.test(name))
      .sort((left, right) => Number(left.slice(5)) - Number(right.slice(5))));
}

async function simulateOpenMatch(page: import('@playwright/test').Page, tournamentName: string): Promise<number> {
  const simulatorHeading = page.getByRole('heading', { name: 'Simulate Match', exact: true });
  if (!(await simulatorHeading.count())) {
    await page.goto('/admin/replays');
    const openSimulator = page.locator('[data-help-id="action-open-test-simulate-match"]');
    await expect(openSimulator).toBeVisible({ timeout: 30_000 });
    await openSimulator.click();
    await page.waitForTimeout(1_000);
  }
  await expect(simulatorHeading).toBeVisible();
  const matchMode = page.locator('[data-help-id="option-test-match-mode"]');
  const simulationMode = tournamentMode === 'team'
    ? 'tournament_team'
    : tournamentMode === 'unranked' ? 'tournament_unranked' : 'tournament_ranked';
  await matchMode.selectOption(simulationMode);
  await expect(matchMode).toHaveValue(simulationMode);
  await page.waitForTimeout(1_000);
  const tournamentSelect = page.locator('[data-help-id="field-test-tournament"]');
  await expect(tournamentSelect.locator('option', { hasText: tournamentName })).toHaveCount(1, { timeout: 30_000 });
  await tournamentSelect.selectOption({ label: tournamentName });
  const openMatch = page.locator('[data-help-id="field-test-open-match"]');
  await expect(openMatch).toBeVisible();
  await page.waitForTimeout(1_000);
  let openMatchCount = await openMatch.locator('option').count() - 1;
  if (openMatchCount === 0) {
    // Series completion can create the next game asynchronously. Do not
    // advance rounds until the empty state has remained stable briefly.
    for (let retry = 0; retry < 5 && openMatchCount === 0; retry += 1) {
      await page.waitForTimeout(2_000);
      openMatchCount = await openMatch.locator('option').count() - 1;
    }
    if (openMatchCount === 0) {
      console.log('No open matches remain; returning to tournament rounds');
      return 0;
    }
  }
  console.log(`Open matches available: ${openMatchCount}`);
  await openMatch.selectOption({ index: 1 });
  const winnerOptions = page.locator('[data-help-id="option-test-match-winner"]');
  await expect(winnerOptions).toHaveCount(2);
  const winnerIndex = Math.floor(Math.random() * 2);
  console.log(`Selecting random winner option: player ${winnerIndex + 1}`);
  await winnerOptions.nth(winnerIndex).check();
  const simulateMatch = page.locator('[data-help-id="action-test-simulate-match"]');
  await expect(simulateMatch).toBeEnabled();
  await simulateMatch.click();
  // The panel remains open by design and its asynchronous refresh may keep the
  // same select node. Re-read the actual list because a BO3 can keep the same
  // round match open while creating another game in the series.
  await page.waitForTimeout(1_000);
  return await openMatch.locator('option').count() - 1;
}

async function reportOpenMatchesUntilEmpty(page: import('@playwright/test').Page, tournamentName: string) {
  let remaining = 1;
  while (remaining > 0) {
    remaining = await simulateOpenMatch(page, tournamentName);
  }
}

async function readTournamentStatus(
  page: import('@playwright/test').Page,
  tournamentName: string,
): Promise<{ status: string; href: string }> {
  await page.goto('/tournaments');
  const row = page.locator('tr').filter({ hasText: tournamentName }).last();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const status = await row.innerText();
  const details = row.locator('[data-help-id="action-view-tournament-details"], a, button').first();
  await details.click();
  await expect(page).toHaveURL(/\/tournament\//, { timeout: 30_000 });
  return { status, href: page.url() };
}

async function assertOverallStandings(page: import('@playwright/test').Page, expectedEntries: number) {
  const standingsTab = page.locator('[data-help-id="action-tab-tournament-standings"]');
  await expect(standingsTab).toBeVisible();
  await standingsTab.click();
  const region = page.locator('[data-help-id="region-tournament-overall-standings"]');
  await expect(region).toBeVisible({ timeout: 30_000 });
  await expect(region.locator('tbody tr')).toHaveCount(expectedEntries);
  await expect(region).toContainText('Champion');
  await expect(region).toContainText('Runner-up');
  await expect(region).toContainText('Eliminated');
  await expect(region.locator('tbody tr').first().locator('td').first()).toHaveText('1');
  if (tournamentMode === 'team') {
    const labels = await region.locator('tbody tr td:nth-child(2)').allTextContents();
    expect(labels.every(label => /\([^(),]+,\s*[^()]+\)$/.test(label.trim()))).toBe(true);
  }
}

async function assertTeamMembersAcrossCompetition(page: import('@playwright/test').Page, tournamentId: string) {
  if (tournamentMode !== 'team') return;
  const competitionResponse = await page.request.get(`/api/tournaments/${tournamentId}/competition`);
  expect(competitionResponse.ok()).toBe(true);
  const competition = await competitionResponse.json();
  const phases = Array.from(new Map((competition.phases || []).map((phase: any) => [phase.phase_id, phase])).values()) as any[];
  const labels: string[] = [];
  for (const phase of phases) {
    const detailEndpoint = phase.format === 'single_elimination' ? 'bracket' : 'standings';
    const detailResponse = await page.request.get(`/api/tournaments/${tournamentId}/phases/${phase.phase_id}/${detailEndpoint}`);
    expect(detailResponse.ok()).toBe(true);
    const detail = await detailResponse.json();
    for (const row of detail.standings || []) labels.push(row.entry_name);
    for (const slot of detail.slots || []) {
      if (slot.resolved_entry_name) labels.push(slot.resolved_entry_name);
    }
    const gamesResponse = await page.request.get(`/api/tournaments/${tournamentId}/phases/${phase.phase_id}/games`);
    expect(gamesResponse.ok()).toBe(true);
    const games = await gamesResponse.json();
    for (const game of games.games || []) labels.push(game.entry1_name, game.entry2_name);
  }
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every(label => /\([^(),]+,\s*[^()]+\)$/.test(label.trim()))).toBe(true);

  await page.locator('[data-help-id="action-tab-competition"]').click();
  const competitionRegion = page.locator('[data-help-id="region-tournament-competition"]');
  await expect(competitionRegion).toBeVisible();
  await expect(competitionRegion).toContainText(labels[0]);
}

async function advanceTournamentUntilFinished(
  page: import('@playwright/test').Page,
  tournamentName: string,
  autoAdvance: boolean,
) {
  while (true) {
    // The list is the source of truth for the tournament lifecycle. Do not
    // infer the next round from a hard-coded round number or from the match
    // simulator becoming empty.
    const initialState = await readTournamentStatus(page, tournamentName);
    if (/\bFinished\b/i.test(initialState.status)) return;

    await reportOpenMatchesUntilEmpty(page, tournamentName);

    const state = await readTournamentStatus(page, tournamentName);
    if (/\bFinished\b/i.test(state.status)) return;
    if (!/\bIn Progress\b/i.test(state.status)) {
      await page.waitForTimeout(3_000);
      continue;
    }

    if (autoAdvance) {
      // Automatic tournaments progress without a manual phase start action.
      await page.waitForTimeout(3_000);
      continue;
    }

    // Later phases are deliberately compiled as ready. The test starts them
    // through the same competition control available to an organizer.
    const competitionTab = page.locator('[data-help-id="action-tab-competition"]');
    await expect(competitionTab).toBeVisible();
    await competitionTab.click();
    const startPhase = page.locator('[data-help-id="action-start-tournament-phase"]').first();
    if (await startPhase.count()) {
      await expect(startPhase).toBeEnabled();
      await startPhase.click();
      await page.waitForTimeout(1_000);
    } else {
      // The previous result may still be finalizing and compiling advancement.
      await page.waitForTimeout(3_000);
    }
  }
}

test('flexible tournament accepts simulated joins and progresses through every configured phase', async ({ page }) => {
  test.setTimeout(900_000);
  const requiredPlayers = tournamentMode === 'team' ? participantCount * 2 : participantCount;
  const players = await findRealPlayers(page, tournamentMode === 'ranked', requiredPlayers);
  console.log(`Selected players: ${players.join(', ')}`);
  console.log(`Opening ${page.url()}/my-tournaments`);
  await page.goto('/my-tournaments');
  console.log(`Loaded ${page.url()} with title ${await page.title()}`);
  await page.waitForTimeout(5_000);
  console.log(`Body after load: ${(await page.locator('body').innerText()).slice(0, 1_000)}`);
  await expect(page).not.toHaveURL(/\/login/);
  const existingRow = page.locator('tr').filter({ hasText: tournamentName }).last();
  let tournamentHref: string;
  let tournamentInProgress = false;
  if (await existingRow.count()) {
    if (await existingRow.getByText('Finished', { exact: true }).count()) {
      await existingRow.locator('[data-help-id="action-view-tournament-details"], button').first().click();
      await expect(page).toHaveURL(/\/tournament\//, { timeout: 30_000 });
      await assertOverallStandings(page, participantCount);
      await assertTeamMembersAcrossCompetition(page, page.url().split('/').pop()!);
      console.log('Tournament is already finished and its overall standings are valid');
      return;
    }
    tournamentInProgress = await existingRow.getByText('In Progress', { exact: true }).count() > 0;
    await existingRow.locator('[data-help-id="action-view-tournament-details"], button').first().click();
    await expect(page).toHaveURL(/\/tournament\//, { timeout: 30_000 });
    tournamentHref = page.url();
  } else {
    const createAction = action(page, 'action-open-create-tournament', /create tournament|crear torneo/i);
    await expect(createAction).toBeVisible({ timeout: 30_000 });
    await createAction.click();
    await page.waitForTimeout(1_000);
    await page.locator('[data-help-id="field-tournament-name"]').fill(tournamentName);
    await page.waitForTimeout(1_000);
    await page.locator('[data-help-id="field-tournament-description"]').fill('# Playwright test tournament');
    await page.waitForTimeout(1_000);
    await page.locator(`[data-help-id="option-tournament-mode-${tournamentMode}"]`).check();
    await page.waitForTimeout(1_000);
    await openTournamentSection(page, 'action-toggle-tournament-phase-configuration');
    await page.locator('[data-help-id="option-tournament-format-template"]').selectOption(formatTemplate);
    if (formatTemplate === 'swiss_brackets_final') {
      // Guard the template contract itself before exercising the engine. This
      // catches accidental UI/template changes independently of progression.
      const groupCounts = page.locator('[data-help-id="field-tournament-phase-group-count"]');
      await expect(groupCounts).toHaveCount(3);
      await expect(groupCounts.nth(0)).toHaveValue('4');
      await expect(groupCounts.nth(1)).toHaveValue('2');
      await expect(groupCounts.nth(2)).toHaveValue('1');
    }
    await openTournamentSection(page, 'action-toggle-tournament-format-settings');
    await page.locator('[data-help-id="field-tournament-max-participants"]').fill(String(participantCount));
    await page.waitForTimeout(1_000);
    await openTournamentSection(page, 'action-toggle-tournament-assets');
    // Select every asset explicitly; the aggregate Select All checkbox can
    // retain stale derived state when the form changes tournament type.
    const factionOptions = page.locator('[data-help-id="option-tournament-faction"]');
    await expect(factionOptions.first()).toBeVisible();
    for (let index = 0; index < await factionOptions.count(); index += 1) {
      const faction = factionOptions.nth(index);
      if (!(await faction.isChecked())) await faction.check();
    }
    expect(await factionOptions.evaluateAll((inputs) => inputs.every((input) => (input as HTMLInputElement).checked))).toBe(true);
    const mapOptions = page.locator('[data-help-id="option-tournament-map"]');
    await expect(mapOptions.first()).toBeVisible();
    for (let index = 0; index < await mapOptions.count(); index += 1) {
      const map = mapOptions.nth(index);
      if (!(await map.isChecked())) await map.check();
    }
    expect(await mapOptions.evaluateAll((inputs) => inputs.every((input) => (input as HTMLInputElement).checked))).toBe(true);
    await page.waitForTimeout(1_000);
    if (autoAdvanceRounds) {
      await openTournamentSection(page, 'action-toggle-tournament-round-configuration');
      const autoAdvance = page.locator('[data-help-id="option-tournament-auto-advance"]');
      if (!(await autoAdvance.isChecked())) await autoAdvance.check();
      await page.waitForTimeout(1_000);
    }
    const bestOfControls = page.locator('[data-help-id="option-tournament-phase-best-of"]');
    const phaseCount = await bestOfControls.count();
    for (let index = 0; index < phaseCount; index += 1) {
      const bestOf = index === phaseCount - 1 ? finalBestOf : preliminaryBestOf;
      await bestOfControls.nth(index).selectOption(bestOf);
    }
    const swissRoundControls = page.locator('[data-help-id="field-tournament-swiss-rounds"]');
    if (await swissRoundControls.count()) {
      await swissRoundControls.first().fill(swissRounds);
    }
    await page.waitForTimeout(1_000);
    await page.locator('[data-help-id="action-create-tournament"]').click();

    await expect(page).toHaveURL(/\/(my-tournaments|tournaments)(?:\?.*)?$/, { timeout: 30_000 });
    await expect(page.getByText(tournamentName, { exact: true })).toBeVisible();
    const tournamentRow = page.locator('tr').filter({ hasText: tournamentName }).last();
    await tournamentRow.locator('[data-help-id="action-view-tournament-details"], button').first().click();
    await expect(page).toHaveURL(/\/tournament\//, { timeout: 30_000 });
    tournamentHref = page.url();
  }
  expect(tournamentHref).toMatch(/\/tournament\//);
  if (formatTemplate === 'swiss_brackets_final') {
    const tournamentId = tournamentHref.split('/').pop();
    const detailResponse = await page.request.get(`/api/public/tournaments/${tournamentId}`);
    expect(detailResponse.ok()).toBe(true);
    const tournamentDetail = await detailResponse.json();
    expect(Number(tournamentDetail.competition_model_version)).toBe(2);
    const formatResponse = await page.request.get(`/api/tournaments/${tournamentId}/format`);
    expect(formatResponse.ok()).toBe(true);
    const savedFormat = await formatResponse.json();
    expect(savedFormat.phases).toHaveLength(3);
    expect(savedFormat.phases.map((phase: any) => phase.groups.length)).toEqual([4, 2, 1]);
    expect(savedFormat.phases.map((phase: any) => Number(phase.default_best_of))).toEqual([
      Number(preliminaryBestOf),
      Number(preliminaryBestOf),
      Number(finalBestOf),
    ]);
    await expect(page.locator('[data-help-id="region-tournament-phase-format-summary"]')).toBeVisible();
    await expect(page.locator('[data-help-id="action-tab-competition"]')).toBeVisible();
    await expect(page.locator('[data-help-id="action-tab-matches"]')).toHaveCount(0);
    await expect(page.locator('[data-help-id="action-tab-rounds"]')).toHaveCount(0);
    await expect(page.locator('[data-help-id="action-tab-round-details"]')).toHaveCount(0);
    await expect(page.locator('[data-help-id="action-tab-ranking"]')).toHaveCount(0);
  }
  if (!tournamentInProgress) {
    const participantLabel = page.getByText(/^Participants \(\d+\)$/).first();
    const existingParticipantCount = tournamentMode === 'team'
      ? (await registeredTeamNames(page)).length
      : Number((await participantLabel.textContent())?.match(/\d+/)?.[0] || 0);
    if (!skipJoin && existingParticipantCount < participantCount && await page.getByText('Registration Open', { exact: true }).count()) {
      const simulateJoinAction = page.locator('[data-help-id="action-test-simulate-join"]')
        .or(page.getByRole('button', { name: /simulate join/i }))
        .first();
      await expect(simulateJoinAction).toBeVisible({ timeout: 30_000 });

      console.log(`Existing participants before join cycle: ${existingParticipantCount}`);
      if (tournamentMode === 'team') {
        const existingTeams = new Set(await registeredTeamNames(page));
        for (let teamIndex = 0; teamIndex < participantCount; teamIndex += 1) {
          const teamName = `team_${teamIndex + 1}`;
          if (existingTeams.has(teamName)) continue;
          await simulateTeamJoin(page, players[teamIndex * 2], players[teamIndex * 2 + 1], teamName);
          existingTeams.add(teamName);
        }
      } else {
        for (const nickname of players.slice(existingParticipantCount, participantCount)) {
          await simulateJoin(page, nickname);
        }
      }
    }
    if (!skipJoin && tournamentMode === 'team') {
      await expect.poll(() => registeredTeamNames(page)).toEqual(
        Array.from({ length: participantCount }, (_, index) => `team_${index + 1}`)
      );
    } else if (!skipJoin) {
      await expect(page.getByText(`Participants (${participantCount})`, { exact: true })).toBeVisible();
    }

    if (await page.getByText('Registration Open', { exact: true }).count()) {
      await action(page, 'action-close-registration', /close registration/i).click();
      await expect(page.getByText('Registration Closed', { exact: true })).toBeVisible();
    }
    await expect(
      page.getByText('Registration Closed', { exact: true })
        .or(page.getByText('Prepared', { exact: true }))
        .or(page.getByText('In Progress', { exact: true }))
        .first()
    ).toBeVisible();
    if (!(await page.getByText('Prepared', { exact: true }).count())) {
      await action(page, 'action-prepare-tournament', /prepare tournament/i).click();
      await page.waitForTimeout(1_000);
    }
    await expect(page.getByText('Prepared', { exact: true })).toBeVisible();
    await page.waitForTimeout(1_000);
    if (!(await page.getByText('Tournament has started.', { exact: true }).count())) {
      const startTournament = page.locator('[data-help-id="action-start-tournament"]');
      await expect(startTournament).toBeVisible({ timeout: 15_000 });
      await expect(startTournament).toBeEnabled();
      await startTournament.click();
      await page.waitForTimeout(1_000);
    }
  }
  await expect(page.getByText(/tournament has started/i)).toBeVisible();

  if (formatTemplate === 'swiss_brackets_final') {
    const competitionTab = page.locator('[data-help-id="action-tab-competition"]');
    await competitionTab.click();
    await expect(page.locator('[data-help-id="region-tournament-standings-group"]')).toHaveCount(4);
    await expect(page.getByRole('columnheader', { name: 'OMP' }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'GWP' }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'OGP' }).first()).toBeVisible();
    await expect(page.locator('[data-help-id="region-tournament-phase-games"]')).toBeVisible();
  }

  await advanceTournamentUntilFinished(page, tournamentName, autoAdvanceRounds);

  await page.goto('/tournaments');
  const finishedRow = page.locator('tr').filter({ hasText: tournamentName }).last();
  await expect(finishedRow).toContainText('Finished', { timeout: 30_000 });
  const resultCells = finishedRow.locator('td');
  await expect(resultCells.nth(5)).not.toHaveText('-');
  await expect(resultCells.nth(6)).not.toHaveText('-');
  await finishedRow.locator('[data-help-id="action-view-tournament-details"], a, button').first().click();
  await expect(page).toHaveURL(/\/tournament\//, { timeout: 30_000 });
  await assertOverallStandings(page, participantCount);
  await assertTeamMembersAcrossCompetition(page, page.url().split('/').pop()!);
});

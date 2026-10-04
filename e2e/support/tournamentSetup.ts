import { expect, type Page } from '@playwright/test';
import { localStack, runSql, sqlLiteral } from './localStack';
import { loginAs } from './login';

export interface PendingTournamentGame {
  gameId: string;
  entry1Nickname: string;
  entry2Nickname: string;
}

/** Expand a collapsible tournament form section if it is closed. */
async function openSection(page: Page, helpId: string): Promise<void> {
  const summary = page.locator(`[data-help-id="${helpId}"]`);
  await expect(summary).toBeVisible();
  const isOpen = await summary.evaluate((element) => element.parentElement?.hasAttribute('open') || false);
  if (!isOpen) await summary.click();
}

/**
 * Create, fill, and start a one-round Swiss 1v1 tournament through the UI.
 *
 * Mirrors what an organizer and players do by hand: the organizer creates the
 * tournament, each player logs in and joins, the organizer accepts them,
 * closes registration, prepares, and starts. With two players one Swiss round
 * yields a single series; its games are resolved through injected forum games.
 * No test-tools shortcut is used.
 *
 * @returns the new tournament id.
 */
export async function createStartedSwissTournament(page: Page, options: {
  name: string;
  mode: 'ranked' | 'unranked';
  organizer: string;
  players: string[];
  /** Games per series; a best-of-3 between two players gives a second game after the first. */
  bestOf?: number;
}): Promise<string> {
  await loginAs(page, options.organizer);
  await page.goto('/my-tournaments');
  await page.locator('[data-help-id="action-open-create-tournament"]').click();
  await page.locator('[data-help-id="field-tournament-name"]').fill(options.name);
  await page.locator('[data-help-id="field-tournament-description"]').fill('# Replay pipeline E2E scenario');
  await page.locator(`[data-help-id="option-tournament-mode-${options.mode}"]`).check();
  await openSection(page, 'action-toggle-tournament-phase-configuration');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-help-id="option-tournament-format-template"]').selectOption('swiss');
  await page.locator('[data-help-id="field-tournament-swiss-rounds"]').first().fill('1');
  for (const bestOf of await page.locator('[data-help-id="option-tournament-phase-best-of"]').all()) {
    await bestOf.selectOption(String(options.bestOf || 1));
  }
  await openSection(page, 'action-toggle-tournament-format-settings');
  await page.locator('[data-help-id="field-tournament-max-participants"]').fill(String(options.players.length));
  await openSection(page, 'action-toggle-tournament-assets');
  for (const asset of await page.locator('[data-help-id="option-tournament-faction"], [data-help-id="option-tournament-map"]').all()) {
    if (!(await asset.isChecked())) await asset.check();
  }
  await page.locator('[data-help-id="action-create-tournament"]').click();
  const createdRow = page.locator('tr').filter({ hasText: options.name }).last();
  await expect(createdRow).toBeVisible({ timeout: 30_000 });
  await createdRow.locator('[data-help-id="action-open-tournament-from-name"]').click();
  await expect(page).toHaveURL(/\/tournament\//);
  const tournamentUrl = page.url();
  const tournamentId = tournamentUrl.split('/').pop()!;

  for (const nickname of options.players) {
    await loginAs(page, nickname);
    await page.goto(tournamentUrl);
    const join = page.locator('[data-help-id="action-join-tournament"]');
    await expect(join).toBeVisible({ timeout: 15_000 });
    await join.click();
    await expect(join).toHaveCount(0);
  }

  await loginAs(page, options.organizer);
  await page.goto(tournamentUrl);
  await page.locator('[data-help-id="action-tab-participants"]').click();
  for (const nickname of options.players) {
    const row = page.locator('tbody tr').filter({ hasText: nickname }).first();
    const accept = row.locator('[data-help-id="action-accept-participant"]');
    if (await accept.count()) await accept.click();
    await expect(row).toContainText('Accepted');
  }
  await page.locator('[data-help-id="action-close-registration"]').click();
  await page.locator('[data-help-id="action-prepare-tournament"]').click();
  await expect(page.getByText('Prepared', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-help-id="action-start-tournament"]').click();
  await expect.poll(() => getPendingTournamentGames(tournamentId).length, { timeout: 30_000 }).toBeGreaterThan(0);
  return tournamentId;
}

/**
 * Pending games of a tournament with the nickname behind each 1v1 entry.
 * Read from the database because the forum fixture needs the internal game id
 * that wesnothd would receive as TOURNAMENT_GAME_ID.
 */
export function getPendingTournamentGames(tournamentId: string): PendingTournamentGame[] {
  const db = localStack.tournamentDb;
  return runSql(
    `SELECT g.id AS gameId, u1.nickname AS entry1Nickname, u2.nickname AS entry2Nickname
     FROM ${db}.tournament_games g
     JOIN ${db}.tournament_series s ON s.id = g.series_id
     JOIN ${db}.tournament_phase_rounds r ON r.id = s.round_id
     JOIN ${db}.tournament_phase_groups gr ON gr.id = r.group_id
     JOIN ${db}.tournament_phases ph ON ph.id = gr.phase_id
     JOIN ${db}.tournament_entries e1 ON e1.id = g.entry1_id
     JOIN ${db}.tournament_participants p1 ON p1.id = e1.participant_id
     JOIN ${db}.users_extension u1 ON u1.id = p1.user_id
     JOIN ${db}.tournament_entries e2 ON e2.id = g.entry2_id
     JOIN ${db}.tournament_participants p2 ON p2.id = e2.participant_id
     JOIN ${db}.users_extension u2 ON u2.id = p2.user_id
     WHERE ph.tournament_id = ${sqlLiteral(tournamentId)} AND g.status = 'pending'
     ORDER BY g.id;`,
  ) as unknown as PendingTournamentGame[];
}

/** Status, winner nickname, and linked match of one tournament game. */
export function getTournamentGame(gameId: string): { status: string; winnerNickname: string | null; matchId: string | null; confirmationStatus: string | null } {
  const db = localStack.tournamentDb;
  const rows = runSql(
    `SELECT g.status, u.nickname AS winnerNickname, g.match_id AS matchId, g.confirmation_status AS confirmationStatus
     FROM ${db}.tournament_games g
     LEFT JOIN ${db}.tournament_entries e ON e.id = g.winner_entry_id
     LEFT JOIN ${db}.tournament_participants p ON p.id = e.participant_id
     LEFT JOIN ${db}.users_extension u ON u.id = p.user_id
     WHERE g.id = ${sqlLiteral(gameId)};`,
  );
  return rows[0] as any;
}

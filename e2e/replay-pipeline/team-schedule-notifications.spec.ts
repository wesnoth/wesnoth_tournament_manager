import { expect, test } from '@playwright/test';
import { localStack, runSql, sqlLiteral } from '../support/localStack';
import { loginAs } from '../support/login';
import { createStartedTeamTournament, getPendingTeamGames } from '../support/tournamentSetup';

/**
 * Schedule notifications of a team series (maintainer decision, 2026-10-11).
 *
 * Everyone in the series except the actor is notified, including the actor's
 * teammate, and the in-app message names both teams with their members. Discord is not checked:
 * it is disabled on the local stack, and it receives the same team fields.
 */
const red = { name: 'Red E2E', members: ['clmates', 'KhorneflakesBA'] as [string, string] };
const blue = { name: 'Blue E2E', members: ['turkish001', 'Olosta'] as [string, string] };
/** Members are listed in nickname order, case-insensitively, as the backend sorts them. */
const roster = (team: { name: string; members: string[] }) =>
  `${team.name} (${[...team.members].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).join(', ')})`;

/** A future slot on a 30-minute boundary, spread out so reruns never collide. */
function futureSlot(): string {
  const slot = new Date(Date.now() + (30 + Math.floor(Math.random() * 300)) * 86_400_000);
  slot.setUTCHours(18, 0, 0, 0);
  return slot.toISOString();
}

function notificationsFor(seriesId: string, type: string): Array<{ nickname: string; message: string }> {
  return runSql(
    `SELECT ue.nickname, n.message FROM ${localStack.tournamentDb}.user_notifications n
     JOIN ${localStack.tournamentDb}.users_extension ue
       ON ue.id COLLATE utf8mb4_general_ci = n.user_id COLLATE utf8mb4_general_ci
     WHERE n.series_id = ${sqlLiteral(seriesId)} AND n.type = ${sqlLiteral(type)}
     ORDER BY ue.nickname;`,
  ) as Array<{ nickname: string; message: string }>;
}

test('team series notifications reach the teammate and name both teams with their members', async ({ page }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36);
  const teams = [{ ...red, name: `${red.name} ${suffix}` }, { ...blue, name: `${blue.name} ${suffix}` }];
  const tournamentId = await createStartedTeamTournament(page, {
    name: `E2E team scheduling ${suffix}`,
    organizer: 'clmates',
    teams,
  });
  const [game] = getPendingTeamGames(tournamentId);
  const seriesId = runSql(
    `SELECT series_id FROM ${localStack.tournamentDb}.tournament_games WHERE id = ${sqlLiteral(game.gameId)};`,
  )[0].series_id!;

  const post = async (nickname: string, path: string, data: unknown) => {
    await loginAs(page, nickname);
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const response = await page.request.post(`${localStack.apiUrl}/tournament-scheduling${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      data,
    });
    const body = await response.json().catch(() => null);
    expect(response.status(), JSON.stringify(body)).toBe(200);
    return body;
  };

  // KhorneflakesBA (Red) proposes: notified are the teammate and both Blue members.
  const proposal = await post('KhorneflakesBA', `/tournament/${tournamentId}/series/${seriesId}/propose-slots`, {
    slot_datetimes: [futureSlot()],
  });
  const proposed = notificationsFor(seriesId, 'schedule_proposal');
  expect(proposed.map((n) => n.nickname.toLowerCase()).sort()).toEqual(['clmates', 'olosta', 'turkish001']);
  for (const notification of proposed) {
    expect(notification.message).toBe(
      `KhorneflakesBA (${teams[0].name}) proposed a schedule for the series ${roster(teams[0])} vs ${roster(teams[1])}.`,
    );
  }

  // turkish001 (Blue) rejects: the series is named from the rejecting side.
  await post('turkish001', `/proposals/${proposal.proposalId}/reject`, {});
  const rejected = notificationsFor(seriesId, 'schedule_rejected');
  expect(rejected.map((n) => n.nickname.toLowerCase()).sort()).toEqual(['clmates', 'khorneflakesba', 'olosta']);
  for (const notification of rejected) {
    expect(notification.message).toBe(
      `turkish001 (${teams[1].name}) rejected the schedule for the series ${roster(teams[1])} vs ${roster(teams[0])}.`,
    );
  }
});

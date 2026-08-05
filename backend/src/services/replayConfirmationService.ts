/**
 * Replay confirmation helpers for the phase-engine tournament model.
 */

import { query } from '../config/database.js';

export interface ReplayConfirmationInput {
  tournamentGameId?: string | null;
  winnerName: string;
  parseSummary: any;
  matchType: string;
}

export interface ValidatedFactions {
  winnerFaction: string;
  loserFaction: string;
}

/**
 * Correct team faction labels from the phase-game entries instead of the
 * replay side numbers, which do not reliably identify allied teams.
 */
export async function validateAndCorrectFactions(
  input: ReplayConfirmationInput,
  initialWinnerFaction: string,
  initialLoserFaction: string
): Promise<ValidatedFactions> {
  let winnerFaction = initialWinnerFaction;
  let loserFaction = initialLoserFaction;

  if (input.matchType !== 'tournament_unranked'
    || !input.tournamentGameId
    || !input.parseSummary?.detectedTeams) {
    return { winnerFaction, loserFaction };
  }

  try {
    const gameResult = await query(
      `SELECT entry1.team_id AS entry1_team_id, entry2.team_id AS entry2_team_id
       FROM tournament_games games
       JOIN tournament_entries entry1 ON entry1.id = games.entry1_id
       JOIN tournament_entries entry2 ON entry2.id = games.entry2_id
       WHERE games.id = ?`,
      [input.tournamentGameId]
    );
    const game = gameResult.rows?.[0];
    if (!game) return { winnerFaction, loserFaction };

    const detectedTeams = input.parseSummary.detectedTeams as Record<string, any>;
    const winningTeam = Object.values(detectedTeams).find((team: any) =>
      (team.members || []).some((member: string) =>
        member.toLowerCase() === input.winnerName.toLowerCase()
      )
    ) as any;
    const winningTeamId = winningTeam?.team_id;
    const losingTeamId = winningTeamId === game.entry1_team_id
      ? game.entry2_team_id
      : game.entry1_team_id;

    if (detectedTeams[winningTeamId]?.factions) {
      winnerFaction = detectedTeams[winningTeamId].factions.join(', ');
    }
    if (detectedTeams[losingTeamId]?.factions) {
      loserFaction = detectedTeams[losingTeamId].factions.join(', ');
    }
  } catch (error) {
    console.warn('Could not correct phase-game team factions:', error);
  }

  return { winnerFaction, loserFaction };
}

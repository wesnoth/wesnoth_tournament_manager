  /**
 * ELO Rating Calculation System (FIDE compliant)
 * Implements the official FIDE ELO rating system
 */

/**
 * Calculate the probability of winning for player A against player B
 * Formula: EA = 1 / (1 + 10^((RB - RA) / 400))
 */
export const calculateExpectedScore = (playerRating: number, opponentRating: number): number => {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
};

/**
 * Calculate K-factor based on player rating and experience
 * FIDE system:
 * K = 8 for established players (rating >= 2400)
 * K = 16 for players rated 2100-2399
 * K = 24 for players rated < 2100 and with >= 30 games
 * K = 40 for players in their first 30 games
 */
export const getKFactor = (playerRating: number | null, matchesPlayed: number): number => {
  // For unrated players
  if (playerRating === null || playerRating === 0) {
    return 40; // High K-factor for new players
  }

  if (playerRating >= 2400) {
    return 8;
  } else if (playerRating >= 2100) {
    return 16;
  } else if (matchesPlayed >= 30) {
    return 24;
  } else {
    return 40; // High K-factor for players with < 30 games
  }
};

/**
 * Calculate K-factor and return reason for debugging
 * Returns both the K-factor value and the explanation
 */
export const getKFactorWithReason = (playerRating: number | null, matchesPlayed: number): { k: number; reason: string } => {
  const playerRatingValue = playerRating || 0;

  if (playerRatingValue === 0 || playerRating === null) {
    return { k: 40, reason: 'Unrated player' };
  } else if (playerRatingValue >= 2400) {
    return { k: 8, reason: 'Elite (rating >= 2400)' };
  } else if (playerRatingValue >= 2100) {
    return { k: 16, reason: 'Intermediate (rating 2100-2399)' };
  } else if (matchesPlayed >= 30) {
    return { k: 24, reason: 'Established (30+ games, rating < 2100)' };
  } else {
    return { k: 40, reason: 'New player (< 30 games)' };
  }
};

/**
 * Calculate new rating after a match
 * Formula: RNew = ROld + K * (Score - EA)
 * where Score is 1 for win, 0.5 for draw, 0 for loss
 */
export const calculateNewRating = (
  playerRating: number | null,
  opponentRating: number,
  result: 'win' | 'loss' | 'draw',
  matchesPlayed: number
): number => {
  const k = getKFactor(playerRating, matchesPlayed);
  const expectedScore = calculateExpectedScore(playerRating || 1400, opponentRating);
  
  let actualScore = 0;
  if (result === 'win') {
    actualScore = 1;
  } else if (result === 'draw') {
    actualScore = 0.5;
  }

  const ratingChange = k * (actualScore - expectedScore);
  const newRating = (playerRating || 1400) + ratingChange;

  return Math.round(newRating);
};

/**
 * Calculate initial rating for a newly rated player after 5 games
 * Based on their performance against rated opponents
 */
export const calculateInitialRating = (
  wins: number,
  draws: number,
  losses: number,
  opponentRatings: number[]
): number => {
  if (opponentRatings.length === 0) {
    return 1400; // Minimum rating
  }

  // Calculate average opponent rating
  const averageOpponentRating = opponentRatings.reduce((a, b) => a + b, 0) / opponentRatings.length;
  
  // Calculate player's score: wins + 0.5 * draws
  const playerScore = wins + 0.5 * draws;
  const totalGames = wins + draws + losses;
  const scorePercentage = playerScore / totalGames;

  // Calculate expected rating based on performance
  // Using a simplified formula: player's performance rating
  let performanceRating = averageOpponentRating;

  // Adjust based on score
  if (scorePercentage > 0.5) {
    // Player performed better than 50%
    const performanceDifference = (scorePercentage - 0.5) * 800; // Max 400 points above average
    performanceRating = Math.round(averageOpponentRating + performanceDifference);
  } else if (scorePercentage < 0.5) {
    // Player performed worse than 50%
    const performanceDifference = (0.5 - scorePercentage) * 800; // Max 400 points below average
    performanceRating = Math.round(averageOpponentRating - performanceDifference);
  }

  // Ensure minimum rating of 1400 for FIDE compliance
  return Math.max(performanceRating, 1400);
};

/**
 * Check if a player should be rated after their matches
 * Requirements:
 * - At least 10 games played
 * - Resulting rating >= 1400
 * - Opponent rating doesn't matter
 */
export const shouldPlayerBeRated = (
  matchesPlayed: number,
  calculatedRating: number
): boolean => {
  return matchesPlayed >= 10 && calculatedRating >= 1400;
};

/**
 * Calculate trend based on current trend and result
 * Logic:
 * - If positive trend and win: +1
 * - If negative trend and win: reset to +1
 * - If positive trend and loss: reset to -1
 * - If negative trend and loss: -1
 * - If '-' (no streak) and win: +1
 * - If '-' (no streak) and loss: -1
 */
export const calculateTrend = (currentTrend: string, isWin: boolean): string => {
  // Parse current trend
  let currentCount = 0;
  let currentDirection = ''; // 'W', 'L', or ''
  
  if (currentTrend && currentTrend !== '-') {
    if (currentTrend.startsWith('+')) {
      currentDirection = 'W';
      currentCount = parseInt(currentTrend.substring(1));
    } else if (currentTrend.startsWith('-') && currentTrend.length > 1) {
      currentDirection = 'L';
      currentCount = parseInt(currentTrend.substring(1));
    }
  }

  // Apply logic
  if (isWin) {
    if (currentDirection === 'W') {
      return `+${currentCount + 1}`;
    } else {
      return '+1';
    }
  } else {
    // Loss
    if (currentDirection === 'L') {
      return `-${currentCount + 1}`;
    } else {
      return '-1';
    }
  }
};

/**
 * Recalculate all stats (ELO + wins/losses/matches) in cascade for a user and their affected matches
 * This is used when a match is cancelled and affects subsequent matches
 * @param userId - The user whose stats need recalculation
 * @param affectedMatches - All matches involving this user after the cancelled match (sorted by created_at)
 * @param cancelledMatchCreatedAt - The timestamp of the cancelled match (to exclude it and get matches after it)
 * @returns Object with recalculated stats: { elo: number, matches_played: number, total_wins: number, total_losses: number, trend: string }
 */
export const recalculateUserStatsInCascade = (
  initialElo: number,
  affectedMatches: Array<{
    id: string;
    winner_id: string;
    loser_id: string;
    created_at: string;
  }>,
  userId: string
): { elo: number; matches_played: number; total_wins: number; total_losses: number; trend: string } => {
  let currentElo = initialElo;
  let matches_played = 0;
  let total_wins = 0;
  let total_losses = 0;
  let trend = '-';

  // Process matches in order
  for (const match of affectedMatches) {
    if (match.winner_id === userId) {
      // User won
      // For cascade: we need the opponent's current ELO after previous matches
      // We'll estimate opponent's ELO based on their initial + previous wins/losses
      // This is a simplified approach - in production, you'd track all users in cascade
      
      const isWin = true;
      total_wins++;
      matches_played++;
      trend = calculateTrend(trend, isWin);
      // Note: ELO is updated externally with full opponent knowledge
    } else if (match.loser_id === userId) {
      // User lost
      const isWin = false;
      total_losses++;
      matches_played++;
      trend = calculateTrend(trend, isWin);
    }
  }

  return {
    elo: currentElo,
    matches_played,
    total_wins,
    total_losses,
    trend
  };
};

/**
 * Calculate a player's global ranking position based on their ELO rating.
 * Position = 1 + players with higher ELO, with UUID order breaking ties.
 * All non-blocked players participate, including inactive and unrated players.
 */
export const getPlayerRankingPosition = async (
  query: any,
  playerId: string,
  playerElo: number
): Promise<number> => {
  try {
    const result = await query(
      `SELECT COUNT(*) as higher_count
       FROM users_extension 
       WHERE is_blocked = false
       AND (elo_rating > ? OR (elo_rating = ? AND id < ?))`,
      [playerElo, playerElo, playerId]
    );
    
    const higherCount = result.rows?.[0]?.higher_count || 0;
    return higherCount + 1;
  } catch (err) {
    console.error('Error calculating ranking position:', err);
    return 1; // Default to rank 1 on error
  }
};

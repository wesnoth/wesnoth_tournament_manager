/**
 * Translation key for a player level.
 *
 * The backend stores levels as English identifiers (novice, initiated,
 * veteran, expert, master); every language, Spanish included, comes from the
 * locale files. Spanish words are still accepted because they were the stored
 * values before migration 20261008_120000, and a page may briefly receive
 * them from a cached response during a deployment. Unknown values fall back
 * to the novice label.
 */
const LEVEL_KEYS: Record<string, string> = {
  novice: 'level_novice',
  initiated: 'level_initiated',
  veteran: 'level_veteran',
  expert: 'level_expert',
  master: 'level_master',
  novato: 'level_novice',
  iniciado: 'level_initiated',
  veterano: 'level_veteran',
  experto: 'level_expert',
  maestro: 'level_master',
};

export const getLevelTranslationKey = (level: string | null | undefined): string =>
  LEVEL_KEYS[String(level || '').toLowerCase()] || 'level_novice';

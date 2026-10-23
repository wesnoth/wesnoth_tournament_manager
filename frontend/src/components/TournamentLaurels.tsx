import React from 'react';
import { useTranslation } from 'react-i18next';

export type LaurelMedal = 'gold' | 'silver' | 'bronze';

const MEDALS: LaurelMedal[] = ['gold', 'silver', 'bronze'];

/**
 * Wesnoth laurel art (data/core/images/misc/laurel*.png) is 72×72, too large for
 * table headers and list rows. Two pre-scaled copies live in /public/laurels:
 * 48px for the profile (sharp at 32–40px on high-DPI screens) and 24px for
 * table headers and the home page (shown at 18–20px). Letting the browser
 * shrink the 72px original to ~20px produced blurry leaves.
 */
const laurelSrc = (medal: LaurelMedal, displayPx: number) =>
  `/laurels/laurel-${medal}-${displayPx > 24 ? 48 : 24}.png`;

interface LaurelIconProps {
  medal: LaurelMedal;
  /** Rendered width and height in CSS pixels. */
  size: number;
  className?: string;
  /** Overrides the default tooltip/alt text (the medal's count label). */
  label?: string;
}

/** A single laurel image with an accessible, translated label. */
export const LaurelIcon: React.FC<LaurelIconProps> = ({ medal, size, className, label: labelOverride }) => {
  const { t } = useTranslation();
  const label = labelOverride || t(`laurels.${medal}`);
  return (
    <img
      src={laurelSrc(medal, size)}
      width={size}
      height={size}
      alt={label}
      title={label}
      className={className}
      loading="lazy"
    />
  );
};

interface TournamentLaurelsProps {
  gold?: number | null;
  silver?: number | null;
  bronze?: number | null;
}

/**
 * Profile summary of tournament podiums: one laurel per medal with the number
 * of tournaments finished in that position underneath. Medals with zero are
 * still shown (dimmed) so the layout is stable and players see what is
 * achievable; the whole block is hidden only when counts are missing, i.e. an
 * older API response.
 */
const TournamentLaurels: React.FC<TournamentLaurelsProps> = ({ gold, silver, bronze }) => {
  const { t } = useTranslation();
  if (gold == null && silver == null && bronze == null) return null;
  const counts: Record<LaurelMedal, number> = {
    gold: Number(gold) || 0,
    silver: Number(silver) || 0,
    bronze: Number(bronze) || 0,
  };

  return (
    <div className="flex items-end gap-4 max-md:gap-3" aria-label={t('laurels.title')} title={t('laurels.title')}>
      {MEDALS.map(medal => (
        <div key={medal} className={`flex flex-col items-center ${counts[medal] === 0 ? 'opacity-40' : ''}`}>
          <LaurelIcon medal={medal} size={40} className="w-10 h-10 max-md:w-8 max-md:h-8" />
          <span className="text-sm font-bold text-gray-800 leading-tight">{counts[medal]}</span>
        </div>
      ))}
    </div>
  );
};

export default TournamentLaurels;

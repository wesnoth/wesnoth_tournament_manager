import React from 'react';
import { useTranslation } from 'react-i18next';

interface StarDisplayProps {
  rating?: number | null;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const StarDisplay: React.FC<StarDisplayProps> = ({ rating, size = 'md', showLabel = false }) => {
  const { t } = useTranslation();

  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
  };

  const getLabel = (r: number): string => {
    const labelMap: { [key: number]: string } = {
      1: t('report.rating_1'),
      2: t('report.rating_2'),
      3: t('report.rating_3'),
      4: t('report.rating_4'),
      5: t('report.rating_5'),
    };
    return labelMap[r] || '';
  };

  // Get color based on rating (1-5 scale)
  const getStarColor = (r: number): string => {
    const colorMap: { [key: number]: string } = {
      1: '#ef4444', // red-500 - poor
      2: '#f97316', // orange-500 - fair
      3: '#eab308', // yellow-500 - good
      4: '#84cc16', // lime-500 - very good
      5: '#22c55e', // green-500 - excellent
      0: '#d1d5db', // gray-300 - no rating
    };
    return colorMap[Math.min(Math.max(r, 0), 5)] || '#d1d5db';
  };

  if (!rating || rating === 0) {
    return (
      <span 
        className="inline-flex items-center gap-1 group" 
        title={t('common.no_rating')}
      >
        <svg
          className={`${sizeClasses[size]} text-gray-300`}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        {showLabel && <span className="text-xs text-gray-500">{t('common.no_rating')}</span>}
      </span>
    );
  }

  const numRating = Math.min(Math.max(parseInt(String(rating)), 0), 5);
  const starColor = getStarColor(numRating);

  return (
    <span
      className="inline-flex items-center gap-2 group"
      title={`${numRating} - ${getLabel(numRating)}`}
    >
      <svg
        className={`${sizeClasses[size]} transition-colors`}
        fill={starColor}
        viewBox="0 0 24 24"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      
      {/* Show rating number when requested */}
      {showLabel && (
        <span className="text-xs font-semibold text-gray-700 group-hover:text-gray-900">
          {numRating}
        </span>
      )}
    </span>
  );
};

export default StarDisplay;

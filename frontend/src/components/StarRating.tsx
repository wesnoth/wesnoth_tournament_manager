import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface StarRatingProps {
  value: string;
  onChange: (value: string) => void;
  ratingLabels?: {
    [key: number]: string;
  };
}

const StarRating: React.FC<StarRatingProps> = ({ value, onChange, ratingLabels }) => {
  const { t } = useTranslation();
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  
  const currentValue = value ? parseInt(value) : 0;
  const displayValue = hoverValue || currentValue;

  const getLabel = (rating: number): string => {
    if (ratingLabels && ratingLabels[rating]) {
      return ratingLabels[rating];
    }
    
    // Fallback to translation keys
    const labelMap: { [key: number]: string } = {
      1: t('report.rating_1'),
      2: t('report.rating_2'),
      3: t('report.rating_3'),
      4: t('report.rating_4'),
      5: t('report.rating_5'),
    };
    
    return labelMap[rating] || '';
  };

  // Get color based on star rating (same colors as StarDisplay)
  const getStarColor = (rating: number): string => {
    const colorMap: { [key: number]: string } = {
      1: '#ef4444', // red-500 - poor
      2: '#f97316', // orange-500 - fair
      3: '#eab308', // yellow-500 - good
      4: '#84cc16', // lime-500 - very good
      5: '#22c55e', // green-500 - excellent
    };
    return colorMap[rating] || '#d1d5db'; // gray-300 for empty
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((rating) => {
          // Check if this star should be filled
          const isFilled = displayValue >= rating;
          const starColor = isFilled ? getStarColor(rating) : '#d1d5db'; // gray-300 if not filled

          return (
            <button
              data-help-id="option-match-rating"
              key={rating}
              type="button"
              onClick={() => onChange(currentValue === rating ? '' : rating.toString())}
              onMouseEnter={() => setHoverValue(rating)}
              onMouseLeave={() => setHoverValue(null)}
              className="relative group transition-transform hover:scale-110"
              title={`${rating} - ${getLabel(rating)}`}
            >
              <svg
                className="w-12 h-12 transition-all duration-100"
                fill={starColor}
                viewBox="0 0 24 24"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>

              {/* Tooltip */}
              <div className="invisible group-hover:visible absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 bg-gray-800 text-white text-xs py-2 px-3 rounded whitespace-nowrap z-10 font-medium">
                {rating} - {getLabel(rating)}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
              </div>
            </button>
          );
        })}
      </div>
      
      {/* Clear button - shown when a value is selected */}
      {currentValue > 0 && (
        <button
          data-help-id="action-clear-match-rating"
          type="button"
          onClick={() => onChange('')}
          className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100 transition-colors"
          title={t('common.clear') || 'Clear'}
        >
          ✕
        </button>
      )}
    </div>
  );
};

export default StarRating;

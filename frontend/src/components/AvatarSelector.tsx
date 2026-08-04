import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { avatarsService, Avatar } from '../services/countryAvatarService';

interface AvatarSelectorProps {
  value?: string;
  onChange: (avatarId: string) => void;
  disabled?: boolean;
}

export const AvatarSelector: React.FC<AvatarSelectorProps> = ({
  value,
  onChange,
  disabled = false
}) => {
  const { t } = useTranslation();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadAvatars = async () => {
      setIsLoading(true);
      const data = await avatarsService.getAvatars();
      console.log('Loaded avatars:', data.length);
      console.log('First avatar path:', data[0]?.path);
      setAvatars(data);

      // Set preview URL for selected avatar
      if (value) {
        const selected = data.find(a => a.id === value);
        if (selected) {
          console.log('Selected avatar path:', selected.path);
          setPreviewUrl(selected.path);
        }
      }

      setIsLoading(false);
    };

    loadAvatars();
  }, [value]);

  const handleSelect = useCallback((avatarId: string) => {
    onChange(avatarId);
  }, [onChange]);

  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    console.warn(`Failed to load avatar image: ${img.src}`);
    img.classList.add('opacity-50');
  }, []);

  if (isLoading) {
    return (
      <div className="w-full">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          {t('profile.avatar') || 'Avatar'}
        </label>
        <div className="flex items-center justify-center py-8 bg-gray-50 rounded-lg border border-gray-200">
          {t('common.loading') || 'Loading...'}
        </div>
      </div>
    );
  }

  return (
    <div data-help-id="region-avatar-selector" className="w-full">
      <label className="block text-sm font-medium text-gray-700 mb-3">
        {t('profile.avatar') || 'Avatar'}
      </label>

      <div className="mb-4 flex items-center justify-center">
        <div className="w-24 h-24 bg-gray-100 rounded-lg border-2 border-gray-300 flex items-center justify-center overflow-hidden">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Selected Avatar"
              className="w-full h-full object-cover"
              onError={handleImageError}
            />
          ) : (
            <span className="text-sm text-gray-500">{t('profile.noAvatarSelected') || 'No Avatar'}</span>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-300 rounded-lg p-4">
        {avatars.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {t('common.noResults') || 'No avatars available'}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
            {avatars.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                className={`flex flex-col items-center gap-2 p-2 rounded-lg transition-all ${
                  value === avatar.id
                    ? 'bg-blue-100 border-2 border-blue-500 shadow-md'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                onClick={() => !disabled && handleSelect(avatar.id)}
                disabled={disabled}
                title={avatar.name}
              >
                <img
                  src={avatar.path}
                  alt={avatar.name}
                  className="w-12 h-12 object-cover rounded"
                  onError={handleImageError}
                />
                <span className="text-xs text-gray-700 text-center line-clamp-2 leading-tight">
                  {avatar.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AvatarSelector;

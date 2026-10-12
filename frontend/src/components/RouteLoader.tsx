import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Fallback component shown while lazy-loaded routes are being fetched
 */
const RouteLoader: React.FC = () => {
  const { t } = useTranslation();
  return <div className="flex items-center justify-center min-h-screen bg-gray-50">
    <div className="text-center">
      <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
      <p className="mt-4 text-gray-600">{t('route_loader.loading')}</p>
    </div>
  </div>;
};

export default RouteLoader;

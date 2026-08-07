import React from 'react';
import { useTranslation } from 'react-i18next';

interface MaintenanceBannerProps {
  isVisible: boolean;
  maintenanceMode: boolean;
  globalRecalculationInProgress: boolean;
}

const MaintenanceBanner: React.FC<MaintenanceBannerProps> = ({ isVisible, maintenanceMode, globalRecalculationInProgress }) => {
  const { t } = useTranslation();

  if (!isVisible) return null;

  return (
    <div className={`fixed top-16 left-0 right-0 ${maintenanceMode ? 'bg-red-600' : 'bg-purple-700'} text-white px-4 py-4 shadow-lg z-50`}>
      <div className="max-w-6xl mx-auto flex items-center justify-center gap-3">
        <div className="text-2xl animate-pulse">{maintenanceMode ? '🔧' : '📊'}</div>
        <div className="flex flex-col">
          <h2 className="font-bold text-lg">
            {maintenanceMode ? t('maintenance.title') : t('maintenance.global_recalculation_title')}
          </h2>
          <p className="text-sm text-white/80">
            {maintenanceMode
              ? t('maintenance.message')
              : t('maintenance.global_recalculation_message')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default MaintenanceBanner;

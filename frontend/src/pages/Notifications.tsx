import React from 'react';
import { useTranslation } from 'react-i18next';
import MainLayout from '../components/MainLayout';
import NotificationsList from '../components/NotificationsList';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';

const Notifications: React.FC = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <MainLayout>
      <div className="bg-gradient-to-br from-gray-100 to-gray-300 min-h-screen py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-bold text-gray-800 mb-8 text-center">
            {t('sidebar.my_notifications') || 'My Notifications'}
          </h1>

          <div className="bg-white rounded-lg shadow-md p-8">
            <NotificationsList 
              filter="all"
            />
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default Notifications;

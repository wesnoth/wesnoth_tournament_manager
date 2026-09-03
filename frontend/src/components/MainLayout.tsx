import React from 'react';
import UserProfileNav from './UserProfileNav';

interface MainLayoutProps {
  children: React.ReactNode;
  showUserProfileNav?: boolean;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children, showUserProfileNav = true }) => {
  return (
    <div className="min-h-screen flex flex-col">
      {showUserProfileNav && <UserProfileNav />}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
};

export default MainLayout;

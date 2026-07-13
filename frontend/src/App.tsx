import React, { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n/config';
import { useAuthStore } from './store/authStore';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import MaintenanceBanner from './components/MaintenanceBanner';
import RouteLoader from './components/RouteLoader';
import { adminService } from './services/api';
import './App.css';

// Eagerly loaded (critical paths)
import Home from './pages/Home';
import Login from './pages/Login';

// Lazy-loaded routes (code-split automatically by Vite)
const Register = React.lazy(() => import('./pages/Register'));
const User = React.lazy(() => import('./pages/User'));
const Profile = React.lazy(() => import('./pages/Profile'));
const Notifications = React.lazy(() => import('./pages/Notifications'));
const PlayerProfile = React.lazy(() => import('./pages/PlayerProfile'));
const Matches = React.lazy(() => import('./pages/Matches'));
const MyMatches = React.lazy(() => import('./pages/MyMatches'));
const Admin = React.lazy(() => import('./pages/Admin'));
const MyStats = React.lazy(() => import('./pages/MyStats'));
const MyTournaments = React.lazy(() => import('./pages/MyTournaments'));
const Rankings = React.lazy(() => import('./pages/Rankings'));
const Statistics = React.lazy(() => import('./pages/Statistics'));
const Players = React.lazy(() => import('./pages/Players'));
const AdminNews = React.lazy(() => import('./pages/AdminNews'));
const AdminTournaments = React.lazy(() => import('./pages/AdminTournaments'));
const AdminDisputes = React.lazy(() => import('./pages/AdminDisputes'));
const AdminAudit = React.lazy(() => import('./pages/AdminAudit'));
const AdminReplays = React.lazy(() => import('./pages/AdminReplays'));
const AdminMapsAndFactions = React.lazy(() => import('./pages/AdminMapsAndFactions'));
const AdminBalanceEvents = React.lazy(() => import('./pages/AdminBalanceEvents'));
const Tournaments = React.lazy(() => import('./pages/Tournaments'));
const TournamentDetail = React.lazy(() => import('./pages/TournamentDetail'));
const Events = React.lazy(() => import('./pages/Events'));
const News = React.lazy(() => import('./pages/News'));
const Help = React.lazy(() => import('./pages/Help'));
const AdminWiki = React.lazy(() => import('./pages/AdminWiki'));
const AdminRuleTemplates = React.lazy(() => import('./pages/AdminRuleTemplates'));

const App: React.FC = () => {
  const { isAdmin, token, validateToken, isValidating } = useAuthStore();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [maintenanceMode, setMaintenanceMode] = React.useState(false);

  useEffect(() => {
    // Validate token on app load if token exists
    const checkAuth = async () => {
      if (token) {
        await validateToken();
      }
      setAuthChecked(true);
    };
    
    checkAuth();
  }, [token, validateToken]);

  useEffect(() => {
    // Fetch maintenance status on app load
    const checkMaintenance = async () => {
      try {
        const res = await adminService.getMaintenanceStatus();
        setMaintenanceMode(res.data.maintenance_mode);
      } catch (error) {
        console.error('Error fetching maintenance status:', error);
      }
    };

    checkMaintenance();

    // Check maintenance status every 30 seconds
    const interval = setInterval(checkMaintenance, 30000);
    return () => clearInterval(interval);
  }, []);

  // Show loading while validating auth
  if (isValidating && !authChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <MaintenanceBanner isVisible={maintenanceMode} />
        <Navbar />
        <main className={`main-content ${maintenanceMode ? 'pt-40' : ''}`}>
          <Suspense fallback={<RouteLoader />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/user" element={<User />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/player/:id" element={<PlayerProfile />} />
              <Route path="/matches" element={<Matches />} />
              <Route path="/my-matches" element={<MyMatches />} />
              <Route path="/players" element={<Players />} />
              <Route path="/rankings" element={<Rankings />} />
              <Route path="/statistics" element={<Statistics />} />
              <Route path="/faq" element={<Navigate to="/help/faq" replace />} />
              <Route path="/help" element={<Help />} />
              <Route path="/help/:slug" element={<Help />} />
              <Route path="/tournaments" element={<Tournaments />} />
              <Route path="/tournament/:id" element={<TournamentDetail />} />
              <Route path="/events" element={<Events />} />
              <Route path="/news" element={<News />} />
              <Route path="/my-stats" element={<MyStats />} />
              <Route path="/my-tournaments" element={<MyTournaments />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/news" element={<AdminNews />} />
              <Route path="/admin/faq" element={<Navigate to="/admin/wiki" replace />} />
              <Route path="/admin/tournaments" element={<AdminTournaments />} />
              <Route path="/admin/wiki" element={<AdminWiki />} />
              <Route path="/admin/rule-templates" element={<AdminRuleTemplates />} />
              <Route path="/admin/disputes" element={<AdminDisputes />} />
              <Route path="/admin/audit" element={<AdminAudit />} />
              <Route path="/admin/replays" element={<AdminReplays />} />
              <Route path="/admin/maps-and-factions" element={<AdminMapsAndFactions />} />
              <Route path="/admin/balance-events" element={<AdminBalanceEvents />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </BrowserRouter>
    </I18nextProvider>
  );
};

export default App;

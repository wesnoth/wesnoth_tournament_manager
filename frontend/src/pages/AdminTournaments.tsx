import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { publicService, tournamentService } from '../services/api';
import MainLayout from '../components/MainLayout';
import TournamentList, { Tournament } from '../components/TournamentList';

const AdminTournaments: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin } = useAuthStore();
  
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      navigate('/');
      return;
    }

    fetchTournaments();
  }, [isAuthenticated, isAdmin, navigate, currentPage]);

  const fetchTournaments = async () => {
    try {
      setLoading(true);
      setError('');
      // Fetch ALL tournaments (admin view)
      const res = await publicService.getTournaments(currentPage, {});
      setTournaments(res.data?.data || []);
      
      if (res.data?.pagination) {
        setTotalPages(res.data.pagination.totalPages);
        setTotal(res.data.pagination.total);
      }
    } catch (err: any) {
      console.error('Error fetching tournaments:', err);
      setError('Error loading tournaments');
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleViewDetails = (tournamentId: string) => {
    navigate(`/tournament/${tournamentId}`, { state: { from: 'admin-tournaments' } });
  };

  const handleDeleteTournament = async (tournamentId: string) => {
    if (!window.confirm(t('confirm_delete_tournament'))) {
      return;
    }

    try {
      setLoading(true);
      await tournamentService.deleteTournament(tournamentId);
      setError('');
      fetchTournaments();
    } catch (err: any) {
      console.error('Error deleting tournament:', err);
      setError(err.response?.data?.error || 'Failed to delete tournament');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <MainLayout><div className="max-w-6xl mx-auto px-4 py-8"><p>{t('loading')}</p></div></MainLayout>;
  }


  return (
    <MainLayout>
      <TournamentList
        title={t('sidebar.manage_tournaments')}
        tournaments={tournaments}
        loading={false}
        error={error}
        currentPage={currentPage}
        totalPages={totalPages}
        total={total}
        showFilters={true}
        showCreateButton={false}
        onPageChange={handlePageChange}
        onViewDetails={handleViewDetails}
        onDelete={handleDeleteTournament}
      />
      <div className="max-w-6xl mx-auto px-4 mt-4">
        <button
          onClick={() => navigate('/admin/rule-templates')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
        >
          <span>📜</span>
          <span>{t('admin.rule_templates', 'Manage rule templates')}</span>
        </button>
      </div>
    </MainLayout>
  );
};

export default AdminTournaments;

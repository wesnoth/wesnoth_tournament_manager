import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { publicService, tournamentService } from '../services/api';
import MainLayout from '../components/MainLayout';
import TournamentList, { FilterState, Tournament } from '../components/TournamentList';

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
  const [appliedFilters, setAppliedFilters] = useState<FilterState>({
    name: '',
    status: '',
    type: '',
    my_tournaments: false,
  });

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      navigate('/');
      return;
    }

    fetchTournaments();
  }, [isAuthenticated, isAdmin, navigate, currentPage, appliedFilters]);

  const handleFilterChange = (filters: FilterState) => {
    setAppliedFilters(filters);
    setCurrentPage(1);
  };

  const fetchTournaments = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await publicService.getTournaments(currentPage, appliedFilters);
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
      await fetchTournaments();
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
      <div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
        <div className="max-w-6xl mx-auto mb-8">
          <div className="flex justify-between items-center">
            <h1 className="text-4xl font-bold text-gray-800">{t('sidebar.manage_tournaments')}</h1>
            <button
              onClick={() => navigate('/admin/rule-templates')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
            >
              <span>📜</span>
              <span>{t('admin.rule_templates', 'Manage rule templates')}</span>
            </button>
          </div>
        </div>
        
        <div className="max-w-6xl mx-auto">
          <TournamentList
            title=""
            tournaments={tournaments}
            loading={false}
            error={error}
            currentPage={currentPage}
            totalPages={totalPages}
            total={total}
            showFilters={true}
            showCreateButton={false}
            onFilterChange={handleFilterChange}
            onPageChange={handlePageChange}
            onViewDetails={handleViewDetails}
            onDelete={handleDeleteTournament}
          />
        </div>
      </div>
    </MainLayout>
  );
};

export default AdminTournaments;

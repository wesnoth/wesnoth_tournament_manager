import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { tournamentService } from '../services/api';
import MainLayout from '../components/MainLayout';
import TournamentList, { Tournament } from '../components/TournamentList';
import TournamentForm from '../components/TournamentForm';
import type { TournamentCreatePayload, TournamentFormData } from '../types/tournament';

const MyTournaments: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState<TournamentFormData>({
    name: '',
    description: '',
    tournament_type: 'elimination',
    tournament_mode: 'ranked',
    max_participants: null,
    round_duration_days: 7,
    auto_advance_round: false,
    scheduled_start_at: null,
    general_rounds: 0,
    final_rounds: 0,
    general_rounds_format: 'bo3',
    final_rounds_format: 'bo5',
    rules_template_id: null,
    rules_content: '',
    organizer_ids: [],
  });
  const [unrankedFactions, setUnrankedFactions] = useState<string[]>([]);
  const [unrankedMaps, setUnrankedMaps] = useState<string[]>([]);


  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    fetchTournaments();
  }, [isAuthenticated, navigate]);

  const fetchTournaments = async () => {
    try {
      setLoading(true);
      const res = await tournamentService.getMyTournaments();
      setTournaments(res.data || []);
      setError('');

    } catch {
      setError('Error loading tournaments');
      setTournaments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTournament = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.description || !formData.tournament_type) {
      setError(t('error_name_description_required'));
      return;
    }

    try {
      const payload: TournamentCreatePayload = {
        ...formData,
      };
      
      // Add assets for all tournament modes (ranked, unranked, team)
      // Assets are always included if selected
      if (unrankedFactions.length > 0 || unrankedMaps.length > 0) {
        payload.unranked_factions = unrankedFactions;
        payload.unranked_maps = unrankedMaps;
      }
      
      await tournamentService.createTournament(payload);
      setError('');
      setFormData({ 
        name: '', 
        description: '', 
        tournament_type: 'elimination',
        tournament_mode: 'ranked',
        max_participants: null,
        round_duration_days: 7,
        auto_advance_round: false,
        scheduled_start_at: null,
        general_rounds: 0,
        final_rounds: 0,
        general_rounds_format: 'bo3',
        final_rounds_format: 'bo5',
        rules_template_id: null,
        rules_content: '',
        organizer_ids: [],
      });
      setUnrankedFactions([]);
      setUnrankedMaps([]);
      setShowCreateForm(false);
      await fetchTournaments();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create tournament');
    }
  };

  if (loading) {
    return <MainLayout><div className="w-full px-4 py-8 bg-gradient-to-b from-gray-50 to-gray-100 min-h-screen"><p>{t('loading')}</p></div></MainLayout>;
  }

  return (
    <MainLayout>
      <div className="w-full px-4 py-8 bg-gradient-to-b from-gray-50 to-gray-100 min-h-screen">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-center text-4xl font-bold text-gray-800">{t('my_tournaments_title')}</h1>
          <button 
            data-help-id="action-open-create-tournament"
            className="px-8 py-4 text-lg font-bold text-white bg-gradient-to-r from-green-500 to-green-700 border-none rounded-lg cursor-pointer transition-all duration-300 shadow-lg hover:shadow-xl hover:from-green-600 hover:to-green-800 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md disabled:opacity-60 disabled:cursor-not-allowed uppercase tracking-wider whitespace-nowrap"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? t('btn_cancel') : t('tournament_create')}
          </button>
        </div>

        {error && <p className="bg-red-100 text-red-800 px-4 py-3 rounded-md mb-6 border-l-4 border-red-600">{error}</p>}

        {showCreateForm && (
          <TournamentForm 
            mode="create"
            formData={formData}
            onFormDataChange={setFormData}
            onSubmit={handleCreateTournament}
            unrankedFactions={unrankedFactions}
            onUnrankedFactionsChange={setUnrankedFactions}
            unrankedMaps={unrankedMaps}
            onUnrankedMapsChange={setUnrankedMaps}
          />
        )}

        <TournamentList
          title=""
          tournaments={tournaments}
          loading={false}
          error=""
          currentPage={1}
          totalPages={1}
          total={tournaments.length}
          showFilters={false}
          onPageChange={() => {}}
        />
      </div>
    </MainLayout>
  );
};

export default MyTournaments;

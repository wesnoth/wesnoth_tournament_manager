import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { statisticsService } from '../services/statisticsService';

interface BalanceEventImpactProps {
  eventId?: string;
  onEventChange?: (eventId: string | null) => void;
  onComparisonDataChange?: (before: AggregatedData[], after: AggregatedData[]) => void;
  onIntervalChange?: (before: string, after: string) => void;
}

interface BalanceEvent {
  id: string;
  event_date: string;
  snapshot_before_date?: string | null;
  snapshot_after_date?: string | null;
  previous_event_date?: string | null;
  next_event_date?: string | null;
  patch_version?: string;
  event_type: string;
  description: string;
  faction_name?: string;
  map_name?: string;
  created_by_name?: string;
}

const formatDate = (value?: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
};

const addDays = (value: string): string => {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

interface AggregatedData {
  map_id?: string;
  map_name: string;
  faction_id?: string;
  faction_name: string;
  opponent_faction_id?: string;
  opponent_faction_name: string;
  winrate: number;
  total_games: number;
  wins: number;
  losses: number;
  side1_games?: number;
  side1_wins?: number;
  side2_games?: number;
  side2_wins?: number;
}

const BalanceEventImpactPanel: React.FC<BalanceEventImpactProps> = ({ eventId, onEventChange, onComparisonDataChange, onIntervalChange }) => {
  const { t } = useTranslation();
  const [events, setEvents] = useState<BalanceEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<BalanceEvent | null>(null);
  const [beforeData, setBeforeData] = useState<AggregatedData[]>([]);
  const [afterData, setAfterData] = useState<AggregatedData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load balance events
  useEffect(() => {
    const loadEvents = async () => {
      try {
        const data = await statisticsService.getBalanceEvents({ limit: 100 });
        setEvents(data.sort((a: BalanceEvent, b: BalanceEvent) => 
          new Date(b.event_date).getTime() - new Date(a.event_date).getTime()
        ));
      } catch (err) {
        console.error('Error loading balance events:', err);
      }
    };
    loadEvents();
  }, []);

  // Load impact data when event changes
  useEffect(() => {
    if (selectedEvent?.id) {
      loadEventImpact(selectedEvent.id);
      onEventChange?.(selectedEvent.id);
    } else {
      onEventChange?.(null);
      onIntervalChange?.('', '');
    }
  }, [selectedEvent]);

  const loadEventImpact = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await statisticsService.getEventImpact(id);

      const beforeAgg: AggregatedData[] = data.map((item: any) => {
        const gamesBefore   = typeof item.games_before   === 'string' ? parseInt(item.games_before)   : (item.games_before   || 0);
        const winsBefore    = typeof item.wins_before    === 'string' ? parseInt(item.wins_before)    : (item.wins_before    || 0);
        const lossesBefore  = typeof item.losses_before  === 'string' ? parseInt(item.losses_before)  : (item.losses_before  || 0);
        const winrateBefore = typeof item.winrate_before === 'string' ? parseFloat(item.winrate_before) : (item.winrate_before || 0);
        return {
          map_id: item.map_id,
          map_name: item.map_name,
          faction_id: item.faction_id,
          faction_name: item.faction_name,
          opponent_faction_id: item.opponent_faction_id,
          opponent_faction_name: item.opponent_faction_name,
          winrate: winrateBefore,
          total_games: gamesBefore,
          wins: winsBefore,
          losses: lossesBefore,
          side1_games: item.side1_games_before || 0,
          side1_wins:  item.side1_wins_before  || 0,
          side2_games: item.side2_games_before || 0,
          side2_wins:  item.side2_wins_before  || 0,
        };
      }).filter((d: AggregatedData) => d.total_games > 0);

      const afterAgg: AggregatedData[] = data.map((item: any) => {
        const gamesAfter   = typeof item.games_after   === 'string' ? parseInt(item.games_after)   : (item.games_after   || 0);
        const winsAfter    = typeof item.wins_after    === 'string' ? parseInt(item.wins_after)    : (item.wins_after    || 0);
        const lossesAfter  = typeof item.losses_after  === 'string' ? parseInt(item.losses_after)  : (item.losses_after  || 0);
        const winrateAfter = typeof item.winrate_after === 'string' ? parseFloat(item.winrate_after) : (item.winrate_after || 0);
        return {
          map_id: item.map_id,
          map_name: item.map_name,
          faction_id: item.faction_id,
          faction_name: item.faction_name,
          opponent_faction_id: item.opponent_faction_id,
          opponent_faction_name: item.opponent_faction_name,
          winrate: winrateAfter,
          total_games: gamesAfter,
          wins: winsAfter,
          losses: lossesAfter,
          side1_games: item.side1_games_after || 0,
          side1_wins:  item.side1_wins_after  || 0,
          side2_games: item.side2_games_after || 0,
          side2_wins:  item.side2_wins_after  || 0,
        };
      }).filter((d: AggregatedData) => d.total_games > 0);

      setBeforeData(beforeAgg);
      setAfterData(afterAgg);

      onIntervalChange?.(
        selectedEvent.previous_event_date
          ? `${formatDate(addDays(selectedEvent.previous_event_date))} – ${formatDate(selectedEvent.event_date)}`
          : '—',
        `${formatDate(addDays(selectedEvent.event_date))} – ${formatDate(selectedEvent.next_event_date || selectedEvent.snapshot_after_date)}`
      );

      // Notify parent component
      onComparisonDataChange?.(beforeAgg, afterAgg);
    } catch (err: any) {
      console.error(`[BalanceEventImpactPanel] Error loading impact:`, err);
      setError(err.response?.data?.error || t('error_loading_impact') || 'Error loading impact data');
      setBeforeData([]);
      setAfterData([]);
      onIntervalChange?.('', '');
    } finally {
      setLoading(false);
    }
  };

  const handleEventSelect = (event: BalanceEvent | null) => {
    setSelectedEvent(event);
  };

  const eventTypeColor: { [key: string]: string } = {
    BUFF: '#27ae60',
    NERF: '#e74c3c',
    REWORK: '#9b59b6',
    HOTFIX: '#f39c12',
    GENERAL_BALANCE_CHANGE: '#3498db',
  };

  return (
    <div className="w-full bg-white rounded-lg border border-gray-200 p-6 mb-8">
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-gray-800 mb-3">{t('select_balance_event') || 'Select Balance Event'}</h3>
        
        <select 
          value={selectedEvent?.id || ''} 
          onChange={(e) => {
            if (e.target.value === '') {
              handleEventSelect(null);
            } else {
              const event = events.find(ev => ev.id === e.target.value);
              if (event) handleEventSelect(event);
            }
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{t('all_accumulated') || 'All (Accumulated)'}</option>
          {events.map(event => (
            <option key={event.id} value={event.id}>
              {formatDate(event.event_date)} - {event.event_type}
              {event.patch_version ? ` [${event.patch_version}]` : ''}
              {event.description ? ` - ${event.description.substring(0, 30)}${event.description.length > 30 ? '...' : ''}` : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedEvent && (
        <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
            <h4 className="text-lg font-semibold text-gray-800">{t('event_details') || 'Event Details'}</h4>
            <span 
              className="px-3 py-1 rounded-full text-white text-sm font-semibold"
              style={{ background: eventTypeColor[selectedEvent.event_type] || '#3498db' }}
            >
              {selectedEvent.event_type}
            </span>
          </div>
          
          <p className="text-gray-700 mb-4 whitespace-pre-wrap">{selectedEvent.description}</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedEvent.faction_name && (
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-600">{t('faction') || 'Faction'}:</span>
                <span className="text-gray-800">{selectedEvent.faction_name}</span>
              </div>
            )}
            {selectedEvent.map_name && (
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-600">{t('map') || 'Map'}:</span>
                <span className="text-gray-800">{selectedEvent.map_name}</span>
              </div>
            )}
            {selectedEvent.patch_version && (
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-600">{t('patch_version') || 'Patch'}:</span>
                <span className="text-gray-800">{selectedEvent.patch_version}</span>
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-gray-600">{t('date') || 'Date'}:</span>
              <span className="text-gray-800">{formatDate(selectedEvent.event_date)}</span>
            </div>
          </div>

          <div className="mt-4 rounded-md bg-blue-50 border-l-4 border-blue-500 px-4 py-3 text-sm text-blue-800">
            <div>
              {t('before_event') || 'Before'}:{' '}
              {selectedEvent.previous_event_date
                ? `${formatDate(addDays(selectedEvent.previous_event_date))} – ${formatDate(selectedEvent.event_date)}`
                : '—'}
            </div>
            <div>
              {t('after_event') || 'After'}:{' '}
              {`${formatDate(addDays(selectedEvent.event_date))} – ${formatDate(selectedEvent.next_event_date || selectedEvent.snapshot_after_date)}`}
            </div>
          </div>

          {loading && <div className="mt-4 text-center text-gray-500">{t('loading') || 'Loading...'}</div>}
          {error && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}
        </div>
      )}
    </div>
  );
};

export default BalanceEventImpactPanel;

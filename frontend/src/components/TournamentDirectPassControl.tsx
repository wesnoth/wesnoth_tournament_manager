import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { tournamentService } from '../services/api';
import type { DirectPassPlacement, TournamentFormatDefinition } from '../types/tournament';

export interface DirectPassGroupOption { id: string; name: string; direct_advancement_slots?: number; direct_assigned_count?: number; format?: string; }

/**
 * Organizer control that reserves a direct pass for one accepted entry into a
 * later-phase group. For single-elimination targets the organizer picks the
 * round and the backend chooses an available series and slot; the response
 * reports the placement and any qualifier mappings it had to adjust.
 */
export const TournamentDirectPassControl: React.FC<{
  tournamentId: string; entityType: 'participant' | 'team'; entityId: string;
  groups: DirectPassGroupOption[]; current?: DirectPassPlacement; disabled: boolean; onSaved: () => void;
}> = ({ tournamentId, entityType, entityId, groups, current, disabled, onSaved }) => {
  const { t } = useTranslation();
  const [groupId, setGroupId] = useState(current?.direct_group_id || '');
  const [round, setRound] = useState(current?.direct_round_number || '');
  const [note, setNote] = useState(current?.direct_pass_note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedPlacement, setSavedPlacement] = useState('');
  useEffect(() => {
    setGroupId(current?.direct_group_id || ''); setRound(current?.direct_round_number || '');
    setNote(current?.direct_pass_note || '');
  }, [current?.direct_group_id, current?.direct_round_number, current?.direct_pass_note]);
  const selected = groups.find(group => group.id === groupId);
  const availableGroups = groups.filter(group => group.id === current?.direct_group_id
    || Number(group.direct_assigned_count || 0) < Number(group.direct_advancement_slots || 0));
  if (!groups.length || disabled) return null;
  return <div className="flex flex-wrap items-end gap-2">
    <label className="text-xs">{t('competition.direct_pass')}
      <select data-help-id="option-participant-direct-pass-group" value={groupId} onChange={event => { setError(''); setSavedPlacement(''); setGroupId(event.target.value); }} className="ml-1 border rounded px-2 py-1">
        <option value="">{t('direct_pass.none')}</option>{availableGroups.map(group => <option key={group.id} value={group.id}>{group.name} ({t('direct_pass.assigned', { count: group.direct_assigned_count || 0, total: group.direct_advancement_slots })})</option>)}
      </select>
    </label>
    {selected?.format === 'single_elimination' && groupId && <>
      <label className="text-xs">{t('direct_pass.round')}<input data-help-id="field-participant-direct-pass-round" type="number" min={1} value={round} onChange={event => { setError(''); setSavedPlacement(''); setRound(event.target.value); }} className="ml-1 w-16 border rounded px-2 py-1" /></label>
      <span className="text-xs text-gray-600">{t('direct_pass.round_help')}</span>
    </>}
    {groupId && <label className="text-xs">{t('direct_pass.reason')}<input data-help-id="field-participant-direct-pass-note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} className="ml-1 border rounded px-2 py-1" /></label>}
    {(groupId || current?.direct_group_id) && <button data-help-id="action-save-participant-direct-pass" type="button" disabled={saving || Boolean(groupId && selected?.format === 'single_elimination' && !round)} className="px-2 py-1 bg-indigo-600 text-white rounded text-xs disabled:opacity-50" onClick={async () => {
      setSaving(true);
      try { setError(''); setSavedPlacement(''); const response = await tournamentService.saveDirectPass(tournamentId, entityType, entityId, {
        group_id: groupId || null, round_number: selected?.format === 'single_elimination' && groupId ? Number(round) : null,
        note: groupId ? note : null,
      });
        const placement = response.data?.round_number
          ? t('direct_pass.saved_at', { round: response.data.round_number, series: response.data.series_position, slot: response.data.slot_number })
          : groupId ? t('direct_pass.saved') : t('direct_pass.removed');
        setSavedPlacement(response.data?.adjusted_mappings
          ? `${placement} ${t('direct_pass.adjusted_mappings', { count: response.data.adjusted_mappings })}`
          : placement);
        onSaved();
      } catch (saveError: any) {
        setError(saveError.response?.data?.error || t('direct_pass.error_save'));
      } finally { setSaving(false); }
    }}>{saving ? t('teams.saving') : groupId ? t('direct_pass.save') : t('direct_pass.remove')}</button>}
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    {savedPlacement && <span role="status" className="text-xs text-green-700">{savedPlacement}</span>}
  </div>;
};

/**
 * Groups that can receive direct passes: every group after the first phase
 * with a positive direct-advancement capacity. The first phase is excluded
 * because its entries are seeded from registration, not passed into it.
 */
export function buildDirectPassGroups(format: TournamentFormatDefinition | null): DirectPassGroupOption[] {
  return (format?.phases || []).slice(1).flatMap(phase =>
    phase.groups.filter(group => Number(group.direct_advancement_slots || 0) > 0).map(group => ({
      id: group.id, name: `${phase.name} / ${group.name}`, direct_advancement_slots: group.direct_advancement_slots,
      direct_assigned_count: group.direct_assigned_count, format: phase.format,
    })));
}

/** Read-only description of an entry's direct pass, or `null` when it has none. */
export function describeDirectPass(t: TFunction, entry: DirectPassPlacement | null | undefined, groups: DirectPassGroupOption[]): string | null {
  if (!entry?.direct_group_id) return null;
  const destination = groups.find(group => group.id === entry.direct_group_id);
  const placement = entry.direct_round_number
    ? ` · ${t('competition.round', { round: entry.direct_round_number })}${entry.direct_series_position ? `, ${t('direct_pass.match', { number: entry.direct_series_position })}` : ''}${entry.direct_slot_number ? `, ${t('direct_pass.slot', { number: entry.direct_slot_number })}` : ''}`
    : '';
  return `${destination?.name || t('direct_pass.later_phase')}${placement}`;
}

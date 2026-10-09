import React, { useEffect, useState } from 'react';
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
    <label className="text-xs">Direct pass
      <select data-help-id="option-participant-direct-pass-group" value={groupId} onChange={event => { setError(''); setSavedPlacement(''); setGroupId(event.target.value); }} className="ml-1 border rounded px-2 py-1">
        <option value="">None</option>{availableGroups.map(group => <option key={group.id} value={group.id}>{group.name} ({group.direct_assigned_count || 0}/{group.direct_advancement_slots} assigned)</option>)}
      </select>
    </label>
    {selected?.format === 'single_elimination' && groupId && <>
      <label className="text-xs">Round<input data-help-id="field-participant-direct-pass-round" type="number" min={1} value={round} onChange={event => { setError(''); setSavedPlacement(''); setRound(event.target.value); }} className="ml-1 w-16 border rounded px-2 py-1" /></label>
      <span className="text-xs text-gray-600">The system chooses an available series and slot. In later rounds, the series position identifies the bracket branch.</span>
    </>}
    {groupId && <label className="text-xs">Reason<input data-help-id="field-participant-direct-pass-note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} className="ml-1 border rounded px-2 py-1" /></label>}
    {(groupId || current?.direct_group_id) && <button data-help-id="action-save-participant-direct-pass" type="button" disabled={saving || Boolean(groupId && selected?.format === 'single_elimination' && !round)} className="px-2 py-1 bg-indigo-600 text-white rounded text-xs disabled:opacity-50" onClick={async () => {
      setSaving(true);
      try { setError(''); setSavedPlacement(''); const response = await tournamentService.saveDirectPass(tournamentId, entityType, entityId, {
        group_id: groupId || null, round_number: selected?.format === 'single_elimination' && groupId ? Number(round) : null,
        note: groupId ? note : null,
      });
        const placement = response.data?.round_number
          ? `Saved for round ${response.data.round_number}, branch/series ${response.data.series_position}, slot ${response.data.slot_number}.`
          : groupId ? 'Direct pass saved.' : 'Direct pass removed.';
        setSavedPlacement(response.data?.adjusted_mappings
          ? `${placement} ${response.data.adjusted_mappings} qualifier mapping(s) adjusted so the round-one pass has an opponent.`
          : placement);
        onSaved();
      } catch (saveError: any) {
        setError(saveError.response?.data?.error || 'Could not save this direct pass.');
      } finally { setSaving(false); }
    }}>{saving ? 'Saving…' : groupId ? 'Save pass' : 'Remove pass'}</button>}
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
export function describeDirectPass(entry: DirectPassPlacement | null | undefined, groups: DirectPassGroupOption[]): string | null {
  if (!entry?.direct_group_id) return null;
  const destination = groups.find(group => group.id === entry.direct_group_id);
  const placement = entry.direct_round_number
    ? ` · Round ${entry.direct_round_number}${entry.direct_series_position ? `, match ${entry.direct_series_position}` : ''}${entry.direct_slot_number ? `, slot ${entry.direct_slot_number}` : ''}`
    : '';
  return `${destination?.name || 'Later phase'}${placement}`;
}

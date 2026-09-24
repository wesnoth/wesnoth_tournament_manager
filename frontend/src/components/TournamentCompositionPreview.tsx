import React from 'react';
import type { TournamentFormatDefinition } from '../types/tournament';

interface CompositionEntry {
  id: string;
  direct_group_id?: string | null;
  direct_round_number?: number | null;
}

interface Props {
  format: TournamentFormatDefinition;
  entries: CompositionEntry[];
}

function recommendedBracketSize(entries: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, entries)));
}

function distributeEntries(count: number, groupCount: number): number[] {
  const sizes = Array.from({ length: groupCount }, () => 0);
  for (let index = 0; index < count; index += 1) sizes[index % groupCount] += 1;
  return sizes;
}

/** Show the roster impact of the saved phase graph before it is prepared. */
const TournamentCompositionPreview: React.FC<Props> = ({ format, entries }) => {
  const [firstPhase, ...laterPhases] = format.phases;
  if (!firstPhase || entries.length === 0) return null;

  const directEntryIds = new Set(entries.filter(entry => entry.direct_group_id).map(entry => entry.id));
  const firstPhaseEntries = entries.filter(entry => !directEntryIds.has(entry.id));
  const firstGroupSizes = firstPhase.assignment_method === 'manual'
    ? firstPhase.groups.map(group => (group.entry_ids || []).filter(entryId =>
      firstPhaseEntries.some(entry => entry.id === entryId)
    ).length)
    : distributeEntries(firstPhaseEntries.length, firstPhase.groups.length);
  const overqualifiedGroups = firstPhase.groups.filter((group, index) =>
    Number(group.advance_count || 0) > firstGroupSizes[index]);

  const smallGroups = firstGroupSizes.filter(size => size < 3).length;
  const suggestedGroupCount = Math.min(firstPhase.groups.length - 1, Math.floor(firstPhaseEntries.length / 3));
  const suggestionSizes = suggestedGroupCount > 0
    ? distributeEntries(firstPhaseEntries.length, suggestedGroupCount)
    : [];

  const advanceCounts = new Map<string, number>();
  for (const rule of format.advancement_rules) {
    advanceCounts.set(rule.target_group_id, (advanceCounts.get(rule.target_group_id) || 0) + 1);
  }

  return (
    <section data-help-id="region-tournament-phase-composition" className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
      <h3 className="font-semibold text-gray-800">Participant and bracket preview</h3>
      <p className="text-sm text-gray-700">
        {entries.length} eligible {entries.length === 1 ? 'entry' : 'entries'}; {directEntryIds.size} assigned direct {directEntryIds.size === 1 ? 'pass' : 'passes'} are reserved for later phases, leaving {firstPhaseEntries.length} for {firstPhase.name}.
      </p>
      <div className="text-sm text-gray-700">
        <strong>{firstPhase.name} group sizes:</strong>{' '}
        {firstPhase.groups.map((group, index) => `${group.name}: ${firstGroupSizes[index]}`).join(' · ')}
      </div>
      {smallGroups > 0 && suggestedGroupCount > 0 && (
        <div role="status" className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          {smallGroups} {smallGroups === 1 ? 'group has' : 'groups have'} fewer than 3 entries. Consider reducing to {suggestedGroupCount} {suggestedGroupCount === 1 ? 'group' : 'groups'} ({suggestionSizes.join(' and ')} entries each), or fewer.
        </div>
      )}
      {overqualifiedGroups.length > 0 && <div role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">
        Qualification exceeds the assigned roster in {overqualifiedGroups.map(group => group.name).join(', ')}. Reduce the advancing count or add participants before preparing.
      </div>}
      {laterPhases.map(phase => (
        <div key={phase.id} className="space-y-1 text-sm text-gray-700">
          <strong>{phase.name}:</strong>
          {phase.groups.map(group => {
            const qualifiers = advanceCounts.get(group.id) || 0;
            const reserved = Number(group.direct_advancement_slots || 0);
            const assigned = Number(group.direct_assigned_count || 0);
            const total = qualifiers + reserved;
            if (phase.format !== 'single_elimination') {
              return <div key={group.id}>{group.name}: {qualifiers} mapped qualifier(s) + {assigned}/{reserved} assigned/reserved direct pass(es) = {total} projected entries.</div>;
            }
            const bracketSize = phase.elimination?.bracket_size || recommendedBracketSize(total);
            const assignedPlacements = entries.filter(entry => entry.direct_group_id === group.id);
            // A later-round slot replaces its feeder subtree, so those seed leaves cannot also hold mapped qualifiers.
            const bypassedSeedPositions = assignedPlacements.reduce((count, entry) =>
              count + (entry.direct_round_number ? 2 ** (Number(entry.direct_round_number) - 1) : 0), 0);
            const mappedCapacity = Math.max(0, bracketSize - bypassedSeedPositions);
            const roundSummary = assignedPlacements.some(entry => entry.direct_round_number)
              ? `; ${bypassedSeedPositions} feeder seed position(s) bypassed by round-specific passes, capacity for ${mappedCapacity} mapped qualifier(s)`
              : '';
            return <div key={group.id}>
              {group.name}: {qualifiers} mapped qualifier(s) + {assigned}/{reserved} assigned/reserved direct pass(es) = {total} projected entries; {phase.elimination?.bracket_size ? 'configured' : 'recommended'} bracket of {bracketSize}, {Math.max(0, bracketSize - total)} bye(s){roundSummary}.
              {bypassedSeedPositions > 0 && qualifiers > mappedCapacity && <span role="alert" className="ml-1 text-red-700">Too many mapped qualifiers for the assigned round-specific passes.</span>}
            </div>;
          })}
        </div>
      ))}
    </section>
  );
};

export default TournamentCompositionPreview;

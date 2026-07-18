import React, { useEffect, useMemo, useState } from 'react';
import type {
  BestOf,
  PhaseFormat,
  TournamentFormatDefinition,
  TournamentPhaseDefinition,
} from '../types/tournament';

interface Props {
  value?: TournamentFormatDefinition;
  onChange: (value: TournamentFormatDefinition) => void;
  disabled?: boolean;
  initialTemplate?: 'swiss' | 'league' | 'elimination';
  entryOptions?: Array<{ id: string; name: string }>;
}

const id = () => crypto.randomUUID();

function phase(name: string, order: number, format: PhaseFormat, groupCount = 1): TournamentPhaseDefinition {
  return {
    id: id(),
    name,
    order,
    format,
    assignment_method: 'seeded_snake',
    default_best_of: 3,
    groups: Array.from({ length: groupCount }, (_, index) => ({ id: id(), name: groupCount === 1 ? name : `Group ${index + 1}`, order: index + 1 })),
    swiss: format === 'swiss' ? { round_count: 3, avoid_rematches: true } : undefined,
    round_robin: format === 'round_robin' ? { cycle_count: 1, open_rounds_together: true } : undefined,
    elimination: format === 'single_elimination' ? { bracket_size: null, seeding_policy: 'seeded', reseed_each_round: false } : undefined,
  };
}

function template(code: string): TournamentFormatDefinition {
  if (code === 'swiss_brackets_final') {
    const swiss = phase('Swiss groups', 1, 'swiss', 4);
    const brackets = phase('Elimination brackets', 2, 'single_elimination', 2);
    const final = phase('Grand final', 3, 'single_elimination', 1);
    const rules = swiss.groups.flatMap((source, sourceIndex) => [1, 2].map((rank) => ({
      id: id(),
      source_group_id: source.id,
      source_rank: rank,
      target_group_id: brackets.groups[sourceIndex % 2].id,
      target_seed: Math.floor(sourceIndex / 2) * 2 + rank,
    })));
    brackets.groups.forEach((source, index) => rules.push({
      id: id(), source_group_id: source.id, source_rank: 1,
      target_group_id: final.groups[0].id, target_seed: index + 1,
    }));
    return { phases: [swiss, brackets, final], advancement_rules: rules };
  }
  if (code === 'league') return { phases: [phase('League', 1, 'round_robin')], advancement_rules: [] };
  if (code === 'elimination') return { phases: [phase('Elimination bracket', 1, 'single_elimination')], advancement_rules: [] };
  return { phases: [phase('Swiss', 1, 'swiss')], advancement_rules: [] };
}

const TournamentPhaseBuilder: React.FC<Props> = ({ value, onChange, disabled, initialTemplate = 'swiss', entryOptions = [] }) => {
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (!value) onChange(template(initialTemplate));
  }, [value, onChange, initialTemplate]);
  const definition = value || { phases: [], advancement_rules: [] };
  const groupIds = useMemo(() => new Set(definition.phases.flatMap(item => item.groups.map(group => group.id))), [definition]);
  const groupOptions = useMemo(() => definition.phases.flatMap(item => item.groups.map(group => ({
    id: group.id, label: `${item.name} / ${group.name}`, phaseOrder: item.order,
  }))), [definition]);
  const validMappings = definition.advancement_rules.every(rule => groupIds.has(rule.source_group_id) && groupIds.has(rule.target_group_id));

  const replacePhase = (index: number, next: TournamentPhaseDefinition) => {
    const phases = definition.phases.map((item, itemIndex) => itemIndex === index ? next : item);
    onChange({ ...definition, phases });
  };

  const changeGroupCount = (index: number, count: number) => {
    const current = definition.phases[index];
    const groups = Array.from({ length: count }, (_, groupIndex) => current.groups[groupIndex] || ({
      id: id(), name: count === 1 ? current.name : `Group ${groupIndex + 1}`, order: groupIndex + 1,
    }));
    replacePhase(index, { ...current, groups });
  };

  return (
    <section data-help-id="region-tournament-phase-builder" className="p-4 border border-blue-200 rounded-lg bg-blue-50 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-64 text-sm font-medium text-gray-700">
          Format template
          <select data-help-id="option-tournament-format-template" disabled={disabled} className="mt-1 w-full px-3 py-2 border rounded-md bg-white" onChange={(event) => onChange(template(event.target.value))} defaultValue={initialTemplate}>
            <option value="swiss">Swiss</option>
            <option value="league">Round robin league</option>
            <option value="elimination">Single elimination</option>
            <option value="swiss_brackets_final">4 Swiss groups → 2 brackets → grand final</option>
          </select>
        </label>
        <button data-help-id="action-toggle-advanced-phase-builder" type="button" disabled={disabled} onClick={() => setAdvanced(current => !current)} className="px-4 py-2 border border-blue-500 text-blue-700 rounded-md">
          {advanced ? 'Hide advanced editor' : 'Advanced editor'}
        </button>
      </div>

      <div className="space-y-3">
        {definition.phases.map((item, index) => (
          <div key={item.id} className="p-3 bg-white border rounded-md grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="text-sm">Phase name
              <input data-help-id="field-tournament-phase-name" disabled={disabled} value={item.name} onChange={(event) => replacePhase(index, { ...item, name: event.target.value })} className="mt-1 w-full px-2 py-1 border rounded" />
            </label>
            <label className="text-sm">System
              <select data-help-id="option-tournament-phase-format" disabled={disabled} value={item.format} onChange={(event) => {
                const format = event.target.value as PhaseFormat;
                replacePhase(index, {
                  ...item, format,
                  swiss: format === 'swiss' ? { round_count: 3, avoid_rematches: true } : undefined,
                  round_robin: format === 'round_robin' ? { cycle_count: 1, open_rounds_together: true } : undefined,
                  elimination: format === 'single_elimination' ? { bracket_size: null, seeding_policy: 'seeded', reseed_each_round: false } : undefined,
                });
              }} className="mt-1 w-full px-2 py-1 border rounded">
                <option value="swiss">Swiss</option><option value="round_robin">Round robin</option><option value="single_elimination">Elimination</option>
              </select>
            </label>
            <label className="text-sm">Groups / brackets
              <input data-help-id="field-tournament-phase-group-count" disabled={disabled} type="number" min={1} max={32} value={item.groups.length} onChange={(event) => changeGroupCount(index, Math.max(1, Number(event.target.value)))} className="mt-1 w-full px-2 py-1 border rounded" />
            </label>
            <label className="text-sm">Best of
              <select data-help-id="option-tournament-phase-best-of" disabled={disabled} value={item.default_best_of} onChange={(event) => replacePhase(index, { ...item, default_best_of: Number(event.target.value) as BestOf })} className="mt-1 w-full px-2 py-1 border rounded">
                <option value={1}>Bo1</option><option value={3}>Bo3</option><option value={5}>Bo5</option>
              </select>
            </label>
            {item.format === 'swiss' && <label className="text-sm">Rounds
              <input data-help-id="field-tournament-swiss-rounds" disabled={disabled} type="number" min={1} max={20} value={item.swiss?.round_count || 1} onChange={(event) => replacePhase(index, { ...item, swiss: { ...item.swiss, round_count: Number(event.target.value) } })} className="mt-1 w-full px-2 py-1 border rounded" />
            </label>}
            {item.format === 'round_robin' && <label className="text-sm">Cycles
              <select data-help-id="option-tournament-league-cycles" disabled={disabled} value={item.round_robin?.cycle_count || 1} onChange={(event) => replacePhase(index, { ...item, round_robin: { ...item.round_robin, cycle_count: Number(event.target.value) as 1 | 2 } })} className="mt-1 w-full px-2 py-1 border rounded"><option value={1}>One</option><option value={2}>Two</option></select>
            </label>}
            {advanced && <label className="text-sm">Assignment
              <select data-help-id="option-tournament-phase-assignment" disabled={disabled || index > 0} value={item.assignment_method} onChange={(event) => replacePhase(index, { ...item, assignment_method: event.target.value as TournamentPhaseDefinition['assignment_method'] })} className="mt-1 w-full px-2 py-1 border rounded">
                <option value="seeded_snake">Preclassification snake</option><option value="random">Random</option><option value="manual">Manual</option>
              </select>
            </label>}
            {advanced && definition.phases.length > 1 && <button
              data-help-id="action-remove-tournament-phase"
              type="button"
              disabled={disabled}
              onClick={() => {
                const removedGroups = new Set(item.groups.map(group => group.id));
                const phases = definition.phases.filter(phaseItem => phaseItem.id !== item.id).map((phaseItem, phaseIndex) => ({ ...phaseItem, order: phaseIndex + 1 }));
                onChange({ phases, advancement_rules: definition.advancement_rules.filter(rule => !removedGroups.has(rule.source_group_id) && !removedGroups.has(rule.target_group_id)) });
              }}
              className="text-sm text-red-700"
            >Remove phase</button>}
            {advanced && index === 0 && item.assignment_method === 'manual' && <div className="md:col-span-5 border-t pt-2 space-y-2">
              <p className="text-sm text-gray-600">Assign every accepted entry to one group. The order within each group is its preclassification.</p>
              {entryOptions.length === 0 ? <p className="text-sm text-amber-700">Manual membership becomes available when accepted participants or complete teams exist.</p> : entryOptions.map(entry => {
                const assignedGroup = item.groups.find(group => (group.entry_ids || []).includes(entry.id));
                return <label key={entry.id} className="grid grid-cols-2 gap-2 text-sm items-center"><span>{entry.name}</span><select data-help-id="option-manual-tournament-group" disabled={disabled} value={assignedGroup?.id || ''} onChange={(event) => {
                  const groups = item.groups.map(group => ({ ...group, entry_ids: (group.entry_ids || []).filter(entryId => entryId !== entry.id) }));
                  const target = groups.find(group => group.id === event.target.value);
                  if (target) target.entry_ids = [...(target.entry_ids || []), entry.id];
                  replacePhase(index, { ...item, groups });
                }} className="border rounded p-1"><option value="">Unassigned</option>{item.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>;
              })}
            </div>}
          </div>
        ))}
      </div>
      {advanced && <div className="space-y-3">
        <button data-help-id="action-add-tournament-phase" type="button" disabled={disabled} onClick={() => onChange({ ...definition, phases: [...definition.phases, phase(`Phase ${definition.phases.length + 1}`, definition.phases.length + 1, 'single_elimination')] })} className="px-3 py-2 bg-blue-600 text-white rounded-md">Add phase</button>
        <div data-help-id="region-tournament-advancement-mappings" className="p-3 bg-white border rounded-md space-y-2">
          <h4 className="font-medium">Advancement mappings</h4>
          {definition.advancement_rules.map((rule, ruleIndex) => <div key={rule.id} className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <label className="text-xs">Source group<select data-help-id="option-advancement-source-group" disabled={disabled} value={rule.source_group_id} onChange={(event) => onChange({ ...definition, advancement_rules: definition.advancement_rules.map((item, index) => index === ruleIndex ? { ...item, source_group_id: event.target.value } : item) })} className="block w-full border rounded p-1">{groupOptions.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>
            <label className="text-xs">Source rank<input data-help-id="field-advancement-source-rank" disabled={disabled} type="number" min={1} value={rule.source_rank} onChange={(event) => onChange({ ...definition, advancement_rules: definition.advancement_rules.map((item, index) => index === ruleIndex ? { ...item, source_rank: Number(event.target.value) } : item) })} className="block w-full border rounded p-1" /></label>
            <label className="text-xs">Target group<select data-help-id="option-advancement-target-group" disabled={disabled} value={rule.target_group_id} onChange={(event) => onChange({ ...definition, advancement_rules: definition.advancement_rules.map((item, index) => index === ruleIndex ? { ...item, target_group_id: event.target.value } : item) })} className="block w-full border rounded p-1">{groupOptions.filter(group => group.phaseOrder > (groupOptions.find(source => source.id === rule.source_group_id)?.phaseOrder || 0)).map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>
            <label className="text-xs">Target preclassification<input data-help-id="field-advancement-target-seed" disabled={disabled} type="number" min={1} value={rule.target_seed} onChange={(event) => onChange({ ...definition, advancement_rules: definition.advancement_rules.map((item, index) => index === ruleIndex ? { ...item, target_seed: Number(event.target.value) } : item) })} className="block w-full border rounded p-1" /></label>
            <button data-help-id="action-remove-advancement-rule" type="button" disabled={disabled} onClick={() => onChange({ ...definition, advancement_rules: definition.advancement_rules.filter((_, index) => index !== ruleIndex) })} className="text-red-700 text-sm">Remove</button>
          </div>)}
          {definition.phases.length > 1 && <button data-help-id="action-add-advancement-rule" type="button" disabled={disabled || groupOptions.length < 2} onClick={() => {
            const source = groupOptions[0];
            const target = groupOptions.find(group => group.phaseOrder > source.phaseOrder);
            if (target) onChange({ ...definition, advancement_rules: [...definition.advancement_rules, { id: id(), source_group_id: source.id, source_rank: 1, target_group_id: target.id, target_seed: 1 }] });
          }} className="text-sm text-blue-700">Add mapping</button>}
        </div>
      </div>}
      <p className={`text-sm ${validMappings ? 'text-green-700' : 'text-red-700'}`}>{validMappings ? `${definition.phases.length} ordered phase(s); advancement graph is acyclic by server validation.` : 'A mapping refers to a removed group. Reapply a template or edit mappings.'}</p>
    </section>
  );
};

export default TournamentPhaseBuilder;

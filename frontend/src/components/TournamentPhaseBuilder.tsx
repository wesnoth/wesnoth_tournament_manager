import React, { useEffect, useMemo, useState } from 'react';
import type {
  BestOf,
  PhaseFormat,
  TournamentFormatDefinition,
  TournamentPhaseDefinition,
} from '../types/tournament';
import { useTranslation } from 'react-i18next';
import { tournamentService } from '../services/api';
import EditableIntegerInput from './EditableIntegerInput';
import { MAX_SWISS_ROUNDS } from '../utils/formatIssues';

interface Props {
  value?: TournamentFormatDefinition;
  onChange: (value: TournamentFormatDefinition) => void;
  disabled?: boolean;
  initialTemplate?: 'swiss' | 'league' | 'elimination';
  entryOptions?: Array<{ id: string; name: string }>;
}

const id = () => crypto.randomUUID();

/**
 * Default names written into a new format. Phase and group names are saved
 * with the tournament as editable data, so they are produced in the
 * organizer's interface language when the template is applied; nothing else
 * reads them, and switching language later does not rename saved phases.
 */
interface DefaultNames {
  swiss: string;
  league: string;
  elimination: string;
  swissGroups: string;
  eliminationBrackets: string;
  grandFinal: string;
  group: (number: number) => string;
  phase: (number: number) => string;
}

function phase(name: string, order: number, format: PhaseFormat, names: DefaultNames, groupCount = 1): TournamentPhaseDefinition {
  return {
    id: id(),
    name,
    order,
    format,
    assignment_method: 'seeded_snake',
    default_best_of: 3,
    groups: Array.from({ length: groupCount }, (_, index) => ({ id: id(), name: groupCount === 1 ? name : names.group(index + 1), order: index + 1 })),
    swiss: format === 'swiss' ? { round_count: 3, avoid_rematches: true } : undefined,
    round_robin: format === 'round_robin' ? { cycle_count: 1, open_rounds_together: true } : undefined,
    elimination: format === 'single_elimination' ? { bracket_size: null, seeding_policy: 'seeded', reseed_each_round: false } : undefined,
  };
}

function template(code: string, names: DefaultNames): TournamentFormatDefinition {
  if (code === 'swiss_brackets_final') {
    const swiss = phase(names.swissGroups, 1, 'swiss', names, 4);
    const brackets = phase(names.eliminationBrackets, 2, 'single_elimination', names, 2);
    const final = phase(names.grandFinal, 3, 'single_elimination', names, 1);
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
  if (code === 'league') return { phases: [phase(names.league, 1, 'round_robin', names)], advancement_rules: [] };
  if (code === 'elimination') return { phases: [phase(names.elimination, 1, 'single_elimination', names)], advancement_rules: [] };
  return { phases: [phase(names.swiss, 1, 'swiss', names)], advancement_rules: [] };
}

const TournamentPhaseBuilder: React.FC<Props> = ({ value, onChange, disabled, initialTemplate = 'swiss', entryOptions = [] }) => {
  const { t } = useTranslation();
  const names: DefaultNames = {
    swiss: t('phase_builder.default_swiss'),
    league: t('phase_builder.default_league'),
    elimination: t('phase_builder.default_elimination'),
    swissGroups: t('phase_builder.default_swiss_groups'),
    eliminationBrackets: t('phase_builder.default_elimination_brackets'),
    grandFinal: t('phase_builder.default_grand_final'),
    group: (number) => t('phase_builder.default_group', { number }),
    phase: (number) => t('phase_builder.default_phase', { number }),
  };
  const [advanced, setAdvanced] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(initialTemplate);
  const [showMappings, setShowMappings] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [sameSourcePairs, setSameSourcePairs] = useState<Array<{ target_group_id: string; seed_one: number; seed_two: number }>>([]);
  useEffect(() => {
    if (!value) onChange(template(initialTemplate, names));
  }, [value, onChange, initialTemplate]);
  const definition = value || { phases: [], advancement_rules: [] };
  const updateMappings = (advancement_rules: TournamentFormatDefinition['advancement_rules']) => {
    // This warning describes the last generated mapping, not a manually edited one.
    setSameSourcePairs([]);
    onChange({ ...definition, advancement_rules });
  };
  const groupIds = useMemo(() => new Set(definition.phases.flatMap(item => item.groups.map(group => group.id))), [definition]);
  const groupOptions = useMemo(() => definition.phases.flatMap(item => item.groups.map(group => ({
    id: group.id,
    // Group names can be stale when a phase changes from one group to several;
    // render labels from the current phase and group order instead.
    label: item.groups.length === 1 ? item.name : `${item.name} / ${names.group(group.order)}`,
    phaseOrder: item.order,
    groupOrder: group.order,
  }))), [definition, t]);
  const validMappings = definition.advancement_rules.every(rule => groupIds.has(rule.source_group_id) && groupIds.has(rule.target_group_id));
  const rulesInEntryOrder = definition.advancement_rules;
  const duplicateTargetRuleIds = useMemo(() => {
    const targetCounts = new Map<string, number>();
    definition.advancement_rules.forEach(rule => {
      const key = `${rule.target_group_id}:${rule.target_seed}`;
      targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
    });
    return new Set(definition.advancement_rules.filter(rule =>
      (targetCounts.get(`${rule.target_group_id}:${rule.target_seed}`) || 0) > 1
    ).map(rule => rule.id));
  }, [definition.advancement_rules]);
  const duplicateSourceRuleIds = useMemo(() => {
    const sourceCounts = new Map<string, number>();
    definition.advancement_rules.forEach(rule => {
      const key = `${rule.source_group_id}:${rule.source_rank}`;
      sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
    });
    return new Set(definition.advancement_rules.filter(rule =>
      (sourceCounts.get(`${rule.source_group_id}:${rule.source_rank}`) || 0) > 1
    ).map(rule => rule.id));
  }, [definition.advancement_rules]);
  const directPassSummaries = definition.phases.slice(1).map(target => {
    const source = definition.phases.find(item => item.order === target.order - 1);
    const hasMappings = Boolean(source && definition.advancement_rules.some(rule =>
      source.groups.some(group => group.id === rule.source_group_id)
      && target.groups.some(group => group.id === rule.target_group_id)
    ));
    return {
      target,
      hasMappings,
      sourceQualifierTotal: source?.groups.reduce((total, group) => total + Number(group.advance_count || 0), 0) || 0,
      groups: target.groups.map(group => {
        const qualifiers = definition.advancement_rules.filter(rule => rule.target_group_id === group.id).length;
        const directPasses = Number(group.direct_advancement_slots || 0);
        const projected = qualifiers + directPasses;
        const configured = target.elimination?.bracket_size || null;
        const recommended = 2 ** Math.ceil(Math.log2(Math.max(2, projected)));
        const bracketSize = configured || recommended;
        return { group, qualifiers, directPasses, projected, bracketSize, byes: Math.max(0, bracketSize - projected), configured };
      }),
    };
  });

  const replacePhase = (index: number, next: TournamentPhaseDefinition) => {
    setSameSourcePairs([]);
    const phases = definition.phases.map((item, itemIndex) => itemIndex === index
      ? {
        ...next,
        groups: next.groups.map((group, groupIndex) => ({
          ...group,
          name: next.groups.length === 1 ? next.name : names.group(groupIndex + 1),
          order: groupIndex + 1,
        })),
      }
      : item);
    onChange({ ...definition, phases });
  };

  const changeGroupCount = (index: number, count: number) => {
    const current = definition.phases[index];
    const groups = Array.from({ length: count }, (_, groupIndex) => ({
      ...(current.groups[groupIndex] || { id: id() }),
      name: count === 1 ? current.name : names.group(groupIndex + 1),
      order: groupIndex + 1,
    }));
    replacePhase(index, { ...current, groups });
  };

  const generateMappings = async (sourceIndex: number) => {
    const source = definition.phases[sourceIndex];
    const target = definition.phases[sourceIndex + 1];
    if (!source || !target) return;
    const replacing = definition.advancement_rules.some(rule =>
      source.groups.some(group => group.id === rule.source_group_id)
      && target.groups.some(group => group.id === rule.target_group_id)
    );
    if (replacing && !window.confirm(t('phase_builder.confirm_regenerate'))) return;
    setGenerationError('');
    try {
      const response = await tournamentService.previewAdvancementMappings(definition, source.id, target.id);
      const generated = response.data.rules as TournamentFormatDefinition['advancement_rules'];
      const sourceIds = new Set(source.groups.map(group => group.id));
      const targetIds = new Set(target.groups.map(group => group.id));
      const retained = definition.advancement_rules.filter(rule =>
        !(sourceIds.has(rule.source_group_id) && targetIds.has(rule.target_group_id))
      );
      onChange({ ...definition, advancement_rules: [...retained, ...generated] });
      setSameSourcePairs(response.data.same_source_first_round_pairs || []);
      setShowMappings(true);
    } catch (error: any) {
      setGenerationError(error.response?.data?.error || t('phase_builder.error_generate'));
    }
  };

  return (
    <section data-help-id="region-tournament-phase-builder" className="p-4 border border-blue-200 rounded-lg bg-blue-50 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-64 text-sm font-medium text-gray-700">
          {t('phase_builder.template')}
          <select data-help-id="option-tournament-format-template" disabled={disabled} className="mt-1 w-full px-3 py-2 border rounded-md bg-white" value={selectedTemplate} onChange={(event) => {
            const nextTemplate = event.target.value as typeof selectedTemplate;
            if (nextTemplate !== selectedTemplate
              && !window.confirm(t('phase_builder.confirm_template'))) return;
            setSelectedTemplate(nextTemplate);
            setSameSourcePairs([]);
            onChange(template(nextTemplate, names));
          }}>
            <option value="swiss">{t('format_summary.swiss')}</option>
            <option value="league">{t('phase_builder.template_league')}</option>
            <option value="elimination">{t('format_summary.single_elimination')}</option>
            <option value="swiss_brackets_final">{t('phase_builder.template_swiss_brackets_final')}</option>
          </select>
        </label>
        <button data-help-id="action-toggle-advanced-phase-builder" type="button" disabled={disabled} onClick={() => setAdvanced(current => !current)} className="px-4 py-2 border border-blue-500 text-blue-700 rounded-md">
          {advanced ? t('phase_builder.hide_advanced') : t('phase_builder.advanced')}
        </button>
      </div>

      <div className="space-y-3">
        {definition.phases.map((item, index) => (
          <div key={item.id} className="p-3 bg-white border rounded-md grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="text-sm">{t('phase_builder.phase_name')}
              <input data-help-id="field-tournament-phase-name" disabled={disabled} value={item.name} onChange={(event) => replacePhase(index, { ...item, name: event.target.value })} className="mt-1 w-full px-2 py-1 border rounded" />
            </label>
            <label className="text-sm">{t('format_summary.system')}
              <select data-help-id="option-tournament-phase-format" disabled={disabled} value={item.format} onChange={(event) => {
                const format = event.target.value as PhaseFormat;
                replacePhase(index, {
                  ...item, format,
                  swiss: format === 'swiss' ? { round_count: 3, avoid_rematches: true } : undefined,
                  round_robin: format === 'round_robin' ? { cycle_count: 1, open_rounds_together: true } : undefined,
                  elimination: format === 'single_elimination' ? { bracket_size: null, seeding_policy: 'seeded', reseed_each_round: false } : undefined,
                });
              }} className="mt-1 w-full px-2 py-1 border rounded">
                <option value="swiss">{t('format_summary.swiss')}</option><option value="round_robin">{t('format_summary.round_robin')}</option><option value="single_elimination">{t('phase_builder.elimination')}</option>
              </select>
            </label>
            <label className="text-sm">{t('format_summary.groups_brackets')}
              <EditableIntegerInput data-help-id="field-tournament-phase-group-count" disabled={disabled} min={1} max={32} value={item.groups.length} onValueChange={count => changeGroupCount(index, count)} className="mt-1 w-full px-2 py-1 border rounded" />
            </label>
            <label className="text-sm">{t('phase_builder.best_of')}
              <select data-help-id="option-tournament-phase-best-of" disabled={disabled} value={item.default_best_of} onChange={(event) => replacePhase(index, { ...item, default_best_of: Number(event.target.value) as BestOf })} className="mt-1 w-full px-2 py-1 border rounded">
                <option value={1}>Bo1</option><option value={3}>Bo3</option><option value={5}>Bo5</option>
              </select>
            </label>
            {item.format === 'swiss' && <label className="text-sm">{t('format_summary.rounds')}
              <EditableIntegerInput data-help-id="field-tournament-swiss-rounds" disabled={disabled} min={1} max={MAX_SWISS_ROUNDS} value={item.swiss?.round_count || 1} onValueChange={roundCount => replacePhase(index, { ...item, swiss: { ...item.swiss, round_count: roundCount } })} className="mt-1 w-full px-2 py-1 border rounded" />
            </label>}
            {item.format === 'round_robin' && <label className="text-sm">{t('format_summary.cycles')}
              <select data-help-id="option-tournament-league-cycles" disabled={disabled} value={item.round_robin?.cycle_count || 1} onChange={(event) => replacePhase(index, { ...item, round_robin: { ...item.round_robin, cycle_count: Number(event.target.value) as 1 | 2 } })} className="mt-1 w-full px-2 py-1 border rounded"><option value={1}>{t('phase_builder.cycles_one')}</option><option value={2}>{t('phase_builder.cycles_two')}</option></select>
            </label>}
            {advanced && <label className="text-sm">{t('phase_builder.assignment')}
              <select data-help-id="option-tournament-phase-assignment" disabled={disabled || index > 0} value={item.assignment_method} onChange={(event) => replacePhase(index, { ...item, assignment_method: event.target.value as TournamentPhaseDefinition['assignment_method'] })} className="mt-1 w-full px-2 py-1 border rounded">
                <option value="seeded_snake">{t('phase_builder.assignment_snake')}</option><option value="random">{t('phase_builder.assignment_random')}</option><option value="manual">{t('phase_builder.assignment_manual')}</option>
              </select>
            </label>}
            {advanced && definition.phases.length > 1 && <button
              data-help-id="action-remove-tournament-phase"
              type="button"
              disabled={disabled}
              onClick={() => {
                const removedGroups = new Set(item.groups.map(group => group.id));
                const phases = definition.phases.filter(phaseItem => phaseItem.id !== item.id).map((phaseItem, phaseIndex) => ({ ...phaseItem, order: phaseIndex + 1 }));
                setSameSourcePairs([]);
                onChange({ phases, advancement_rules: definition.advancement_rules.filter(rule => !removedGroups.has(rule.source_group_id) && !removedGroups.has(rule.target_group_id)) });
              }}
              className="text-sm text-red-700"
            >{t('phase_builder.remove_phase')}</button>}
            {advanced && index === 0 && item.assignment_method === 'manual' && <div className="md:col-span-5 border-t pt-2 space-y-2">
              <p className="text-sm text-gray-600">{t('phase_builder.manual_help')}</p>
              {entryOptions.length === 0 ? <p className="text-sm text-amber-700">{t('phase_builder.manual_unavailable')}</p> : entryOptions.map(entry => {
                const assignedGroup = item.groups.find(group => (group.entry_ids || []).includes(entry.id));
                return <label key={entry.id} className="grid grid-cols-2 gap-2 text-sm items-center"><span>{entry.name}</span><select data-help-id="option-manual-tournament-group" disabled={disabled} value={assignedGroup?.id || ''} onChange={(event) => {
                  const groups = item.groups.map(group => ({ ...group, entry_ids: (group.entry_ids || []).filter(entryId => entryId !== entry.id) }));
                  const target = groups.find(group => group.id === event.target.value);
                  if (target) target.entry_ids = [...(target.entry_ids || []), entry.id];
                  replacePhase(index, { ...item, groups });
                }} className="border rounded p-1"><option value="">{t('phase_builder.unassigned')}</option>{item.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>;
              })}
            </div>}
          </div>
        ))}
      </div>
      {directPassSummaries.map(summary => <div data-help-id="region-tournament-direct-pass-reserve" key={`direct-capacity-${summary.target.id}`} className="p-3 bg-white border rounded-md space-y-2">
        <h4 className="font-medium">{t('phase_builder.reserve_title', { phase: summary.target.name })}</h4>
        <p className="text-xs text-gray-600">{t('phase_builder.reserve_help')}</p>
        <div className="grid gap-2 md:grid-cols-2">
          {summary.target.groups.map(group => <label key={group.id} className="text-sm">{t('phase_builder.reserved_passes', { group: group.name })}
            <EditableIntegerInput data-help-id="field-group-direct-advancement-capacity" disabled={disabled} min={0} value={group.direct_advancement_slots ?? 0} onValueChange={capacity => {
              const phases = definition.phases.map(item => item.id !== summary.target.id ? item : {
                ...item,
                groups: item.groups.map(row => row.id === group.id ? { ...row, direct_advancement_slots: capacity } : row),
              });
              setSameSourcePairs([]);
              onChange({ ...definition, phases });
            }} className="mt-1 block w-full border rounded px-2 py-1" />
          </label>)}
        </div>
        {summary.groups.map(({ group, qualifiers, directPasses, projected, bracketSize, byes, configured }) => (
          <p key={`${group.id}-direct-summary`} className="text-sm text-gray-700">
            {group.name}: {t('phase_builder.projection', { qualifiers: summary.hasMappings ? qualifiers : '—', reserved: directPasses, total: summary.hasMappings ? projected : '—' })}; {summary.target.format === 'single_elimination'
              ? `${t(configured ? 'composition.bracket_configured' : 'composition.bracket_recommended', { size: bracketSize, byes: summary.hasMappings ? byes : '—' })}.`
              : t('phase_builder.bracket_unconstrained')}
          </p>
        ))}
        {!summary.hasMappings && <p className="text-xs text-amber-800">{t('phase_builder.configure_help', { total: summary.sourceQualifierTotal })}</p>}
      </div>)}
      {definition.phases.slice(0, -1).map((source, sourceIndex) => {
        const target = definition.phases[sourceIndex + 1];
        return <div data-help-id="region-tournament-advancement-qualifiers" key={`advancement-${source.id}`} className="p-3 bg-white border rounded-md space-y-2">
          <h4 className="font-medium">{t('phase_builder.advancement_title', { source: source.name, target: target.name })}</h4>
          <p className="text-xs text-gray-600">{t('phase_builder.advancement_help')}</p>
          <p className="text-sm text-gray-700">{t('phase_builder.configured_total', { total: source.groups.reduce((total, group) => total + Number(group.advance_count || 0), 0) })}</p>
          <div className="grid gap-2 md:grid-cols-2">
            {source.groups.map(group => <label key={group.id} className="text-sm">{t('phase_builder.group_qualifiers', { group: group.name })}
              <input data-help-id="field-group-advance-count" disabled={disabled} type="text" inputMode="numeric" pattern="[0-9]*" value={group.advance_count ?? ''} onChange={event => {
                const rawValue = event.target.value;
                const parsedValue = Number(rawValue);
                const nextValue = rawValue === '' ? null
                  : /^\d+$/.test(rawValue) && Number.isSafeInteger(parsedValue) ? parsedValue
                    : group.advance_count ?? null;
                const phases = definition.phases.map(item => item.id !== source.id ? item : {
                  ...item,
                  groups: item.groups.map(row => row.id === group.id ? { ...row, advance_count: nextValue } : row),
                });
                setSameSourcePairs([]);
                onChange({ ...definition, phases });
              }} className="mt-1 block w-full border rounded px-2 py-1" />
            </label>)}
          </div>
          <button data-help-id="action-generate-advancement-mappings" type="button" disabled={disabled} onClick={() => void generateMappings(sourceIndex)} className="px-3 py-2 border border-blue-600 text-blue-700 rounded-md">{t('phase_builder.generate_mappings')}</button>
          {generationError && <p role="alert" className="text-sm text-red-700">{generationError}</p>}
        </div>;
      })}
      {(advanced || showMappings) && <div className="space-y-3">
        {advanced && <button data-help-id="action-add-tournament-phase" type="button" disabled={disabled} onClick={() => {
          setSameSourcePairs([]);
          onChange({ ...definition, phases: [...definition.phases, phase(names.phase(definition.phases.length + 1), definition.phases.length + 1, 'single_elimination', names)] });
        }} className="px-3 py-2 bg-blue-600 text-white rounded-md">{t('phase_builder.add_phase')}</button>}
        <div data-help-id="region-tournament-advancement-mappings" className="p-3 bg-white border rounded-md space-y-2">
          <h4 className="font-medium">{t('phase_builder.mappings_title')}</h4>
          <p className="text-xs text-gray-600">{t('phase_builder.mappings_order')}</p>
          {rulesInEntryOrder.map((rule, ruleIndex) => <div key={rule.id} className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div className="col-span-2 md:col-span-5 text-xs font-medium text-gray-700">{ruleIndex + 1}. {t('phase_builder.rule_summary', { source: groupOptions.find(group => group.id === rule.source_group_id)?.label || t('phase_builder.unknown_group'), rank: rule.source_rank, target: groupOptions.find(group => group.id === rule.target_group_id)?.label || t('phase_builder.unknown_group'), seed: rule.target_seed })}</div>
            <label className="text-xs">{t('phase_builder.source_group')}<select data-help-id="option-advancement-source-group" disabled={disabled} value={rule.source_group_id} onChange={(event) => updateMappings(definition.advancement_rules.map(item => item.id === rule.id ? { ...item, source_group_id: event.target.value } : item))} className="block w-full border rounded p-1">{groupOptions.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>
            <label className={`text-xs ${duplicateSourceRuleIds.has(rule.id) ? 'text-red-700' : ''}`}>{t('phase_builder.source_rank')}<EditableIntegerInput data-help-id="field-advancement-source-rank" aria-invalid={duplicateSourceRuleIds.has(rule.id)} disabled={disabled} min={1} value={rule.source_rank} onValueChange={rank => updateMappings(definition.advancement_rules.map(item => item.id === rule.id ? { ...item, source_rank: rank } : item))} className={`block w-full border rounded p-1 ${duplicateSourceRuleIds.has(rule.id) ? 'border-red-600 bg-red-50' : ''}`} /></label>
            <label className="text-xs">{t('phase_builder.target_group')}<select data-help-id="option-advancement-target-group" disabled={disabled} value={rule.target_group_id} onChange={(event) => updateMappings(definition.advancement_rules.map(item => item.id === rule.id ? { ...item, target_group_id: event.target.value } : item))} className="block w-full border rounded p-1">{groupOptions.filter(group => group.phaseOrder > (groupOptions.find(source => source.id === rule.source_group_id)?.phaseOrder || 0)).map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>
            <label className={`text-xs ${duplicateTargetRuleIds.has(rule.id) ? 'text-red-700' : ''}`}>{t('phase_builder.target_seed')}<EditableIntegerInput data-help-id="field-advancement-target-seed" aria-invalid={duplicateTargetRuleIds.has(rule.id)} disabled={disabled} min={1} value={rule.target_seed} onValueChange={seed => updateMappings(definition.advancement_rules.map(item => item.id === rule.id ? { ...item, target_seed: seed } : item))} className={`block w-full border rounded p-1 ${duplicateTargetRuleIds.has(rule.id) ? 'border-red-600 bg-red-50' : ''}`} /></label>
            <button data-help-id="action-remove-advancement-rule" type="button" disabled={disabled} onClick={() => updateMappings(definition.advancement_rules.filter(item => item.id !== rule.id))} className="text-red-700 text-sm">{t('phase_builder.remove')}</button>
          </div>)}
          {duplicateTargetRuleIds.size > 0 && <p role="alert" className="text-sm text-red-700">{t('phase_builder.error_duplicate_target')}</p>}
          {duplicateSourceRuleIds.size > 0 && <p role="alert" className="text-sm text-red-700">{t('phase_builder.error_duplicate_source')}</p>}
          {sameSourcePairs.length > 0 && <p role="alert" className="text-sm text-amber-700">{t('phase_builder.same_source_warning', { pairs: sameSourcePairs.map(pair => t('phase_builder.same_source_pair', { bracket: groupOptions.find(group => group.id === pair.target_group_id)?.label || t('phase_builder.bracket'), one: pair.seed_one, two: pair.seed_two })).join(' · ') })}</p>}
          {definition.phases.length > 1 && <button data-help-id="action-add-advancement-rule" type="button" disabled={disabled || groupOptions.length < 2} onClick={() => {
            const source = groupOptions[0];
            const target = groupOptions.find(group => group.phaseOrder > source.phaseOrder);
            if (target) updateMappings([...definition.advancement_rules, { id: id(), source_group_id: source.id, source_rank: 1, target_group_id: target.id, target_seed: 1 }]);
          }} className="text-sm text-blue-700">{t('phase_builder.add_mapping')}</button>}
        </div>
      </div>}
      <p className={`text-sm ${validMappings ? 'text-green-700' : 'text-red-700'}`}>{validMappings ? t('phase_builder.valid_summary', { count: definition.phases.length }) : t('phase_builder.error_removed_group')}</p>
    </section>
  );
};

export default TournamentPhaseBuilder;

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { THEMES, useThemeStore, type ThemeName } from '../store/themeStore';
import {
  ADVANCED_TOKEN_GROUPS,
  DEFAULT_CUSTOM_COLORS,
  buildCustomPalette,
  checkContrast,
  formatRgb,
  parseColorInput,
  tokenColor,
  type AdvancedToken,
  type CustomThemeConfig,
} from '../theme/customTheme';

type ColorKey = 'background' | 'text' | 'accent';

interface ColorInputsProps {
  /** id of the picker, so a <label htmlFor> can point at it. */
  id: string;
  /** Accessible name of the text field. */
  label: string;
  value: string;
  onChange: (hex: string) => void;
  /** Stable help hooks; repeated rows share them (see AGENTS.md). */
  pickerHelpId: string;
  textHelpId: string;
}

/**
 * A color picker plus a text field that accepts `#rrggbb` or `r, g, b`.
 * The picker applies immediately (it is not a text filter), while typed
 * values apply on Enter or when the field loses focus, so half-typed values
 * never reach the live preview.
 */
const ColorInputs: React.FC<ColorInputsProps> = ({ id, label, value, onChange, pickerHelpId, textHelpId }) => {
  const { t } = useTranslation();
  const [typed, setTyped] = useState(formatRgb(value));
  const [invalid, setInvalid] = useState(false);

  // Keep the text in sync when the picker or a reset changes the value.
  useEffect(() => {
    setTyped(formatRgb(value));
    setInvalid(false);
  }, [value]);

  const applyTyped = () => {
    const hex = parseColorInput(typed);
    if (hex) {
      setInvalid(false);
      if (hex !== value) onChange(hex);
    } else {
      setInvalid(true);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          data-help-id={pickerHelpId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded border border-gray-300 bg-white p-1"
        />
        <input
          type="text"
          data-help-id={textHelpId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={applyTyped}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyTyped();
            }
          }}
          aria-invalid={invalid}
          aria-label={t('theme.color_value_label', { color: label })}
          placeholder="243, 234, 216"
          className={`w-36 rounded-lg border px-3 py-2 font-mono text-sm bg-white text-gray-800 focus:outline-none ${
            invalid ? 'border-red-500' : 'border-gray-300 focus:border-blue-500'
          }`}
        />
      </div>
      {invalid && <p className="text-xs text-red-600">{t('theme.color_invalid')}</p>}
    </div>
  );
};

/** One of the three main picks, with its label above the inputs. */
const ColorField: React.FC<{ colorKey: ColorKey; value: string; onChange: (hex: string) => void }> = ({
  colorKey,
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const id = `custom-theme-${colorKey}`;
  const label = t(`theme.color_${colorKey}`);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-gray-700">{label}</label>
      <ColorInputs
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        pickerHelpId={`field-custom-theme-${colorKey}`}
        textHelpId={`field-custom-theme-${colorKey}-rgb`}
      />
    </div>
  );
};

/** i18n key of an advanced token label (`gray-700` -> `theme.token_gray_700`). */
const tokenLabelKey = (token: AdvancedToken) => `theme.token_${token.replace('-', '_')}`;

/**
 * Sample built from the same Tailwind classes the site uses, so it renders
 * with the previewed palette. It shows every advanced role side by side,
 * which the page behind the editor may not have in view.
 */
const ThemeSample: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div data-help-id="region-custom-theme-sample" className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase text-gray-500">{t('theme.sample_title')}</p>
      <h4 className="text-lg font-bold text-gray-800">{t('theme.sample_heading')}</h4>
      <p className="font-semibold text-primary">{t('theme.sample_brand')}</p>
      <p className="text-gray-700">{t('theme.sample_body')}</p>
      <p className="text-sm text-gray-500">{t('theme.sample_secondary')}</p>
      <p className="text-sm text-gray-900 font-semibold">{t('theme.sample_strong')}</p>
      <label className="mt-3 block text-sm font-semibold text-gray-600">{t('theme.sample_label')}</label>
      <input
        type="text"
        readOnly
        tabIndex={-1}
        placeholder={t('theme.sample_placeholder')}
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none"
      />
      <table className="mt-3 w-full text-sm">
        <thead className="bg-gray-100">
          <tr><th className="px-3 py-1 text-left text-gray-700">{t('theme.sample_table_header')}</th></tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-200"><td className="px-3 py-1 text-gray-700">{t('theme.sample_table_row')}</td></tr>
          <tr className="bg-gray-50"><td className="px-3 py-1 text-gray-700">{t('theme.sample_table_row')}</td></tr>
        </tbody>
      </table>
      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
        {t('theme.sample_highlight')} <span className="rounded bg-blue-100 px-1 text-blue-900">{t('theme.sample_badge')}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="cursor-default rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          {t('theme.sample_button')}
        </span>
        <span className="cursor-default rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white">
          {t('theme.sample_button_light')}
        </span>
        <span className="cursor-default text-sm font-semibold text-blue-600 hover:text-blue-700">{t('theme.sample_link')}</span>
      </div>
    </div>
  );
};

interface CustomThemeEditorProps {
  /** Colors to start from: the saved custom theme, or the active base theme's defaults. */
  initial: CustomThemeConfig;
  /** Persists the colors. Rejections are shown by the caller. */
  onSave: (config: CustomThemeConfig) => Promise<void>;
  onClose: () => void;
}

/**
 * Editor for the user's custom theme. Every change is previewed live on the
 * whole page, which is the most faithful preview possible. Closing without
 * saving, or unmounting, renders the saved state again.
 *
 * Advanced mode lists every exposed color with the value generated from the
 * three picks. Editing one stores an override; resetting it returns that
 * color to the generated value, which keeps following the picks.
 */
const CustomThemeEditor: React.FC<CustomThemeEditorProps> = ({ initial, onSave, onClose }) => {
  const { t } = useTranslation();
  const previewCustomTheme = useThemeStore((state) => state.previewCustomTheme);
  const [draft, setDraft] = useState<CustomThemeConfig>(initial);
  const [advanced, setAdvanced] = useState(Object.keys(initial.overrides ?? {}).length > 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    previewCustomTheme(draft);
  }, [draft, previewCustomTheme]);

  // Leaving the editor restores whatever is saved (the new colors after a
  // save, the previous theme after a cancel).
  useEffect(() => () => previewCustomTheme(null), [previewCustomTheme]);

  const checks = useMemo(() => checkContrast(draft), [draft]);
  const canSave = checks.every((check) => check.passes);
  const overrides = draft.overrides ?? {};
  const overrideCount = Object.keys(overrides).length;

  // Effective colors, and the colors the picks alone would generate. The
  // automatic value of a token is shown even while it is overridden, so the
  // user can compare against it before resetting.
  const palette = useMemo(() => buildCustomPalette(draft), [draft]);
  const automatic = useMemo(() => buildCustomPalette({ ...draft, overrides: undefined }), [draft]);

  const setColor = (key: ColorKey) => (hex: string) => setDraft((current) => ({ ...current, [key]: hex }));

  const setOverride = (token: AdvancedToken, hex: string | null) =>
    setDraft((current) => {
      const next = { ...(current.overrides ?? {}) };
      if (hex === null) delete next[token];
      else next[token] = hex;
      // An empty override map is dropped so a simple theme stays simple.
      return { ...current, overrides: Object.keys(next).length > 0 ? next : undefined };
    });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-help-id="region-custom-theme-editor" className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800">{t('theme.custom_editor_title')}</h3>
      <p className="mb-4 text-sm text-gray-600">{t('theme.custom_editor_help')}</p>

      <div className="mb-4 flex flex-col gap-1">
        <label htmlFor="custom-theme-base" className="text-sm font-semibold text-gray-700">
          {t('theme.custom_base')}
        </label>
        <select
          id="custom-theme-base"
          data-help-id="field-custom-theme-base"
          value={draft.base}
          onChange={(e) => setDraft((current) => ({ ...current, base: e.target.value as ThemeName }))}
          className="w-48 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-800 focus:border-blue-500 focus:outline-none"
        >
          {THEMES.map((theme) => (
            <option key={theme} value={theme}>{t(`theme.name_${theme}`)}</option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-6">
        <ColorField colorKey="background" value={draft.background} onChange={setColor('background')} />
        <ColorField colorKey="text" value={draft.text} onChange={setColor('text')} />
        <ColorField colorKey="accent" value={draft.accent} onChange={setColor('accent')} />
      </div>

      <label className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700">
        <input
          type="checkbox"
          data-help-id="option-custom-theme-advanced"
          checked={advanced}
          onChange={(e) => setAdvanced(e.target.checked)}
          className="h-4 w-4"
        />
        {t('theme.custom_advanced')}
        {overrideCount > 0 && (
          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
            {t('theme.custom_advanced_count', { count: overrideCount })}
          </span>
        )}
      </label>

      {advanced && (
        <div data-help-id="region-custom-theme-advanced" className="mb-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-5">
            <p className="text-sm text-gray-600">{t('theme.custom_advanced_help')}</p>
            {ADVANCED_TOKEN_GROUPS.map((group) => (
              <div key={group.key}>
                <h4 className="mb-2 border-b border-gray-200 pb-1 font-semibold text-gray-800">
                  {t(`theme.group_${group.key}`)}
                </h4>
                <ul className="flex flex-col gap-3">
                  {group.tokens.map((token) => {
                    const overridden = token in overrides;
                    const label = t(tokenLabelKey(token));
                    return (
                      <li key={token} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <label htmlFor={`custom-theme-token-${token}`} className="w-56 text-sm text-gray-700">
                          {label}
                          <span className="block font-mono text-xs text-gray-500">{token}</span>
                        </label>
                        <ColorInputs
                          id={`custom-theme-token-${token}`}
                          label={label}
                          value={tokenColor(palette, token)}
                          onChange={(hex) => setOverride(token, hex)}
                          pickerHelpId="field-custom-theme-token"
                          textHelpId="field-custom-theme-token-rgb"
                        />
                        {overridden ? (
                          <button
                            type="button"
                            data-help-id="action-reset-custom-theme-token"
                            onClick={() => setOverride(token, null)}
                            title={t('theme.token_reset_title', { value: formatRgb(tokenColor(automatic, token)) })}
                            className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                          >
                            <span
                              aria-hidden="true"
                              className="inline-block h-3 w-3 rounded-sm border border-gray-300"
                              style={{ backgroundColor: tokenColor(automatic, token) }}
                            />
                            ↺ {t('theme.token_reset')}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">{t('theme.token_auto')}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {overrideCount > 0 && (
              <button
                type="button"
                data-help-id="action-reset-custom-theme-overrides"
                onClick={() => setDraft((current) => ({ ...current, overrides: undefined }))}
                className="self-start rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
              >
                {t('theme.custom_advanced_reset')}
              </button>
            )}
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            <ThemeSample />
          </div>
        </div>
      )}

      <div data-help-id="region-custom-theme-contrast" className="mb-4">
        <p className="mb-2 text-sm font-semibold text-gray-700">{t('theme.contrast_title')}</p>
        <ul className="flex flex-col gap-1 text-sm">
          {checks.map((check) => (
            <li key={check.key} className={check.passes ? 'text-green-700' : 'text-red-700'}>
              {check.passes ? '✓' : '✗'} {t(`theme.contrast_${check.key}`)}
              {check.ratio !== null && `: ${check.ratio.toFixed(1)}:1`}
            </li>
          ))}
        </ul>
        {!canSave && <p className="mt-2 text-sm text-red-700">{t('theme.contrast_blocked')}</p>}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-help-id="action-save-custom-theme"
          onClick={handleSave}
          disabled={!canSave || saving}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? t('theme.saving') : t('theme.custom_save')}
        </button>
        <button
          type="button"
          data-help-id="action-reset-custom-theme"
          onClick={() => setDraft((current) => ({ base: current.base, ...DEFAULT_CUSTOM_COLORS[current.base] }))}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-700 hover:bg-gray-100"
        >
          {t('theme.custom_reset')}
        </button>
        <button
          type="button"
          data-help-id="action-cancel-custom-theme"
          onClick={onClose}
          className="rounded-lg px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );
};

export default CustomThemeEditor;

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { THEMES, useThemeStore, type ThemeName } from '../store/themeStore';
import {
  DEFAULT_CUSTOM_COLORS,
  checkContrast,
  formatRgb,
  parseColorInput,
  type CustomThemeConfig,
} from '../theme/customTheme';

type ColorKey = 'background' | 'text' | 'accent';

interface ColorFieldProps {
  colorKey: ColorKey;
  value: string;
  onChange: (hex: string) => void;
}

/**
 * One color pick: a native color picker plus a text field that accepts
 * `#rrggbb` or `r, g, b`. The picker applies immediately (it is not a text
 * filter), while typed values apply on Enter or when the field loses focus,
 * so half-typed values never reach the live preview.
 */
const ColorField: React.FC<ColorFieldProps> = ({ colorKey, value, onChange }) => {
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
      onChange(hex);
    } else {
      setInvalid(true);
    }
  };

  const inputId = `custom-theme-${colorKey}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-semibold text-gray-700">
        {t(`theme.color_${colorKey}`)}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="color"
          data-help-id={`field-custom-theme-${colorKey}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded border border-gray-300 bg-white p-1"
        />
        <input
          type="text"
          data-help-id={`field-custom-theme-${colorKey}-rgb`}
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
          aria-label={t('theme.color_value_label', { color: t(`theme.color_${colorKey}`) })}
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
 */
const CustomThemeEditor: React.FC<CustomThemeEditorProps> = ({ initial, onSave, onClose }) => {
  const { t } = useTranslation();
  const previewCustomTheme = useThemeStore((state) => state.previewCustomTheme);
  const [draft, setDraft] = useState<CustomThemeConfig>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    previewCustomTheme(draft);
  }, [draft, previewCustomTheme]);

  // Leaving the editor restores whatever is saved (the new colors after a
  // save, the previous theme after a cancel).
  useEffect(() => () => previewCustomTheme(null), [previewCustomTheme]);

  const checks = useMemo(() => checkContrast(draft), [draft]);
  const canSave = checks.every((check) => check.passes);

  const setColor = (key: ColorKey) => (hex: string) => setDraft((current) => ({ ...current, [key]: hex }));

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

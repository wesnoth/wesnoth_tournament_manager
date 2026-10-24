/**
 * Custom theme palette generation.
 *
 * A custom theme stores only three picked colors (background, text, accent)
 * on top of a built-in base theme. This module derives every CSS variable
 * the themes define (see src/styles/themes.css) from those picks, so the
 * stored preference stays small and the components need no changes.
 *
 * Mixing happens in OKLab, a perceptual color space, so the generated steps
 * look evenly spaced and intermediate shades do not turn muddy the way a
 * plain RGB average does.
 */

import type { ThemeName } from '../store/themeStore';

export interface CustomThemeConfig {
  base: ThemeName;
  /** Page background, #rrggbb. */
  background: string;
  /** Main text color, #rrggbb. */
  text: string;
  /** Accent for links, buttons and highlights, #rrggbb. */
  accent: string;
}

type Rgb = [number, number, number];

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;

/** Starting colors per base theme, close to that theme's own look. */
export const DEFAULT_CUSTOM_COLORS: Record<ThemeName, Omit<CustomThemeConfig, 'base'>> = {
  medieval: { background: '#f3ead8', text: '#1c1712', accent: '#a27f44' },
  ranked: { background: '#f5f5f5', text: '#111827', accent: '#3b82f6' },
};

/** Minimum WCAG contrast for body text (level AA, normal size). */
export const MIN_TEXT_CONTRAST = 4.5;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && HEX_COLOR.test(value);

/** Type guard for custom theme configs read from storage or the API. */
export const isCustomThemeConfig = (value: unknown): value is CustomThemeConfig => {
  if (!value || typeof value !== 'object') return false;
  const { base, background, text, accent } = value as Record<string, unknown>;
  return (base === 'medieval' || base === 'ranked')
    && isHexColor(background) && isHexColor(text) && isHexColor(accent);
};

const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

const rgbToHex = (rgb: Rgb): string =>
  `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;

/**
 * Parses what a user types in a color field: `#rrggbb`, `rrggbb`, or three
 * 0-255 channels separated by commas or spaces (`243, 234, 216`). Returns
 * the normalized lowercase hex, or null when the input is not a color.
 */
export function parseColorInput(input: string): string | null {
  const value = input.trim();
  const hex = value.startsWith('#') ? value : `#${value}`;
  if (HEX_COLOR.test(hex)) return hex.toLowerCase();
  const channels = value.replace(/^rgb\s*\(|\)$/gi, '').split(/[\s,]+/).filter(Boolean);
  if (channels.length !== 3 || !channels.every((c) => /^\d{1,3}$/.test(c))) return null;
  const rgb = channels.map(Number) as Rgb;
  return rgb.every((c) => c <= 255) ? rgbToHex(rgb) : null;
}

/** Formats a hex color as the `r, g, b` text shown beside the picker. */
export const formatRgb = (hex: string): string => hexToRgb(hex).join(', ');

// sRGB <-> OKLab conversion (Björn Ottosson's reference matrices).
const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

const rgbToOklab = ([r8, g8, b8]: Rgb): Rgb => {
  const [r, g, b] = [toLinear(r8), toLinear(g8), toLinear(b8)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const oklabToRgb = ([L, a, b]: Rgb): Rgb => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

/** Mixes two hex colors in OKLab; `amount` 0 returns `from`, 1 returns `to`. */
export function mixColors(from: string, to: string, amount: number): string {
  const a = rgbToOklab(hexToRgb(from));
  const b = rgbToOklab(hexToRgb(to));
  return rgbToHex(oklabToRgb(a.map((v, i) => v + (b[i] - v) * amount) as Rgb));
}

/** WCAG relative luminance of a hex color. */
const luminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two colors, from 1 (none) to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pushes `color` toward `towards` until it reaches `target` contrast against
 * `against`, in small steps so the hue stays recognizable. It stops at
 * `towards` itself, so the result is never more extreme than the user's own
 * text color: if even that fails, the base pair is reported as failing.
 */
function ensureContrast(color: string, against: string, towards: string, target: number): string {
  let result = color;
  for (let step = 1; contrastRatio(result, against) < target && step <= 20; step += 1) {
    result = mixColors(color, towards, step / 20);
  }
  return result;
}

export interface CustomPalette {
  /** Hex value of every derived color, used by charts and the contrast report. */
  hex: {
    gray: Record<(typeof SHADES)[number], string>;
    blue: Record<(typeof SHADES)[number], string>;
    white: string;
    primary: string;
    secondary: string;
    background: string;
  };
  /** CSS custom properties to set on the root element, as themes.css expects them. */
  vars: Record<string, string>;
}

/**
 * Derives the full palette from a custom theme config.
 *
 * Roles, matching how components use the Tailwind scales:
 * - gray: 50-300 are subtle backgrounds and borders, 400-950 secondary and
 *   main text. It runs from the background to the text color.
 * - blue (the accent scale): 50-300 are tinted backgrounds, 500 is the
 *   picked accent (buttons), 600-900 are links and strong accents on cards.
 * - white: card surfaces. It is also the text color on accent buttons and
 *   dark bars, which is why accent shades are checked against it: WCAG
 *   contrast is symmetric, so one check covers both uses.
 *
 * The ramps also run correctly from dark to light, but the editor only
 * accepts light backgrounds for now (see checkContrast): status tints such
 * as `bg-yellow-50` are not themed, and on a dark theme they would carry
 * light text and become unreadable.
 */
export function buildCustomPalette(config: CustomThemeConfig): CustomPalette {
  const { background, text, accent } = config;
  const isLight = luminance(background) > luminance(text);
  const card = isLight ? mixColors(background, '#ffffff', 0.7) : mixColors(background, text, 0.07);

  const grayAmounts = [0.03, 0.07, 0.14, 0.24, 0.4, 0.52, 0.64, 0.75, 0.86, 0.93, 0.97];
  const gray = Object.fromEntries(
    SHADES.map((shade, i) => [shade, mixColors(background, text, grayAmounts[i])])
  ) as CustomPalette['hex']['gray'];
  // Secondary text (500) and body text shades must stay readable on cards
  // even when the user picks close background and text colors.
  for (const shade of ['500', '600', '700'] as const) {
    gray[shade] = ensureContrast(gray[shade], card, text, MIN_TEXT_CONTRAST);
  }

  const lightAmounts = [0.1, 0.2, 0.35, 0.55, 0.78];
  const darkAmounts = [0.18, 0.34, 0.48, 0.6, 0.72];
  const blue = Object.fromEntries([
    ...SHADES.slice(0, 5).map((shade, i) => [shade, mixColors(card, accent, lightAmounts[i])]),
    ['500', accent],
    ...SHADES.slice(6).map((shade, i) => [shade, mixColors(accent, text, darkAmounts[i])]),
  ]) as CustomPalette['hex']['blue'];
  // Accent buttons carry white text (3:1 is the WCAG minimum for their bold
  // labels) and accent links sit on cards (4.5:1 for normal text).
  blue['500'] = ensureContrast(blue['500'], card, text, 3);
  blue['600'] = ensureContrast(blue['600'], card, text, MIN_TEXT_CONTRAST);
  blue['700'] = ensureContrast(blue['700'], card, text, MIN_TEXT_CONTRAST);

  const hex = {
    gray,
    blue,
    white: card,
    primary: blue['900'],
    secondary: blue['500'],
    background,
  };

  const channels = (value: string) => hexToRgb(value).join(' ');
  const vars: Record<string, string> = {
    '--c-white': channels(card),
    '--c-primary': channels(hex.primary),
    '--c-secondary': channels(hex.secondary),
    '--c-dark': channels(hex.primary),
    '--c-light': channels(background),
    '--page-background': background,
  };
  for (const shade of SHADES) {
    vars[`--c-gray-${shade}`] = channels(gray[shade]);
    vars[`--c-blue-${shade}`] = channels(blue[shade]);
  }
  return { hex, vars };
}

export interface ContrastCheck {
  /** i18n key suffix under theme.contrast_*. */
  key: 'light_background' | 'text_background' | 'text_cards' | 'muted_cards' | 'links_cards';
  /** WCAG ratio, or null for checks that are not a color pair. */
  ratio: number | null;
  passes: boolean;
}

/**
 * Readability report shown in the editor; every check must pass to save.
 * The background must be lighter than the text, because the fixed status
 * tints (`bg-yellow-50` and similar) assume dark text on light surfaces.
 * The user's own pair is checked next. The derived pairs are adjusted
 * automatically, so they only fail when the picks leave no room to fix them.
 */
export function checkContrast(config: CustomThemeConfig): ContrastCheck[] {
  const { hex } = buildCustomPalette(config);
  const lightBackground: ContrastCheck = {
    key: 'light_background',
    ratio: null,
    passes: luminance(config.background) > luminance(config.text),
  };
  const pairs: Array<[ContrastCheck['key'], string, string]> = [
    ['text_background', config.text, config.background],
    ['text_cards', hex.gray['900'], hex.white],
    ['muted_cards', hex.gray['500'], hex.white],
    ['links_cards', hex.blue['600'], hex.white],
  ];
  return [lightBackground, ...pairs.map(([key, a, b]) => {
    const ratio = contrastRatio(a, b);
    return { key, ratio, passes: ratio >= MIN_TEXT_CONTRAST };
  })];
}

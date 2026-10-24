import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import i18next from 'i18next';
import { CUSTOM_THEME, useThemeStore, type ThemeName } from '../store/themeStore';
import { buildCustomPalette } from '../theme/customTheme';

interface EloChartProps {
  matches: any[];
  currentPlayerId: string;
}

type TimeWindow = '1m' | '3m' | '6m' | '1y' | '3y' | 'all';
type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

const MS_IN_DAY = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const startOfWeek = (date: Date) => {
  const copy = startOfDay(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
};
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const startOfQuarter = (date: Date) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
const startOfYear = (date: Date) => new Date(date.getFullYear(), 0, 1);

const getBucketStart = (date: Date, granularity: Granularity): Date => {
  switch (granularity) {
    case 'day':
      return startOfDay(date);
    case 'week':
      return startOfWeek(date);
    case 'month':
      return startOfMonth(date);
    case 'quarter':
      return startOfQuarter(date);
    case 'year':
      return startOfYear(date);
  }
};

const getWindowStart = (endTimestamp: number, window: TimeWindow): number => {
  if (window === 'all') return Number.MIN_SAFE_INTEGER;
  const daysMap: Record<Exclude<TimeWindow, 'all'>, number> = {
    '1m': 30,
    '3m': 90,
    '6m': 180,
    '1y': 365,
    '3y': 365 * 3,
  };
  return endTimestamp - daysMap[window] * MS_IN_DAY;
};

const getGranularityForData = (timestamps: number[]): Granularity => {
  if (timestamps.length <= 1) return 'day';
  const durationDays = (timestamps[timestamps.length - 1] - timestamps[0]) / MS_IN_DAY;

  if (durationDays <= 45 && timestamps.length <= 220) return 'day';
  if (durationDays <= 365) return 'week';
  if (durationDays <= 365 * 3) return 'month';
  if (durationDays <= 365 * 10) return 'quarter';
  return 'year';
};

const formatRangeLabel = (start: Date, end: Date, granularity: Granularity): string => {
  if (granularity === 'day') {
    return start.toLocaleDateString(i18next.language);
  }

  if (granularity === 'week') {
    return `${start.toLocaleDateString(i18next.language)} - ${end.toLocaleDateString(i18next.language)}`;
  }

  if (granularity === 'month') {
    return start.toLocaleDateString(i18next.language, { month: 'long', year: 'numeric' });
  }

  if (granularity === 'quarter') {
    return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
  }

  return `${start.getFullYear()}`;
};

const formatTickLabel = (start: Date, granularity: Granularity): string => {
  if (granularity === 'day') {
    return start.toLocaleDateString(i18next.language, { day: '2-digit', month: 'short' });
  }

  if (granularity === 'week') {
    return start.toLocaleDateString(i18next.language, { day: '2-digit', month: 'short' });
  }

  if (granularity === 'month') {
    return start.toLocaleDateString(i18next.language, { month: 'short', year: '2-digit' });
  }

  if (granularity === 'quarter') {
    return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
  }

  return `${start.getFullYear()}`;
};

/**
 * Chart colors per theme. Recharts writes colors as SVG presentation
 * attributes, which cannot resolve CSS variables, so each theme lists
 * concrete values. The ranked values are the chart's original colors.
 */
const CHART_COLORS: Record<ThemeName, { grid: string; axis: string; tooltipBackground: string; tooltipBorder: string; line: string }> = {
  ranked: { grid: '#ddd', axis: '#666', tooltipBackground: '#fff', tooltipBorder: '#ccc', line: '#2196F3' },
  medieval: { grid: '#e7d9c0', axis: '#5e4f3b', tooltipBackground: '#fdfbf7', tooltipBorder: '#cbac76', line: '#8a6a35' },
};

/** Chart colors of the custom theme, taken from its derived palette. */
const customChartColors = (palette: ReturnType<typeof buildCustomPalette>) => ({
  grid: palette.hex.gray['200'],
  axis: palette.hex.gray['600'],
  tooltipBackground: palette.hex.white,
  tooltipBorder: palette.hex.gray['300'],
  line: palette.hex.blue['600'],
});

const EloChart: React.FC<EloChartProps> = ({ matches, currentPlayerId }) => {
  const activeTheme = useThemeStore((state) => state.activeTheme);
  const customTheme = useThemeStore((state) => state.customTheme);
  const chartColors = useMemo(
    () => (activeTheme === CUSTOM_THEME && customTheme
      ? customChartColors(buildCustomPalette(customTheme))
      : CHART_COLORS[activeTheme === CUSTOM_THEME ? 'ranked' : activeTheme]),
    [activeTheme, customTheme]
  );
  const { t } = useTranslation();
  const [window, setWindow] = useState<TimeWindow>('all');

  const rawData = useMemo(() => {
    if (!matches || matches.length === 0) return [];

    return [...matches]
      .map((match) => {
        const matchDateRaw = match.created_at;
        const timestamp = new Date(matchDateRaw).getTime();
        if (!Number.isFinite(timestamp)) return null;

        const directElo = Number(match.player_elo_after);
        const isWinner = match.winner_id === currentPlayerId;
        const fallbackElo = Number(isWinner ? match.winner_elo_after : match.loser_elo_after);
        const elo = Number.isFinite(directElo) ? directElo : fallbackElo;
        if (!Number.isFinite(elo)) return null;

        return {
          timestamp,
          elo,
          matchId: match.id,
        };
      })
      .filter((point): point is { timestamp: number; elo: number; matchId: string } => point !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [matches, currentPlayerId]);

  const { chartData, granularity } = useMemo(() => {
    if (rawData.length === 0) {
      return { chartData: [], granularity: 'day' as Granularity };
    }

    const maxTimestamp = rawData[rawData.length - 1].timestamp;
    const minVisibleTimestamp = getWindowStart(maxTimestamp, window);
    const visibleRaw = rawData.filter((point) => point.timestamp >= minVisibleTimestamp);

    if (visibleRaw.length === 0) {
      return { chartData: [], granularity: 'day' as Granularity };
    }

    const timestamps = visibleRaw.map((point) => point.timestamp);
    const resolvedGranularity = getGranularityForData(timestamps);

    const grouped = new Map<string, {
      label: string;
      rangeLabel: string;
      elo: number;
      matchesCount: number;
      sortTs: number;
    }>();

    for (const point of visibleRaw) {
      const pointDate = new Date(point.timestamp);
      const bucketStart = getBucketStart(pointDate, resolvedGranularity);
      const key = bucketStart.toISOString();
      const existing = grouped.get(key);

      if (existing) {
        existing.elo = point.elo;
        existing.matchesCount += 1;
      } else {
        grouped.set(key, {
          label: formatTickLabel(bucketStart, resolvedGranularity),
          rangeLabel: formatRangeLabel(bucketStart, pointDate, resolvedGranularity),
          elo: point.elo,
          matchesCount: 1,
          sortTs: bucketStart.getTime(),
        });
      }
    }

    const aggregatedData = Array.from(grouped.values())
      .sort((a, b) => a.sortTs - b.sortTs)
      .map((point) => ({
        label: point.label,
        rangeLabel: point.rangeLabel,
        elo: point.elo,
        matchesCount: point.matchesCount,
      }));

    return { chartData: aggregatedData, granularity: resolvedGranularity };
  }, [rawData, window]);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 mb-8">
        <h3 className="text-2xl font-semibold text-gray-800 mb-6">{t('label_elo_evolution')}</h3>
        <div className="text-center text-gray-500 italic py-8">{t('no_data_available')}</div>
      </div>
    );
  }

  const minElo = Math.min(...chartData.map((point) => point.elo)) - 50;
  const maxElo = Math.max(...chartData.map((point) => point.elo)) + 50;

  const granularityLabelMap: Record<Granularity, string> = {
    day: t('time_group_day'),
    week: t('time_group_week'),
    month: t('time_group_month'),
    quarter: t('time_group_quarter'),
    year: t('time_group_year'),
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-8 mb-8">
      <h3 className="text-2xl font-semibold text-gray-800 mb-4">{t('label_elo_evolution')}</h3>

      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <label htmlFor="elo-window" className="text-sm font-semibold text-gray-700">
            {t('label_time_range')}
          </label>
      <select
            data-help-id="field-elo-time-range"
            id="elo-window"
            value={window}
            onChange={(event) => setWindow(event.target.value as TimeWindow)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="1m">{t('time_window_1m')}</option>
            <option value="3m">{t('time_window_3m')}</option>
            <option value="6m">{t('time_window_6m')}</option>
            <option value="1y">{t('time_window_1y')}</option>
            <option value="3y">{t('time_window_3y')}</option>
            <option value="all">{t('time_window_all')}</option>
          </select>
        </div>

        <div className="text-sm text-gray-600">
          <span className="font-semibold">{t('label_grouped_by')}:</span> {granularityLabelMap[granularity]}
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            <XAxis dataKey="label" stroke={chartColors.axis} tick={{ fontSize: 12 }} />
            <YAxis
              stroke={chartColors.axis}
              domain={[Math.max(minElo, 800), maxElo]}
              tick={{ fontSize: 12 }}
              label={{ value: t('label_elo_rating'), angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: chartColors.tooltipBackground,
                border: `1px solid ${chartColors.tooltipBorder}`,
                borderRadius: '4px',
                padding: '8px',
              }}
              formatter={(value: number) => [`${value} ELO`, t('label_elo_rating')]}
              labelFormatter={(_, payload: readonly any[]) => payload?.[0]?.payload?.rangeLabel || ''}
            />
            <Line
              type="monotone"
              dataKey="elo"
              stroke={chartColors.line}
              dot={chartData.length <= 80}
              activeDot={{ r: 5 }}
              strokeWidth={2}
              isAnimationActive
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="text-center p-4 bg-gray-50 rounded">
          <span className="text-sm font-semibold text-gray-700">{t('label_total_matches')}:</span>
          <span className="text-lg font-bold text-blue-600">{rawData.length}</span>
        </div>
        <div className="text-center p-4 bg-gray-50 rounded">
          <span className="text-sm font-semibold text-gray-700">{t('label_current_elo')}:</span>
          <span className="text-lg font-bold text-blue-600">{rawData[rawData.length - 1]?.elo || 'N/A'}</span>
        </div>
        <div className="text-center p-4 bg-gray-50 rounded">
          <span className="text-sm font-semibold text-gray-700">{t('label_elo_range')}:</span>
          <span className="text-lg font-bold text-blue-600">
            {Math.min(...rawData.map((point) => point.elo))} - {Math.max(...rawData.map((point) => point.elo))}
          </span>
        </div>
      </div>
    </div>
  );
};

export default EloChart;

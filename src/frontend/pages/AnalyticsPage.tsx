import React, { useMemo } from 'react';
import {
  Alert, Box, Button, ButtonGroup, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUpOutlined';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import PercentIcon from '@mui/icons-material/PercentOutlined';
import DownloadIcon from '@mui/icons-material/DownloadOutlined';
import ImageIcon from '@mui/icons-material/ImageOutlined';
import { useSearchParams } from 'react-router-dom';
import { useAnalyticsListings, useAnalyticsOverview, useMarketplaces } from '../services/hooks/index.js';
import type { AnalyticsQueryParams, ListingPerformance } from '../state/api/index.js';
import { useAppSelector } from '../state/hooks.js';
import { formatCurrency, formatNumber } from '../utils/formatters.js';
import { Card } from '../components/common/Card.js';
import { StatCard } from '../components/common/StatCard.js';
import { RevenueChart, ViewsChart, ConversionChart } from '../components/charts/index.js';
import { AnalyticsTable } from '../components/tables/index.js';

export type AnalyticsPreset = '7d' | '30d' | '90d' | 'ytd' | 'custom';

function isoDay(date: Date): string { return date.toISOString().slice(0, 10); }

export function analyticsRangeForPreset(preset: Exclude<AnalyticsPreset, 'custom'>, now = new Date()): { from: string; to: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  if (preset === 'ytd') start.setUTCMonth(0, 1);
  else start.setUTCDate(start.getUTCDate() - ({ '7d': 6, '30d': 29, '90d': 89 }[preset]));
  return { from: isoDay(start), to: isoDay(end) };
}

export function analyticsCsv(rows: ListingPerformance[]): string {
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['Listing', 'Product', 'Marketplace', 'Revenue', 'Profit', 'Sales', 'Views', 'Conversion'];
  return [header, ...rows.map((row) => [
    row.listingId, row.productName ?? row.productId, row.marketplaceName ?? row.marketplaceId,
    row.revenue, row.profit, row.sales, row.views, row.conversion,
  ])].map((row) => row.map(escape).join(',')).join('\n');
}

export interface AnalyticsDateRangeControlsProps {
  from: string;
  to: string;
  preset?: AnalyticsPreset;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onPresetChange?: (value: AnalyticsPreset) => void;
}

export const AnalyticsDateRangeControls: React.FC<AnalyticsDateRangeControlsProps> = ({
  from, to, preset = 'custom', onFromChange, onToChange, onPresetChange,
}) => (
  <Stack spacing={1}>
    <ButtonGroup size="small" aria-label="Analytics date range presets">
      {(['7d', '30d', '90d', 'ytd'] as const).map((value) => (
        <Button key={value} variant={preset === value ? 'contained' : 'outlined'} onClick={() => onPresetChange?.(value)}>
          {value.toUpperCase()}
        </Button>
      ))}
    </ButtonGroup>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="stretch">
      <Stack spacing={0.5} sx={{ minWidth: 160 }}>
        <Typography component="label" variant="caption" color="text.secondary" htmlFor="analytics-from">From</Typography>
        <TextField id="analytics-from" size="small" type="date" value={from}
          onChange={(event) => onFromChange(event.target.value)} inputProps={{ 'aria-label': 'From date' }} />
      </Stack>
      <Stack spacing={0.5} sx={{ minWidth: 160 }}>
        <Typography component="label" variant="caption" color="text.secondary" htmlFor="analytics-to">To</Typography>
        <TextField id="analytics-to" size="small" type="date" value={to}
          onChange={(event) => onToChange(event.target.value)} inputProps={{ 'aria-label': 'To date' }} />
      </Stack>
    </Stack>
  </Stack>
);

const AnalyticsPage: React.FC = () => {
  const currency = useAppSelector((state) => state.workspace.currency);
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultRange = useMemo(() => analyticsRangeForPreset('30d'), []);
  const preset = (searchParams.get('range') as AnalyticsPreset | null) ?? '30d';
  const from = searchParams.get('from') ?? defaultRange.from;
  const to = searchParams.get('to') ?? defaultRange.to;
  const marketplaceId = searchParams.get('marketplace') ?? '';
  const marketplaces = useMarketplaces();

  const updateQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const selectPreset = (value: AnalyticsPreset) => {
    if (value === 'custom') return updateQuery({ range: value });
    const range = analyticsRangeForPreset(value);
    updateQuery({ range: value, from: range.from, to: range.to });
  };
  const params = useMemo<AnalyticsQueryParams>(() => ({
    from, to, marketplaceId: marketplaceId || undefined,
    interval: preset === '90d' || preset === 'ytd' ? 'week' : 'day',
  }), [from, to, marketplaceId, preset]);
  const overview = useAnalyticsOverview(params);
  const listings = useAnalyticsListings(params);
  const ov = overview.data;
  const pct = (current?: number, previous?: number) =>
    typeof current === 'number' && typeof previous === 'number' && previous !== 0
      ? ((current - previous) / previous) * 100 : undefined;
  const rows: ListingPerformance[] = listings.data ?? [];
  const best = rows.slice(0, 5);
  const worst = [...rows].sort((a, b) => a.revenue - b.revenue || a.views - b.views).slice(0, 5);
  const marketplaceSummary = useMemo(() => {
    const totals = new Map<string, { name: string; revenue: number; profit: number; views: number }>();
    for (const row of rows) {
      const key = row.marketplaceId;
      const total = totals.get(key) ?? { name: row.marketplaceName ?? key, revenue: 0, profit: 0, views: 0 };
      total.revenue += row.revenue; total.profit += row.profit; total.views += row.views; totals.set(key, total);
    }
    return [...totals.values()].sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  const downloadCsv = () => {
    const url = URL.createObjectURL(new Blob([analyticsCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `analytics-${from}-${to}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 2.5 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Button startIcon={<DownloadIcon />} variant="outlined" disabled={!rows.length} onClick={downloadCsv}>Export CSV</Button>
          <Button startIcon={<ImageIcon />} variant="outlined" disabled title="PNG export is staged until chart canvas rendering is available">Export PNG</Button>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="analytics-marketplace-label">Marketplace</InputLabel>
            <Select labelId="analytics-marketplace-label" label="Marketplace" value={marketplaceId}
              onChange={(event) => updateQuery({ marketplace: String(event.target.value) })}>
              <MenuItem value="">All marketplaces</MenuItem>
              {(marketplaces.data ?? []).map((marketplace) => <MenuItem key={marketplace.id} value={marketplace.id}>{marketplace.name}</MenuItem>)}
            </Select>
          </FormControl>
          <AnalyticsDateRangeControls from={from} to={to} preset={preset}
            onPresetChange={selectPreset}
            onFromChange={(value) => updateQuery({ from: value, range: 'custom' })}
            onToChange={(value) => updateQuery({ to: value, range: 'custom' })} />
        </Stack>
      </Stack>

      {(overview.isError || listings.isError) && <Alert severity="error" sx={{ mb: 2 }}>Analytics could not be loaded for the selected range.</Alert>}
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' }, mb: 2.5 }}>
        <StatCard label="Revenue" value={formatCurrency(ov?.revenue, currency)} deltaPct={pct(ov?.revenue, ov?.previous?.revenue)} icon={<PaidIcon fontSize="small" />} loading={overview.isLoading} />
        <StatCard label="Profit" value={formatCurrency(ov?.profit, currency)} deltaPct={pct(ov?.profit, ov?.previous?.profit)} icon={<TrendingUpIcon fontSize="small" />} loading={overview.isLoading} />
        <StatCard label="Total views" value={formatNumber(ov?.totalViews)} deltaPct={pct(ov?.totalViews, ov?.previous?.totalViews)} icon={<VisibilityIcon fontSize="small" />} loading={overview.isLoading} />
        <StatCard label="Avg conversion" value={`${formatNumber(ov?.conversion)}%`} deltaPct={pct(ov?.conversion, ov?.previous?.conversion)} icon={<PercentIcon fontSize="small" />} loading={overview.isLoading} />
      </Box>

      <Card title="Revenue & profit" subtitle="Canonical sale events over the selected period" sx={{ mb: 2.5 }}>
        <Typography variant="caption" color="text.secondary" role="status">
          {ov ? `${formatCurrency(ov.revenue, currency)} revenue, ${formatCurrency(ov.profit, currency)} profit, ${formatNumber(ov.totalViews)} views.` : 'Loading revenue and profit summary.'}
        </Typography>
        <RevenueChart params={params} height={320} />
      </Card>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, mb: 2.5 }}>
        <Card title="Marketplace comparison">
          {!marketplaceSummary.length ? <Typography color="text.secondary">No marketplace events in this range.</Typography> : marketplaceSummary.map((item) => (
            <Stack key={item.name} direction="row" justifyContent="space-between" sx={{ py: 0.75 }}>
              <Typography>{item.name}</Typography><Typography>{formatCurrency(item.revenue, currency)} · {formatNumber(item.views)} views</Typography>
            </Stack>
          ))}
        </Card>
        <Card title="Views and conversion"><ViewsChart params={params} /><ConversionChart params={params} /></Card>
      </Box>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, mb: 2.5 }}>
        <Card title="Best listings"><Typography variant="body2">{best.length ? best.map((row) => row.productName ?? row.listingId).join(' · ') : 'Insufficient sales data for this range.'}</Typography></Card>
        <Card title="Needs attention"><Typography variant="body2">{worst.length ? worst.map((row) => row.productName ?? row.listingId).join(' · ') : 'Insufficient sales data for this range.'}</Typography></Card>
      </Box>

      <Card title="Listing performance" disablePadding>
        <AnalyticsTable metrics={listings.data} loading={listings.isLoading} error={listings.isError ? listings.error : undefined} onRetry={listings.refetch} currency={currency} />
      </Card>
    </Box>
  );
};

export default AnalyticsPage;

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CHART_EMPTY_HEIGHT, ChartState, resolveChartHeight } from './chartShell';

describe('chartShell', () => {
  it('keeps configured height when there is data', () => {
    expect(resolveChartHeight(320, false)).toBe(320);
  });

  it('shrinks empty chart rows to compact height', () => {
    expect(resolveChartHeight(320, true)).toBe(CHART_EMPTY_HEIGHT);
    expect(resolveChartHeight(640, true)).toBe(CHART_EMPTY_HEIGHT);
  });

  it('does not shrink below requested height for already small charts', () => {
    expect(resolveChartHeight(160, true)).toBe(160);
  });

  it('wires compact height only into the rendered empty state', () => {
    const empty = renderToStaticMarkup(
      <ChartState isEmpty height={320} emptyTitle="No reportable data"><span>chart</span></ChartState>,
    );
    const populated = renderToStaticMarkup(
      <ChartState height={320}><span>chart data</span></ChartState>,
    );

    expect(empty).toContain('height:160px');
    expect(empty).toContain('No reportable data');
    expect(populated).toContain('height:320px');
    expect(populated).toContain('chart data');
  });
});

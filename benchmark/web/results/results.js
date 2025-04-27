import { coordinator, vg } from '../setup.js';

export default async function(el) {
  const table = 'results';
  // load data
  try {
    await coordinator.exec(`
      DROP TABLE IF EXISTS ${table};
      DROP TABLE IF EXISTS update;
      DROP TABLE IF EXISTS build;
      DROP TABLE IF EXISTS publisher;
      DROP TABLE IF EXISTS pub_metrics;
      DROP TABLE IF EXISTS pub_breakdown;
      
      CREATE TABLE ${table} AS SELECT * FROM '${location.origin}/results/results.parquet';
      CREATE TABLE update AS SELECT * FROM ${table} WHERE stage = 'update';
      CREATE TABLE build AS SELECT * FROM ${table} WHERE stage = 'create';
      CREATE TABLE publisher AS SELECT * FROM '${location.origin}/results/publisher-benchmark-results.json';
      
      -- pub_metrics: add numeric size, TTR, TTA
      CREATE TABLE pub_metrics AS
        SELECT *,
          CAST(REPLACE(dataSize, 'E', 'e') AS DOUBLE) AS size,
          networkTime + loadTime AS TTR,
          networkTime + loadTime + hydrationTime + activationTime AS TTA
        FROM publisher;
      
      -- pub_breakdown: long format for stacking
      CREATE TABLE pub_breakdown AS
        SELECT spec, optimization, size, 'Network' AS component, networkTime AS value FROM pub_metrics
        UNION ALL
        SELECT spec, optimization, size, 'Render' AS component, loadTime AS value FROM pub_metrics
        UNION ALL
        SELECT spec, optimization, size, 'Activate' AS component, activationTime + hydrationTime AS value FROM pub_metrics;
      
      -- For cost-benefit: baseline TTR for each spec/size
      DROP TABLE IF EXISTS pub_baseline;
      CREATE TABLE pub_baseline AS
        SELECT spec, size, TTR AS baseline_TTR, TTA AS baseline_TTA FROM pub_metrics WHERE optimization = 'none';
      
      DROP TABLE IF EXISTS pub_costbenefit;
      CREATE TABLE pub_costbenefit AS
        SELECT m.*, b.baseline_TTR, b.baseline_TTA,
          b.baseline_TTR - m.TTR AS TTR_saving,
          b.baseline_TTA - m.TTA AS TTA_saving
        FROM pub_metrics m
        LEFT JOIN pub_baseline b
        ON m.spec = b.spec AND m.size = b.size;
    `);
  } catch (error) {
    console.error('Error loading data:', error);
    el.innerHTML = `<div class="error">Error loading data: ${error.message}</div>`;
    return;
  }

  function tickFormat(v) {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    return abs < 1e3 ? v
      : abs < 1e6 ? sign + (abs / 1e3) + 'k'
      : abs < 1e9 ? sign + (abs / 1e6) + 'M'
      : sign + (abs / 1e9) + 'B';
  }

  const labels = [
    { fx: 'airlines', text: 'Airlines' },
    { fx: 'property', text: 'Property' },
    { fx: 'flights', text: 'Flights' },
    { fx: 'gaia', text: 'Gaia' },
    { fx: 'taxis', text: 'Taxis' }
  ];

  const colorDomain = ['wasm', 'node', 'unopt', 'VegaPlus', 'vegaFusion'];
  const colorLabels = {
    wasm: 'Mosaic WASM',
    node: 'Mosaic Local',
    unopt: 'Unoptimized Mosaic Local',
    VegaPlus: 'VegaPlus',
    vegaFusion: 'VegaFusion'
  };

  const optimizationOrder = ['none', 'minimal', 'more', 'most'];
  const componentColorDomain = ['Network', 'Render', 'Activate'];
  const componentColorLabels = {
    Network: 'Network',
    Render: 'Render',
    Activate: 'Activate'
  };

  function plot(name, title, threshold, minFps) {
    return vg.plot(
      vg.name(name),
      vg.frame(),
      vg.text(labels, { fx: 'fx', text: 'text', frameAnchor: 'top', dy: 5 }),
      vg.ruleY([threshold], { stroke: '#ccc', strokeDasharray: '3,3' }),
      minFps ? [
        vg.ruleY([1000 / minFps], { stroke: '#858585', strokeDasharray: '4,5' }),
        vg.text([{ fx: 'taxis', text: `${minFps}fps` }], { fx: 'fx', text: 'text', frameAnchor: 'right', dx: 30, dy: 12, fill: '#858585' }),
        vg.marginRight(30),
      ] : [],
      vg.areaY(vg.from(name, { optimize: false }), {
        fx: 'name',
        x: 'size',
        y1: vg.quantile('time', 0.25),
        y2: vg.quantile('time', 0.75),
        fill: 'condition',
        fillOpacity: 0.15,
        curve: 'monotone-x'
      }),
      vg.lineY(vg.from(name, { optimize: false }), {
        fx: 'name',
        x: 'size',
        y: vg.median('time'),
        strokeLinecap: 'butt',
        stroke: 'condition',
        curve: 'monotone-x'
      }),
      vg.fxDomain(labels.map(l => l.fx)),
      vg.fxLabel(title),
      vg.fxTickFormat(() => ''),
      vg.fxPadding(0.1),
      vg.xScale('log'),
      vg.xInset(5),
      vg.xTicks(4),
      vg.xTickFormat(tickFormat),
      vg.xLabel(null),
      vg.yScale('log'),
      vg.yLabel('Time (ms)'),
      vg.yLabelAnchor('center'),
      vg.yDomain([0.1, 1e5]),
      vg.yTicks(5),
      vg.yTickFormat(tickFormat),
      vg.colorDomain(colorDomain),
      vg.colorTickFormat(v => colorLabels[v]),
      vg.width(900),
      vg.height(130),
      vg.marginTop(18),
      vg.marginLeft(45),
      vg.marginBottom(20)
    );
  }

  function plotTTRScaling() {
    return vg.plot(
      vg.name('TTR-scaling'),
      vg.frame(),
      vg.lineY(vg.from('pub_metrics'), {
        fx: 'spec',
        x: 'size',
        y: 'TTR',
        stroke: 'optimization',
        curve: 'monotone-x',
        strokeWidth: 2
      }),
      vg.dot(vg.from('pub_metrics'), {
        fx: 'spec',
        x: 'size',
        y: 'TTR',
        fill: 'optimization',
        r: 2.5
      }),
      vg.fxLabel('Latencies of Visualization Specifications'),
      vg.fxDomain(labels.map(l => l.fx)), // TODO: why does this not work?
      vg.fxTickPadding(-12),
      vg.fxPadding(0.1),
      vg.xScale('log'),
      vg.xDomain([1e4, 1e7]),
      vg.xTicks(4),
      vg.xInset(5),
      vg.xTickFormat(tickFormat),
      vg.xLabel(null),
      // vg.yScale('sqrt'),
      vg.yLabel('Time to Render (ms)'),
      vg.yLabelAnchor('center'),
      vg.yTicks(5),
      vg.yTickFormat(tickFormat),
      vg.yGrid(true),
      vg.yDomain([500, 8e3]),
      vg.colorDomain(optimizationOrder),
      vg.width(900),
      vg.height(160),
      vg.marginTop(18),
      vg.marginLeft(45),
    );
  }

  function plotTTAScaling() {
    return vg.plot(
      vg.name('TTA-scaling'),
      vg.frame(),
      vg.lineY(vg.from('pub_metrics'), {
        fx: 'spec',
        x: 'size',
        y: 'TTA',
        stroke: 'optimization',
        curve: 'monotone-x',
        strokeWidth: 2
      }),
      vg.dot(vg.from('pub_metrics'), {
        fx: 'spec',
        x: 'size',
        y: 'TTA',
        fill: 'optimization',
        r: 2.5
      }),
      vg.fxDomain(labels.map(l => l.fx)),
      vg.fxLabel(''),
      vg.fxTickPadding(-12),
      vg.fxPadding(0.1),
      vg.xScale('log'),
      vg.xDomain([1e4, 1e7]),
      vg.xTicks(4),
      vg.xInset(5),
      vg.xTickFormat(tickFormat),
      vg.xLabel('Data Size (Rows)'),
      // vg.yScale('sqrt'),
      vg.yLabel('Time to Activate (ms)'),
      vg.yLabelAnchor('center'),
      vg.yTicks(5),
      vg.yTickFormat(tickFormat),
      vg.yGrid(true),
      vg.yDomain([500, 1e4]),
      vg.colorDomain(optimizationOrder),
      vg.width(900),
      vg.height(160),
      vg.marginLeft(45),
      vg.marginTop(18),
      vg.marginBottom(32)
    );
  }

  function plotTTRAllSpecs() {
    return vg.plot(
      vg.name('TTR-all-specs'),
      vg.frame(),
      vg.lineY(vg.from('pub_metrics'), {
        x: 'size',
        y: vg.avg('TTR'),
        stroke: 'optimization',
        curve: 'monotone-x',
        strokeWidth: 2
      }),
      vg.xScale('log'),
      vg.xDomain([1e4, 1e7]),
      vg.xTicks(4),
      vg.xInset(5),
      vg.xTickFormat(tickFormat),
      vg.xLabel('Data Size (Rows)'),
      vg.yScale('log'),
      vg.yLabel('Time to Render (ms)'),
      vg.yLabelAnchor('center'),
      vg.yTicks(5),
      vg.yTickFormat(tickFormat),
      vg.yGrid(true),
      vg.yDomain([500, 4e3]),
      vg.colorDomain(optimizationOrder),
      vg.width(450),
      vg.height(450),
      vg.marginTop(18),
      vg.marginLeft(45),
      vg.marginBottom(32)
    );
  }

  function plotTTAAllSpecs() {
    return vg.plot(
      vg.name('TTA-all-specs'),
      vg.frame(),
      vg.lineY(vg.from('pub_metrics'), {
        x: 'size',
        y: vg.avg('TTA'),
        stroke: 'optimization',
        curve: 'monotone-x',
        strokeWidth: 2
      }),
      vg.xScale('log'),
      vg.xDomain([1e4, 1e7]),
      vg.xTicks(4),
      vg.xInset(5),
      vg.xTickFormat(tickFormat),
      vg.xLabel('Data Size (Rows)'),
      vg.yScale('log'),
      vg.yLabel('Time to Activate (ms)'),
      vg.yLabelAnchor('center'),
      vg.yTicks(5),
      vg.yTickFormat(tickFormat),
      vg.yGrid(true),
      vg.yDomain([1000, 6e3]),
      vg.colorDomain(optimizationOrder),
      vg.width(450),
      vg.height(450),
      vg.marginTop(18),
      vg.marginLeft(45),
      vg.marginBottom(32)
    );
  }

  function plotComponentBreakdown() {
    return vg.plot(
      vg.name('component-breakdown'),
      vg.frame(),
      vg.barY(vg.from('pub_breakdown', { filter: 'size == 1e7' }), {
        fx: 'spec',
        x: 'optimization',
        y: 'value',
        fill: 'component',
        fillOpacity: 0.85,
        stack: true,
        width: 28
      }),
      vg.fxLabel('Latency Component Breakdown at 1e7 Rows'),
      vg.fxDomain(labels.map(l => l.fx)),
      vg.fxTickPadding(-12),
      vg.fxPadding(0.1),
      vg.xLabel(null),
      vg.xDomain(optimizationOrder),
      vg.yLabel('Latency (ms)'),
      vg.yLabelAnchor('center'),
      vg.yTicks(5),
      vg.yTickFormat(tickFormat),
      vg.yDomain([0, 1.5e4]),
      vg.colorDomain(componentColorDomain),
      vg.colorTickFormat(v => componentColorLabels[v]),
      vg.width(900),
      vg.height(180),
      vg.marginTop(18),
      vg.marginLeft(45),
      vg.marginBottom(20)
    );
  }

  function plotCostBenefitScatter() {
    return vg.plot(
      vg.name('cost-benefit'),
      vg.frame(),
      vg.dot(vg.from('pub_costbenefit'), {
        x: vg.median('TTR_saving'),
        y: vg.median('TTA_saving'),
        fill: 'optimization',
        symbol: 'size',
        fx: 'spec',
        r: 5,
      }),
      vg.fxLabel(null),
      vg.ruleY([0], { stroke: '#aaa', strokeDasharray: '4,4', strokeWidth: 1.5 }),
      vg.ruleX([0], { stroke: '#aaa', strokeDasharray: '4,4', strokeWidth: 1.5 }),
      vg.xScale('symlog'),
      vg.xLabel('TTR Saving (ms)'),
      vg.xDomain([-1e4, 1e4]),
      vg.xTicks([-1e4, -1e3, -1e2, -1e1, 0, 1e1, 1e2, 1e3, 1e4]),
      vg.xTickFormat(tickFormat),
      vg.yLabel('TTA Saving (ms)'),
      vg.yLabelAnchor('center'),
      vg.yTicks([-1e4, -1e3, -1e2, -1e1, 0, 1e1, 1e2, 1e3, 1e4]),
      vg.yTickFormat(tickFormat),
      vg.yDomain([-1e4, 1e4]),
      vg.yScale('symlog'),
      vg.colorDomain(optimizationOrder),
      vg.width(900),
      vg.height(220),
      vg.marginTop(18),
      vg.marginLeft(45),
      vg.marginBottom(32)
    );
  }

  const view = vg.vconcat(
    plot('build', 'Materialized View Creation', 1000),
    vg.vspace(10),
    plot('update', 'Update Queries', 100, 30),
    vg.hconcat(
      vg.hspace(45),
      vg.colorLegend({ for: 'update' })
    ),
    vg.vspace(30),
    vg.vconcat(
      plotTTRScaling(),
      plotTTAScaling(),
      vg.hconcat(
        vg.hspace(45),
        vg.colorLegend({ for: 'TTA-scaling' })
      )
    ),
    vg.vspace(20),
    vg.vconcat(
      plotComponentBreakdown(),
      vg.hconcat(
        vg.hspace(45),
        vg.colorLegend({ for: 'component-breakdown' })
      )
    ),
    vg.vspace(20),
    vg.vconcat(
      plotCostBenefitScatter(),
      vg.hconcat(
        vg.hspace(45),
        vg.colorLegend({ for: 'cost-benefit' }),
        vg.symbolLegend({ for: 'cost-benefit' }),
      )
    ),
    vg.vspace(10),
    vg.vconcat(
      vg.hconcat(
        plotTTRAllSpecs(),
        plotTTAAllSpecs(),
      ),
      vg.hconcat(
        vg.hspace(45),
        vg.colorLegend({ for: 'TTA-all-specs' })
      ),
    )
  );

  el.replaceChildren(view);
}

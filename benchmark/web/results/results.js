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
      DROP TABLE IF EXISTS pub_mean;
      DROP TABLE IF EXISTS pub_baseline;
      DROP TABLE IF EXISTS pub_pct;
      
      CREATE TABLE ${table} AS SELECT * FROM '${location.origin}/results/results.parquet';
      CREATE TABLE update AS SELECT * FROM ${table} WHERE stage = 'update';
      CREATE TABLE build AS SELECT * FROM ${table} WHERE stage = 'create';
      CREATE TABLE publisher_raw AS SELECT * FROM read_json_auto('${location.origin}/results/publisher-benchmark-results.json');
      
      CREATE VIEW pub_metrics AS
        SELECT
          spec,
          optimization,
          CAST(REPLACE(dataSize,'E','e') AS DOUBLE) AS size,
          runNumber,
          networkTime,
          loadTime,
          hydrationTime,
          activationTime,
          networkTime + loadTime AS TTR,
          networkTime + loadTime + hydrationTime + activationTime AS TTA,
          packageSize / 1e6 AS MB
        FROM publisher_raw;

      CREATE VIEW pub_metrics_1e7 AS
        SELECT * FROM pub_metrics WHERE size = 1e7;
      
      CREATE TABLE pub_mean AS
        SELECT
          spec,
          size,
          optimization,
          AVG(TTR) AS TTR,
          AVG(TTA) AS TTA,
          STDDEV(TTR) AS sdTTR,
          STDDEV(TTA) AS sdTTA
        FROM pub_metrics
        GROUP BY spec, size, optimization;
      
      CREATE TABLE pub_baseline AS
        SELECT m.spec, m.size, m.optimization, m.TTR, m.TTA
        FROM pub_mean m
        WHERE m.optimization = 'none';
      
      CREATE TABLE pub_pct AS
        SELECT
          m.spec,
          m.size,
          m.optimization,
          100 * (b.TTR - m.TTR) / b.TTR AS pct_gain_TTR,
          100 * (b.TTA - m.TTA) / b.TTA AS pct_gain_TTA
        FROM pub_mean m
        JOIN pub_baseline b ON m.spec = b.spec AND m.size = b.size
        WHERE m.optimization != 'none';
      
      CREATE TABLE pub_breakdown AS
        SELECT optimization, 'network' AS part, AVG(networkTime) AS ms FROM pub_metrics WHERE spec='airlines' AND size=1e7 GROUP BY optimization
        UNION ALL
        SELECT optimization, 'load',     AVG(loadTime)     FROM pub_metrics WHERE spec='airlines' AND size=1e7 GROUP BY optimization
        UNION ALL
        SELECT optimization, 'hydration',AVG(hydrationTime) FROM pub_metrics WHERE spec='airlines' AND size=1e7 GROUP BY optimization
        UNION ALL
        SELECT optimization, 'activation',AVG(activationTime) FROM pub_metrics WHERE spec='airlines' AND size=1e7 GROUP BY optimization;
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

  // --- Publisher Benchmark Visualizations ---
  const publisherSpecs = [
    { fx: 'airlines', text: 'Airlines' },
    { fx: 'property', text: 'Property' },
    { fx: 'flights', text: 'Flights' },
    { fx: 'gaia', text: 'Gaia' },
    { fx: 'taxis', text: 'Taxis' }
  ];
  const publisherOptOrder = ['none', 'minimal', 'more', 'most'];
  const publisherColorDomain = publisherOptOrder;
  const publisherColorLabels = {
    none: 'No Optimization',
    minimal: 'Minimal',
    more: 'More',
    most: 'Most'
  };
  const breakdownParts = [
    { part: 'network', text: 'Network' },
    { part: 'load', text: 'Render' },
    { part: 'hydration', text: 'Hydration' },
    { part: 'activation', text: 'Activation' }
  ];

  function plotTTRvsVolume() {
    return vg.plot(
      vg.name('pub_mean_TTR'),
      vg.frame(),
      vg.text(publisherSpecs, { fx: 'fx', text: 'text', frameAnchor: 'top', dy: 5 }),
      vg.areaY(vg.from('pub_metrics', { optimize: false }), {
        fx: 'spec',
        x: 'size',
        y1: vg.quantile('TTR', 0.25),
        y2: vg.quantile('TTR', 0.75),
        fill: 'optimization',
        fillOpacity: 0.15,
        curve: 'monotone-x'
      }),
      vg.lineY(vg.from('pub_metrics', { optimize: false }), {
        fx: 'spec',
        x: 'size',
        y: vg.median('TTR'),
        stroke: 'optimization',
        curve: 'monotone-x'
      }),
      vg.fxDomain(publisherSpecs.map(l => l.fx)),
      vg.fxLabel('Latency Across Visualization Specifications and Data Volumes'),
      vg.fxTickFormat(() => ''),
      vg.fxPadding(0.1),
      vg.xScale('log'),
      vg.xInset(5),
      vg.xTicks(4),
      vg.xTickFormat(tickFormat),
      vg.xLabel(null),
      vg.yScale('log'),
      vg.yLabel('TTR (ms)'),
      vg.yLabelAnchor('center'),
      vg.yDomain([500, 1e4]),
      vg.yTicks(8),
      vg.yTickFormat(tickFormat),
      vg.colorDomain(publisherColorDomain),
      vg.colorTickFormat(v => publisherColorLabels[v]),
      vg.width(900),
      vg.height(160),
      vg.marginTop(18),
      vg.marginLeft(45),
      vg.marginBottom(20)
    );
  }

  function plotTTAvsVolume() {
    return vg.plot(
      vg.name('pub_mean_TTA'),
      vg.frame(),
      vg.text(publisherSpecs, { fx: 'fx', text: 'text', frameAnchor: 'top', dy: 5 }),
      vg.areaY(vg.from('pub_metrics', { optimize: false }), {
        fx: 'spec',
        x: 'size',
        y1: vg.quantile('TTA', 0.25),
        y2: vg.quantile('TTA', 0.75),
        fill: 'optimization',
        fillOpacity: 0.15,
        curve: 'monotone-x'
      }),
      vg.lineY(vg.from('pub_metrics', { optimize: false }), {
        fx: 'spec',
        x: 'size',
        y: vg.median('TTA'),
        stroke: 'optimization',
        curve: 'monotone-x'
      }),
      vg.fxDomain(publisherSpecs.map(l => l.fx)),
      vg.fxLabel(null),
      vg.fxTickFormat(() => ''),
      vg.fxPadding(0.1),
      vg.xScale('log'),
      vg.xInset(5),
      vg.xTicks(4),
      vg.xTickFormat(tickFormat),
      // vg.xLabel('Data Volume (rows)'),
      vg.xLabel(null),
      vg.xLabelOffset(30),
      vg.yScale('log'),
      vg.yLabel('TTA (ms)'),
      vg.yLabelAnchor('center'),
      vg.yDomain([500, 1e4]),
      vg.yTicks(8),
      vg.yTickFormat(tickFormat),
      vg.colorDomain(publisherColorDomain),
      vg.colorTickFormat(v => publisherColorLabels[v]),
      vg.width(900),
      vg.height(180),
      vg.marginTop(5),
      vg.marginLeft(45),
      // vg.marginBottom(40)
    );
  }

  function plotBreakdown() {
    return vg.plot(
      vg.name('pub_breakdown'),
      vg.frame(),
      vg.barY(vg.from('pub_breakdown', { optimize: false }), {
        x: 'optimization',
        y: 'ms',
        fill: 'part',
      }),
      vg.xLabel('Optimization Level'),
      vg.xLabelOffset(30),
      vg.xDomain(publisherOptOrder),
      vg.yLabel('Average Latency (ms)'),
      vg.yLabelAnchor('center'),
      vg.yDomain([0, 4e3]),
      vg.yTickFormat(tickFormat),
      vg.colorDomain(breakdownParts.map(p => p.part)),
      vg.colorTickFormat(v => breakdownParts.find(p => p.part === v)?.text || v),
      vg.width(450),
      vg.height(450),
      vg.marginTop(18),
      vg.marginLeft(45),
      vg.marginBottom(45)
    );
  }

  function plotPackageSize() {
    return vg.plot(
      vg.name('pub_metrics_1e7'),
      vg.frame(),
      vg.barY(vg.from('pub_metrics_1e7', { optimize: false }), {
        x: 'optimization',
        y: vg.median('MB'),
        fill: 'spec',
      }),
      vg.xLabel('Optimization Level'),
      vg.yLabel('Storage Cost (MB)'),
      vg.yLabelAnchor('center'),
      vg.yDomain([0, 1e3]),
      vg.yTickFormat(tickFormat),
      vg.xDomain(publisherOptOrder),
      vg.width(450),
      vg.height(450),
      vg.marginTop(18),
      vg.marginLeft(45),
      vg.marginBottom(45)
    );
  }

  // --- Compose all publisher plots ---
  const publisherView = vg.vconcat(
    vg.vconcat(
      plotTTRvsVolume(),
      // vg.hconcat(
      //   vg.hspace(100),
      //   vg.colorLegend({ for: 'pub_mean_TTR' })
      // ),
      vg.vspace(10),
      plotTTAvsVolume(),
      vg.hconcat(
        vg.hspace(40),
        vg.colorLegend({ for: 'pub_mean_TTA' })
      )
    ),
    vg.vspace(10),
    vg.hconcat(
    vg.vconcat(
      plotBreakdown(),
      vg.hconcat(
        vg.hspace(100),
        vg.colorLegend({ for: 'pub_breakdown'}),
      )
    ),
    vg.vconcat(
      plotPackageSize(),
      vg.hconcat(
        vg.hspace(100),
          vg.colorLegend({ for: 'pub_metrics_1e7'}),
        )
      )
    )
  );

  // --- Compose all plots ---
  const view = vg.vconcat(
    plot('build', 'Materialized View Creation', 1000),
    vg.vspace(10),
    plot('update', 'Update Queries', 100, 30),
    vg.hconcat(
      vg.hspace(45),
      vg.colorLegend({ for: 'update' })
    ),
    vg.vspace(30),
    publisherView
  );

  el.replaceChildren(view);
}

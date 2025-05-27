// Script to extract headline numbers for paper from publisher-benchmark-results.json
// Usage: node script.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE = path.join(__dirname, '../../results/publisher-benchmark-results.json');
const DATA = JSON.parse(fs.readFileSync(FILE, 'utf-8'));

const OPT_LEVELS = ['none', 'minimal', 'more', 'most'];
const SPECS = ['airlines', 'property', 'flights', 'gaia', 'taxis'];
const SIZE = '1E7'; // Focus on largest dataset for headline numbers

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
}
function mb(bytes) {
  return bytes / 1e6;
}

function summarize() {
  console.log('==== Publish-Time Optimization Benchmark Summary (ALL DATA SIZES) ====\n');
  // Per-spec summary (all data sizes)
  for (const spec of SPECS) {
    console.log(`Spec: ${spec}`);
    let baseline = null;
    for (const opt of OPT_LEVELS) {
      const runs = DATA.filter(d => d.spec === spec && d.optimization === opt); // all data sizes
      if (!runs.length) continue;
      const TTRs = runs.map(d => d.networkTime + d.loadTime);
      const TTAs = runs.map(d => d.networkTime + d.loadTime + d.hydrationTime + d.activationTime);
      const sizes = runs.map(d => d.packageSize);
      const TTR = mean(TTRs);
      const TTA = mean(TTAs);
      const sizeMB = mean(sizes.map(mb));
      if (opt === 'none') baseline = { TTR, TTA };
      let pctTTR = baseline ? 100 * (baseline.TTR - TTR) / baseline.TTR : 0;
      let pctTTA = baseline ? 100 * (baseline.TTA - TTA) / baseline.TTA : 0;
      console.log(`  Optimization: ${opt.padEnd(8)} | TTR: ${TTR.toFixed(0)} ms | TTA: ${TTA.toFixed(0)} ms | Storage: ${sizeMB.toFixed(1)} MB` +
        (opt !== 'none' ? ` | ΔTTR: ${pctTTR.toFixed(1)}% | ΔTTA: ${pctTTA.toFixed(1)}%` : ''));
    }
    console.log('');
  }

  // Average across all specs (all data sizes)
  console.log('==== AVERAGE ACROSS ALL SPECS (ALL DATA SIZES) ====\n');
  let baselineAvg = null;
  for (const opt of OPT_LEVELS) {
    let allTTRs = [], allTTAs = [], allSizes = [];
    for (const spec of SPECS) {
      const runs = DATA.filter(d => d.spec === spec && d.optimization === opt); // all data sizes
      if (!runs.length) continue;
      allTTRs.push(...runs.map(d => d.networkTime + d.loadTime));
      allTTAs.push(...runs.map(d => d.networkTime + d.loadTime + d.hydrationTime + d.activationTime));
      allSizes.push(...runs.map(d => d.packageSize));
    }
    if (!allTTRs.length) continue;
    const TTR = mean(allTTRs);
    const TTA = mean(allTTAs);
    const sizeMB = mean(allSizes.map(mb));
    if (opt === 'none') baselineAvg = { TTR, TTA };
    let pctTTR = baselineAvg ? 100 * (baselineAvg.TTR - TTR) / baselineAvg.TTR : 0;
    let pctTTA = baselineAvg ? 100 * (baselineAvg.TTA - TTA) / baselineAvg.TTA : 0;
    console.log(`  Optimization: ${opt.padEnd(8)} | TTR: ${TTR.toFixed(0)} ms | TTA: ${TTA.toFixed(0)} ms | Storage: ${sizeMB.toFixed(1)} MB` +
      (opt !== 'none' ? ` | ΔTTR: ${pctTTR.toFixed(1)}% | ΔTTA: ${pctTTA.toFixed(1)}%` : ''));
  }
  console.log('');

  // Markdown table for average across all specs (all data sizes)
  console.log('==== MARKDOWN TABLE: Average Across All Specs (ALL DATA SIZES) ====');
  const tableRows = [];
  // Precompute per-spec means for all metrics
  for (const opt of OPT_LEVELS) {
    let ttrMeans = [], ttaMeans = [], sizeMeans = [], publishMeans = [];
    for (const spec of SPECS) {
      const runs = DATA.filter(d => d.spec === spec && d.optimization === opt);
      if (!runs.length) continue;
      ttrMeans.push(mean(runs.map(d => d.networkTime + d.loadTime)));
      ttaMeans.push(mean(runs.map(d => d.networkTime + d.loadTime + d.hydrationTime + d.activationTime)));
      sizeMeans.push(mean(runs.map(d => mb(d.packageSize))));
      publishMeans.push(mean(runs.map(d => d.publishTime)));
    }
    if (!ttrMeans.length) continue;
    tableRows.push({
      opt,
      TTR: `${mean(ttrMeans).toFixed(0)} \\pm ${stddev(ttrMeans).toFixed(0)}`,
      TTA: `${mean(ttaMeans).toFixed(0)} \\pm ${stddev(ttaMeans).toFixed(0)}`,
      sizeMB: `${mean(sizeMeans).toFixed(1)} \\pm ${stddev(sizeMeans).toFixed(1)}`,
      avgPublishTime: `${mean(publishMeans).toFixed(0)} \\pm ${stddev(publishMeans).toFixed(0)}`
    });
  }
  // Print markdown table
  console.log('\n| Optimization | TTR (ms)         | TTA (ms)         | Storage (MB)      | Publish Time (ms)   |');
  console.log('|--------------|------------------|------------------|-------------------|---------------------|');
  for (const row of tableRows) {
    console.log(`| ${row.opt.padEnd(12)} | ${row.TTR.padStart(16)} | ${row.TTA.padStart(16)} | ${row.sizeMB.padStart(17)} | ${row.avgPublishTime.padStart(19)} |`);
  }
  console.log('');

  // Final markdown table: only percentage reduction in Storage, TTR, TTA for non-none optimizations (all data sizes)
  console.log('==== MARKDOWN TABLE: \\Delta Storage, \\Delta TTR, \\Delta TTA vs. None (PERCENT ± STDDEV, ALL DATA SIZES) ====');
  
  // First compute baseline means per spec
  const baselinePerSpec = {};
  const baselineValues = { TTRs: [], TTAs: [], SCs: [] };
  
  for (const spec of SPECS) {
    const runs = DATA.filter(d => d.spec === spec && d.optimization === 'none');
    if (!runs.length) continue;
    const specTTR = mean(runs.map(d => d.networkTime + d.loadTime));
    const specTTA = mean(runs.map(d => d.networkTime + d.loadTime + d.hydrationTime + d.activationTime));
    const specSC = mean(runs.map(d => mb(d.packageSize)));
    
    baselinePerSpec[spec] = {
      TTR: specTTR,
      TTA: specTTA,
      SC: specSC
    };
    
    baselineValues.TTRs.push(specTTR);
    baselineValues.TTAs.push(specTTA);
    baselineValues.SCs.push(specSC);
  }

  const deltaRows = [];
  
  // Add baseline row using same calculation method as other optimizations
  const baselinePcts = [];
  for (const spec of SPECS) {
    const baseline = baselinePerSpec[spec];
    if (!baseline) continue;
    
    // For baseline, we're comparing baseline to itself, so all percentages should be 0
    baselinePcts.push({
      pctTTR: 100 * (baseline.TTR - baseline.TTR) / baseline.TTR, // Should be 0
      pctTTA: 100 * (baseline.TTA - baseline.TTA) / baseline.TTA, // Should be 0
      pctSC: 100 * (baseline.SC - baseline.SC) / baseline.SC      // Should be 0
    });
  }
  
  // These should all be 0 mean with some stddev
  const baselinePctTTR = mean(baselinePcts.map(p => p.pctTTR));
  const baselinePctTTA = mean(baselinePcts.map(p => p.pctTTA));
  const baselinePctSC = mean(baselinePcts.map(p => p.pctSC));
  const baselineStdTTR = stddev(baselinePcts.map(p => p.pctTTR));
  const baselineStdTTA = stddev(baselinePcts.map(p => p.pctTTA));
  const baselineStdSC = stddev(baselinePcts.map(p => p.pctSC));
  
  deltaRows.push({
    opt: 'none',
    pctSC: `${baselinePctSC.toFixed(1)} \\pm ${baselineStdSC.toFixed(1)}`,
    pctTTR: `${baselinePctTTR.toFixed(1)} \\pm ${baselineStdTTR.toFixed(1)}`,
    pctTTA: `${baselinePctTTA.toFixed(1)} \\pm ${baselineStdTTA.toFixed(1)}`
  });

  // Calculate relative changes for other optimization levels
  for (const opt of OPT_LEVELS.slice(1)) {
    // Collect percentage changes per spec
    const specPcts = [];
    
    for (const spec of SPECS) {
      const baseline = baselinePerSpec[spec];
      if (!baseline) continue;
      
      const runs = DATA.filter(d => d.spec === spec && d.optimization === opt);
      if (!runs.length) continue;
      
      // Calculate means for this optimization level and spec
      const meanTTR = mean(runs.map(d => d.networkTime + d.loadTime));
      const meanTTA = mean(runs.map(d => d.networkTime + d.loadTime + d.hydrationTime + d.activationTime));
      const meanSC = mean(runs.map(d => mb(d.packageSize)));
      
      // Calculate percentage changes for this spec
      specPcts.push({
        pctTTR: 100 * (meanTTR - baseline.TTR) / baseline.TTR,
        pctTTA: 100 * (meanTTA - baseline.TTA) / baseline.TTA,
        pctSC: 100 * (meanSC - baseline.SC) / baseline.SC
      });
    }
    
    // Calculate mean and stddev of the percentage changes across specs
    const pctTTR = mean(specPcts.map(p => p.pctTTR));
    const pctTTA = mean(specPcts.map(p => p.pctTTA));
    const pctSC = mean(specPcts.map(p => p.pctSC));
    const stdTTR = stddev(specPcts.map(p => p.pctTTR));
    const stdTTA = stddev(specPcts.map(p => p.pctTTA));
    const stdSC = stddev(specPcts.map(p => p.pctSC));
    
    deltaRows.push({
      opt,
      pctSC: `${pctSC.toFixed(1)} \\pm ${stdSC.toFixed(1)}`,
      pctTTR: `${pctTTR.toFixed(1)} \\pm ${stdTTR.toFixed(1)}`,
      pctTTA: `${pctTTA.toFixed(1)} \\pm ${stdTTA.toFixed(1)}`
    });
  }
  
  // Print markdown table
  console.log('\n| Optimization | \\Delta Storage (%) | \\Delta TTR (%) | \\Delta TTA (%) |');
  console.log('|--------------|-------------------|----------------|----------------|');
  for (const row of deltaRows) {
    console.log(`| ${row.opt.padEnd(12)} | ${row.pctSC.padStart(17)} | ${row.pctTTR.padStart(14)} | ${row.pctTTA.padStart(14)} |`);
  }
  console.log('\nNote: Values show percentage change ± stddev relative to baseline.');
  console.log('');

  // Calculate average difference between publish time and baseline TTA
  console.log('==== AVERAGE DIFFERENCE BETWEEN PUBLISH TIME AND BASELINE TOTAL TIME TO ACTIVE (ms) ====');
  
  // First collect baseline TTA times per spec
  const baselineTTAs = {};
  for (const spec of SPECS) {
    const baselineRuns = DATA.filter(d => d.spec === spec && d.optimization === 'none');
    if (!baselineRuns.length) continue;
    
    // Calculate baseline TTA (Total Time to Active) for this spec
    baselineTTAs[spec] = mean(baselineRuns.map(d => 
      d.networkTime + d.loadTime + d.hydrationTime + d.activationTime
    ));
  }
  
  // Collect all differences excluding 'none' optimization
  let allOverallDiffs = [];
  
  for (const opt of OPT_LEVELS) {
    if (opt === 'none') continue; // Skip the baseline case
    
    for (const spec of SPECS) {
      if (!baselineTTAs[spec]) continue; // Skip if we don't have baseline for this spec
      const baselineTTA = baselineTTAs[spec];
      
      const runs = DATA.filter(d => d.spec === spec && d.optimization === opt);
      if (!runs.length) continue;
      
      // Calculate difference between publish time and baseline TTA for each run
      const diffs = runs.map(d => d.publishTime - baselineTTA);
      allOverallDiffs.push(...diffs);
    }
  }
  
  // Calculate and display the overall average
  if (allOverallDiffs.length > 0) {
    const overallAvgDiff = mean(allOverallDiffs);
    const overallStdDiff = stddev(allOverallDiffs);
    console.log(`\nOverall average publish time overhead vs baseline TTA: ${overallAvgDiff.toFixed(1)} ± ${overallStdDiff.toFixed(1)} ms`);
  }
  
  console.log('\nNote: Positive values mean publish time is longer than baseline Total Time to Active');
  console.log('');
}

summarize();

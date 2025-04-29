// Variables to track benchmarking state
let abort = false;
const benchmarkResults = [];

// Function to stop ongoing benchmarks
export function stop() {
  abort = true;
}

// Get the YAML content for a specific specification
async function loadYAMLSpec(specName) {
  const specPath = `../specs/yaml/${specName}.yaml`;
  try {
    const spec = await fetch(specPath).then(res => res.text());
    return spec;
  } catch (error) {
    console.error(`Error loading YAML spec: ${error}`);
    return null;
  }
}

// Utility to update LIMIT/limit in YAML
function updateSpecLimit(yaml, newLimit) {
  return yaml
    .replace(/USING SAMPLE\s+\d+(e\d+)?\s+ROWS/gi, `USING SAMPLE ${newLimit} ROWS`)
    .replace(/LIMIT\s+\d+(e\d+)?/gi, `LIMIT ${newLimit}`)
}

// Run a benchmark for a specific specification, optimization level, and data size
async function runBenchmark(specName, optimization, dataSize, updateUI = true) {
  if (specName === 'none') return;
  
  // Load the YAML specification
  let spec = await loadYAMLSpec(specName);
  if (!spec) return;
  
  // Update LIMIT/limit in the YAML
  spec = updateSpecLimit(spec, dataSize);
  
  // Create results table row
  let resultRow;
  if (updateUI) {
    const resultsBody = document.getElementById('results-body');
    resultRow = document.createElement('tr');
    resultRow.innerHTML = `
      <td>${specName}</td>
      <td>${optimization}</td>
      <td>${dataSize}</td>
      <td>Measuring...</td>
      <td>Measuring...</td>
      <td>Measuring...</td>
      <td>Measuring...</td>
      <td>Measuring...</td>
      <td>Measuring...</td>
    `;
    resultsBody.appendChild(resultRow);
  }
  
  try {
    // Call the server endpoint to handle publishing and timing
    const response = await fetch('http://localhost:3001/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        spec,
        specName,
        optimization,
        dataSize
      })
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.statusText}`);
    }
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }
    
    // Process all runs
    result.results.forEach((run) => {
      // Create result object for each run with flattened structure
      const benchmarkResult = {
        spec: specName,
        optimization,
        dataSize,
        runNumber: run.runNumber,
        publishTime: run.publishTime,
        networkTime: run.networkTime,
        loadTime: run.loadTime,
        hydrationTime: run.hydrationTime,
        activationTime: run.activationTime,
        activations: run.activations,
        packageSize: run.packageSize
      };
      
      // Add to results array
      benchmarkResults.push(benchmarkResult);
    });
    
    // Update UI with average values
    if (updateUI && resultRow) {
      const avgResults = {
        publishTime: result.results.reduce((acc, r) => acc + r.publishTime, 0) / result.results.length,
        networkTime: result.results.reduce((acc, r) => acc + r.networkTime, 0) / result.results.length,
        loadTime: result.results.reduce((acc, r) => acc + r.loadTime, 0) / result.results.length,
        hydrationTime: result.results.reduce((acc, r) => acc + r.hydrationTime, 0) / result.results.length,
        activationTime: result.results.reduce((acc, r) => acc + r.activationTime, 0) / result.results.length,
        packageSize: result.results.reduce((acc, r) => acc + r.packageSize, 0) / result.results.length
      };

      resultRow.innerHTML = `
        <td>${specName}</td>
        <td>${optimization}</td>
        <td>${dataSize}</td>
        <td>${Math.round(avgResults.publishTime)}</td>
        <td>${Math.round(avgResults.networkTime)}</td>
        <td>${Math.round(avgResults.loadTime)}</td>
        <td>${Math.round(avgResults.hydrationTime)}</td>
        <td>${Math.round(avgResults.activationTime)}</td>
        <td>${(avgResults.packageSize / 1024 / 1024).toFixed(2)} MB</td>
      `;
    }
    
    return benchmarkResults;
  } catch (error) {
    console.error(`Error running benchmark: ${error}`);
    if (updateUI && resultRow) {
      resultRow.innerHTML = `
        <td>${specName}</td>
        <td>${optimization}</td>
        <td>${dataSize}</td>
        <td colspan="6" class="error">Error: ${error.message}</td>
      `;
    }
    return null;
  }
}

// Function to run all benchmarks (all specs, all optimizations, all data sizes)
async function runAllBenchmarks() {
  const specs = ['airlines', 'flights', 'gaia', 'property', 'taxis'];
  const optimizations = ['none', 'minimal', 'more', 'most'];
  const dataSizes = ['1E4', '1E5', '1E6', '1E7'];
  
  for (const spec of specs) {
    for (const opt of optimizations) {
      for (const dataSize of dataSizes) {
        if (abort) {
          abort = false;
          return;
        }
        await runBenchmark(spec, opt, dataSize);
      }
    }
  }
}

// Function to download benchmark results as JSON
function downloadResults() {
  const resultsJson = JSON.stringify(benchmarkResults, null, 2);
  const blob = new Blob([resultsJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().replace(/[:.]/g, '-');
  a.download = `publisher-benchmark-results-${date}.json`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

// Initialize the UI when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Set up event listeners
  const runButton = document.getElementById('run');
  const stopButton = document.getElementById('stop');
  const runAllButton = document.getElementById('runAll');
  const downloadResultsButton = document.getElementById('downloadResults');
  const specSelector = document.getElementById('spec');
  const optimizationSelector = document.getElementById('optimization');
  const dataSizeSelector = document.getElementById('data-size');
  
  runButton.addEventListener('click', () => {
    const specName = specSelector.value;
    const optimization = optimizationSelector.value;
    const dataSize = dataSizeSelector.value;
    runBenchmark(specName, optimization, dataSize);
  });
  
  stopButton.addEventListener('click', stop);
  
  runAllButton.addEventListener('click', runAllBenchmarks);
  
  downloadResultsButton.addEventListener('click', downloadResults);
});

// Export functions for potential external use
export { runBenchmark, runAllBenchmarks, downloadResults };
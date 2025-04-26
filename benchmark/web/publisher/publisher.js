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

// Run a benchmark for a specific specification and optimization level
async function runBenchmark(specName, optimization, updateUI = true) {
  if (specName === 'none') return;
  
  // Load the YAML specification
  const spec = await loadYAMLSpec(specName);
  if (!spec) return;
  
  // Create results table row
  let resultRow;
  if (updateUI) {
    const resultsBody = document.getElementById('results-body');
    resultRow = document.createElement('tr');
    resultRow.innerHTML = `
      <td>${specName}</td>
      <td>${optimization}</td>
      <td>Measuring...</td>
      <td>Measuring...</td>
      <td>Measuring...</td>
      <td>Measuring...</td>
    `;
    resultsBody.appendChild(resultRow);
  }
  
  try {
    // Clear preview area
    const previewEl = document.getElementById('preview');
    previewEl.innerHTML = `<div class="loading">Running benchmark for ${specName} with ${optimization} optimization...</div>`;
    
    // Call the server endpoint to handle publishing and timing
    const response = await fetch('http://localhost:3001/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        spec,
        specName,
        optimization
      })
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.statusText}`);
    }
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }
    
    // Create result object
    const benchmarkResult = {
      spec: specName,
      optimization,
      publishTime: result.timing.publishTime,
      networkTime: result.timing.networkTime,
      loadTime: result.timing.loadTime,
      activationTime: result.timing.activationTime,
    };
    
    // Add to results array
    benchmarkResults.push(benchmarkResult);
    
    // Update UI
    if (updateUI && resultRow) {
      resultRow.innerHTML = `
        <td>${specName}</td>
        <td>${optimization}</td>
        <td>${Math.round(result.timing.publishTime)}</td>
        <td>${Math.round(result.timing.networkTime)}</td>
        <td>${Math.round(result.timing.loadTime)}</td>
        <td>${Math.round(result.timing.activationTime)}</td>
      `;
    }
    
    // Update preview with the visualization
    previewEl.innerHTML = `
      <div style="padding: 20px; background: #f5f5f5; border: 1px solid #ddd;">
        <h3>${specName} Visualization (${optimization} optimization)</h3>
        <div class="visualization" style="margin: 20px 0;">
          <img src="${result.screenshot}" alt="Visualization" style="max-width: 100%; border: 1px solid #ccc;">
        </div>
      </div>
    `;
    
    return benchmarkResult;
  } catch (error) {
    console.error(`Error running benchmark: ${error}`);
    if (updateUI && resultRow) {
      resultRow.innerHTML = `
        <td>${specName}</td>
        <td>${optimization}</td>
        <td colspan="3" class="error">Error: ${error.message}</td>
      `;
    }
    return null;
  }
}

// Function to run all benchmarks
async function runAllBenchmarks() {
  const specs = ['airlines', 'flights', 'gaia', 'property', 'taxis'];
  const optimizations = ['none', 'minimal', 'more', 'most'];
  
  for (const spec of specs) {
    for (const opt of optimizations) {
      if (abort) {
        abort = false;
        return;
      }
      await runBenchmark(spec, opt);
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
  
  runButton.addEventListener('click', () => {
    const specName = specSelector.value;
    const optimization = optimizationSelector.value;
    runBenchmark(specName, optimization);
  });
  
  stopButton.addEventListener('click', stop);
  
  runAllButton.addEventListener('click', runAllBenchmarks);
  
  downloadResultsButton.addEventListener('click', downloadResults);
});

// Export functions for potential external use
export { runBenchmark, runAllBenchmarks, downloadResults };
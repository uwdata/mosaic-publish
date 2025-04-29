// server/benchmark-server.js
import express from 'express';
import { MosaicPublisher } from '../../../dist/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const PORT = 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const TRACE_DIR = path.join(__dirname, 'traces');

const TRACE_CATEGORIES = [
  'blink.user_timing',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'loading'      
];
const TIMEOUT = 20000;

const app = express();
let browser;

// Function to calculate directory size recursively
function getDirectorySize(dirPath) {
  let totalSize = 0;
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isFile()) {
      totalSize += stats.size;
    } else if (stats.isDirectory()) {
      totalSize += getDirectorySize(filePath);
    }
  }

  return totalSize;
}

/* CORS */
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(
  '/',
  express.static(OUTPUT_DIR, {
    dotfiles: 'allow',
    etag: false,
    cacheControl: false
  })
);

app.use(express.json());
app.post('/publish', async (req, res) => {
  const { spec, specName, optimization } = req.body;
  const NUM_RUNS = 5;
  const results = [];

  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        defaultViewport: { width: 1280, height: 800 }
      });
    }

    // Run the benchmark NUM_RUNS times
    for (let run = 0; run < NUM_RUNS; run++) {
      const t0 = performance.now();
      await new MosaicPublisher({
        spec,
        outputPath: OUTPUT_DIR,
        title: `${specName}-${optimization} Benchmark`,
        optimize: optimization,
        customScript: fs.readFileSync(
          path.join(__dirname, 'activation-script.js'),
          'utf8'
        ),
      }).publish();
      const publishTime = performance.now() - t0;

      // Calculate package size after publishing
      const packageSize = getDirectorySize(OUTPUT_DIR);

      const page = await browser.newPage();
      const tracePath = path.join(TRACE_DIR, `${specName}-${optimization}-run${run + 1}-trace.json`);

      await page.tracing.start({
        path: tracePath,
        screenshots: true,
        categories: TRACE_CATEGORIES,
      });

      const url = `http://localhost:${PORT}/index.html`;
      
      const networkStartTime = performance.now();
      await page.goto(url, { waitUntil: 'networkidle2' });
      const networkTime = performance.now() - networkStartTime;
      
      const loadStartTime = performance.now();
      await page.waitForSelector('.plot', { timeout: TIMEOUT });
      const loadTime = performance.now() - loadStartTime;

      await page.evaluate(() => {performance.mark('hydration-start')});

      const activationResult = await page.evaluate(() => {
        return new Promise((resolve) => {
          const checkActivation = () => {
            const measures = performance.getEntriesByType('measure');
            const activate = measures.find(m => m.name === 'activate');
            if (activate) {
              resolve({
                activationTime: activate?.duration,
                measures: measures.filter(m => m.name !== 'activate').map(m => ({
                  name: m.name,
                  duration: m.duration
                }))
              });
            } else {
              setTimeout(checkActivation, 5);
            }
          };
          checkActivation();
        });
      });

      const hydrationTime = await page.evaluate(() => {
        const marks = performance.getEntriesByType('mark');
        const hydrationStart = marks.find(m => m.name === 'hydration-start')?.startTime;
        const hydrationEnd = marks.find(m => m.name === 'activate-start')?.startTime;
        return Math.max(hydrationEnd - hydrationStart, 0);
      });
      
      await page.tracing.stop();
      await page.close();

      results.push({
        runNumber: run + 1,
        tracePath,
        publishTime,
        networkTime,
        loadTime,
        activationTime: activationResult.activationTime,
        activations: activationResult.measures,
        hydrationTime,
        packageSize,
      });
    }

    // Use the screenshot from the last run for display
    res.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('Publishing error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () =>
  console.log(`Benchmark server running at http://localhost:${PORT}`)
);

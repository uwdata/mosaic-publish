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

const app = express();
let browser;

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

  try {
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

    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        defaultViewport: { width: 1280, height: 800 }
      });
    }
    const page = await browser.newPage();
    const tracePath = path.join(TRACE_DIR, `${specName}-${optimization}-trace.json`);

    await page.tracing.start({
      path: tracePath,
      screenshots: true,
      categories: TRACE_CATEGORIES
    });

    const url = `http://localhost:${PORT}/index.html`;
    
    const networkStartTime = performance.now();
    await page.goto(url, { waitUntil: 'networkidle2' });
    const networkTime = performance.now() - networkStartTime;
    
    const loadStartTime = performance.now();
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const checkPlots = () => {
          const plots = document.querySelectorAll('.plot');
          if (plots.length > 0 && Array.from(plots).every(plot => {
            const rect = plot.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })) {
            performance.mark('hydration-start');
            resolve();
          } else {
            setTimeout(checkPlots, 5);
          }
        };
        checkPlots();
      });
    });
    const loadTime = performance.now() - loadStartTime;

    const activationTime = await page.evaluate(() => {
      return new Promise((resolve) => {
        const checkActivation = () => {
          const marks = performance.getEntriesByType('mark');
          const activateStart = marks.find(m => m.name === 'activate-start')?.startTime;
          const activateEnd = marks.find(m => m.name === 'activate-end')?.startTime;
          if (activateStart && activateEnd) {
            resolve(activateEnd - activateStart);
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
      return Math.max(hydrationEnd - hydrationStart, 0); // Negative means no hydration necessary
    });
    
    await page.tracing.stop();
    const screenshot = await page.screenshot({ encoding: 'base64' });
    await page.close();

    res.json({
      success: true,
      tracePath,
      timing: {
        publishTime, 
        networkTime,
        loadTime, 
        activationTime,
        hydrationTime
      },
      screenshot: `data:image/png;base64,${screenshot}`
    });
  } catch (error) {
    console.error('Publishing error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () =>
  console.log(`Benchmark server running at http://localhost:${PORT}`)
);

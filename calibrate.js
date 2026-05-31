#!/usr/bin/env node
/**
 * Sector Rotation Signal Tracker — Weight Calibration Script
 *
 * Fetches FRED API series for indicators with FRED equivalents,
 * correlates each against subsequent ETF returns, normalises
 * correlations to 0.5–2.0 weight range, and writes weights.json
 * to GitHub.
 *
 * Run periodically (suggested: monthly).
 * Usage: node calibrate.js
 */

'use strict';

const https = require('https');
const readline = require('readline');

// ─────────────────────────────────────────────
// CONFIG — edit before first run
// ─────────────────────────────────────────────

const CONFIG = {
  fredApiKey: process.env.FRED_API_KEY || '',
  githubToken: process.env.GITHUB_TOKEN || '',
  repoOwner: process.env.REPO_OWNER || '',
  repoName: process.env.REPO_NAME || '',
  // Lookback window for correlation (trading days)
  lookbackDays: 90,
  // Forward return window to correlate against (days)
  forwardDays: 30,
  // Weight output range
  weightMin: 0.5,
  weightMax: 2.0
};

// ─────────────────────────────────────────────
// FRED SERIES MAPPINGS
// Indicators that have a FRED series equivalent
// ─────────────────────────────────────────────

const FRED_MAPPINGS = {
  energy: {
    // DCOILWTICO: WTI crude oil price (weekly)
    price_momentum: { series: 'DCOILWTICO', etf: 'XLE' },
    // CPIENGSL: CPI Energy component (monthly)
    inflation_linkage: { series: 'CPIENGSL', etf: 'XLE' }
  },
  industrials: {
    // MANEMP: Manufacturing employment as PMI proxy (monthly)
    manufacturing_pmi: { series: 'NAPM', etf: 'XLI' },
    // NEWORDER: Manufacturers new orders (monthly)
    new_orders: { series: 'NEWORDER', etf: 'XLI' },
    // DGORDER: Durable goods orders (monthly)
    capex_signals: { series: 'DGORDER', etf: 'XLI' }
  },
  semiconductors: {
    // No direct FRED series — SOX price is the best proxy
    // sox_momentum tracked via ETF return itself (weight stays 1.0)
  },
  materials: {
    // PCOPPUSDM: Copper price (monthly)
    copper_price: { series: 'PCOPPUSDM', etf: 'XLB' },
    // GOLDAMGBD228NLBM: Gold price (daily)
    gold_signal: { series: 'GOLDAMGBD228NLBM', etf: 'XLB' },
    // DTBSPCKAM: China PMI proxy via industrial production (no direct FRED)
    // USD direction via DXY — use DTWEXBGS (broad trade-weighted dollar)
    usd_direction: { series: 'DTWEXBGS', etf: 'XLB', invert: true }
  },
  financials: {
    // FEDFUNDS: Federal funds rate trajectory
    rate_trajectory: { series: 'FEDFUNDS', etf: 'XLF', invert: true },
    // BAMLH0A0HYM2: ICE BofA US High Yield OAS (credit spreads)
    credit_spreads: { series: 'BAMLH0A0HYM2', etf: 'XLF', invert: true },
    // DRCLACBS: Consumer loan delinquency rate
    loan_delinquency: { series: 'DRCLACBS', etf: 'XLF', invert: true }
  }
};

// ─────────────────────────────────────────────
// HTTP HELPERS
// ─────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error(`JSON parse failed for ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(new Error(`JSON parse failed: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────
// FRED API
// ─────────────────────────────────────────────

async function fetchFredSeries(seriesId, observationStart) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&observation_start=${observationStart}&api_key=${CONFIG.fredApiKey}&file_type=json&sort_order=asc`;
  const data = await httpsGet(url);
  if (!data.observations) throw new Error(`FRED ${seriesId}: no observations`);
  return data.observations
    .filter(o => o.value !== '.' && o.value !== 'NA')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }));
}

// ─────────────────────────────────────────────
// ETF RETURNS — using simple day-over-day from FRED (no Yahoo)
// Using FRED ETF proxies where available, otherwise skip
// ─────────────────────────────────────────────

const ETF_FRED_PROXIES = {
  XLE: 'DCOILWTICO',   // crude oil as energy proxy
  XLI: 'INDPRO',       // industrial production as industrials proxy
  XLB: 'PCOPPUSDM',    // copper as materials proxy
  XLF: 'BAMLH0A0HYM2'  // IG spreads inverse as financials proxy
};

// ─────────────────────────────────────────────
// CORRELATION
// ─────────────────────────────────────────────

function pearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 3) return 0;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0; let denomX = 0; let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX; const dy = y[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}

function pctChanges(observations) {
  const changes = [];
  for (let i = 1; i < observations.length; i++) {
    const prev = observations[i - 1].value;
    const curr = observations[i].value;
    if (prev !== 0) changes.push((curr - prev) / Math.abs(prev));
  }
  return changes;
}

// Rolling correlation: correlate indicator changes with forward ETF-proxy changes
function rollingCorrelation(indicatorObs, etfObs, forwardWindow) {
  // Align by date
  const etfByDate = new Map(etfObs.map(o => [o.date, o.value]));
  const aligned = [];
  for (let i = 0; i < indicatorObs.length - 1; i++) {
    const curr = indicatorObs[i];
    const next = indicatorObs[i + 1];
    const indChange = curr.value !== 0 ? (next.value - curr.value) / Math.abs(curr.value) : 0;

    // Find ETF observation forwardWindow periods later
    const futureIdx = i + forwardWindow;
    if (futureIdx >= etfObs.length) break;

    const etfCurr = etfObs[i]?.value;
    const etfFuture = etfObs[futureIdx]?.value;
    if (etfCurr == null || etfFuture == null || etfCurr === 0) continue;

    const etfReturn = (etfFuture - etfCurr) / Math.abs(etfCurr);
    aligned.push({ ind: indChange, etf: etfReturn });
  }

  if (aligned.length < 5) return 0;
  return pearsonCorrelation(aligned.map(a => a.ind), aligned.map(a => a.etf));
}

// ─────────────────────────────────────────────
// WEIGHT NORMALISATION
// ─────────────────────────────────────────────

function normaliseWeights(correlations) {
  const vals = Object.values(correlations).map(Math.abs);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const range = mx - mn || 1;
  const weights = {};
  for (const [k, corr] of Object.entries(correlations)) {
    const norm = (Math.abs(corr) - mn) / range;
    weights[k] = parseFloat((CONFIG.weightMin + norm * (CONFIG.weightMax - CONFIG.weightMin)).toFixed(4));
  }
  return weights;
}

// ─────────────────────────────────────────────
// GITHUB WRITE
// ─────────────────────────────────────────────

async function getFileSHA(path) {
  const url = `https://api.github.com/repos/${CONFIG.repoOwner}/${CONFIG.repoName}/contents/${path}`;
  const opts = {
    hostname: 'api.github.com',
    path: `/repos/${CONFIG.repoOwner}/${CONFIG.repoName}/contents/${path}`,
    method: 'GET',
    headers: {
      'Authorization': `token ${CONFIG.githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'sector-rotation-calibrator'
    }
  };
  const res = await httpsRequest(opts, null);
  if (res.status === 404) return null;
  return res.body.sha || null;
}

async function writeToGitHub(path, content, message) {
  const sha = await getFileSHA(path);
  const encoded = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  const body = JSON.stringify({ message, content: encoded, ...(sha ? { sha } : {}) });
  const opts = {
    hostname: 'api.github.com',
    path: `/repos/${CONFIG.repoOwner}/${CONFIG.repoName}/contents/${path}`,
    method: 'PUT',
    headers: {
      'Authorization': `token ${CONFIG.githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'sector-rotation-calibrator'
    }
  };
  const res = await httpsRequest(opts, body);
  if (res.status < 200 || res.status > 299) {
    throw new Error(`GitHub write failed: ${res.status} — ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return res.body;
}

// ─────────────────────────────────────────────
// PROMPT HELPER
// ─────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  console.log('\n─── Sector Rotation Weight Calibrator ───\n');

  // Validate config
  if (!CONFIG.fredApiKey) {
    CONFIG.fredApiKey = await prompt('FRED API key (free at fred.stlouisfed.org): ');
  }
  if (!CONFIG.githubToken) {
    CONFIG.githubToken = await prompt('GitHub Personal Access Token: ');
  }
  if (!CONFIG.repoOwner) {
    CONFIG.repoOwner = await prompt('GitHub repo owner: ');
  }
  if (!CONFIG.repoName) {
    CONFIG.repoName = await prompt('GitHub repo name: ');
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (CONFIG.lookbackDays + CONFIG.forwardDays + 30));
  const observationStart = startDate.toISOString().slice(0, 10);

  console.log(`Lookback: ${CONFIG.lookbackDays} days | Forward window: ${CONFIG.forwardDays} days`);
  console.log(`Fetching FRED data from ${observationStart}...\n`);

  // Flat weights as fallback
  const weights = {
    energy: { supply: 1.0, eia_inventory: 1.0, price_momentum: 1.0, geopolitical_risk: 1.0, inflation_linkage: 1.0 },
    industrials: { manufacturing_pmi: 1.0, new_orders: 1.0, transport_freight: 1.0, capex_signals: 1.0, asx_industrials: 1.0 },
    semiconductors: { nvidia_revenue: 1.0, memory_demand: 1.0, taiwan_risk: 1.0, ai_capex_pipeline: 1.0, sox_momentum: 1.0 },
    materials: { copper_price: 1.0, gold_signal: 1.0, china_pmi: 1.0, usd_direction: 1.0, asx_materials: 1.0 },
    financials: { rate_trajectory: 1.0, credit_spreads: 1.0, asx_banks: 1.0, loan_delinquency: 1.0, bbsw_hybrids: 1.0 }
  };

  let calibratedCount = 0;

  for (const [sectorKey, indicators] of Object.entries(FRED_MAPPINGS)) {
    const sectorCorrelations = {};
    for (const [indicatorKey, mapping] of Object.entries(indicators)) {
      try {
        process.stdout.write(`  ${sectorKey}/${indicatorKey} (${mapping.series})… `);
        const indObs = await fetchFredSeries(mapping.series, observationStart);

        // Use same series as ETF proxy if no dedicated proxy
        const etfSeries = ETF_FRED_PROXIES[mapping.etf] || mapping.series;
        const etfObs = await fetchFredSeries(etfSeries, observationStart);

        // Align to same length
        const len = Math.min(indObs.length, etfObs.length);
        const corr = rollingCorrelation(indObs.slice(-len), etfObs.slice(-len), CONFIG.forwardDays);
        // Invert if the indicator is inversely related to ETF performance
        const finalCorr = mapping.invert ? -corr : corr;
        sectorCorrelations[indicatorKey] = finalCorr;
        console.log(`r=${finalCorr.toFixed(3)}`);
      } catch (err) {
        console.log(`SKIP (${err.message})`);
        sectorCorrelations[indicatorKey] = null;
      }
    }

    // Normalise within sector (only calibrated indicators)
    const validCorrs = Object.fromEntries(
      Object.entries(sectorCorrelations).filter(([, v]) => v !== null)
    );
    if (Object.keys(validCorrs).length > 1) {
      const normalised = normaliseWeights(validCorrs);
      for (const [k, w] of Object.entries(normalised)) {
        weights[sectorKey][k] = w;
        calibratedCount++;
      }
    }
  }

  console.log(`\nCalibrated ${calibratedCount} indicator weights.`);
  console.log('Writing weights.json to GitHub…');

  try {
    await writeToGitHub('weights/weights.json', weights, `Calibrated weights ${new Date().toISOString().slice(0, 10)}`);
    console.log('Done. weights.json updated.\n');
  } catch (err) {
    console.error(`GitHub write failed: ${err.message}`);
    console.log('\nWeights (save manually if needed):');
    console.log(JSON.stringify(weights, null, 2));
  }
}

main().catch(err => {
  console.error('\nCalibration failed:', err.message);
  process.exit(1);
});

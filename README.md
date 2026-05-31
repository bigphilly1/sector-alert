# Sector Rotation Signal Tracker

A single-file web app that runs a daily scan across five global market sectors, scores 25 indicators using live AI-powered web search, and produces composite buy/sell/hold signals stored in GitHub.

---

## What it does

- Scans 5 sectors: Energy, Industrials, Semiconductors/AI, Materials, Financials
- Scores 5 indicators per sector via live web search (Anthropic API + web_search tool)
- Produces a composite signal per sector: **BUY**, **SELL**, or **HOLD**
- Identifies the rotation leader (strongest bullish signal)
- Stores daily signal files and 30-day sparkline history in a GitHub repository
- Displays ring gauges, sparklines, and expandable indicator cards

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Anthropic API key | `claude-sonnet-4-20250514` with `web_search_20250305` |
| GitHub Personal Access Token | Needs `repo` scope to read/write signal files |
| GitHub repository | Create a new empty repo (or use this one after git init) |
| FRED API key (calibration only) | Free at [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html) |

---

## Setup

### 1. Create the GitHub repository

Create a new GitHub repository. The app will create files inside it automatically on first scan.

The repository needs these paths (created automatically):

```
signals/        ← daily JSON signal files (YYYY-MM-DD.json)
weights/        ← weights.json (indicator weights)
history/        ← sparklines.json (30-day composite history)
```

The `weights.json` and `sparklines.json` files in this repo are default starting points. Push them to your GitHub repository before first scan:

```bash
git init
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git add .
git commit -m "Initial setup"
git push -u origin main
```

### 2. Open the app

Open `index.html` in a browser. A setup modal will appear.

Enter:
- **Anthropic API Key** — your `sk-ant-...` key
- **GitHub Personal Access Token** — needs `repo` scope
- **GitHub Repo Owner** — your GitHub username or org
- **GitHub Repo Name** — the repository name

Click **Save**.

### 3. CORS note

The app calls `api.anthropic.com` directly from the browser.

| Environment | Works? |
|---|---|
| Claude.ai artifact environment | Yes — CORS allowed |
| Local file (`file://`) | No — CORS blocked |
| Local dev server (localhost) | No — CORS blocked |

**For local use:** Enter a proxy URL in the setup modal. Deploy the proxy below to Vercel or any Node.js host:

```javascript
// proxy/api/claude.js (Vercel Edge Function)
export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const body = await req.text();
  const apiKey = req.headers.get('x-anthropic-api-key');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31'
    },
    body
  });
  const data = await r.text();
  return new Response(data, { status: r.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
export const config = { runtime: 'edge' };
```

---

## Running a scan

Click **RUN FULL SCAN**. The app will:

1. Load weights and sparkline history from GitHub
2. Run 25 indicator scans in batches of 10 (rate limit safe)
3. Compute weighted composite scores per sector
4. Generate a one-line sector summary
5. Write today's signal file to `signals/YYYY-MM-DD.json`
6. Update `history/sparklines.json`

Each scan takes approximately 3–6 minutes depending on API response times.

---

## Signal file format

`signals/2026-05-31.json`

```json
{
  "date": "2026-05-31",
  "sectors": {
    "energy": {
      "composite": 0.6,
      "signal": "BUY",
      "oneliner": "Strong crude draw and rising prices support the energy sector.",
      "indicators": {
        "supply": { "signal": 1, "summary": "OPEC+ holding production cuts, supply tightening." },
        "eia_inventory": { "signal": 1, "summary": "EIA reported 3.2mb draw week ending May 22." }
      }
    }
  },
  "rotationLeader": "energy"
}
```

---

## Weight calibration (optional)

Run `calibrate.js` monthly to auto-tune indicator weights based on FRED data and ETF return correlations.

```bash
# Set environment variables
export FRED_API_KEY=your_fred_key
export GITHUB_TOKEN=your_github_pat
export REPO_OWNER=your_username
export REPO_NAME=your_repo

node calibrate.js
```

Or run without env vars — the script will prompt for each value.

Calibration:
1. Fetches FRED series for indicators with data equivalents (CPI energy, ISM PMI, credit spreads, copper, etc.)
2. Correlates each with subsequent ETF returns (XLE, XLI, XLB, XLF)
3. Normalises correlation coefficients to a 0.5–2.0 weight range
4. Writes updated `weights/weights.json` to GitHub

Indicators without a FRED equivalent (NVIDIA revenue, Taiwan risk, ASX indices) default to weight 1.0.

---

## Scoring logic

| Score | Signal |
|---|---|
| composite > 0.3 | BUY |
| composite < -0.3 | SELL |
| -0.3 to 0.3 | HOLD |

Composite = weighted average of 5 indicator signals (-1, 0, or +1) per sector.

---

## Files

```
index.html              ← complete single-file web app
calibrate.js            ← Node.js weight calibration script
signals/.gitkeep        ← placeholder for daily signal files
weights/weights.json    ← default flat weights (1.0 each)
history/sparklines.json ← empty 30-day history (populated on first scan)
README.md
```

---

## Not financial advice

Signal data is sourced via live web search and AI interpretation. This tool is for research and educational purposes only. Sector signals do not constitute financial advice. Past signals do not indicate future performance. Always conduct your own research before making investment decisions.

---

Cornerstone Media · Phil Carey

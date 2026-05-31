# Sector Rotation Signal Tracker — Handoff

**Date:** 2026-05-31  
**Project dir:** `/Volumes/Backup 1/Dev/sector-rotation/`  
**Spec source:** `/Users/philipcarey/Downloads/01-claude-code-spec.docx`

---

## What is built

| File | Status | Notes |
|---|---|---|
| `index.html` | Complete (1297 lines) | Single-file app, vanilla JS |
| `calibrate.js` | Complete (356 lines) | Node.js weight calibration script |
| `README.md` | Complete (197 lines) | Setup instructions |
| `signals/.gitkeep` | Done | Placeholder for daily JSON files |
| `weights/weights.json` | Done | Flat 1.0 defaults, all 25 indicators |
| `history/sparklines.json` | Done | Empty arrays, all 5 sectors |

---

## Architecture

- **Frontend:** Single HTML file, Space Mono + Syne fonts, dark theme (#08080f bg)
- **AI:** Anthropic API, model `claude-sonnet-4-6` (corrected from spec's deprecated `claude-sonnet-4-20250514`)
- **Search:** `web_search_20250305` (server-side tool — no client-side tool_result loop needed)
- **Storage:** GitHub REST API via PAT stored in localStorage
- **Calibration:** Separate `calibrate.js`, uses FRED API + ETF correlation, outputs `weights/weights.json`

---

## Critical API corrections applied (from ce-best-practices-researcher)

1. **Model updated** — spec said `claude-sonnet-4-20250514` (retires June 15, 2026). Changed to `claude-sonnet-4-6`.
2. **web_search is server-side** — spec described a client-side tool_use loop (append assistant turn, build tool_result blocks, re-POST). Wrong for web_search. The API handles search internally and returns `stop_reason: end_turn`. Removed the tool_result injection code.
3. **Browser header added** — `anthropic-dangerous-direct-browser-access: true` required for browser-side calls.
4. **Prompt caching** — system prompt has `cache_control: ephemeral` on SYS_BLOCK. SEARCH_TOOL also has cache_control. 25 parallel calls recommended in batches of 5 with 150ms stagger to avoid token bucket rate limits.

---

## Setup (for next session or fresh start)

1. Create GitHub repo — add `signals/`, `weights/`, `history/` dirs, push seed files
2. Open `index.html` locally or deploy to Vercel
3. On first load: setup modal prompts for GitHub PAT, repo owner, repo name — stored in localStorage
4. Enter Anthropic API key in settings gear
5. Hit Run — fires 25 indicator scans + 5 sector summary calls in parallel batches
6. For calibration: `FRED_API_KEY=xxx GITHUB_TOKEN=xxx node calibrate.js`

---

## Pending / not yet done

- [ ] Git repo not yet initialised (no `git init`, no remote push)
- [ ] Not yet tested against live Anthropic API — needs real API key run
- [ ] `web_search_20260209` upgrade path noted (better token efficiency, requires code execution tool)
- [ ] Granular v2 scoring (-2/-1/0/1/2 scale) is spec'd but not implemented — v1 only
- [ ] Prompt caching note: system prompt likely under 1024 tokens — measure in first live run, expand if needed to hit cache threshold
- [ ] Rate limit tier: if user is on API Tier 1 (30k ITPM), 25 parallel scans may hit limits. Tier 2 recommended.

---

## Files to not touch

`weights/weights.json` — overwritten by `calibrate.js` on each run. Edit defaults in the script, not the file.

# 10K Hours — WakaTime Mastery Tracker

A lightweight local dashboard backed by SQLite that pulls your WakaTime stats (defaulting to the day before yesterday) and tracks your progress toward **10,000 hours** of programming mastery.

## Features
- **Zero external dependencies** (uses Node.js 22+ built-in `node:sqlite` and `node:http`).
- **4 Core Metrics**:
  1. Time spent (daily, range total, and cumulative 10,000-hour progress + ETA)
  2. Programming language split
  3. AI-written code (`ai_additions` / `ai_deletions`)
  4. Human-written code (`human_additions` / `human_deletions`)
- **Daily Auto-Sync**: Checks on startup and every hour for the day before yesterday (`today - 2 days`).
- **Backfill**: One-click **Backfill 7D** in the UI to pull the last 7 days WakaTime retains on the free tier.
- **Light & Dark Mode**: Toggle in the header (respects system preference and persists in `localStorage`).

## Setup
1. Get your **Personal OAuth Token** (`waka_tok_...`) from [wakatime.com/oauth](https://wakatime.com/oauth).
   *(Note: WakaTime `waka_...` API keys in `~/.wakatime.cfg` are write-only for plugins and cannot read summaries.)*
2. Copy `.env.example` to `.env` and set your token:
   ```bash
   cp .env.example .env
   # edit .env and set WAKATIME_TOKEN=waka_tok_...
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open [http://localhost:3456](http://localhost:3456) and click **Backfill 7D** to import your last 7 days right away.

## Optional: Cron / CLI Sync
If you don't leave the server running continuously, you can run the sync command daily via cron:
```bash
npm run sync          # pulls day before yesterday
npm run sync -- --week # pulls last 7 days
```

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "wakatime.db");

let db;

function getDb() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      total_seconds REAL NOT NULL DEFAULT 0,
      digital TEXT,
      text TEXT,
      ai_additions INTEGER NOT NULL DEFAULT 0,
      ai_deletions INTEGER NOT NULL DEFAULT 0,
      human_additions INTEGER NOT NULL DEFAULT 0,
      human_deletions INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'wakatime',
      raw_json TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_languages (
      date TEXT NOT NULL,
      language TEXT NOT NULL,
      total_seconds REAL NOT NULL DEFAULT 0,
      percent REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (date, language),
      FOREIGN KEY (date) REFERENCES daily_stats(date) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_requested TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const cols = db.prepare("PRAGMA table_info(daily_stats)").all();
  if (!cols.some((c) => c.name === "source")) {
    db.exec("ALTER TABLE daily_stats ADD COLUMN source TEXT NOT NULL DEFAULT 'wakatime';");
  }

  return db;
}

function getSetting(key, defaultValue = null) {
  const conn = getDb();
  const row = conn.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));
}

function upsertDailySummary(summary) {
  const conn = getDb();
  const date = summary?.range?.date;
  if (!date) {
    throw new Error("Summary object is missing range.date");
  }

  const gt = summary.grand_total || {};
  const totalSeconds = Number(gt.total_seconds || 0);
  const digital = gt.digital || "0:00";
  const text = gt.text || "0 mins";
  const aiAdditions = Number(gt.ai_additions || 0);
  const aiDeletions = Number(gt.ai_deletions || 0);
  const humanAdditions = Number(gt.human_additions || 0);
  const humanDeletions = Number(gt.human_deletions || 0);
  const syncedAt = new Date().toISOString();

  conn.exec("BEGIN");
  try {
    conn
      .prepare(
        `INSERT INTO daily_stats (
          date, total_seconds, digital, text,
          ai_additions, ai_deletions, human_additions, human_deletions,
          source, raw_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'wakatime', ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          total_seconds = excluded.total_seconds,
          digital = excluded.digital,
          text = excluded.text,
          ai_additions = excluded.ai_additions,
          ai_deletions = excluded.ai_deletions,
          human_additions = excluded.human_additions,
          human_deletions = excluded.human_deletions,
          source = 'wakatime',
          raw_json = excluded.raw_json,
          synced_at = excluded.synced_at`
      )
      .run(
        date,
        totalSeconds,
        digital,
        text,
        aiAdditions,
        aiDeletions,
        humanAdditions,
        humanDeletions,
        JSON.stringify(summary),
        syncedAt
      );

    conn.prepare("DELETE FROM daily_languages WHERE date = ?").run(date);

    const insertLang = conn.prepare(
      `INSERT INTO daily_languages (date, language, total_seconds, percent)
       VALUES (?, ?, ?, ?)`
    );

    const languages = Array.isArray(summary.languages) ? summary.languages : [];
    for (const lang of languages) {
      if (!lang?.name) continue;
      insertLang.run(
        date,
        String(lang.name),
        Number(lang.total_seconds || 0),
        Number(lang.percent || 0)
      );
    }

    conn.exec("COMMIT");
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }

  return {
    date,
    total_seconds: totalSeconds,
    ai_additions: aiAdditions,
    ai_deletions: aiDeletions,
    human_additions: humanAdditions,
    human_deletions: humanDeletions,
  };
}

function logSync(dateRequested, status, message = "") {
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO sync_logs (date_requested, status, message, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(dateRequested, status, message, new Date().toISOString());
}

function hasDateSynced(date) {
  const conn = getDb();
  const row = conn
    .prepare("SELECT date FROM daily_stats WHERE date = ? AND source = 'wakatime'")
    .get(date);
  return Boolean(row);
}

function hasAnyWakaTimeData() {
  const conn = getDb();
  const row = conn
    .prepare("SELECT COUNT(*) AS cnt FROM daily_stats WHERE source = 'wakatime'")
    .get();
  return (row?.cnt || 0) > 0;
}

function hasAnyGitHubData() {
  const conn = getDb();
  const row = conn
    .prepare("SELECT COUNT(*) AS cnt FROM daily_stats WHERE source = 'github_estimate'")
    .get();
  return (row?.cnt || 0) > 0;
}

function upsertGitHubEstimateDays(entries) {
  const conn = getDb();
  const syncedAt = new Date().toISOString();
  const upsertDayStmt = conn.prepare(
    `INSERT INTO daily_stats (
      date, total_seconds, digital, text,
      ai_additions, ai_deletions, human_additions, human_deletions,
      source, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'github_estimate', ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      total_seconds = excluded.total_seconds,
      digital = excluded.digital,
      text = excluded.text,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
    WHERE daily_stats.source != 'wakatime'`
  );
  const checkSourceStmt = conn.prepare("SELECT source FROM daily_stats WHERE date = ?");
  const deleteLangsStmt = conn.prepare("DELETE FROM daily_languages WHERE date = ?");
  const insertLangStmt = conn.prepare(
    `INSERT INTO daily_languages (date, language, total_seconds, percent)
     VALUES (?, ?, ?, ?)`
  );

  conn.exec("BEGIN");
  try {
    for (const e of entries) {
      const hrs = Math.floor(e.total_seconds / 3600);
      const mins = Math.floor((e.total_seconds % 3600) / 60);
      const digital = `${hrs}:${String(mins).padStart(2, "0")}`;
      const text = hrs > 0 ? `${hrs} hrs ${mins} mins` : `${mins} mins`;
      upsertDayStmt.run(
        e.date,
        e.total_seconds,
        digital,
        text,
        JSON.stringify({ contributions: e.contributions, source: "github_estimate" }),
        syncedAt
      );

      const row = checkSourceStmt.get(e.date);
      if (row && row.source === "github_estimate" && Array.isArray(e.languages) && e.languages.length > 0) {
        deleteLangsStmt.run(e.date);
        for (const lang of e.languages) {
          const langSecs = +(e.total_seconds * (lang.percent / 100)).toFixed(2);
          if (langSecs <= 0) continue;
          insertLangStmt.run(e.date, lang.language, langSecs, lang.percent);
        }
      }
    }
    conn.exec("COMMIT");
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
  return entries.length;
}

function getRangeStartDate(range) {
  if (!range || range === "all") return null;
  const daysMap = { "7d": 7, "30d": 30, "90d": 90 };
  const days = daysMap[range];
  if (!days) return null;

  const d = new Date();
  d.setDate(d.getDate() - (days + 1)); // account for day-before-yesterday offset
  return d.toISOString().slice(0, 10);
}

function getDashboardData(range = "30d") {
  const conn = getDb();

  const targetHours = Number(getSetting("target_hours", "10000")) || 10000;
  const startingHours = Number(getSetting("starting_hours", "0")) || 0;

  // All-time totals for 10k-hour mastery tracker
  const allTime = conn
    .prepare(
      `SELECT
        COUNT(*) AS days_tracked,
        COALESCE(SUM(total_seconds), 0) AS total_seconds,
        COALESCE(SUM(ai_additions), 0) AS ai_additions,
        COALESCE(SUM(ai_deletions), 0) AS ai_deletions,
        COALESCE(SUM(human_additions), 0) AS human_additions,
        COALESCE(SUM(human_deletions), 0) AS human_deletions,
        MIN(date) AS first_date,
        MAX(date) AS last_date
      FROM daily_stats`
    )
    .get();

  const startDate = getRangeStartDate(range);
  const whereClause = startDate ? "WHERE date >= ?" : "";
  const params = startDate ? [startDate] : [];

  const days = conn
    .prepare(
      `SELECT
        date, total_seconds, digital, text,
        ai_additions, ai_deletions, human_additions, human_deletions, source, synced_at
      FROM daily_stats
      ${whereClause}
      ORDER BY date ASC`
    )
    .all(...params);

  const langRows = conn
    .prepare(
      `SELECT
        language,
        COALESCE(SUM(total_seconds), 0) AS total_seconds
      FROM daily_languages
      ${whereClause}
      GROUP BY language
      ORDER BY total_seconds DESC`
    )
    .all(...params);

  const dayLangRows = conn
    .prepare(
      `SELECT date, language, total_seconds, percent
       FROM daily_languages
       ${whereClause}
       ORDER BY date DESC, total_seconds DESC`
    )
    .all(...params);

  const langsByDate = {};
  for (const r of dayLangRows) {
    if (!langsByDate[r.date]) langsByDate[r.date] = [];
    langsByDate[r.date].push({
      language: r.language,
      total_seconds: r.total_seconds,
      percent: r.percent,
    });
  }

  const rangeTotals = days.reduce(
    (acc, d) => {
      acc.total_seconds += d.total_seconds;
      acc.ai_additions += d.ai_additions;
      acc.ai_deletions += d.ai_deletions;
      acc.human_additions += d.human_additions;
      acc.human_deletions += d.human_deletions;
      return acc;
    },
    {
      total_seconds: 0,
      ai_additions: 0,
      ai_deletions: 0,
      human_additions: 0,
      human_deletions: 0,
    }
  );

  const totalLangSeconds = langRows.reduce((s, r) => s + r.total_seconds, 0);
  const languages = langRows.map((r) => ({
    language: r.language,
    total_seconds: r.total_seconds,
    hours: +(r.total_seconds / 3600).toFixed(2),
    percent: totalLangSeconds > 0 ? +((r.total_seconds / totalLangSeconds) * 100).toFixed(1) : 0,
  }));

  const recentLogs = conn
    .prepare(
      `SELECT id, date_requested, status, message, created_at
       FROM sync_logs
       ORDER BY id DESC
       LIMIT 15`
    )
    .all();

  const loggedHours = allTime.total_seconds / 3600;
  const totalMasteryHours = startingHours + loggedHours;
  const activeDays = days.filter((d) => d.total_seconds > 0).length;
  const avgDailySeconds = days.length > 0 ? rangeTotals.total_seconds / days.length : 0;

  return {
    mastery: {
      target_hours: targetHours,
      starting_hours: startingHours,
      logged_hours: +loggedHours.toFixed(2),
      total_hours: +totalMasteryHours.toFixed(2),
      percent: +Math.min(100, (totalMasteryHours / targetHours) * 100).toFixed(3),
      remaining_hours: +Math.max(0, targetHours - totalMasteryHours).toFixed(2),
      days_tracked: allTime.days_tracked,
      first_date: allTime.first_date,
      last_date: allTime.last_date,
    },
    range,
    summary: {
      ...rangeTotals,
      hours: +(rangeTotals.total_seconds / 3600).toFixed(2),
      days_count: days.length,
      active_days: activeDays,
      avg_daily_hours: +(avgDailySeconds / 3600).toFixed(2),
    },
    languages,
    days: days.map((d) => ({
      ...d,
      languages: (langsByDate[d.date] || []).slice(0, 5),
    })),
    recent_logs: recentLogs,
  };
}

module.exports = {
  DB_PATH,
  getDb,
  getSetting,
  setSetting,
  upsertDailySummary,
  logSync,
  hasDateSynced,
  hasAnyWakaTimeData,
  hasAnyGitHubData,
  upsertGitHubEstimateDays,
  getDashboardData,
};

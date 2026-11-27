const {
  upsertDailySummary,
  logSync,
  hasDateSynced,
  hasAnyWakaTimeData,
  setSetting,
} = require("./db");
const {
  fetchSummariesRange,
  getDayBeforeYesterday,
  getDaysAgoDate,
  getWakaTimeToken,
} = require("./wakatime");

async function syncRange(startDate, endDate) {
  const label = startDate === endDate ? startDate : `${startDate}..${endDate}`;
  try {
    const summaries = await fetchSummariesRange(startDate, endDate);
    const synced = [];
    for (const summary of summaries) {
      const result = upsertDailySummary(summary);
      synced.push(result);
    }
    logSync(label, "success", `Synced ${synced.length} day(s)`);
    setSetting("last_sync_at", new Date().toISOString());
    return { ok: true, count: synced.length, days: synced };
  } catch (err) {
    logSync(label, "error", err.message);
    throw err;
  }
}

async function syncDayBeforeYesterday() {
  const targetDate = getDayBeforeYesterday();
  return syncRange(targetDate, targetDate);
}

async function syncIfMissingDayBeforeYesterday() {
  if (!getWakaTimeToken()) {
    return { skipped: true, reason: "no_token" };
  }
  if (!hasAnyWakaTimeData()) {
    // First-time WakaTime sync: pull last 7 days up to day before yesterday
    const start = getDaysAgoDate(7);
    const end = getDayBeforeYesterday();
    return syncRange(start, end);
  }
  const targetDate = getDayBeforeYesterday();
  if (hasDateSynced(targetDate)) {
    return { skipped: true, reason: "already_synced", date: targetDate };
  }
  return syncRange(targetDate, targetDate);
}

async function syncLastWeek() {
  // WakaTime free tier keeps last 7 days; pull from 7 days ago up to yesterday
  const start = getDaysAgoDate(7);
  const end = getDaysAgoDate(1);
  return syncRange(start, end);
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const isWeek = args.includes("--week");
    const dateArg = args.find((a) => a.startsWith("--date="));

    try {
      let res;
      if (isWeek) {
        res = await syncLastWeek();
      } else if (dateArg) {
        const d = dateArg.split("=")[1];
        res = await syncRange(d, d);
      } else {
        res = await syncDayBeforeYesterday();
      }
      console.log(JSON.stringify(res, null, 2));
    } catch (err) {
      console.error("Sync failed:", err.message);
      process.exit(1);
    }
  })();
}

module.exports = {
  syncRange,
  syncDayBeforeYesterday,
  syncIfMissingDayBeforeYesterday,
  syncLastWeek,
};

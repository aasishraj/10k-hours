const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

function getWakaTimeToken() {
  return (process.env.WAKATIME_TOKEN || "").trim();
}

function formatLocalDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDaysAgoDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatLocalDate(d);
}

function getDayBeforeYesterday() {
  return getDaysAgoDate(2);
}

async function fetchSummariesRange(startDate, endDate, tokenOverride = null) {
  const token = (tokenOverride || getWakaTimeToken() || "").trim();
  if (!token) {
    throw new Error(
      "Missing WakaTime Personal OAuth Token. Get one at https://wakatime.com/oauth and add it in Settings or .env (WAKATIME_TOKEN)."
    );
  }

  const url = new URL("https://api.wakatime.com/api/v1/users/current/summaries");
  url.searchParams.set("start", startDate);
  url.searchParams.set("end", endDate);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errJson = await res.json();
      detail = errJson.error || errJson.message || JSON.stringify(errJson);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`WakaTime API error (${res.status}): ${detail || res.statusText}`);
  }

  const json = await res.json();
  if (!Array.isArray(json.data)) {
    throw new Error("Unexpected WakaTime API response: missing data array");
  }

  return json.data;
}

module.exports = {
  getWakaTimeToken,
  formatLocalDate,
  getDaysAgoDate,
  getDayBeforeYesterday,
  fetchSummariesRange,
};

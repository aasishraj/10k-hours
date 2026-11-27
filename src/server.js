const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {
  getDb,
  getSetting,
  hasAnyGitHubData,
  getDashboardData,
} = require("./db");
const { importGitHubHistory } = require("./github-import");
const {
  getWakaTimeToken,
  getDayBeforeYesterday,
} = require("./wakatime");
const {
  syncRange,
  syncDayBeforeYesterday,
  syncIfMissingDayBeforeYesterday,
  syncLastWeek,
} = require("./sync");

const PORT = Number(process.env.PORT) || 3456;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 64) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(reqPath, res) {
  if (reqPath === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  const cleanPath = reqPath === "/" ? "/index.html" : reqPath;
  const resolved = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(resolved);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/stats") {
    const range = url.searchParams.get("range") || "30d";
    const data = getDashboardData(range);
    const token = getWakaTimeToken();
    return sendJson(res, 200, {
      ...data,
      meta: {
        has_token: Boolean(token),
        target_sync_date: getDayBeforeYesterday(),
        last_sync_at: getSetting("last_sync_at", null),
      },
    });
  }

  if (req.method === "POST" && pathname === "/api/sync") {
    const body = await readJsonBody(req);
    const mode = body.mode || "target";
    let result;
    if (mode === "week") {
      result = await syncLastWeek();
    } else if (mode === "range" && body.start && body.end) {
      result = await syncRange(body.start, body.end);
    } else if (mode === "date" && body.date) {
      result = await syncRange(body.date, body.date);
    } else {
      result = await syncDayBeforeYesterday();
    }
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: "API route not found" });
}

function startScheduler() {
  const runCheck = async () => {
    try {
      if (process.env.GITHUB_TOKEN && !hasAnyGitHubData()) {
        const ghRes = await importGitHubHistory(2020);
        console.log(`[auto-seed] Imported ${ghRes.active_days} GitHub days (~${ghRes.estimated_hours} hrs)`);
      }
    } catch (err) {
      console.error("[auto-seed] GitHub import failed:", err.message);
    }
    try {
      const res = await syncIfMissingDayBeforeYesterday();
      if (!res.skipped) {
        console.log(`[auto-sync] Synced ${res.count} day(s):`, res.days.map((d) => d.date).join(", "));
      }
    } catch (err) {
      console.error("[auto-sync] Failed:", err.message);
    }
  };

  // Check shortly after boot, then every hour
  setTimeout(runCheck, 1500);
  setInterval(runCheck, 60 * 60 * 1000);
}

getDb();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(url.pathname, res);
    }
  } catch (err) {
    console.error("[server error]", err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: err.message || "Internal server error" });
    }
  }
});

server.listen(PORT, () => {
  console.log(`10K Hours WakaTime Tracker running at http://localhost:${PORT}`);
  console.log(`Auto-sync target date (day before yesterday): ${getDayBeforeYesterday()}`);
  startScheduler();
});

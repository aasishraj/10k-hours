const { execFileSync } = require("node:child_process");
const { upsertGitHubEstimateDays, logSync } = require("./db");
const { getDayBeforeYesterday } = require("./wakatime");

function getGitHubLogin() {
  if (process.env.GITHUB_USERNAME) return process.env.GITHUB_USERNAME.trim();
  const out = execFileSync("gh", ["api", "user", "--jq", ".login"], {
    encoding: "utf8",
  });
  return out.trim();
}

function estimateSecondsFromContributions(count) {
  if (!count || count <= 0) return 0;
  // 1 contribution = 45m (0.75h), each additional = 27m (0.45h), capped at 8h/day
  const hours = Math.min(8, 0.75 + (count - 1) * 0.45);
  return Math.round(hours * 3600);
}

function fetchYearData(login, year) {
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
          commitContributionsByRepository(maxRepositories: 100) {
            contributions {
              totalCount
            }
            repository {
              languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
                edges {
                  size
                  node {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const raw = execFileSync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `login=${login}`,
      "-F",
      `from=${from}`,
      "-F",
      `to=${to}`,
    ],
    { encoding: "utf8" }
  );

  const parsed = JSON.parse(raw);
  const collection = parsed?.data?.user?.contributionsCollection || {};
  const weeks = collection.contributionCalendar?.weeks || [];
  const days = [];
  for (const w of weeks) {
    for (const d of w.contributionDays || []) {
      days.push({ date: d.date, contributions: d.contributionCount || 0 });
    }
  }

  // Weight each repo's language byte share by commit count in that repo
  const langWeights = {};
  const repoContribs = collection.commitContributionsByRepository || [];
  for (const rc of repoContribs) {
    const commits = rc?.contributions?.totalCount || 0;
    const edges = rc?.repository?.languages?.edges || [];
    const totalBytes = edges.reduce((s, e) => s + (e.size || 0), 0);
    if (commits <= 0 || totalBytes <= 0) continue;

    for (const e of edges) {
      const name = e?.node?.name;
      const size = e?.size || 0;
      if (!name || size <= 0) continue;
      langWeights[name] = (langWeights[name] || 0) + commits * (size / totalBytes);
    }
  }

  return { days, langWeights };
}

function normalizeLanguageSplit(langWeights) {
  const total = Object.values(langWeights).reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return Object.entries(langWeights)
    .map(([language, weight]) => ({
      language,
      percent: +((weight / total) * 100).toFixed(2),
    }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 10);
}

function importGitHubHistory(startYear = 2020) {
  const login = getGitHubLogin();
  const currentYear = new Date().getFullYear();
  const cutoffDate = getDayBeforeYesterday();

  const yearlyResults = [];
  const globalLangWeights = {};

  for (let y = startYear; y <= currentYear; y++) {
    const data = fetchYearData(login, y);
    yearlyResults.push({ year: y, ...data });
    for (const [lang, w] of Object.entries(data.langWeights)) {
      globalLangWeights[lang] = (globalLangWeights[lang] || 0) + w;
    }
  }

  const globalLanguages = normalizeLanguageSplit(globalLangWeights);
  const entries = [];

  for (const yr of yearlyResults) {
    const yearLanguages = normalizeLanguageSplit(yr.langWeights);
    const langsToUse = yearLanguages.length > 0 ? yearLanguages : globalLanguages;

    for (const d of yr.days) {
      if (d.date > cutoffDate) continue;
      if (d.contributions > 0) {
        entries.push({
          date: d.date,
          contributions: d.contributions,
          total_seconds: estimateSecondsFromContributions(d.contributions),
          languages: langsToUse,
        });
      }
    }
  }

  const count = upsertGitHubEstimateDays(entries);
  const totalHours = entries.reduce((s, e) => s + e.total_seconds, 0) / 3600;
  logSync(
    `${startYear}..${cutoffDate}`,
    "success",
    `GitHub estimate imported: ${count} active day(s), ~${totalHours.toFixed(1)} hrs, ${globalLanguages.length} language(s)`
  );

  return {
    login,
    active_days: count,
    estimated_hours: +totalHours.toFixed(2),
    cutoff_date: cutoffDate,
    top_languages: globalLanguages.slice(0, 5),
  };
}

if (require.main === module) {
  try {
    const res = importGitHubHistory(2020);
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("GitHub import failed:", err.message);
    process.exit(1);
  }
}

module.exports = { importGitHubHistory };

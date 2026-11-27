(function () {
  let timeView = "monthly"; // "monthly" | "30d"
  let cachedData = null;

  const $ = (id) => document.getElementById(id);

  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    if (hrs === 0) return `${mins}m`;
    return `${hrs}h ${mins}m`;
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString();
  }

  const DEVICON_BASE = "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons";
  const DEVICON_SVG = {
    typescript: ["typescript", "original"],
    python: ["python", "original"],
    javascript: ["javascript", "original"],
    astro: ["astro", "original", true],
    "c++": ["cplusplus", "original"],
    cpp: ["cplusplus", "original"],
    css: ["css3", "original"],
    c: ["c", "original"],
    markdown: ["markdown", "original", true],
    html: ["html5", "original"],
    bash: ["bash", "original", true],
    shell: ["bash", "original", true],
    sh: ["bash", "original", true],
    go: ["go", "original"],
    rust: ["rust", "original", true],
    dockerfile: ["docker", "original"],
    docker: ["docker", "original"],
    java: ["java", "original"],
    react: ["react", "original"],
    svelte: ["svelte", "original"],
    ruby: ["ruby", "original"],
    php: ["php", "original"],
    swift: ["swift", "original"],
    kotlin: ["kotlin", "original"],
    yaml: ["yaml", "original"],
    json: ["json", "original"],
  };

  function renderLangLogo(langName) {
    const safeName = escapeHtml(langName);
    const entry = DEVICON_SVG[String(langName || "").toLowerCase()];
    if (entry) {
      const [pkg, variant, invertInDark] = entry;
      const src = `${DEVICON_BASE}/${pkg}/${pkg}-${variant}.svg`;
      const cls = invertInDark ? "lang-logo lang-logo-invert" : "lang-logo";
      return `<img class="${cls}" src="${src}" alt="${safeName}" title="${safeName}" loading="lazy" />`;
    }
    const initials = String(langName || "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
    return `<span class="lang-logo-fallback" title="${safeName}" aria-label="${safeName}">${escapeHtml(initials)}</span>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateThemeIcon() {
    const theme = document.documentElement.getAttribute("data-theme");
    $("theme-icon").textContent = theme === "dark" ? "☀" : "☾";
  }

let isScrolling = false;
  let scrollTimer = null;
  window.addEventListener(
    "scroll",
    () => {
      isScrolling = true;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        isScrolling = false;
      }, 120);
    },
    { passive: true }
  );

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateThemeIcon();
    if (cachedData) {
      renderTimeChart(cachedData.days);
      renderHeatmap(cachedData.days);
      renderCodeChart(cachedData.days);
    }
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function setupCanvas(container, cssHeight) {
    const width = Math.max(280, Math.floor(container.clientWidth || 900));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let canvas = container.querySelector("canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      container.innerHTML = "";
      container.appendChild(canvas);
    }
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas, ctx, width, height: cssHeight };
  }

  async function api(path) {
    const res = await fetch(path);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  function renderHero(data) {
    const { mastery, summary, meta } = data;
    $("mastery-total").textContent = mastery.total_hours.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    $("mastery-target").textContent = mastery.target_hours.toLocaleString();
    $("mastery-percent-pill").textContent = `${mastery.percent.toFixed(2)}%`;

    $("mastery-bar").style.width = `${Math.min(100, mastery.percent)}%`;
    $("mastery-progressbar").setAttribute("aria-valuenow", mastery.percent.toFixed(1));

    const activePace = summary.active_days > 0 ? mastery.logged_hours / summary.active_days : 0;

    let calendarDailyAvg = summary.avg_daily_hours;
    if (mastery.first_date && mastery.last_date) {
      const spanDays = Math.max(
        1,
        (new Date(mastery.last_date) - new Date(mastery.first_date)) / 86400000 + 1
      );
      calendarDailyAvg = mastery.logged_hours / spanDays;
    }

    let etaText = "—";
    if (calendarDailyAvg > 0 && mastery.remaining_hours > 0) {
      const daysLeft = mastery.remaining_hours / calendarDailyAvg;
      const yearsLeft = daysLeft / 365.25;
      etaText = yearsLeft >= 1 ? `~${yearsLeft.toFixed(1)} yrs` : `~${Math.ceil(daysLeft)} days`;
    } else if (mastery.remaining_hours === 0) {
      etaText = "Reached";
    }

    $("mastery-remaining-line").textContent =
      `${mastery.remaining_hours.toLocaleString()} hrs remaining · Est. ${etaText}`;
    $("mastery-pace-line").textContent =
      `Active pace: ${activePace.toFixed(1)} hrs/day · Since ${mastery.first_date || "—"}`;

    $("last-sync-label").textContent = meta.last_sync_at
      ? `Synced ${new Date(meta.last_sync_at).toLocaleDateString()} · Target ${meta.target_sync_date}`
      : `Auto-sync target: ${meta.target_sync_date}`;

    $("token-banner").classList.toggle("hidden", Boolean(meta.has_token));
  }

  function renderMetricsStrip(data) {
    const { summary, languages } = data;

    $("kpi-time").textContent = formatDuration(summary.total_seconds);
    $("kpi-time-sub").textContent = `${summary.active_days} active days`;

    if (languages.length > 0) {
      $("kpi-lang").innerHTML = renderLangLogo(languages[0].language);
      $("kpi-lang-sub").textContent = `${languages[0].percent}% share · ${languages.length} total`;
    } else {
      $("kpi-lang").textContent = "—";
      $("kpi-lang-sub").textContent = "No languages yet";
    }

    const aiTotal = summary.ai_additions + summary.ai_deletions;
    const humanTotal = summary.human_additions + summary.human_deletions;
    const combined = aiTotal + humanTotal;
    const aiShare = combined > 0 ? (aiTotal / combined) * 100 : 0;
    const humanShare = combined > 0 ? (humanTotal / combined) * 100 : 0;

    $("kpi-ai").textContent = `${formatNumber(aiTotal)} lines`;
    $("kpi-ai-sub").textContent =
      `+${formatNumber(summary.ai_additions)} / -${formatNumber(summary.ai_deletions)} · ${aiShare.toFixed(1)}%`;

    $("kpi-human").textContent = `${formatNumber(humanTotal)} lines`;
    $("kpi-human-sub").textContent =
      `+${formatNumber(summary.human_additions)} / -${formatNumber(summary.human_deletions)} · ${humanShare.toFixed(1)}%`;

    $("split-human-bar").style.width = `${combined > 0 ? humanShare : 50}%`;
    $("split-ai-bar").style.width = `${combined > 0 ? aiShare : 50}%`;
    $("split-human-label").innerHTML =
      `<i class="swatch swatch-human"></i>Human ${humanShare.toFixed(1)}% (${formatNumber(humanTotal)})`;
    $("split-ai-label").innerHTML =
      `<i class="swatch swatch-ai"></i>AI ${aiShare.toFixed(1)}% (${formatNumber(aiTotal)})`;
  }

  function buildMonthlySeries(days) {
    if (!days.length) return [];
    const byMonth = {};
    for (const d of days) {
      const m = d.date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { key: m, seconds: 0, activeDays: 0 };
      byMonth[m].seconds += d.total_seconds;
      if (d.total_seconds > 0) byMonth[m].activeDays += 1;
    }

    const first = days[0].date.slice(0, 7);
    const last = days[days.length - 1].date.slice(0, 7);
    const [fy, fm] = first.split("-").map(Number);
    const [ly, lm] = last.split("-").map(Number);

    const out = [];
    let y = fy;
    let m = fm;
    while (y < ly || (y === ly && m <= lm)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const entry = byMonth[key] || { key, seconds: 0, activeDays: 0 };
      const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      });
      out.push({
        label,
        shortLabel: m === 1 ? String(y) : "",
        hours: entry.seconds / 3600,
        seconds: entry.seconds,
        activeDays: entry.activeDays,
      });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  function buildLast30Series(days) {
    const byDate = {};
    for (const d of days) byDate[d.date] = d;
    const end = days.length ? new Date(days[days.length - 1].date + "T00:00:00") : new Date();
    const out = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date(end);
      dt.setDate(dt.getDate() - i);
      const key = dt.toISOString().slice(0, 10);
      const row = byDate[key];
      const secs = row ? row.total_seconds : 0;
      out.push({
        label: dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        shortLabel: i === 29 || i === 15 || i === 0 ? key.slice(5) : "",
        hours: secs / 3600,
        seconds: secs,
        activeDays: secs > 0 ? 1 : 0,
      });
    }
    return out;
  }

  function renderTimeChart(days) {
    const container = $("time-chart");
    const readout = $("time-readout");
    const series = timeView === "monthly" ? buildMonthlySeries(days) : buildLast30Series(days);

    if (!series.length) {
      readout.textContent = "No activity recorded yet";
      container.innerHTML = `<div class="empty-note">Waiting for data.</div>`;
      return;
    }

    const totalHours = series.reduce((s, d) => s + d.hours, 0);
    const nonZero = series.filter((d) => d.hours > 0);
    const avgHours = nonZero.length ? totalHours / nonZero.length : 0;
    const defaultReadout =
      timeView === "monthly"
        ? `${series.length} months · avg ${avgHours.toFixed(1)} hrs/active month`
        : `Last 30 days · ${totalHours.toFixed(1)} hrs total`;
    readout.textContent = defaultReadout;

    const { canvas, ctx, width, height } = setupCanvas(container, 175);
    const padL = 38;
    const padR = 32;
    const padT = 14;
    const padB = 24;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const maxH = Math.max(1, ...series.map((d) => d.hours));
    const niceMax = Math.ceil(maxH / (maxH > 20 ? 10 : 2)) * (maxH > 20 ? 10 : 2);
    const slotW = chartW / series.length;
    const barW = Math.max(2, Math.min(20, slotW * 0.68));

    const cGrid = cssVar("--gridline");
    const cMuted = cssVar("--text-muted");
    const cText = cssVar("--text");
    const cAccent = cssVar("--accent");
    const cBarMuted = cssVar("--bar-muted");

    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const octx = offscreen.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    octx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    octx.strokeStyle = cGrid;
    octx.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = Math.round(padT + chartH * (1 - f)) + 0.5;
      octx.beginPath();
      octx.moveTo(padL, y);
      octx.lineTo(width - padR, y);
      octx.stroke();
      octx.fillStyle = cMuted;
      octx.textAlign = "right";
      octx.textBaseline = "middle";
      octx.fillText(`${(niceMax * f).toFixed(0)}h`, padL - 8, y);
    }

    if (avgHours > 0) {
      const avgY = Math.round(padT + chartH * (1 - Math.min(1, avgHours / niceMax))) + 0.5;
      octx.save();
      octx.setLineDash([4, 4]);
      octx.strokeStyle = cMuted;
      octx.globalAlpha = 0.45;
      octx.beginPath();
      octx.moveTo(padL, avgY);
      octx.lineTo(width - padR, avgY);
      octx.stroke();
      octx.restore();
      octx.fillStyle = cMuted;
      octx.textAlign = "left";
      octx.textBaseline = "middle";
      octx.fillText("avg", width - padR + 6, avgY);
    }

    for (let i = 0; i < series.length; i++) {
      const d = series[i];
      const x = padL + i * slotW + (slotW - barW) / 2;
      const barH = Math.max(d.hours > 0 ? 2 : 1.5, (d.hours / niceMax) * chartH);
      const y = padT + chartH - barH;

      octx.save();
      octx.fillStyle = d.hours > 0 ? cAccent : cBarMuted;
      octx.globalAlpha = d.hours > 0 ? 0.85 : 0.3;
      octx.fillRect(x, y, barW, barH);
      octx.restore();

      if (d.shortLabel) {
        octx.fillStyle = cMuted;
        octx.textAlign = "center";
        octx.textBaseline = "bottom";
        octx.fillText(d.shortLabel, x + barW / 2, height - 3);
      }
    }

    function draw(hoverIdx = -1) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();

      if (hoverIdx >= 0 && hoverIdx < series.length) {
        const cx = Math.round(padL + hoverIdx * slotW + slotW / 2) + 0.5;
        ctx.save();
        ctx.strokeStyle = cText;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, padT);
        ctx.lineTo(cx, padT + chartH);
        ctx.stroke();
        ctx.restore();
      }
    }

    draw(-1);
    let lastIdx = -1;

    canvas.onmousemove = (e) => {
      if (isScrolling) return;
      const rect = canvas.getBoundingClientRect();
      const idx = Math.floor((e.clientX - rect.left - padL) / slotW);
      if (idx === lastIdx) return;
      lastIdx = idx;
      if (idx < 0 || idx >= series.length) {
        draw(-1);
        readout.textContent = defaultReadout;
        return;
      }
      draw(idx);
      const item = series[idx];
      readout.textContent = `${item.label} · ${item.hours.toFixed(1)} hrs (${item.activeDays} active ${item.activeDays === 1 ? "day" : "days"})`;
    };

    canvas.onmouseleave = () => {
      if (lastIdx === -1) return;
      lastIdx = -1;
      draw(-1);
      readout.textContent = defaultReadout;
    };
  }

  function renderHeatmap(days) {
    const container = $("heatmap-chart");
    const readout = $("heatmap-readout");
    const byDate = {};
    for (const d of days) byDate[d.date] = d;

    const end = days.length ? new Date(days[days.length - 1].date + "T00:00:00") : new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 363);
    start.setDate(start.getDate() - start.getDay());

    const availW = Math.max(300, Math.floor(container.clientWidth || 900));
    // Count columns
    const totalDays = Math.floor((end - start) / 86400000) + 1;
    const totalCols = Math.ceil((totalDays + start.getDay()) / 7);
    const step = availW / totalCols;
    const gap = Math.max(2, Math.floor(step * 0.22));
    const cell = Math.max(4, step - gap);
    const padT = 18;
    const cssHeight = Math.ceil(padT + 7 * step);

    const { canvas, ctx } = setupCanvas(container, cssHeight);
    const colors = [cssVar("--hm-0"), cssVar("--hm-1"), cssVar("--hm-2"), cssVar("--hm-3"), cssVar("--hm-4")];
    const cMuted = cssVar("--text-muted");
    const cText = cssVar("--text");

    const cellLookup = {};
    const monthLabels = [];
    const rects = [];
    let lastMonth = -1;
    let activeInWindow = 0;

    const cursor = new Date(start);
    let col = 0;
    while (cursor <= end) {
      const row = cursor.getDay();
      if (row === 0 && cursor.getMonth() !== lastMonth) {
        lastMonth = cursor.getMonth();
        monthLabels.push({
          x: col * step,
          text: cursor.toLocaleDateString(undefined, { month: "short" }),
        });
      }

      const key = cursor.toISOString().slice(0, 10);
      const entry = byDate[key];
      const hrs = entry ? entry.total_seconds / 3600 : 0;
      const src = entry ? (entry.source === "wakatime" ? "WakaTime" : "GitHub est.") : "No activity";
      if (hrs > 0) activeInWindow += 1;

      let level = 0;
      if (hrs > 0 && hrs < 1.2) level = 1;
      else if (hrs >= 1.2 && hrs < 2.8) level = 2;
      else if (hrs >= 2.8 && hrs < 4.5) level = 3;
      else if (hrs >= 4.5) level = 4;

      const info = { col, row, date: key, secs: entry ? entry.total_seconds : 0, src, level };
      cellLookup[`${col},${row}`] = info;
      rects.push(info);

      cursor.setDate(cursor.getDate() + 1);
      if (cursor.getDay() === 0) col += 1;
    }

    const defaultText = `Last 52 weeks · ${activeInWindow} active days`;
    readout.textContent = defaultText;

    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const octx = offscreen.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    octx.font = '10.5px "JetBrains Mono", ui-monospace, monospace';
    octx.fillStyle = cMuted;
    octx.textAlign = "left";
    octx.textBaseline = "top";
    for (const ml of monthLabels) {
      octx.fillText(ml.text, ml.x, 2);
    }

    for (const r of rects) {
      const x = r.col * step;
      const y = padT + r.row * step;
      octx.fillStyle = colors[r.level];
      octx.fillRect(x, y, cell, cell);
    }

    function draw(hoverCell = null) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();

      if (hoverCell) {
        ctx.strokeStyle = cText;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(hoverCell.col * step + 0.5, padT + hoverCell.row * step + 0.5, cell - 1, cell - 1);
      }
    }

    draw(null);
    let lastKey = "";

    canvas.onmousemove = (e) => {
      if (isScrolling) return;
      const rect = canvas.getBoundingClientRect();
      const c = Math.floor((e.clientX - rect.left) / step);
      const r = Math.floor((e.clientY - rect.top - padT) / step);
      const key = `${c},${r}`;
      if (key === lastKey) return;
      lastKey = key;
      const info = cellLookup[key];
      if (!info) {
        draw(null);
        readout.textContent = defaultText;
        return;
      }
      draw(info);
      const label = info.secs > 0 ? formatDuration(info.secs) : "0m";
      readout.textContent = `${info.date} · ${label} (${info.src})`;
    };

    canvas.onmouseleave = () => {
      if (lastKey === "") return;
      lastKey = "";
      draw(null);
      readout.textContent = defaultText;
    };
  }

  function renderCodeChart(days) {
    const container = $("code-chart");
    const readout = $("code-readout");
    const wakaDays = days.filter(
      (d) => d.source === "wakatime" || d.ai_additions + d.ai_deletions + d.human_additions + d.human_deletions > 0
    );

    if (!wakaDays.length) {
      readout.textContent = "No WakaTime line metrics yet";
      container.innerHTML = `<div class="empty-note">Line-level AI vs. Human metrics appear once WakaTime syncs.</div>`;
      return;
    }

    const recent = wakaDays.slice(-14);
    const defaultReadout = `Last ${recent.length} WakaTime ${recent.length === 1 ? "day" : "days"}`;
    readout.textContent = defaultReadout;

    const { canvas, ctx, width, height } = setupCanvas(container, 140);
    const padL = 42;
    const padR = 8;
    const padT = 10;
    const padB = 22;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const items = recent.map((d) => ({
      date: d.date,
      human: d.human_additions + d.human_deletions,
      ai: d.ai_additions + d.ai_deletions,
    }));
    const maxLines = Math.max(10, ...items.map((t) => t.human + t.ai));
    const slotW = chartW / items.length;
    const barW = Math.max(8, Math.min(26, slotW * 0.62));

    const cGrid = cssVar("--gridline");
    const cMuted = cssVar("--text-muted");
    const cHuman = cssVar("--human");
    const cAi = cssVar("--ai");

    function draw() {
      ctx.clearRect(0, 0, width, height);
      ctx.font = '10.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.strokeStyle = cGrid;
      ctx.lineWidth = 1;

      for (const f of [0, 0.5, 1]) {
        const y = Math.round(padT + chartH * (1 - f)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
        ctx.fillStyle = cMuted;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(formatNumber(Math.round(maxLines * f)), padL - 6, y);
      }

      for (let i = 0; i < items.length; i++) {
        const t = items[i];
        const x = padL + i * slotW + (slotW - barW) / 2;
        const humanH = (t.human / maxLines) * chartH;
        const aiH = (t.ai / maxLines) * chartH;
        const humanY = padT + chartH - humanH;
        const aiY = humanY - aiH;

        if (humanH > 0) {
          ctx.fillStyle = cHuman;
          ctx.fillRect(x, humanY, barW, humanH);
        }
        if (aiH > 0) {
          ctx.fillStyle = cAi;
          ctx.fillRect(x, aiY, barW, aiH);
        }
      }

      ctx.fillStyle = cMuted;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillText(items[0].date.slice(5), padL, height - 3);
      if (items.length > 1) {
        ctx.textAlign = "right";
        ctx.fillText(items[items.length - 1].date.slice(5), width - padR, height - 3);
      }
    }

    draw();

    let lastCodeIdx = -1;
    canvas.onmousemove = (e) => {
      if (isScrolling) return;
      const rect = canvas.getBoundingClientRect();
      const idx = Math.floor((e.clientX - rect.left - padL) / slotW);
      if (idx === lastCodeIdx) return;
      lastCodeIdx = idx;
      if (idx < 0 || idx >= items.length) {
        readout.textContent = defaultReadout;
        return;
      }
      const item = items[idx];
      readout.textContent = `${item.date} · Human ${formatNumber(item.human)} · AI ${formatNumber(item.ai)} lines`;
    };

    canvas.onmouseleave = () => {
      if (lastCodeIdx === -1) return;
      lastCodeIdx = -1;
      readout.textContent = defaultReadout;
    };
  }

  function renderLanguages(languages, totalSeconds) {
    const el = $("languages-list");
    $("lang-total-label").textContent = `${formatDuration(totalSeconds)} across ${languages.length} languages`;

    if (!languages.length) {
      el.innerHTML = `<div class="empty-note">No language data yet.</div>`;
      return;
    }

    const maxPct = Math.max(1, languages[0].percent);
    el.innerHTML = languages
      .slice(0, 8)
      .map((l) => {
        const relativeW = (l.percent / maxPct) * 100;
        return `
          <div class="lang-item" title="${escapeHtml(l.language)}">
            ${renderLangLogo(l.language)}
            <div class="lang-track">
              <div class="lang-fill" style="width: ${relativeW.toFixed(1)}%"></div>
            </div>
            <span class="lang-val">${l.hours.toFixed(1)}h · ${l.percent}%</span>
          </div>
        `;
      })
      .join("");
  }

  async function loadDashboard() {
    try {
      const data = await api("/api/stats?range=all");
      cachedData = data;
      renderHero(data);
      renderMetricsStrip(data);
      renderTimeChart(data.days);
      renderHeatmap(data.days);
      renderCodeChart(data.days);
      renderLanguages(data.languages, data.summary.total_seconds);
    } catch (err) {
      $("time-readout").textContent = `Failed to load data: ${err.message}`;
    }
  }

  function bindEvents() {
    $("theme-toggle").addEventListener("click", toggleTheme);

    document.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        timeView = btn.dataset.view;
        if (cachedData) renderTimeChart(cachedData.days);
      });
    });

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (cachedData) {
          renderTimeChart(cachedData.days);
          renderHeatmap(cachedData.days);
          renderCodeChart(cachedData.days);
        }
      }, 120);
    });
  }

  updateThemeIcon();
  bindEvents();
  loadDashboard();
})();

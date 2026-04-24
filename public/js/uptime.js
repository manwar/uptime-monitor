/**
 * uptime.js — Cookie-based uptime tracker for manwar.org
 *
 * Cookie schema (all prefixed "upt_"):
 *   upt_checks  — JSON array of check records (newest first), max 90 entries
 *                 each entry: { t: timestamp_ms, up: bool, ms: latency|null }
 *   upt_meta    — JSON object { firstSeen: ms, totalUp: n, totalDown: n }
 *
 * The check is done via a no-cors fetch (we can't read status across origins),
 * so we use a timed race: if the request settles within the timeout the site is
 * UP, if it times-out or throws a network error it is DOWN.
 *
 * NOTE: because GitHub Pages serves this on a different origin than manwar.org,
 * the browser's CORS policy means we can't read HTTP status codes. The probe
 * instead measures whether the TCP/HTTP connection succeeds at all (opaque
 * response = UP, network error = DOWN). This is the standard approach for
 * client-side monitoring of cross-origin sites.
 */

(function () {
  "use strict";

  /* ── Config ─────────────────────────────────────────── */
  const CFG = window.UPTIME_CONFIG || {};
  const TARGET_URL   = CFG.targetURL    || "https://manwar.org";
  const CHECK_INTERVAL = (CFG.checkInterval || 60) * 1000; // ms
  const COOKIE_DAYS  = CFG.cookieDays   || 90;
  const MAX_RECORDS  = 90;
  const PROBE_TIMEOUT = 10000; // ms

  /* ── Cookie helpers ──────────────────────────────────── */
  const Cookie = {
    set(name, value, days) {
      const expires = new Date(Date.now() + days * 864e5).toUTCString();
      document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
    },
    get(name) {
      const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
      return m ? decodeURIComponent(m[1]) : null;
    },
    del(name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  };

  /* ── Data layer ──────────────────────────────────────── */
  const Store = {
    loadChecks() {
      try { return JSON.parse(Cookie.get("upt_checks") || "[]"); }
      catch { return []; }
    },
    loadMeta() {
      try {
        return JSON.parse(Cookie.get("upt_meta") || "{}");
      } catch { return {}; }
    },
    saveChecks(arr) {
      Cookie.set("upt_checks", JSON.stringify(arr), COOKIE_DAYS);
    },
    saveMeta(m) {
      Cookie.set("upt_meta", JSON.stringify(m), COOKIE_DAYS);
    },
    addCheck(record) {
      const checks = Store.loadChecks();
      checks.unshift(record);          // newest first
      if (checks.length > MAX_RECORDS) checks.splice(MAX_RECORDS);
      Store.saveChecks(checks);

      let meta = Store.loadMeta();
      if (!meta.firstSeen) meta.firstSeen = record.t;
      meta.totalUp   = (meta.totalUp   || 0) + (record.up ? 1 : 0);
      meta.totalDown = (meta.totalDown || 0) + (record.up ? 0 : 1);
      Store.saveMeta(meta);
    },
    clear() {
      Cookie.del("upt_checks");
      Cookie.del("upt_meta");
    }
  };

  /* ── Probe ───────────────────────────────────────────── */
  async function probe() {
    const start = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
      // mode: no-cors → opaque response counts as success (site reachable)
      await fetch(TARGET_URL, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: ctrl.signal
      });
      clearTimeout(timer);
      return { up: true, ms: Date.now() - start };
    } catch {
      return { up: false, ms: null };
    }
  }

  /* ── UI helpers ──────────────────────────────────────── */
  const $ = id => document.getElementById(id);

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleString("en-GB", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false
    });
  }

  function uptimePct(checks) {
    if (!checks.length) return null;
    const up = checks.filter(c => c.up).length;
    return ((up / checks.length) * 100).toFixed(2);
  }

  function avgLatency(checks) {
    const valid = checks.filter(c => c.ms !== null).map(c => c.ms);
    if (!valid.length) return null;
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  }

  /* ── Render functions ────────────────────────────────── */
  function renderStatus(result) {
    const panel = document.querySelector(".status-panel");
    const label = $("statusLabel");
    const meta  = $("statusMeta");
    const lat   = $("statusLatency");

    panel.classList.remove("up", "down", "unknown");

    if (result === null) {
      panel.classList.add("unknown");
      label.textContent = "CHECKING…";
      meta.textContent  = "Probing endpoint…";
      lat.textContent   = "—";
      return;
    }

    if (result.up) {
      panel.classList.add("up");
      label.textContent = "ONLINE";
      meta.textContent  = `Last checked ${fmtTime(result.t)} · responded in ${result.ms}ms`;
      lat.textContent   = result.ms + "ms";
    } else {
      panel.classList.add("down");
      label.textContent = "OFFLINE";
      meta.textContent  = `Last checked ${fmtTime(result.t)} · no response`;
      lat.textContent   = "TIMEOUT";
    }
  }

  function renderStats(checks, meta) {
    const pct = uptimePct(checks);
    $("statUptime").textContent    = pct !== null ? pct + "%" : "—";
    $("statChecks").textContent    = (meta.totalUp || 0) + (meta.totalDown || 0) || checks.length || "—";
    $("statOutages").textContent   = meta.totalDown ?? "—";
    const avg = avgLatency(checks);
    $("statAvgLatency").textContent = avg !== null ? avg : "—";
  }

  function renderTimeline(checks) {
    const grid = $("timelineGrid");
    grid.innerHTML = "";

    const display = checks.slice(0, MAX_RECORDS).reverse(); // oldest → newest left → right
    display.forEach(c => {
      const tick = document.createElement("div");
      tick.className = "tick " + (c.up ? "up" : "down");
      tick.title = fmtDate(c.t) + " · " + (c.up ? "UP" + (c.ms ? " " + c.ms + "ms" : "") : "DOWN");
      grid.appendChild(tick);
    });

    if (!display.length) {
      const ph = document.createElement("div");
      ph.style.cssText = "color:var(--muted);font-size:.72rem;padding:.25rem 0";
      ph.textContent = "No history yet.";
      grid.appendChild(ph);
    }

    $("timelineRange").textContent = `last ${display.length} checks`;
  }

  function renderLog(checks) {
    const container = $("logContainer");
    container.innerHTML = "";

    if (!checks.length) {
      const ph = document.createElement("div");
      ph.className = "log-entry placeholder";
      ph.textContent = "Waiting for first check result…";
      container.appendChild(ph);
      return;
    }

    checks.forEach(c => {
      const el = document.createElement("div");
      el.className = "log-entry " + (c.up ? "up" : "down");
      el.innerHTML = `
        <span class="log-time">${fmtDate(c.t)}</span>
        <span class="log-status">${c.up ? "UP" : "DOWN"}</span>
        <span class="log-detail">${c.up ? (c.ms ? c.ms + "ms response" : "responded") : "no response / timeout"}</span>
      `;
      container.appendChild(el);
    });
  }

  function renderAll() {
    const checks = Store.loadChecks();
    const meta   = Store.loadMeta();
    renderStats(checks, meta);
    renderTimeline(checks);
    renderLog(checks);
  }

  /* ── Countdown ───────────────────────────────────────── */
  let countdownVal  = Math.round(CHECK_INTERVAL / 1000);
  let countdownTimer = null;

  function startCountdown() {
    clearInterval(countdownTimer);
    countdownVal = Math.round(CHECK_INTERVAL / 1000);
    const el = $("countdown");
    countdownTimer = setInterval(() => {
      countdownVal = Math.max(0, countdownVal - 1);
      if (el) el.textContent = countdownVal;
    }, 1000);
  }

  /* ── Main check loop ─────────────────────────────────── */
  async function doCheck() {
    renderStatus(null); // show "checking"
    const res = await probe();
    const record = { t: Date.now(), up: res.up, ms: res.ms };
    Store.addCheck(record);
    renderStatus(record);
    renderAll();
    startCountdown();
  }

  /* ── Clear button ────────────────────────────────────── */
  $("clearBtn").addEventListener("click", () => {
    if (!confirm("Clear all uptime history stored in cookies?")) return;
    Store.clear();
    renderStatus(null);
    renderAll();
  });

  /* ── Bootstrap ───────────────────────────────────────── */
  // Render whatever is already stored immediately
  renderAll();

  // Show last result if available
  const existing = Store.loadChecks();
  if (existing.length) renderStatus(existing[0]);
  else                 renderStatus(null);

  // First live check
  doCheck();

  // Recurring checks
  setInterval(doCheck, CHECK_INTERVAL);

})();

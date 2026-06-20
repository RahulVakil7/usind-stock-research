/* AI & Tech — Live Equity Research
   Frontend: calls Netlify functions (/api/stocks, /api/fundamentals, /api/research),
   renders live financials + AI research. No build step. */

const state = { page: 0, pages: 1, total: 0, loading: false, market: "US", currency: "USD", open: {}, cache: {} };

const $ = (id) => document.getElementById(id);
const listEl = $("list");
const metaEl = $("meta");
const refreshBtn = $("refresh");
const prevBtn = $("prev");
const marketsEl = $("markets");

// currency symbol — set per market/company
let CUR = "$";
const curSym = (c) => ({ USD: "$", INR: "₹", EUR: "€", GBP: "£", JPY: "¥" }[c] || (c ? c + " " : "$"));
const MARKET_LABEL = { US: "US market", NSE: "NSE (India)", BSE: "BSE (India)" };

/* ---------- formatting ---------- */
const num = (n) => (n === null || n === undefined || n === "" || isNaN(n) ? null : Number(n));
function big(n) {
  n = num(n);
  if (n === null) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}
const money = (n) => (num(n) === null ? "—" : CUR + big(n));
const dollars = (n) =>
  num(n) === null ? "—" : CUR + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n, dp = 2) => (num(n) === null ? "—" : (n >= 0 ? "+" : "") + Number(n).toFixed(dp) + "%");
const pctRaw = (n, dp = 1) => (num(n) === null ? "—" : Number(n).toFixed(dp) + "%");
const ratio = (n) => (num(n) === null ? "—" : Number(n).toFixed(2));
const cls = (n) => (num(n) === null ? "" : n >= 0 ? "pos" : "neg");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const initials = (sym) => esc(String(sym).slice(0, 4));

/* ---------- data ---------- */
async function api(path) {
  const r = await fetch(path);
  return r.json();
}
async function loadPage(page) {
  if (state.loading) return;
  state.loading = true;
  refreshBtn.classList.add("spin");
  metaEl.textContent = "Loading live data…";
  listEl.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const data = await api(`/api/stocks?page=${page}&market=${encodeURIComponent(state.market)}`);
    if (data.error) return showSetupNotice(data);
    state.page = data.page;
    state.pages = data.pages;
    state.total = data.total;
    state.currency = data.currency || "USD";
    CUR = curSym(state.currency);
    state.open = {};
    metaEl.innerHTML = `<b>${MARKET_LABEL[state.market] || state.market}</b> · tech · page <b>${data.page + 1}</b> of ${data.pages} · ${data.total.toLocaleString()} companies`;
    renderList(data.companies);
  } catch (e) {
    listEl.innerHTML = `<div class="notice">Could not reach the data service. ${esc(String(e))}</div>`;
  } finally {
    state.loading = false;
    setTimeout(() => refreshBtn.classList.remove("spin"), 550);
  }
}

function showSetupNotice(data) {
  metaEl.textContent = "Couldn't load data";
  listEl.innerHTML = `<div class="notice"><b>Couldn't fetch live quotes right now.</b> ${esc(data.message || "")}<br>
    Market data comes from Yahoo Finance (no key needed). This is usually transient — try
    <b>Refresh</b> again in a moment. The AI research note additionally needs <code>LLM_API_KEY</code>.</div>`;
}

/* ---------- render list ---------- */
function renderList(companies) {
  listEl.innerHTML = "";
  companies.forEach((c) => listEl.appendChild(card(c)));
}

function card(c) {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.symbol = c.symbol;
  const pos = (c.changesPercentage ?? 0) >= 0;

  el.innerHTML = `
    <div class="card-head">
      <div class="av">${initials(c.symbol)}</div>
      <div class="idn">
        <h3>${esc(c.name)} <span style="color:var(--dim);font-weight:600;font-size:13px">${esc(c.symbol)}</span></h3>
        <div class="sub">${esc(c.industry || c.sector || "Technology")}</div>
      </div>
      <div class="px">
        <div class="p">${dollars(c.price)}</div>
        <div class="chg ${pos ? "pos" : "neg"}">${pct(c.changesPercentage)} today</div>
      </div>
      <div class="chev">▾</div>
    </div>
    <div class="snap">
      ${cell("Prev close", dollars(c.previousClose))}
      ${cell("EPS (ttm)", num(c.eps) === null ? "—" : dollars(c.eps))}
      ${cell("P/E", ratio(c.pe))}
      ${cell("Market cap", money(c.marketCap))}
      ${cell("52-wk low", dollars(c.yearLow))}
      ${cell("52-wk high", dollars(c.yearHigh))}
    </div>
    <div class="body"><div class="body-inner"><div class="loading"><span class="spinner"></span> Open for full financials &amp; AI analysis</div></div></div>
  `;

  el.querySelector(".card-head").addEventListener("click", () => toggle(el, c));
  return el;
}
const cell = (l, v) => `<div class="cell"><div class="l">${l}</div><div class="v">${v}</div></div>`;

/* ---------- expand / load detail ---------- */
async function toggle(el, c) {
  const sym = c.symbol;
  const isOpen = el.classList.toggle("open");
  if (!isOpen) return;
  if (state.open[sym]) return; // already loaded
  state.open[sym] = true;

  const body = el.querySelector(".body-inner");
  body.innerHTML = '<div class="loading"><span class="spinner"></span> Pulling 12 quarters &amp; 4 years of financials…</div>';

  let f = state.cache[sym];
  try {
    if (!f) {
      f = await api(`/api/fundamentals?symbol=${encodeURIComponent(sym)}`);
      state.cache[sym] = f;
    }
  } catch (e) {
    body.innerHTML = `<div class="notice">Could not load financials. ${esc(String(e))}</div>`;
    state.open[sym] = false;
    return;
  }
  if (f.error) {
    body.innerHTML = `<div class="notice">${esc(f.message || "Financials unavailable for this symbol.")}</div>`;
    return;
  }

  if (f.currency) CUR = curSym(f.currency);
  body.innerHTML = renderDetail(f);

  // Now the AI research note (separate, possibly slower call)
  const researchEl = el.querySelector(".research");
  researchEl.innerHTML = '<div class="loading"><span class="spinner"></span> Analysing the financials…</div>';
  try {
    const r = await fetch("/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fundamentals: f }),
    }).then((x) => x.json());
    if (r.research) {
      researchEl.innerHTML = md(r.research) + `<div class="byline">AI analysis generated by ${esc(r.model || "an open-source model")} from the live financials above. Not investment advice.</div>`;
    } else if (r.error === "missing_llm_key") {
      researchEl.innerHTML = `<div class="notice">${esc(r.message)}</div>`;
    } else {
      researchEl.innerHTML = `<div class="notice">AI research is unavailable right now${r.message ? ": " + esc(r.message) : "."}.</div>`;
    }
  } catch (e) {
    researchEl.innerHTML = `<div class="notice">AI research request failed. ${esc(String(e))}</div>`;
  }
}

function renderDetail(f) {
  const s = f.snapshot || {};
  const rangePct =
    num(s.yearLow) !== null && num(s.yearHigh) !== null && s.yearHigh > s.yearLow
      ? Math.max(0, Math.min(100, ((s.price - s.yearLow) / (s.yearHigh - s.yearLow)) * 100))
      : null;

  const divYield = num(s.dividendYield) === null ? "—" : pctRaw(s.dividendYield * 100, 2);

  let html = "";

  // Key metrics
  html += `<div class="section-title">Key metrics</div>`;
  if (rangePct !== null) {
    html += `<div class="range">
      <div style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px">52-week range — ${rangePct.toFixed(0)}% of range</div>
      <div class="rbar"><div class="rfill" style="width:${rangePct}%"></div><div class="rmark" style="left:calc(${rangePct}% - 1px)"></div></div>
      <div class="rends"><span>${dollars(s.yearLow)}</span><span>${dollars(s.yearHigh)}</span></div>
    </div>`;
  }
  html += `<div class="mgrid">
    ${m("Previous close", dollars(s.previousClose))}
    ${m("EPS (ttm)", num(s.eps) === null ? "—" : dollars(s.eps))}
    ${m("P/E", ratio(s.pe))}
    ${m("Dividend", num(s.dividendPerShare) ? dollars(s.dividendPerShare) + " · " + divYield : divYield)}
    ${m("Market cap", money(s.marketCap))}
    ${m("P/S", ratio(s.priceToSales))}
    ${m("P/B", ratio(s.priceToBook))}
    ${m("ROE", num(s.roe) === null ? "—" : pctRaw(s.roe * 100))}
    ${m("Net margin (ttm)", num(s.netMargin) === null ? "—" : pctRaw(s.netMargin * 100))}
    ${m("Gross margin", num(s.grossMargin) === null ? "—" : pctRaw(s.grossMargin * 100))}
    ${m("Debt / equity", ratio(s.debtToEquity))}
    ${m("Beta", ratio(s.beta))}
  </div>`;

  // Quarterly financials
  const qi = (f.quarterly && f.quarterly.income) || [];
  const qc = (f.quarterly && f.quarterly.cashflow) || [];
  if (qi.length) {
    html += `<div class="section-title mt">Quarterly trend · last ${qi.length} quarters (QoQ)</div>`;
    html += `<p class="cap">Oldest → newest. ${qi[0].date} → ${qi[qi.length - 1].date}</p>`;
    html += `<div class="fin">${financialRows(qi, qc)}</div>`;
  }

  // Annual financials
  const ai = (f.annual && f.annual.income) || [];
  const ac = (f.annual && f.annual.cashflow) || [];
  if (ai.length) {
    html += `<div class="section-title mt">Annual trend · last ${ai.length} years (YoY)</div>`;
    html += `<p class="cap">Oldest → newest. ${ai[0].year || ai[0].date} → ${ai[ai.length - 1].year || ai[ai.length - 1].date}</p>`;
    html += `<div class="fin">${financialRows(ai, ac)}</div>`;
  }

  // AI research placeholder
  html += `<div class="section-title mt">AI research note — critical analysis</div><div class="research"></div>`;
  return html;
}
const m = (l, v) => `<div class="mcell"><div class="l">${l}</div><div class="v">${v}</div></div>`;

/* ---------- financial metric rows + sparkbars ---------- */
function financialRows(income, cashflow) {
  const cf = Object.fromEntries((cashflow || []).map((r) => [r.date, r]));
  const ocf = income.map((r) => (cf[r.date] ? cf[r.date].operatingCashFlow : null));
  const fcf = income.map((r) => (cf[r.date] ? cf[r.date].freeCashFlow : null));

  const rows = [
    { name: "Revenue", sub: "top line", vals: income.map((r) => r.revenue), fmt: money, color: "var(--accent)" },
    { name: "Net income", sub: "bottom line", vals: income.map((r) => r.netIncome), fmt: money, color: "#0ea5e9" },
    { name: "EBITDA", sub: "", vals: income.map((r) => r.ebitda), fmt: money, color: "#8b5cf6" },
    { name: "Net margin", sub: "%", vals: income.map((r) => (r.netMargin == null ? null : r.netMargin * 100)), fmt: (v) => pctRaw(v, 1), color: "#f59e0b" },
    { name: "Operating CF", sub: "cash flow", vals: ocf, fmt: money, color: "#10b981" },
    { name: "Free cash flow", sub: "", vals: fcf, fmt: money, color: "#14b8a6" },
  ];

  return rows
    .map((row) => {
      const vals = row.vals;
      const latest = lastNonNull(vals);
      const first = firstNonNull(vals);
      let grow = null;
      if (first !== null && latest !== null && first !== 0) grow = ((latest - first) / Math.abs(first)) * 100;
      return `<div class="frow">
        <div class="name">${row.name}${row.sub ? `<small>${row.sub}</small>` : ""}</div>
        <div class="chart">${sparkbars(vals, row.color)}</div>
        <div class="val">
          <div class="latest">${latest === null ? "—" : row.fmt(latest)}</div>
          <div class="grow ${cls(grow)}">${grow === null ? "" : pct(grow, 0) + " ▱"}</div>
        </div>
      </div>`;
    })
    .join("");
}
const lastNonNull = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null && !isNaN(a[i])) return a[i]; return null; };
const firstNonNull = (a) => { for (let i = 0; i < a.length; i++) if (a[i] != null && !isNaN(a[i])) return a[i]; return null; };

function sparkbars(values, color) {
  const v = values.map((x) => (x == null || !isFinite(x) ? 0 : Number(x)));
  const max = Math.max(...v.map(Math.abs), 1);
  const anyNeg = v.some((x) => x < 0);
  const W = 15, G = 5, H = 46;
  const width = v.length * (W + G) - G;
  const base = anyNeg ? H / 2 : H - 2;
  let bars = "";
  v.forEach((x, i) => {
    const span = (anyNeg ? H / 2 : H) - 5;
    const bh = (Math.abs(x) / max) * span;
    const xx = i * (W + G);
    const yy = x >= 0 ? base - bh : base;
    const c = x < 0 ? "var(--neg)" : color;
    bars += `<rect x="${xx}" y="${yy.toFixed(1)}" width="${W}" height="${Math.max(1.5, bh).toFixed(1)}" rx="2" fill="${c}" opacity="0.85"></rect>`;
  });
  if (anyNeg) bars += `<line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="var(--line)" stroke-width="1"/>`;
  return `<svg viewBox="0 0 ${width} ${H}" width="${Math.max(width, 1)}" height="${H}" preserveAspectRatio="xMinYMid meet" role="img">${bars}</svg>`;
}

/* ---------- tiny markdown ---------- */
function md(src) {
  const lines = String(src).replace(/\r/g, "").split("\n");
  const inline = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*].*?)\*/g, "$1<em>$2</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  let html = "", inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^###\s+/.test(line)) { closeList(); html += `<h4>${inline(line.replace(/^###\s+/, ""))}</h4>`; }
    else if (/^##\s+/.test(line)) { closeList(); html += `<h3>${inline(line.replace(/^##\s+/, ""))}</h3>`; }
    else if (/^#\s+/.test(line)) { closeList(); html += `<h3>${inline(line.replace(/^#\s+/, ""))}</h3>`; }
    else if (/^[-*]\s+/.test(line)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`; }
    else if (line === "") { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

/* ---------- controls ---------- */
refreshBtn.addEventListener("click", () => loadPage(state.page + 1));
prevBtn.addEventListener("click", () => loadPage(state.page - 1));

marketsEl.addEventListener("click", (e) => {
  const b = e.target.closest(".seg");
  if (!b || state.loading) return;
  const m = b.dataset.market;
  if (m === state.market) return;
  state.market = m;
  marketsEl.querySelectorAll(".seg").forEach((x) => x.classList.toggle("active", x === b));
  state.cache = {};
  loadPage(0);
});

$("foot").innerHTML =
  `<b>Methodology &amp; disclaimer.</b> Prices, quotes and statements are pulled live from Yahoo Finance
   for US, NSE and BSE on each request; free statement history is limited to roughly the last 4 quarters
   and 4 years. The research note is generated by an open-source LLM from those exact figures and is a
   model's interpretation, not a human analyst's. This material is for informational and educational
   purposes only and is <b>not investment advice</b>, a recommendation, or an offer to buy or sell any
   security. Verify figures independently before acting.`;

loadPage(0);

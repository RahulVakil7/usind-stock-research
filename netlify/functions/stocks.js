// GET /api/stocks?page=N&market=US|NSE|BSE
// Live quotes across US, NSE (India) and BSE (India) via Yahoo Finance — no API key.
// Universe is a curated tech list per market (no free cross-exchange screener exists);
// prices/quotes are fully live. Edit UNIVERSE below to add tickers.

const PAGE_SIZE = 6;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const CURRENCY = { US: "USD", NSE: "INR", BSE: "INR" };

const UNIVERSE = {
  US: [
    ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["NVDA", "NVIDIA"], ["GOOGL", "Alphabet"],
    ["AMZN", "Amazon"], ["META", "Meta Platforms"], ["AVGO", "Broadcom"], ["ORCL", "Oracle"],
    ["AMD", "Advanced Micro Devices"], ["ADBE", "Adobe"], ["CRM", "Salesforce"], ["CSCO", "Cisco"],
    ["ACN", "Accenture"], ["INTC", "Intel"], ["QCOM", "Qualcomm"], ["TXN", "Texas Instruments"],
    ["IBM", "IBM"], ["NOW", "ServiceNow"], ["INTU", "Intuit"], ["AMAT", "Applied Materials"],
    ["MU", "Micron"], ["ADI", "Analog Devices"], ["LRCX", "Lam Research"], ["PANW", "Palo Alto Networks"],
    ["SNPS", "Synopsys"], ["CDNS", "Cadence"], ["KLAC", "KLA Corp"], ["MRVL", "Marvell"],
    ["ARM", "Arm Holdings"], ["CRWD", "CrowdStrike"],
  ],
  NSE: [
    ["TCS.NS", "Tata Consultancy Services"], ["INFY.NS", "Infosys"], ["HCLTECH.NS", "HCL Technologies"],
    ["WIPRO.NS", "Wipro"], ["TECHM.NS", "Tech Mahindra"], ["LTIM.NS", "LTIMindtree"],
    ["PERSISTENT.NS", "Persistent Systems"], ["COFORGE.NS", "Coforge"], ["MPHASIS.NS", "Mphasis"],
    ["OFSS.NS", "Oracle Financial Services"], ["LTTS.NS", "L&T Technology Services"],
    ["TATAELXSI.NS", "Tata Elxsi"], ["KPITTECH.NS", "KPIT Technologies"], ["BSOFT.NS", "Birlasoft"],
    ["CYIENT.NS", "Cyient"], ["MASTEK.NS", "Mastek"], ["INTELLECT.NS", "Intellect Design"],
    ["NEWGEN.NS", "Newgen Software"], ["HAPPSTMNDS.NS", "Happiest Minds"], ["TANLA.NS", "Tanla Platforms"],
    ["ZENSARTECH.NS", "Zensar Technologies"], ["SONATSOFTW.NS", "Sonata Software"],
    ["BLS.NS", "BLS International"], ["RATEGAIN.NS", "RateGain Travel Tech"],
  ],
  BSE: [
    ["TCS.BO", "Tata Consultancy Services"], ["INFY.BO", "Infosys"], ["HCLTECH.BO", "HCL Technologies"],
    ["WIPRO.BO", "Wipro"], ["TECHM.BO", "Tech Mahindra"], ["LTIM.BO", "LTIMindtree"],
    ["PERSISTENT.BO", "Persistent Systems"], ["COFORGE.BO", "Coforge"], ["MPHASIS.BO", "Mphasis"],
    ["OFSS.BO", "Oracle Financial Services"], ["LTTS.BO", "L&T Technology Services"],
    ["TATAELXSI.BO", "Tata Elxsi"], ["KPITTECH.BO", "KPIT Technologies"], ["BSOFT.BO", "Birlasoft"],
    ["CYIENT.BO", "Cyient"], ["MASTEK.BO", "Mastek"], ["INTELLECT.BO", "Intellect Design"],
    ["NEWGEN.BO", "Newgen Software"], ["HAPPSTMNDS.BO", "Happiest Minds"], ["TANLA.BO", "Tanla Platforms"],
    ["ZENSARTECH.BO", "Zensar Technologies"], ["SONATSOFTW.BO", "Sonata Software"],
  ],
};

// ---- Yahoo cookie + crumb (cached on the warm lambda) ----
let auth = { cookie: "", crumb: "", at: 0 };
async function yahooAuth() {
  if (auth.crumb && Date.now() - auth.at < 30 * 60 * 1000) return auth;
  const headers = { "user-agent": UA, accept: "*/*" };
  let cookie = "";
  for (const u of ["https://fc.yahoo.com/", "https://finance.yahoo.com/"]) {
    try {
      const r = await fetch(u, { headers, redirect: "follow" });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")];
      const cookies = (sc || []).filter(Boolean).map((c) => c.split(";")[0]);
      if (cookies.length) { cookie = cookies.join("; "); break; }
    } catch {}
  }
  let crumb = "";
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { ...headers, cookie },
    });
    crumb = (await r.text()).trim();
    if (crumb.includes("<") || crumb.length > 32) crumb = ""; // got HTML, not a crumb
  } catch {}
  auth = { cookie, crumb, at: Date.now() };
  return auth;
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const market = (qs.market || "US").toUpperCase();
  const list = UNIVERSE[market] || UNIVERSE.US;
  const page = Math.max(0, parseInt(qs.page || "0", 10) || 0);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const p = ((page % pages) + pages) % pages;
  const slice = list.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
  const symbols = slice.map((x) => x[0]);
  const nameBy = Object.fromEntries(slice);

  let companies = [];
  try {
    companies = await quotesBatch(symbols, nameBy);
    if (!companies.length) companies = await quotesChart(symbols, nameBy);
  } catch {
    try {
      companies = await quotesChart(symbols, nameBy);
    } catch (e2) {
      return json(502, { error: "quote_failed", message: String((e2 && e2.message) || e2) });
    }
  }

  return json(200, {
    page: p, pages, total: list.length, pageSize: PAGE_SIZE,
    market, currency: CURRENCY[market] || "USD", companies,
  });
};

// Primary: Yahoo v7 batch quote (rich fields; needs crumb)
async function quotesBatch(symbols, nameBy) {
  const { cookie, crumb } = await yahooAuth();
  if (!crumb) return [];
  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { "user-agent": UA, cookie } });
  const d = await r.json();
  const res = (d && d.quoteResponse && d.quoteResponse.result) || [];
  if (!res.length) return [];
  const by = Object.fromEntries(res.map((q) => [q.symbol, q]));
  return symbols.map((sym) => {
    const q = by[sym] || {};
    return {
      symbol: sym,
      name: nameBy[sym] || q.longName || q.shortName || sym,
      sector: "Technology",
      industry: q.industry || null,
      price: num(q.regularMarketPrice),
      previousClose: num(q.regularMarketPreviousClose),
      change: num(q.regularMarketChange),
      changesPercentage: num(q.regularMarketChangePercent), // v7 already a percent
      eps: num(q.epsTrailingTwelveMonths),
      pe: num(q.trailingPE),
      marketCap: num(q.marketCap),
      yearHigh: num(q.fiftyTwoWeekHigh),
      yearLow: num(q.fiftyTwoWeekLow),
    };
  });
}

// Fallback: Yahoo v8 chart (no crumb) — price/prevClose/52w only
async function quotesChart(symbols, nameBy) {
  const out = await Promise.all(
    symbols.map(async (sym) => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`,
          { headers: { "user-agent": UA } }
        );
        const d = await r.json();
        const res = d && d.chart && d.chart.result && d.chart.result[0];
        if (!res) return null;
        const meta = res.meta || {};
        const closes = (
          (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || []
        ).filter((x) => x != null);
        const hi = closes.length ? Math.max(...closes) : null;
        const lo = closes.length ? Math.min(...closes) : null;
        const price = num(meta.regularMarketPrice);
        const prev = num(meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose);
        return {
          symbol: sym,
          name: nameBy[sym] || meta.shortName || sym,
          sector: "Technology",
          industry: null,
          price,
          previousClose: prev,
          change: price != null && prev != null ? price - prev : null,
          changesPercentage: price != null && prev ? ((price - prev) / prev) * 100 : null,
          eps: null,
          pe: null,
          marketCap: null,
          yearHigh: meta.fiftyTwoWeekHigh != null ? num(meta.fiftyTwoWeekHigh) : hi,
          yearLow: meta.fiftyTwoWeekLow != null ? num(meta.fiftyTwoWeekLow) : lo,
        };
      } catch {
        return null;
      }
    })
  );
  return out.filter(Boolean);
}

const num = (v) => (v === null || v === undefined || v === "" || isNaN(v) ? null : Number(v));
function json(code, body) {
  return {
    statusCode: code,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

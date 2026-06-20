// GET /api/fundamentals?symbol=XXXX
// Full snapshot + up to ~4 quarters (QoQ) and ~4 years (YoY) of income & cash-flow
// statements via Yahoo Finance quoteSummary. Works for US, NSE (.NS) and BSE (.BO).
// No API key. (Yahoo only exposes ~4 periods of statement history for free.)

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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
    if (crumb.includes("<") || crumb.length > 32) crumb = "";
  } catch {}
  auth = { cookie, crumb, at: Date.now() };
  return auth;
}

exports.handler = async (event) => {
  const sym = ((event.queryStringParameters || {}).symbol || "").toUpperCase().trim();
  if (!sym || !/^[A-Z0-9.\-]{1,20}$/.test(sym)) return json(400, { error: "bad_symbol" });

  try {
    const { cookie, crumb } = await yahooAuth();
    const modules = [
      "price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile",
      "incomeStatementHistory", "incomeStatementHistoryQuarterly",
      "cashflowStatementHistory", "cashflowStatementHistoryQuarterly",
    ].join(",");
    const url =
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}` +
      `?modules=${modules}${crumb ? `&crumb=${encodeURIComponent(crumb)}` : ""}`;
    const r = await fetch(url, { headers: { "user-agent": UA, cookie } });
    const d = await r.json();
    const result = d && d.quoteSummary && d.quoteSummary.result && d.quoteSummary.result[0];
    if (!result) {
      const err = d && d.quoteSummary && d.quoteSummary.error;
      return json(200, {
        error: "fundamentals_failed",
        message: (err && (err.description || err.code)) || "Yahoo returned no data (auth/crumb may have failed).",
      });
    }

    const price = result.price || {};
    const sd = result.summaryDetail || {};
    const ks = result.defaultKeyStatistics || {};
    const fd = result.financialData || {};
    const ap = result.assetProfile || {};

    // index cash-flow by period date so income rows can compute EBITDA = EBIT + D&A
    const cfDep = {}, cfOcf = {}, cfCapex = {}, cfFcf = {};
    const indexCF = (arr) =>
      (arr || []).forEach((rr) => {
        const k = dt(rr.endDate);
        if (!k) return;
        cfDep[k] = raw(rr.depreciation);
        const ocf = raw(rr.totalCashFromOperatingActivities);
        const capex = raw(rr.capitalExpenditures);
        cfOcf[k] = ocf; cfCapex[k] = capex;
        cfFcf[k] = ocf != null && capex != null ? ocf + capex : null; // capex is negative
      });
    indexCF(get(result, "cashflowStatementHistory.cashflowStatements"));
    indexCF(get(result, "cashflowStatementHistoryQuarterly.cashflowStatements"));

    const mapInc = (arr) =>
      (arr || [])
        .slice()
        .reverse() // oldest → newest
        .map((rr) => {
          const date = dt(rr.endDate);
          const revenue = raw(rr.totalRevenue);
          const netIncome = raw(rr.netIncome);
          const ebit = pickNum(raw(rr.operatingIncome), raw(rr.ebit));
          const dep = date ? cfDep[date] : null;
          return {
            date,
            period: null,
            year: date ? date.slice(0, 4) : null,
            revenue,
            netIncome,
            ebitda: ebit != null ? ebit + (dep || 0) : null,
            grossProfit: raw(rr.grossProfit),
            operatingIncome: ebit,
            eps: null,
            netMargin: revenue ? netIncome / revenue : null,
          };
        });

    const mapCF = (arr) =>
      (arr || [])
        .slice()
        .reverse()
        .map((rr) => {
          const date = dt(rr.endDate);
          const ocf = raw(rr.totalCashFromOperatingActivities);
          const capex = raw(rr.capitalExpenditures);
          return {
            date,
            year: date ? date.slice(0, 4) : null,
            operatingCashFlow: ocf,
            freeCashFlow: ocf != null && capex != null ? ocf + capex : null,
            capex,
          };
        });

    const frac = (o) => raw(o); // Yahoo margins/yields/ROE come as fractions already

    const out = {
      symbol: sym,
      name: price.longName || price.shortName || sym,
      sector: ap.sector || null,
      industry: ap.industry || null,
      description: ap.longBusinessSummary || null,
      ceo: (ap.companyOfficers && ap.companyOfficers[0] && ap.companyOfficers[0].name) || null,
      country: ap.country || null,
      employees: ap.fullTimeEmployees || null,
      website: ap.website || null,
      currency: price.currency || sd.currency || "USD",
      snapshot: {
        price: pickNum(raw(price.regularMarketPrice), raw(fd.currentPrice)),
        previousClose: pickNum(raw(price.regularMarketPreviousClose), raw(sd.previousClose)),
        change: raw(price.regularMarketChange),
        // quoteSummary change-percent is a fraction → ×100
        changesPercentage: raw(price.regularMarketChangePercent) != null ? raw(price.regularMarketChangePercent) * 100 : null,
        open: pickNum(raw(price.regularMarketOpen), raw(sd.open)),
        dayLow: pickNum(raw(price.regularMarketDayLow), raw(sd.dayLow)),
        dayHigh: pickNum(raw(price.regularMarketDayHigh), raw(sd.dayHigh)),
        yearLow: raw(sd.fiftyTwoWeekLow),
        yearHigh: raw(sd.fiftyTwoWeekHigh),
        marketCap: pickNum(raw(price.marketCap), raw(sd.marketCap)),
        eps: pickNum(raw(ks.trailingEps), raw(fd.epsTrailingTwelveMonths)),
        pe: pickNum(raw(sd.trailingPE), raw(price.trailingPE)),
        sharesOutstanding: pickNum(raw(ks.sharesOutstanding), raw(price.sharesOutstanding)),
        volume: pickNum(raw(price.regularMarketVolume), raw(sd.volume)),
        avgVolume: pickNum(raw(sd.averageVolume), raw(sd.averageDailyVolume10Day)),
        beta: pickNum(raw(sd.beta), raw(ks.beta)),
        dividendPerShare: pickNum(raw(sd.dividendRate), raw(sd.trailingAnnualDividendRate)),
        dividendYield: pickNum(frac(sd.dividendYield), frac(sd.trailingAnnualDividendYield)),
        priceToSales: raw(sd.priceToSalesTrailing12Months),
        priceToBook: raw(ks.priceToBook),
        roe: frac(fd.returnOnEquity),
        // Yahoo debtToEquity is a percent-like number (e.g. 150 ⇒ 1.5x)
        debtToEquity: raw(fd.debtToEquity) != null ? raw(fd.debtToEquity) / 100 : null,
        grossMargin: frac(fd.grossMargins),
        operatingMargin: frac(fd.operatingMargins),
        netMargin: frac(fd.profitMargins),
      },
      quarterly: {
        income: mapInc(get(result, "incomeStatementHistoryQuarterly.incomeStatementHistory")),
        cashflow: mapCF(get(result, "cashflowStatementHistoryQuarterly.cashflowStatements")),
      },
      annual: {
        income: mapInc(get(result, "incomeStatementHistory.incomeStatementHistory")),
        cashflow: mapCF(get(result, "cashflowStatementHistory.cashflowStatements")),
      },
    };

    return json(200, out);
  } catch (e) {
    return json(500, { error: "exception", message: String((e && e.message) || e) });
  }
};

// ---- helpers ----
const num = (v) => (v === null || v === undefined || v === "" || isNaN(v) ? null : Number(v));
const raw = (o) => {
  if (o === null || o === undefined) return null;
  if (typeof o === "object") return "raw" in o ? num(o.raw) : null;
  return num(o);
};
const pickNum = (...vals) => {
  for (const v of vals) if (v !== null && v !== undefined && !isNaN(v)) return Number(v);
  return null;
};
const dt = (o) => {
  const u = raw(o);
  if (u == null) return null;
  return new Date(u * 1000).toISOString().slice(0, 10);
};
const get = (obj, path) => path.split(".").reduce((a, k) => (a && a[k] != null ? a[k] : null), obj);
function json(code, body) {
  return {
    statusCode: code,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

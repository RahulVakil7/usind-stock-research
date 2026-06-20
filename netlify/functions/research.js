// POST /api/research  { fundamentals: {...} }
// Generates a critical equity-research note from the live financials using an
// OpenAI-compatible Chat Completions endpoint that serves OPEN-SOURCE models.
//
// Works with any OpenAI-compatible provider via env vars:
//   Groq (default):  LLM_BASE_URL=https://api.groq.com/openai/v1   LLM_MODEL=llama-3.3-70b-versatile
//   Together AI:     LLM_BASE_URL=https://api.together.xyz/v1      LLM_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
//   OpenRouter:      LLM_BASE_URL=https://openrouter.ai/api/v1     LLM_MODEL=meta-llama/llama-3.3-70b-instruct
//   Ollama (local):  LLM_BASE_URL=http://localhost:11434/v1        LLM_MODEL=llama3.1   LLM_API_KEY=ollama
// No SDK required — uses the built-in fetch (Node 18+).

const SYSTEM = `You are a skeptical, intellectually honest sell-side-grade equity research analyst.
You write tight, critical, evidence-based notes — never promotional, never hype. You weigh the bull and
bear cases fairly, interrogate the quality of earnings (one-offs, margin trajectory, cash conversion,
dilution, leverage), question the valuation, and call out concrete red flags. You cite the actual numbers
you are given (with units) rather than speaking in generalities. You are decisive: every note ends with a
clear, defensible stance — but you flag what would change your mind.

Output GitHub-flavored Markdown only, no preamble, using exactly these section headers:
## Business & moat
## Growth & quality of earnings
## Margins, cash flow & balance sheet
## Valuation
## Bull case
## Bear case & red flags
## Verdict
Under "Verdict", give a one-line stance (e.g. "Constructive but priced for perfection") and 2-3 sentences.
Keep the whole note ~650-900 words. Be specific, be critical, avoid filler.`;

exports.handler = async (event) => {
  const apiKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

  if (!apiKey) {
    return json(200, {
      research: null,
      error: "missing_llm_key",
      message:
        "LLM_API_KEY is not set. Add a free Groq key (or any OpenAI-compatible provider) in " +
        "Netlify → environment variables to enable AI research.",
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "bad_json" });
  }
  const f = body.fundamentals;
  if (!f || !f.symbol) return json(400, { error: "missing_fundamentals" });

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        // Optional headers some providers (e.g. OpenRouter) like to see — harmless elsewhere.
        "http-referer": "https://github.com/",
        "x-title": "AI & Tech Live Equity Research",
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 2600,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildPrompt(f) },
        ],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || `HTTP ${resp.status}`;
      return json(200, { research: null, error: "llm_error", status: resp.status, message: String(msg) });
    }

    const text =
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    return json(200, { research: String(text).trim(), model });
  } catch (e) {
    return json(200, { research: null, error: "llm_error", message: String((e && e.message) || e) });
  }
};

function buildPrompt(f) {
  const s = f.snapshot || {};
  const qi = (f.quarterly && f.quarterly.income) || [];
  const qc = (f.quarterly && f.quarterly.cashflow) || [];
  const ai = (f.annual && f.annual.income) || [];
  const ac = (f.annual && f.annual.cashflow) || [];

  const fmtRow = (r, cf) =>
    `${r.date} (${r.period || ""}): revenue=${b(r.revenue)} netIncome=${b(r.netIncome)} ` +
    `ebitda=${b(r.ebitda)} grossProfit=${b(r.grossProfit)} opIncome=${b(r.operatingIncome)} ` +
    `eps=${r.eps ?? "n/a"} netMargin=${r.netMargin == null ? "n/a" : (r.netMargin * 100).toFixed(1) + "%"}` +
    (cf ? ` ocf=${b(cf.operatingCashFlow)} fcf=${b(cf.freeCashFlow)} capex=${b(cf.capex)}` : "");

  const cfByDate = Object.fromEntries([...qc, ...ac].map((r) => [r.date, r]));

  const lines = [];
  lines.push(`COMPANY: ${f.name} (${f.symbol})`);
  lines.push(`Sector/Industry: ${f.sector || "?"} / ${f.industry || "?"}`);
  if (f.employees) lines.push(`Employees: ${f.employees}`);
  if (f.description) lines.push(`Profile: ${String(f.description).slice(0, 700)}`);
  lines.push("");
  lines.push("SNAPSHOT (live):");
  lines.push(
    `price=${s.price} prevClose=${s.previousClose} dayChange=${s.changesPercentage}% ` +
      `marketCap=${b(s.marketCap)} pe=${s.pe} eps=${s.eps} ` +
      `divYield=${s.dividendYield == null ? "n/a" : (s.dividendYield * 100).toFixed(2) + "%"} ` +
      `divPerShare=${s.dividendPerShare} 52wkLow=${s.yearLow} 52wkHigh=${s.yearHigh} beta=${s.beta}`
  );
  lines.push(
    `P/S=${fx(s.priceToSales)} P/B=${fx(s.priceToBook)} ROE=${pc(s.roe)} D/E=${fx(s.debtToEquity)} ` +
      `grossMargin=${pc(s.grossMargin)} opMargin=${pc(s.operatingMargin)} netMargin=${pc(s.netMargin)}`
  );
  lines.push("");
  lines.push(`QUARTERLY (last ${qi.length}, oldest->newest):`);
  qi.forEach((r) => lines.push("  " + fmtRow(r, cfByDate[r.date])));
  lines.push("");
  lines.push(`ANNUAL (last ${ai.length}, oldest->newest):`);
  ai.forEach((r) => lines.push("  " + fmtRow(r, cfByDate[r.date])));
  lines.push("");
  lines.push(
    "Write the critical research note now. Interrogate the QoQ and YoY trends above " +
      "(acceleration/deceleration, margin direction, cash conversion vs. reported earnings, " +
      "valuation vs. growth). Be specific and skeptical."
  );
  return lines.join("\n");
}

const b = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "n/a";
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  return String(n);
};
const fx = (n) => (n === null || n === undefined || isNaN(n) ? "n/a" : Number(n).toFixed(2));
const pc = (n) => (n === null || n === undefined || isNaN(n) ? "n/a" : (Number(n) * 100).toFixed(1) + "%");
function json(code, body) {
  return {
    statusCode: code,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

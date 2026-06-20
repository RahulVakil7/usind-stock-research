# Live Equity Research — US · NSE · BSE

A web app that pulls **realtime** quotes and financials for technology stocks across the **US**, **NSE
(India)** and **BSE (India)** markets, and generates an **AI-written critical research note** for each one.
Switch markets with the **US / NSE / BSE** toggle; **Refresh** cycles to the next companies; open any
company for quarterly &amp; annual financials and the analysis.

- **Market data — Yahoo Finance, no API key.** Covers US, NSE (`.NS`) and BSE (`.BO`): live price, EPS, P/E,
  dividend, market cap, 52-week range, plus QoQ (last ~4 quarters) and YoY (last ~4 years) of revenue, net
  income, EBITDA, net margin, operating cash flow and free cash flow.
- **AI research — open-source LLM** via any OpenAI-compatible provider (default: **Groq · Llama 3.3 70B**).
- **Currency-aware** ($ for US, ₹ for NSE/BSE).
- **Light, minimalist UI**, no build step, no runtime dependencies.

> ⚠️ **Disclaimer:** Informational/educational use only. **Not investment advice.** The note is a model's
> interpretation of live data, not a human analyst's. Verify figures independently.

## Why Yahoo Finance?

No free API cleanly covers **both** NSE and BSE with fundamentals. FMP (the previous source) only lists NSE
and has thin India coverage; paid keys are needed for its screener. Yahoo Finance covers all three markets
live with no key, which is why open-source tools like `yfinance` use it. The trade-off: Yahoo only exposes
~4 quarters and ~4 years of statement history for free (so QoQ/YoY show the last ~4 periods, not 12).

> Want deeper history or a true live screener for the US? You can point the functions at a paid provider —
> the data-mapping lives in `netlify/functions/stocks.js` and `fundamentals.js`.

## Architecture

A static frontend + three Netlify Functions (the LLM key stays server-side; Yahoo needs none).

```
ai-tech-live-research/
├── index.html              # Page shell + US/NSE/BSE selector
├── css/styles.css          # Light, minimalist theme
├── js/app.js               # Frontend: calls /api/*, currency-aware rendering
├── netlify/functions/
│   ├── stocks.js           # GET /api/stocks?page=N&market=US|NSE|BSE → live quotes (Yahoo)
│   ├── fundamentals.js     # GET /api/fundamentals?symbol=X → statements & ratios (Yahoo)
│   └── research.js         # POST /api/research → open-source LLM critical analysis
├── package.json            # no runtime deps
├── netlify.toml            # publish dir, functions dir, /api/* routing
├── .env.example
└── README.md
```

## Keys

| Variable | Needed? | Where |
|---|---|---|
| *(market data)* | **No key** | Yahoo Finance public endpoints |
| `LLM_API_KEY` | For AI research | Groq (free): https://console.groq.com/keys |
| `LLM_BASE_URL` / `LLM_MODEL` | Optional | defaults to Groq · `llama-3.3-70b-versatile` |

Open-source LLM providers (set the three `LLM_*` vars; all OpenAI-compatible):

| Provider | `LLM_BASE_URL` | Example `LLM_MODEL` |
|---|---|---|
| **Groq** (default) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Together AI | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1` (set `LLM_API_KEY=ollama`) |

## Run locally

```bash
npm install -g netlify-cli
cp .env.example .env          # add LLM_API_KEY (market data needs no key)
netlify dev                   # http://localhost:8888 with functions running
```

Opening `index.html` directly won't work — it needs the `/api/*` functions, so use `netlify dev` or deploy.

## Deploy to Netlify

1. Push to GitHub (below).
2. Netlify → **Add new site → Import an existing project → GitHub**, pick the repo.
3. Settings come from `netlify.toml` (no build command; publish `.`; functions `netlify/functions`).
4. **Site settings → Environment variables** → add `LLM_API_KEY` (+ optional `LLM_BASE_URL`/`LLM_MODEL`).
5. Deploy. No dependencies to install (functions use built-in `fetch`).

## Push to GitHub

```bash
cd ai-tech-live-research
git init
git add .
git commit -m "Live US/NSE/BSE research: Yahoo Finance data + open-source LLM analysis"
git branch -M main
git remote add origin https://github.com/<you>/ai-tech-live-research.git
git push -u origin main
```

## Customising

- **Add/remove companies** — edit the `UNIVERSE` lists (per market) in `netlify/functions/stocks.js`.
- **Companies per page** — `PAGE_SIZE` in `stocks.js`.
- **Analysis tone/depth** — the `SYSTEM` prompt in `netlify/functions/research.js`.
- **Model/provider** — `LLM_BASE_URL` / `LLM_MODEL` env vars.

## Notes / limitations

- Yahoo's endpoints are unofficial; the functions handle the cookie+crumb handshake and fall back to the
  crumb-free chart endpoint for prices if needed. If quotes briefly fail, hit **Refresh** again.
- Free statement history ≈ last 4 quarters / 4 years; per-period EBITDA is computed as EBIT + D&A.
- The universe is a curated tech list per market (there's no free cross-exchange screener); prices and
  financials are fully live. Extend the lists in `stocks.js` to broaden coverage.

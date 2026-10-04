# Seasonal Edge — Phase 2A

Local, rules-based Indian equity seasonality research. It contains no technical indicators, order placement, fabricated market data, or browser-exposed credentials.

## Included

- Server-only Dhan historical-data integration and Dhan security-master search
- A local `.data/seasonality-edge-db.json` database containing table-shaped storage for instruments, universe members, daily prices, download jobs, failures, and data-quality issues
- Current Nifty Midcap 150 and Nifty Smallcap 250 universe loading from NSE/Nifty Indices constituent CSV files
- Dhan Security ID mapping from the official detailed Dhan scrip master
- Daily OHLCV analysis for Dhan's available rolling five-year history
- Smart refresh behavior: new securities download from the required start date, existing securities request only dates after the latest stored trade date
- Duplicate prevention through a `security_id + trade_date` upsert key
- Controlled sequential refresh, retry/backoff for Dhan transient errors, failure logging, and retry of failed downloads
- Data Status workspace with per-universe counts, latest job progress, failures, export links, and Dhan connection status
- Monthly, quarterly, and every rolling 3-month return distribution
- Average, median, win rate, best/worst return, standard deviation, individual-year observations in the API response, and MAE / MAE percentile calculations
- Secure setup state when credentials are absent

## Run locally

1. Copy `.env.example` to `.env.local` and add `DHAN_CLIENT_ID` and `DHAN_ACCESS_TOKEN`. Do not use `NEXT_PUBLIC_` for these credentials.
2. Install packages with `npm install`.
3. Run `npm run dev`, then visit `http://localhost:3000`.

The browser only calls local `/api/*` routes. The historical request is made by the Next.js server to Dhan with the access token held in the server environment.

## Phase 2A data workflow

1. Open **Data Status**.
2. Use **Refresh Status** to inspect the local database.
3. Use **Refresh All Data** to load the current Midcap and Smallcap universes and download missing daily OHLCV data.
4. Use the per-universe **Refresh** buttons to refresh only MIDCAP or SMALLCAP.
5. Use **Retry Failed** after transient API failures.
6. Use **Export Universe** or **Export Failed** for CSV debugging.

Before running a full universe refresh, test a few known symbols from Stock Search such as RELIANCE, TATAELXSI, and INFY. The analysis endpoint now stores downloaded candles in the local database and reuses them on later requests.

## Universe sources

This implementation intentionally uses the current constituent universe only:

- MIDCAP: Nifty Midcap 150 current constituents from `https://www.niftyindices.com/IndexConstituent/ind_niftymidcap150list.csv`
- SMALLCAP: Nifty Smallcap 250 current constituents from `https://www.niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv`
- Dhan instrument master: `https://images.dhan.co/api-data/api-scrip-master-detailed.csv`

Historical analysis currently uses the current constituent universe and may contain survivorship bias. Historical index membership is not solved in Phase 2A.

## Method

Returns are calculated from the first available session’s open to the final session’s close for a period. MAE is `(lowest intraperiod low / entry open - 1) × 100`. Incomplete current-year observations are excluded from seasonality summary statistics. Cross-year rolling periods use actual date boundaries.

Portfolio slots, tranches, scanner, broker-position tracking, order placement, and trading decisions are intentionally deferred to subsequent phases.

## Data quality

Daily candles are stored exactly as returned by Dhan. The app validates date presence, numeric OHLCV, high/low relationships, non-negative prices and volume, date ordering, and duplicate dates. Bad records are flagged in `data_quality_issues`; they are not silently deleted.

The current `price_adjustment_status` is `UNKNOWN`. Verify whether Dhan’s returned historical series is adjusted for corporate actions before relying on five-year return calculations. Raw OHLCV and adjusted data are not treated as interchangeable.

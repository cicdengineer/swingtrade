# Seasonal Edge — Phase 2A

Local, rules-based Indian equity seasonality research. It contains no technical indicators, order placement, fabricated market data, or browser-exposed credentials.

## Included

- Server-only Dhan historical-data integration and Dhan security-master search
- A `.data/seasonality-edge-db.json` database for local development, with optional MySQL-backed JSON storage in production via `DATABASE_URL`
- Current Nifty Midcap 150 and Nifty Smallcap 250 universe loading from NSE/Nifty Indices constituent CSV files
- Dhan Security ID mapping from the official detailed Dhan scrip master
- Daily OHLCV analysis for Dhan's available rolling five-year history
- Smart refresh behavior: new securities download from the required start date, existing securities request only dates after the latest stored trade date
- Self-healing refresh behavior: existing securities request from their latest stored date through today, so skipped days are backfilled from Dhan Daily Historical data
- After the NSE close, when Dhan Daily has not posted today's candle yet, the app constructs today's daily OHLCV from completed 5-minute Dhan intraday candles and stores it in the same daily dataset
- Duplicate prevention through a `security_id + trade_date` upsert key; provisional candles are reconciled in place when Dhan Daily later returns the official candle
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

## Production storage and cron

Set `DATABASE_URL` in production to use MySQL instead of the local `.data` JSON file. The app stores the existing JSON database model in a single MySQL document row, so local development can keep using `.data/seasonality-edge-db.json` when `DATABASE_URL` is empty.

Run `scripts/mysql-init.sql` once in phpMyAdmin or your MySQL console to pre-create the table, or let the app create it on first access.

Set `DATA_REFRESH_SECRET`, then configure Hostinger cron to call:

```text
https://trade.jobpothe.com/api/cron/daily-refresh?secret=YOUR_DATA_REFRESH_SECRET
```

The endpoint also accepts `Authorization: Bearer YOUR_DATA_REFRESH_SECRET` or `x-data-refresh-secret: YOUR_DATA_REFRESH_SECRET`.

Recommended refresh schedule:

- 3:40 PM IST: create today's provisional EOD candles from completed intraday data if Dhan Daily is still missing today.
- 4:00 PM IST: retry the same refresh to catch transient failures.
- 6:00 AM IST next calendar day: reconcile provisional candles with official Dhan Daily candles.

If Hostinger cron is configured in UTC, use 10:10 UTC, 10:30 UTC, and 00:30 UTC respectively. If the account/server cron timezone is Asia/Kolkata, use the IST times directly.

Manual refresh uses the same path:

```bash
curl -X POST https://trade.jobpothe.com/api/data/refresh-universe \
  -H "content-type: application/json" \
  -d '{"forceUniverse":true}'
```

For cron-compatible authenticated refresh:

```bash
curl "https://trade.jobpothe.com/api/cron/daily-refresh?secret=YOUR_DATA_REFRESH_SECRET"
```

The latest status is available from:

```text
https://trade.jobpothe.com/api/data/status
```

To confirm whether a candle is provisional or official in MySQL, inspect the JSON shard for the security in `seasonality_json_collections` where `collection_name = 'daily_prices'`. Each daily row now includes:

```json
{
  "data_source": "DHAN_DAILY",
  "is_provisional": false
}
```

or:

```json
{
  "data_source": "DHAN_INTRADAY_AGGREGATED",
  "is_provisional": true
}
```

To force reconciliation for testing, run refresh after a provisional candle exists and Dhan Daily has started returning that same `trade_date`. The upsert key `security_id + trade_date` replaces the provisional row in place with `data_source = "DHAN_DAILY"` and `is_provisional = false`.

## Phase 2A data workflow

1. Open **Data Status**.
2. Use **Refresh Status** to inspect the local database.
3. Use **Refresh All Data** to load the current Midcap and Smallcap universes, backfill missing daily OHLCV data, reconcile provisional candles, and construct today's EOD candle from intraday data after market close when needed.
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

Daily official candles are stored as returned by Dhan. Provisional same-day candles are constructed from completed Dhan intraday candles during the NSE session window only. The app validates date presence, numeric OHLCV, high/low relationships, positive prices, non-negative volume, date ordering, duplicate dates, and a minimum reasonable intraday candle count. Bad records are flagged or skipped; fake candles are not generated for weekends, holidays, or days where Dhan returns no intraday trading data.

Dhan documents intraday history as candle OHLC and volume arrays, so provisional volume is calculated as `SUM(volume)` across valid completed intraday candles. If Dhan changes this to cumulative session volume in the future, adjust the aggregation in `aggregateIntradayToDaily()`.

The current `price_adjustment_status` is `UNKNOWN`. Verify whether Dhan’s returned historical series is adjusted for corporate actions before relying on five-year return calculations. Raw OHLCV and adjusted data are not treated as interchangeable.

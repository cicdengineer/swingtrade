"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Database,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Pin,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import type { SeasonalObservationRecord, SeasonalStatisticsRecord, Security, Summary, UniverseName } from "@/lib/types";

type View = "Dashboard" | "Stock Search" | "Data Status" | "Seasonality" | "Scanner" | "Swing Screener" | "30%Up" | "Early Breakout" | "Hourly Breakout" | "Momentum Tight" | "30 in 30" | "Dry Breakout" | "Portfolio" | "Backtest" | "Settings";
type DataSummary = { universe_name: UniverseName; total_constituents: number; mapped: number; stocks_downloaded: number; stocks_pending: number; stocks_failed: number; earliest_data_date: string | null; latest_data_date: string | null; total_ohlcv_rows: number; last_refresh: string | null; historical_sessions: number; latest_official?: number; latest_provisional?: number };
type DataDownloadJob = { id?: string; status: string; total: number; completed: number; remaining: number; successful: number; failed: number; current_stock?: string; current_status?: string; progress: number; started_at?: string; finished_at?: string; last_successful_update?: string; data_through_date?: string; notice?: string; pending_eod_count?: number; trading_date?: string; historical_candles_backfilled?: number; official_candles_updated?: number; provisional_candles_created?: number; provisional_candles_reconciled?: number; already_up_to_date?: number; errors: string[] };
type DataStatus = { dhan_connected: boolean; dhan_profile?: { ok: boolean; dhanClientId?: string; tokenValidity?: string; activeSegment?: string; dataPlan?: string; dataValidity?: string; error?: string }; database_size_bytes: number; price_adjustment_status: string; latest_market_data: null | { trading_date: string; official: number; provisional: number; data_status: string }; latest_job: null | DataDownloadJob; summaries: DataSummary[]; failures: { symbol: string; security_id: string; error_message: string; attempt_count: number; last_attempt: string }[]; quality_issues: unknown[]; universe_sources: Record<string, { label: string; url: string }> };
type WindowDef = { key: string; label: string; startMonth: number; endMonth: number };
type SeasonalityResponse = { windows: WindowDef[]; statistics: SeasonalStatisticsRecord[]; observations: SeasonalObservationRecord[]; exclusions: { symbol: string; window_key: string; occurrence_year: number; issue: string }[]; latestBuild: null | { finished_at: string; observations_generated: number; statistics_generated: number; excluded_observations: number; stocks_missing_sector: number }; sectors: string[]; missingSectorCount: number };
type Rule = { key: string; actual: number; pass: boolean; rule: string };
type CurrentSeason = { status: "COMPLETED" | "IN_PROGRESS" | "NO_DATA"; entry_date?: string; entry_price?: number; current_date?: string; current_price?: number; current_return_pct?: number; current_mae_pct?: number; current_mfe_pct?: number };
type ScannerResult = SeasonalStatisticsRecord & { evaluation: { eligible: boolean; checks: Rule[] }; currentSeason: CurrentSeason; current_vs_historical_median?: number; portfolio_contribution_pct?: number };
type ScannerSummary = { qualifiedStocks: number; evaluatedStocks: number; maxHistoricalObservationCount: number; minHistoricalObservationRequired: number; validCurrentSeasonData: number; missingCurrentSeasonData: number; winners: number; losers: number; flats: number; currentWinRate: number; equalWeightReturn: number; averageStockReturn: number; medianStockReturn: number; bestCurrentReturn: number; worstCurrentReturn: number; initialInvestment: number; currentPortfolioValue: number; currentPnl: number; historicalAverage: number; historicalMedian: number; top1Contribution: number; top3Contribution: number; distribution: { gt20: number; plus10To20: number; zeroTo10: number; minus10To0: number; ltMinus10: number } };
type ScannerResponse = { results: ScannerResult[]; evaluated: ScannerResult[]; sectorSummary: Record<string, number>; missingSectorCount: number; evaluationYear: number; allocationPerStock: number; summary: ScannerSummary };
type SwingFilters = { universe: "ALL" | UniverseName; breakoutLookbackDays: number; minBreakoutVolumeRatio: number; minPostBreakoutGainPct: number; minDistanceFromEmaPct: number; maxDistanceFromEmaPct: number; minDaysSinceBreakout: number; maxDaysSinceBreakout: number; requireRisingEma: boolean; maxCurrentVolumeRatio: number; showAll: boolean };
type SwingRow = { status: "NEAR 50 EMA" | "PULLBACK" | "EXTENDED" | "BROKEN BELOW 50 EMA" | "NO SETUP"; qualifies: boolean; security_id: string; symbol: string; company_name: string; universe_name: UniverseName; current_date: string; current_close: number; ema50: number; distance_from_ema_pct: number; breakout_date?: string; breakout_close?: number; breakout_volume_ratio?: number; days_since_breakout?: number; max_gain_after_breakout_pct?: number; pullback_from_high_pct?: number; current_volume_ratio?: number; ema50_slope_pct?: number; reason: string; recent: { trade_date: string; close: number; ema50?: number; volume: number; volume_ratio?: number }[] };
type SwingResponse = { filters: SwingFilters; evaluated: number; qualified: number; statusSummary: Record<string, number>; results: SwingRow[] };
type ThirtyUpFilters = { universe: "ALL" | UniverseName; lookbackDays: number; minMovePct: number; minImpulseVolumeRatio: number; minDistanceFromEmaPct: number; maxDistanceFromEmaPct: number; higherHighLookbackDays: number; minHigherHighCount: number; consolidationLookbackDays: number; minConsolidationDays: number; maxBasePullbackPct: number; maxBreakoutProximityPct: number; maxBreakoutOvershootPct: number; maxCurrentVolumeRatio: number; requireRisingEma: boolean; showAll: boolean; minCooloffDays?: number; maxRetracementPct?: number; requireCurrentBelowHigh?: boolean };
type DailyChartPoint = { trade_date: string; open: number; high: number; low: number; close: number; ema10?: number; ema50?: number; volume: number; volume_ratio?: number };
type ChartTimeframe = "daily" | "hourly";
type HourlySignalState = "loading" | "green" | "yellow" | "red" | "error";
type HourlySignal = { state: HourlySignalState; ltp?: number; ema50?: number; distancePct?: number; belowTwoDays?: boolean; label: string };
type LiveTick = { securityId: string; ltp: number; prevClose?: number; dayOpen?: number; dayHigh?: number; dayLow?: number; volume?: number; lastTradeTime?: number; receivedAt: number };
type LiveFeedStatus = "idle" | "connecting" | "live" | "error";
type LiveFeedStatusUpdate = { state?: LiveFeedStatus; message?: string };
type ThirtyUpSortKey = "status" | "symbol" | "universe" | "setup_path" | "hourly_signal" | "ltp" | "today_change" | "close" | "ema_dist" | "move" | "impulse_vol" | "higher_highs" | "base_days" | "base_depth" | "breakout_dist" | "current_vol" | "since_high" | "pullback" | "retrace";
type ThirtyUpRow = { status: "SETUP" | "WATCHLIST" | "NO 30% MOVE" | "WEAK VOLUME" | "BELOW 50 EMA" | "FAR FROM BREAKOUT"; qualifies: boolean; security_id: string; symbol: string; company_name: string; universe_name: UniverseName; current_date: string; current_close: number; ema50: number; distance_from_ema_pct: number; low_date?: string; low_close?: number; low_distance_from_ema_pct?: number; high_date?: string; high_close?: number; move_pct?: number; impulse_volume_ratio?: number; days_low_to_high?: number; days_since_high?: number; pullback_from_high_pct?: number; retracement_pct?: number; current_volume_ratio?: number; ema50_slope_pct?: number; higher_high_count?: number; consolidation_days?: number; base_low_date?: string; base_low_close?: number; base_depth_pct?: number; breakout_distance_pct?: number; reason: string; recent: DailyChartPoint[] };
type ThirtyUpResponse = { filters: ThirtyUpFilters; evaluated: number; qualified: number; statusSummary: Record<string, number>; results: ThirtyUpRow[] };
type ThirtyUpRunOptions = { silent?: boolean };
type EarlyBreakoutFilters = { universe: "ALL" | UniverseName; lookbackDays: number; minFirstMovePct: number; minImpulseVolumeRatio: number; minConsolidationDays: number; maxConsolidationDays: number; maxPullbackPct: number; maxBreakoutProximityPct: number; maxBreakoutOvershootPct: number; requireAboveEma: boolean; requireRisingEma: boolean; maxCurrentVolumeRatio: number; showAll: boolean };
type EarlyBreakoutSortKey = "status" | "symbol" | "universe" | "setup_path" | "hourly_signal" | "ltp" | "today_change" | "close" | "ema_dist" | "move" | "breakout_vol" | "consolidation" | "pullback" | "breakout_dist" | "current_vol";
type EarlyBreakoutRow = { status: "SETUP" | "WATCHLIST" | "TOO FAR FROM BREAKOUT" | "PULLBACK TOO DEEP" | "NO STRONG MOVE" | "WEAK VOLUME" | "BELOW 50 EMA" | "NO CONSOLIDATION"; qualifies: boolean; security_id: string; symbol: string; company_name: string; universe_name: UniverseName; current_date: string; current_close: number; ema50: number; distance_from_ema_pct: number; impulse_start_date?: string; impulse_start_close?: number; breakout_date?: string; breakout_close?: number; breakout_volume_ratio?: number; first_move_pct?: number; consolidation_days?: number; consolidation_low?: number; pullback_from_breakout_pct?: number; distance_to_breakout_pct?: number; current_volume_ratio?: number; ema50_slope_pct?: number; reason: string; recent: DailyChartPoint[] };
type EarlyBreakoutResponse = { filters: EarlyBreakoutFilters; evaluated: number; qualified: number; statusSummary: Record<string, number>; results: EarlyBreakoutRow[] };
type HourlyBreakoutFilters = { universe: "ALL" | UniverseName; lookbackDays: number; minConsolidationDays: number; maxPullbackPct: number; maxBreakoutProximityPct: number; maxBreakoutOvershootPct: number; minTrendGainPct: number; maxCurrentVolumeRatio: number; showAll: boolean };
type HourlyBreakoutSortKey = "status" | "symbol" | "universe" | "setup_path" | "hourly_signal" | "ltp" | "today_change" | "close" | "ema_dist" | "trend" | "consolidation" | "pullback" | "breakout_dist" | "current_vol";
type HourlyBreakoutRow = { status: "SETUP" | "BELOW 50 EMA" | "NOT GREEN" | "NO CONSOLIDATION" | "PULLBACK TOO DEEP" | "FAR FROM BREAKOUT"; qualifies: boolean; security_id: string; symbol: string; company_name: string; universe_name: UniverseName; current_date: string; current_close: number; ema50: number; distance_from_ema_pct: number; trend_gain_pct: number; consolidation_days: number; breakout_zone: number; breakout_distance_pct: number; pullback_from_zone_pct: number; current_volume_ratio?: number; reason: string; recent: DailyChartPoint[] };
type HourlyBreakoutResponse = { filters: HourlyBreakoutFilters; evaluated: number; qualified: number; statusSummary: Record<string, number>; results: HourlyBreakoutRow[] };
type MomentumSetupType = "MOMENTUM_CONTRACTION" | "TRENDING_TIGHT";
type MomentumContractionFilters = { universe: "ALL" | UniverseName; setupType: "ALL" | MomentumSetupType; emaLength: number; emaSlopeLookback: number; momentumLookback: number; minPriorMovePct: number; volumeAverageLength: number; expansionRelativeVolume: number; atrLength: number; tightRangeAtr: number; lowVolumeLookback: number; dryVolumeRatio: number; contractionLookback: number; minAverageDailyTradedValue: number; maxDistanceFromEmaPct: number; requireRisingEma: boolean; minSetupScore: number; showAll: boolean; debug: boolean };
type MomentumContractionRow = { status: MomentumSetupType | "BELOW_EMA" | "NO_MOMENTUM" | "NOT_TIGHT" | "VOLUME_NOT_DRY" | "ILLIQUID"; qualifies: boolean; security_id: string; symbol: string; company_name: string; universe_name: UniverseName; setupType: MomentumSetupType; setupScore: number; current_date: string; current_close: number; ema50: number; emaSlope: number; distance_from_ema_pct: number; priorMovePct: number; momentumRelativeVolume: number; atr14: number; rangeCompression: number; currentVolume: number; volumeSMA20: number; volumeSMA50: number; relativeVolume: number; volumePercentile: number; lowestVolume10: boolean; lowestVolume20: boolean; avgVolume5: number; avgVolume20: number; volumeContractionRatio: number; trendStructure: "HIGHER_HIGH_LOW" | "RISING" | "SIDEWAYS" | "WEAK"; averageDailyTradedValue: number; reason: string; diagnostics: { pass: boolean; label: string }[]; recent: DailyChartPoint[] };
type MomentumContractionResponse = { filters: MomentumContractionFilters; evaluated: number; qualified: number; statusSummary: Record<string, number>; results: MomentumContractionRow[]; generatedAt: string };
type ThirtyInThirtyFilters = { universe: "ALL" | UniverseName; lookbackDays: number; windowDays: number; minReturnPct: number; minAverageDailyTradedValue: number; positive3MonthsOnly: boolean; positive6MonthsOnly: boolean; above10EmaOnly: boolean; above50EmaOnly: boolean; nearPreviousDayHighOnly: boolean; upTodayOnly: boolean; nearSwingHighOnly: boolean; strongStartOnly: boolean; earlyVolumeOnly: boolean; highVolumeOnly: boolean; decliningVolumeOnly: boolean; dryVolumeOnly: boolean; redCandleOnly: boolean; showAll: boolean };
type ThirtyInThirtySortKey = "best_return" | "today_return" | "symbol" | "company" | "daily_sl_pct" | "hourly_sl_pct" | "pullback" | "near_3m_high" | "near_6m_high" | "breakout_3pct" | "closest_breakout" | "tight_5d" | "demand_supply" | "volume_dryness" | "recent";
type ThirtyInThirtyRow = { status: "ELIGIBLE" | "NO_30D_MOVE" | "ILLIQUID" | "FILTERED"; qualifies: boolean; security_id: string; symbol: string; company_name: string; universe_name: UniverseName; current_date: string; current_close: number; ema10: number; distance_from_10ema_pct: number; ema50: number; distance_from_ema_pct: number; best_return_pct: number; best_start_date?: string; best_start_close?: number; best_end_date?: string; best_end_close?: number; days_since_best_move: number; return_1m_pct: number; return_2m_pct: number; current_3m_return_pct: number; current_6m_return_pct: number; pullback_from_best_end_pct: number; pullback_from_3m_high_pct: number; pullback_from_6m_high_pct: number; breakout_level: number; breakout_distance_pct: number; within_3pct_breakout: boolean; tightness_5d_vs_20d: number; lowest_volume_5d_vs_20d: number; demand_supply_score: number; averageDailyTradedValue: number; reason: string; recent: DailyChartPoint[] };
type ThirtyInThirtyResponse = { filters: ThirtyInThirtyFilters; evaluated: number; qualified: number; statusSummary: Record<string, number>; results: ThirtyInThirtyRow[]; generatedAt: string };
type DryVolumeBreakoutFilters = { universe: "ALL" | UniverseName; minMovePct: number; moveWindowDays: number; impulseLookbackDays: number; minImpulseVolumeRatio: number; minPullbackDays: number; maxPullbackDays: number; minPullbackPct: number; maxPullbackPct: number; dryVolumeRatio: number; dryVolumeLookbackDays: number; breakoutWithinDays: number; stopBufferPct: number; maxDistanceToEntryPct: number; minAverageDailyTradedValue: number; showAll: boolean };
type DryVolumeBreakoutSortKey = "status" | "score" | "symbol" | "universe" | "ltp" | "entry" | "distance" | "sl_pct" | "dry_volume" | "days" | "impulse" | "pullback" | "ema10";
type DryVolumeBreakoutRow = { status: "WAIT" | "ENTRY"; qualifies: boolean; security_id: string; symbol: string; company_name: string; universe_name: UniverseName; current_date: string; current_close: number; entry_price?: number; stop_loss?: number; sl_pct?: number; ltp_to_entry_pct?: number; dry_candle_date?: string; dry_candle_high?: number; dry_candle_low?: number; dry_candle_volume_ratio?: number; days_since_dry_candle?: number; impulse_return_pct?: number; impulse_volume_ratio?: number; pullback_pct?: number; pullback_days?: number; pullback_volume_ratio?: number; ema10?: number; distance_from_10ema_pct?: number; score: number; rank: number; averageDailyTradedValue: number; reason: string; recent: Array<DailyChartPoint & { ema10?: number; volume_ratio?: number }> };
type DryVolumeBreakoutResponse = { filters: DryVolumeBreakoutFilters; evaluated: number; qualified: number; statusSummary: Record<string, number>; snapshotDate: string; results: DryVolumeBreakoutRow[]; generatedAt: string };
type BreakoutChartRow = { security_id: string; symbol: string; company_name: string; current_date: string; current_close: number; ema50: number; distance_from_ema_pct: number; reason: string; recent: DailyChartPoint[] };
type FilterKey = "minAverage" | "minMedian" | "minWinRate" | "minN" | "maxAvgMedianGap" | "minMaeP75" | "minWorstReturn";
type Filters = Record<FilterKey, { enabled: boolean; value: number }>;
type PortfolioHolding = { exchange: string; tradingSymbol: string; securityId: string; isin: string; totalQty: number; dpQty: number; t1Qty: number; availableQty: number; collateralQty: number; avgCostPrice: number; invested: number; unrealizedPnl: number; dayPnl: number; productType: string; positionType: string; currentPrice?: number; todayChangePct?: number; ema10?: number; distanceFrom10EmaPct?: number; brokerEntryDate?: string; brokerCalendarDaysHeld?: number; brokerTradingDaysHeld?: number; brokerOpenLots?: number };
type ClosedTrade = { date: string; symbol: string; securityId: string; quantity: number; buyPrice: number; sellPrice: number; grossPnl: number; charges: number; netPnl: number };
type TradingSettings = { id: "default"; totalCapital: number; riskPercent: number; defaultStopSource: "Setup Candle Low" | "Manual"; defaultManagementTimeframe: "Daily" | "Hourly"; initialManagementDays: number; partialStartDay: number; partialEndDay: number; partialPercent: number; partialMinR: number; defaultTrailMA: "10 EMA" | "20 EMA" | "Manual"; moveStopToBreakevenAfterPartial: boolean; exitConfirmationRule: "Close below EMA" | "Intraday break" | "2 closes below EMA"; portfolioRiskNormalPct: number; portfolioRiskElevatedPct: number; portfolioRiskHighPct: number };
type TradeEvent = { id: string; managedTradeId: string; eventType: string; timestamp: string; price?: number; quantity?: number; notes?: string; source: string };
type ManagedTradeView = { id: string; broker: "DHAN" | "MANUAL"; symbol: string; companyName?: string; exchange: string; instrumentId?: string; isin?: string; strategy: string; status: "ACTIVE" | "RECONCILIATION_REQUIRED" | "CLOSED"; entryDate: string; averageEntry: number; initialStop: number; plannedStop: number; initialRiskPerShare: number; initialRiskAmount: number; trailMethod: "10 EMA" | "20 EMA" | "Manual"; managementTimeframe: "Daily" | "Hourly"; partialTaken: boolean; protectedStopRecorded: boolean; source: "30UP" | "BROKER_HOLDING" | "MANUAL"; quantity: number; brokerQuantity: number | null; brokerEntryDate?: string; brokerCalendarDaysHeld?: number; tradingDaysHeld: number; calendarDaysHeld: number; currentPrice: number; unrealizedPnl: number; unrealizedPnlPct: number; rMultiple: number; peakR: number; ema10?: number; ema20?: number; distanceFrom10EmaPct?: number; distanceFrom20EmaPct?: number; currentOpenRisk: number; currentOpenRiskPct: number; initialRiskPct: number; stage: "INITIAL RISK" | "EARLY HOLD" | "PARTIAL PROFIT WINDOW" | "BREAKEVEN / PROTECTED" | "RUNNER" | "TREND TRAIL" | "EXIT WARNING" | "CLOSED"; instruction: string; recommendedAction: string; nextReview: string; events: TradeEvent[] };
type TradeManagementSnapshot = { settings: TradingSettings; trades: ManagedTradeView[]; summary: { totalCapital: number; riskPercent: number; riskUnit: number; managedTrades: number; tradesAtInitialRisk: number; protectedTrades: number; runners: number; totalCurrentOpenRisk: number; portfolioOpenRiskPct: number; unrealizedPnl: number; realizedSwingPnl: number; averageR: number; medianR: number; largestWinnerR: number; largestLoserR: number; riskLevel: "Normal" | "Elevated" | "High" } };
type BasketBacktestFilters = { strategyMode: "PULLBACK_RECLAIM" | "RS_TIGHT_2025" | "DRY_VOLUME_BREAKOUT" | "DRY_VOLUME_BREAKOUT_QULLAMAGGIE" | "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RANDOM" | "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM"; universe: "ALL" | UniverseName; initialCapital: number; compoundEquity: boolean; basketSize: number; maxRiskPerTradePct: number; maxOpenRiskPct: number; exitRankBelow: number; breadthMin: number; exitBreadthBelow: number; minRs60: number; maxEntryVolumeRatio: number; exitBelow20Ema: boolean; minMovePct: number; moveWindowDays: number; impulseLookbackDays: number; minImpulseVolumeRatio: number; minPullbackDays: number; maxPullbackDays: number; minPullbackPct: number; maxPullbackPct: number; maxPullbackVolumeRatio: number; dryVolumeRatio: number; dryVolumeLookbackDays: number; breakoutWithinDays: number; maxDistanceToEntryPct: number; stopBufferPct: number; partialExitDay: number; target1R: number; target1ExitPct: number; target2R: number; target2ExitPct: number; exitBelow10Ema: boolean; startDate: string; endDate: string };
type BasketCandidate = { rank: number; security_id: string; symbol: string; company_name: string; close: number; entry_price?: number; stop_loss?: number; signal_date?: string; score: number; trigger: boolean; entry_triggered?: boolean; impulse_return_pct: number; impulse_volume_ratio: number; pullback_pct: number; pullback_days: number; pullback_volume_ratio: number; distance_from_10ema_pct: number; reason: string; blocked_reason?: string };
type BasketHolding = { security_id: string; symbol: string; company_name: string; entry_date: string; entry_price: number; quantity: number; current_price: number; stop_loss?: number; market_value: number; pnl: number; pnl_pct: number; open_risk?: number; open_risk_pct?: number; rank?: number; score?: number };
type BasketEvent = { date: string; type: "BUY" | "SELL"; symbol: string; reason: string; price: number; quantity: number; amount: number; pnl?: number };
type BasketSnapshot = { date: string; equity: number; cash: number; invested: number; drawdown_pct: number; day_pnl: number; candidates: BasketCandidate[]; holdings: BasketHolding[]; events: BasketEvent[] };
type BasketBacktestResult = { filters: BasketBacktestFilters; summary: { startDate: string; endDate: string; initialCapital: number; finalEquity: number; totalReturnPct: number; maxDrawdownPct: number; trades: number; closedTrades: number; winRate: number; bestTradePct: number; worstTradePct: number; averageTradePct: number }; snapshots: BasketSnapshot[]; finalHoldings: BasketHolding[]; trades: BasketEvent[]; generatedAt: string };
type PositionSizingResult = { valid: boolean; errors: string[]; riskAmount: number; riskPerShare: number; quantity: number; positionValue: number; capitalUsagePercent: number; stopLossPercent: number };
type PortfolioResponse = {
  holdings: PortfolioHolding[];
  positions: unknown[];
  trades: unknown[];
  closedTrades: ClosedTrade[];
  equityCurve: { date: string; pnl: number; cumulative: number }[];
  monthlyPnl: { month: string; pnl: number }[];
  stats: { financialYear: string; from: string; to: string; totalTrades: number; closedTrades: number; realizedPnl: number; grossPnl: number; charges: number; unrealizedPnl: number; totalInvested: number; portfolioPnl: number; winners: number; losers: number; winRate: number; averageWin: number; averageLoss: number; maxProfit: number; maxLoss: number; drawdown: number; winLossRatio: number };
  tradeManagement?: TradeManagementSnapshot;
  source?: { tradeHistoryFrom: string; tradeHistoryTo: string; inventoryHistoryFrom?: string; rawTrades: number; closedLots: number };
};

const nav: { name: View; icon: typeof Activity }[] = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Portfolio", icon: WalletCards },
  { name: "Stock Search", icon: Search },
  { name: "Data Status", icon: Database },
  { name: "30 in 30", icon: TrendingUp },
  { name: "Dry Breakout", icon: ShieldCheck },
  { name: "Backtest", icon: BarChart3 },
  { name: "Settings", icon: Settings },
];
const defaultFilters: Filters = {
  minAverage: { enabled: true, value: 10 },
  minMedian: { enabled: true, value: 7 },
  minWinRate: { enabled: true, value: 60 },
  minN: { enabled: true, value: 5 },
  maxAvgMedianGap: { enabled: true, value: 5 },
  minMaeP75: { enabled: true, value: -10 },
  minWorstReturn: { enabled: true, value: -15 },
};
const defaultSwingFilters: SwingFilters = {
  universe: "ALL",
  breakoutLookbackDays: 120,
  minBreakoutVolumeRatio: 1.8,
  minPostBreakoutGainPct: 8,
  minDistanceFromEmaPct: -3,
  maxDistanceFromEmaPct: 5,
  minDaysSinceBreakout: 10,
  maxDaysSinceBreakout: 90,
  requireRisingEma: true,
  maxCurrentVolumeRatio: 1.5,
  showAll: false,
};
const defaultThirtyUpFilters: ThirtyUpFilters = {
  universe: "ALL",
  lookbackDays: 63,
  minMovePct: 30,
  minImpulseVolumeRatio: 1.8,
  minDistanceFromEmaPct: 0,
  maxDistanceFromEmaPct: 25,
  higherHighLookbackDays: 35,
  minHigherHighCount: 3,
  consolidationLookbackDays: 25,
  minConsolidationDays: 5,
  maxBasePullbackPct: 12,
  maxBreakoutProximityPct: 3,
  maxBreakoutOvershootPct: 2,
  maxCurrentVolumeRatio: 2,
  requireRisingEma: true,
  showAll: false,
};
const defaultEarlyBreakoutFilters: EarlyBreakoutFilters = {
  universe: "ALL",
  lookbackDays: 65,
  minFirstMovePct: 30,
  minImpulseVolumeRatio: 1.8,
  minConsolidationDays: 5,
  maxConsolidationDays: 25,
  maxPullbackPct: 7,
  maxBreakoutProximityPct: 3,
  maxBreakoutOvershootPct: 1,
  requireAboveEma: true,
  requireRisingEma: true,
  maxCurrentVolumeRatio: 1.8,
  showAll: false,
};
const defaultHourlyBreakoutFilters: HourlyBreakoutFilters = {
  universe: "ALL",
  lookbackDays: 25,
  minConsolidationDays: 5,
  maxPullbackPct: 8,
  maxBreakoutProximityPct: 3,
  maxBreakoutOvershootPct: 1,
  minTrendGainPct: 0,
  maxCurrentVolumeRatio: 2,
  showAll: false,
};
const defaultMomentumContractionFilters: MomentumContractionFilters = {
  universe: "ALL",
  setupType: "ALL",
  emaLength: 50,
  emaSlopeLookback: 5,
  momentumLookback: 60,
  minPriorMovePct: 15,
  volumeAverageLength: 20,
  expansionRelativeVolume: 1.5,
  atrLength: 14,
  tightRangeAtr: 0.6,
  lowVolumeLookback: 20,
  dryVolumeRatio: 0.4,
  contractionLookback: 10,
  minAverageDailyTradedValue: 10000000,
  maxDistanceFromEmaPct: 25,
  requireRisingEma: true,
  minSetupScore: 55,
  showAll: false,
  debug: false,
};
const defaultThirtyInThirtyFilters: ThirtyInThirtyFilters = {
  universe: "ALL",
  lookbackDays: 126,
  windowDays: 30,
  minReturnPct: 30,
  minAverageDailyTradedValue: 0,
  positive3MonthsOnly: false,
  positive6MonthsOnly: false,
  above10EmaOnly: false,
  above50EmaOnly: false,
  nearPreviousDayHighOnly: false,
  upTodayOnly: false,
  nearSwingHighOnly: false,
  strongStartOnly: false,
  earlyVolumeOnly: false,
  highVolumeOnly: false,
  decliningVolumeOnly: false,
  dryVolumeOnly: false,
  redCandleOnly: false,
  showAll: false,
};
const defaultDryVolumeBreakoutFilters: DryVolumeBreakoutFilters = {
  universe: "ALL",
  minMovePct: 30,
  moveWindowDays: 30,
  impulseLookbackDays: 90,
  minImpulseVolumeRatio: 1.2,
  minPullbackDays: 3,
  maxPullbackDays: 35,
  minPullbackPct: 3,
  maxPullbackPct: 25,
  dryVolumeRatio: 0.4,
  dryVolumeLookbackDays: 5,
  breakoutWithinDays: 4,
  stopBufferPct: 0.5,
  maxDistanceToEntryPct: 4,
  minAverageDailyTradedValue: 0,
  showAll: false,
};
const defaultBasketBacktestFilters: BasketBacktestFilters = {
  strategyMode: "DRY_VOLUME_BREAKOUT",
  universe: "ALL",
  initialCapital: 1000000,
  compoundEquity: true,
  basketSize: 3,
  maxRiskPerTradePct: 0.3,
  maxOpenRiskPct: 2,
  exitRankBelow: 9,
  breadthMin: 0,
  exitBreadthBelow: 0,
  minRs60: 24,
  maxEntryVolumeRatio: 1.8,
  exitBelow20Ema: true,
  minMovePct: 30,
  moveWindowDays: 30,
  impulseLookbackDays: 90,
  minImpulseVolumeRatio: 1.2,
  minPullbackDays: 3,
  maxPullbackDays: 35,
  minPullbackPct: 3,
  maxPullbackPct: 25,
  maxPullbackVolumeRatio: 0.85,
  dryVolumeRatio: 0.4,
  dryVolumeLookbackDays: 5,
  breakoutWithinDays: 4,
  maxDistanceToEntryPct: 3,
  stopBufferPct: 0.5,
  partialExitDay: 3,
  target1R: 3,
  target1ExitPct: 30,
  target2R: 9,
  target2ExitPct: 30,
  exitBelow10Ema: true,
  startDate: "2026-08-01",
  endDate: "2026-12-30",
};
const filterLabels: Record<FilterKey, string> = {
  minAverage: "Minimum Average Return",
  minMedian: "Minimum Median Return",
  minWinRate: "Minimum Historical Win Rate",
  minN: "Minimum N",
  maxAvgMedianGap: "Maximum Avg-Median Gap",
  minMaeP75: "Minimum acceptable P75 MAE",
  minWorstReturn: "Minimum acceptable Worst Return",
};
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const money = (n: number) => `₹${n.toFixed(2)}`;
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct2 = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const rValue = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
const tradingViewUrl = (symbol: string) => `https://in.tradingview.com/chart/05Iji3dY/?symbol=${encodeURIComponent(`NSE:${symbol.trim().toUpperCase()}`)}`;
const staleDataJobMs = 2 * 60 * 1000;
const thirtyInThirtyDryVolumeRatio = 0.4;
const thirtyInThirtyDryVolumeLookback = 5;
const dataJobActivityTime = (job?: DataDownloadJob | null) => job ? Date.parse(job.last_successful_update ?? job.started_at ?? "") : NaN;
const isActiveDataJob = (job?: DataDownloadJob | null) => {
  if (!job || !["queued", "running"].includes(job.status)) return false;
  const activityTime = dataJobActivityTime(job);
  return !Number.isFinite(activityTime) || Date.now() - activityTime <= staleDataJobMs;
};
const intradayCache = new Map<string, { rows: DailyChartPoint[]; fetchedAt: number }>();
const intradayRequests = new Map<string, Promise<DailyChartPoint[]>>();
const intradayCacheMs = 60_000;
const thirtyInThirtyLiveFeedLimit = 80;
const currentWindow = () => {
  const month = new Date().getMonth();
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return { current: `${names[month]}-${names[(month + 2) % 12]}`, next: `${names[(month + 1) % 12]}-${names[(month + 3) % 12]}` };
};

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    const title = text.match(/<title>(.*?)<\/title>/i)?.[1]?.trim();
    throw new Error(`${fallbackMessage}: HTTP ${response.status}${title ? ` - ${title}` : ""}`);
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `${fallbackMessage}: HTTP ${response.status}`);
  return body as T;
}

function parseServerSentEvents(chunk: string, onEvent: (event: string, data: string) => void) {
  const lines = chunk.split(/\r?\n/);
  let event = "message";
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length) onEvent(event, data.join("\n"));
}

async function fetchThirtyUpIntraday(securityId: string, force = false, endpoint = "thirty-up-screener") {
  const cached = intradayCache.get(securityId);
  if (!force && cached && Date.now() - cached.fetchedAt < intradayCacheMs) return cached.rows;
  const existing = intradayRequests.get(securityId);
  if (!force && existing) return existing;
  const request = fetch(`/api/${endpoint}/${securityId}/intraday?interval=60&days=30`)
    .then(async (response) => {
      const body = await readJsonResponse<{ candles: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> }>(response, "Intraday data unavailable");
      return (body.candles as Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>).map((candle) => ({
        trade_date: candle.date,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      }));
    })
    .then((rows) => {
      intradayCache.set(securityId, { rows, fetchedAt: Date.now() });
      return rows;
    })
    .finally(() => intradayRequests.delete(securityId));
  intradayRequests.set(securityId, request);
  return request;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

type TileTone = "good" | "average" | "bad" | "neutral";

function StrategyStat({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: TileTone }) {
  return <div className={`strategy-stat ${tone}`}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-logo ${compact ? "compact" : ""}`}><img src="/brand/jobpothe-logo-cropped.png" alt="JobPothe" /></span>;
}

const lastTradingMonths = (rows: DailyChartPoint[], sessions = 63) => rows.slice(-sessions);
const scaleValue = (value: number, min: number, max: number, height: number, pad = 3) => {
  const range = max - min || 1;
  return pad + ((max - value) / range) * (height - pad * 2);
};
const polylinePath = (values: number[], width: number, height: number) => {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((value, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(2)} ${scaleValue(value, min, max, height).toFixed(2)}`).join(" ");
};
const smaValues = (values: number[], period: number) => values.map((_, index) => {
  if (index + 1 < period) return undefined;
  const slice = values.slice(index - period + 1, index + 1);
  return slice.reduce((sum, value) => sum + value, 0) / period;
});
const rsiValues = (closes: number[], period = 14) => closes.map((_, index) => {
  if (index < period) return undefined;
  let gains = 0;
  let losses = 0;
  for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
    const change = closes[cursor] - closes[cursor - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
});
const stochRsiDValues = (closes: number[]) => {
  const rsi = rsiValues(closes);
  const k = rsi.map((value, index) => {
    if (value === undefined || index < 27) return undefined;
    const window = rsi.slice(index - 13, index + 1).filter((item): item is number => item !== undefined);
    if (window.length < 14) return undefined;
    const min = Math.min(...window);
    const max = Math.max(...window);
    return max === min ? 0 : ((value - min) / (max - min)) * 100;
  });
  return smaValues(k.map((value) => value ?? NaN), 3).map((value) => Number.isFinite(value) ? value : undefined);
};
const emaValues = (values: number[], period = 50) => {
  const multiplier = 2 / (period + 1);
  let previous: number | undefined;
  return values.map((value, index) => {
    if (index + 1 < period) return undefined;
    if (previous === undefined) previous = values.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item, 0) / period;
    else previous = value * multiplier + previous * (1 - multiplier);
    return previous;
  });
};
const chartDateLabel = (value: string, timeframe: ChartTimeframe) => {
  if (timeframe === "daily") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
};
const isWeekendDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00+05:30`);
  const day = parsed.getDay();
  return day === 0 || day === 6;
};
const aggregateIntradayDaily = (candles: DailyChartPoint[]): DailyChartPoint | null => {
  const tradedCandles = candles.filter((candle) => candle.volume > 0);
  if (!tradedCandles.length) return null;
  const latestDate = tradedCandles.at(-1)!.trade_date.slice(0, 10);
  if (isWeekendDate(latestDate)) return null;
  const todayCandles = tradedCandles.filter((candle) => candle.trade_date.slice(0, 10) === latestDate);
  if (!todayCandles.length) return null;
  return {
    trade_date: latestDate,
    open: todayCandles[0].open,
    high: Math.max(...todayCandles.map((candle) => candle.high)),
    low: Math.min(...todayCandles.map((candle) => candle.low)),
    close: todayCandles.at(-1)!.close,
    volume: todayCandles.reduce((sum, candle) => sum + candle.volume, 0),
  };
};
const mergeLiveDailyCandle = (dailyRows: DailyChartPoint[], liveDaily: DailyChartPoint | null) => {
  if (!liveDaily) return dailyRows;
  const rows = [...dailyRows];
  const existingIndex = rows.findIndex((row) => row.trade_date === liveDaily.trade_date);
  if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...liveDaily, ema10: rows[existingIndex].ema10, ema50: rows[existingIndex].ema50, volume_ratio: rows[existingIndex].volume_ratio };
  else if (liveDaily.volume > 0 && (!rows.length || liveDaily.trade_date > rows.at(-1)!.trade_date)) rows.push(liveDaily);
  return rows;
};
const liveTradeDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const pctChange = (from: number | undefined, to: number) => from && from > 0 ? ((to / from) - 1) * 100 : 0;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const liveAdjustedThirtyInThirty = (row: ThirtyInThirtyRow, tick?: LiveTick): ThirtyInThirtyRow => {
  if (!tick?.ltp) return row;
  const liveClose = tick.ltp;
  const today = liveTradeDate();
  const recent = [...row.recent];
  const last = recent.at(-1);
  const previousVolumeAverage = average(recent.slice(-20).map((point) => point.volume));
  const liveVolumeRatio = tick.volume !== undefined && previousVolumeAverage > 0 ? tick.volume / previousVolumeAverage : undefined;
  const liveDaily = {
    trade_date: today,
    open: tick.dayOpen ?? tick.prevClose ?? liveClose,
    high: Math.max(tick.dayHigh ?? liveClose, liveClose),
    low: Math.min(tick.dayLow ?? liveClose, liveClose),
    close: liveClose,
    ema10: row.ema10,
    ema50: row.ema50,
    volume: tick.volume ?? 0,
    volume_ratio: liveVolumeRatio,
  };
  if (last?.trade_date === today) {
    recent[recent.length - 1] = {
      ...last,
      ...liveDaily,
      open: tick.dayOpen ?? last.open,
      high: Math.max(last.high, liveDaily.high),
      low: Math.min(last.low, liveDaily.low),
      volume: tick.volume ?? last.volume,
      volume_ratio: liveVolumeRatio ?? last.volume_ratio,
    };
  } else if (!last || today > last.trade_date) recent.push(liveDaily);
  const rows3m = lastTradingMonths(recent, 63);
  const rows6m = lastTradingMonths(recent, 126);
  const high3m = rows3m.length ? Math.max(...rows3m.map((point) => point.high)) : row.breakout_level;
  const high6m = rows6m.length ? Math.max(...rows6m.map((point) => point.high)) : high3m;
  const breakoutDistance = pctChange(row.breakout_level, liveClose);
  const distanceFrom10Ema = pctChange(row.ema10, liveClose);
  const distanceFromEma = pctChange(row.ema50, liveClose);
  return {
    ...row,
    current_date: today,
    current_close: liveClose,
    distance_from_10ema_pct: distanceFrom10Ema,
    distance_from_ema_pct: distanceFromEma,
    return_1m_pct: pctChange(lastTradingMonths(recent, 21)[0]?.close, liveClose),
    return_2m_pct: pctChange(lastTradingMonths(recent, 42)[0]?.close, liveClose),
    current_3m_return_pct: pctChange(rows3m[0]?.close, liveClose),
    current_6m_return_pct: pctChange(rows6m[0]?.close, liveClose),
    pullback_from_3m_high_pct: pctChange(high3m, liveClose),
    pullback_from_6m_high_pct: pctChange(high6m, liveClose),
    breakout_distance_pct: breakoutDistance,
    within_3pct_breakout: breakoutDistance >= -3 && breakoutDistance <= 0,
    recent,
  };
};
const todayReturnPct = (row: ThirtyInThirtyRow, tick?: LiveTick) => {
  const previousClose = tick?.prevClose ?? previousDailyRow(row)?.close;
  return previousClose ? pctChange(previousClose, row.current_close) : undefined;
};
const previousDailyRow = (row: ThirtyInThirtyRow) => row.recent.at(-2) ?? row.recent.at(-1);
const currentVolumeRatio = (row: ThirtyInThirtyRow) => {
  const latest = row.recent.at(-1);
  if (latest?.trade_date === liveTradeDate() && latest.volume_ratio !== undefined) return latest.volume_ratio;
  return [...row.recent].reverse().find((point) => point.volume > 0)?.volume_ratio ?? 0;
};
const isNearPreviousDayHigh = (row: ThirtyInThirtyRow) => {
  const previous = previousDailyRow(row);
  if (!previous?.high) return false;
  return ((row.current_close / previous.high) - 1) * 100 >= -0.5;
};
const isBreakingPreviousDayHigh = (row: ThirtyInThirtyRow) => {
  const previous = previousDailyRow(row);
  return Boolean(row.recent.at(-1)?.trade_date === liveTradeDate() && previous?.high && row.current_close > previous.high);
};
const isUpToday = (row: ThirtyInThirtyRow, tick?: LiveTick) => {
  const todayReturn = todayReturnPct(row, tick);
  return todayReturn !== undefined && todayReturn > 0;
};
const isStrongStart = (row: ThirtyInThirtyRow, tick?: LiveTick) => {
  const previous = previousDailyRow(row);
  const open = tick?.dayOpen;
  return Boolean(open && previous?.close && previous?.high && open > previous.close && open < previous.high);
};
const isNearSwingHigh = (row: ThirtyInThirtyRow) => {
  const recentHigh = Math.max(...row.recent.slice(-21, -1).map((point) => point.high));
  return Number.isFinite(recentHigh) && ((row.current_close / recentHigh) - 1) * 100 >= -1;
};
const hasDryVolumeStreak = (row: ThirtyInThirtyRow, minDays = 5) => {
  const today = liveTradeDate();
  const volumes = row.recent.filter((point) => point.trade_date !== today).map((point) => point.volume).filter((volume) => volume > 0);
  if (volumes.length < minDays) return false;
  let streakDays = 1;
  for (let index = volumes.length - 1; index > 0; index -= 1) {
    if (volumes[index] < volumes[index - 1]) streakDays += 1;
    else break;
  }
  return streakDays >= minDays;
};
const hasDryVolumeRatio = (row: ThirtyInThirtyRow, maxRatio = thirtyInThirtyDryVolumeRatio, lookbackDays = thirtyInThirtyDryVolumeLookback) => {
  const today = liveTradeDate();
  const completed = row.recent.filter((point) => point.trade_date !== today && point.volume > 0);
  if (completed.length <= lookbackDays) return false;
  const latest = completed.at(-1)!;
  const baseline = completed.slice(-(lookbackDays + 1), -1);
  const averageVolume = average(baseline.map((point) => point.volume));
  return averageVolume > 0 && latest.volume / averageVolume <= maxRatio;
};
const latestCompletedDailyRow = (row: ThirtyInThirtyRow) => {
  const today = liveTradeDate();
  return [...row.recent].reverse().find((point) => point.trade_date !== today);
};
const closedRedPreviousSession = (row: ThirtyInThirtyRow) => {
  const latestCompleted = latestCompletedDailyRow(row);
  return Boolean(latestCompleted && latestCompleted.close < latestCompleted.open);
};
const latestDailyStop = (rows: DailyChartPoint[]) => {
  return rows.at(-1)?.low;
};
const latestHourlyStop = (rows: DailyChartPoint[]) => rows.at(-1)?.low;
const stopLossPct = (entry: number, stop?: number) => entry > 0 && stop !== undefined && stop > 0 && entry > stop ? ((entry - stop) / entry) * 100 : undefined;
const positionSizingFromStop = (entry: number, stop: number | undefined, settings?: TradingSettings | null) => {
  const riskUnit = settings ? settings.totalCapital * settings.riskPercent / 100 : 0;
  if (!settings || !stop || stop <= 0) return { quantity: 0, value: 0, riskPerShare: 0, riskUnit, valid: false };
  const riskPerShare = entry - stop;
  if (entry <= 0 || riskPerShare <= 0) return { quantity: 0, value: 0, riskPerShare, riskUnit, valid: false };
  const quantity = Math.floor(riskUnit / riskPerShare);
  return { quantity, value: quantity * entry, riskPerShare, riskUnit, valid: quantity > 0 };
};
const toneFromRange = (value: number | undefined, good: (value: number) => boolean, average: (value: number) => boolean): TileTone => {
  if (value === undefined || Number.isNaN(value)) return "neutral";
  if (good(value)) return "good";
  if (average(value)) return "average";
  return "bad";
};
const matchesThirtyInThirtyFilters = (row: ThirtyInThirtyRow, filters: ThirtyInThirtyFilters, tick?: LiveTick) =>
  (!filters.positive3MonthsOnly || row.current_3m_return_pct > 0) &&
  (!filters.positive6MonthsOnly || row.current_6m_return_pct > 0) &&
  (!filters.above10EmaOnly || row.current_close > row.ema10) &&
  (!filters.above50EmaOnly || row.distance_from_ema_pct >= 0) &&
  (!filters.nearPreviousDayHighOnly || isNearPreviousDayHigh(row)) &&
  (!filters.upTodayOnly || isUpToday(row, tick)) &&
  (!filters.nearSwingHighOnly || isNearSwingHigh(row)) &&
  (!filters.strongStartOnly || isStrongStart(row, tick)) &&
  (!filters.earlyVolumeOnly || currentVolumeRatio(row) >= 0.3) &&
  (!filters.highVolumeOnly || currentVolumeRatio(row) >= 1.5) &&
  (!filters.decliningVolumeOnly || hasDryVolumeStreak(row)) &&
  (!filters.dryVolumeOnly || hasDryVolumeRatio(row)) &&
  (!filters.redCandleOnly || closedRedPreviousSession(row));

function SetupSparkline({ row, onOpen }: { row: BreakoutChartRow; onOpen: () => void }) {
  const chartRows = lastTradingMonths(row.recent);
  const closes = chartRows.map((point) => point.close);
  const trendUp = closes.length > 1 && closes.at(-1)! >= closes[0];
  return <button className="setup-sparkline" onClick={(event) => { event.stopPropagation(); onOpen(); }} aria-label={`Open ${row.symbol} daily chart`}>
    <svg viewBox="0 0 86 28" preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-area" d={`${polylinePath(closes, 86, 28)} L86 28 L0 28 Z`} />
      <path className={trendUp ? "spark-line up" : "spark-line down"} d={polylinePath(closes, 86, 28)} />
    </svg>
  </button>;
}

function ThirtyUpCandleChart({ rows, timeframe, loading, error }: { rows: DailyChartPoint[]; timeframe: ChartTimeframe; loading?: boolean; error?: string }) {
  if (loading) return <div className="chart-empty">Loading hourly candles...</div>;
  if (error) return <div className="chart-empty">{error}</div>;
  const chartRows = timeframe === "daily" ? lastTradingMonths(rows) : rows.slice(-120);
  if (chartRows.length < 5) return <div className="chart-empty">Not enough {timeframe} rows for charting.</div>;
  const width = 780;
  const priceHeight = 250;
  const oscillatorHeight = 72;
  const gap = 18;
  const totalHeight = priceHeight + oscillatorHeight + gap;
  const lows = chartRows.map((row) => row.low);
  const highs = chartRows.map((row) => row.high);
  const closes = chartRows.map((row) => row.close);
  const calculatedEma = emaValues(closes);
  const chartEmaValues = chartRows.map((row, index) => row.ema50 ?? calculatedEma[index]);
  const visibleEmaValues = chartEmaValues.filter((value): value is number => value !== undefined);
  const priceMin = Math.min(...lows, ...visibleEmaValues);
  const priceMax = Math.max(...highs, ...visibleEmaValues);
  const candleSlot = width / chartRows.length;
  const bodyWidth = Math.max(3, Math.min(8, candleSlot * 0.48));
  const emaPath = chartEmaValues.map((value, index) => ({ value, x: index * candleSlot + candleSlot / 2 })).filter((point): point is { value: number; x: number } => point.value !== undefined).map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${scaleValue(point.value, priceMin, priceMax, priceHeight, 8).toFixed(2)}`).join(" ");
  const stochD = stochRsiDValues(closes);
  const oscillatorTop = priceHeight + gap;
  const oscillatorPath = stochD.map((value, index) => ({ value, x: index * candleSlot + candleSlot / 2 })).filter((point): point is { value: number; x: number } => point.value !== undefined).map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${(oscillatorTop + scaleValue(point.value, 0, 100, oscillatorHeight, 7)).toFixed(2)}`).join(" ");
  const maxVolume = Math.max(...chartRows.map((row) => row.volume));
  return <div className="candle-chart">
    <div className="chart-legend"><span><i className="legend-candle" />{timeframe === "daily" ? "Daily" : "Hourly"} candles</span><span><i className="legend-ema" />50 EMA</span><span><i className="legend-stoch" />StochRSI %D</span><span><i className="legend-volume" />Volume</span></div>
    <svg viewBox={`0 0 ${width} ${totalHeight}`} role="img" aria-label={`${timeframe} candlestick chart with EMA, StochRSI D, and volume`}>
      <line className="chart-guide" x1="0" x2={width} y1={oscillatorTop + oscillatorHeight * 0.2} y2={oscillatorTop + oscillatorHeight * 0.2} />
      <line className="chart-guide" x1="0" x2={width} y1={oscillatorTop + oscillatorHeight * 0.8} y2={oscillatorTop + oscillatorHeight * 0.8} />
      {chartRows.map((row, index) => {
        const x = index * candleSlot + candleSlot / 2;
        const openY = scaleValue(row.open, priceMin, priceMax, priceHeight, 8);
        const closeY = scaleValue(row.close, priceMin, priceMax, priceHeight, 8);
        const highY = scaleValue(row.high, priceMin, priceMax, priceHeight, 8);
        const lowY = scaleValue(row.low, priceMin, priceMax, priceHeight, 8);
        const up = row.close >= row.open;
        const bodyY = Math.min(openY, closeY);
        const bodyHeight = Math.max(1, Math.abs(closeY - openY));
        const volumeBarHeight = Math.max(1, (row.volume / maxVolume) * 58);
        return <g key={row.trade_date} className={up ? "candle up" : "candle down"}>
          <title>{`${chartDateLabel(row.trade_date, timeframe)} O ${row.open.toFixed(2)} H ${row.high.toFixed(2)} L ${row.low.toFixed(2)} C ${row.close.toFixed(2)}`}</title>
          <rect className="volume-bar" x={x - bodyWidth / 2} y={priceHeight - volumeBarHeight - 4} width={bodyWidth} height={volumeBarHeight} rx="1" />
          <line x1={x} x2={x} y1={highY} y2={lowY} />
          <rect x={x - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyHeight} rx="1" />
        </g>;
      })}
      <path className="ema-line" d={emaPath} />
      <path className="stoch-line" d={oscillatorPath} />
      <text className="chart-label" x="0" y="12">Price</text>
      <text className="chart-label" x="0" y={oscillatorTop + 12}>StochRSI %D</text>
    </svg>
  </div>;
}

function ThirtyUpChartPanel({ selected, onTradeCreated, intradayEndpoint = "thirty-up-screener", strategyLabel = "30%Up Swing", sourceNote = "Created from 30%Up risk preview. Live broker order not placed by app.", showTradePreview = true }: { selected: BreakoutChartRow; onTradeCreated?: () => void; intradayEndpoint?: string; strategyLabel?: string; sourceNote?: string; showTradePreview?: boolean }) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("daily");
  const [hourlyRows, setHourlyRows] = useState<DailyChartPoint[]>([]);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [hourlyError, setHourlyError] = useState("");
  const [liveDailyRow, setLiveDailyRow] = useState<DailyChartPoint | null>(null);
  const [dailyError, setDailyError] = useState("");

  useEffect(() => {
    setTimeframe("daily");
    setHourlyRows([]);
    setHourlyLoading(false);
    setHourlyError("");
    setLiveDailyRow(null);
    setDailyError("");
  }, [selected.security_id]);

  useEffect(() => {
    let cancelled = false;
    const loadIntraday = async (showLoading: boolean) => {
      if (showLoading) setHourlyLoading(true);
      setHourlyError("");
      setDailyError("");
      try {
        const rows = await fetchThirtyUpIntraday(selected.security_id, !showLoading, intradayEndpoint);
        if (cancelled) return;
        setHourlyRows(rows);
        setLiveDailyRow(aggregateIntradayDaily(rows));
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Intraday data unavailable";
        if (timeframe === "hourly") setHourlyError(message);
        else setDailyError(message);
      } finally {
        if (!cancelled && showLoading) setHourlyLoading(false);
      }
    };

    void loadIntraday(timeframe === "hourly" && !hourlyRows.length);
    const timer = window.setInterval(() => void loadIntraday(false), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selected.security_id, timeframe, intradayEndpoint]);

  const activeRows = timeframe === "daily" ? mergeLiveDailyCandle(selected.recent, liveDailyRow) : hourlyRows;
  return <div className="chart-shell">
    <div className="chart-toolbar">
      <div>
        <p className="eyebrow">Chart timeframe</p>
        <span>{timeframe === "daily" ? `Last 3 months daily${liveDailyRow ? " + live intraday candle" : ""}` : "Latest 60-minute candles"}</span>
      </div>
      <div className="segmented-control" role="group" aria-label="Chart timeframe">
        <button className={timeframe === "daily" ? "active" : ""} onClick={() => setTimeframe("daily")}>Daily</button>
        <button className={timeframe === "hourly" ? "active" : ""} onClick={() => setTimeframe("hourly")}>Hourly</button>
      </div>
    </div>
    <ThirtyUpCandleChart rows={activeRows} timeframe={timeframe} loading={timeframe === "hourly" && hourlyLoading} error={timeframe === "hourly" ? hourlyError : ""} />
    {timeframe === "daily" && dailyError && <div className="chart-empty">Live daily candle unavailable: {dailyError}</div>}
    {showTradePreview && <BuyOrderPreview selected={selected} timeframe={timeframe} rows={activeRows} onCreated={onTradeCreated} strategyLabel={strategyLabel} sourceNote={sourceNote} />}
  </div>;
}

function calculateHourlySignal(rows: DailyChartPoint[]): HourlySignal {
  if (rows.length < 55) return { state: "error", label: "Not enough hourly candles" };
  const closes = rows.map((row) => row.close);
  const hourlyEma = emaValues(closes);
  const enriched = rows
    .map((row, index) => ({ ...row, ema50: hourlyEma[index] }))
    .filter((row): row is DailyChartPoint & { ema50: number } => row.ema50 !== undefined);
  const latest = enriched.at(-1);
  if (!latest) return { state: "error", label: "No hourly EMA yet" };

  const latestDates = Array.from(new Set(enriched.map((row) => row.trade_date.slice(0, 10)))).slice(-2);
  const lastTwoDayRows = enriched.filter((row) => latestDates.includes(row.trade_date.slice(0, 10)));
  const belowTwoDays = latestDates.length === 2 && lastTwoDayRows.length > 0 && lastTwoDayRows.every((row) => row.close < row.ema50);
  const distancePct = ((latest.ema50 - latest.close) / latest.ema50) * 100;

  if (!belowTwoDays || distancePct < 0) {
    return { state: "red", ltp: latest.close, ema50: latest.ema50, distancePct, belowTwoDays, label: distancePct < 0 ? "Above hourly 50 EMA" : "Not below 50 EMA for 2 days" };
  }
  if (distancePct <= 1) return { state: "green", ltp: latest.close, ema50: latest.ema50, distancePct, belowTwoDays, label: "Below 50 EMA and close" };
  if (distancePct <= 3) return { state: "yellow", ltp: latest.close, ema50: latest.ema50, distancePct, belowTwoDays, label: "Below 50 EMA but a bit far" };
  return { state: "red", ltp: latest.close, ema50: latest.ema50, distancePct, belowTwoDays, label: "Too far below hourly 50 EMA" };
}

function HourlySignalCell({ signal }: { signal?: HourlySignal }) {
  const state = signal?.state ?? "idle";
  const title = signal ? `${signal.label}${signal.distancePct === undefined ? "" : ` (${signal.distancePct.toFixed(1)}% from 50 EMA)`}` : "Waiting for live LTP";
  return <span className={`hourly-signal ${state}`} title={title}>
    <i />
    <span>{state === "idle" ? "—" : state === "loading" ? "Loading" : state === "error" ? "Error" : signal?.distancePct === undefined ? state.toUpperCase() : `${signal.distancePct.toFixed(1)}%`}</span>
  </span>;
}

function liveHourlySignal(signal?: HourlySignal, ltp?: number): HourlySignal | undefined {
  if (!signal || ltp === undefined || !signal.ema50) return signal;
  const distancePct = ((signal.ema50 - ltp) / signal.ema50) * 100;
  if (!signal.belowTwoDays || distancePct < 0) return { ...signal, state: "red", ltp, distancePct, label: distancePct < 0 ? "Live price is above hourly 50 EMA" : "Not below hourly 50 EMA for 2 days" };
  if (distancePct <= 1) return { ...signal, state: "green", ltp, distancePct, label: "Below hourly 50 EMA and close" };
  if (distancePct <= 3) return { ...signal, state: "yellow", ltp, distancePct, label: "Below hourly 50 EMA but a bit far" };
  return { ...signal, state: "red", ltp, distancePct, label: "Too far below hourly 50 EMA" };
}

function liveAdjustedPortfolio(portfolio: PortfolioResponse | null, liveTicks: Record<string, LiveTick>) {
  if (!portfolio) return null;
  const holdings = portfolio.holdings.map((holding) => {
    const tick = liveTicks[holding.securityId];
    if (!tick?.ltp) return holding;
    return {
      ...holding,
      currentPrice: tick.ltp,
      todayChangePct: tick.prevClose && tick.prevClose > 0 ? ((tick.ltp / tick.prevClose) - 1) * 100 : holding.todayChangePct,
      unrealizedPnl: (tick.ltp - holding.avgCostPrice) * holding.totalQty,
      distanceFrom10EmaPct: holding.ema10 ? ((tick.ltp - holding.ema10) / holding.ema10) * 100 : holding.distanceFrom10EmaPct,
    };
  });
  const unrealizedPnl = holdings.reduce((sum, holding) => sum + holding.unrealizedPnl, 0);
  return { ...portfolio, holdings, stats: { ...portfolio.stats, unrealizedPnl, portfolioPnl: portfolio.stats.realizedPnl + unrealizedPnl } };
}

function LiveFeedStatusIndicator({ status, message, view, dataJob }: { status: LiveFeedStatus; message?: string; view: View; dataJob?: DataDownloadJob | null }) {
  if (view === "Data Status") {
    const activeJob = isActiveDataJob(dataJob);
    const pendingEod = dataJob?.pending_eod_count ?? 0;
    const dotClass = activeJob ? "pending" : pendingEod ? "pending" : "ready";
    const title = activeJob ? "Historical refresh running" : pendingEod ? "Waiting for Dhan EOD" : "Historical data ready";
    const detail = activeJob
      ? `REST download ${dataJob?.progress ?? 0}% complete`
      : pendingEod
        ? `${pendingEod} candles not posted yet`
        : "LTP socket not used here";
    return <div className="data-status live-feed-status"><span className={dotClass} /><div><b>{title}</b><small>{detail}</small></div></div>;
  }
  const copy = {
    idle: ["Live feed off", "Open Portfolio, 30%Up, Early Breakout, or Hourly Breakout for socket LTP"],
    connecting: ["Live feed connecting", "Dhan websocket starting"],
    live: ["Live feed live", "Dhan websocket streaming"],
    error: ["Live feed error", "Check token or market feed"],
  } satisfies Record<LiveFeedStatus, [string, string]>;
  const dotClass = status === "live" ? "ready" : status === "connecting" ? "pending" : status === "error" ? "failed" : "idle-dot";
  return <div className="data-status live-feed-status"><span className={dotClass} /><div><b>{copy[status][0]}</b><small>{message || copy[status][1]}</small></div></div>;
}

function Controls({ windows, windowKey, setWindowKey, universe, setUniverse, sector, setSector, sectors, search, setSearch }: { windows: WindowDef[]; windowKey: string; setWindowKey: (v: string) => void; universe: string; setUniverse: (v: string) => void; sector: string; setSector: (v: string) => void; sectors: string[]; search?: string; setSearch?: (v: string) => void }) {
  return <div className="control-grid">
    <label>Seasonal Window<select value={windowKey} onChange={(e) => setWindowKey(e.target.value)}>{windows.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}</select></label>
    <label>Universe<select value={universe} onChange={(e) => setUniverse(e.target.value)}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label>
    <label>Sector<select value={sector} onChange={(e) => setSector(e.target.value)}><option value="ALL">All sectors</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
    {setSearch && <label>Search<input className="plain-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Symbol or company" /></label>}
  </div>;
}

function SeasonalityTable({ rows, onSelect, sort, setSort }: { rows: SeasonalStatisticsRecord[]; onSelect: (row: SeasonalStatisticsRecord) => void; sort: keyof SeasonalStatisticsRecord; setSort: (s: keyof SeasonalStatisticsRecord) => void }) {
  const cols: [keyof SeasonalStatisticsRecord, string][] = [["symbol", "Symbol"], ["company_name", "Company"], ["sector", "Sector"], ["universe_name", "Universe"], ["avg_return", "Average"], ["median_return", "Median"], ["historical_win_rate", "Hist Win Rate"], ["best_return", "Best"], ["worst_return", "Worst"], ["std_dev", "Std Dev"], ["avg_median_gap", "Avg-Median Gap"], ["mae_p75", "MAE P75"], ["worst_mae", "Worst MAE"], ["mfe_p50", "MFE P50"], ["mfe_p75", "MFE P75"], ["observation_count", "N"]];
  return <div className="table-wrap"><table><thead><tr>{cols.map(([key, label]) => <th key={key}><button className="sort-head" onClick={() => setSort(key)}>{label}{sort === key ? " ↓" : ""}</button></th>)}</tr></thead><tbody>{rows.map((r) => <tr key={`${r.security_id}-${r.window_key}`} onClick={() => onSelect(r)} className="click-row"><td className="window">{r.symbol}</td><td>{r.company_name}</td><td>{r.sector}</td><td>{r.universe_name}</td><td className={r.avg_return >= 0 ? "positive" : "negative"}>{pct(r.avg_return)}</td><td className={r.median_return >= 0 ? "positive" : "negative"}>{pct(r.median_return)}</td><td>{r.historical_win_rate.toFixed(1)}%</td><td className="positive">{pct(r.best_return)}</td><td className="negative">{pct(r.worst_return)}</td><td>{pct(r.std_dev)}</td><td>{pct(r.avg_median_gap)}</td><td className={r.mae_p75 >= 0 ? "positive" : "negative"}>{pct(r.mae_p75)}</td><td className="negative">{pct(r.worst_mae)}</td><td className="positive">{pct(r.mfe_p50)}</td><td className="positive">{pct(r.mfe_p75)}</td><td>{r.observation_count}{r.observation_count < 5 && <small className="sample-warning">Limited historical sample</small>}</td></tr>)}</tbody></table></div>;
}

function DetailDrawer({ row, observations, onClose }: { row: SeasonalStatisticsRecord | ScannerResult; observations: SeasonalObservationRecord[]; onClose: () => void }) {
  const current = "currentSeason" in row ? row.currentSeason : undefined;
  return <div className="drawer"><div className="drawer-card"><button className="icon-button drawer-close" onClick={onClose}>×</button><p className="eyebrow">{row.window_key}</p><h2>{row.symbol} · {row.company_name}</h2><p className="muted">{row.sector} · {row.universe_name}</p><div className="stats-grid compact-stats"><Stat label="Average" value={pct(row.avg_return)} /><Stat label="Median" value={pct(row.median_return)} /><Stat label="Historical Win Rate" value={`${row.historical_win_rate.toFixed(1)}%`} /><Stat label="N" value={`${row.observation_count}`} /></div>{current && <div className="stats-grid compact-stats"><Stat label="Current Season" value={current.current_return_pct === undefined ? "NO DATA" : pct(current.current_return_pct)} sub={current.status} /><Stat label="Current MAE" value={current.current_mae_pct === undefined ? "—" : pct(current.current_mae_pct)} sub={current.entry_date} /><Stat label="Current MFE" value={current.current_mfe_pct === undefined ? "—" : pct(current.current_mfe_pct)} sub={current.current_date} /><Stat label="Contribution" value={"portfolio_contribution_pct" in row && row.portfolio_contribution_pct !== undefined ? `${row.portfolio_contribution_pct.toFixed(2)} pts` : "—"} sub={"current_vs_historical_median" in row && row.current_vs_historical_median !== undefined ? `vs median ${pct(row.current_vs_historical_median)}` : undefined} /></div>}<div className="drawer-sections"><section><h3>Downside</h3><span>MAE P25 <b>{pct(row.mae_p25)}</b></span><span>MAE P50 <b>{pct(row.mae_p50)}</b></span><span>MAE P75 <b>{pct(row.mae_p75)}</b></span><span>MAE P90 <b>{pct(row.mae_p90)}</b></span><span>Worst MAE <b>{pct(row.worst_mae)}</b></span></section><section><h3>Upside</h3><span>MFE P25 <b>{pct(row.mfe_p25)}</b></span><span>MFE P50 <b>{pct(row.mfe_p50)}</b></span><span>MFE P75 <b>{pct(row.mfe_p75)}</b></span><span>MFE P90 <b>{pct(row.mfe_p90)}</b></span><span>Best MFE <b>{pct(row.best_mfe)}</b></span></section></div><h3>Historical occurrences used for eligibility</h3><div className="table-wrap"><table><thead><tr><th>Year</th><th>Entry Date</th><th>Entry Price</th><th>Exit Date</th><th>Exit Price</th><th>Return</th><th>MAE</th><th>MFE</th></tr></thead><tbody>{observations.map((o) => <tr key={o.id}><td>{o.occurrence_year}</td><td>{o.entry_date}</td><td>{money(o.entry_price)}</td><td>{o.exit_date}</td><td>{money(o.exit_price)}</td><td className={o.return_pct >= 0 ? "positive" : "negative"}>{pct(o.return_pct)}</td><td className="negative">{pct(o.mae_pct)}</td><td className="positive">{pct(o.mfe_pct)}</td></tr>)}</tbody></table></div></div></div>;
}

function MiniLineChart({ points }: { points: { date: string; cumulative: number }[] }) {
  if (!points.length) return <div className="chart-empty">No closed trades yet for this financial year.</div>;
  const values = points.map((point) => point.cumulative);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const zeroY = scaleValue(0, min, max, 180, 12);
  return <div className="portfolio-chart"><svg viewBox="0 0 720 180" preserveAspectRatio="none" role="img" aria-label="Cumulative realized profit and loss">
    <line className="chart-guide" x1="0" x2="720" y1={zeroY} y2={zeroY} />
    <path className="spark-area" d={`${polylinePath(values, 720, 180)} L720 180 L0 180 Z`} />
    <path className={values.at(-1)! >= 0 ? "spark-line up" : "spark-line down"} d={polylinePath(values, 720, 180)} />
  </svg></div>;
}

function MonthlyBars({ rows }: { rows: { month: string; pnl: number }[] }) {
  if (!rows.length) return <div className="chart-empty">Monthly P&L appears after realized sells are found.</div>;
  const width = 720;
  const height = 180;
  const maxAbs = Math.max(...rows.map((row) => Math.abs(row.pnl)), 1);
  const zero = height / 2;
  const slot = width / rows.length;
  return <div className="portfolio-chart"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Monthly profit and loss bars">
    <line className="chart-guide" x1="0" x2={width} y1={zero} y2={zero} />
    {rows.map((row, index) => {
      const barHeight = Math.max(2, Math.abs(row.pnl) / maxAbs * (height / 2 - 12));
      const y = row.pnl >= 0 ? zero - barHeight : zero;
      return <g key={row.month}><title>{`${row.month}: ${rupees(row.pnl)}`}</title><rect className={row.pnl >= 0 ? "pnl-bar up" : "pnl-bar down"} x={index * slot + slot * 0.2} y={y} width={Math.max(7, slot * 0.6)} height={barHeight} rx="2" /></g>;
    })}
  </svg></div>;
}

function WinLossBars({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses || 1;
  return <div className="win-loss-strip" aria-label="Win loss ratio"><span style={{ width: `${wins / total * 100}%` }} /><i style={{ width: `${losses / total * 100}%` }} /></div>;
}

function BacktestEquityChart({ points, trades }: { points: { date: string; cumulative: number }[]; trades: BasketEvent[] }) {
  if (!points.length) return <div className="chart-empty">Run a backtest to see dated equity and trade markers.</div>;
  const width = 900;
  const height = 260;
  const pad = { top: 20, right: 22, bottom: 44, left: 66 };
  const values = points.map((point) => point.cumulative);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const xFor = (index: number) => pad.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * innerWidth);
  const yFor = (value: number) => pad.top + scaleValue(value, min, max, innerHeight, 0);
  const dateIndex = new Map(points.map((point, index) => [point.date, index]));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${xFor(index).toFixed(2)} ${yFor(point.cumulative).toFixed(2)}`).join(" ");
  const zeroY = yFor(0);
  const tickIndexes = Array.from(new Set([0, Math.floor(points.length * 0.25), Math.floor(points.length * 0.5), Math.floor(points.length * 0.75), points.length - 1])).filter((index) => index >= 0 && index < points.length);
  return <div className="backtest-equity-chart"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Backtest equity curve with trade dots">
    <line className="chart-guide" x1={pad.left} x2={width - pad.right} y1={zeroY} y2={zeroY} />
    <path className="spark-area" d={`${path} L${width - pad.right} ${height - pad.bottom} L${pad.left} ${height - pad.bottom} Z`} />
    <path className={values.at(-1)! >= 0 ? "spark-line up" : "spark-line down"} d={path} />
    {trades.map((trade, index) => {
      const pointIndex = dateIndex.get(trade.date);
      if (pointIndex === undefined) return null;
      const point = points[pointIndex];
      const tone = trade.type === "BUY" ? "buy" : (trade.pnl ?? 0) >= 0 ? "sell win" : "sell loss";
      return <circle key={`${trade.date}-${trade.symbol}-${trade.type}-${index}`} className={`trade-dot ${tone}`} cx={xFor(pointIndex)} cy={yFor(point.cumulative)} r={trade.type === "BUY" ? 3.4 : 4.3}><title>{`${trade.date} ${trade.type} ${trade.symbol}: ${trade.pnl === undefined ? rupees(trade.amount) : rupees(trade.pnl)}`}</title></circle>;
    })}
    {tickIndexes.map((index) => <g key={points[index].date}><line className="axis-tick" x1={xFor(index)} x2={xFor(index)} y1={height - pad.bottom} y2={height - pad.bottom + 5} /><text className="chart-label" x={xFor(index)} y={height - 18} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{points[index].date.slice(5)}</text></g>)}
    <text className="chart-label" x={pad.left} y={16}>{rupees(max)}</text>
    <text className="chart-label" x={pad.left} y={height - pad.bottom - 6}>{rupees(min)}</text>
  </svg><div className="chart-legend compact-legend"><span><i className="legend-buy" />Buy</span><span><i className="legend-sell-win" />Profit sell</span><span><i className="legend-sell-loss" />Loss sell</span></div></div>;
}

function BacktestReturnBars({ rows }: { rows: { label: string; pnl: number }[] }) {
  if (!rows.length) return <div className="chart-empty">Monthly bars appear after the backtest creates daily equity snapshots.</div>;
  const width = 720;
  const height = 190;
  const maxAbs = Math.max(...rows.map((row) => Math.abs(row.pnl)), 1);
  const zero = height / 2;
  const slot = width / rows.length;
  return <div className="portfolio-chart backtest-bars"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Backtest monthly P and L bars">
    <line className="chart-guide" x1="0" x2={width} y1={zero} y2={zero} />
    {rows.map((row, index) => {
      const barHeight = Math.max(2, Math.abs(row.pnl) / maxAbs * (height / 2 - 18));
      const y = row.pnl >= 0 ? zero - barHeight : zero;
      return <g key={row.label}><title>{`${row.label}: ${rupees(row.pnl)}`}</title><rect className={row.pnl >= 0 ? "pnl-bar up" : "pnl-bar down"} x={index * slot + slot * 0.18} y={y} width={Math.max(9, slot * 0.64)} height={barHeight} rx="2" /><text className="chart-label" x={index * slot + slot * 0.5} y={height - 6} textAnchor="middle">{row.label.slice(5)}</text></g>;
    })}
  </svg></div>;
}

function BacktestTradeDonut({ wins, losses, breakeven }: { wins: number; losses: number; breakeven: number }) {
  const total = wins + losses + breakeven;
  if (!total) return <div className="chart-empty">Trade distribution appears after exits are generated.</div>;
  const winPct = wins / total;
  const lossPct = losses / total;
  const winEnd = winPct * 100;
  const lossEnd = (winPct + lossPct) * 100;
  return <div className="donut-card"><div className="donut" style={{ background: `conic-gradient(var(--green) 0 ${winEnd}%, var(--red) ${winEnd}% ${lossEnd}%, #7d8996 ${lossEnd}% 100%)` }}><span>{Math.round(winPct * 100)}%</span></div><div className="trade-quality donut-legend"><span>Winners <b className="positive">{wins}</b></span><span>Losers <b className="negative">{losses}</b></span><span>Flat <b>{breakeven}</b></span></div></div>;
}

function TradeStageBadge({ stage }: { stage: ManagedTradeView["stage"] }) {
  const tone = stage === "EXIT WARNING" ? "danger" : stage === "PARTIAL PROFIT WINDOW" ? "warn" : stage === "RUNNER" || stage === "TREND TRAIL" || stage === "BREAKEVEN / PROTECTED" ? "good" : "neutral";
  return <span className={`stage-badge ${tone}`}>{stage}</span>;
}

function TradingSettingsView({ settings, onSaved }: { settings: TradingSettings | null; onSaved: (settings: TradingSettings) => void }) {
  const [draft, setDraft] = useState<TradingSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const riskUnit = draft ? draft.totalCapital * draft.riskPercent / 100 : 0;
  useEffect(() => { if (settings) setDraft(settings); }, [settings]);
  const setValue = (key: keyof TradingSettings, value: string | number | boolean) => setDraft((current) => current ? { ...current, [key]: value } : current);
  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const response = await fetch("/api/trade-management/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      onSaved(body.settings);
    } finally {
      setSaving(false);
    }
  }
  if (!draft) return <section className="empty"><p className="eyebrow">Settings</p><h2>Loading trading settings</h2></section>;
  return <section className="portfolio-page"><div className="data-toolbar"><div><p className="eyebrow">Settings</p><h2>Trading Capital &amp; Risk</h2><small>These settings generate advisory recommendations. They do not place broker orders.</small></div><button className="primary" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</button></div><div className="stats-grid"><Stat label="Total Capital" value={rupees(draft.totalCapital)} /><Stat label="Risk Per Trade" value={`${draft.riskPercent.toFixed(2)}%`} /><Stat label="Risk Unit" value={rupees(riskUnit)} /><Stat label="Default Trail" value={draft.defaultTrailMA} /></div><section className="panel"><div className="settings-grid"><label>Total Trading Capital<input className="plain-input" type="number" value={draft.totalCapital} onChange={(e) => setValue("totalCapital", Number(e.target.value))}/></label><label>Risk Per Trade %<input className="plain-input" type="number" step="0.01" value={draft.riskPercent} onChange={(e) => setValue("riskPercent", Number(e.target.value))}/></label><label>Default Stop Source<select value={draft.defaultStopSource} onChange={(e) => setValue("defaultStopSource", e.target.value)}><option>Setup Candle Low</option><option>Manual</option></select></label><label>Default Timeframe<select value={draft.defaultManagementTimeframe} onChange={(e) => setValue("defaultManagementTimeframe", e.target.value)}><option>Daily</option><option>Hourly</option></select></label><label>Initial Management Days<input className="plain-input" type="number" value={draft.initialManagementDays} onChange={(e) => setValue("initialManagementDays", Number(e.target.value))}/></label><label>Partial Start Day<input className="plain-input" type="number" value={draft.partialStartDay} onChange={(e) => setValue("partialStartDay", Number(e.target.value))}/></label><label>Partial End Day<input className="plain-input" type="number" value={draft.partialEndDay} onChange={(e) => setValue("partialEndDay", Number(e.target.value))}/></label><label>Partial Profit %<input className="plain-input" type="number" value={draft.partialPercent} onChange={(e) => setValue("partialPercent", Number(e.target.value))}/></label><label>Partial Min R<input className="plain-input" type="number" step="0.1" value={draft.partialMinR} onChange={(e) => setValue("partialMinR", Number(e.target.value))}/></label><label>Runner Trail<select value={draft.defaultTrailMA} onChange={(e) => setValue("defaultTrailMA", e.target.value)}><option>10 EMA</option><option>20 EMA</option><option>Manual</option></select></label><label>Exit Confirmation<select value={draft.exitConfirmationRule} onChange={(e) => setValue("exitConfirmationRule", e.target.value)}><option>Close below EMA</option><option>Intraday break</option><option>2 closes below EMA</option></select></label><label className="toggle-row"><input type="checkbox" checked={draft.moveStopToBreakevenAfterPartial} onChange={(e) => setValue("moveStopToBreakevenAfterPartial", e.target.checked)}/><span>Move remaining stop to breakeven after partial profit</span></label><label>Normal Risk Below %<input className="plain-input" type="number" step="0.1" value={draft.portfolioRiskNormalPct} onChange={(e) => setValue("portfolioRiskNormalPct", Number(e.target.value))}/></label><label>Elevated Risk Above %<input className="plain-input" type="number" step="0.1" value={draft.portfolioRiskElevatedPct} onChange={(e) => setValue("portfolioRiskElevatedPct", Number(e.target.value))}/></label><label>High Risk Above %<input className="plain-input" type="number" step="0.1" value={draft.portfolioRiskHighPct} onChange={(e) => setValue("portfolioRiskHighPct", Number(e.target.value))}/></label></div></section></section>;
}

function BuyOrderPreview({ selected, timeframe, rows, onCreated, strategyLabel = "30%Up Swing", sourceNote = "Created from 30%Up risk preview. Live broker order not placed by app." }: { selected: BreakoutChartRow; timeframe: ChartTimeframe; rows: DailyChartPoint[]; onCreated?: () => void; strategyLabel?: string; sourceNote?: string }) {
  const [open, setOpen] = useState(false);
  const [stopLoss, setStopLoss] = useState(0);
  const [preview, setPreview] = useState<{ settings: TradingSettings; sizing: PositionSizingResult } | null>(null);
  const [saving, setSaving] = useState(false);
  const setupCandle = timeframe === "hourly" ? rows.at(-2) ?? rows.at(-1) : selected.recent.at(-1);
  const entryPrice = rows.at(-1)?.close ?? selected.current_close;
  const source = timeframe === "hourly" ? "Latest completed hourly candle low" : "Latest completed daily candle low";
  useEffect(() => { if (setupCandle) setStopLoss(setupCandle.low); setPreview(null); }, [selected.security_id, timeframe, setupCandle?.trade_date]);
  useEffect(() => {
    if (!open || !entryPrice || !stopLoss) return;
    let cancelled = false;
    fetch("/api/trade-management/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryPrice, stopLoss }) })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => { if (!cancelled && response.ok) setPreview(body); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, entryPrice, stopLoss]);
  async function recordTrade() {
    if (!preview?.sizing.valid || !setupCandle) return;
    setSaving(true);
    try {
      const response = await fetch("/api/trade-management/trades", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: selected.symbol, companyName: selected.company_name, exchange: "NSE", instrumentId: selected.security_id, strategy: strategyLabel, entryDate: new Date().toISOString().slice(0, 10), averageEntry: entryPrice, quantity: preview.sizing.quantity, initialStop: stopLoss, managementTimeframe: timeframe === "hourly" ? "Hourly" : "Daily", trailMethod: preview.settings.defaultTrailMA, source: "30UP", notes: sourceNote }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      onCreated?.();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }
  return <section className="trade-panel"><div className="panel-head"><div><p className="eyebrow">Risk-Based Buy</p><h2>Trade management preview</h2></div><button className="primary" onClick={() => setOpen((value) => !value)}>BUY</button></div>{open && <div className="trade-preview"><div className="notice"><AlertTriangle size={17}/><span>LIVE ORDER is not sent from this app yet. Protective stop not placed at broker. This creates an advisory managed-trade record only.</span></div><div className="settings-grid compact-form"><label>Symbol<input className="plain-input" value={selected.symbol} readOnly /></label><label>Timeframe<input className="plain-input" value={timeframe === "daily" ? "Daily" : "Hourly"} readOnly /></label><label>Current LTP<input className="plain-input" value={money(entryPrice)} readOnly /></label><label>Setup Candle<input className="plain-input" value={setupCandle?.trade_date ?? "Unavailable"} readOnly /></label><label>Default SL Source<input className="plain-input" value={source} readOnly /></label><label>Stop Loss<input className="plain-input" type="number" step="0.05" value={stopLoss} onChange={(e) => setStopLoss(Number(e.target.value))}/></label></div>{preview && <><div className="stats-grid compact-stats"><Stat label="Risk Amount" value={rupees(preview.sizing.riskAmount)} sub={`${preview.settings.riskPercent.toFixed(2)}% of ${rupees(preview.settings.totalCapital)}`} /><Stat label="Risk / Share" value={money(preview.sizing.riskPerShare)} sub={`SL ${preview.sizing.stopLossPercent.toFixed(2)}%`} /><Stat label="Quantity" value={`${preview.sizing.quantity}`} sub="floor(risk / share risk)" /><Stat label="Order Value" value={rupees(preview.sizing.positionValue)} sub={`${preview.sizing.capitalUsagePercent.toFixed(2)}% capital`} /></div>{preview.sizing.stopLossPercent > 8 && <div className="notice danger-notice"><AlertTriangle size={17}/><span>Wide stop warning: risk from entry is {preview.sizing.stopLossPercent.toFixed(2)}%.</span></div>}{preview.sizing.errors.length > 0 && <div className="job-errors"><b>Preview validation</b><span>{preview.sizing.errors.join(" ")}</span></div>}<div className="toolbar-actions"><button className="secondary" disabled>Place Live Buy Order</button><button className="primary" onClick={recordTrade} disabled={!preview.sizing.valid || saving}>{saving ? "Recording..." : "Create Managed Trade"}</button></div></>}</div>}</section>;
}

function EditManagedTradeForm({ trade, onUpdate, onDelete }: { trade: ManagedTradeView; onUpdate: (tradeId: string, patch: Partial<ManagedTradeView>) => void; onDelete: (tradeId: string) => void }) {
  const [draft, setDraft] = useState({
    strategy: trade.strategy,
    entryDate: trade.brokerEntryDate ?? trade.entryDate,
    quantity: trade.quantity,
    averageEntry: trade.averageEntry,
    initialStop: trade.initialStop,
    plannedStop: trade.plannedStop,
    trailMethod: trade.trailMethod,
    managementTimeframe: trade.managementTimeframe,
  });
  useEffect(() => setDraft({ strategy: trade.strategy, entryDate: trade.brokerEntryDate ?? trade.entryDate, quantity: trade.quantity, averageEntry: trade.averageEntry, initialStop: trade.initialStop, plannedStop: trade.plannedStop, trailMethod: trade.trailMethod, managementTimeframe: trade.managementTimeframe }), [trade]);
  const riskShare = draft.averageEntry - draft.initialStop;
  const initialRisk = riskShare * draft.quantity;
  const openRisk = Math.max(0, draft.quantity * (trade.currentPrice - draft.plannedStop));
  return <section className="edit-trade-box"><div className="panel-head"><div><p className="eyebrow">Edit variables</p><h2>Managed trade controls</h2></div><div className="toolbar-actions"><button className="secondary compact danger-action" onClick={() => onDelete(trade.id)}>Delete</button><button className="primary compact" onClick={() => onUpdate(trade.id, draft)}>Save Changes</button></div></div><div className="settings-grid compact-form"><label>Strategy<input className="plain-input" value={draft.strategy} onChange={(e) => setDraft({ ...draft, strategy: e.target.value })}/></label><label>Entry Date<input className="plain-input" type="date" value={draft.entryDate} onChange={(e) => setDraft({ ...draft, entryDate: e.target.value })}/></label><label>Quantity<input className="plain-input" type="number" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}/></label><label>Avg Entry<input className="plain-input" type="number" step="0.01" value={draft.averageEntry} onChange={(e) => setDraft({ ...draft, averageEntry: Number(e.target.value) })}/></label><label>Initial SL<input className="plain-input" type="number" step="0.01" value={draft.initialStop} onChange={(e) => setDraft({ ...draft, initialStop: Number(e.target.value) })}/></label><label>Planned SL<input className="plain-input" type="number" step="0.01" value={draft.plannedStop} onChange={(e) => setDraft({ ...draft, plannedStop: Number(e.target.value) })}/></label><label>Trail<select value={draft.trailMethod} onChange={(e) => setDraft({ ...draft, trailMethod: e.target.value as ManagedTradeView["trailMethod"] })}><option>10 EMA</option><option>20 EMA</option><option>Manual</option></select></label><label>Timeframe<select value={draft.managementTimeframe} onChange={(e) => setDraft({ ...draft, managementTimeframe: e.target.value as ManagedTradeView["managementTimeframe"] })}><option>Daily</option><option>Hourly</option></select></label></div><div className="risk-chips"><span><b>Risk/share</b>{money(Math.max(0, riskShare))}</span><span><b>Initial risk</b>{rupees(initialRisk)}</span><span><b>Open risk</b>{rupees(openRisk)}</span><span><b>SL width</b>{draft.averageEntry > 0 ? pct2((draft.averageEntry - draft.initialStop) / draft.averageEntry * 100) : "—"}</span></div></section>;
}

function TradeManagementTable({ snapshot, onEvent, onUpdate, onDelete }: { snapshot?: TradeManagementSnapshot; onEvent: (tradeId: string, event: Partial<TradeEvent> & { eventType: string }) => void; onUpdate: (tradeId: string, patch: Partial<ManagedTradeView>) => void; onDelete: (tradeId: string) => void }) {
  const [selected, setSelected] = useState<ManagedTradeView | null>(null);
  if (!snapshot) return null;
  const totalUnrealized = snapshot.trades.reduce((sum, trade) => sum + trade.unrealizedPnl, 0);
  return <><section className="panel"><div className="panel-head"><div><p className="eyebrow">Swing Trade Management</p><h2>Active managed trades</h2></div><div className="risk-strip"><span className={`risk-pill ${snapshot.summary.riskLevel.toLowerCase()}`}>{snapshot.summary.riskLevel} risk</span><b>{rupees(snapshot.summary.totalCurrentOpenRisk)} open risk</b><small>{pct2(snapshot.summary.portfolioOpenRiskPct)} of capital · {rupees(totalUnrealized)} unrealized</small></div></div>{snapshot.trades.length ? <div className="table-wrap"><table className="management-table"><thead><tr><th>Symbol</th><th>Stage</th><th>Qty</th><th>Broker Entry</th><th>Days Held</th><th>Avg Entry</th><th>Current</th><th>Risk / Share</th><th>Initial SL</th><th>Planned SL</th><th>Initial Risk</th><th>Open Risk</th><th>Unrealized</th><th>R / Peak</th><th>EMA Distance</th><th>Recommendation</th><th>Actions</th></tr></thead><tbody>{snapshot.trades.map((trade) => { const riskClass = trade.currentOpenRiskPct > 0.5 ? "risk-hot" : trade.currentOpenRiskPct > 0.2 ? "risk-warm" : "risk-cool"; return <tr key={trade.id} className={`click-row trade-row ${trade.stage === "EXIT WARNING" ? "row-warning" : ""}`} onClick={() => setSelected(trade)}><td className="window">{trade.symbol}<small className="sample-warning">{trade.status === "RECONCILIATION_REQUIRED" ? "RECONCILIATION REQUIRED" : trade.source}</small></td><td><TradeStageBadge stage={trade.stage}/></td><td>{trade.quantity}<small className="sample-warning">{trade.brokerQuantity === null ? "" : `Broker ${trade.brokerQuantity}`}</small></td><td>{trade.brokerEntryDate ?? trade.entryDate}<small className="sample-warning">{trade.brokerEntryDate ? "broker FIFO" : "app record"}</small></td><td>{trade.tradingDaysHeld} trading<small className="sample-warning">{trade.calendarDaysHeld} calendar</small></td><td>{money(trade.averageEntry)}</td><td className={trade.unrealizedPnl >= 0 ? "positive" : "negative"}>{money(trade.currentPrice)}</td><td>{money(trade.initialRiskPerShare)}<small className="sample-warning">{pct2((trade.initialRiskPerShare / trade.averageEntry) * 100)}</small></td><td>{money(trade.initialStop)}</td><td>{money(trade.plannedStop)}</td><td>{rupees(trade.initialRiskAmount)}<small className="sample-warning">{pct2(trade.initialRiskPct)}</small></td><td className={riskClass}>{rupees(trade.currentOpenRisk)}<small>{pct2(trade.currentOpenRiskPct)}</small></td><td className={trade.unrealizedPnl >= 0 ? "positive" : "negative"}>{rupees(trade.unrealizedPnl)}<small className="sample-warning">{pct2(trade.unrealizedPnlPct)}</small></td><td className={trade.rMultiple >= 0 ? "positive" : "negative"}>{rValue(trade.rMultiple)}<small className="sample-warning">Peak {rValue(trade.peakR)}</small></td><td>{trade.distanceFrom10EmaPct === undefined ? "—" : `10 ${pct2(trade.distanceFrom10EmaPct)}`}<small className="sample-warning">{trade.distanceFrom20EmaPct === undefined ? "" : `20 ${pct2(trade.distanceFrom20EmaPct)}`}</small></td><td>{trade.recommendedAction}</td><td><button className="secondary compact" onClick={(event) => { event.stopPropagation(); setSelected(trade); }}>Edit</button></td></tr>; })}</tbody></table></div> : <p className="panel-empty">No managed swing trades yet. Use 30%Up BUY preview or Manage Trade on a Dhan holding to enroll one.</p>}</section>{selected && <div className="drawer"><div className="drawer-card"><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">{selected.strategy}</p><h2>{selected.symbol} · {selected.companyName ?? "Managed swing trade"}</h2><TradeStageBadge stage={selected.stage}/><div className="instruction-card"><p className="eyebrow">{selected.stage}</p><h3>{selected.instruction}</h3><span>{selected.recommendedAction}</span></div><EditManagedTradeForm trade={selected} onUpdate={onUpdate} onDelete={(tradeId) => { onDelete(tradeId); setSelected(null); }} /><div className="stats-grid compact-stats"><Stat label="Entry" value={money(selected.averageEntry)} sub={selected.brokerEntryDate ? `Broker ${selected.brokerEntryDate}` : selected.entryDate}/><Stat label="Current" value={money(selected.currentPrice)} sub={pct2(selected.unrealizedPnlPct)}/><Stat label="R Multiple" value={rValue(selected.rMultiple)} sub={`Peak ${rValue(selected.peakR)}`}/><Stat label="Days Held" value={`${selected.tradingDaysHeld}`} sub={`${selected.calendarDaysHeld} calendar`} /></div><div className="stats-grid compact-stats"><Stat label="Initial SL" value={money(selected.initialStop)} sub={`Risk/share ${money(selected.initialRiskPerShare)}`} /><Stat label="Current Planned SL" value={money(selected.plannedStop)} sub={`Open risk ${rupees(selected.currentOpenRisk)}`} /><Stat label="10 EMA" value={selected.ema10 ? money(selected.ema10) : "—"} sub={selected.distanceFrom10EmaPct === undefined ? undefined : pct2(selected.distanceFrom10EmaPct)} /><Stat label="20 EMA" value={selected.ema20 ? money(selected.ema20) : "—"} sub={selected.distanceFrom20EmaPct === undefined ? undefined : pct2(selected.distanceFrom20EmaPct)} /></div><div className="toolbar-actions"><button className="secondary compact" onClick={() => onEvent(selected.id, { eventType: "PARTIAL_EXECUTED", quantity: Math.floor(selected.quantity / 2), price: selected.currentPrice, notes: "Partial marked from trade drawer." })}>Mark Partial Taken</button><button className="secondary compact" onClick={() => onEvent(selected.id, { eventType: "STOP_UPDATED", price: selected.averageEntry, notes: "Planned stop moved to breakeven in app record." })}>Mark Stop Updated</button><button className="secondary compact" onClick={() => onEvent(selected.id, { eventType: "EXIT", price: selected.currentPrice, quantity: selected.quantity, notes: "Trade closed in app record." })}>Mark Closed</button></div><h3>Trade timeline</h3><div className="timeline">{selected.events.map((event) => <div key={event.id}><b>{event.timestamp.slice(0, 10)}</b><span>{event.eventType.replaceAll("_", " ")}{event.quantity ? ` · Qty ${event.quantity}` : ""}{event.price ? ` · ${money(event.price)}` : ""}</span>{event.notes && <small>{event.notes}</small>}</div>)}</div></div></div>}</>;
}

function PortfolioRiskSummary({ snapshot }: { snapshot?: TradeManagementSnapshot }) {
  if (!snapshot) return null;
  const s = snapshot.summary;
  return <section className="panel"><div className="panel-head"><div><p className="eyebrow">Strategy Risk Dashboard</p><h2>Managed swing risk</h2></div><span className={`risk-pill ${s.riskLevel.toLowerCase()}`}>{s.riskLevel}</span></div><div className="stats-grid compact-stats"><Stat label="Total Capital" value={rupees(s.totalCapital)} /><Stat label="Configured Risk/Trade" value={`${s.riskPercent.toFixed(2)}%`} /><Stat label="Risk Unit" value={rupees(s.riskUnit)} /><Stat label="Managed Trades" value={`${s.managedTrades}`} /></div><div className="stats-grid compact-stats"><Stat label="Initial Risk Trades" value={`${s.tradesAtInitialRisk}`} /><Stat label="Protected Trades" value={`${s.protectedTrades}`} /><Stat label="Runners" value={`${s.runners}`} /><Stat label="Open Risk" value={rupees(s.totalCurrentOpenRisk)} sub={pct2(s.portfolioOpenRiskPct)} /></div><div className="stats-grid compact-stats"><Stat label="Swing Unrealized" value={rupees(s.unrealizedPnl)} /><Stat label="Swing Realized" value={rupees(s.realizedSwingPnl)} /><Stat label="Average / Median R" value={`${rValue(s.averageR)} / ${rValue(s.medianR)}`} /><Stat label="Best / Worst R" value={`${rValue(s.largestWinnerR)} / ${rValue(s.largestLoserR)}`} /></div></section>;
}

function ManageHoldingDrawer({ holding, onClose, onCreated }: { holding: PortfolioHolding | null; onClose: () => void; onCreated: () => void }) {
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [initialStop, setInitialStop] = useState(0);
  const [strategy, setStrategy] = useState("Manual Swing");
  const [timeframe, setTimeframe] = useState<"Daily" | "Hourly">("Daily");
  const [trail, setTrail] = useState<"10 EMA" | "20 EMA" | "Manual">("10 EMA");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (holding) { setInitialStop(Number((holding.avgCostPrice * 0.97).toFixed(2))); setEntryDate(holding.brokerEntryDate ?? new Date().toISOString().slice(0, 10)); } }, [holding]);
  if (!holding) return null;
  const managedHolding = holding;
  async function create() {
    setSaving(true);
    try {
      const response = await fetch("/api/trade-management/trades", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: managedHolding.tradingSymbol, exchange: managedHolding.exchange, instrumentId: managedHolding.securityId, isin: managedHolding.isin, strategy, entryDate, averageEntry: managedHolding.avgCostPrice, quantity: managedHolding.totalQty, initialStop, managementTimeframe: timeframe, trailMethod: trail, source: "BROKER_HOLDING", notes: "Existing Dhan holding enrolled manually. No broker order placed." }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  }
  return <div className="drawer"><div className="drawer-card narrow-drawer"><button className="icon-button drawer-close" onClick={onClose}>×</button><p className="eyebrow">Add to Trade Management</p><h2>{holding.tradingSymbol}</h2><p className="muted">This enrolls an existing broker holding without placing any order. Entry date is prefilled from Dhan FIFO open lots when available.</p><div className="settings-grid compact-form"><label>Entry Date<input className="plain-input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)}/></label><label>Strategy<input className="plain-input" value={strategy} onChange={(e) => setStrategy(e.target.value)}/></label><label>Broker Open Since<input className="plain-input" value={holding.brokerEntryDate ?? "Unavailable"} readOnly /></label><label>Broker Days<input className="plain-input" value={holding.brokerCalendarDaysHeld === undefined ? "—" : `${holding.brokerCalendarDaysHeld}`} readOnly /></label><label>Avg Entry<input className="plain-input" value={money(holding.avgCostPrice)} readOnly /></label><label>Quantity<input className="plain-input" value={`${holding.totalQty}`} readOnly /></label><label>Initial Stop<input className="plain-input" type="number" step="0.05" value={initialStop} onChange={(e) => setInitialStop(Number(e.target.value))}/></label><label>Management Timeframe<select value={timeframe} onChange={(e) => setTimeframe(e.target.value as "Daily" | "Hourly")}><option>Daily</option><option>Hourly</option></select></label><label>Trail Method<select value={trail} onChange={(e) => setTrail(e.target.value as "10 EMA" | "20 EMA" | "Manual")}><option>10 EMA</option><option>20 EMA</option><option>Manual</option></select></label></div><button className="primary" onClick={create} disabled={saving || initialStop <= 0 || initialStop >= holding.avgCostPrice}>{saving ? "Adding..." : "Add Managed Trade"}</button></div></div>;
}

function PortfolioTable({ holdings }: { holdings: PortfolioHolding[] }) {
  return <section className="panel portfolio-holdings-panel">
    <div className="panel-head">
      <div><p className="eyebrow">Portfolio</p><h2>Dhan holdings</h2></div>
      <span className="count">{holdings.length} live</span>
    </div>
    {holdings.length ? <div className="table-wrap">
      <table className="portfolio-holdings-table">
        <thead>
          <tr><th>Symbol</th><th>Qty</th><th>Days</th><th>Available</th><th>Avg Cost</th><th>Invested</th><th>LTP</th><th>Change %</th><th>Unrealized</th><th>10 EMA</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const days = holding.brokerTradingDaysHeld;
            const daysLeft = days === undefined ? undefined : Math.max(3 - days, 0);
            const exitDue = daysLeft === 0;
            const actionTone = exitDue ? "exit" : daysLeft === 1 ? "danger" : daysLeft === 2 ? "good" : "neutral";
            const above10Ema = holding.distanceFrom10EmaPct !== undefined && holding.distanceFrom10EmaPct >= 0;
            const todayTone = holding.todayChangePct === undefined ? "neutral" : holding.todayChangePct >= 0 ? "positive" : "negative";
            return <tr key={holding.securityId} className={exitDue ? "portfolio-exit-row" : ""}>
              <td className="window">{holding.tradingSymbol}<small className="sample-warning">{holding.brokerEntryDate ? `Since ${holding.brokerEntryDate}` : "Entry date unavailable"}</small></td>
              <td>{holding.totalQty}</td>
              <td>{days === undefined ? "—" : days}<small className="sample-warning">trading days</small></td>
              <td>{holding.availableQty}</td>
              <td>{money(holding.avgCostPrice)}</td>
              <td>{rupees(holding.invested)}</td>
              <td className={`portfolio-live-price ${todayTone}`}>{holding.currentPrice === undefined ? "—" : money(holding.currentPrice)}<small>{holding.todayChangePct === undefined ? "waiting tick" : "live tick"}</small></td>
              <td className={`portfolio-live-change ${todayTone}`}>{holding.todayChangePct === undefined ? "—" : pct2(holding.todayChangePct)}</td>
              <td className={`portfolio-pnl ${holding.unrealizedPnl >= 0 ? "positive" : "negative"}`}>{rupees(holding.unrealizedPnl)}</td>
              <td>{holding.ema10 === undefined || holding.distanceFrom10EmaPct === undefined ? "—" : <span className={`portfolio-ema-pill ${above10Ema ? "above" : "below"}`}><b>{above10Ema ? "Above" : "Below"}</b><small>{money(holding.ema10)}</small></span>}</td>
              <td><span className={`portfolio-action-pill ${actionTone}`}>{exitDue ? "EXIT CHECK" : daysLeft === undefined ? "REVIEW" : `${daysLeft}D LEFT`}</span></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div> : <p className="panel-empty">No holdings returned by Dhan.</p>}
  </section>;
}

function TradeConfidenceCard({ trades }: { trades: ClosedTrade[] }) {
  const wins = trades.filter((trade) => trade.netPnl > 0).length;
  const totalPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const score = trades.length ? Math.round((wins / trades.length) * 65 + (totalPnl > 0 ? 35 : totalPnl === 0 ? 15 : 0)) : 0;
  const tone = score >= 75 ? "good" : score >= 45 ? "watch" : "danger";
  const title = !trades.length ? "No recent tape yet" : score >= 75 ? "Confidence: Smooth operator" : score >= 45 ? "Confidence: Seatbelt on" : "Confidence: Chai first, trades second";
  const note = !trades.length ? "Close a few lots and this card will start judging the vibe." : score >= 75 ? "Last 3 closed lots are giving clean follow-through energy." : score >= 45 ? "Mixed tape. Process is awake, ego should stay parked." : "Last 3 trades say reduce speed and let setups earn trust again.";
  return <section className={`panel dashboard-panel compact-dashboard-panel confidence-card ${tone}`}><div className="panel-head"><div><p className="eyebrow">Trade Mood</p><h2>{title}</h2></div><span className="confidence-score">{score}</span></div><p>{note}</p><div className="confidence-meter"><i style={{ width: `${score}%` }} /></div><small>{wins}/{trades.length || 0} wins · {rupees(totalPnl)} net over last 3</small></section>;
}

function DashboardView({ portfolio, loading, onRefresh }: { portfolio: PortfolioResponse | null; loading: boolean; onRefresh: () => void }) {
  const stats = portfolio?.stats;
  const lastTrades = portfolio?.closedTrades.slice(-3).reverse() ?? [];
  const settings = portfolio?.tradeManagement?.settings;
  const riskUnit = portfolio?.tradeManagement?.summary.riskUnit ?? (settings ? settings.totalCapital * settings.riskPercent / 100 : 0);
  const accountRisk = (portfolio?.holdings.length ?? 0) * riskUnit;
  const totalCapital = settings?.totalCapital ?? 0;
  const accountRiskPct = totalCapital > 0 ? (accountRisk / totalCapital) * 100 : 0;
  const avgTrade = stats?.closedTrades ? stats.realizedPnl / stats.closedTrades : 0;
  const riskTone = accountRiskPct > 0.7 ? "danger" : accountRiskPct > 0.5 ? "warn" : "good";
  return <section className="portfolio-page dashboard-snapshot"><div className="data-toolbar dashboard-hero"><div><p className="eyebrow">Dashboard</p><h2>{stats ? `Trading snapshot · ${stats.from} onward` : "Dhan portfolio snapshot"}</h2><small>{stats ? `${stats.from} to ${stats.to} · data locked to trades from 15 Apr 2026 onward` : "Fetch holdings and trades from Dhan."}</small></div><button className="primary" onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />Refresh</button></div>{!portfolio ? <section className="empty compact-empty"><div className="empty-art"><LayoutDashboard size={30} /></div><p className="eyebrow">Dashboard</p><h2>Ready to fetch Dhan data</h2><p>Use Refresh to load holdings, realized P&amp;L from 15 Apr 2026, and risk statistics.</p></section> : <><div className="dashboard-kpi-grid"><div className={`dashboard-kpi hero-kpi ${stats!.portfolioPnl >= 0 ? "good" : "bad"}`}><span>Total P&amp;L</span><b>{rupees(stats!.portfolioPnl)}</b><small>Realized {rupees(stats!.realizedPnl)} · Open {rupees(stats!.unrealizedPnl)}</small></div><div className="dashboard-kpi"><span>Invested</span><b>{rupees(stats!.totalInvested)}</b><small>{portfolio.holdings.length} live holdings</small></div><div className={`dashboard-kpi ${stats!.unrealizedPnl >= 0 ? "good" : "bad"}`}><span>Open P&amp;L</span><b>{rupees(stats!.unrealizedPnl)}</b><small>Current broker holdings</small></div><div className={`dashboard-kpi account-risk-card ${riskTone}`}><span>Account Risk</span><b>{rupees(accountRisk)}</b><small>{pct2(accountRiskPct)} of {rupees(totalCapital)}</small></div></div><div className="dashboard-glance-grid"><section className="panel dashboard-panel compact-dashboard-panel"><div className="panel-head"><div><p className="eyebrow">Trade Quality</p><h2>{stats!.winRate.toFixed(1)}% win rate</h2></div><span className="count">{stats!.closedTrades} closed</span></div><div className="dashboard-metrics"><span>Wins / Losses <b>{stats!.winners}:{stats!.losers}</b></span><span>Avg trade <b className={avgTrade >= 0 ? "positive" : "negative"}>{rupees(avgTrade)}</b></span><span>Avg win <b className="positive">{rupees(stats!.averageWin)}</b></span><span>Avg loss <b className="negative">{rupees(stats!.averageLoss)}</b></span><span>Best <b className="positive">{rupees(stats!.maxProfit)}</b></span><span>Worst <b className="negative">{rupees(stats!.maxLoss)}</b></span></div></section><section className="panel dashboard-panel compact-dashboard-panel recent-trades-panel"><div className="panel-head"><div><p className="eyebrow">Recent Realized Trades</p><h2>Last 3 closed lots</h2></div></div>{lastTrades.length ? <div className="recent-trade-list">{lastTrades.map((trade, index) => <div key={`${trade.securityId}-${trade.date}-${index}`}><span><b>{trade.symbol}</b><small>{trade.date} · Qty {trade.quantity}</small></span><strong className={trade.netPnl >= 0 ? "positive" : "negative"}>{rupees(trade.netPnl)}</strong></div>)}</div> : <p className="panel-empty">No realized closed lots from 15 Apr 2026 onward.</p>}</section><TradeConfidenceCard trades={lastTrades} /><section className="panel dashboard-panel compact-dashboard-panel dashboard-chart-panel wide-chart"><div className="panel-head"><div><p className="eyebrow">Overall P&amp;L</p><h2>Equity line</h2></div></div><MiniLineChart points={portfolio.equityCurve} /></section><section className="panel dashboard-panel compact-dashboard-panel dashboard-chart-panel wide-chart"><div className="panel-head"><div><p className="eyebrow">Month-on-Month</p><h2>Realized bars</h2></div></div><MonthlyBars rows={portfolio.monthlyPnl} /></section></div></>}</section>;
}

function BasketBacktestView({ filters, setFilters, data, loading, onRun }: { filters: BasketBacktestFilters; setFilters: (filters: BasketBacktestFilters) => void; data: BasketBacktestResult | null; loading: boolean; onRun: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => { if (data?.snapshots.length) setStep(data.snapshots.length - 1); }, [data]);
  const setNumber = (key: keyof BasketBacktestFilters, value: number) => setFilters({ ...filters, [key]: value });
  const isDryVolumeStrategy = filters.strategyMode === "DRY_VOLUME_BREAKOUT" || filters.strategyMode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE" || filters.strategyMode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RANDOM" || filters.strategyMode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM";
  const isQullamaggieStrategy = filters.strategyMode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE" || filters.strategyMode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RANDOM" || filters.strategyMode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM";
  const isRandomEntryStrategy = filters.strategyMode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RANDOM";
  const isRiskRandomEntryStrategy = filters.strategyMode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM";
  const snapshot = data?.snapshots[step];
  const equityPoints = data?.snapshots.map((row) => ({ date: row.date, cumulative: row.equity - data.summary.initialCapital })) ?? [];
  const report = useMemo(() => {
    if (!data) return null;
    const monthly = new Map<string, { label: string; pnl: number; startEquity: number; endEquity: number; trades: number }>();
    const yearly = new Map<string, { label: string; pnl: number; startEquity: number; endEquity: number; trades: number }>();
    for (const snap of data.snapshots) {
      const month = snap.date.slice(0, 7);
      const year = snap.date.slice(0, 4);
      const monthRow = monthly.get(month) ?? { label: month, pnl: 0, startEquity: snap.equity - snap.day_pnl, endEquity: snap.equity, trades: 0 };
      monthRow.endEquity = snap.equity;
      monthly.set(month, monthRow);
      const yearRow = yearly.get(year) ?? { label: year, pnl: 0, startEquity: snap.equity - snap.day_pnl, endEquity: snap.equity, trades: 0 };
      yearRow.endEquity = snap.equity;
      yearly.set(year, yearRow);
    }
    for (const trade of data.trades) {
      const month = monthly.get(trade.date.slice(0, 7));
      const year = yearly.get(trade.date.slice(0, 4));
      if (trade.type === "BUY") {
        if (month) month.trades += 1;
        if (year) year.trades += 1;
        continue;
      }
      if (trade.type !== "SELL" || trade.pnl === undefined) continue;
      const monthKey = trade.date.slice(0, 7);
      const yearKey = trade.date.slice(0, 4);
      const monthRow = month ?? { label: monthKey, pnl: 0, startEquity: data.summary.initialCapital, endEquity: data.summary.initialCapital, trades: 0 };
      monthRow.pnl += trade.pnl;
      monthly.set(monthKey, monthRow);
      const yearRow = year ?? { label: yearKey, pnl: 0, startEquity: data.summary.initialCapital, endEquity: data.summary.initialCapital, trades: 0 };
      yearRow.pnl += trade.pnl;
      yearly.set(yearKey, yearRow);
    }
    const sells = data.trades.filter((event) => event.type === "SELL" && event.pnl !== undefined);
    const pnlValues = sells.map((event) => event.pnl ?? 0);
    const wins = pnlValues.filter((value) => value > 0);
    const losses = pnlValues.filter((value) => value < 0);
    const flats = pnlValues.length - wins.length - losses.length;
    const grossProfit = wins.reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
    const exposurePct = data.snapshots.length ? data.snapshots.filter((row) => row.invested > 0).length / data.snapshots.length * 100 : 0;
    const averageWin = wins.length ? grossProfit / wins.length : 0;
    const averageLoss = losses.length ? grossLoss / losses.length : 0;
    const expectancy = pnlValues.length ? pnlValues.reduce((sum, value) => sum + value, 0) / pnlValues.length : 0;
    const firstSnapshot = data.snapshots[0];
    const bestDay = firstSnapshot ? data.snapshots.reduce((best, row) => row.day_pnl > best.day_pnl ? row : best, firstSnapshot) : undefined;
    const worstDay = firstSnapshot ? data.snapshots.reduce((worst, row) => row.day_pnl < worst.day_pnl ? row : worst, firstSnapshot) : undefined;
    const partialExits = data.trades.filter((event) => event.reason.startsWith("Qullamaggie partial")).length;
    const realizedDayBuckets = new Map<string, number>();
    let cumulativeRealized = 0;
    let realizedPeak = 0;
    let maxRealizedDrawdown = 0;
    let maxRealizedDrawdownDate = "";
    for (const sell of sells) {
      const pnl = sell.pnl ?? 0;
      cumulativeRealized += pnl;
      realizedDayBuckets.set(sell.date, (realizedDayBuckets.get(sell.date) ?? 0) + pnl);
      realizedPeak = Math.max(realizedPeak, cumulativeRealized);
      const drawdown = cumulativeRealized - realizedPeak;
      if (drawdown < maxRealizedDrawdown) {
        maxRealizedDrawdown = drawdown;
        maxRealizedDrawdownDate = sell.date;
      }
    }
    const realizedDays = Array.from(realizedDayBuckets.entries()).map(([date, pnl]) => ({ date, pnl }));
    const bestRealizedDay = realizedDays.reduce<{ date: string; pnl: number } | undefined>((best, row) => !best || row.pnl > best.pnl ? row : best, undefined);
    const worstRealizedDay = realizedDays.reduce<{ date: string; pnl: number } | undefined>((worst, row) => !worst || row.pnl < worst.pnl ? row : worst, undefined);
    const monthKeys = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyByYear = Array.from(yearly.keys()).sort().map((year) => {
      const months = monthKeys.map((month) => monthly.get(`${year}-${month}`)?.pnl ?? 0);
      return { year, months, total: months.reduce((sum, value) => sum + value, 0) };
    });
    const monthlyTotals = monthKeys.map((_, index) => monthlyByYear.reduce((sum, row) => sum + row.months[index], 0));
    const returnBase = data.summary.initialCapital;
    const monthlyRows = Array.from(monthly.values()).map((row) => ({ ...row, returnPct: returnBase ? (row.pnl / returnBase) * 100 : 0 }));
    const yearlyRows = Array.from(yearly.values()).map((row) => ({ ...row, returnPct: returnBase ? (row.pnl / returnBase) * 100 : 0 }));
    const startTime = Date.parse(data.summary.startDate);
    const endTime = Date.parse(data.summary.endDate);
    const elapsedYears = Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.max((endTime - startTime) / (365.25 * 24 * 60 * 60 * 1000), 1 / 365.25) : 1;
    const cagrPct = (Math.pow(data.summary.finalEquity / Math.max(1, data.summary.initialCapital), 1 / elapsedYears) - 1) * 100;
    const realizedTotal = pnlValues.reduce((sum, value) => sum + value, 0);
    const realizedReturnPct = returnBase ? realizedTotal / returnBase * 100 : 0;
    const realizedDrawdownPct = returnBase ? maxRealizedDrawdown / returnBase * 100 : 0;
    const averageMonthlyReturnPct = monthlyRows.length ? monthlyRows.reduce((sum, row) => sum + row.returnPct, 0) / monthlyRows.length : 0;
    const averageYearlyReturnPct = yearlyRows.length ? yearlyRows.reduce((sum, row) => sum + row.returnPct, 0) / yearlyRows.length : 0;
    const bestExitPnl = pnlValues.length ? Math.max(...pnlValues) : 0;
    const worstExitPnl = pnlValues.length ? Math.min(...pnlValues) : 0;
    return {
      monthlyRows,
      yearlyRows,
      monthNames,
      monthlyByYear,
      monthlyTotals,
      grandMonthlyTotal: monthlyTotals.reduce((sum, value) => sum + value, 0),
      cagrPct,
      realizedTotal,
      realizedReturnPct,
      returnBase,
      maxRealizedDrawdown,
      maxRealizedDrawdownDate,
      realizedDrawdownPct,
      averageMonthlyReturnPct,
      averageYearlyReturnPct,
      wins: wins.length,
      losses: losses.length,
      flats,
      profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      averageWin,
      averageLoss,
      bestExitPnl,
      worstExitPnl,
      payoffRatio: averageLoss ? averageWin / averageLoss : 0,
      expectancy,
      exposurePct,
      bestDay,
      worstDay,
      bestRealizedDay,
      worstRealizedDay,
      partialExits,
    };
  }, [data, filters.compoundEquity]);
  return <section className="portfolio-page backtest-page">
    <div className="data-toolbar"><div><p className="eyebrow">Basket Rotation Backtest</p><h2>{isRiskRandomEntryStrategy ? "Dry Volume Breakout + Qullamaggie Risk Random Entry" : isRandomEntryStrategy ? "Dry Volume Breakout + Qullamaggie Random Entry" : isQullamaggieStrategy ? "Dry Volume Breakout + Qullamaggie Partial" : "Dry Volume Breakout"}</h2><small>{isRiskRandomEntryStrategy ? `Same random watchlist selection and Qullamaggie management, but position size and new entries are controlled by account risk.` : isRandomEntryStrategy ? `Same Qullamaggie trade management, but randomly picks from fresh eligible ENTRY signals when slots are limited.` : isQullamaggieStrategy ? `Same dry-volume entry and exit, plus sell 30% at 3R or day ${filters.partialExitDay || 3} close if still holding.` : "Ranks 30% impulse stocks by low-volume pullback, dry-candle breakout level, SL risk, and 10 EMA trail behavior."} This is research simulation only.</small></div><button className="primary" onClick={onRun} disabled={loading}><BarChart3 size={15}/>{loading ? "Running..." : "Run Backtest"}</button></div>
    <div className="control-grid">
      <label>Strategy<select value={filters.strategyMode} onChange={(e) => setFilters({ ...filters, strategyMode: e.target.value as BasketBacktestFilters["strategyMode"] })}><option value="DRY_VOLUME_BREAKOUT">Dry Volume Breakout</option><option value="DRY_VOLUME_BREAKOUT_QULLAMAGGIE">Dry Volume Breakout + Qullamaggie Partial</option><option value="DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RANDOM">Dry Volume Breakout + Qullamaggie Random Entry</option><option value="DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM">Dry Volume Breakout + Qullamaggie Risk Random Entry</option></select></label>
      <label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as BasketBacktestFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label>
      <label>Capital<input className="plain-input" type="number" value={filters.initialCapital} onChange={(e) => setNumber("initialCapital", Number(e.target.value))}/></label>
      {!isRiskRandomEntryStrategy && <label>Basket Size<input className="plain-input" type="number" value={filters.basketSize} onChange={(e) => setNumber("basketSize", Number(e.target.value))}/></label>}
      {isRiskRandomEntryStrategy && <>
        <label>Max Risk / Trade %<input className="plain-input" type="number" min="0" step="0.05" value={filters.maxRiskPerTradePct} onChange={(e) => setNumber("maxRiskPerTradePct", Number(e.target.value))}/></label>
        <label>Max Open Risk %<input className="plain-input" type="number" min="0" step="0.1" value={filters.maxOpenRiskPct} onChange={(e) => setNumber("maxOpenRiskPct", Number(e.target.value))}/></label>
      </>}
      {!isRiskRandomEntryStrategy && <label>Exit Below Rank<input className="plain-input" type="number" value={filters.exitRankBelow} onChange={(e) => setNumber("exitRankBelow", Number(e.target.value))}/></label>}
      <label className="toggle-row"><input type="checkbox" checked={filters.compoundEquity} onChange={(e) => setFilters({ ...filters, compoundEquity: e.target.checked })}/><span>Compound equity into next entries</span></label>
      {filters.strategyMode === "RS_TIGHT_2025" && <>
        <label>Enter Breadth %<input className="plain-input" type="number" value={filters.breadthMin} onChange={(e) => setNumber("breadthMin", Number(e.target.value))}/></label>
        <label>Exit Breadth %<input className="plain-input" type="number" value={filters.exitBreadthBelow} onChange={(e) => setNumber("exitBreadthBelow", Number(e.target.value))}/></label>
        <label>Min 60D RS %<input className="plain-input" type="number" value={filters.minRs60} onChange={(e) => setNumber("minRs60", Number(e.target.value))}/></label>
        <label>Max Entry Vol<input className="plain-input" type="number" step="0.1" value={filters.maxEntryVolumeRatio} onChange={(e) => setNumber("maxEntryVolumeRatio", Number(e.target.value))}/></label>
        <label className="toggle-row"><input type="checkbox" checked={filters.exitBelow20Ema} onChange={(e) => setFilters({ ...filters, exitBelow20Ema: e.target.checked })}/><span>Exit below 20 EMA</span></label>
      </>}
      {(filters.strategyMode === "PULLBACK_RECLAIM" || isDryVolumeStrategy) && <>
      <label>Impulse Move %<input className="plain-input" type="number" value={filters.minMovePct} onChange={(e) => setNumber("minMovePct", Number(e.target.value))}/></label>
      <label>Move Window<input className="plain-input" type="number" value={filters.moveWindowDays} onChange={(e) => setNumber("moveWindowDays", Number(e.target.value))}/></label>
      <label>Impulse Lookback<input className="plain-input" type="number" value={filters.impulseLookbackDays} onChange={(e) => setNumber("impulseLookbackDays", Number(e.target.value))}/></label>
      <label>Impulse Vol Ratio<input className="plain-input" type="number" step="0.1" value={filters.minImpulseVolumeRatio} onChange={(e) => setNumber("minImpulseVolumeRatio", Number(e.target.value))}/></label>
      <label>Min Pullback Days<input className="plain-input" type="number" value={filters.minPullbackDays} onChange={(e) => setNumber("minPullbackDays", Number(e.target.value))}/></label>
      <label>Max Pullback Days<input className="plain-input" type="number" value={filters.maxPullbackDays} onChange={(e) => setNumber("maxPullbackDays", Number(e.target.value))}/></label>
      <label>Min Pullback %<input className="plain-input" type="number" value={filters.minPullbackPct} onChange={(e) => setNumber("minPullbackPct", Number(e.target.value))}/></label>
      <label>Max Pullback %<input className="plain-input" type="number" value={filters.maxPullbackPct} onChange={(e) => setNumber("maxPullbackPct", Number(e.target.value))}/></label>
      {filters.strategyMode === "PULLBACK_RECLAIM" && 
      <label>Pullback Vol Max<input className="plain-input" type="number" step="0.05" value={filters.maxPullbackVolumeRatio} onChange={(e) => setNumber("maxPullbackVolumeRatio", Number(e.target.value))}/></label>
      }
      {isDryVolumeStrategy && <>
        <label>Dry Vol Ratio<input className="plain-input" type="number" step="0.05" value={filters.dryVolumeRatio} onChange={(e) => setNumber("dryVolumeRatio", Number(e.target.value))}/></label>
        <label>Dry Vol Lookback<input className="plain-input" type="number" value={filters.dryVolumeLookbackDays} onChange={(e) => setNumber("dryVolumeLookbackDays", Number(e.target.value))}/></label>
        <label>Breakout Within<input className="plain-input" type="number" value={filters.breakoutWithinDays} onChange={(e) => setNumber("breakoutWithinDays", Number(e.target.value))}/></label>
        <label>Entry Near %<input className="plain-input" type="number" step="0.1" value={filters.maxDistanceToEntryPct} onChange={(e) => setNumber("maxDistanceToEntryPct", Number(e.target.value))}/></label>
        <label>SL Buffer %<input className="plain-input" type="number" step="0.05" value={filters.stopBufferPct} onChange={(e) => setNumber("stopBufferPct", Number(e.target.value))}/></label>
        {isQullamaggieStrategy && <>
          <label>Target 1 R<input className="plain-input" type="number" min="0.1" step="0.1" value={filters.target1R} onChange={(e) => setNumber("target1R", Number(e.target.value))}/></label>
          <label>Target 1 Sell %<input className="plain-input" type="number" min="0" max="100" step="1" value={filters.target1ExitPct} onChange={(e) => setNumber("target1ExitPct", Number(e.target.value))}/></label>
          <label>Target 2 R<input className="plain-input" type="number" min="0.1" step="0.1" value={filters.target2R} onChange={(e) => setNumber("target2R", Number(e.target.value))}/></label>
          <label>Target 2 Sell %<input className="plain-input" type="number" min="0" max="100" step="1" value={filters.target2ExitPct} onChange={(e) => setNumber("target2ExitPct", Number(e.target.value))}/></label>
          <label>Target 1 Day Exit<input className="plain-input" type="number" min="1" value={filters.partialExitDay} onChange={(e) => setNumber("partialExitDay", Number(e.target.value))}/></label>
        </>}
        <label className="toggle-row"><input type="checkbox" checked={filters.exitBelow10Ema} onChange={(e) => setFilters({ ...filters, exitBelow10Ema: e.target.checked })}/><span>Exit below 10 EMA</span></label>
      </>}
      </>}
      <label>Start Date<input className="plain-input" type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}/></label>
      <label>End Date<input className="plain-input" type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}/></label>
    </div>
    {data && <><div className="stats-grid">
      <Stat label="Realized P&L" value={report ? rupees(report.realizedTotal) : "—"} sub={report ? `${pct(report.realizedReturnPct)} on ${rupees(report.returnBase)}` : undefined} />
      <Stat label="Liquidation Equity" value={rupees(data.summary.finalEquity)} sub="Includes open positions" />
      <Stat label="Realized Drawdown" value={report ? pct(report.realizedDrawdownPct) : "—"} sub={report?.maxRealizedDrawdownDate ? `${rupees(report.maxRealizedDrawdown)} on ${report.maxRealizedDrawdownDate}` : "Closed trades only"} />
      <Stat label="Trades / Win Rate" value={`${data.summary.trades} / ${data.summary.winRate.toFixed(1)}%`} sub={`${data.summary.closedTrades} closed`} />
      <Stat label="Avg / Best / Worst Exit" value={report ? `${rupees(report.expectancy)} / ${rupees(report.bestExitPnl)} / ${rupees(report.worstExitPnl)}` : "—"} />
    </div>
    {report && <><div className="stats-grid">
      <Stat label="Profit Factor" value={Number.isFinite(report.profitFactor) ? `${report.profitFactor.toFixed(2)}x` : "∞"} sub={`Gross winners / gross losers`} />
      <Stat label="Expectancy / Exit" value={rupees(report.expectancy)} sub={`Avg win ${rupees(report.averageWin)} · Avg loss ${rupees(report.averageLoss)}`} />
      <Stat label="Payoff Ratio" value={`${report.payoffRatio.toFixed(2)}x`} sub={`${report.wins} wins · ${report.losses} losses · ${report.flats} flat`} />
      <Stat label="Exposure" value={pct(report.exposurePct)} sub={`${report.partialExits} partial exits`} />
    </div><div className="stats-grid">
      <Stat label="Best Realized Day" value={rupees(report.bestRealizedDay?.pnl ?? 0)} sub={report.bestRealizedDay?.date} />
      <Stat label="Worst Realized Day" value={rupees(report.worstRealizedDay?.pnl ?? 0)} sub={report.worstRealizedDay?.date} />
      <Stat label="Positive Realized Months" value={`${report.monthlyRows.filter((row) => row.pnl > 0).length}/${report.monthlyRows.length}`} />
      <Stat label="Avg Monthly Realized" value={pct(report.averageMonthlyReturnPct)} sub={report.monthlyRows.at(-1) ? `Latest ${report.monthlyRows.at(-1)!.label}: ${rupees(report.monthlyRows.at(-1)!.pnl)}` : undefined} />
      <Stat label="Avg Yearly Realized" value={pct(report.averageYearlyReturnPct)} sub={`${report.yearlyRows.length} year rows`} />
    </div></>}
    <section className="panel dashboard-panel"><div className="panel-head"><div><p className="eyebrow">Equity Curve</p><h2>Basket simulation P&amp;L with trade dots</h2></div><div className="chart-legend compact-legend"><span><i className="legend-buy" />Buy</span><span><i className="legend-sell-win" />Profit sell</span><span><i className="legend-sell-loss" />Loss sell</span></div></div><BacktestEquityChart points={equityPoints} trades={data.trades} /></section>
    {report && <div className="dashboard-grid backtest-analytics-grid">
      <section className="panel dashboard-panel"><div className="panel-head"><div><p className="eyebrow">Monthly P&amp;L</p><h2>Realized month-by-month bars</h2></div></div><BacktestReturnBars rows={report.monthlyRows.map((row) => ({ label: row.label, pnl: row.pnl }))} /></section>
      <section className="panel dashboard-panel"><div className="panel-head"><div><p className="eyebrow">Trade Mix</p><h2>Exit distribution</h2></div></div><BacktestTradeDonut wins={report.wins} losses={report.losses} breakeven={report.flats} /></section>
    </div>}
    {report && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Monthly Report</p><h2>Realized profit/loss matrix</h2></div><span className="count">SELL P&amp;L only</span></div><div className="table-wrap"><table className="monthly-matrix-table"><thead><tr><th>Year</th>{report.monthNames.map((month) => <th key={month}>{month}</th>)}<th>Total</th></tr></thead><tbody>{report.monthlyByYear.map((row) => <tr key={row.year}><td className="window">{row.year}</td>{row.months.map((value, index) => <td key={`${row.year}-${index}`} className={value >= 0 ? "positive" : "negative"}>{value === 0 ? "—" : rupees(value)}</td>)}<td className={row.total >= 0 ? "positive" : "negative"}>{rupees(row.total)}</td></tr>)}<tr className="matrix-total-row"><td className="window">Total</td>{report.monthlyTotals.map((value, index) => <td key={`total-${index}`} className={value >= 0 ? "positive" : "negative"}>{value === 0 ? "—" : rupees(value)}</td>)}<td className={report.grandMonthlyTotal >= 0 ? "positive" : "negative"}>{rupees(report.grandMonthlyTotal)}</td></tr></tbody></table></div></section>}
    <section className="panel"><div className="panel-head"><div><p className="eyebrow">Day Replay</p><h2>{snapshot?.date ?? "No snapshot"}</h2></div><div className="toolbar-actions"><button className="secondary compact" onClick={() => setStep(0)} disabled={!step}>First</button><button className="secondary compact" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={!step}>Prev Day</button><button className="primary compact" onClick={() => setStep((value) => Math.min((data.snapshots.length || 1) - 1, value + 1))} disabled={step >= data.snapshots.length - 1}>Next Day</button><button className="secondary compact" onClick={() => setStep(data.snapshots.length - 1)}>Latest</button></div></div><div className="progress-track"><i style={{ width: `${data.snapshots.length <= 1 ? 100 : (step / (data.snapshots.length - 1)) * 100}%` }} /></div>{snapshot && <div className="stats-grid compact-stats"><Stat label="Equity" value={rupees(snapshot.equity)} sub={`Day ${step + 1} of ${data.snapshots.length}`}/><Stat label="P&L Change" value={rupees(snapshot.day_pnl)} /><Stat label="Cash" value={rupees(snapshot.cash)} /><Stat label="Drawdown" value={pct(snapshot.drawdown_pct)} sub={`Invested ${rupees(snapshot.invested)}`} /></div>}</section>
    {snapshot && <div className="dashboard-grid">
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">Basket</p><h2>Current holdings</h2></div></div>{snapshot.holdings.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Rank</th><th>Entry</th><th>Stop</th><th>Current</th><th>Value</th><th>Open Risk</th><th>P&L</th><th>Score</th></tr></thead><tbody>{snapshot.holdings.map((holding) => <tr key={holding.security_id}><td className="window">{holding.symbol}<small className="sample-warning">{holding.company_name}</small></td><td>{holding.rank ?? "Off list"}</td><td>{money(holding.entry_price)}<small className="sample-warning">{holding.entry_date}</small></td><td>{holding.stop_loss === undefined ? "—" : money(holding.stop_loss)}</td><td>{money(holding.current_price)}</td><td>{rupees(holding.market_value)}</td><td>{holding.open_risk === undefined ? "—" : rupees(holding.open_risk)}<small>{holding.open_risk_pct === undefined ? "" : pct(holding.open_risk_pct)}</small></td><td className={holding.pnl >= 0 ? "positive" : "negative"}>{rupees(holding.pnl)}<small>{pct(holding.pnl_pct)}</small></td><td>{holding.score ?? "—"}</td></tr>)}</tbody></table></div> : <p className="panel-empty">Basket is empty on this day.</p>}</section>
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">Events</p><h2>Today decisions</h2></div></div>{snapshot.events.length ? <div className="timeline">{snapshot.events.map((event, index) => <div key={`${event.type}-${event.symbol}-${index}`}><b>{event.type} · {event.symbol}</b><span>{money(event.price)} · {rupees(event.amount)}{event.pnl !== undefined ? ` · P&L ${rupees(event.pnl)}` : ""}</span><small>{event.reason}</small></div>)}</div> : <p className="panel-empty">No basket changes on this day.</p>}</section>
    </div>}
    {snapshot && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Ranked Watchlist</p><h2>Top setup candidates</h2></div><span className="count">{snapshot.candidates.length} shown</span></div>{snapshot.candidates.length ? <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Symbol</th><th>Trigger</th><th>Score</th><th>Close</th><th>Entry / SL</th><th>Impulse</th><th>Impulse Vol</th><th>Pullback</th><th>Dry Vol</th><th>10 EMA</th><th>Reason</th></tr></thead><tbody>{snapshot.candidates.map((row) => { const triggerLabel = row.trigger ? "ENTRY" : row.entry_triggered ? "TRIGGERED" : "WAIT"; const triggerClass = row.trigger ? "good" : row.entry_triggered ? "warn" : "neutral"; return <tr key={row.security_id}><td>{row.rank}</td><td className="window">{row.symbol}<small className="sample-warning">{row.company_name}</small></td><td><span className={`stage-badge ${triggerClass}`}>{triggerLabel}</span></td><td>{row.score}</td><td>{money(row.close)}</td><td>{row.entry_price === undefined ? "—" : money(row.entry_price)}<small className="sample-warning">{row.stop_loss === undefined ? "" : `SL ${money(row.stop_loss)}`}</small></td><td className="positive">{pct(row.impulse_return_pct)}</td><td>{row.impulse_volume_ratio.toFixed(2)}x</td><td className="negative">{pct(-row.pullback_pct)}<small>{row.pullback_days} days</small></td><td>{row.pullback_volume_ratio.toFixed(2)}x</td><td className={row.distance_from_10ema_pct >= 0 ? "positive" : "negative"}>{pct(row.distance_from_10ema_pct)}</td><td>{row.reason}{row.blocked_reason && <small className="sample-warning">{row.blocked_reason}</small>}</td></tr>; })}</tbody></table></div> : <p className="panel-empty">No ranked setups on this day.</p>}</section>}
    <section className="panel"><div className="panel-head"><div><p className="eyebrow">Trade Log</p><h2>All simulated basket changes</h2></div><span className="count">{data.trades.length} events</span></div>{data.trades.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Action</th><th>Symbol</th><th>Price</th><th>Amount</th><th>P&L</th><th>Reason</th></tr></thead><tbody>{data.trades.slice(-80).reverse().map((event, index) => <tr key={`${event.date}-${event.symbol}-${event.type}-${index}`}><td>{event.date}</td><td><span className={`stage-badge ${event.type === "BUY" ? "good" : "warn"}`}>{event.type}</span></td><td className="window">{event.symbol}</td><td>{money(event.price)}</td><td>{rupees(event.amount)}</td><td className={(event.pnl ?? 0) >= 0 ? "positive" : "negative"}>{event.pnl === undefined ? "—" : rupees(event.pnl)}</td><td>{event.reason}</td></tr>)}</tbody></table></div> : <p className="panel-empty">No trades generated yet.</p>}</section></>}
  </section>;
}

function PortfolioView({ portfolio, loading, onRefresh, setLiveFeedStatus }: { portfolio: PortfolioResponse | null; loading: boolean; onRefresh: () => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void }) {
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  useEffect(() => {
    const ids = (portfolio?.holdings ?? []).map((holding) => holding.securityId).filter(Boolean).join(",");
    setLiveTicks({});
    if (!ids) {
      setLiveFeedStatus("idle");
      return;
    }
    setLiveFeedStatus("connecting", "Starting Portfolio live P&L");
    const source = new EventSource(`/api/portfolio/live?ids=${encodeURIComponent(ids)}`);
    source.onopen = () => setLiveFeedStatus("connecting", "Waiting for Dhan portfolio ticks");
    source.addEventListener("status", (event) => {
      const status = JSON.parse((event as MessageEvent).data) as LiveFeedStatusUpdate;
      if (status.state === "idle" || status.state === "connecting" || status.state === "live" || status.state === "error") setLiveFeedStatus(status.state, status.message);
    });
    source.addEventListener("snapshot", (event) => {
      const ticks = JSON.parse((event as MessageEvent).data) as LiveTick[];
      setLiveTicks(Object.fromEntries(ticks.map((tick) => [tick.securityId, tick])));
      if (ticks.length) setLiveFeedStatus("live", "Portfolio live P&L streaming");
    });
    source.addEventListener("tick", (event) => {
      const tick = JSON.parse((event as MessageEvent).data) as LiveTick;
      setLiveTicks((current) => ({ ...current, [tick.securityId]: tick }));
      setLiveFeedStatus("live", "Portfolio live P&L streaming");
    });
    source.addEventListener("error", () => {
      setLiveFeedStatus("error", "Portfolio live feed disconnected");
    });
    return () => {
      source.close();
      setLiveFeedStatus("idle");
    };
  }, [portfolio, setLiveFeedStatus]);
  const livePortfolio = useMemo(() => liveAdjustedPortfolio(portfolio, liveTicks), [portfolio, liveTicks]);
  const settings = livePortfolio?.tradeManagement?.settings;
  const riskUnit = livePortfolio?.tradeManagement?.summary.riskUnit ?? (settings ? settings.totalCapital * settings.riskPercent / 100 : 0);
  const liveHoldings = livePortfolio?.holdings.length ?? 0;
  const accountRisk = liveHoldings * riskUnit;
  const totalCapital = settings?.totalCapital ?? 0;
  const accountRiskPct = totalCapital > 0 ? (accountRisk / totalCapital) * 100 : 0;
  const riskTone = accountRiskPct > 0.7 ? "danger" : accountRiskPct > 0.5 ? "warn" : "good";
  const exitChecks = livePortfolio?.holdings.filter((holding) => (holding.brokerTradingDaysHeld ?? 0) >= 3).length ?? 0;
  const liveTickCount = Object.keys(liveTicks).length;
  return <section className="portfolio-page"><div className="data-toolbar portfolio-hero"><div><p className="eyebrow">Connected portfolio</p><h2>Dhan holdings</h2><small>{livePortfolio ? `Live P&L ${liveTickCount ? `on for ${liveTickCount}/${liveHoldings}` : "connecting"} · trading-day age and account risk.` : "Live holdings, trading-day age, and account risk."}</small></div><button className="primary" onClick={onRefresh} disabled={loading}><WalletCards size={15} />Refresh Portfolio</button></div>{!livePortfolio ? <section className="empty"><div className="empty-art"><WalletCards size={30} /></div><p className="eyebrow">Portfolio</p><h2>Fetch your Dhan holdings</h2><p>Your Dhan access token remains server-side. This view will populate with live holdings and account risk.</p></section> : <><div className="portfolio-risk-strip"><div><span>Invested</span><b>{rupees(livePortfolio.stats.totalInvested)}</b><small>{liveHoldings} live holdings</small></div><div><span>Risk Unit</span><b>{rupees(riskUnit)}</b><small>{settings ? `${settings.riskPercent.toFixed(2)}% per holding` : "Settings unavailable"}</small></div><div><span>Open P&amp;L</span><b className={livePortfolio.stats.unrealizedPnl >= 0 ? "positive" : "negative"}>{rupees(livePortfolio.stats.unrealizedPnl)}</b><small>Live broker ticks</small></div><div className={`account-risk-card ${riskTone}`}><span>Account Risk</span><b>{rupees(accountRisk)}</b><small>{pct2(accountRiskPct)} of {rupees(totalCapital)}</small></div></div>{exitChecks > 0 && <div className="notice danger-notice"><AlertTriangle size={17}/><span>{exitChecks} open holding{exitChecks === 1 ? "" : "s"} reached the 3rd trading day. Review the Actions column for exit checks.</span></div>}<PortfolioTable holdings={livePortfolio.holdings} /></>}</section>;
}

function DataStatusView({ status, loading, onRefresh, onRefreshUniverse, onRetryFailures }: { status: DataStatus | null; loading: boolean; onRefresh: () => void; onRefreshUniverse: (universe?: UniverseName) => void; onRetryFailures: () => void }) {
  const dhanConnectionSub = status?.dhan_profile?.error || (status?.dhan_profile?.dataPlan ? `Data plan ${status.dhan_profile.dataPlan}${status.dhan_profile.tokenValidity ? ` · token ${status.dhan_profile.tokenValidity}` : ""}` : "Server-side credentials only");
  return <section className="data-dashboard"><div className="notice"><AlertTriangle size={18} /><span>Universe uses current index constituents. Historical results may be affected by survivorship bias because historical index membership is not yet reconstructed.</span></div><div className="data-toolbar"><div><p className="eyebrow">Phase 2A data foundation</p><h2>Universe → Security IDs → Historical OHLCV</h2><small>Dhan price adjustment status: {status?.price_adjustment_status || "UNKNOWN"}. Adjusted data must be verified.</small></div><div className="toolbar-actions"><button className="secondary" onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />Refresh Status</button><button className="primary" onClick={() => onRefreshUniverse()} disabled={loading}><Database size={15} />Refresh All Data</button></div></div>{status && <><div className="stats-grid"><Stat label="Dhan connection" value={status.dhan_connected ? "Ready" : "Check token"} sub={dhanConnectionSub} /><Stat label="Database size" value={`${(status.database_size_bytes / 1024 / 1024).toFixed(2)} MB`} sub=".data local store" /><Stat label="Open failures" value={`${status.failures.length}`} sub="Retryable" /><Stat label="Quality issues" value={`${status.quality_issues.length}`} sub="Flagged, not deleted" /></div>{status.latest_market_data && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Latest Market Data</p><h2>{status.latest_market_data.trading_date}</h2></div><span className="count">{status.latest_market_data.provisional ? "PROVISIONAL" : "OFFICIAL"}</span></div><div className="metric-list job-list"><span>Official <b>{status.latest_market_data.official}</b></span><span>Provisional <b>{status.latest_market_data.provisional}</b></span><span>Data Status <b>{status.latest_market_data.data_status}</b></span></div></section>}<div className="universe-grid">{status.summaries.map((s) => <section className="panel" key={s.universe_name}><div className="panel-head"><div><p className="eyebrow">{s.universe_name}</p><h2>{s.universe_name === "MIDCAP" ? "Nifty Midcap 150" : "Nifty Smallcap 250"}</h2></div><button className="secondary compact" onClick={() => onRefreshUniverse(s.universe_name)} disabled={loading}><RefreshCw size={14} />Refresh</button></div><div className="metric-list"><span>Total constituents <b>{s.total_constituents}</b></span><span>Mapped to Dhan <b>{s.mapped}</b></span><span>Stocks downloaded <b>{s.stocks_downloaded}</b></span><span>Pending <b>{s.stocks_pending}</b></span><span>Failed <b>{s.stocks_failed}</b></span><span>Historical sessions <b>{s.historical_sessions}</b></span><span>Earliest date <b>{s.earliest_data_date || "—"}</b></span><span>Latest date <b>{s.latest_data_date || "—"}</b></span><span>Latest official <b>{s.latest_official ?? 0}</b></span><span>Latest provisional <b>{s.latest_provisional ?? 0}</b></span><span>Total OHLCV rows <b>{s.total_ohlcv_rows}</b></span><span>Last refresh <b>{s.last_refresh?.slice(0, 10) || "—"}</b></span></div></section>)}</div>{status.latest_job && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Download progress</p><h2>{status.latest_job.status}</h2></div><span className="count">{status.latest_job.progress}%</span></div><div className="progress-track"><i style={{ width: `${status.latest_job.progress}%` }} /></div><div className="metric-list job-list"><span>Trading date <b>{status.latest_job.trading_date || "—"}</b></span><span>Total stocks <b>{status.latest_job.total}</b></span><span>Completed <b>{status.latest_job.completed}</b></span><span>Remaining <b>{status.latest_job.remaining}</b></span><span>Successful <b>{status.latest_job.successful}</b></span><span>Failed <b>{status.latest_job.failed}</b></span><span>Historical backfill <b>{status.latest_job.historical_candles_backfilled ?? 0}</b></span><span>Official updates <b>{status.latest_job.official_candles_updated ?? 0}</b></span><span>Reconciled <b>{status.latest_job.provisional_candles_reconciled ?? 0}</b></span><span>Today's provisional <b>{status.latest_job.provisional_candles_created ?? 0}</b></span><span>Already up-to-date <b>{status.latest_job.already_up_to_date ?? 0}</b></span><span>Current stock <b>{status.latest_job.current_stock || "—"}</b></span><span>Current status <b>{status.latest_job.current_status || "—"}</b></span><span>Data through date <b>{status.latest_job.data_through_date || "—"}</b></span>{status.latest_job.pending_eod_count ? <span>Pending Dhan EOD <b>{status.latest_job.pending_eod_count}</b></span> : null}</div>{status.latest_job.notice && <div className="job-notice"><b>Data is current</b><span>{status.latest_job.notice}</span></div>}{status.latest_job.errors?.length > 0 && <div className="job-errors"><b>Latest job error</b><span>{status.latest_job.errors.at(-1)}</span></div>}</section>}<section className="panel"><div className="panel-head"><div><p className="eyebrow">Failures and exports</p><h2>Download audit</h2></div><div className="toolbar-actions"><a className="secondary compact" href="/api/data/export/universe"><Download size={14} />Export Universe</a><a className="secondary compact" href="/api/data/export/failures"><Download size={14} />Export Failed</a><button className="secondary compact" onClick={onRetryFailures} disabled={loading || !status.failures.length}><RefreshCw size={14} />Retry Failed</button></div></div>{status.failures.length ? <div className="table-wrap"><table><tbody>{status.failures.map((f) => <tr key={`${f.security_id}-${f.last_attempt}`}><td className="window">{f.symbol}</td><td>{f.security_id}</td><td>{f.attempt_count}</td><td>{f.error_message}</td></tr>)}</tbody></table></div> : <p className="panel-empty">No open failed downloads.</p>}</section></>}</section>;
}

function SwingScreenerView({ swing, filters, setFilters, loading, onRun, onReset, selected, setSelected }: { swing: SwingResponse | null; filters: SwingFilters; setFilters: (filters: SwingFilters) => void; loading: boolean; onRun: () => void; onReset: () => void; selected: SwingRow | null; setSelected: (row: SwingRow | null) => void }) {
  const setNumber = (key: keyof SwingFilters, value: number) => setFilters({ ...filters, [key]: value });
  return <section className="research-page"><div className="notice"><AlertTriangle size={18}/><span>Swing Screener uses local daily OHLCV only. This is a research watchlist, not a buy/sell recommendation.</span></div><div className="data-toolbar"><div><p className="eyebrow">Swing Screener</p><h2>50 EMA breakout → pullback near rising EMA</h2><small>Finds stocks that broke above 50 EMA on strong volume and are now revisiting the 50 EMA area.</small></div><button className="primary" onClick={onRun} disabled={loading}><TrendingDown size={15}/>Run Swing Screener</button></div><div className="control-grid"><label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as SwingFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label><label>Breakout Lookback<input className="plain-input" type="number" value={filters.breakoutLookbackDays} onChange={(e) => setNumber("breakoutLookbackDays", Number(e.target.value))}/></label><label>Min Breakout Volume<input className="plain-input" type="number" step="0.1" value={filters.minBreakoutVolumeRatio} onChange={(e) => setNumber("minBreakoutVolumeRatio", Number(e.target.value))}/></label><label>Min Post-Breakout Gain %<input className="plain-input" type="number" value={filters.minPostBreakoutGainPct} onChange={(e) => setNumber("minPostBreakoutGainPct", Number(e.target.value))}/></label><label>Min Distance From EMA %<input className="plain-input" type="number" value={filters.minDistanceFromEmaPct} onChange={(e) => setNumber("minDistanceFromEmaPct", Number(e.target.value))}/></label><label>Max Distance From EMA %<input className="plain-input" type="number" value={filters.maxDistanceFromEmaPct} onChange={(e) => setNumber("maxDistanceFromEmaPct", Number(e.target.value))}/></label><label>Min Days Since Breakout<input className="plain-input" type="number" value={filters.minDaysSinceBreakout} onChange={(e) => setNumber("minDaysSinceBreakout", Number(e.target.value))}/></label><label>Max Days Since Breakout<input className="plain-input" type="number" value={filters.maxDaysSinceBreakout} onChange={(e) => setNumber("maxDaysSinceBreakout", Number(e.target.value))}/></label><label>Max Current Volume Ratio<input className="plain-input" type="number" step="0.1" value={filters.maxCurrentVolumeRatio} onChange={(e) => setNumber("maxCurrentVolumeRatio", Number(e.target.value))}/></label><label className="filter-row"><input type="checkbox" checked={filters.requireRisingEma} onChange={(e) => setFilters({ ...filters, requireRisingEma: e.target.checked })}/><span>Require rising 50 EMA</span></label><label className="filter-row"><input type="checkbox" checked={filters.showAll} onChange={(e) => setFilters({ ...filters, showAll: e.target.checked })}/><span>Show all evaluated stocks</span></label></div><div className="toolbar-actions"><button className="primary" onClick={onRun} disabled={loading}><SlidersHorizontal size={15}/>Run Screener</button><button className="secondary" onClick={onReset}>Reset Defaults</button></div>{swing && <><div className="stats-grid"><Stat label="Evaluated" value={`${swing.evaluated}`} /><Stat label="Qualified" value={`${swing.qualified}`} /><Stat label="Near EMA" value={`${swing.statusSummary["NEAR 50 EMA"] ?? 0}`} /><Stat label="Pullback" value={`${swing.statusSummary.PULLBACK ?? 0}`} /></div><section className="panel"><div className="table-wrap"><table><thead><tr><th>Status</th><th>Symbol</th><th>Company</th><th>Universe</th><th>Close</th><th>50 EMA</th><th>Distance</th><th>Breakout Date</th><th>Breakout Vol</th><th>Days</th><th>Max Gain</th><th>Pullback</th><th>Current Vol</th><th>EMA Slope</th><th>Reason</th></tr></thead><tbody>{swing.results.map((row) => <tr className="click-row" key={row.security_id} onClick={() => setSelected(row)}><td><span className={row.qualifies ? "eligible" : "count"}>{row.status}</span></td><td className="window">{row.symbol}</td><td>{row.company_name}</td><td>{row.universe_name}</td><td>{money(row.current_close)}</td><td>{money(row.ema50)}</td><td className={row.distance_from_ema_pct >= 0 ? "positive" : "negative"}>{pct(row.distance_from_ema_pct)}</td><td>{row.breakout_date ?? "—"}</td><td>{row.breakout_volume_ratio ? `${row.breakout_volume_ratio.toFixed(1)}x` : "—"}</td><td>{row.days_since_breakout ?? "—"}</td><td className="positive">{row.max_gain_after_breakout_pct === undefined ? "—" : pct(row.max_gain_after_breakout_pct)}</td><td className="negative">{row.pullback_from_high_pct === undefined ? "—" : pct(row.pullback_from_high_pct)}</td><td>{row.current_volume_ratio ? `${row.current_volume_ratio.toFixed(1)}x` : "—"}</td><td className={row.ema50_slope_pct && row.ema50_slope_pct > 0 ? "positive" : "negative"}>{row.ema50_slope_pct === undefined ? "—" : pct(row.ema50_slope_pct)}</td><td>{row.reason}</td></tr>)}</tbody></table></div></section></>}{selected && <div className="drawer"><div className="drawer-card"><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">{selected.status}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">{selected.reason}</p><div className="stats-grid compact-stats"><Stat label="Current Close" value={money(selected.current_close)} sub={selected.current_date}/><Stat label="50 EMA" value={money(selected.ema50)} sub={pct(selected.distance_from_ema_pct)}/><Stat label="Breakout" value={selected.breakout_date ?? "—"} sub={selected.breakout_volume_ratio ? `${selected.breakout_volume_ratio.toFixed(1)}x vol` : undefined}/><Stat label="Days Since Breakout" value={`${selected.days_since_breakout ?? "—"}`} /></div><h3>Recent 120 daily rows</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Close</th><th>EMA50</th><th>Volume</th><th>Rel Vol</th></tr></thead><tbody>{selected.recent.map((row) => <tr key={row.trade_date}><td>{row.trade_date}</td><td>{money(row.close)}</td><td>{row.ema50 ? money(row.ema50) : "—"}</td><td>{row.volume.toLocaleString("en-IN")}</td><td>{row.volume_ratio ? `${row.volume_ratio.toFixed(1)}x` : "—"}</td></tr>)}</tbody></table></div></div></div>}</section>;
}

function SortHead<T extends string>({ label, column, sort, onSort }: { label: string; column: T; sort: { key: T; direction: "asc" | "desc" }; onSort: (column: T) => void }) {
  return <button className="sort-head" onClick={() => onSort(column)}>{label}{sort.key === column ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}</button>;
}

function DryVolumeBreakoutScreenerView({ data, filters, loading, onRun, onTradeCreated, setLiveFeedStatus }: { data: DryVolumeBreakoutResponse | null; filters: DryVolumeBreakoutFilters; loading: boolean; onRun: () => void; onTradeCreated: () => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void }) {
  const [sort, setSort] = useState<{ key: DryVolumeBreakoutSortKey; direction: "asc" | "desc" }>({ key: "score", direction: "desc" });
  const [selected, setSelected] = useState<DryVolumeBreakoutRow | null>(null);
  const [orderBusy, setOrderBusy] = useState<string | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const sortBy = (key: DryVolumeBreakoutSortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "distance" || key === "sl_pct" ? "asc" : "desc" });
  const liveCloseFor = (row: DryVolumeBreakoutRow) => liveTicks[row.security_id]?.ltp ?? row.current_close;
  const liveDistanceFor = (row: DryVolumeBreakoutRow) => row.entry_price ? (row.entry_price / Math.max(0.01, liveCloseFor(row)) - 1) * 100 : row.ltp_to_entry_pct;
  const rows = useMemo(() => {
    const valueFor = (row: DryVolumeBreakoutRow): number | string => {
      if (sort.key === "status") return row.status;
      if (sort.key === "score") return row.score;
      if (sort.key === "symbol") return row.symbol;
      if (sort.key === "universe") return row.universe_name;
      if (sort.key === "ltp") return liveCloseFor(row);
      if (sort.key === "entry") return row.entry_price ?? -Infinity;
      if (sort.key === "distance") return Math.abs(liveDistanceFor(row) ?? Infinity);
      if (sort.key === "sl_pct") return row.sl_pct ?? Infinity;
      if (sort.key === "dry_volume") return row.dry_candle_volume_ratio ?? Infinity;
      if (sort.key === "days") return row.days_since_dry_candle ?? Infinity;
      if (sort.key === "impulse") return row.impulse_return_pct ?? -Infinity;
      if (sort.key === "pullback") return row.pullback_pct ?? -Infinity;
      if (sort.key === "ema10") return row.distance_from_10ema_pct ?? -Infinity;
      return 0;
    };
    return [...(data?.results ?? [])].sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? result : -result;
    });
  }, [data, liveTicks, sort]);
  useEffect(() => {
    const screenRows = data?.results ?? [];
    if (!screenRows.length) {
      setLiveFeedStatus("idle");
      return;
    }
    setLiveFeedStatus("connecting");
    const ids = screenRows.map((row) => row.security_id).join(",");
    const source = new EventSource(`/api/thirty-up-screener/live?ids=${encodeURIComponent(ids)}`);
    source.onopen = () => setLiveFeedStatus("connecting", "Waiting for Dhan websocket status");
    source.addEventListener("status", (event) => {
      const status = JSON.parse((event as MessageEvent).data) as LiveFeedStatusUpdate;
      if (status.state === "idle" || status.state === "connecting" || status.state === "live" || status.state === "error") setLiveFeedStatus(status.state, status.message);
    });
    source.addEventListener("snapshot", (event) => {
      const ticks = JSON.parse((event as MessageEvent).data) as LiveTick[];
      setLiveTicks((current) => ({ ...current, ...Object.fromEntries(ticks.map((tick) => [tick.securityId, tick])) }));
    });
    source.addEventListener("tick", (event) => {
      const tick = JSON.parse((event as MessageEvent).data) as LiveTick;
      setLiveFeedStatus("live", "Receiving Dhan ticks");
      setLiveTicks((current) => ({ ...current, [tick.securityId]: tick }));
    });
    source.onerror = () => {
      setLiveFeedStatus("error", "Live feed stream disconnected");
    };
    return () => {
      source.close();
      setLiveFeedStatus("idle");
    };
  }, [data, setLiveFeedStatus]);
  const placeOrderFor = async (row: DryVolumeBreakoutRow) => {
    if (!row.entry_price || !row.stop_loss) return;
    const ok = window.confirm(`Place ${row.symbol} buy stop-entry order?\n\nEntry: ${money(row.entry_price)}\nSL tracked in app: ${money(row.stop_loss)}\nRisk width: ${pct2(row.sl_pct ?? 0)}\n\nThis sends a live Dhan order if credentials/IP allow it.`);
    if (!ok) return;
    setOrderBusy(row.security_id);
    setOrderMessage("");
    try {
      const response = await fetch("/api/dry-volume-breakout-screener/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ securityId: row.security_id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setOrderMessage(`${row.symbol}: ${body.mode === "AMO" ? "AMO" : "live"} order ${body.order.orderId} submitted. Managed trade added to Portfolio.`);
      await onTradeCreated();
    } catch (error) {
      setOrderMessage(error instanceof Error ? error.message : "Order failed.");
    } finally {
      setOrderBusy(null);
    }
  };

  return <section className="research-page thirty-up-page dry-breakout-page"><div className="notice"><AlertTriangle size={18}/><span>Generic dry-volume setup watchlist using broad fixed filters. Backtest-specific entry sizing and risk rules are intentionally ignored here.</span></div><div className="thirty-hero"><div><p className="eyebrow">Manual Trigger Screener</p><h2>Dry-volume breakout watchlist</h2><small>Broad manual watchlist: 30% impulse, low-volume pullback, dry-candle high entry, candle-low SL.</small></div><div className="thirty-hero-actions"><button className="primary" onClick={onRun} disabled={loading}><ShieldCheck size={15}/>Run Screener</button></div></div><div className="thirty-filter-strip dry-breakout-filters"><label>Move %<input className="plain-input" value={filters.minMovePct} readOnly /></label><label>Move Window<input className="plain-input" value={filters.moveWindowDays} readOnly /></label><label>Impulse Lookback<input className="plain-input" value={filters.impulseLookbackDays} readOnly /></label><label>Impulse Vol<input className="plain-input" value={filters.minImpulseVolumeRatio} readOnly /></label><label>Pullback %<input className="plain-input" value={`${filters.minPullbackPct} to ${filters.maxPullbackPct}`} readOnly /></label><label>Dry Vol<input className="plain-input" value={filters.dryVolumeRatio} readOnly /></label><label>Dry Lookback<input className="plain-input" value={filters.dryVolumeLookbackDays} readOnly /></label><label>Breakout Days<input className="plain-input" value={filters.breakoutWithinDays} readOnly /></label><label>SL Buffer %<input className="plain-input" value={filters.stopBufferPct} readOnly /></label></div>{orderMessage && <div className={orderMessage.includes("submitted") ? "notice" : "notice danger-notice"}><AlertTriangle size={17}/><span>{orderMessage}</span></div>}{data && <><div className="thirty-scoreboard"><div><span>Snapshot</span><b>{data.snapshotDate || "—"}</b></div><div><span>WAIT</span><b>{data.statusSummary.WAIT ?? 0}</b></div><div><span>ENTRY</span><b>{data.statusSummary.ENTRY ?? 0}</b></div><div><span>Shown</span><b>{rows.length}</b></div></div><section className="panel thirty-panel">{rows.length ? <div className="table-wrap"><table className="thirty-table dry-breakout-table"><thead><tr><th>Rank</th><th><SortHead label="Status" column="status" sort={sort} onSort={sortBy}/></th><th><SortHead label="Score" column="score" sort={sort} onSort={sortBy}/></th><th><SortHead label="Symbol" column="symbol" sort={sort} onSort={sortBy}/></th><th><SortHead label="LTP" column="ltp" sort={sort} onSort={sortBy}/></th><th><SortHead label="Entry" column="entry" sort={sort} onSort={sortBy}/></th><th><SortHead label="LTP to Entry" column="distance" sort={sort} onSort={sortBy}/></th><th>SL</th><th><SortHead label="SL %" column="sl_pct" sort={sort} onSort={sortBy}/></th><th><SortHead label="Dry Vol" column="dry_volume" sort={sort} onSort={sortBy}/></th><th><SortHead label="Impulse" column="impulse" sort={sort} onSort={sortBy}/></th><th><SortHead label="Pullback" column="pullback" sort={sort} onSort={sortBy}/></th><th><SortHead label="10 EMA" column="ema10" sort={sort} onSort={sortBy}/></th><th>Action</th></tr></thead><tbody>{rows.map((row) => { const tick = liveTicks[row.security_id]; const liveClose = liveCloseFor(row); const liveDistance = liveDistanceFor(row); return <tr key={row.security_id} className="click-row" onClick={() => setSelected(row)}><td>{row.rank}</td><td><span className={row.status === "ENTRY" ? "eligible" : "count"}>{row.status}</span></td><td>{row.score}</td><td className="window dry-symbol">{row.symbol}</td><td className={tick ? "positive" : ""}>{money(liveClose)}<small>{tick ? "LIVE" : row.current_date}</small></td><td>{row.entry_price === undefined ? "—" : money(row.entry_price)}</td><td className={(liveDistance ?? 0) >= 0 ? "positive" : "negative"}>{liveDistance === undefined ? "—" : pct2(liveDistance)}</td><td className="negative dry-sl">{row.stop_loss === undefined ? "—" : money(row.stop_loss)}</td><td className="negative dry-sl">{row.sl_pct === undefined ? "—" : pct2(row.sl_pct)}</td><td>{row.dry_candle_volume_ratio === undefined ? "—" : `${row.dry_candle_volume_ratio.toFixed(2)}x`}<small>{row.dry_candle_date ?? ""}</small></td><td className="positive">{row.impulse_return_pct === undefined ? "—" : pct(row.impulse_return_pct)}<small>{row.impulse_volume_ratio === undefined ? "" : `${row.impulse_volume_ratio.toFixed(2)}x vol`}</small></td><td className="negative">{row.pullback_pct === undefined ? "—" : pct(-row.pullback_pct)}<small>{row.pullback_days === undefined ? "" : `${row.pullback_days} days`}</small></td><td className={(row.distance_from_10ema_pct ?? 0) >= 0 ? "positive" : "negative"}>{row.distance_from_10ema_pct === undefined ? "—" : pct2(row.distance_from_10ema_pct)}</td><td><button className="primary compact" disabled={!row.qualifies || orderBusy === row.security_id} onClick={(event) => { event.stopPropagation(); void placeOrderFor(row); }}>{orderBusy === row.security_id ? "Sending" : "Buy AMO/Order"}</button></td></tr>; })}</tbody></table></div> : <p className="panel-empty">No stocks are present in the dry-volume watchlist for the fixed snapshot.</p>}</section></>}{selected && <div className="drawer" onClick={() => setSelected(null)}><div className="drawer-card chart-drawer" onClick={(event) => event.stopPropagation()}><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">Rank {selected.rank} · {selected.status} · Score {selected.score}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">{selected.reason}</p><div className="stats-grid compact-stats"><Stat label="Entry" value={selected.entry_price === undefined ? "—" : money(selected.entry_price)} sub={selected.dry_candle_date}/><Stat label="Initial SL" value={selected.stop_loss === undefined ? "—" : money(selected.stop_loss)} sub={selected.sl_pct === undefined ? undefined : pct2(selected.sl_pct)}/><Stat label="LTP To Entry" value={liveDistanceFor(selected) === undefined ? "—" : pct2(liveDistanceFor(selected)!)} sub={`LTP ${money(liveCloseFor(selected))}`}/><Stat label="10 EMA" value={selected.ema10 === undefined ? "—" : money(selected.ema10)} sub={selected.distance_from_10ema_pct === undefined ? undefined : pct2(selected.distance_from_10ema_pct)}/></div><div className="stats-grid compact-stats"><Stat label="Impulse" value={selected.impulse_return_pct === undefined ? "—" : pct(selected.impulse_return_pct)} sub={selected.impulse_volume_ratio === undefined ? undefined : `${selected.impulse_volume_ratio.toFixed(2)}x volume`}/><Stat label="Pullback" value={selected.pullback_pct === undefined ? "—" : pct(-selected.pullback_pct)} sub={selected.pullback_days === undefined ? undefined : `${selected.pullback_days} days`}/><Stat label="Dry Vol" value={selected.dry_candle_volume_ratio === undefined ? "—" : `${selected.dry_candle_volume_ratio.toFixed(2)}x`} sub={selected.dry_candle_date}/><Stat label="Traded Value" value={rupees(selected.averageDailyTradedValue)} sub="20D average"/></div><h3>Recent 120 daily rows</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>10 EMA</th><th>Volume</th><th>Rel Vol</th></tr></thead><tbody>{selected.recent.map((row) => <tr key={row.trade_date}><td>{row.trade_date}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td>{money(row.close)}</td><td>{row.ema10 ? money(row.ema10) : "—"}</td><td>{row.volume.toLocaleString("en-IN")}</td><td>{row.volume_ratio ? `${row.volume_ratio.toFixed(2)}x` : "—"}</td></tr>)}</tbody></table></div></div></div>}</section>;
}

function liveAdjustedThirtyUp(row: ThirtyUpRow, liveTick?: LiveTick) {
  const liveClose = liveTick?.ltp ?? row.current_close;
  const prevClose = liveTick?.prevClose ?? row.current_close;
  const todayChange = liveTick ? ((liveClose / prevClose) - 1) * 100 : undefined;
  const emaDistance = ((liveClose / row.ema50) - 1) * 100;
  const breakoutDistance = row.high_close === undefined ? row.breakout_distance_pct : ((liveClose / row.high_close) - 1) * 100;
  return { liveClose, todayChange, emaDistance, breakoutDistance, pullback: breakoutDistance, retracement: row.retracement_pct };
}

const formatTime = (value?: string | null) => {
  if (!value) return "Not refreshed yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};

function ThirtyUpScreenerViewEnhanced({ data, filters, setFilters, loading, onRun, onReset, selected, setSelected, setLiveFeedStatus, updatedAt, onTradeCreated }: { data: ThirtyUpResponse | null; filters: ThirtyUpFilters; setFilters: (filters: ThirtyUpFilters) => void; loading: boolean; onRun: (options?: ThirtyUpRunOptions) => void; onReset: () => void; selected: ThirtyUpRow | null; setSelected: (row: ThirtyUpRow | null) => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void; updatedAt?: string | null; onTradeCreated?: () => void }) {
  const [sort, setSort] = useState<{ key: ThirtyUpSortKey; direction: "asc" | "desc" }>({ key: "move", direction: "desc" });
  const [hourlySignals, setHourlySignals] = useState<Record<string, HourlySignal>>({});
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const setNumber = (key: keyof ThirtyUpFilters, value: number) => setFilters({ ...filters, [key]: value });
  const sortBy = (key: ThirtyUpSortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" });
  const openRow = (row: ThirtyUpRow) => {
    setSelected(row);
    void fetchThirtyUpIntraday(row.security_id).catch(() => {});
  };

  useEffect(() => {
    if (!autoRefresh || !data) return;
    const timer = window.setInterval(() => onRun({ silent: true }), 120_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, data, onRun]);

  useEffect(() => {
    if (!selected || !data) return;
    const replacement = data.results.find((row) => row.security_id === selected.security_id);
    if (replacement && replacement !== selected) setSelected(replacement);
  }, [data, selected, setSelected]);

  useEffect(() => {
    const rows = data?.results ?? [];
    if (!rows.length) {
      setLiveFeedStatus("idle");
      return;
    }
    setLiveFeedStatus("connecting");
    const ids = rows.map((row) => row.security_id).join(",");
    const source = new EventSource(`/api/thirty-up-screener/live?ids=${encodeURIComponent(ids)}`);
    const applyTick = (tick: LiveTick) => setLiveTicks((current) => ({ ...current, [tick.securityId]: tick }));
    source.onopen = () => setLiveFeedStatus("connecting", "Waiting for Dhan websocket status");
    source.addEventListener("status", (event) => {
      const status = JSON.parse((event as MessageEvent).data) as LiveFeedStatusUpdate;
      if (status.state === "idle" || status.state === "connecting" || status.state === "live" || status.state === "error") setLiveFeedStatus(status.state, status.message);
    });
    source.addEventListener("snapshot", (event) => {
      const ticks = JSON.parse((event as MessageEvent).data) as LiveTick[];
      setLiveTicks((current) => ({ ...current, ...Object.fromEntries(ticks.map((tick) => [tick.securityId, tick])) }));
    });
    source.addEventListener("tick", (event) => {
      setLiveFeedStatus("live", "Receiving Dhan ticks");
      applyTick(JSON.parse((event as MessageEvent).data) as LiveTick);
    });
    source.onerror = () => {
      setLiveFeedStatus("error", "Live feed stream disconnected");
    };
    return () => {
      source.close();
      setLiveFeedStatus("idle");
    };
  }, [data, setLiveFeedStatus]);

  useEffect(() => {
    const rows = (data?.results ?? []).filter((row) => row.qualifies).slice(0, 40);
    if (!rows.length) {
      setHourlySignals({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      for (const row of rows) {
        if (cancelled) return;
        setHourlySignals((current) => current[row.security_id] ? current : { ...current, [row.security_id]: { state: "loading", label: "Loading hourly 50 EMA" } });
        try {
          const candles = await fetchThirtyUpIntraday(row.security_id);
          const signal = calculateHourlySignal(candles);
          if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: signal }));
        } catch (error) {
          if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: { state: "error", label: error instanceof Error ? error.message : "Hourly data unavailable" } }));
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [data]);

  const sortedRows = useMemo(() => {
    const rows = [...(data?.results ?? [])];
    const valueFor = (row: ThirtyUpRow): string | number => {
      const liveTick = liveTicks[row.security_id];
      const signal = liveHourlySignal(hourlySignals[row.security_id], liveTick?.ltp);
      const live = liveAdjustedThirtyUp(row, liveTick);
      if (sort.key === "status") return row.status;
      if (sort.key === "symbol") return row.symbol;
      if (sort.key === "universe") return row.universe_name;
      if (sort.key === "setup_path") return row.recent.at(-1)?.close ?? row.current_close;
      if (sort.key === "hourly_signal") return { green: 3, yellow: 2, red: 1, error: 0, loading: -1 }[signal?.state ?? "loading"];
      if (sort.key === "ltp") return live.liveClose;
      if (sort.key === "today_change") return live.todayChange ?? 0;
      if (sort.key === "close") return live.liveClose;
      if (sort.key === "ema_dist") return live.emaDistance;
      if (sort.key === "move") return row.move_pct ?? -Infinity;
      if (sort.key === "impulse_vol") return row.impulse_volume_ratio ?? -Infinity;
      if (sort.key === "since_high") return row.days_since_high ?? Infinity;
      if (sort.key === "pullback") return live.pullback ?? -Infinity;
      if (sort.key === "retrace") return live.retracement ?? Infinity;
      return row.current_volume_ratio ?? -Infinity;
    };
    rows.sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? comparison : -comparison;
    });
    return rows;
  }, [data, hourlySignals, liveTicks, sort]);

  return <section className="research-page thirty-up-page"><div className="notice"><AlertTriangle size={18}/><span>30%Up combines local daily OHLCV with live Dhan ticks on this screen. Confirm orders and risk separately before trading.</span></div><div className="thirty-hero"><div><p className="eyebrow">30%Up Screener</p><h2>Impulse, cooloff, EMA reset</h2><small>Live LTP updates continuously; full screener snapshot auto-refreshes every 2 minutes.</small></div><div className="thirty-hero-actions"><div className="refresh-status"><span className={autoRefresh ? "ready" : "idle-dot"} /><b>{autoRefresh ? "Auto refresh on" : "Auto refresh off"}</b><small>Last {formatTime(updatedAt)}</small></div><button className="secondary compact" onClick={() => setAutoRefresh((value) => !value)}>{autoRefresh ? "Pause" : "Resume"}</button><button className="primary" onClick={() => onRun()} disabled={loading}><TrendingUp size={15}/>Run 30%Up</button><button className="secondary compact" onClick={onReset}>Reset</button></div></div><div className="thirty-filter-strip"><label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as ThirtyUpFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label><label>Lookback<input className="plain-input" type="number" value={filters.lookbackDays} onChange={(e) => setNumber("lookbackDays", Number(e.target.value))}/></label><label>Move %<input className="plain-input" type="number" value={filters.minMovePct} onChange={(e) => setNumber("minMovePct", Number(e.target.value))}/></label><label>Impulse Vol<input className="plain-input" type="number" step="0.1" value={filters.minImpulseVolumeRatio} onChange={(e) => setNumber("minImpulseVolumeRatio", Number(e.target.value))}/></label><label>EMA Zone<input className="plain-input" type="text" value={`${filters.minDistanceFromEmaPct} to ${filters.maxDistanceFromEmaPct}`} readOnly/></label><label>Cooloff<input className="plain-input" type="number" value={filters.minCooloffDays} onChange={(e) => setNumber("minCooloffDays", Number(e.target.value))}/></label><label>Retrace Max<input className="plain-input" type="number" value={filters.maxRetracementPct} onChange={(e) => setNumber("maxRetracementPct", Number(e.target.value))}/></label><label className="filter-row"><input type="checkbox" checked={filters.showAll} onChange={(e) => setFilters({ ...filters, showAll: e.target.checked })}/><span>Show all</span></label></div>{data && <><div className="thirty-scoreboard"><div><span>Evaluated</span><b>{data.evaluated}</b></div><div><span>Setups</span><b>{data.qualified}</b></div><div><span>Extended</span><b>{data.statusSummary["TOO EXTENDED"] ?? 0}</b></div><div><span>Deep</span><b>{data.statusSummary["TOO DEEP"] ?? 0}</b></div></div><section className="panel thirty-panel">{data.results.length ? <div className="table-wrap"><table className="thirty-table"><thead><tr><th><SortHead label="Status" column="status" sort={sort} onSort={sortBy}/></th><th><SortHead label="Symbol" column="symbol" sort={sort} onSort={sortBy}/></th><th><SortHead label="Universe" column="universe" sort={sort} onSort={sortBy}/></th><th><SortHead label="Setup Path" column="setup_path" sort={sort} onSort={sortBy}/></th><th><SortHead label="Hourly" column="hourly_signal" sort={sort} onSort={sortBy}/></th><th><SortHead label="LTP" column="ltp" sort={sort} onSort={sortBy}/></th><th><SortHead label="Today %" column="today_change" sort={sort} onSort={sortBy}/></th><th><SortHead label="Live Close" column="close" sort={sort} onSort={sortBy}/></th><th><SortHead label="Live EMA Dist" column="ema_dist" sort={sort} onSort={sortBy}/></th><th><SortHead label="Move" column="move" sort={sort} onSort={sortBy}/></th><th><SortHead label="Impulse Vol" column="impulse_vol" sort={sort} onSort={sortBy}/></th><th><SortHead label="Since High" column="since_high" sort={sort} onSort={sortBy}/></th><th><SortHead label="Live Pullback" column="pullback" sort={sort} onSort={sortBy}/></th><th><SortHead label="Live Retrace" column="retrace" sort={sort} onSort={sortBy}/></th><th><SortHead label="Current Vol" column="current_vol" sort={sort} onSort={sortBy}/></th></tr></thead><tbody>{sortedRows.map((row) => { const liveTick = liveTicks[row.security_id]; const signal = liveHourlySignal(hourlySignals[row.security_id], liveTick?.ltp); const live = liveAdjustedThirtyUp(row, liveTick); return <tr className="click-row" key={row.security_id} onClick={() => openRow(row)}><td><span className={row.qualifies ? "eligible" : "count"}>{row.status}</span></td><td className="window">{row.symbol}</td><td>{row.universe_name}</td><td><SetupSparkline row={row} onOpen={() => openRow(row)} /></td><td><HourlySignalCell signal={signal}/></td><td className={liveTick ? "positive" : ""}>{liveTick ? money(live.liveClose) : "—"}</td><td className={live.todayChange === undefined ? "" : live.todayChange >= 0 ? "positive" : "negative"}>{live.todayChange === undefined ? "—" : pct(live.todayChange)}</td><td className={liveTick ? "positive" : ""}>{money(live.liveClose)}</td><td className={live.emaDistance >= 0 ? "positive" : "negative"}>{pct(live.emaDistance)}</td><td className="positive">{row.move_pct === undefined ? "—" : pct(row.move_pct)}</td><td>{row.impulse_volume_ratio === undefined ? "—" : `${row.impulse_volume_ratio.toFixed(1)}x`}</td><td>{row.days_since_high ?? "—"}</td><td className={live.pullback === undefined ? "" : live.pullback >= 0 ? "positive" : "negative"}>{live.pullback === undefined ? "—" : pct(live.pullback)}</td><td>{live.retracement === undefined ? "—" : pct(live.retracement)}</td><td>{row.current_volume_ratio === undefined ? "—" : `${row.current_volume_ratio.toFixed(1)}x`}</td></tr>; })}</tbody></table></div> : <p className="panel-empty">No stocks currently meet the selected 30%Up criteria.</p>}</section></>}{selected && <div className="drawer"><div className="drawer-card chart-drawer"><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">{selected.status}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">{selected.reason}</p><ThirtyUpChartPanel selected={selected} onTradeCreated={onTradeCreated} /><div className="stats-grid compact-stats"><Stat label="Current Close" value={money(selected.current_close)} sub={selected.current_date}/><Stat label="50 EMA" value={money(selected.ema50)} sub={pct(selected.distance_from_ema_pct)}/><Stat label="Low To High" value={selected.move_pct === undefined ? "—" : pct(selected.move_pct)} sub={`${selected.low_date ?? "—"} to ${selected.high_date ?? "—"}`}/><Stat label="Retracement" value={selected.retracement_pct === undefined ? "—" : pct(selected.retracement_pct)} sub={selected.pullback_from_high_pct === undefined ? undefined : `from high ${pct(selected.pullback_from_high_pct)}`}/></div><div className="stats-grid compact-stats"><Stat label="Low Close" value={selected.low_close === undefined ? "—" : money(selected.low_close)} sub={selected.low_distance_from_ema_pct === undefined ? undefined : `vs EMA ${pct(selected.low_distance_from_ema_pct)}`}/><Stat label="High Close" value={selected.high_close === undefined ? "—" : money(selected.high_close)} sub={selected.impulse_volume_ratio === undefined ? undefined : `${selected.impulse_volume_ratio.toFixed(1)}x max vol`}/><Stat label="Days Low To High" value={`${selected.days_low_to_high ?? "—"}`} /><Stat label="Days Since High" value={`${selected.days_since_high ?? "—"}`} /></div><h3>Recent 120 daily rows</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>EMA50</th><th>Volume</th><th>Rel Vol</th></tr></thead><tbody>{selected.recent.map((row) => <tr key={row.trade_date}><td>{row.trade_date}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td>{money(row.close)}</td><td>{row.ema50 ? money(row.ema50) : "—"}</td><td>{row.volume.toLocaleString("en-IN")}</td><td>{row.volume_ratio ? `${row.volume_ratio.toFixed(1)}x` : "—"}</td></tr>)}</tbody></table></div></div></div>}</section>;
}

function calculateHourlyBreakoutSignal(rows: DailyChartPoint[], row: ThirtyUpRow): HourlySignal {
  const breakoutZone = row.high_close;
  if (!breakoutZone) return { state: "error", label: "Breakout zone unavailable" };
  const latest = rows.at(-1);
  if (!latest) return { state: "error", label: "No hourly candle yet" };
  const distancePct = ((latest.close / breakoutZone) - 1) * 100;
  if (distancePct >= 0) return { state: "green", ltp: latest.close, distancePct, label: "Hourly candle is breaking out" };
  if (distancePct >= -1) return { state: "yellow", ltp: latest.close, distancePct, label: "Hourly candle is close to breakout" };
  return { state: "red", ltp: latest.close, distancePct, label: "Hourly candle is below breakout" };
}

function liveHourlyBreakoutSignal(signal: HourlySignal | undefined, row: ThirtyUpRow, ltp?: number): HourlySignal | undefined {
  if (!signal || ltp === undefined || !row.high_close) return signal;
  const distancePct = ((ltp / row.high_close) - 1) * 100;
  if (distancePct >= 0) return { ...signal, state: "green", ltp, distancePct, label: "Live price is breaking out" };
  if (distancePct >= -1) return { ...signal, state: "yellow", ltp, distancePct, label: "Live price is close to breakout" };
  return { ...signal, state: "red", ltp, distancePct, label: "Live price is below breakout" };
}

function ThirtyUpScreenerViewRevamped({ data, filters, setFilters, loading, onRun, onReset, selected, setSelected, setLiveFeedStatus, updatedAt, onTradeCreated }: { data: ThirtyUpResponse | null; filters: ThirtyUpFilters; setFilters: (filters: ThirtyUpFilters) => void; loading: boolean; onRun: (options?: ThirtyUpRunOptions) => void; onReset: () => void; selected: ThirtyUpRow | null; setSelected: (row: ThirtyUpRow | null) => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void; updatedAt?: string | null; onTradeCreated?: () => void }) {
  const [sort, setSort] = useState<{ key: ThirtyUpSortKey; direction: "asc" | "desc" }>({ key: "breakout_dist", direction: "desc" });
  const [hourlySignals, setHourlySignals] = useState<Record<string, HourlySignal>>({});
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const setNumber = (key: keyof ThirtyUpFilters, value: number) => setFilters({ ...filters, [key]: value });
  const sortBy = (key: ThirtyUpSortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" });
  const openRow = (row: ThirtyUpRow) => {
    setSelected(row);
    void fetchThirtyUpIntraday(row.security_id, true).catch(() => undefined);
  };

  useEffect(() => {
    if (!autoRefresh || !data) return;
    const timer = window.setInterval(() => onRun({ silent: true }), 120_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, data, onRun]);

  useEffect(() => {
    const ids = (data?.results ?? []).map((row) => row.security_id).slice(0, 100).join(",");
    if (!ids) {
      setLiveTicks({});
      setLiveFeedStatus("idle");
      return;
    }
    const source = new EventSource(`/api/thirty-up-screener/live?ids=${encodeURIComponent(ids)}`);
    source.onopen = () => setLiveFeedStatus("connecting", "Waiting for Dhan websocket status");
    source.addEventListener("status", (event) => {
      const status = JSON.parse((event as MessageEvent).data) as LiveFeedStatusUpdate;
      if (status.state === "idle" || status.state === "connecting" || status.state === "live" || status.state === "error") setLiveFeedStatus(status.state, status.message);
    });
    source.addEventListener("snapshot", (event) => {
      const ticks = JSON.parse((event as MessageEvent).data) as LiveTick[];
      setLiveTicks((current) => ({ ...current, ...Object.fromEntries(ticks.map((tick) => [tick.securityId, tick])) }));
    });
    source.addEventListener("tick", (event) => {
      setLiveFeedStatus("live", "Receiving Dhan ticks");
      const tick = JSON.parse((event as MessageEvent).data) as LiveTick;
      setLiveTicks((current) => ({ ...current, [tick.securityId]: tick }));
    });
    source.onerror = () => {
      setLiveFeedStatus("error", "Live feed stream disconnected");
    };
    return () => {
      source.close();
      setLiveFeedStatus("idle");
    };
  }, [data, setLiveFeedStatus]);

  useEffect(() => {
    const rows = (data?.results ?? []).slice(0, 40);
    if (!rows.length) {
      setHourlySignals({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      for (const row of rows) {
        if (cancelled) return;
        setHourlySignals((current) => current[row.security_id] ? current : { ...current, [row.security_id]: { state: "loading", label: "Loading hourly breakout candle" } });
        try {
          const candles = await fetchThirtyUpIntraday(row.security_id);
          const signal = calculateHourlyBreakoutSignal(candles, row);
          if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: signal }));
        } catch (error) {
          if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: { state: "error", label: error instanceof Error ? error.message : "Hourly data unavailable" } }));
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [data]);

  const sortedRows = useMemo(() => {
    const rows = [...(data?.results ?? [])];
    const valueFor = (row: ThirtyUpRow): string | number => {
      const liveTick = liveTicks[row.security_id];
      const signal = liveHourlyBreakoutSignal(hourlySignals[row.security_id], row, liveTick?.ltp);
      const live = liveAdjustedThirtyUp(row, liveTick);
      if (sort.key === "status") return row.status;
      if (sort.key === "symbol") return row.symbol;
      if (sort.key === "universe") return row.universe_name;
      if (sort.key === "setup_path") return row.recent.at(-1)?.close ?? row.current_close;
      if (sort.key === "hourly_signal") return { green: 3, yellow: 2, red: 1, error: 0, loading: -1 }[signal?.state ?? "loading"];
      if (sort.key === "ltp") return live.liveClose;
      if (sort.key === "today_change") return live.todayChange ?? 0;
      if (sort.key === "close") return live.liveClose;
      if (sort.key === "ema_dist") return live.emaDistance;
      if (sort.key === "move") return row.move_pct ?? -Infinity;
      if (sort.key === "impulse_vol") return row.impulse_volume_ratio ?? -Infinity;
      if (sort.key === "higher_highs") return row.higher_high_count ?? -Infinity;
      if (sort.key === "base_days") return row.consolidation_days ?? -Infinity;
      if (sort.key === "base_depth") return row.base_depth_pct ?? -Infinity;
      if (sort.key === "breakout_dist") return live.breakoutDistance ?? -Infinity;
      return row.current_volume_ratio ?? -Infinity;
    };
    rows.sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? comparison : -comparison;
    });
    return rows;
  }, [data, hourlySignals, liveTicks, sort]);

  return <section className="research-page thirty-up-page"><div className="notice"><AlertTriangle size={18}/><span>30%Up now tracks 30% strength plus a U-shaped breakout base. Entry reference is the hourly breakout candle, not the daily EMA pullback.</span></div><div className="thirty-hero"><div><p className="eyebrow">30%Up Breakout Screener</p><h2>30% strength, higher highs, U-base breakout</h2><small>Live LTP and hourly candles update continuously; full screener snapshot auto-refreshes every 2 minutes.</small></div><div className="thirty-hero-actions"><div className="refresh-status"><span className={autoRefresh ? "ready" : "idle-dot"} /><b>{autoRefresh ? "Auto refresh on" : "Auto refresh off"}</b><small>Last {formatTime(updatedAt)}</small></div><button className="secondary compact" onClick={() => setAutoRefresh((value) => !value)}>{autoRefresh ? "Pause" : "Resume"}</button><button className="primary" onClick={() => onRun()} disabled={loading}><TrendingUp size={15}/>Run 30%Up</button><button className="secondary compact" onClick={onReset}>Reset</button></div></div><div className="thirty-filter-strip"><label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as ThirtyUpFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label><label>Lookback<input className="plain-input" type="number" value={filters.lookbackDays} onChange={(e) => setNumber("lookbackDays", Number(e.target.value))}/></label><label>Move %<input className="plain-input" type="number" value={filters.minMovePct} onChange={(e) => setNumber("minMovePct", Number(e.target.value))}/></label><label>Impulse Vol<input className="plain-input" type="number" step="0.1" value={filters.minImpulseVolumeRatio} onChange={(e) => setNumber("minImpulseVolumeRatio", Number(e.target.value))}/></label><label>Min EMA %<input className="plain-input" type="number" step="0.1" value={filters.minDistanceFromEmaPct} onChange={(e) => setNumber("minDistanceFromEmaPct", Number(e.target.value))}/></label><label>Max EMA %<input className="plain-input" type="number" step="0.1" value={filters.maxDistanceFromEmaPct} onChange={(e) => setNumber("maxDistanceFromEmaPct", Number(e.target.value))}/></label><label>Breakout Near<input className="plain-input" type="number" step="0.1" value={filters.maxBreakoutProximityPct} onChange={(e) => setNumber("maxBreakoutProximityPct", Number(e.target.value))}/></label><label className="filter-row"><input type="checkbox" checked={filters.showAll} onChange={(e) => setFilters({ ...filters, showAll: e.target.checked })}/><span>Show all</span></label></div><div className="thirty-filter-strip"><label>HH Lookback<input className="plain-input" type="number" value={filters.higherHighLookbackDays} onChange={(e) => setNumber("higherHighLookbackDays", Number(e.target.value))}/></label><label>Min HH<input className="plain-input" type="number" value={filters.minHigherHighCount} onChange={(e) => setNumber("minHigherHighCount", Number(e.target.value))}/></label><label>Base Lookback<input className="plain-input" type="number" value={filters.consolidationLookbackDays} onChange={(e) => setNumber("consolidationLookbackDays", Number(e.target.value))}/></label><label>Min Base Days<input className="plain-input" type="number" value={filters.minConsolidationDays} onChange={(e) => setNumber("minConsolidationDays", Number(e.target.value))}/></label><label>Max Base Pullback<input className="plain-input" type="number" step="0.1" value={filters.maxBasePullbackPct} onChange={(e) => setNumber("maxBasePullbackPct", Number(e.target.value))}/></label><label>Overshoot %<input className="plain-input" type="number" step="0.1" value={filters.maxBreakoutOvershootPct} onChange={(e) => setNumber("maxBreakoutOvershootPct", Number(e.target.value))}/></label><label>Current Vol<input className="plain-input" type="number" step="0.1" value={filters.maxCurrentVolumeRatio} onChange={(e) => setNumber("maxCurrentVolumeRatio", Number(e.target.value))}/></label><label className="filter-row"><input type="checkbox" checked={filters.requireRisingEma} onChange={(e) => setFilters({ ...filters, requireRisingEma: e.target.checked })}/><span>Rising 50 EMA</span></label></div>{data && <><div className="thirty-scoreboard"><div><span>Evaluated</span><b>{data.evaluated}</b></div><div><span>Setups</span><b>{data.qualified}</b></div><div><span>30% Miss</span><b>{data.statusSummary["NO 30% MOVE"] ?? 0}</b></div><div><span>Heavy Pullback</span><b>{data.statusSummary["HEAVY PULLBACK"] ?? 0}</b></div></div><section className="panel thirty-panel">{data.results.length ? <div className="table-wrap"><table className="thirty-table"><thead><tr><th><SortHead label="Status" column="status" sort={sort} onSort={sortBy}/></th><th><SortHead label="Symbol" column="symbol" sort={sort} onSort={sortBy}/></th><th><SortHead label="Universe" column="universe" sort={sort} onSort={sortBy}/></th><th><SortHead label="Setup Path" column="setup_path" sort={sort} onSort={sortBy}/></th><th><SortHead label="Hourly BO" column="hourly_signal" sort={sort} onSort={sortBy}/></th><th><SortHead label="LTP" column="ltp" sort={sort} onSort={sortBy}/></th><th><SortHead label="Today %" column="today_change" sort={sort} onSort={sortBy}/></th><th><SortHead label="EMA Dist" column="ema_dist" sort={sort} onSort={sortBy}/></th><th><SortHead label="3M Move" column="move" sort={sort} onSort={sortBy}/></th><th><SortHead label="Impulse Vol" column="impulse_vol" sort={sort} onSort={sortBy}/></th><th><SortHead label="HH" column="higher_highs" sort={sort} onSort={sortBy}/></th><th><SortHead label="Base Days" column="base_days" sort={sort} onSort={sortBy}/></th><th><SortHead label="Base Depth" column="base_depth" sort={sort} onSort={sortBy}/></th><th><SortHead label="Breakout Dist" column="breakout_dist" sort={sort} onSort={sortBy}/></th><th><SortHead label="Current Vol" column="current_vol" sort={sort} onSort={sortBy}/></th></tr></thead><tbody>{sortedRows.map((row) => { const liveTick = liveTicks[row.security_id]; const signal = liveHourlyBreakoutSignal(hourlySignals[row.security_id], row, liveTick?.ltp); const live = liveAdjustedThirtyUp(row, liveTick); return <tr className="click-row" key={row.security_id} onClick={() => openRow(row)}><td><span className={row.qualifies ? "eligible" : "count"}>{row.status}</span></td><td className="window">{row.symbol}</td><td>{row.universe_name}</td><td><SetupSparkline row={row} onOpen={() => openRow(row)} /></td><td><HourlySignalCell signal={signal}/></td><td className={liveTick ? "positive" : ""}>{liveTick ? money(live.liveClose) : "—"}</td><td className={live.todayChange === undefined ? "" : live.todayChange >= 0 ? "positive" : "negative"}>{live.todayChange === undefined ? "—" : pct(live.todayChange)}</td><td className={live.emaDistance >= 0 ? "positive" : "negative"}>{pct(live.emaDistance)}</td><td className="positive">{row.move_pct === undefined ? "—" : pct(row.move_pct)}</td><td>{row.impulse_volume_ratio === undefined ? "—" : `${row.impulse_volume_ratio.toFixed(1)}x`}</td><td>{row.higher_high_count ?? "—"}</td><td>{row.consolidation_days ?? "—"}</td><td className={row.base_depth_pct === undefined ? "" : row.base_depth_pct >= 0 ? "positive" : "negative"}>{row.base_depth_pct === undefined ? "—" : pct(row.base_depth_pct)}</td><td className={live.breakoutDistance === undefined ? "" : live.breakoutDistance >= 0 ? "positive" : "negative"}>{live.breakoutDistance === undefined ? "—" : pct(live.breakoutDistance)}</td><td>{row.current_volume_ratio === undefined ? "—" : `${row.current_volume_ratio.toFixed(1)}x`}</td></tr>; })}</tbody></table></div> : <p className="panel-empty">No stocks currently meet the selected 30%Up breakout criteria.</p>}</section></>}{selected && <div className="drawer"><div className="drawer-card chart-drawer"><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">{selected.status}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">{selected.reason}</p><ThirtyUpChartPanel selected={selected} onTradeCreated={onTradeCreated} strategyLabel="30%Up Hourly Breakout" sourceNote="Created from 30%Up hourly breakout preview. Live broker order not placed by app." /><div className="stats-grid compact-stats"><Stat label="Current Close" value={money(selected.current_close)} sub={selected.current_date}/><Stat label="Breakout Zone" value={selected.high_close === undefined ? "—" : money(selected.high_close)} sub={selected.breakout_distance_pct === undefined ? undefined : pct(selected.breakout_distance_pct)}/><Stat label="3M Move" value={selected.move_pct === undefined ? "—" : pct(selected.move_pct)} sub={`${selected.low_date ?? "—"} to ${selected.high_date ?? "—"}`}/><Stat label="50 EMA" value={money(selected.ema50)} sub={pct(selected.distance_from_ema_pct)}/></div><div className="stats-grid compact-stats"><Stat label="Higher Highs" value={`${selected.higher_high_count ?? "—"}`} /><Stat label="U-Base Days" value={`${selected.consolidation_days ?? "—"}`} /><Stat label="Base Low" value={selected.base_low_close === undefined ? "—" : money(selected.base_low_close)} sub={selected.base_depth_pct === undefined ? undefined : pct(selected.base_depth_pct)}/><Stat label="Impulse Volume" value={selected.impulse_volume_ratio === undefined ? "—" : `${selected.impulse_volume_ratio.toFixed(1)}x`} /></div><h3>Recent 120 daily rows</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>EMA50</th><th>Volume</th><th>Rel Vol</th></tr></thead><tbody>{selected.recent.map((row) => <tr key={row.trade_date}><td>{row.trade_date}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td>{money(row.close)}</td><td>{row.ema50 ? money(row.ema50) : "—"}</td><td>{row.volume.toLocaleString("en-IN")}</td><td>{row.volume_ratio ? `${row.volume_ratio.toFixed(1)}x` : "—"}</td></tr>)}</tbody></table></div></div></div>}</section>;
}

function ThirtyUpScreenerViewSimple({ data, filters, setFilters, loading, onRun, onReset, selected, setSelected, setLiveFeedStatus, updatedAt, onTradeCreated }: { data: ThirtyUpResponse | null; filters: ThirtyUpFilters; setFilters: (filters: ThirtyUpFilters) => void; loading: boolean; onRun: (options?: ThirtyUpRunOptions) => void; onReset: () => void; selected: ThirtyUpRow | null; setSelected: (row: ThirtyUpRow | null) => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void; updatedAt?: string | null; onTradeCreated?: () => void }) {
  const [sort, setSort] = useState<{ key: ThirtyUpSortKey; direction: "asc" | "desc" }>({ key: "breakout_dist", direction: "desc" });
  const [hourlySignals, setHourlySignals] = useState<Record<string, HourlySignal>>({});
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const setNumber = (key: keyof ThirtyUpFilters, value: number) => setFilters({ ...filters, [key]: value });
  const sortBy = (key: ThirtyUpSortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" });
  const openRow = (row: ThirtyUpRow) => { setSelected(row); void fetchThirtyUpIntraday(row.security_id, true).catch(() => undefined); };
  useEffect(() => { if (!autoRefresh || !data) return; const timer = window.setInterval(() => onRun({ silent: true }), 120_000); return () => window.clearInterval(timer); }, [autoRefresh, data, onRun]);
  useEffect(() => {
    const ids = (data?.results ?? []).map((row) => row.security_id).slice(0, 100).join(",");
    if (!ids) { setLiveTicks({}); setLiveFeedStatus("idle"); return; }
    const source = new EventSource(`/api/thirty-up-screener/live?ids=${encodeURIComponent(ids)}`);
    source.onopen = () => setLiveFeedStatus("connecting", "Waiting for Dhan websocket status");
    source.addEventListener("status", (event) => { const status = JSON.parse((event as MessageEvent).data) as LiveFeedStatusUpdate; if (status.state === "idle" || status.state === "connecting" || status.state === "live" || status.state === "error") setLiveFeedStatus(status.state, status.message); });
    source.addEventListener("snapshot", (event) => { const ticks = JSON.parse((event as MessageEvent).data) as LiveTick[]; setLiveTicks((current) => ({ ...current, ...Object.fromEntries(ticks.map((tick) => [tick.securityId, tick])) })); });
    source.addEventListener("tick", (event) => { setLiveFeedStatus("live", "Receiving Dhan ticks"); const tick = JSON.parse((event as MessageEvent).data) as LiveTick; setLiveTicks((current) => ({ ...current, [tick.securityId]: tick })); });
    source.onerror = () => { setLiveFeedStatus("error", "Live feed stream disconnected"); };
    return () => { source.close(); setLiveFeedStatus("idle"); };
  }, [data, setLiveFeedStatus]);
  useEffect(() => {
    const rows = (data?.results ?? []).slice(0, 40);
    if (!rows.length) { setHourlySignals({}); return; }
    let cancelled = false;
    const run = async () => {
      for (const row of rows) {
        if (cancelled) return;
        setHourlySignals((current) => current[row.security_id] ? current : { ...current, [row.security_id]: { state: "loading", label: "Loading hourly breakout candle" } });
        try { const candles = await fetchThirtyUpIntraday(row.security_id); const signal = calculateHourlyBreakoutSignal(candles, row); if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: signal })); }
        catch (error) { if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: { state: "error", label: error instanceof Error ? error.message : "Hourly data unavailable" } })); }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [data]);
  const sortedRows = useMemo(() => {
    const rows = [...(data?.results ?? [])];
    const valueFor = (row: ThirtyUpRow): string | number => {
      const liveTick = liveTicks[row.security_id];
      const signal = liveHourlyBreakoutSignal(hourlySignals[row.security_id], row, liveTick?.ltp);
      const live = liveAdjustedThirtyUp(row, liveTick);
      if (sort.key === "status") return row.status;
      if (sort.key === "symbol") return row.symbol;
      if (sort.key === "universe") return row.universe_name;
      if (sort.key === "setup_path") return row.recent.at(-1)?.close ?? row.current_close;
      if (sort.key === "hourly_signal") return { green: 3, yellow: 2, red: 1, error: 0, loading: -1 }[signal?.state ?? "loading"];
      if (sort.key === "ltp") return live.liveClose;
      if (sort.key === "today_change") return live.todayChange ?? 0;
      if (sort.key === "ema_dist") return live.emaDistance;
      if (sort.key === "move") return row.move_pct ?? -Infinity;
      if (sort.key === "impulse_vol") return row.impulse_volume_ratio ?? -Infinity;
      if (sort.key === "breakout_dist") return live.breakoutDistance ?? -Infinity;
      return row.current_volume_ratio ?? -Infinity;
    };
    rows.sort((a, b) => { const av = valueFor(a); const bv = valueFor(b); const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv)); return sort.direction === "asc" ? comparison : -comparison; });
    return rows;
  }, [data, hourlySignals, liveTicks, sort]);
  return <section className="research-page thirty-up-page"><div className="notice"><AlertTriangle size={18}/><span>30%Up now finds stocks within the breakout zone after a 30% volume-backed move in the last {filters.lookbackDays} sessions. No U-base filter is applied.</span></div><div className="thirty-hero"><div><p className="eyebrow">30%Up Breakout Screener</p><h2>30% move with volume, within 3% of breakout</h2><small>Daily scan plus live LTP and hourly breakout candle status.</small></div><div className="thirty-hero-actions"><div className="refresh-status"><span className={autoRefresh ? "ready" : "idle-dot"} /><b>{autoRefresh ? "Auto refresh on" : "Auto refresh off"}</b><small>Last {formatTime(updatedAt)}</small></div><button className="secondary compact" onClick={() => setAutoRefresh((value) => !value)}>{autoRefresh ? "Pause" : "Resume"}</button><button className="primary" onClick={() => onRun()} disabled={loading}><TrendingUp size={15}/>Run 30%Up</button><button className="secondary compact" onClick={onReset}>Reset</button></div></div><div className="thirty-filter-strip"><label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as ThirtyUpFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label><label>Lookback<input className="plain-input" type="number" value={filters.lookbackDays} onChange={(e) => setNumber("lookbackDays", Number(e.target.value))}/></label><label>Move %<input className="plain-input" type="number" value={filters.minMovePct} onChange={(e) => setNumber("minMovePct", Number(e.target.value))}/></label><label>Impulse Vol<input className="plain-input" type="number" step="0.1" value={filters.minImpulseVolumeRatio} onChange={(e) => setNumber("minImpulseVolumeRatio", Number(e.target.value))}/></label><label>Min EMA %<input className="plain-input" type="number" step="0.1" value={filters.minDistanceFromEmaPct} onChange={(e) => setNumber("minDistanceFromEmaPct", Number(e.target.value))}/></label><label>Breakout Near %<input className="plain-input" type="number" step="0.1" value={filters.maxBreakoutProximityPct} onChange={(e) => setNumber("maxBreakoutProximityPct", Number(e.target.value))}/></label><label>Overshoot %<input className="plain-input" type="number" step="0.1" value={filters.maxBreakoutOvershootPct} onChange={(e) => setNumber("maxBreakoutOvershootPct", Number(e.target.value))}/></label><label className="filter-row"><input type="checkbox" checked={filters.showAll} onChange={(e) => setFilters({ ...filters, showAll: e.target.checked })}/><span>Show all</span></label></div>{data && <><div className="thirty-scoreboard"><div><span>Evaluated</span><b>{data.evaluated}</b></div><div><span>Setups</span><b>{data.qualified}</b></div><div><span>30% Miss</span><b>{data.statusSummary["NO 30% MOVE"] ?? 0}</b></div><div><span>Far From BO</span><b>{data.statusSummary["FAR FROM BREAKOUT"] ?? 0}</b></div></div><section className="panel thirty-panel">{data.results.length ? <div className="table-wrap"><table className="thirty-table"><thead><tr><th><SortHead label="Status" column="status" sort={sort} onSort={sortBy}/></th><th><SortHead label="Symbol" column="symbol" sort={sort} onSort={sortBy}/></th><th><SortHead label="Universe" column="universe" sort={sort} onSort={sortBy}/></th><th><SortHead label="Chart" column="setup_path" sort={sort} onSort={sortBy}/></th><th><SortHead label="Hourly BO" column="hourly_signal" sort={sort} onSort={sortBy}/></th><th><SortHead label="LTP" column="ltp" sort={sort} onSort={sortBy}/></th><th><SortHead label="Today %" column="today_change" sort={sort} onSort={sortBy}/></th><th><SortHead label="EMA Dist" column="ema_dist" sort={sort} onSort={sortBy}/></th><th><SortHead label="65D Move" column="move" sort={sort} onSort={sortBy}/></th><th><SortHead label="Impulse Vol" column="impulse_vol" sort={sort} onSort={sortBy}/></th><th><SortHead label="Breakout Zone" column="breakout_dist" sort={sort} onSort={sortBy}/></th><th><SortHead label="Current Vol" column="current_vol" sort={sort} onSort={sortBy}/></th></tr></thead><tbody>{sortedRows.map((row) => { const liveTick = liveTicks[row.security_id]; const signal = liveHourlyBreakoutSignal(hourlySignals[row.security_id], row, liveTick?.ltp); const live = liveAdjustedThirtyUp(row, liveTick); return <tr className="click-row" key={row.security_id} onClick={() => openRow(row)}><td><span className={row.qualifies ? "eligible" : "count"}>{row.status}</span></td><td className="window">{row.symbol}</td><td>{row.universe_name}</td><td><SetupSparkline row={row} onOpen={() => openRow(row)} /></td><td><HourlySignalCell signal={signal}/></td><td className={liveTick ? "positive" : ""}>{liveTick ? money(live.liveClose) : "—"}</td><td className={live.todayChange === undefined ? "" : live.todayChange >= 0 ? "positive" : "negative"}>{live.todayChange === undefined ? "—" : pct(live.todayChange)}</td><td className={live.emaDistance >= 0 ? "positive" : "negative"}>{pct(live.emaDistance)}</td><td className="positive">{row.move_pct === undefined ? "—" : pct(row.move_pct)}</td><td>{row.impulse_volume_ratio === undefined ? "—" : `${row.impulse_volume_ratio.toFixed(1)}x`}</td><td className={live.breakoutDistance === undefined ? "" : live.breakoutDistance >= 0 ? "positive" : "negative"}>{row.high_close === undefined ? "—" : `${money(row.high_close)} / ${pct(live.breakoutDistance ?? 0)}`}</td><td>{row.current_volume_ratio === undefined ? "—" : `${row.current_volume_ratio.toFixed(1)}x`}</td></tr>; })}</tbody></table></div> : <p className="panel-empty">No stocks are within the selected breakout distance.</p>}</section></>}{selected && <div className="drawer"><div className="drawer-card chart-drawer"><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">{selected.status}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">{selected.reason}</p><ThirtyUpChartPanel selected={selected} onTradeCreated={onTradeCreated} strategyLabel="30%Up Hourly Breakout" sourceNote="Created from 30%Up hourly breakout preview. Live broker order not placed by app." /><div className="stats-grid compact-stats"><Stat label="Current Close" value={money(selected.current_close)} sub={selected.current_date}/><Stat label="Breakout Zone" value={selected.high_close === undefined ? "—" : money(selected.high_close)} sub={selected.breakout_distance_pct === undefined ? undefined : pct(selected.breakout_distance_pct)}/><Stat label="65D Move" value={selected.move_pct === undefined ? "—" : pct(selected.move_pct)} sub={`${selected.low_date ?? "—"} to ${selected.high_date ?? "—"}`}/><Stat label="50 EMA" value={money(selected.ema50)} sub={pct(selected.distance_from_ema_pct)}/></div><h3>Recent 120 daily rows</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>EMA50</th><th>Volume</th><th>Rel Vol</th></tr></thead><tbody>{selected.recent.map((row) => <tr key={row.trade_date}><td>{row.trade_date}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td>{money(row.close)}</td><td>{row.ema50 ? money(row.ema50) : "—"}</td><td>{row.volume.toLocaleString("en-IN")}</td><td>{row.volume_ratio ? `${row.volume_ratio.toFixed(1)}x` : "—"}</td></tr>)}</tbody></table></div></div></div>}</section>;
}

function ThirtyUpScreenerView({ data, filters, setFilters, loading, onRun, onReset, selected, setSelected, setLiveFeedStatus, updatedAt, onTradeCreated }: { data: ThirtyUpResponse | null; filters: ThirtyUpFilters; setFilters: (filters: ThirtyUpFilters) => void; loading: boolean; onRun: (options?: ThirtyUpRunOptions) => void; onReset: () => void; selected: ThirtyUpRow | null; setSelected: (row: ThirtyUpRow | null) => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void; updatedAt?: string | null; onTradeCreated?: () => void }) {
  return <ThirtyUpScreenerViewSimple data={data} filters={filters} setFilters={setFilters} loading={loading} onRun={onRun} onReset={onReset} selected={selected} setSelected={setSelected} setLiveFeedStatus={setLiveFeedStatus} updatedAt={updatedAt} onTradeCreated={onTradeCreated} />;
  /*
  return <section className="research-page thirty-up-page"><div className="notice"><AlertTriangle size={18}/><span>30%Up uses local daily OHLCV only. It builds a research watchlist, not a trade recommendation.</span></div><div className="thirty-hero"><div><p className="eyebrow">30%Up Screener</p><h2>Impulse, cooloff, EMA reset</h2><small>Below-EMA base, 30%+ move inside 3 months, then a controlled pullback near the 50 EMA.</small></div><div className="thirty-hero-actions"><button className="primary" onClick={onRun} disabled={loading}><TrendingUp size={15}/>Run 30%Up</button><button className="secondary compact" onClick={onReset}>Reset</button></div></div><div className="thirty-filter-strip"><label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as ThirtyUpFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label><label>Lookback<input className="plain-input" type="number" value={filters.lookbackDays} onChange={(e) => setNumber("lookbackDays", Number(e.target.value))}/></label><label>Move %<input className="plain-input" type="number" value={filters.minMovePct} onChange={(e) => setNumber("minMovePct", Number(e.target.value))}/></label><label>Impulse Vol<input className="plain-input" type="number" step="0.1" value={filters.minImpulseVolumeRatio} onChange={(e) => setNumber("minImpulseVolumeRatio", Number(e.target.value))}/></label><label>EMA Zone<input className="plain-input" type="text" value={`${filters.minDistanceFromEmaPct} to ${filters.maxDistanceFromEmaPct}`} readOnly/></label><label>Cooloff<input className="plain-input" type="number" value={filters.minCooloffDays} onChange={(e) => setNumber("minCooloffDays", Number(e.target.value))}/></label><label>Retrace Max<input className="plain-input" type="number" value={filters.maxRetracementPct} onChange={(e) => setNumber("maxRetracementPct", Number(e.target.value))}/></label><label className="filter-row"><input type="checkbox" checked={filters.showAll} onChange={(e) => setFilters({ ...filters, showAll: e.target.checked })}/><span>Show all</span></label></div>{data && <><div className="thirty-scoreboard"><div><span>Evaluated</span><b>{data.evaluated}</b></div><div><span>Setups</span><b>{data.qualified}</b></div><div><span>Extended</span><b>{data.statusSummary["TOO EXTENDED"] ?? 0}</b></div><div><span>Deep</span><b>{data.statusSummary["TOO DEEP"] ?? 0}</b></div></div><section className="panel thirty-panel">{data.results.length ? <div className="table-wrap"><table className="thirty-table"><thead><tr><th>Status</th><th>Symbol</th><th>Universe</th><th>Setup Path</th><th>Close</th><th>EMA Dist</th><th>Move</th><th>Impulse Vol</th><th>Since High</th><th>Pullback</th><th>Retrace</th><th>Current Vol</th></tr></thead><tbody>{data.results.map((row) => <tr className="click-row" key={row.security_id} onClick={() => setSelected(row)}><td><span className={row.qualifies ? "eligible" : "count"}>{row.status}</span></td><td className="window">{row.symbol}</td><td>{row.universe_name}</td><td><SetupSparkline row={row} onOpen={() => setSelected(row)} /></td><td>{money(row.current_close)}</td><td className={row.distance_from_ema_pct >= 0 ? "positive" : "negative"}>{pct(row.distance_from_ema_pct)}</td><td className="positive">{row.move_pct === undefined ? "—" : pct(row.move_pct)}</td><td>{row.impulse_volume_ratio === undefined ? "—" : `${row.impulse_volume_ratio.toFixed(1)}x`}</td><td>{row.days_since_high ?? "—"}</td><td className="negative">{row.pullback_from_high_pct === undefined ? "—" : pct(row.pullback_from_high_pct)}</td><td>{row.retracement_pct === undefined ? "—" : pct(row.retracement_pct)}</td><td>{row.current_volume_ratio === undefined ? "—" : `${row.current_volume_ratio.toFixed(1)}x`}</td></tr>)}</tbody></table></div> : <p className="panel-empty">No stocks currently meet the selected 30%Up criteria.</p>}</section></>}{selected && <div className="drawer"><div className="drawer-card chart-drawer"><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">{selected.status}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">{selected.reason}</p><ThirtyUpChartPanel selected={selected} /><div className="stats-grid compact-stats"><Stat label="Current Close" value={money(selected.current_close)} sub={selected.current_date}/><Stat label="50 EMA" value={money(selected.ema50)} sub={pct(selected.distance_from_ema_pct)}/><Stat label="Low To High" value={selected.move_pct === undefined ? "—" : pct(selected.move_pct)} sub={`${selected.low_date ?? "—"} to ${selected.high_date ?? "—"}`}/><Stat label="Retracement" value={selected.retracement_pct === undefined ? "—" : pct(selected.retracement_pct)} sub={selected.pullback_from_high_pct === undefined ? undefined : `from high ${pct(selected.pullback_from_high_pct)}`}/></div><div className="stats-grid compact-stats"><Stat label="Low Close" value={selected.low_close === undefined ? "—" : money(selected.low_close)} sub={selected.low_distance_from_ema_pct === undefined ? undefined : `vs EMA ${pct(selected.low_distance_from_ema_pct)}`}/><Stat label="High Close" value={selected.high_close === undefined ? "—" : money(selected.high_close)} sub={selected.impulse_volume_ratio === undefined ? undefined : `${selected.impulse_volume_ratio.toFixed(1)}x max vol`}/><Stat label="Days Low To High" value={`${selected.days_low_to_high ?? "—"}`} /><Stat label="Days Since High" value={`${selected.days_since_high ?? "—"}`} /></div><h3>Recent 120 daily rows</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>EMA50</th><th>Volume</th><th>Rel Vol</th></tr></thead><tbody>{selected.recent.map((row) => <tr key={row.trade_date}><td>{row.trade_date}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td>{money(row.close)}</td><td>{row.ema50 ? money(row.ema50) : "—"}</td><td>{row.volume.toLocaleString("en-IN")}</td><td>{row.volume_ratio ? `${row.volume_ratio.toFixed(1)}x` : "—"}</td></tr>)}</tbody></table></div></div></div>}</section>;
  */
}

function liveAdjustedEarlyBreakout(row: EarlyBreakoutRow, liveTick?: LiveTick) {
  const liveClose = liveTick?.ltp ?? row.current_close;
  const prevClose = liveTick?.prevClose ?? row.current_close;
  const todayChange = liveTick ? ((liveClose / prevClose) - 1) * 100 : undefined;
  const emaDistance = ((liveClose / row.ema50) - 1) * 100;
  const breakoutDistance = row.breakout_close === undefined ? row.distance_to_breakout_pct : ((liveClose / row.breakout_close) - 1) * 100;
  return { liveClose, todayChange, emaDistance, breakoutDistance };
}

function EarlyBreakoutScreenerView({ data, filters, setFilters, loading, onRun, onReset, selected, setSelected, setLiveFeedStatus, updatedAt, onTradeCreated }: { data: EarlyBreakoutResponse | null; filters: EarlyBreakoutFilters; setFilters: (filters: EarlyBreakoutFilters) => void; loading: boolean; onRun: (options?: ThirtyUpRunOptions) => void; onReset: () => void; selected: EarlyBreakoutRow | null; setSelected: (row: EarlyBreakoutRow | null) => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void; updatedAt?: string | null; onTradeCreated?: () => void }) {
  const [sort, setSort] = useState<{ key: EarlyBreakoutSortKey; direction: "asc" | "desc" }>({ key: "breakout_dist", direction: "desc" });
  const [hourlySignals, setHourlySignals] = useState<Record<string, HourlySignal>>({});
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const setNumber = (key: keyof EarlyBreakoutFilters, value: number) => setFilters({ ...filters, [key]: value });
  const sortBy = (key: EarlyBreakoutSortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" });
  const openRow = (row: EarlyBreakoutRow) => {
    setSelected(row);
    void fetchThirtyUpIntraday(row.security_id, true, "early-breakout-screener").catch(() => undefined);
  };

  useEffect(() => {
    if (!autoRefresh || !data) return;
    const timer = window.setInterval(() => onRun({ silent: true }), 120_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, data, onRun]);

  useEffect(() => {
    const ids = (data?.results ?? []).map((row) => row.security_id).slice(0, 100).join(",");
    if (!ids) {
      setLiveTicks({});
      setLiveFeedStatus("idle");
      return;
    }
    const source = new EventSource(`/api/early-breakout-screener/live?ids=${encodeURIComponent(ids)}`);
    const applyTick = (tick: LiveTick) => setLiveTicks((current) => ({ ...current, [tick.securityId]: tick }));
    source.onopen = () => setLiveFeedStatus("connecting", "Waiting for Dhan websocket status");
    source.addEventListener("status", (event) => {
      const status = JSON.parse((event as MessageEvent).data) as LiveFeedStatusUpdate;
      if (status.state === "idle" || status.state === "connecting" || status.state === "live" || status.state === "error") setLiveFeedStatus(status.state, status.message);
    });
    source.addEventListener("snapshot", (event) => {
      const ticks = JSON.parse((event as MessageEvent).data) as LiveTick[];
      setLiveTicks((current) => ({ ...current, ...Object.fromEntries(ticks.map((tick) => [tick.securityId, tick])) }));
    });
    source.addEventListener("tick", (event) => {
      setLiveFeedStatus("live", "Receiving Dhan ticks");
      applyTick(JSON.parse((event as MessageEvent).data) as LiveTick);
    });
    source.onerror = () => {
      setLiveFeedStatus("error", "Live feed stream disconnected");
    };
    return () => {
      source.close();
      setLiveFeedStatus("idle");
    };
  }, [data, setLiveFeedStatus]);

  useEffect(() => {
    const rows = (data?.results ?? []).filter((row) => row.qualifies).slice(0, 40);
    if (!rows.length) {
      setHourlySignals({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      for (const row of rows) {
        if (cancelled) return;
        setHourlySignals((current) => current[row.security_id] ? current : { ...current, [row.security_id]: { state: "loading", label: "Loading hourly 50 EMA" } });
        try {
          const candles = await fetchThirtyUpIntraday(row.security_id, false, "early-breakout-screener");
          const signal = calculateHourlySignal(candles);
          if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: signal }));
        } catch (error) {
          if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: { state: "error", label: error instanceof Error ? error.message : "Hourly data unavailable" } }));
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [data]);

  const sortedRows = useMemo(() => {
    const rows = [...(data?.results ?? [])];
    const valueFor = (row: EarlyBreakoutRow): string | number => {
      const liveTick = liveTicks[row.security_id];
      const signal = liveHourlySignal(hourlySignals[row.security_id], liveTick?.ltp);
      const live = liveAdjustedEarlyBreakout(row, liveTick);
      if (sort.key === "status") return row.status;
      if (sort.key === "symbol") return row.symbol;
      if (sort.key === "universe") return row.universe_name;
      if (sort.key === "setup_path") return row.recent.at(-1)?.close ?? row.current_close;
      if (sort.key === "hourly_signal") return { green: 3, yellow: 2, red: 1, error: 0, loading: -1 }[signal?.state ?? "loading"];
      if (sort.key === "ltp") return live.liveClose;
      if (sort.key === "today_change") return live.todayChange ?? 0;
      if (sort.key === "close") return live.liveClose;
      if (sort.key === "ema_dist") return live.emaDistance;
      if (sort.key === "move") return row.first_move_pct ?? -Infinity;
      if (sort.key === "breakout_vol") return row.breakout_volume_ratio ?? -Infinity;
      if (sort.key === "consolidation") return row.consolidation_days ?? Infinity;
      if (sort.key === "pullback") return row.pullback_from_breakout_pct ?? -Infinity;
      if (sort.key === "breakout_dist") return live.breakoutDistance ?? -Infinity;
      return row.current_volume_ratio ?? -Infinity;
    };
    rows.sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? comparison : -comparison;
    });
    return rows;
  }, [data, hourlySignals, liveTicks, sort]);

  return <section className="research-page thirty-up-page"><div className="notice"><AlertTriangle size={18}/><span>Early Breakout combines local daily OHLCV with live Dhan ticks. Use it as a watchlist for tight consolidations near breakout zones.</span></div><div className="thirty-hero"><div><p className="eyebrow">Early Breakout Screener</p><h2>First move, tight base, near breakout</h2><small>Looks for strong volume reclaim above daily 50 EMA, at least 5 days of shallow consolidation, and price within the breakout zone.</small></div><div className="thirty-hero-actions"><div className="refresh-status"><span className={autoRefresh ? "ready" : "idle-dot"} /><b>{autoRefresh ? "Auto refresh on" : "Auto refresh off"}</b><small>Last {formatTime(updatedAt)}</small></div><button className="secondary compact" onClick={() => setAutoRefresh((value) => !value)}>{autoRefresh ? "Pause" : "Resume"}</button><button className="primary" onClick={() => onRun()} disabled={loading}><Activity size={15}/>Run Screener</button><button className="secondary compact" onClick={onReset}>Reset</button></div></div><div className="thirty-filter-strip"><label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as EarlyBreakoutFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label><label>Lookback<input className="plain-input" type="number" value={filters.lookbackDays} onChange={(e) => setNumber("lookbackDays", Number(e.target.value))}/></label><label>Move %<input className="plain-input" type="number" value={filters.minFirstMovePct} onChange={(e) => setNumber("minFirstMovePct", Number(e.target.value))}/></label><label>Impulse Vol<input className="plain-input" type="number" step="0.1" value={filters.minImpulseVolumeRatio} onChange={(e) => setNumber("minImpulseVolumeRatio", Number(e.target.value))}/></label><label>Consol Days<input className="plain-input" type="text" value={`${filters.minConsolidationDays} to ${filters.maxConsolidationDays}`} readOnly/></label><label>Max Pullback<input className="plain-input" type="number" value={filters.maxPullbackPct} onChange={(e) => setNumber("maxPullbackPct", Number(e.target.value))}/></label><label>Breakout Near<input className="plain-input" type="number" value={filters.maxBreakoutProximityPct} onChange={(e) => setNumber("maxBreakoutProximityPct", Number(e.target.value))}/></label><label className="filter-row"><input type="checkbox" checked={filters.showAll} onChange={(e) => setFilters({ ...filters, showAll: e.target.checked })}/><span>Show all</span></label></div><div className="thirty-filter-strip"><label>Min Consol<input className="plain-input" type="number" value={filters.minConsolidationDays} onChange={(e) => setNumber("minConsolidationDays", Number(e.target.value))}/></label><label>Max Consol<input className="plain-input" type="number" value={filters.maxConsolidationDays} onChange={(e) => setNumber("maxConsolidationDays", Number(e.target.value))}/></label><label>Overshoot %<input className="plain-input" type="number" step="0.1" value={filters.maxBreakoutOvershootPct} onChange={(e) => setNumber("maxBreakoutOvershootPct", Number(e.target.value))}/></label><label>Current Vol<input className="plain-input" type="number" step="0.1" value={filters.maxCurrentVolumeRatio} onChange={(e) => setNumber("maxCurrentVolumeRatio", Number(e.target.value))}/></label><label className="filter-row"><input type="checkbox" checked={filters.requireAboveEma} onChange={(e) => setFilters({ ...filters, requireAboveEma: e.target.checked })}/><span>Above 50 EMA</span></label><label className="filter-row"><input type="checkbox" checked={filters.requireRisingEma} onChange={(e) => setFilters({ ...filters, requireRisingEma: e.target.checked })}/><span>Rising 50 EMA</span></label></div>{data && <><div className="thirty-scoreboard"><div><span>Evaluated</span><b>{data.evaluated}</b></div><div><span>Setups</span><b>{data.qualified}</b></div><div><span>Too Far</span><b>{data.statusSummary["TOO FAR FROM BREAKOUT"] ?? 0}</b></div><div><span>Deep Pullback</span><b>{data.statusSummary["PULLBACK TOO DEEP"] ?? 0}</b></div></div><section className="panel thirty-panel">{data.results.length ? <div className="table-wrap"><table className="thirty-table"><thead><tr><th><SortHead label="Status" column="status" sort={sort} onSort={sortBy}/></th><th><SortHead label="Symbol" column="symbol" sort={sort} onSort={sortBy}/></th><th><SortHead label="Universe" column="universe" sort={sort} onSort={sortBy}/></th><th><SortHead label="Setup Path" column="setup_path" sort={sort} onSort={sortBy}/></th><th><SortHead label="Hourly" column="hourly_signal" sort={sort} onSort={sortBy}/></th><th><SortHead label="LTP" column="ltp" sort={sort} onSort={sortBy}/></th><th><SortHead label="Today %" column="today_change" sort={sort} onSort={sortBy}/></th><th><SortHead label="Live EMA Dist" column="ema_dist" sort={sort} onSort={sortBy}/></th><th><SortHead label="First Move" column="move" sort={sort} onSort={sortBy}/></th><th><SortHead label="Breakout Vol" column="breakout_vol" sort={sort} onSort={sortBy}/></th><th><SortHead label="Consol" column="consolidation" sort={sort} onSort={sortBy}/></th><th><SortHead label="Pullback" column="pullback" sort={sort} onSort={sortBy}/></th><th><SortHead label="Breakout Dist" column="breakout_dist" sort={sort} onSort={sortBy}/></th><th><SortHead label="Current Vol" column="current_vol" sort={sort} onSort={sortBy}/></th></tr></thead><tbody>{sortedRows.map((row) => { const liveTick = liveTicks[row.security_id]; const signal = liveHourlySignal(hourlySignals[row.security_id], liveTick?.ltp); const live = liveAdjustedEarlyBreakout(row, liveTick); return <tr className="click-row" key={row.security_id} onClick={() => openRow(row)}><td><span className={row.qualifies ? "eligible" : "count"}>{row.status}</span></td><td className="window">{row.symbol}</td><td>{row.universe_name}</td><td><SetupSparkline row={row} onOpen={() => openRow(row)} /></td><td><HourlySignalCell signal={signal}/></td><td className={liveTick ? "positive" : ""}>{liveTick ? money(live.liveClose) : "—"}</td><td className={live.todayChange === undefined ? "" : live.todayChange >= 0 ? "positive" : "negative"}>{live.todayChange === undefined ? "—" : pct(live.todayChange)}</td><td className={live.emaDistance >= 0 ? "positive" : "negative"}>{pct(live.emaDistance)}</td><td className="positive">{row.first_move_pct === undefined ? "—" : pct(row.first_move_pct)}</td><td>{row.breakout_volume_ratio === undefined ? "—" : `${row.breakout_volume_ratio.toFixed(1)}x`}</td><td>{row.consolidation_days ?? "—"}</td><td className={row.pullback_from_breakout_pct === undefined ? "" : row.pullback_from_breakout_pct >= 0 ? "positive" : "negative"}>{row.pullback_from_breakout_pct === undefined ? "—" : pct(row.pullback_from_breakout_pct)}</td><td className={live.breakoutDistance === undefined ? "" : live.breakoutDistance >= 0 ? "positive" : "negative"}>{live.breakoutDistance === undefined ? "—" : pct(live.breakoutDistance)}</td><td>{row.current_volume_ratio === undefined ? "—" : `${row.current_volume_ratio.toFixed(1)}x`}</td></tr>; })}</tbody></table></div> : <p className="panel-empty">No stocks currently meet the selected Early Breakout criteria.</p>}</section></>}{selected && <div className="drawer"><div className="drawer-card chart-drawer"><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">{selected.status}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">{selected.reason}</p><ThirtyUpChartPanel selected={selected} onTradeCreated={onTradeCreated} intradayEndpoint="early-breakout-screener" strategyLabel="Early Breakout Swing" sourceNote="Created from Early Breakout risk preview. Live broker order not placed by app." /><div className="stats-grid compact-stats"><Stat label="Current Close" value={money(selected.current_close)} sub={selected.current_date}/><Stat label="50 EMA" value={money(selected.ema50)} sub={pct(selected.distance_from_ema_pct)}/><Stat label="First Move" value={selected.first_move_pct === undefined ? "—" : pct(selected.first_move_pct)} sub={`${selected.impulse_start_date ?? "—"} to ${selected.breakout_date ?? "—"}`}/><Stat label="Breakout Zone" value={selected.breakout_close === undefined ? "—" : money(selected.breakout_close)} sub={selected.distance_to_breakout_pct === undefined ? undefined : `distance ${pct(selected.distance_to_breakout_pct)}`}/></div><div className="stats-grid compact-stats"><Stat label="Consolidation" value={`${selected.consolidation_days ?? "—"} days`} /><Stat label="Deepest Pullback" value={selected.pullback_from_breakout_pct === undefined ? "—" : pct(selected.pullback_from_breakout_pct)} sub={selected.consolidation_low === undefined ? undefined : money(selected.consolidation_low)}/><Stat label="Breakout Volume" value={selected.breakout_volume_ratio === undefined ? "—" : `${selected.breakout_volume_ratio.toFixed(1)}x`} /><Stat label="EMA Slope" value={selected.ema50_slope_pct === undefined ? "—" : pct(selected.ema50_slope_pct)} /></div><h3>Recent 120 daily rows</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>EMA50</th><th>Volume</th><th>Rel Vol</th></tr></thead><tbody>{selected.recent.map((row) => <tr key={row.trade_date}><td>{row.trade_date}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td>{money(row.close)}</td><td>{row.ema50 ? money(row.ema50) : "—"}</td><td>{row.volume.toLocaleString("en-IN")}</td><td>{row.volume_ratio ? `${row.volume_ratio.toFixed(1)}x` : "—"}</td></tr>)}</tbody></table></div></div></div>}</section>;
}

function MomentumMiniChart({ row, liveTick, onOpen }: { row: MomentumContractionRow; liveTick?: LiveTick; onOpen: () => void }) {
  const recent = lastTradingMonths(row.recent);
  const closes = recent.map((point, index) => index === recent.length - 1 && liveTick?.ltp ? liveTick.ltp : point.close);
  const trendUp = closes.length > 1 && closes.at(-1)! >= closes[0];
  return <button className="momentum-tile-chart" onClick={onOpen} aria-label={`Open ${row.symbol} scanner chart`}>
    <svg viewBox="0 0 220 82" preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-area" d={`${polylinePath(closes, 220, 82)} L220 82 L0 82 Z`} />
      <path className={trendUp ? "spark-line up" : "spark-line down"} d={polylinePath(closes, 220, 82)} />
    </svg>
  </button>;
}

function MomentumContractionScreenerView({ data, filters, setFilters, loading, onRun, onReset, selected, setSelected, setLiveFeedStatus, updatedAt }: { data: MomentumContractionResponse | null; filters: MomentumContractionFilters; setFilters: (filters: MomentumContractionFilters) => void; loading: boolean; onRun: (options?: ThirtyUpRunOptions) => void; onReset: () => void; selected: MomentumContractionRow | null; setSelected: (row: MomentumContractionRow | null) => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void; updatedAt?: string | null }) {
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setNumber = (key: keyof MomentumContractionFilters, value: number) => setFilters({ ...filters, [key]: value });

  useEffect(() => {
    if (!autoRefresh || !data) return;
    const timer = window.setInterval(() => onRun({ silent: true }), 120_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, data, onRun]);

  useEffect(() => {
    const ids = (data?.results ?? []).map((row) => row.security_id).slice(0, 100).join(",");
    if (!ids) {
      setLiveTicks({});
      setLiveFeedStatus("idle");
      return;
    }
    const source = new EventSource(`/api/momentum-contraction-screener/live?ids=${encodeURIComponent(ids)}`);
    source.onopen = () => setLiveFeedStatus("connecting", "Waiting for Dhan websocket status");
    source.addEventListener("status", (event) => {
      const status = JSON.parse((event as MessageEvent).data) as LiveFeedStatusUpdate;
      if (status.state === "idle" || status.state === "connecting" || status.state === "live" || status.state === "error") setLiveFeedStatus(status.state, status.message);
    });
    source.addEventListener("snapshot", (event) => {
      const ticks = JSON.parse((event as MessageEvent).data) as LiveTick[];
      setLiveTicks((current) => ({ ...current, ...Object.fromEntries(ticks.map((tick) => [tick.securityId, tick])) }));
    });
    source.addEventListener("tick", (event) => {
      setLiveFeedStatus("live", "Receiving Dhan ticks");
      const tick = JSON.parse((event as MessageEvent).data) as LiveTick;
      setLiveTicks((current) => ({ ...current, [tick.securityId]: tick }));
    });
    source.onerror = () => {
      setLiveFeedStatus("error", "Live feed stream disconnected");
    };
    return () => {
      source.close();
      setLiveFeedStatus("idle");
    };
  }, [data, setLiveFeedStatus]);

  return <section className="research-page thirty-up-page momentum-page"><div className="notice"><AlertTriangle size={18}/><span>Momentum Tight scans for prior demand followed by price tightness and volume dry-up. It does not predict breakouts.</span></div><div className="thirty-hero momentum-hero"><div><p className="eyebrow">Momentum + Volume Contraction</p><h2>Demand shown, supply drying up</h2><small>Server-side scan is cached for 60 seconds; live socket ticks update visible mini charts and the opened chart without recalculating the scan.</small></div><div className="thirty-hero-actions"><div className="refresh-status"><span className={autoRefresh ? "ready" : "idle-dot"} /><b>{autoRefresh ? "Auto refresh on" : "Auto refresh off"}</b><small>Last {formatTime(updatedAt)}</small></div><button className="secondary compact" onClick={() => setAutoRefresh((value) => !value)}>{autoRefresh ? "Pause" : "Resume"}</button><button className="primary" onClick={() => onRun()} disabled={loading}><Activity size={15}/>Run Scanner</button><button className="secondary compact" onClick={() => setSettingsOpen(true)}><Settings size={14}/>Settings</button></div></div><div className="momentum-filter-bar"><label>Setup<select value={filters.setupType} onChange={(e) => setFilters({ ...filters, setupType: e.target.value as MomentumContractionFilters["setupType"] })}><option value="ALL">All</option><option value="MOMENTUM_CONTRACTION">Momentum Contraction</option><option value="TRENDING_TIGHT">Trending Tight</option></select></label><label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as MomentumContractionFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label><label>Score<input className="plain-input" type="number" value={filters.minSetupScore} onChange={(e) => setNumber("minSetupScore", Number(e.target.value))}/></label><label>Move %<input className="plain-input" type="number" value={filters.minPriorMovePct} onChange={(e) => setNumber("minPriorMovePct", Number(e.target.value))}/></label><label>EMA Max %<input className="plain-input" type="number" value={filters.maxDistanceFromEmaPct} onChange={(e) => setNumber("maxDistanceFromEmaPct", Number(e.target.value))}/></label><label>Vol Dry<input className="plain-input" type="number" step="0.05" value={filters.dryVolumeRatio} onChange={(e) => setNumber("dryVolumeRatio", Number(e.target.value))}/></label><label>Tightness<input className="plain-input" type="number" step="0.05" value={filters.tightRangeAtr} onChange={(e) => setNumber("tightRangeAtr", Number(e.target.value))}/></label><button className="secondary compact" onClick={onReset}>Reset Filters</button></div>{data && <><div className="thirty-scoreboard"><div><span>Evaluated</span><b>{data.evaluated}</b></div><div><span>Setups</span><b>{data.qualified}</b></div><div><span>Momentum</span><b>{data.results.filter((row) => row.setupType === "MOMENTUM_CONTRACTION").length}</b></div><div><span>Trending</span><b>{data.results.filter((row) => row.setupType === "TRENDING_TIGHT").length}</b></div></div><section className="momentum-grid">{data.results.length ? data.results.map((row) => <button key={row.security_id} className="momentum-tile" onClick={() => setSelected(row)} title={`${row.setupType.replace("_", " ")} · Score ${row.setupScore}`}><span><b>{row.symbol}</b><small>{row.company_name}</small></span><MomentumMiniChart row={row} liveTick={liveTicks[row.security_id]} onOpen={() => setSelected(row)} /></button>) : <p className="panel-empty">No stocks currently meet the selected momentum contraction criteria.</p>}</section></>}{settingsOpen && <div className="drawer"><div className="drawer-card narrow-drawer"><button className="icon-button drawer-close" onClick={() => setSettingsOpen(false)}>×</button><p className="eyebrow">Scanner Settings</p><h2>Momentum Tight thresholds</h2><div className="settings-grid compact-form"><label>EMA Length<input className="plain-input" type="number" value={filters.emaLength} onChange={(e) => setNumber("emaLength", Number(e.target.value))}/></label><label>EMA Slope Lookback<input className="plain-input" type="number" value={filters.emaSlopeLookback} onChange={(e) => setNumber("emaSlopeLookback", Number(e.target.value))}/></label><label>Momentum Lookback<input className="plain-input" type="number" value={filters.momentumLookback} onChange={(e) => setNumber("momentumLookback", Number(e.target.value))}/></label><label>Expansion RVOL<input className="plain-input" type="number" step="0.1" value={filters.expansionRelativeVolume} onChange={(e) => setNumber("expansionRelativeVolume", Number(e.target.value))}/></label><label>Volume Avg Length<input className="plain-input" type="number" value={filters.volumeAverageLength} onChange={(e) => setNumber("volumeAverageLength", Number(e.target.value))}/></label><label>ATR Length<input className="plain-input" type="number" value={filters.atrLength} onChange={(e) => setNumber("atrLength", Number(e.target.value))}/></label><label>Low Volume Lookback<input className="plain-input" type="number" value={filters.lowVolumeLookback} onChange={(e) => setNumber("lowVolumeLookback", Number(e.target.value))}/></label><label>Contraction Lookback<input className="plain-input" type="number" value={filters.contractionLookback} onChange={(e) => setNumber("contractionLookback", Number(e.target.value))}/></label><label>Minimum Traded Value<input className="plain-input" type="number" value={filters.minAverageDailyTradedValue} onChange={(e) => setNumber("minAverageDailyTradedValue", Number(e.target.value))}/></label><label className="toggle-row"><input type="checkbox" checked={filters.requireRisingEma} onChange={(e) => setFilters({ ...filters, requireRisingEma: e.target.checked })}/><span>Require rising EMA</span></label><label className="toggle-row"><input type="checkbox" checked={filters.showAll} onChange={(e) => setFilters({ ...filters, showAll: e.target.checked })}/><span>Show failed rows</span></label><label className="toggle-row"><input type="checkbox" checked={filters.debug} onChange={(e) => setFilters({ ...filters, debug: e.target.checked })}/><span>Show diagnostics</span></label></div><div className="toolbar-actions"><button className="primary" onClick={() => { setSettingsOpen(false); onRun(); }}>Apply Settings</button><button className="secondary" onClick={onReset}>Reset To Defaults</button></div></div></div>}{selected && <div className="drawer"><div className="drawer-card chart-drawer"><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">{selected.setupType.replace("_", " ")} · Score {selected.setupScore}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">{selected.reason}</p><ThirtyUpChartPanel selected={selected} intradayEndpoint="momentum-contraction-screener" showTradePreview={false} /><div className="stats-grid compact-stats"><Stat label="Prior Move" value={pct(selected.priorMovePct)} sub={`${selected.momentumRelativeVolume.toFixed(1)}x max RVOL`}/><Stat label="Range / ATR" value={selected.rangeCompression.toFixed(2)} sub={`ATR ${money(selected.atr14)}`}/><Stat label="Volume Dry-Up" value={`${selected.relativeVolume.toFixed(2)}x`} sub={`bottom ${selected.volumePercentile.toFixed(0)}%`}/><Stat label="EMA Distance" value={pct(selected.distance_from_ema_pct)} sub={`slope ${pct(selected.emaSlope)}`}/></div>{(filters.debug || selected.diagnostics.length > 0) && <section className="rule-list"><details open={filters.debug}><summary>Diagnostics</summary>{selected.diagnostics.map((item) => <span key={item.label} className={item.pass ? "pass" : "fail"}>{item.pass ? "PASS" : "FAIL"} - {item.label}</span>)}</details></section>}</div></div>}</section>;
}

function ThirtyInThirtyTileChart({ row, chartMonths, onOpen }: { row: ThirtyInThirtyRow; chartMonths: 3 | 6; onOpen: () => void }) {
  const chartRows = lastTradingMonths(row.recent, chartMonths === 6 ? 126 : 63);
  const closes = chartRows.map((point) => point.close);
  const trendUp = closes.length > 1 && closes.at(-1)! >= closes[0];
  return <span className="thirty-in-thirty-chart" onClick={(event) => { event.stopPropagation(); onOpen(); }} role="img" aria-label={`${row.symbol} last 3 months line chart`}>
    <svg viewBox="0 0 220 82" preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-area" d={`${polylinePath(closes, 220, 82)} L220 82 L0 82 Z`} />
      <path className={trendUp ? "spark-line up" : "spark-line down"} d={polylinePath(closes, 220, 82)} />
    </svg>
  </span>;
}

function EntrySizingTile({ title, entry, stop, settings, loading }: { title: string; entry: number; stop?: number; settings?: TradingSettings | null; loading?: boolean }) {
  const sizing = positionSizingFromStop(entry, stop, settings);
  const riskPct = sizing.riskPerShare > 0 && entry > 0 ? (sizing.riskPerShare / entry) * 100 : 0;
  return <div className={`entry-sizing-tile ${sizing.valid ? "good" : "bad"}`}>
    <div>
      <span>{title}</span>
      <strong>{loading ? "Loading..." : sizing.valid ? `${sizing.quantity.toLocaleString("en-IN")} qty` : "No entry"}</strong>
      <small className="entry-value">{sizing.valid ? rupees(sizing.value) : settings ? "Stop is not below entry" : "Settings unavailable"}</small>
    </div>
    <div>
      <span>SL</span>
      <b>{stop ? money(stop) : "—"}</b>
      <small className="entry-value">{riskPct > 0 ? `${riskPct.toFixed(2)}%` : `Risk unit ${rupees(sizing.riskUnit)}`}</small>
    </div>
  </div>;
}

function ThirtyInThirtyRiskTiles({ selected, activeRows, hourlyRows, hourlyLoading, hourlyError, settings }: { selected: ThirtyInThirtyRow; activeRows: DailyChartPoint[]; hourlyRows: DailyChartPoint[]; hourlyLoading: boolean; hourlyError?: string; settings?: TradingSettings | null }) {
  const entry = selected.current_close;
  const dailyStop = latestDailyStop(activeRows.length ? activeRows : selected.recent);
  const hourlyStop = latestHourlyStop(hourlyRows);
  return <div className="entry-sizing-grid">
    <EntrySizingTile title="Daily Low Entry" entry={entry} stop={dailyStop} settings={settings} />
    <EntrySizingTile title="Hourly Low Entry" entry={entry} stop={hourlyStop} settings={settings} loading={!hourlyError && (hourlyLoading || !hourlyRows.length)} />
  </div>;
}

function ThirtyInThirtyScoreTiles({ selected, chartMonths }: { selected: ThirtyInThirtyRow; chartMonths: 3 | 6 }) {
  const nearHigh = chartMonths === 6 ? selected.pullback_from_6m_high_pct : selected.pullback_from_3m_high_pct;
  const chartReturn = chartMonths === 6 ? selected.current_6m_return_pct : selected.current_3m_return_pct;
  return <div className="strategy-stat-grid">
    <StrategyStat label="Best Window" value={pct(selected.best_return_pct)} sub={`${selected.best_start_date ?? "—"} to ${selected.best_end_date ?? "—"}`} tone={toneFromRange(selected.best_return_pct, (value) => value >= 45, (value) => value >= 30)} />
    <StrategyStat label="Current Close" value={money(selected.current_close)} sub={selected.current_date} tone="neutral" />
    <StrategyStat label="10 EMA" value={money(selected.ema10)} sub={pct(selected.distance_from_10ema_pct)} tone={toneFromRange(selected.distance_from_10ema_pct, (value) => value >= 0 && value <= 8, (value) => value > -2 && value <= 15)} />
    <StrategyStat label="50 EMA" value={money(selected.ema50)} sub={pct(selected.distance_from_ema_pct)} tone={toneFromRange(selected.distance_from_ema_pct, (value) => value >= 0 && value <= 25, (value) => value > -3 && value <= 35)} />
    <StrategyStat label={`${chartMonths}M Return`} value={pct(chartReturn)} tone={toneFromRange(chartReturn, (value) => value > 15, (value) => value > 0)} />
    <StrategyStat label="Near High" value={pct(nearHigh)} sub={`${selected.days_since_best_move} sessions since move`} tone={toneFromRange(nearHigh, (value) => value >= -4 && value <= 0.5, (value) => value >= -8 && value <= 2)} />
    <StrategyStat label="Breakout Zone" value={money(selected.breakout_level)} sub={pct(selected.breakout_distance_pct)} tone={toneFromRange(selected.breakout_distance_pct, (value) => value >= -3 && value <= 0.5, (value) => value >= -6 && value <= 2)} />
    <StrategyStat label="Tightness 5D/20D" value={`${selected.tightness_5d_vs_20d.toFixed(2)}x`} tone={toneFromRange(selected.tightness_5d_vs_20d, (value) => value <= 0.75, (value) => value <= 1)} />
    <StrategyStat label="Lowest Vol 5D/20D" value={`${selected.lowest_volume_5d_vs_20d.toFixed(2)}x`} tone={toneFromRange(selected.lowest_volume_5d_vs_20d, (value) => value <= 0.45, (value) => value <= 0.75)} />
    <StrategyStat label="Demand/Supply" value={`${selected.demand_supply_score}`} tone={toneFromRange(selected.demand_supply_score, (value) => value >= 70, (value) => value >= 50)} />
  </div>;
}

function ThirtyInThirtyChartPanel({ selected, chartMonths, settings }: { selected: ThirtyInThirtyRow; chartMonths: 3 | 6; settings?: TradingSettings | null }) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("daily");
  const [hourlyRows, setHourlyRows] = useState<DailyChartPoint[]>([]);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [hourlyError, setHourlyError] = useState("");
  const [liveDailyRow, setLiveDailyRow] = useState<DailyChartPoint | null>(null);
  const [dailyError, setDailyError] = useState("");

  useEffect(() => {
    setTimeframe("daily");
    setHourlyRows([]);
    setHourlyLoading(false);
    setHourlyError("");
    setLiveDailyRow(null);
    setDailyError("");
  }, [selected.security_id]);

  useEffect(() => {
    let cancelled = false;
    const loadIntraday = async (showLoading: boolean) => {
      if (showLoading) setHourlyLoading(true);
      setHourlyError("");
      setDailyError("");
      try {
        const rows = await fetchThirtyUpIntraday(selected.security_id, !showLoading, "thirty-in-thirty-screener");
        if (cancelled) return;
        setHourlyRows(rows);
        setLiveDailyRow(aggregateIntradayDaily(rows));
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Intraday data unavailable";
        if (timeframe === "hourly") setHourlyError(message);
        else setDailyError(message);
      } finally {
        if (!cancelled && showLoading) setHourlyLoading(false);
      }
    };
    void loadIntraday(timeframe === "hourly" && !hourlyRows.length);
    const timer = window.setInterval(() => void loadIntraday(false), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selected.security_id, timeframe]);

  const dailyRows = lastTradingMonths(mergeLiveDailyCandle(selected.recent, liveDailyRow), chartMonths === 6 ? 126 : 63);
  const activeRows = timeframe === "daily" ? dailyRows : hourlyRows;
  return <div className="chart-shell">
    <ThirtyInThirtyRiskTiles selected={selected} activeRows={dailyRows} hourlyRows={hourlyRows} hourlyLoading={hourlyLoading} hourlyError={hourlyError} settings={settings} />
    <div className="chart-toolbar">
      <div>
        <p className="eyebrow">Chart timeframe</p>
        <span>{timeframe === "daily" ? `Last ${chartMonths} months daily${liveDailyRow ? " + live intraday candle" : ""}` : "Latest 60-minute candles"}</span>
      </div>
      <div className="chart-toolbar-actions">
        <a className="secondary compact tradingview-link" href={tradingViewUrl(selected.symbol)} target="_blank" rel="noreferrer" title={`Open ${selected.symbol} in TradingView`}>
          <ArrowUpRight size={14}/>TradingView
        </a>
        <div className="segmented-control" role="group" aria-label="Chart timeframe">
          <button className={timeframe === "daily" ? "active" : ""} onClick={() => setTimeframe("daily")}>Daily</button>
          <button className={timeframe === "hourly" ? "active" : ""} onClick={() => setTimeframe("hourly")}>Hourly</button>
        </div>
      </div>
    </div>
    <CleanCandleChart rows={activeRows} timeframe={timeframe} loading={timeframe === "hourly" && hourlyLoading} error={timeframe === "hourly" ? hourlyError : ""} dailySessions={chartMonths === 6 ? 126 : 63} />
    {timeframe === "daily" && dailyError && <div className="chart-empty">Live daily candle unavailable: {dailyError}</div>}
  </div>;
}

function ThirtyInThirtyScreenerView({ data, filters, setFilters, loading, onRun, onReset, selected, setSelected, setLiveFeedStatus, updatedAt, settings }: { data: ThirtyInThirtyResponse | null; filters: ThirtyInThirtyFilters; setFilters: (filters: ThirtyInThirtyFilters) => void; loading: boolean; onRun: (options?: ThirtyUpRunOptions) => void; onReset: () => void; selected: ThirtyInThirtyRow | null; setSelected: (row: ThirtyInThirtyRow | null) => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void; updatedAt?: string | null; settings?: TradingSettings | null }) {
  const [sort, setSort] = useState<{ key: ThirtyInThirtySortKey; direction: "asc" | "desc" }>({ key: "today_return", direction: "desc" });
  const [chartMonths, setChartMonths] = useState<3 | 6>(3);
  const [tileLimit, setTileLimit] = useState(80);
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const [hourlyStops, setHourlyStops] = useState<Record<string, number | undefined>>({});
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const setNumber = (key: keyof ThirtyInThirtyFilters, value: number) => setFilters({ ...filters, [key]: value });
  const liveRows = useMemo(() => (data?.results ?? []).map((row) => liveAdjustedThirtyInThirty(row, liveTicks[row.security_id])), [data, liveTicks]);
  useEffect(() => {
    if (!selected) return;
    const replacement = liveRows.find((row) => row.security_id === selected.security_id);
    if (replacement && replacement !== selected) setSelected(replacement);
  }, [liveRows, selected, setSelected]);
  useEffect(() => {
    const rows = data?.results ?? [];
    if (!rows.length) {
      setLiveTicks({});
      setLiveFeedStatus("idle");
      return;
    }
    const liveRows = rows.slice(0, Math.min(tileLimit, thirtyInThirtyLiveFeedLimit));
    const ids = liveRows.map((row) => row.security_id);
    const controller = new AbortController();
    setLiveFeedStatus("connecting", `Starting ${ids.length} of ${rows.length} 30 in 30 live feed`);

    const handleEvent = (event: string, data: string) => {
      if (event === "status") {
        const status = JSON.parse(data) as LiveFeedStatusUpdate;
        if (status.state === "idle" || status.state === "connecting" || status.state === "live" || status.state === "error") setLiveFeedStatus(status.state, status.message);
      } else if (event === "snapshot") {
        const ticks = JSON.parse(data) as LiveTick[];
        if (ticks.length) {
          setLiveTicks((current) => ({ ...current, ...Object.fromEntries(ticks.map((tick) => [tick.securityId, tick])) }));
          setLiveFeedStatus("live", "30 in 30 live prices streaming");
        }
      } else if (event === "tick") {
        const tick = JSON.parse(data) as LiveTick;
        setLiveTicks((current) => ({ ...current, [tick.securityId]: tick }));
        setLiveFeedStatus("live", "30 in 30 live prices streaming");
      }
    };

    void fetch("/api/thirty-in-thirty-screener/live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok || !response.body) throw new Error(`30 in 30 live feed failed: HTTP ${response.status}`);
      setLiveFeedStatus("connecting", "Waiting for Dhan websocket status");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n|\r\n\r\n/);
        buffer = events.pop() ?? "";
        events.forEach((chunk) => parseServerSentEvents(chunk, handleEvent));
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setLiveFeedStatus("error", error instanceof Error ? error.message : "30 in 30 live feed disconnected");
    });
    return () => {
      controller.abort();
      setLiveFeedStatus("idle");
    };
  }, [data, setLiveFeedStatus, tileLimit]);
  useEffect(() => {
    const rows = liveRows.slice(0, 180).filter((row) => !(row.security_id in hourlyStops));
    if (!rows.length) return;
    let cancelled = false;
    rows.forEach((row) => {
      void fetchThirtyUpIntraday(row.security_id, false, "thirty-in-thirty-screener")
        .then((candles) => {
          if (cancelled) return;
          const stop = latestHourlyStop(candles);
          setHourlyStops((current) => current[row.security_id] === stop ? current : { ...current, [row.security_id]: stop });
        })
        .catch(() => {
          if (!cancelled) setHourlyStops((current) => row.security_id in current ? current : { ...current, [row.security_id]: undefined });
        });
    });
    return () => { cancelled = true; };
  }, [liveRows, hourlyStops]);
  const sortRows = useCallback((rows: ThirtyInThirtyRow[]) => {
    const valueFor = (row: ThirtyInThirtyRow): string | number => {
      if (sort.key === "symbol") return row.symbol;
      if (sort.key === "company") return row.company_name;
      if (sort.key === "today_return") return todayReturnPct(row, liveTicks[row.security_id]) ?? -Infinity;
      if (sort.key === "daily_sl_pct") return stopLossPct(row.current_close, latestDailyStop(row.recent)) ?? Infinity;
      if (sort.key === "hourly_sl_pct") return stopLossPct(row.current_close, hourlyStops[row.security_id]) ?? Infinity;
      if (sort.key === "pullback") return row.pullback_from_best_end_pct;
      if (sort.key === "near_3m_high") return row.pullback_from_3m_high_pct;
      if (sort.key === "near_6m_high") return row.pullback_from_6m_high_pct;
      if (sort.key === "breakout_3pct") return row.within_3pct_breakout ? 1 : 0;
      if (sort.key === "closest_breakout") return -Math.abs(row.breakout_distance_pct);
      if (sort.key === "tight_5d") return -row.tightness_5d_vs_20d;
      if (sort.key === "demand_supply") return row.demand_supply_score;
      if (sort.key === "volume_dryness") return -row.lowest_volume_5d_vs_20d;
      if (sort.key === "recent") return -row.days_since_best_move;
      return row.best_return_pct;
    };
    return [...rows].sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [liveTicks, sort, hourlyStops]);
  const sortedRows = useMemo(() => sortRows(liveRows.filter((row) => matchesThirtyInThirtyFilters(row, filters, liveTicks[row.security_id]))), [liveRows, liveTicks, filters, sortRows]);
  const pinnedRows = useMemo(() => sortRows(liveRows.filter((row) => pinnedIds.includes(row.security_id))), [liveRows, pinnedIds, sortRows]);
  const visibleRows = useMemo(() => {
    const pinnedSet = new Set(pinnedRows.map((row) => row.security_id));
    return [...pinnedRows, ...sortedRows.filter((row) => !pinnedSet.has(row.security_id)).slice(0, Math.max(0, tileLimit - pinnedRows.length))];
  }, [pinnedRows, sortedRows, tileLimit]);
  const togglePinned = (securityId: string) => setPinnedIds((current) => current.includes(securityId) ? current.filter((id) => id !== securityId) : [...current, securityId]);
  const sortBy = (key: ThirtyInThirtySortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "daily_sl_pct" || key === "hourly_sl_pct" ? "asc" : "desc" });

  return <section className="research-page thirty-in-thirty-page">
    <div className="thirty-hero thirty-in-thirty-hero">
      <div>
        <p className="eyebrow">30 in 30 Screener</p>
        <h2>30% moves in any 30 sessions</h2>
        <small>Finds stocks that delivered at least {filters.minReturnPct}% in any rolling {filters.windowDays}-session window over the last {filters.lookbackDays} sessions.</small>
      </div>
      <div className="thirty-hero-actions">
        <div className="refresh-status"><span className={Object.keys(liveTicks).length ? "ready" : "pending"} /><b>{Object.keys(liveTicks).length ? "Live prices" : "Last run"}</b><small>{Object.keys(liveTicks).length ? `${Object.keys(liveTicks).length} ticking` : formatTime(updatedAt)}</small></div>
        <button className="primary" onClick={() => onRun()} disabled={loading}><TrendingUp size={15}/>Run Screener</button>
        <button className="secondary compact" onClick={onReset}>Reset</button>
      </div>
    </div>
    <div className="momentum-filter-bar thirty-in-thirty-filters">
      <label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as ThirtyInThirtyFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label>
      <label>Lookback<input className="plain-input" type="number" value={filters.lookbackDays} onChange={(e) => setNumber("lookbackDays", Number(e.target.value))}/></label>
      <label>Window<input className="plain-input" type="number" value={filters.windowDays} onChange={(e) => setNumber("windowDays", Number(e.target.value))}/></label>
      <label>Return %<input className="plain-input" type="number" value={filters.minReturnPct} onChange={(e) => setNumber("minReturnPct", Number(e.target.value))}/></label>
      <label>Min Traded Value<input className="plain-input" type="number" value={filters.minAverageDailyTradedValue} onChange={(e) => setNumber("minAverageDailyTradedValue", Number(e.target.value))}/></label>
      <label>Chart<select value={chartMonths} onChange={(e) => setChartMonths(Number(e.target.value) === 6 ? 6 : 3)}><option value={3}>3 months</option><option value={6}>6 months</option></select></label>
      <label>Show Tiles<select value={tileLimit} onChange={(e) => setTileLimit(Number(e.target.value))}><option value={40}>40</option><option value={80}>80</option><option value={120}>120</option><option value={9999}>All</option></select></label>
      <label>Sort<select value={sort.key} onChange={(e) => sortBy(e.target.value as ThirtyInThirtySortKey)}><option value="today_return">Today Live Gain</option><option value="daily_sl_pct">Daily SL%</option><option value="hourly_sl_pct">Hourly SL%</option><option value="best_return">Best 30D Return</option><option value="volume_dryness">Volume Dryness</option><option value="breakout_3pct">Within 3% Breakout</option><option value="closest_breakout">Closest To Breakout</option><option value="tight_5d">Getting Tight 5D</option><option value="demand_supply">Demand Shown Supply Drying</option><option value="recent">Most Recent 30D Move</option><option value="near_3m_high">Nearest 3M High</option><option value="near_6m_high">Nearest 6M High</option><option value="pullback">Pullback From Move</option><option value="symbol">Symbol</option><option value="company">Company</option></select></label>
      <button className="secondary compact" onClick={() => setSort((current) => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))}>{sort.direction === "asc" ? "Asc" : "Desc"}</button>
    </div>
    <div className="thirty-in-thirty-switches">
      <label><input type="checkbox" checked={filters.positive3MonthsOnly} onChange={(e) => setFilters({ ...filters, positive3MonthsOnly: e.target.checked })}/><span>Positive in 3M</span></label>
      <label><input type="checkbox" checked={filters.positive6MonthsOnly} onChange={(e) => setFilters({ ...filters, positive6MonthsOnly: e.target.checked })}/><span>Positive in 6M</span></label>
      <label><input type="checkbox" checked={filters.above50EmaOnly} onChange={(e) => setFilters({ ...filters, above50EmaOnly: e.target.checked })}/><span>Above 50EMA</span></label>
      <label><input type="checkbox" checked={filters.above10EmaOnly} onChange={(e) => setFilters({ ...filters, above10EmaOnly: e.target.checked })}/><span>Above 10EMA</span></label>
      <label><input type="checkbox" checked={filters.nearPreviousDayHighOnly} onChange={(e) => setFilters({ ...filters, nearPreviousDayHighOnly: e.target.checked })}/><span>Near PD High</span></label>
      <label><input type="checkbox" checked={filters.upTodayOnly} onChange={(e) => setFilters({ ...filters, upTodayOnly: e.target.checked })}/><span>Up</span></label>
      <label><input type="checkbox" checked={filters.nearSwingHighOnly} onChange={(e) => setFilters({ ...filters, nearSwingHighOnly: e.target.checked })}/><span>Swing High</span></label>
      <label title="Strong Start: live day open is above previous close and below previous high"><input type="checkbox" checked={filters.strongStartOnly} onChange={(e) => setFilters({ ...filters, strongStartOnly: e.target.checked })}/><span>SS</span></label>
      <label><input type="checkbox" checked={filters.earlyVolumeOnly} onChange={(e) => setFilters({ ...filters, earlyVolumeOnly: e.target.checked })}/><span>Early Vol</span></label>
      <label><input type="checkbox" checked={filters.highVolumeOnly} onChange={(e) => setFilters({ ...filters, highVolumeOnly: e.target.checked })}/><span>High Volume</span></label>
      <label><input type="checkbox" checked={filters.decliningVolumeOnly} onChange={(e) => setFilters({ ...filters, decliningVolumeOnly: e.target.checked })}/><span>Declining Vol</span></label>
      <label title={`Latest completed volume <= ${thirtyInThirtyDryVolumeRatio}x average of previous ${thirtyInThirtyDryVolumeLookback} sessions`}><input type="checkbox" checked={filters.dryVolumeOnly} onChange={(e) => setFilters({ ...filters, dryVolumeOnly: e.target.checked })}/><span>Dry Volume</span></label>
      <label><input type="checkbox" checked={filters.redCandleOnly} onChange={(e) => setFilters({ ...filters, redCandleOnly: e.target.checked })}/><span>Red Candle</span></label>
    </div>
    {data && <>
      <div className="thirty-scoreboard">
        <div><span>Evaluated</span><b>{data.evaluated}</b></div>
        <div><span>Watchlist</span><b>{data.qualified}</b></div>
        <div><span>No Move</span><b>{data.statusSummary.NO_30D_MOVE ?? 0}</b></div>
        <div><span>Shown</span><b>{visibleRows.length} / {sortedRows.length}</b></div>
      </div>
      <section className="screenshot-tile-grid">
        {visibleRows.length ? visibleRows.map((row) => {
          const todayReturn = todayReturnPct(row, liveTicks[row.security_id]);
          const pinned = pinnedIds.includes(row.security_id);
          const strongStart = isStrongStart(row, liveTicks[row.security_id]);
          return <div key={row.security_id} className={`screenshot-tile ${isBreakingPreviousDayHigh(row) ? "breaking-pdh" : ""} ${pinned ? "pinned" : ""} ${strongStart ? "strong-start" : ""}`} onClick={() => setSelected(row)} onKeyDown={(event) => { if (event.key === "Enter") setSelected(row); }} role="button" tabIndex={0} title={`${row.best_return_pct.toFixed(1)}% from ${row.best_start_date} to ${row.best_end_date}`}>
            <span className="tile-badges">{strongStart && <i>SS</i>}<span className="pin-toggle" role="button" tabIndex={0} aria-label={`${pinned ? "Unpin" : "Pin"} ${row.symbol}`} title={`${pinned ? "Unpin" : "Pin"} ${row.symbol}`} onClick={(event) => { event.stopPropagation(); togglePinned(row.security_id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); togglePinned(row.security_id); } }}><Pin size={12} fill={pinned ? "currentColor" : "none"} /></span></span>
            <b>{row.symbol}</b>
            <small>{row.company_name}</small>
            {todayReturn !== undefined && <span className={`tile-today-return ${todayReturn >= 0 ? "positive" : "negative"}`}>{pct2(todayReturn)}</span>}
            <ThirtyInThirtyTileChart row={row} chartMonths={chartMonths} onOpen={() => setSelected(row)} />
          </div>;
        }) : <p className="panel-empty">No stocks matched the selected 30 in 30 criteria.</p>}
      </section>
    </>}
    {selected && <div className="drawer" onClick={() => setSelected(null)}>
      <div className="drawer-card chart-drawer" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button>
        <p className="eyebrow">30 in 30 · {selected.best_return_pct.toFixed(1)}%</p>
        <h2>{selected.symbol} · {selected.company_name}</h2>
        <p className="muted">{selected.reason}</p>
        <ThirtyInThirtyChartPanel selected={selected} chartMonths={chartMonths} settings={settings} />
        <ThirtyInThirtyScoreTiles selected={selected} chartMonths={chartMonths} />
      </div>
    </div>}
  </section>;
}

function calculateHourlyZoneSignal(rows: DailyChartPoint[], filters: HourlyBreakoutFilters): HourlySignal {
  if (rows.length < Math.max(10, filters.minConsolidationDays * 3)) return { state: "error", label: "Not enough hourly candles" };
  const latest = rows.at(-1);
  if (!latest) return { state: "error", label: "No hourly candle" };
  const zoneRows = rows.slice(-31, -1);
  if (zoneRows.length < 8) return { state: "error", label: "No hourly breakout zone" };
  const breakoutZone = Math.max(...zoneRows.map((row) => row.high));
  const distancePct = ((latest.close / breakoutZone) - 1) * 100;
  const inZone = distancePct >= -filters.maxBreakoutProximityPct && distancePct <= filters.maxBreakoutOvershootPct;
  if (inZone) return { state: "green", ltp: latest.close, distancePct, label: `Hourly zone ${pct(distancePct)}` };
  if (distancePct >= -(filters.maxBreakoutProximityPct * 2) && distancePct <= filters.maxBreakoutOvershootPct + 1) return { state: "yellow", ltp: latest.close, distancePct, label: `Near hourly zone ${pct(distancePct)}` };
  return { state: "red", ltp: latest.close, distancePct, label: `Away from hourly zone ${pct(distancePct)}` };
}

function liveHourlyBreakoutZoneSignal(signal: HourlySignal | undefined, row: HourlyBreakoutRow, ltp?: number): HourlySignal | undefined {
  if (!signal || ltp === undefined || !row.breakout_zone) return signal;
  const distancePct = ((ltp / row.breakout_zone) - 1) * 100;
  const inZone = distancePct >= -2 && distancePct <= 1;
  if (inZone) return { ...signal, state: "green", ltp, distancePct, label: `Live hourly zone ${pct(distancePct)}` };
  if (distancePct >= -4 && distancePct <= 2) return { ...signal, state: "yellow", ltp, distancePct, label: `Live near hourly zone ${pct(distancePct)}` };
  return { ...signal, state: "red", ltp, distancePct, label: `Live away from hourly zone ${pct(distancePct)}` };
}

function liveAdjustedHourlyBreakout(row: HourlyBreakoutRow, liveTick?: LiveTick) {
  const liveClose = liveTick?.ltp ?? row.current_close;
  const todayChange = liveTick?.prevClose ? ((liveClose / liveTick.prevClose) - 1) * 100 : undefined;
  const emaDistance = ((liveClose / row.ema50) - 1) * 100;
  const breakoutDistance = ((liveClose / row.breakout_zone) - 1) * 100;
  const pullbackFromZone = ((liveClose / row.breakout_zone) - 1) * 100;
  return { liveClose, todayChange, emaDistance, breakoutDistance, pullbackFromZone };
}

function CleanCandleChart({ rows, timeframe, loading, error, highVolumeRatio = 1.8, dailySessions = 63 }: { rows: DailyChartPoint[]; timeframe: ChartTimeframe; loading?: boolean; error?: string; highVolumeRatio?: number; dailySessions?: number }) {
  if (loading) return <div className="chart-empty">Loading hourly candles...</div>;
  if (error) return <div className="chart-empty">{error}</div>;
  const chartRows = timeframe === "daily" ? lastTradingMonths(rows, dailySessions) : rows.slice(-120);
  if (chartRows.length < 5) return <div className="chart-empty">Not enough {timeframe} rows for charting.</div>;
  const width = 780;
  const priceHeight = 250;
  const volumeHeight = 76;
  const lows = chartRows.map((row) => row.low);
  const highs = chartRows.map((row) => row.high);
  const closes = chartRows.map((row) => row.close);
  const calculatedEma = emaValues(closes);
  const chartEmaValues = chartRows.map((row, index) => row.ema50 ?? calculatedEma[index]);
  const visibleEmaValues = chartEmaValues.filter((value): value is number => value !== undefined);
  const priceMin = Math.min(...lows, ...visibleEmaValues);
  const priceMax = Math.max(...highs, ...visibleEmaValues);
  const candleSlot = width / chartRows.length;
  const bodyWidth = Math.max(3, Math.min(8, candleSlot * 0.48));
  const maxVolume = Math.max(...chartRows.map((row) => row.volume));
  const volumeSma = smaValues(chartRows.map((row) => row.volume), 20);
  const emaPath = chartEmaValues.map((value, index) => ({ value, x: index * candleSlot + candleSlot / 2 })).filter((point): point is { value: number; x: number } => point.value !== undefined).map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${scaleValue(point.value, priceMin, priceMax, priceHeight, 8).toFixed(2)}`).join(" ");
  return <div className="clean-chart">
    <div className="chart-legend"><span><i className="legend-candle" />{timeframe === "daily" ? "Daily" : "Hourly"} candles</span><span><i className="legend-ema" />50 EMA</span><span><i className="legend-volume" />Volume strip</span><span><i className="legend-high-volume" />High volume</span></div>
    <svg viewBox={`0 0 ${width} ${priceHeight}`} role="img" aria-label={`${timeframe} candlestick chart`}>
      {chartRows.map((row, index) => {
        const x = index * candleSlot + candleSlot / 2;
        const openY = scaleValue(row.open, priceMin, priceMax, priceHeight, 8);
        const closeY = scaleValue(row.close, priceMin, priceMax, priceHeight, 8);
        const highY = scaleValue(row.high, priceMin, priceMax, priceHeight, 8);
        const lowY = scaleValue(row.low, priceMin, priceMax, priceHeight, 8);
        const up = row.close >= row.open;
        const bodyY = Math.min(openY, closeY);
        const bodyHeight = Math.max(1, Math.abs(closeY - openY));
        return <g key={row.trade_date} className={up ? "candle up" : "candle down"}>
          <title>{`${chartDateLabel(row.trade_date, timeframe)} O ${row.open.toFixed(2)} H ${row.high.toFixed(2)} L ${row.low.toFixed(2)} C ${row.close.toFixed(2)}`}</title>
          <line x1={x} x2={x} y1={highY} y2={lowY} />
          <rect x={x - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyHeight} rx="1" />
        </g>;
      })}
      <path className="ema-line" d={emaPath} />
    </svg>
    <div className="outside-volume" style={{ height: volumeHeight }}>
      {chartRows.map((row, index) => {
        const up = row.close >= row.open;
        const avg = volumeSma[index];
        const ratio = avg ? row.volume / avg : row.volume_ratio;
        const high = (ratio ?? 0) >= highVolumeRatio;
        const height = Math.max(7, (row.volume / maxVolume) * (volumeHeight - 12));
        return <span key={row.trade_date} className={`outside-volume-bar ${up ? "up" : "down"} ${high ? "high" : ""}`} style={{ height }} title={`${chartDateLabel(row.trade_date, timeframe)} volume ${row.volume.toLocaleString("en-IN")}${ratio ? ` (${ratio.toFixed(1)}x)` : ""}`} />;
      })}
    </div>
  </div>;
}

function HourlyBreakoutChartPanel({ selected, filters }: { selected: HourlyBreakoutRow; filters: HourlyBreakoutFilters }) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("hourly");
  const [hourlyRows, setHourlyRows] = useState<DailyChartPoint[]>([]);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [hourlyError, setHourlyError] = useState("");
  const [liveDailyRow, setLiveDailyRow] = useState<DailyChartPoint | null>(null);
  const [dailyError, setDailyError] = useState("");

  useEffect(() => {
    setTimeframe("hourly");
    setHourlyRows([]);
    setHourlyLoading(false);
    setHourlyError("");
    setLiveDailyRow(null);
    setDailyError("");
  }, [selected.security_id]);

  useEffect(() => {
    let cancelled = false;
    const loadIntraday = async (showLoading: boolean) => {
      if (showLoading) setHourlyLoading(true);
      setHourlyError("");
      setDailyError("");
      try {
        const rows = await fetchThirtyUpIntraday(selected.security_id, !showLoading, "hourly-breakout-screener");
        if (cancelled) return;
        setHourlyRows(rows);
        setLiveDailyRow(aggregateIntradayDaily(rows));
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Intraday data unavailable";
        if (timeframe === "hourly") setHourlyError(message);
        else setDailyError(message);
      } finally {
        if (!cancelled && showLoading) setHourlyLoading(false);
      }
    };

    void loadIntraday(timeframe === "hourly" && !hourlyRows.length);
    const timer = window.setInterval(() => void loadIntraday(false), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selected.security_id, timeframe]);

  const activeRows = timeframe === "daily" ? mergeLiveDailyCandle(selected.recent, liveDailyRow) : hourlyRows;
  const signal = timeframe === "hourly" ? calculateHourlyZoneSignal(hourlyRows, filters) : undefined;
  return <div className="chart-shell">
    <div className="chart-toolbar">
      <div>
        <p className="eyebrow">Clean breakout chart</p>
        <span>{timeframe === "daily" ? `Daily candles${liveDailyRow ? " + live intraday candle" : ""}` : signal?.label ?? "Latest 60-minute candles"}</span>
      </div>
      <div className="segmented-control" role="group" aria-label="Chart timeframe">
        <button className={timeframe === "daily" ? "active" : ""} onClick={() => setTimeframe("daily")}>Daily</button>
        <button className={timeframe === "hourly" ? "active" : ""} onClick={() => setTimeframe("hourly")}>Hourly</button>
      </div>
    </div>
    <CleanCandleChart rows={activeRows} timeframe={timeframe} loading={timeframe === "hourly" && hourlyLoading} error={timeframe === "hourly" ? hourlyError : ""} highVolumeRatio={filters.maxCurrentVolumeRatio} />
    {timeframe === "daily" && dailyError && <div className="chart-empty">Live daily candle unavailable: {dailyError}</div>}
  </div>;
}

function HourlyBreakoutScreenerView({ data, filters, setFilters, loading, onRun, onReset, selected, setSelected, setLiveFeedStatus, updatedAt }: { data: HourlyBreakoutResponse | null; filters: HourlyBreakoutFilters; setFilters: (filters: HourlyBreakoutFilters) => void; loading: boolean; onRun: (options?: ThirtyUpRunOptions) => void; onReset: () => void; selected: HourlyBreakoutRow | null; setSelected: (row: HourlyBreakoutRow | null) => void; setLiveFeedStatus: (status: LiveFeedStatus, message?: string) => void; updatedAt?: string | null }) {
  const [sort, setSort] = useState<{ key: HourlyBreakoutSortKey; direction: "asc" | "desc" }>({ key: "breakout_dist", direction: "desc" });
  const [hourlySignals, setHourlySignals] = useState<Record<string, HourlySignal>>({});
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const setNumber = (key: keyof HourlyBreakoutFilters, value: number) => setFilters({ ...filters, [key]: value });
  const sortBy = (key: HourlyBreakoutSortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" });
  const openRow = (row: HourlyBreakoutRow) => {
    setSelected(row);
    void fetchThirtyUpIntraday(row.security_id, true, "hourly-breakout-screener").catch(() => undefined);
  };

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => onRun({ silent: true }), 120_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, onRun]);

  useEffect(() => {
    const ids = (data?.results ?? []).slice(0, 200).map((row) => row.security_id).filter(Boolean).join(",");
    setLiveTicks({});
    if (!ids) {
      setLiveFeedStatus("idle");
      return;
    }
    setLiveFeedStatus("connecting");
    const source = new EventSource(`/api/hourly-breakout-screener/live?ids=${encodeURIComponent(ids)}`);
    source.onopen = () => setLiveFeedStatus("connecting", "Waiting for Dhan websocket status");
    source.addEventListener("status", (event) => {
      const status = JSON.parse((event as MessageEvent).data) as LiveFeedStatusUpdate;
      if (status.state === "idle" || status.state === "connecting" || status.state === "live" || status.state === "error") setLiveFeedStatus(status.state, status.message);
    });
    source.addEventListener("snapshot", (event) => {
      const ticks = JSON.parse((event as MessageEvent).data) as LiveTick[];
      setLiveTicks(Object.fromEntries(ticks.map((tick) => [tick.securityId, tick])));
      if (ticks.length) setLiveFeedStatus("live", "Receiving Dhan ticks");
    });
    source.addEventListener("tick", (event) => {
      const tick = JSON.parse((event as MessageEvent).data) as LiveTick;
      setLiveTicks((current) => ({ ...current, [tick.securityId]: tick }));
      setLiveFeedStatus("live", "Receiving Dhan ticks");
    });
    source.addEventListener("error", () => {
      setLiveFeedStatus("error", "Live feed stream disconnected");
    });
    return () => {
      source.close();
      setLiveFeedStatus("idle");
    };
  }, [data, setLiveFeedStatus]);

  useEffect(() => {
    let cancelled = false;
    setHourlySignals({});
    const rows = data?.results ?? [];
    rows.slice(0, 120).forEach((row) => {
      setHourlySignals((current) => ({ ...current, [row.security_id]: { state: "loading", label: "Loading" } }));
      void fetchThirtyUpIntraday(row.security_id, false, "hourly-breakout-screener")
        .then((candles) => {
          if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: calculateHourlyZoneSignal(candles, filters) }));
        })
        .catch((error) => {
          if (!cancelled) setHourlySignals((current) => ({ ...current, [row.security_id]: { state: "error", label: error instanceof Error ? error.message : "Hourly unavailable" } }));
        });
    });
    return () => { cancelled = true; };
  }, [data, filters.maxBreakoutProximityPct, filters.maxBreakoutOvershootPct, filters.minConsolidationDays]);

  const sortedRows = useMemo(() => {
    const rows = [...(data?.results ?? [])].filter((row) => filters.showAll || liveHourlyBreakoutZoneSignal(hourlySignals[row.security_id], row, liveTicks[row.security_id]?.ltp)?.state === "green");
    const signalRank: Record<HourlySignalState, number> = { green: 4, yellow: 3, loading: 2, red: 1, error: 0 };
    const valueFor = (row: HourlyBreakoutRow): string | number => {
      const liveTick = liveTicks[row.security_id];
      const signal = liveHourlyBreakoutZoneSignal(hourlySignals[row.security_id], row, liveTick?.ltp);
      const live = liveAdjustedHourlyBreakout(row, liveTick);
      if (sort.key === "status") return row.status;
      if (sort.key === "symbol") return row.symbol;
      if (sort.key === "universe") return row.universe_name;
      if (sort.key === "setup_path") return row.trend_gain_pct;
      if (sort.key === "hourly_signal") return signal ? signalRank[signal.state] : -1;
      if (sort.key === "ltp") return live.liveClose;
      if (sort.key === "today_change") return live.todayChange ?? -Infinity;
      if (sort.key === "close") return live.liveClose;
      if (sort.key === "ema_dist") return live.emaDistance;
      if (sort.key === "trend") return row.trend_gain_pct;
      if (sort.key === "consolidation") return row.consolidation_days;
      if (sort.key === "pullback") return live.pullbackFromZone;
      if (sort.key === "breakout_dist") return Math.abs(live.breakoutDistance);
      if (sort.key === "current_vol") return row.current_volume_ratio ?? -1;
      return 0;
    };
    return rows.sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? result : -result;
    });
  }, [data, filters.showAll, hourlySignals, liveTicks, sort]);

  return <section className="research-page thirty-up-page"><div className="notice"><AlertTriangle size={18}/><span>Hourly Breakout scans for stocks above daily 50 EMA, green over the lookback, consolidating at least {filters.minConsolidationDays} days, and inside the hourly breakout zone.</span></div><div className="thirty-hero hourly-hero"><div><p className="eyebrow">Hourly Breakout Screener</p><h2>Above 50 EMA, tight base, hourly breakout zone</h2><small>Clean daily/hourly chart: no EMA overlay, no StochRSI, and volume moved outside the chart with high-volume coloring.</small></div><div className="thirty-hero-actions"><div className="refresh-status"><span className={autoRefresh ? "ready" : "idle-dot"} /><b>{autoRefresh ? "Auto refresh on" : "Auto refresh off"}</b><small>Last {formatTime(updatedAt)}</small></div><button className="secondary compact" onClick={() => setAutoRefresh((value) => !value)}>{autoRefresh ? "Pause" : "Resume"}</button><button className="primary" onClick={() => onRun()} disabled={loading}><BarChart3 size={15}/>Run Screener</button><button className="secondary compact" onClick={onReset}>Reset</button></div></div><div className="thirty-filter-strip hourly-filter-strip"><label>Universe<select value={filters.universe} onChange={(e) => setFilters({ ...filters, universe: e.target.value as HourlyBreakoutFilters["universe"] })}><option value="ALL">All</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label><label>Lookback<input className="plain-input" type="number" value={filters.lookbackDays} onChange={(e) => setNumber("lookbackDays", Number(e.target.value))}/></label><label>Min Consol<input className="plain-input" type="number" value={filters.minConsolidationDays} onChange={(e) => setNumber("minConsolidationDays", Number(e.target.value))}/></label><label>Max Pullback<input className="plain-input" type="number" step="0.1" value={filters.maxPullbackPct} onChange={(e) => setNumber("maxPullbackPct", Number(e.target.value))}/></label><label>Breakout Near %<input className="plain-input" type="number" step="0.1" value={filters.maxBreakoutProximityPct} onChange={(e) => setNumber("maxBreakoutProximityPct", Number(e.target.value))}/></label><label>Overshoot %<input className="plain-input" type="number" step="0.1" value={filters.maxBreakoutOvershootPct} onChange={(e) => setNumber("maxBreakoutOvershootPct", Number(e.target.value))}/></label><label>Min Green %<input className="plain-input" type="number" step="0.1" value={filters.minTrendGainPct} onChange={(e) => setNumber("minTrendGainPct", Number(e.target.value))}/></label><label>High Vol Mark<input className="plain-input" type="number" step="0.1" value={filters.maxCurrentVolumeRatio} onChange={(e) => setNumber("maxCurrentVolumeRatio", Number(e.target.value))}/></label><label className="filter-row"><input type="checkbox" checked={filters.showAll} onChange={(e) => setFilters({ ...filters, showAll: e.target.checked })}/><span>Show all</span></label></div>{data && <><div className="thirty-scoreboard"><div><span>Evaluated</span><b>{data.evaluated}</b></div><div><span>Daily Setups</span><b>{data.qualified}</b></div><div><span>Hourly Green</span><b>{data.results.filter((row) => liveHourlyBreakoutZoneSignal(hourlySignals[row.security_id], row, liveTicks[row.security_id]?.ltp)?.state === "green").length}</b></div><div><span>Shown</span><b>{sortedRows.length}</b></div></div><section className="panel thirty-panel">{sortedRows.length ? <div className="table-wrap"><table className="thirty-table hourly-breakout-table"><thead><tr><th><SortHead label="Status" column="status" sort={sort} onSort={sortBy}/></th><th><SortHead label="Symbol" column="symbol" sort={sort} onSort={sortBy}/></th><th><SortHead label="Universe" column="universe" sort={sort} onSort={sortBy}/></th><th><SortHead label="Chart" column="setup_path" sort={sort} onSort={sortBy}/></th><th><SortHead label="Hourly Zone" column="hourly_signal" sort={sort} onSort={sortBy}/></th><th><SortHead label="LTP" column="ltp" sort={sort} onSort={sortBy}/></th><th><SortHead label="Today %" column="today_change" sort={sort} onSort={sortBy}/></th><th><SortHead label="Close" column="close" sort={sort} onSort={sortBy}/></th><th><SortHead label="EMA Dist" column="ema_dist" sort={sort} onSort={sortBy}/></th><th><SortHead label="Green Move" column="trend" sort={sort} onSort={sortBy}/></th><th><SortHead label="Consol" column="consolidation" sort={sort} onSort={sortBy}/></th><th><SortHead label="Pullback" column="pullback" sort={sort} onSort={sortBy}/></th><th><SortHead label="Breakout Zone" column="breakout_dist" sort={sort} onSort={sortBy}/></th><th><SortHead label="Current Vol" column="current_vol" sort={sort} onSort={sortBy}/></th></tr></thead><tbody>{sortedRows.map((row) => { const liveTick = liveTicks[row.security_id]; const signal = liveHourlyBreakoutZoneSignal(hourlySignals[row.security_id], row, liveTick?.ltp); const live = liveAdjustedHourlyBreakout(row, liveTick); return <tr className="click-row" key={row.security_id} onClick={() => openRow(row)}><td><span className={row.qualifies ? "eligible" : "count"}>{row.status}</span></td><td className="window">{row.symbol}</td><td>{row.universe_name}</td><td><SetupSparkline row={row} onOpen={() => openRow(row)} /></td><td><HourlySignalCell signal={signal}/></td><td className={liveTick ? "positive" : ""}>{liveTick ? money(live.liveClose) : "—"}</td><td className={live.todayChange === undefined ? "" : live.todayChange >= 0 ? "positive" : "negative"}>{live.todayChange === undefined ? "—" : pct(live.todayChange)}</td><td className={liveTick ? "positive" : ""}>{money(live.liveClose)}</td><td className={live.emaDistance >= 0 ? "positive" : "negative"}>{pct(live.emaDistance)}</td><td className={row.trend_gain_pct >= 0 ? "positive" : "negative"}>{pct(row.trend_gain_pct)}</td><td>{row.consolidation_days}</td><td className={live.pullbackFromZone >= 0 ? "positive" : "negative"}>{pct(live.pullbackFromZone)}</td><td className={live.breakoutDistance >= 0 ? "positive" : "negative"}>{money(row.breakout_zone)} / {pct(live.breakoutDistance)}</td><td>{row.current_volume_ratio === undefined ? "—" : `${row.current_volume_ratio.toFixed(1)}x`}</td></tr>; })}</tbody></table></div> : <p className="panel-empty">{Object.values(hourlySignals).some((signal) => signal.state === "loading") ? "Checking hourly breakout zones..." : "No stocks are currently green and inside the hourly breakout zone."}</p>}</section></>}{selected && <div className="drawer"><div className="drawer-card chart-drawer"><button className="icon-button drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">{selected.status}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">{selected.reason}</p><HourlyBreakoutChartPanel selected={selected} filters={filters} /><div className="stats-grid compact-stats"><Stat label="Current Close" value={money(selected.current_close)} sub={selected.current_date}/><Stat label="Breakout Zone" value={money(selected.breakout_zone)} sub={pct(selected.breakout_distance_pct)}/><Stat label="50 EMA" value={money(selected.ema50)} sub={pct(selected.distance_from_ema_pct)}/><Stat label="Green Move" value={pct(selected.trend_gain_pct)} sub={`${filters.lookbackDays} sessions`}/></div><div className="stats-grid compact-stats"><Stat label="Consolidation" value={`${selected.consolidation_days} days`} /><Stat label="Pullback" value={pct(selected.pullback_from_zone_pct)} /><Stat label="Current Volume" value={selected.current_volume_ratio === undefined ? "—" : `${selected.current_volume_ratio.toFixed(1)}x`} /><Stat label="Hourly Zone" value={hourlySignals[selected.security_id]?.label ?? "Loading"} /></div><h3>Recent 120 daily rows</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>EMA50</th><th>Volume</th><th>Rel Vol</th></tr></thead><tbody>{selected.recent.map((row) => <tr key={row.trade_date}><td>{row.trade_date}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td>{money(row.close)}</td><td>{row.ema50 ? money(row.ema50) : "—"}</td><td>{row.volume.toLocaleString("en-IN")}</td><td>{row.volume_ratio ? `${row.volume_ratio.toFixed(1)}x` : "—"}</td></tr>)}</tbody></table></div></div></div>}</section>;
}

export default function Home() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<View>("Dashboard");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Security[]>([]);
  const [security, setSecurity] = useState<Security | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [analysis, setAnalysis] = useState<{ monthly: (Summary & { label: string })[]; quarterly: (Summary & { label: string })[]; rolling: (Summary & { label: string })[]; candles: { date: string; close: number }[] } | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
  const [seasonality, setSeasonality] = useState<SeasonalityResponse | null>(null);
  const [scanner, setScanner] = useState<ScannerResponse | null>(null);
  const [swing, setSwing] = useState<SwingResponse | null>(null);
  const [thirtyUp, setThirtyUp] = useState<ThirtyUpResponse | null>(null);
  const [thirtyUpUpdatedAt, setThirtyUpUpdatedAt] = useState<string | null>(null);
  const [earlyBreakout, setEarlyBreakout] = useState<EarlyBreakoutResponse | null>(null);
  const [earlyBreakoutUpdatedAt, setEarlyBreakoutUpdatedAt] = useState<string | null>(null);
  const [hourlyBreakout, setHourlyBreakout] = useState<HourlyBreakoutResponse | null>(null);
  const [hourlyBreakoutUpdatedAt, setHourlyBreakoutUpdatedAt] = useState<string | null>(null);
  const [momentumContraction, setMomentumContraction] = useState<MomentumContractionResponse | null>(null);
  const [momentumContractionUpdatedAt, setMomentumContractionUpdatedAt] = useState<string | null>(null);
  const [thirtyInThirty, setThirtyInThirty] = useState<ThirtyInThirtyResponse | null>(null);
  const [thirtyInThirtyUpdatedAt, setThirtyInThirtyUpdatedAt] = useState<string | null>(null);
  const [dryVolumeBreakout, setDryVolumeBreakout] = useState<DryVolumeBreakoutResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [tradingSettings, setTradingSettings] = useState<TradingSettings | null>(null);
  const [windowKey, setWindowKey] = useState("Jan-Mar");
  const [universe, setUniverse] = useState("ALL");
  const [sector, setSector] = useState("ALL");
  const [seasonalitySearch, setSeasonalitySearch] = useState("");
  const [sort, setSort] = useState<keyof SeasonalStatisticsRecord>("avg_return");
  const [scannerSort, setScannerSort] = useState<keyof ScannerResult | "current_return">("avg_return");
  const [selected, setSelected] = useState<SeasonalStatisticsRecord | ScannerResult | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [evaluationYear, setEvaluationYear] = useState(new Date().getFullYear());
  const [allocationPerStock, setAllocationPerStock] = useState(25000);
  const [swingFilters, setSwingFilters] = useState<SwingFilters>(defaultSwingFilters);
  const [selectedSwing, setSelectedSwing] = useState<SwingRow | null>(null);
  const [thirtyUpFilters, setThirtyUpFilters] = useState<ThirtyUpFilters>(defaultThirtyUpFilters);
  const [selectedThirtyUp, setSelectedThirtyUp] = useState<ThirtyUpRow | null>(null);
  const [earlyBreakoutFilters, setEarlyBreakoutFilters] = useState<EarlyBreakoutFilters>(defaultEarlyBreakoutFilters);
  const [selectedEarlyBreakout, setSelectedEarlyBreakout] = useState<EarlyBreakoutRow | null>(null);
  const [hourlyBreakoutFilters, setHourlyBreakoutFilters] = useState<HourlyBreakoutFilters>(defaultHourlyBreakoutFilters);
  const [selectedHourlyBreakout, setSelectedHourlyBreakout] = useState<HourlyBreakoutRow | null>(null);
  const [momentumContractionFilters, setMomentumContractionFilters] = useState<MomentumContractionFilters>(defaultMomentumContractionFilters);
  const [selectedMomentumContraction, setSelectedMomentumContraction] = useState<MomentumContractionRow | null>(null);
  const [thirtyInThirtyFilters, setThirtyInThirtyFilters] = useState<ThirtyInThirtyFilters>(defaultThirtyInThirtyFilters);
  const [selectedThirtyInThirty, setSelectedThirtyInThirty] = useState<ThirtyInThirtyRow | null>(null);
  const [dryVolumeBreakoutFilters, setDryVolumeBreakoutFilters] = useState<DryVolumeBreakoutFilters>(defaultDryVolumeBreakoutFilters);
  const [basketBacktestFilters, setBasketBacktestFilters] = useState<BasketBacktestFilters>(defaultBasketBacktestFilters);
  const [basketBacktest, setBasketBacktest] = useState<BasketBacktestResult | null>(null);
  const [liveFeedStatus, setLiveFeedStatus] = useState<LiveFeedStatus>("idle");
  const [liveFeedMessage, setLiveFeedMessage] = useState<string>();
  const updateLiveFeedStatus = useCallback((status: LiveFeedStatus, message?: string) => {
    setLiveFeedStatus(status);
    setLiveFeedMessage(message);
  }, []);
  const shortcuts = currentWindow();

  useEffect(() => { setIsAuthenticated(localStorage.getItem("jobpothe-auth") === "active"); setAuthReady(true); }, []);
  useEffect(() => { if (!isAuthenticated) return; fetch("/api/health").then((r) => r.json()).then((d) => setConfigured(d.configured)).catch(() => setConfigured(false)); }, [isAuthenticated]);
  useEffect(() => { if (!isAuthenticated) return; fetch("/api/trade-management/settings").then((r) => r.json()).then((d) => setTradingSettings(d.settings)).catch(() => {}); }, [isAuthenticated]);
  useEffect(() => { const saved = localStorage.getItem("seasonal-edge-theme"); if (saved === "light" || saved === "dark") setTheme(saved); }, []);
  useEffect(() => {
    const saved = localStorage.getItem("momentum-contraction-filters");
    if (!saved) return;
    try {
      setMomentumContractionFilters({ ...defaultMomentumContractionFilters, ...JSON.parse(saved) });
    } catch {}
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("seasonal-edge-theme", theme); }, [theme]);
  useEffect(() => { localStorage.setItem("momentum-contraction-filters", JSON.stringify(momentumContractionFilters)); }, [momentumContractionFilters]);
  useEffect(() => { if (!isAuthenticated) return; if ((view === "Dashboard" || view === "Portfolio") && configured && !portfolio) loadPortfolio(); if (view === "Data Status") loadDataStatus(); if (view === "Seasonality") loadSeasonality(); if (view === "Scanner") runScanner(); if (view === "Swing Screener") runSwingScreener(); if (view === "30%Up") runThirtyUpScreener(); if (view === "Early Breakout") runEarlyBreakoutScreener(); if (view === "Hourly Breakout") runHourlyBreakoutScreener(); if (view === "Momentum Tight") runMomentumContractionScreener(); if (view === "30 in 30") runThirtyInThirtyScreener(); if (view === "Dry Breakout" && !dryVolumeBreakout) runDryVolumeBreakoutScreener(); if (view === "Backtest" && !basketBacktest) runBasketBacktest(); }, [view, configured, isAuthenticated]);
  useEffect(() => {
    if (!isAuthenticated || view !== "Data Status") return;
    let fallbackId: number | undefined;
    const source = new EventSource("/api/data/status/live");
    source.addEventListener("snapshot", (event) => {
      setDataStatus(JSON.parse((event as MessageEvent).data));
    });
    source.addEventListener("job", (event) => {
      const job = JSON.parse((event as MessageEvent).data) as DataDownloadJob;
      setDataStatus((current) => current ? { ...current, latest_job: job } : current);
      if (!["queued", "running"].includes(job.status)) void loadDataStatus();
    });
    source.addEventListener("open", () => {
      if (fallbackId !== undefined) {
        window.clearInterval(fallbackId);
        fallbackId = undefined;
      }
    });
    source.addEventListener("error", () => {
      if (fallbackId === undefined) {
        fallbackId = window.setInterval(() => loadDataStatus(), 3000);
      }
    });
    return () => {
      source.close();
      if (fallbackId !== undefined) window.clearInterval(fallbackId);
    };
  }, [view, isAuthenticated]);

  const latest = useMemo(() => analysis?.candles.at(-1), [analysis]);
  const sortedSeasonality = useMemo(() => [...(seasonality?.statistics ?? [])].sort((a, b) => typeof a[sort] === "number" ? Number(b[sort]) - Number(a[sort]) : String(a[sort]).localeCompare(String(b[sort]))), [seasonality, sort]);
  const sortedScannerResults = useMemo(() => [...(scanner?.results ?? [])].sort((a, b) => {
    if (scannerSort === "current_return") return (b.currentSeason.current_return_pct ?? -Infinity) - (a.currentSeason.current_return_pct ?? -Infinity);
    return typeof a[scannerSort] === "number" ? Number(b[scannerSort]) - Number(a[scannerSort]) : String(a[scannerSort]).localeCompare(String(b[scannerSort]));
  }), [scanner, scannerSort]);
  const detailObservations = seasonality?.observations ?? [];

  async function loadDataStatus() { try { const r = await fetch("/api/data/status"); const d = await r.json(); if (!r.ok) throw new Error(d.error); setDataStatus(d); } catch (e) { setError(e instanceof Error ? e.message : "Data status unavailable"); } }
  async function refreshUniverse(u?: UniverseName) { setLoading(true); try { const r = await fetch("/api/data/refresh-universe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ universe: u, forceUniverse: true }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); await loadDataStatus(); } catch (e) { setError(e instanceof Error ? e.message : "Universe refresh failed"); } finally { setLoading(false); } }
  async function retryFailures() { setLoading(true); try { await fetch("/api/data/failures", { method: "POST" }); await loadDataStatus(); } finally { setLoading(false); } }
  async function loadSeasonality(row?: SeasonalStatisticsRecord | ScannerResult) { const params = new URLSearchParams({ window: windowKey, universe, sector, search: seasonalitySearch }); if (row) { params.set("securityId", row.security_id); if ("currentSeason" in row) params.set("beforeYear", String(evaluationYear)); } const r = await fetch(`/api/seasonality?${params}`); const d = await r.json(); if (!r.ok) throw new Error(d.error); setSeasonality(d); if (row) setSelected(row); }
  async function rebuildSeasonality() { setLoading(true); try { const r = await fetch("/api/seasonality/rebuild", { method: "POST" }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Seasonality rebuild failed"); await loadSeasonality(); } catch (e) { setError(e instanceof Error ? e.message : "Seasonality rebuild failed"); } finally { setLoading(false); } }
  async function runScanner() { setLoading(true); try { const r = await fetch("/api/scanner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ window: windowKey, universe, sector, filters, evaluationYear, allocationPerStock }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setScanner(d); } catch (e) { setError(e instanceof Error ? e.message : "Scanner unavailable"); } finally { setLoading(false); } }
  async function runSwingScreener() { setLoading(true); try { const r = await fetch("/api/swing-screener/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: swingFilters }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setSwing(d); } catch (e) { setError(e instanceof Error ? e.message : "Swing screener unavailable"); } finally { setLoading(false); } }
  async function runThirtyUpScreener(options: ThirtyUpRunOptions = {}) { if (!options.silent) setLoading(true); try { const r = await fetch("/api/thirty-up-screener/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: thirtyUpFilters }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setThirtyUp(d); setThirtyUpUpdatedAt(new Date().toISOString()); if (!options.silent) setError(""); } catch (e) { if (!options.silent) setError(e instanceof Error ? e.message : "30%Up screener unavailable"); } finally { if (!options.silent) setLoading(false); } }
  async function runEarlyBreakoutScreener(options: ThirtyUpRunOptions = {}) { if (!options.silent) setLoading(true); try { const r = await fetch("/api/early-breakout-screener/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: earlyBreakoutFilters }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setEarlyBreakout(d); setEarlyBreakoutUpdatedAt(new Date().toISOString()); if (!options.silent) setError(""); } catch (e) { if (!options.silent) setError(e instanceof Error ? e.message : "Early Breakout screener unavailable"); } finally { if (!options.silent) setLoading(false); } }
  async function runHourlyBreakoutScreener(options: ThirtyUpRunOptions = {}) { if (!options.silent) setLoading(true); try { const r = await fetch("/api/hourly-breakout-screener/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: hourlyBreakoutFilters }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setHourlyBreakout(d); setHourlyBreakoutUpdatedAt(new Date().toISOString()); if (!options.silent) setError(""); } catch (e) { if (!options.silent) setError(e instanceof Error ? e.message : "Hourly Breakout screener unavailable"); } finally { if (!options.silent) setLoading(false); } }
  async function runMomentumContractionScreener(options: ThirtyUpRunOptions = {}) { if (!options.silent) setLoading(true); try { const r = await fetch("/api/momentum-contraction-screener/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: momentumContractionFilters }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setMomentumContraction(d); setMomentumContractionUpdatedAt(new Date().toISOString()); if (!options.silent) setError(""); } catch (e) { if (!options.silent) setError(e instanceof Error ? e.message : "Momentum Tight scanner unavailable"); } finally { if (!options.silent) setLoading(false); } }
  async function runThirtyInThirtyScreener(options: ThirtyUpRunOptions = {}) { if (!options.silent) setLoading(true); try { const r = await fetch("/api/thirty-in-thirty-screener/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: thirtyInThirtyFilters }) }); const d = await readJsonResponse<ThirtyInThirtyResponse>(r, "30 in 30 screener unavailable"); setThirtyInThirty(d); setThirtyInThirtyUpdatedAt(new Date().toISOString()); if (!options.silent) setError(""); } catch (e) { if (!options.silent) setError(e instanceof Error ? e.message : "30 in 30 screener unavailable"); } finally { if (!options.silent) setLoading(false); } }
  async function runDryVolumeBreakoutScreener() { setLoading(true); try { const r = await fetch("/api/dry-volume-breakout-screener/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: dryVolumeBreakoutFilters }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setDryVolumeBreakout(d); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Dry Breakout screener unavailable"); } finally { setLoading(false); } }
  async function runBasketBacktest() { setLoading(true); try { const r = await fetch("/api/basket-backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: basketBacktestFilters }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setBasketBacktest(d); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Basket backtest unavailable"); } finally { setLoading(false); } }
  async function loadPortfolio() { setLoading(true); setError(""); try { const r = await fetch("/api/portfolio"); const d = await r.json(); if (!r.ok) throw new Error(d.error); setPortfolio(d); if (d.tradeManagement?.settings) setTradingSettings(d.tradeManagement.settings); } catch (e) { setError(e instanceof Error ? e.message : "Portfolio unavailable"); } finally { setLoading(false); } }
  async function recordTradeEvent(tradeId: string, event: Partial<TradeEvent> & { eventType: string }) { try { const r = await fetch(`/api/trade-management/trades/${tradeId}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); await loadPortfolio(); } catch (e) { setError(e instanceof Error ? e.message : "Could not record trade event"); } }
  async function updateManagedTrade(tradeId: string, patch: Partial<ManagedTradeView>) { try { const r = await fetch(`/api/trade-management/trades/${tradeId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); await loadPortfolio(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update managed trade"); } }
  async function deleteManagedTrade(tradeId: string) { try { const r = await fetch(`/api/trade-management/trades/${tradeId}`, { method: "DELETE" }); const d = await r.json(); if (!r.ok) throw new Error(d.error); await loadPortfolio(); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete managed trade"); } }
  async function runSearch() { if (query.trim().length < 2) return setError("Enter at least two characters."); setLoading(true); try { const r = await fetch(`/api/securities?q=${encodeURIComponent(query.trim())}`); const d = await r.json(); if (!r.ok) throw new Error(d.error); setResults(d); } catch (e) { setError(e instanceof Error ? e.message : "Search unavailable"); } finally { setLoading(false); } }
  async function analyze(refresh = false) { if (!security) return; setLoading(true); try { const r = await fetch("/api/analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ security, refresh }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setAnalysis(d); } catch (e) { setError(e instanceof Error ? e.message : "Unable to analyze stock"); } finally { setLoading(false); } }
  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginUser === "projectwealth" && loginPassword === "I@tradeswing") {
      localStorage.setItem("jobpothe-auth", "active");
      setIsAuthenticated(true);
      setLoginError("");
      setLoginPassword("");
      return;
    }
    setLoginError("Invalid username or password.");
  }
  function logout() {
    localStorage.removeItem("jobpothe-auth");
    setIsAuthenticated(false);
    setNavOpen(false);
    setConfigured(null);
  }

  const seasons = seasonality?.windows ?? Array.from({ length: 12 }, (_, i) => ({ key: ["Jan-Mar", "Feb-Apr", "Mar-May", "Apr-Jun", "May-Jul", "Jun-Aug", "Jul-Sep", "Aug-Oct", "Sep-Nov", "Oct-Dec", "Nov-Jan", "Dec-Feb"][i], label: ["Jan → Mar", "Feb → Apr", "Mar → May", "Apr → Jun", "May → Jul", "Jun → Aug", "Jul → Sep", "Aug → Oct", "Sep → Nov", "Oct → Dec", "Nov → Jan", "Dec → Feb"][i], startMonth: i, endMonth: (i + 2) % 12 }));

  if (!authReady) return <main className="login-shell" />;
  if (!isAuthenticated) return <main className="login-shell"><section className="login-card"><div className="brand login-brand"><BrandLogo /><span>JOB<span>POTHE</span></span></div><p className="eyebrow">Rules-based research workspace</p><h1>Sign in</h1><form onSubmit={login} className="login-form"><label>Username<input className="plain-input" autoComplete="username" value={loginUser} onChange={(event) => setLoginUser(event.target.value)} /></label><label>Password<input className="plain-input" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></label>{loginError && <div className="error">{loginError}</div>}<button className="primary" type="submit">Open Workspace</button></form></section></main>;

  return <main><button className="mobile-menu-button icon-button" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={18} /></button>{navOpen && <button className="menu-backdrop" onClick={() => setNavOpen(false)} aria-label="Close menu" />}<aside className={navOpen ? "open" : ""}><div className="side-topbar"><div className="brand"><BrandLogo compact /><span>JOB<span>POTHE</span></span></div><button className="icon-button side-close" onClick={() => setNavOpen(false)} aria-label="Close menu"><X size={18} /></button></div><div className="workspace">WORKSPACE <b>India · Equity</b></div><nav>{nav.map(({ name, icon: Icon }) => <button onClick={() => { setView(name); setNavOpen(false); }} className={view === name ? "active" : ""} key={name}><Icon size={17} /><span>{name}</span></button>)}</nav><div className="side-bottom"><div className="data-status"><span className={configured ? "ready" : "pending"} /><div><b>{configured ? "Dhan connected" : "Dhan setup needed"}</b><small>{configured ? "Secure server connection" : "Credentials stay on server"}</small></div></div><LiveFeedStatusIndicator status={liveFeedStatus} message={liveFeedMessage} view={view} dataJob={dataStatus?.latest_job} /><button className="help">Documentation <ArrowUpRight size={14} /></button></div></aside><div className="content"><header><div className="header-brand logo-only"><BrandLogo /></div><div className="header-actions"><button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button" disabled={!security || loading} onClick={() => analyze(true)}><RefreshCw size={17} className={loading ? "spin" : ""} /></button><button className="icon-button" onClick={logout} aria-label="Sign out"><LogOut size={17} /></button><button className="user">BA</button></div></header>{error && <div className="error">{error}</div>}
    {view === "Dashboard" && <DashboardView portfolio={portfolio} loading={loading} onRefresh={loadPortfolio} />}
    {view === "Portfolio" && <PortfolioView portfolio={portfolio} loading={loading} onRefresh={loadPortfolio} setLiveFeedStatus={updateLiveFeedStatus} />}
    {view === "Data Status" && <DataStatusView status={dataStatus} loading={loading || isActiveDataJob(dataStatus?.latest_job)} onRefresh={loadDataStatus} onRefreshUniverse={refreshUniverse} onRetryFailures={retryFailures} />}
    {view === "Seasonality" && <section className="research-page"><div className="notice"><AlertTriangle size={18} /><span>Universe uses current index constituents. Historical results may be affected by survivorship bias.</span></div><div className="data-toolbar"><div><p className="eyebrow">Market-level research</p><h2>Rolling 3-month seasonality</h2><small>Entry uses first available monthly close; exit uses last available ending-month close.</small></div><button className="primary" onClick={rebuildSeasonality} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />Rebuild Seasonality Statistics</button></div><Controls windows={seasons} windowKey={windowKey} setWindowKey={setWindowKey} universe={universe} setUniverse={setUniverse} sector={sector} setSector={setSector} sectors={seasonality?.sectors ?? ["Unknown"]} search={seasonalitySearch} setSearch={setSeasonalitySearch} /><div className="toolbar-actions"><button className="secondary" onClick={() => loadSeasonality()} disabled={loading}>Apply</button><span className="count">{seasonality?.statistics.length ?? 0} rows · {seasonality?.missingSectorCount ?? 0} stocks missing sector</span></div>{seasonality?.latestBuild && <div className="stats-grid"><Stat label="Observations" value={`${seasonality.latestBuild.observations_generated}`} /><Stat label="Statistics" value={`${seasonality.latestBuild.statistics_generated}`} /><Stat label="Excluded" value={`${seasonality.latestBuild.excluded_observations}`} /><Stat label="Last rebuild" value={seasonality.latestBuild.finished_at.slice(0, 10)} /></div>}<section className="panel"><SeasonalityTable rows={sortedSeasonality} sort={sort} setSort={setSort} onSelect={(row) => loadSeasonality(row)} /></section>{selected && <DetailDrawer row={selected} observations={detailObservations} onClose={() => setSelected(null)} />}</section>}
    {view === "Scanner" && <section className="research-page"><div className="data-toolbar"><div><p className="eyebrow">3-Month Seasonal Scanner</p><h2>Eligibility filters</h2><small>Statistical research only. No trade recommendation or basket construction.</small></div><div className="shortcut-card"><button className="secondary compact" onClick={() => setWindowKey(shortcuts.current)}>Current: {shortcuts.current}</button><button className="secondary compact" onClick={() => setWindowKey(shortcuts.next)}>Next: {shortcuts.next}</button></div></div><Controls windows={seasons} windowKey={windowKey} setWindowKey={setWindowKey} universe={universe} setUniverse={setUniverse} sector={sector} setSector={setSector} sectors={seasonality?.sectors ?? scanner?.results.map((r) => r.sector) ?? ["Unknown"]} /><div className="control-grid"><label>Evaluation Year<input className="plain-input" type="number" value={evaluationYear} onChange={(e) => setEvaluationYear(Number(e.target.value))} /></label><label>Allocation per Stock<input className="plain-input" type="number" value={allocationPerStock} onChange={(e) => setAllocationPerStock(Number(e.target.value))} /></label></div><div className="filter-grid">{(Object.keys(filters) as FilterKey[]).map((key) => <label key={key} className="filter-row"><input type="checkbox" checked={filters[key].enabled} onChange={(e) => setFilters({ ...filters, [key]: { ...filters[key], enabled: e.target.checked } })} /><span>{filterLabels[key]}</span><input type="number" value={filters[key].value} onChange={(e) => setFilters({ ...filters, [key]: { ...filters[key], value: Number(e.target.value) } })} /></label>)}</div><div className="toolbar-actions"><button className="primary" onClick={runScanner} disabled={loading}><SlidersHorizontal size={15} />Run Scanner</button><button className="secondary" onClick={() => setFilters(defaultFilters)}>Reset Defaults</button><button className="secondary" onClick={rebuildSeasonality} disabled={loading}>Rebuild Statistics</button></div>{scanner && <>{scanner.summary.minHistoricalObservationRequired > scanner.summary.maxHistoricalObservationCount && <div className="notice"><AlertTriangle size={18}/><span>No stocks can pass the current Minimum N filter for this evaluation year/window. Evaluated {scanner.summary.evaluatedStocks} stocks, but the maximum pre-{evaluationYear} historical N is {scanner.summary.maxHistoricalObservationCount}; current filter requires N &gt;= {scanner.summary.minHistoricalObservationRequired}. Lower Minimum N or use a later evaluation year.</span></div>}<div className="section-label"><TrendingDown size={15}/><span>Walk-forward performance</span><small>Eligibility uses only observations before {evaluationYear}</small></div><div className="stats-grid"><Stat label="Qualified Stocks" value={`${scanner.summary.qualifiedStocks}`} sub={`Valid ${scanner.summary.validCurrentSeasonData} · Missing ${scanner.summary.missingCurrentSeasonData}`} /><Stat label="Winners" value={`${scanner.summary.winners}`} sub={`Losers ${scanner.summary.losers} · Flat ${scanner.summary.flats}`} /><Stat label="Current Win Rate" value={`${scanner.summary.currentWinRate.toFixed(1)}%`} /><Stat label="Equal-Weight Return" value={pct(scanner.summary.equalWeightReturn)} /></div><div className="stats-grid"><Stat label="Initial Investment" value={rupees(scanner.summary.initialInvestment)} sub={`${rupees(allocationPerStock)} per stock`} /><Stat label="Current Value" value={rupees(scanner.summary.currentPortfolioValue)} /><Stat label="Current P&L" value={rupees(scanner.summary.currentPnl)} sub={pct(scanner.summary.equalWeightReturn)} /><Stat label="Best / Worst Current" value={`${pct(scanner.summary.bestCurrentReturn)} / ${pct(scanner.summary.worstCurrentReturn)}`} /></div><div className="stats-grid"><Stat label="Historical Avg" value={pct(scanner.summary.historicalAverage)} sub="Eligible pre-evaluation stats" /><Stat label="Historical Median" value={pct(scanner.summary.historicalMedian)} sub="Eligible pre-evaluation stats" /><Stat label="Top 1 Contribution" value={`${scanner.summary.top1Contribution.toFixed(2)} pts`} /><Stat label="Top 3 Contribution" value={`${scanner.summary.top3Contribution.toFixed(2)} pts`} /></div><section className="panel"><div className="panel-head"><div><p className="eyebrow">Return distribution</p><h2>Current-season eligible basket</h2></div></div><div className="metric-list job-list"><span>&gt; +20% <b>{scanner.summary.distribution.gt20}</b></span><span>+10% to +20% <b>{scanner.summary.distribution.plus10To20}</b></span><span>0% to +10% <b>{scanner.summary.distribution.zeroTo10}</b></span><span>-10% to 0% <b>{scanner.summary.distribution.minus10To0}</b></span><span>&lt; -10% <b>{scanner.summary.distribution.ltMinus10}</b></span></div></section><section className="panel"><div className="panel-head"><div><p className="eyebrow">Sector summary</p><h2>Eligible stock sectors</h2></div></div><div className="source-list">{Object.entries(scanner.sectorSummary).map(([s, count]) => <span key={s}><b>{s}</b>{count} eligible</span>)}</div></section><section className="panel">{scanner.results.length ? <div className="table-wrap"><table><thead><tr><th>Status</th><th><button className="sort-head" onClick={() => setScannerSort("symbol")}>Symbol</button></th><th>Company</th><th>Sector</th><th>Universe</th><th><button className="sort-head" onClick={() => setScannerSort("avg_return")}>Average</button></th><th><button className="sort-head" onClick={() => setScannerSort("median_return")}>Median</button></th><th><button className="sort-head" onClick={() => setScannerSort("current_return")}>Current Season</button></th><th><button className="sort-head" onClick={() => setScannerSort("historical_win_rate")}>Hist Win Rate</button></th><th><button className="sort-head" onClick={() => setScannerSort("best_return")}>Best</button></th><th><button className="sort-head" onClick={() => setScannerSort("worst_return")}>Worst</button></th><th><button className="sort-head" onClick={() => setScannerSort("mae_p75")}>MAE P75</button></th><th>Worst MAE</th><th><button className="sort-head" onClick={() => setScannerSort("mfe_p50")}>MFE P50</button></th><th><button className="sort-head" onClick={() => setScannerSort("mfe_p75")}>MFE P75</button></th><th><button className="sort-head" onClick={() => setScannerSort("observation_count")}>N</button></th></tr></thead><tbody>{sortedScannerResults.map((r) => <tr key={`${r.security_id}-${r.window_key}`} className="click-row" onClick={() => loadSeasonality(r)}><td><span className="eligible">ELIGIBLE</span></td><td className="window">{r.symbol}</td><td>{r.company_name}</td><td>{r.sector}</td><td>{r.universe_name}</td><td className={r.avg_return >= 0 ? "positive" : "negative"}>{pct(r.avg_return)}</td><td className={r.median_return >= 0 ? "positive" : "negative"}>{pct(r.median_return)}</td><td className={r.currentSeason.current_return_pct === undefined ? "" : r.currentSeason.current_return_pct >= 0 ? "positive" : "negative"}>{r.currentSeason.current_return_pct === undefined ? "NO DATA" : pct(r.currentSeason.current_return_pct)}<small className="sample-warning">{r.currentSeason.status}</small></td><td>{r.historical_win_rate.toFixed(1)}%</td><td className="positive">{pct(r.best_return)}</td><td className="negative">{pct(r.worst_return)}</td><td className="negative">{pct(r.mae_p75)}</td><td className="negative">{pct(r.worst_mae)}</td><td className="positive">{pct(r.mfe_p50)}</td><td className="positive">{pct(r.mfe_p75)}</td><td>{r.observation_count}</td></tr>)}</tbody></table></div> : <p className="panel-empty">No stocks currently meet the selected criteria.</p>}</section></>}{selected && <DetailDrawer row={selected} observations={detailObservations} onClose={() => setSelected(null)} />}</section>}
    {view === "Swing Screener" && <SwingScreenerView swing={swing} filters={swingFilters} setFilters={setSwingFilters} loading={loading} onRun={runSwingScreener} onReset={() => setSwingFilters(defaultSwingFilters)} selected={selectedSwing} setSelected={setSelectedSwing} />}
    {view === "30%Up" && <ThirtyUpScreenerView data={thirtyUp} filters={thirtyUpFilters} setFilters={setThirtyUpFilters} loading={loading} onRun={runThirtyUpScreener} onReset={() => setThirtyUpFilters(defaultThirtyUpFilters)} selected={selectedThirtyUp} setSelected={setSelectedThirtyUp} setLiveFeedStatus={updateLiveFeedStatus} updatedAt={thirtyUpUpdatedAt} onTradeCreated={loadPortfolio} />}
    {view === "Early Breakout" && <EarlyBreakoutScreenerView data={earlyBreakout} filters={earlyBreakoutFilters} setFilters={setEarlyBreakoutFilters} loading={loading} onRun={runEarlyBreakoutScreener} onReset={() => setEarlyBreakoutFilters(defaultEarlyBreakoutFilters)} selected={selectedEarlyBreakout} setSelected={setSelectedEarlyBreakout} setLiveFeedStatus={updateLiveFeedStatus} updatedAt={earlyBreakoutUpdatedAt} onTradeCreated={loadPortfolio} />}
    {view === "Hourly Breakout" && <HourlyBreakoutScreenerView data={hourlyBreakout} filters={hourlyBreakoutFilters} setFilters={setHourlyBreakoutFilters} loading={loading} onRun={runHourlyBreakoutScreener} onReset={() => setHourlyBreakoutFilters(defaultHourlyBreakoutFilters)} selected={selectedHourlyBreakout} setSelected={setSelectedHourlyBreakout} setLiveFeedStatus={updateLiveFeedStatus} updatedAt={hourlyBreakoutUpdatedAt} />}
    {view === "Momentum Tight" && <MomentumContractionScreenerView data={momentumContraction} filters={momentumContractionFilters} setFilters={setMomentumContractionFilters} loading={loading} onRun={runMomentumContractionScreener} onReset={() => setMomentumContractionFilters(defaultMomentumContractionFilters)} selected={selectedMomentumContraction} setSelected={setSelectedMomentumContraction} setLiveFeedStatus={updateLiveFeedStatus} updatedAt={momentumContractionUpdatedAt} />}
    {view === "30 in 30" && <ThirtyInThirtyScreenerView data={thirtyInThirty} filters={thirtyInThirtyFilters} setFilters={setThirtyInThirtyFilters} loading={loading} onRun={runThirtyInThirtyScreener} onReset={() => setThirtyInThirtyFilters(defaultThirtyInThirtyFilters)} selected={selectedThirtyInThirty} setSelected={setSelectedThirtyInThirty} setLiveFeedStatus={updateLiveFeedStatus} updatedAt={thirtyInThirtyUpdatedAt} settings={tradingSettings} />}
    {view === "Dry Breakout" && <DryVolumeBreakoutScreenerView data={dryVolumeBreakout} filters={dryVolumeBreakoutFilters} loading={loading} onRun={runDryVolumeBreakoutScreener} onTradeCreated={loadPortfolio} setLiveFeedStatus={updateLiveFeedStatus} />}
    {view === "Backtest" && <BasketBacktestView filters={basketBacktestFilters} setFilters={setBasketBacktestFilters} data={basketBacktest} loading={loading} onRun={runBasketBacktest} />}
    {view === "Stock Search" && <><section className="search-card"><div className="search-copy"><p className="eyebrow">01 / Research a security</p><h2>Find an Indian equity</h2><p>Search the Dhan security master by symbol or company name.</p></div><div className="search-area"><form onSubmit={(e) => { e.preventDefault(); runSearch(); }}><div className="search-row"><div className="search-input"><Search size={18} /><input placeholder="Search RELIANCE, TCS, INFY…" value={query} onChange={(e) => setQuery(e.target.value)} /><kbd>Enter</kbd></div><button className="primary search-button" type="submit" disabled={loading}>{loading ? "Searching…" : "Search"}</button></div></form>{results.length > 0 && <div className="results">{results.map((s) => <button key={`${s.securityId}-${s.segment}`} onClick={() => { setSecurity(s); setQuery(""); setResults([]); setAnalysis(null); }}><div><b>{s.symbol}</b><span>{s.name}</span></div><small>{s.exchange} · {s.securityId}</small></button>)}</div>}<div className="search-hint"><Database size={14} /><span>Security IDs are resolved from Dhan’s master—not ticker text alone.</span></div></div></section>{!configured && <section className="setup"><div className="setup-icon"><ShieldCheck size={25} /></div><div><p className="eyebrow">Secure data connection</p><h2>Connect your Dhan account to begin</h2><p>Market data and calculated statistics remain empty until server-side Dhan credentials are configured.</p></div><code>DHAN_CLIENT_ID= · DHAN_ACCESS_TOKEN=</code></section>}{!security && <section className="empty"><div className="empty-art"><CalendarDays size={30} /></div><p className="eyebrow">Awaiting a selection</p><h2>Start with a security search</h2><p>Select an equity to load its daily OHLCV history and derive seasonality statistics.</p></section>}{security && <><section className="stock-header"><div><div className="ticker-row"><span className="ticker">{security.symbol}</span><span className="exchange">{security.exchange}</span></div><h2>{security.name}</h2><p>Security ID {security.securityId} · Daily OHLCV · {analysis ? `${analysis.candles.length} trading sessions` : "Not loaded"}</p></div><button className="primary" onClick={() => analyze()} disabled={loading || !configured}>{loading ? <><RefreshCw size={16} className="spin" /> Calculating…</> : <><BarChart3 size={16} /> Load seasonality</>}</button></section>{analysis && <><section className="stats-grid"><Stat label="Current close" value={latest ? money(latest.close) : "—"} sub={latest?.date} /><Stat label="History available" value={`${new Set(analysis.candles.map((c) => c.date.slice(0, 4))).size} years`} sub="Complete years used" /><Stat label="Data through" value={latest?.date || "—"} sub="Cached locally" /><Stat label="Method" value="Daily OHLCV" sub="Adjusted data must be verified" /></section></>}</>}</>}
    {view === "Settings" && <TradingSettingsView settings={tradingSettings} onSaved={setTradingSettings} />}
    {!["Dashboard", "Portfolio", "Stock Search", "Data Status", "Seasonality", "Scanner", "Swing Screener", "30%Up", "Early Breakout", "Hourly Breakout", "Momentum Tight", "30 in 30", "Dry Breakout", "Backtest", "Settings"].includes(view) && <section className="empty"><div className="empty-art"><Activity size={30} /></div><p className="eyebrow">{view}</p><h2>{view} workspace</h2><p>{`${view} remains intentionally deferred for a later phase.`}</p></section>}
  </div></main>;
}









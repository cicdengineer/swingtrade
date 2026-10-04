export type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };
export type Security = { securityId: string; symbol: string; name: string; exchange: string; segment: string; instrument: string; isin?: string };
export type Observation = { label: string; year: number; returnPct: number; maePct: number };
export type Summary = { average: number; median: number; winRate: number; best: number; worst: number; deviation: number; observations: number; maeAverage: number; maeMedian: number; maeWorst: number; maePercentiles: { p25: number; p50: number; p75: number; p90: number }; rows: Observation[] };

export type UniverseName = "MIDCAP" | "SMALLCAP";

export type InstrumentRecord = {
  security_id: string;
  symbol: string;
  trading_symbol: string;
  company_name: string;
  isin: string;
  exchange: string;
  exchange_segment: string;
  segment: string;
  instrument: string;
  status: "ACTIVE" | "UNMAPPED" | "INACTIVE";
  price_adjustment_status: "UNKNOWN" | "UNADJUSTED" | "ADJUSTED" | "VERIFIED";
  data_start_date?: string;
  data_end_date?: string;
  last_updated_at?: string;
  number_of_sessions?: number;
};

export type UniverseMemberRecord = {
  universe_name: UniverseName;
  symbol: string;
  company_name: string;
  security_id: string;
  isin: string;
  exchange: string;
  segment: string;
  instrument: string;
  universe_source: "current_index_constituents";
  is_current_constituent: boolean;
  effective_from?: string;
  effective_to?: string;
  source: string;
  last_verified_at: string;
};

export type DailyPriceRecord = {
  id: string;
  security_id: string;
  symbol: string;
  isin: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  exchange_segment: string;
  instrument: string;
  data_source: "DHAN";
  created_at: string;
  updated_at: string;
};

export type DataDownloadJobRecord = {
  id: string;
  universe_name?: UniverseName;
  security_id?: string;
  symbol?: string;
  status: "queued" | "running" | "completed" | "completed_with_failures" | "failed";
  total: number;
  completed: number;
  successful: number;
  failed: number;
  remaining: number;
  current_stock?: string;
  current_status?: string;
  progress: number;
  started_at: string;
  finished_at?: string;
  last_successful_update?: string;
  data_through_date?: string;
  errors: string[];
};

export type DownloadFailureRecord = {
  symbol: string;
  security_id: string;
  error_code: string;
  error_message: string;
  attempt_count: number;
  last_attempt: string;
  status: "open" | "resolved";
};

export type DataQualityIssueRecord = {
  id: string;
  symbol: string;
  security_id: string;
  trade_date?: string;
  issue_code: string;
  issue_message: string;
  severity: "warning" | "error";
  created_at: string;
};

export type SeasonalWindow = {
  key: string;
  label: string;
  startMonth: number;
  endMonth: number;
};

export type SeasonalObservationRecord = {
  id: string;
  security_id: string;
  symbol: string;
  company_name: string;
  sector: string;
  universe_name: UniverseName;
  window_key: string;
  window_start_month: number;
  window_end_month: number;
  occurrence_year: number;
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  return_pct: number;
  mae_pct: number;
  mfe_pct: number;
};

export type SeasonalStatisticsRecord = {
  id: string;
  security_id: string;
  symbol: string;
  company_name: string;
  sector: string;
  universe_name: UniverseName;
  window_key: string;
  window_start_month: number;
  window_end_month: number;
  avg_return: number;
  median_return: number;
  historical_win_rate: number;
  best_return: number;
  worst_return: number;
  std_dev: number;
  observation_count: number;
  avg_median_gap: number;
  positive_years: number;
  negative_years: number;
  mae_p25: number;
  mae_p50: number;
  mae_p75: number;
  mae_p90: number;
  worst_mae: number;
  mfe_p25: number;
  mfe_p50: number;
  mfe_p75: number;
  mfe_p90: number;
  best_mfe: number;
  positive_return_concentration: number;
  data_start_date: string;
  data_end_date: string;
};

export type SeasonalExclusionRecord = {
  id: string;
  security_id: string;
  symbol: string;
  window_key: string;
  occurrence_year: number;
  issue: string;
};

export type SeasonalityBuildRecord = {
  id: string;
  status: "completed" | "failed";
  started_at: string;
  finished_at: string;
  stocks_analyzed: number;
  observations_generated: number;
  statistics_generated: number;
  stocks_missing_sector: number;
  excluded_observations: number;
  error?: string;
};

export type TradeManagementTimeframe = "Daily" | "Hourly";
export type TradeTrailMethod = "10 EMA" | "20 EMA" | "Manual";
export type TradeExitConfirmationRule = "Close below EMA" | "Intraday break" | "2 closes below EMA";
export type ManagedTradeStatus = "ACTIVE" | "RECONCILIATION_REQUIRED" | "CLOSED";
export type TradeTrancheStatus = "OPEN" | "CLOSED";
export type TradeEventType =
  | "ENTRY"
  | "STOP_DEFINED"
  | "PARTIAL_RECOMMENDED"
  | "PARTIAL_EXECUTED"
  | "STOP_BE_RECOMMENDED"
  | "STOP_UPDATED"
  | "RUNNER_STARTED"
  | "TRAIL_CHANGED"
  | "EXIT_WARNING"
  | "EXIT"
  | "BROKER_SYNC";

export type TradingSettingsRecord = {
  id: "default";
  totalCapital: number;
  riskPercent: number;
  defaultStopSource: "Setup Candle Low" | "Manual";
  defaultManagementTimeframe: TradeManagementTimeframe;
  initialManagementDays: number;
  partialStartDay: number;
  partialEndDay: number;
  partialPercent: number;
  partialMinR: number;
  defaultTrailMA: TradeTrailMethod;
  moveStopToBreakevenAfterPartial: boolean;
  exitConfirmationRule: TradeExitConfirmationRule;
  portfolioRiskNormalPct: number;
  portfolioRiskElevatedPct: number;
  portfolioRiskHighPct: number;
  created_at: string;
  updated_at: string;
};

export type ManagedTradeRecord = {
  id: string;
  broker: "DHAN" | "MANUAL";
  symbol: string;
  companyName?: string;
  exchange: string;
  instrumentId?: string;
  isin?: string;
  strategy: string;
  status: ManagedTradeStatus;
  entryDate: string;
  averageEntry: number;
  initialStop: number;
  plannedStop: number;
  initialRiskPerShare: number;
  initialRiskAmount: number;
  trailMethod: TradeTrailMethod;
  managementTimeframe: TradeManagementTimeframe;
  partialTaken: boolean;
  protectedStopRecorded: boolean;
  source: "30UP" | "BROKER_HOLDING" | "MANUAL";
  createdAt: string;
  updatedAt: string;
};

export type TradeTrancheRecord = {
  id: string;
  managedTradeId: string;
  brokerOrderId?: string;
  brokerTradeId?: string;
  entryDate: string;
  entryPrice: number;
  quantity: number;
  initialStop: number;
  initialRisk: number;
  remainingQuantity: number;
  realizedQuantity: number;
  realizedPnl: number;
  status: TradeTrancheStatus;
};

export type TradeEventRecord = {
  id: string;
  managedTradeId: string;
  eventType: TradeEventType;
  timestamp: string;
  price?: number;
  quantity?: number;
  notes?: string;
  source: "SYSTEM" | "USER" | "BROKER";
};

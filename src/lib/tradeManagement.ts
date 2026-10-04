import type {
  TradeExitConfirmationRule,
  TradeManagementTimeframe,
  TradeTrailMethod,
  TradingSettingsRecord,
} from "./types";

export type PositionSizingInput = {
  totalCapital: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
};

export type PositionSizingResult = {
  valid: boolean;
  errors: string[];
  riskAmount: number;
  riskPerShare: number;
  quantity: number;
  positionValue: number;
  capitalUsagePercent: number;
  stopLossPercent: number;
};

export type TradeStage =
  | "INITIAL RISK"
  | "EARLY HOLD"
  | "PARTIAL PROFIT WINDOW"
  | "BREAKEVEN / PROTECTED"
  | "RUNNER"
  | "TREND TRAIL"
  | "EXIT WARNING"
  | "CLOSED";

export type TradeLifecycleInput = {
  status: "ACTIVE" | "RECONCILIATION_REQUIRED" | "CLOSED";
  entryPrice: number;
  currentPrice: number;
  initialStop: number;
  plannedStop: number;
  remainingQuantity: number;
  tradingDaysHeld: number;
  partialTaken: boolean;
  trailMethod: TradeTrailMethod;
  exitConfirmationRule: TradeExitConfirmationRule;
  ema10?: number;
  ema20?: number;
  closesBelowTrail?: number;
  settings: Pick<TradingSettingsRecord, "initialManagementDays" | "partialStartDay" | "partialEndDay" | "partialPercent" | "partialMinR" | "moveStopToBreakevenAfterPartial">;
};

export type TradeLifecycleResult = {
  stage: TradeStage;
  instruction: string;
  recommendedAction: string;
  suggestedStop?: number;
  trailValue?: number;
  exitWarning: boolean;
  nextReview: string;
};

export function defaultTradingSettings(now = new Date()): TradingSettingsRecord {
  const timestamp = now.toISOString();
  return {
    id: "default",
    totalCapital: 5000000,
    riskPercent: 0.2,
    defaultStopSource: "Setup Candle Low",
    defaultManagementTimeframe: "Daily",
    initialManagementDays: 3,
    partialStartDay: 3,
    partialEndDay: 5,
    partialPercent: 50,
    partialMinR: 2,
    defaultTrailMA: "10 EMA",
    moveStopToBreakevenAfterPartial: true,
    exitConfirmationRule: "Close below EMA",
    portfolioRiskNormalPct: 1,
    portfolioRiskElevatedPct: 1,
    portfolioRiskHighPct: 1.5,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

const paise = (value: number) => Math.round(value * 100);
const rupees = (value: number) => value / 100;
const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function calculatePositionSizing(input: PositionSizingInput): PositionSizingResult {
  const errors: string[] = [];
  if (!(input.totalCapital > 0)) errors.push("Total capital must be greater than zero.");
  if (!(input.riskPercent > 0)) errors.push("Risk percent must be greater than zero.");
  if (!(input.entryPrice > 0)) errors.push("Entry price must be greater than zero.");
  if (!(input.stopLoss > 0)) errors.push("Stop loss must be greater than zero.");
  if (input.entryPrice <= input.stopLoss) errors.push("Entry price must be above stop loss for a long trade.");

  const riskAmountPaise = Math.round((paise(input.totalCapital) * input.riskPercent) / 100);
  const riskPerSharePaise = paise(input.entryPrice) - paise(input.stopLoss);
  const quantity = errors.length || riskPerSharePaise <= 0 ? 0 : Math.floor(riskAmountPaise / riskPerSharePaise);
  const positionValuePaise = quantity * paise(input.entryPrice);
  if (quantity <= 0) errors.push("Calculated quantity is zero. Risk per share is too high for the configured risk.");

  return {
    valid: errors.length === 0,
    errors,
    riskAmount: roundMoney(rupees(riskAmountPaise)),
    riskPerShare: roundMoney(Math.max(0, rupees(riskPerSharePaise))),
    quantity,
    positionValue: roundMoney(rupees(positionValuePaise)),
    capitalUsagePercent: input.totalCapital > 0 ? (rupees(positionValuePaise) / input.totalCapital) * 100 : 0,
    stopLossPercent: input.entryPrice > 0 ? ((input.entryPrice - input.stopLoss) / input.entryPrice) * 100 : 0,
  };
}

export function calculateRMultiple(entryPrice: number, initialStop: number, currentPrice: number) {
  const initialRiskPerShare = entryPrice - initialStop;
  if (!(initialRiskPerShare > 0)) return 0;
  return (currentPrice - entryPrice) / initialRiskPerShare;
}

export function calculateOpenRisk(quantity: number, referencePrice: number, plannedStop: number) {
  return Math.max(0, quantity * (referencePrice - plannedStop));
}

export function evaluateTradeLifecycle(input: TradeLifecycleInput): TradeLifecycleResult {
  const rMultiple = calculateRMultiple(input.entryPrice, input.initialStop, input.currentPrice);
  const trailValue = input.trailMethod === "10 EMA" ? input.ema10 : input.trailMethod === "20 EMA" ? input.ema20 : undefined;
  const closesBelow = input.closesBelowTrail ?? 0;
  const exitTriggered =
    input.status === "ACTIVE" &&
    trailValue !== undefined &&
    (input.exitConfirmationRule === "2 closes below EMA" ? closesBelow >= 2 : closesBelow >= 1);

  if (input.status === "CLOSED") {
    return { stage: "CLOSED", instruction: "Trade is closed. Keep the timeline for audit and review.", recommendedAction: "No active management action.", exitWarning: false, nextReview: "Closed" };
  }
  if (input.status === "RECONCILIATION_REQUIRED") {
    return { stage: "EXIT WARNING", instruction: "Broker quantity differs from the managed trade record.", recommendedAction: "Reconcile the trade before acting on recommendations.", exitWarning: true, nextReview: "Now" };
  }
  if (exitTriggered) {
    return {
      stage: "EXIT WARNING",
      instruction: `${input.exitConfirmationRule} triggered against ${input.trailMethod}. Review the runner for exit.`,
      recommendedAction: "Review runner for exit. No broker order has been placed.",
      trailValue,
      exitWarning: true,
      nextReview: "Now",
    };
  }
  if (input.partialTaken && input.settings.moveStopToBreakevenAfterPartial && input.plannedStop >= input.entryPrice) {
    return {
      stage: rMultiple >= input.settings.partialMinR ? "RUNNER" : "BREAKEVEN / PROTECTED",
      instruction: "Partial recorded and remaining position is protected near breakeven.",
      recommendedAction: "Hold remaining shares as a runner while the trend remains intact.",
      suggestedStop: input.entryPrice,
      trailValue,
      exitWarning: false,
      nextReview: "Next daily close",
    };
  }
  if (input.partialTaken && input.settings.moveStopToBreakevenAfterPartial) {
    return {
      stage: "BREAKEVEN / PROTECTED",
      instruction: "Partial recorded. Suggested planned stop is breakeven for the remaining position.",
      recommendedAction: "Mark stop updated after you adjust your broker-side plan.",
      suggestedStop: input.entryPrice,
      trailValue,
      exitWarning: false,
      nextReview: "After stop review",
    };
  }
  if (input.tradingDaysHeld === 0) {
    return { stage: "INITIAL RISK", instruction: "Protect the trade. Initial stop remains at setup candle low.", recommendedAction: "Keep initial risk controlled.", exitWarning: false, nextReview: "Next trading day" };
  }
  if (input.tradingDaysHeld <= input.settings.initialManagementDays) {
    return { stage: "EARLY HOLD", instruction: "Allow the breakout time to prove itself. Avoid unnecessarily tightening the stop unless the setup is invalidated.", recommendedAction: "Hold with initial risk plan.", exitWarning: false, nextReview: "Next daily close" };
  }
  if (input.tradingDaysHeld >= input.settings.partialStartDay && input.tradingDaysHeld <= input.settings.partialEndDay && rMultiple >= input.settings.partialMinR) {
    return {
      stage: "PARTIAL PROFIT WINDOW",
      instruction: `Trade is +${rMultiple.toFixed(2)}R after ${input.tradingDaysHeld} trading days.`,
      recommendedAction: `Consider taking ${Math.round(input.settings.partialPercent)}% profit and protecting the remaining position.`,
      suggestedStop: input.settings.moveStopToBreakevenAfterPartial ? input.entryPrice : undefined,
      exitWarning: false,
      nextReview: "After partial decision",
    };
  }
  if (trailValue !== undefined && rMultiple >= input.settings.partialMinR) {
    return {
      stage: "TREND TRAIL",
      instruction: `Trend intact while price remains above ${input.trailMethod}.`,
      recommendedAction: "Continue holding the runner. Exit is advisory only after confirmation rule triggers.",
      trailValue,
      exitWarning: false,
      nextReview: "Next daily close",
    };
  }
  return { stage: "RUNNER", instruction: "Hold while trend remains intact.", recommendedAction: "Continue monitoring current R, planned stop, and moving averages.", trailValue, exitWarning: false, nextReview: "Next daily close" };
}

export function normalizeTimeframe(value: unknown): TradeManagementTimeframe {
  return value === "Hourly" ? "Hourly" : "Daily";
}

export function normalizeTrailMethod(value: unknown): TradeTrailMethod {
  return value === "20 EMA" || value === "Manual" ? value : "10 EMA";
}

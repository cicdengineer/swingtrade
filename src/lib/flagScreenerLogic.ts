export type FlagCandle = { trade_date: string; open: number; high: number; low: number; close: number; volume: number };
export type FlagFilters = {
  universe: "ALL" | "CNX500" | "NIFTYSC500";
  poleDays: number;
  minPriorAdvancePct: number;
  minBaseDays: number;
  maxBaseDays: number;
  maxRetracementPct: number;
  minContractionPct: number;
  maxBaseVolumeRatio: number;
  minBreakoutVolumeRatio: number;
  minAverageDailyTradedValue: number;
};

export const flagDefaults: FlagFilters = {
  universe: "CNX500",
  poleDays: 10,
  minPriorAdvancePct: 8,
  minBaseDays: 6,
  maxBaseDays: 15,
  maxRetracementPct: 50,
  minContractionPct: 25,
  maxBaseVolumeRatio: 0.9,
  minBreakoutVolumeRatio: 1.2,
  minAverageDailyTradedValue: 0,
};

export const flagTargetMultiplier = 1.05;
export type FlagBoundaries = {
  startDate: string;
  endDate: string;
  upperStart: number;
  upperEnd: number;
  lowerStart: number;
  lowerEnd: number;
};

export type FlagRow = {
  security_id: string;
  symbol: string;
  company_name: string;
  status: "forming" | "breakout";
  boundaries: FlagBoundaries;
  resistance: number;
  support: number;
  swingLow: FlagCandle;
  advance: number;
  contraction: number;
  baseDays: number;
  volumeRatio: number;
  breakout: { trade_date: string; close: number } | null;
  recent: Array<FlagCandle & { ema10?: number }>;
  patternHistory?: Array<FlagCandle & { ema10?: number }>;
};

export type FlagResponse = { filters: FlagFilters; evaluated: number; results: FlagRow[]; generatedAt: string };

type Setup = {
  boundaries: FlagBoundaries;
  resistance: number;
  support: number;
  swingLow: FlagCandle;
  advance: number;
  contraction: number;
  baseDays: number;
  averageVolume: number;
  volumeRatio: number;
};

function meanVolume(rows: FlagCandle[]) {
  return rows.reduce((total, row) => total + row.volume, 0) / rows.length;
}

function fitPennant(rows: FlagCandle[], start: number, end: number, filters: FlagFilters): Setup | null {
  const poleStart = start - filters.poleDays;
  if (poleStart < 0) return null;
  const poleStartPrice = rows[poleStart].close;
  const poleCloseGain = rows[start - 1].close - poleStartPrice;
  if (poleCloseGain < poleStartPrice * filters.minPriorAdvancePct * 0.006) return null;
  const pole = rows.slice(poleStart, start);
  const base = rows.slice(start, end + 1);
  const baseDays = base.length;
  const midpoint = Math.floor(baseDays / 2);
  const extreme = (from: number, to: number, key: "high" | "low") => {
    let best = from;
    for (let index = from + 1; index < to; index++) {
      if (key === "high" ? base[index].high > base[best].high : base[index].low < base[best].low) best = index;
    }
    return best;
  };
  const highFirst = extreme(0, midpoint, "high");
  const lowFirst = extreme(0, midpoint, "low");
  const highLast = extreme(midpoint, baseDays, "high");
  const lowLast = extreme(midpoint, baseDays, "low");
  const polePeak = base[highFirst].high;
  const poleGain = polePeak - poleStartPrice;
  const advance = 100 * poleGain / poleStartPrice;
  const swingLow = base[base[lowFirst].low <= base[lowLast].low ? lowFirst : lowLast];
  if (highFirst > 1 || highFirst >= lowFirst ||
      advance < filters.minPriorAdvancePct || poleCloseGain < poleGain * 0.6 ||
      100 * (polePeak - swingLow.low) > poleGain * filters.maxRetracementPct) return null;

  const upperSlope = (base[highLast].high - polePeak) / (highLast - highFirst);
  const lowerSlope = (base[lowLast].low - base[lowFirst].low) / (lowLast - lowFirst);
  if (upperSlope >= 0 || lowerSlope <= 0) return null;
  const upper = (index: number) => polePeak + (index - highFirst) * upperSlope;
  const lower = (index: number) => base[lowFirst].low + (index - lowFirst) * lowerSlope;
  const firstWidth = upper(0) - lower(0);
  const lastWidth = upper(baseDays - 1) - lower(baseDays - 1);
  const contraction = 100 * (1 - lastWidth / firstWidth);
  if (firstWidth <= 0 || lower(baseDays) >= upper(baseDays) || contraction < filters.minContractionPct ||
      base.some((row, index) => row.high > upper(index) + firstWidth * 0.15 || row.low < lower(index) - firstWidth * 0.15)) return null;

  const averageVolume = meanVolume(pole);
  const volumeRatio = meanVolume(base) / averageVolume;
  if (!(averageVolume > 0) || volumeRatio > filters.maxBaseVolumeRatio) return null;
  return {
    boundaries: {
      startDate: base[0].trade_date, endDate: base.at(-1)!.trade_date,
      upperStart: upper(0), upperEnd: upper(baseDays - 1), lowerStart: lower(0), lowerEnd: lower(baseDays - 1),
    },
    resistance: upper(baseDays), support: lower(baseDays), swingLow, advance, contraction, baseDays, averageVolume, volumeRatio,
  };
}

export function findBullishPennant(rows: FlagCandle[], filters: FlagFilters) {
  let active: (Setup & { breakout: FlagCandle }) | null = null;
  let forming: Setup | null = null;
  const firstEnd = filters.poleDays + filters.minBaseDays - 1;
  for (let end = firstEnd; end < rows.length; end++) {
    const current = rows[end];
    if (active) {
      if (current.high >= active.breakout.close * flagTargetMultiplier) active = null;
      forming = null;
      continue;
    }
    if (forming && current.close > forming.resistance &&
        current.volume >= forming.averageVolume * filters.minBreakoutVolumeRatio) {
      active = { ...forming, breakout: current };
      forming = null;
      continue;
    }
    forming = null;
    for (let days = filters.maxBaseDays; days >= filters.minBaseDays; days--) {
      const setup = fitPennant(rows, end - days + 1, end, filters);
      if (setup && current.close <= setup.boundaries.upperEnd && current.close >= setup.boundaries.lowerEnd) {
        forming = setup;
        break;
      }
    }
  }
  return active ? { ...active, status: "breakout" as const } : forming ? { ...forming, breakout: null, status: "forming" as const } : null;
}

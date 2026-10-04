import type { Candle, Observation, Summary } from "./types";

const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a,b) => a-b); if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p; const low = Math.floor(index); const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};
const summarise = (rows: Observation[]): Summary => {
  const returns = rows.map(r => r.returnPct), maes = rows.map(r => r.maePct);
  const average = returns.reduce((a,b)=>a+b,0) / (returns.length || 1);
  const deviation = Math.sqrt(returns.reduce((s,v)=>s+(v-average)**2,0) / (returns.length || 1));
  return { average, median: percentile(returns,.5), winRate: returns.filter(x=>x>0).length / (returns.length || 1) * 100,
    best: Math.max(...returns, 0), worst: Math.min(...returns, 0), deviation, observations: rows.length,
    maeAverage: maes.reduce((a,b)=>a+b,0)/(maes.length||1), maeMedian: percentile(maes,.5), maeWorst: Math.min(...maes,0),
    maePercentiles: { p25: percentile(maes,.25), p50: percentile(maes,.5), p75: percentile(maes,.75), p90: percentile(maes,.9) }, rows };
};
function periods(candles: Candle[], startMonth: number, length: number): Observation[] {
  const sorted = [...candles].sort((a,b)=>a.date.localeCompare(b.date));
  const years = [...new Set(sorted.map(c=>Number(c.date.slice(0,4))))];
  return years.flatMap(year => {
    const start = new Date(Date.UTC(year, startMonth, 1)); const end = new Date(Date.UTC(year, startMonth + length, 1));
    const slice = sorted.filter(c => { const d = new Date(`${c.date}T00:00:00Z`); return d >= start && d < end; });
    if (!slice.length || slice[0].date.slice(0,4) === String(new Date().getUTCFullYear())) return [];
    const entry = slice[0].open; const exit = slice[slice.length-1].close;
    return [{ label: `${monthNames[startMonth]} → ${monthNames[(startMonth+length-1)%12]}`, year, returnPct: (exit/entry-1)*100, maePct: (Math.min(...slice.map(c=>c.low))/entry-1)*100 }];
  });
}
export function calculateMonthlySeasonality(candles: Candle[]) { return monthNames.map((name,index) => ({ label:name, ...summarise(periods(candles,index,1)) })); }
export function calculateQuarterlySeasonality(candles: Candle[]) { return [0,3,6,9].map((m,i) => ({ label:`Q${i+1}`, ...summarise(periods(candles,m,3)) })); }
export function calculateRollingSeasonality(candles: Candle[], months = 3) { return monthNames.map((_,m) => ({ label:`${monthNames[m]} → ${monthNames[(m+months-1)%12]}`, ...summarise(periods(candles,m,months)) })); }
export function calculateMAE(candles: Candle[]) { return periods(candles, 0, 12).map(x=>x.maePct); }
export function calculateMAEPercentiles(values: number[]) { return { p25:percentile(values,.25), p50:percentile(values,.5), p75:percentile(values,.75), p90:percentile(values,.9) }; }
export function calculatePositionSize(capital:number, positionPct:number, riskPct:number, entry:number, exit:number, tranches:number) {
  const maxPosition=capital*positionPct/100, riskBudget=capital*riskPct/100, quantity=Math.floor(maxPosition/entry);
  const riskPerShare=Math.max(0,entry-exit); const riskLimitedQuantity = riskPerShare ? Math.floor(riskBudget/riskPerShare) : quantity;
  const allowedQuantity=Math.min(quantity,riskLimitedQuantity); return {maxPosition,riskBudget,quantity:allowedQuantity,trancheSize:maxPosition/tranches,openRisk:allowedQuantity*riskPerShare};
}

export const fallingTrendScore = (rows: { close: number }[], sessions: number): number => {
  const closes = rows.slice(-sessions).map((point) => point.close);
  if (closes.length < 10 || closes.some((close) => !Number.isFinite(close) || close <= 0)) return -Infinity;
  const midpoint = (closes.length - 1) / 2;
  const meanLogClose = closes.reduce((sum, close) => sum + Math.log(close), 0) / closes.length;
  let covariance = 0;
  let variance = 0;
  closes.forEach((close, index) => {
    const day = index - midpoint;
    covariance += day * (Math.log(close) - meanLogClose);
    variance += day * day;
  });
  // A larger positive score means a steeper sustained fall across the displayed chart.
  return -(covariance / variance) * (closes.length - 1) * 100;
};

export const matchesCleanTrend = (rows: { close: number }[], sessions: number): boolean => {
  const closes = rows.slice(-sessions).map((point) => point.close);
  if (closes.length < Math.ceil(sessions * 0.8) || closes.some((close) => !Number.isFinite(close) || close <= 0)) return false;
  const logs = closes.map(Math.log);
  const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  const midpoint = (logs.length - 1) / 2;
  let covariance = 0;
  let timeVariance = 0;
  let priceVariance = 0;
  logs.forEach((value, index) => {
    const day = index - midpoint;
    covariance += day * (value - mean);
    timeVariance += day * day;
    priceVariance += (value - mean) ** 2;
  });
  const score = fallingTrendScore(rows, sessions);
  const fit = priceVariance > 0 ? covariance ** 2 / (timeVariance * priceVariance) : 0;
  return fit >= 0.6 && Math.abs(score) >= 12;
};

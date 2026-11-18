export type PaperTrade = {
  id: string;
  securityId: string;
  symbol: string;
  entry: number;
  stop: number;
  quantity: number;
  capital: number;
  riskPercent: number;
  openedAt: string;
  exitPrice: number | null;
  closedAt: string | null;
};

export const paperPnl = (trade: PaperTrade, price: number) =>
  Math.round((price - trade.entry) * trade.quantity * 100) / 100;

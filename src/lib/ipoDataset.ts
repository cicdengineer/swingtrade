import type { Candle } from "./types";

export type IpoListing = {
  symbol: string;
  company: string;
  listingDate: string;
};

export type IpoDataset = {
  from: string;
  through: string;
  refreshedAt: string;
  listings: (IpoListing & { securityId?: string; candles: Candle[]; issue?: string })[];
};

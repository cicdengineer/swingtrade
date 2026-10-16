export const RECENT_VOLUME_SESSIONS = 10;
export const VOLUME_BASELINE_SESSIONS = 20;
export const ABNORMAL_VOLUME_RATIO = 2;

type VolumePoint = { trade_date: string; volume: number };

export type RecentVolumeSummary = {
  evaluatedDays: number;
  spikeCount: number;
  peakRatio: number | null;
  latestRatio: number | null;
  sessionsSinceLastSpike: number | null;
};

export function summarizeRecentVolume(points: VolumePoint[], currentDate: string): RecentVolumeSummary {
  const completed = points.filter((point) => point.trade_date < currentDate);
  const firstRecentIndex = Math.max(0, completed.length - RECENT_VOLUME_SESSIONS);
  let evaluatedDays = 0;
  let spikeCount = 0;
  let peakRatio: number | null = null;
  let latestRatio: number | null = null;
  let sessionsSinceLastSpike: number | null = null;

  for (let index = firstRecentIndex; index < completed.length; index += 1) {
    const preceding = completed.slice(index - VOLUME_BASELINE_SESSIONS, index);
    const volume = completed[index].volume;
    if (preceding.length !== VOLUME_BASELINE_SESSIONS || !Number.isFinite(volume) || volume <= 0 ||
      preceding.some((point) => !Number.isFinite(point.volume) || point.volume <= 0)) continue;

    const averageVolume = preceding.reduce((total, point) => total + point.volume, 0) / VOLUME_BASELINE_SESSIONS;
    const ratio = volume / averageVolume;
    evaluatedDays += 1;
    peakRatio = Math.max(peakRatio ?? 0, ratio);
    if (index === completed.length - 1) latestRatio = ratio;
    if (ratio >= ABNORMAL_VOLUME_RATIO) {
      spikeCount += 1;
      sessionsSinceLastSpike = completed.length - 1 - index;
    }
  }

  return { evaluatedDays, spikeCount, peakRatio, latestRatio, sessionsSinceLastSpike };
}

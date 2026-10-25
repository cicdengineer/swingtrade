import { positionSizingFromStop, type EntrySizingSettings } from "@/lib/entrySizing";

const money = (value: number) => `₹${value.toFixed(2)}`;
const rupees = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export default function EntrySizingTile({ title, entry, stop, settings, loading }: { title: string; entry: number; stop?: number; settings?: EntrySizingSettings | null; loading?: boolean }) {
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

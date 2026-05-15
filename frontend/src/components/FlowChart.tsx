import { useState } from "react";
import type { DailyPoint } from "../lib/api";
import { fmtUsd } from "../lib/format";

const W = 640;
const H = 180;

export function FlowChart({ data }: { data: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.inflow, d.outflow]));
  const slot = W / Math.max(1, data.length);
  const barW = Math.max(2, slot * 0.32);
  const y = (v: number) => H - (v / max) * H;
  const labelEvery = Math.ceil(data.length / 6);
  const active = hover !== null ? data[hover] : null;

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span>
          <i className="swatch in" /> Received
        </span>
        <span>
          <i className="swatch out" /> Sent
        </span>
        <span className="chart-readout">
          {active
            ? `${new Date(active.date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} · +${fmtUsd(active.inflow)} / −${fmtUsd(active.outflow)}`
            : `Peak day ${fmtUsd(max)} USDC`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="chart" role="img" aria-label="Daily USDC flow">
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={0} x2={W} y1={H * t} y2={H * t} className="grid" />
        ))}
        {data.map((d, i) => {
          const x = i * slot + (slot - barW * 2 - 2) / 2;
          return (
            <g
              key={d.date}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className={hover === i ? "bar-group hovered" : "bar-group"}
            >
              <rect x={i * slot} y={0} width={slot} height={H} className="hit" />
              <rect x={x} y={y(d.inflow)} width={barW} height={H - y(d.inflow)} rx={2} className="bar in" />
              <rect x={x + barW + 2} y={y(d.outflow)} width={barW} height={H - y(d.outflow)} rx={2} className="bar out" />
              {i % labelEvery === 0 && (
                <text x={i * slot + slot / 2} y={H + 16} className="axis" textAnchor="middle">
                  {new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

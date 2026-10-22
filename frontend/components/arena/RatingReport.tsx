import { AlertOctagon, AlertTriangle, Lightbulb } from "lucide-react";
import type { Area, Rating } from "../../lab/rate";
import { si } from "../../lab/values";

const AREA_LABEL: Record<Area, string> = { safety: "Safety", efficiency: "Efficiency", design: "Design & parts", cost: "Cost", code: "Code" };
const ICON = { critical: AlertOctagon, warning: AlertTriangle, tip: Lightbulb };

function Ring({ score, grade }: { score: number; grade: string }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const color = score >= 88 ? "var(--ok)" : score >= 60 ? "var(--warn)" : "var(--bad)";
  return (
    <svg className="score-ring" viewBox="0 0 100 100" role="img" aria-label={`Score ${score} out of 100, grade ${grade}`}>
      <circle cx="50" cy="50" r={r} className="track" />
      <circle cx="50" cy="50" r={r} stroke={color} strokeDasharray={`${(c * score) / 100} ${c}`} transform="rotate(-90 50 50)" className="value" />
      <text x="50" y="47" textAnchor="middle" className="grade">
        {grade}
      </text>
      <text x="50" y="64" textAnchor="middle" className="num">
        {score}/100
      </text>
    </svg>
  );
}

export function RatingReport({ rating, onFocus }: { rating: Rating; onFocus?: (refs: string[]) => void }) {
  const { power, cost } = rating;
  return (
    <div className="rating">
      <div className="rating-top">
        <Ring score={rating.score} grade={rating.grade} />
        <div className="rating-areas">
          {(Object.keys(rating.areas) as Area[]).map((a) => (
            <div key={a} className="area-row">
              <span>{AREA_LABEL[a]}</span>
              <span className="area-bar">
                <span style={{ width: `${rating.areas[a]}%`, background: (rating.areas[a] ?? 0) >= 85 ? "var(--ok)" : (rating.areas[a] ?? 0) >= 55 ? "var(--warn)" : "var(--bad)" }} />
              </span>
              <b>{Math.round(rating.areas[a] ?? 0)}</b>
            </div>
          ))}
        </div>
      </div>

      <section className="rating-sec">
        <h4>Where the power goes</h4>
        {power.lines.length ? (
          <>
            <div className="power-bar">
              {power.lines.map((l) => (
                <span key={l.ref} className={l.useful ? "useful" : "waste"} style={{ flex: Math.max(l.w, 1e-6) }} title={`${l.ref}: ${si(l.w, "W")}${l.useful ? " (does the job)" : " (heat)"}`}>
                  {l.ref}
                </span>
              ))}
            </div>
            <p className="dim small">
              {power.percent !== null ? `${Math.round(power.percent)}% does the job (${si(power.usefulW, "W")}), ${si(power.wastedW, "W")} becomes heat.` : `Nothing here turns power into light or sound; it draws ${si(power.idleA, "A")} at rest.`}
            </p>
          </>
        ) : (
          <p className="dim small">No current flows yet.</p>
        )}
      </section>

      <section className="rating-sec">
        <h4>What could be better</h4>
        {rating.findings.length === 0 && <p className="ok">Nothing to fix. Clean work.</p>}
        <ul className="findings">
          {rating.findings.map((f, i) => {
            const Icon = ICON[f.severity];
            return (
              <li key={i} className={f.severity} onClick={() => f.refs.length && onFocus?.(f.refs)}>
                <Icon size={15} />
                <div>
                  <b>{f.title}</b>
                  <p>{f.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rating-sec">
        <h4>Parts bill · about ${cost.total.toFixed(2)}</h4>
        <div className="bill">
          {cost.lines.map((l) => (
            <span key={l.ref}>
              {l.ref} <span className="dim">{l.what}</span> <b>${l.price.toFixed(2)}</b>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

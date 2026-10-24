// Nearest-hospital list in React. Requests and state stay in hospitals.js.
import { put } from "./slots.js";

function Row({ h, s }) {
  const { L, my } = s, en = !my, name = en ? (h.name_en || h.name) : h.name;
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.latitude + "," + h.longitude)}`;
  const meta = [en ? (h.level_en || h.level) : (h.level || h.level_en), en ? (h.township_en || h.township) : h.township, h.beds && h.beds !== "NA" ? L("ux_beds", { count: h.beds }) : null].filter(v => v && v !== "NA").join(" · ");
  return (
    <article className="hospital-item"><div className="hospital-icon">🏥</div>
      <div className="hospital-body"><strong>{name}</strong><small>{meta || "—"}</small><small>{Number(h.distance_km).toFixed(1)} km · {h.confidence || ""}</small></div>
      <a className="hospital-go" href={maps} target="_blank" rel="noopener" aria-label={`${name} — ${L("ux_map")}`}>↗</a></article>
  );
}

function Hospitals({ s }) {
  const { L } = s;
  if (s.kind === "empty") return <div className="empty-state">{L("wx_no_nearby_hospitals_found")}</div>;
  if (s.kind === "loading") return <div className="empty-state" role="status">{L("ux_loading")}</div>;
  if (s.kind === "failed") return <div className="empty-state" role="status">{L("ux_failed")}</div>;
  return <>{s.rows.map((h, i) => <Row key={i} h={h} s={s} />)}{s.note ? <p role="status">{L("ux_failed")}</p> : null}</>;
}

export function mountHospitalsView() { return s => put("hospitalList", s ? <Hospitals s={s} /> : null); }

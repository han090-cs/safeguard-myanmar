// DMH official-warning strip, recent-places chips and search suggestions in React. Requests, merging of warnings and navigation stay in weather_script.js.
import { put } from "./slots.js";

function Pulse({ s }) {
  if (s.kind === "pending") return <div className="pulse-clear pending"><span>⏳</span><div><strong>{s.title}</strong></div></div>;
  if (s.kind === "clear") return <div className="pulse-clear"><span>✓</span><div><strong>{s.title}</strong><small>{s.small}</small></div></div>;
  if (s.kind === "note") return <div className="pulse-alert watch"><span>{s.icon}</span><div><strong>{s.title}</strong><small>{s.small}</small>{" "}<a className="pulse-link" href={s.dmh} target="_blank" rel="noopener noreferrer">moezala.gov.mm ↗</a></div></div>;
  return (
    <>
      {s.stale ? <p className="tiny" role="status">{s.stale}</p> : null}
      {s.rows.map((r, i) => (
        <article className={"pulse-alert " + (r.urgent ? "urgent" : "watch")} key={i}><span className="pulse-icon">{r.icon}</span>
          <div><strong>{r.title}</strong><p>{r.regions}</p><small>{s.validUntil} {r.until} · <a className="pulse-link" href={r.href} target="_blank" rel="noopener noreferrer">{s.original}</a></small></div>
          <span className="official-badge">DMH</span></article>
      ))}
    </>
  );
}
export function mountPulseView() { return s => put("officialPulse", s ? <Pulse s={s} /> : null); }

export function mountRecentView() {
  return (list, onPick) => put("recentLocations", <>{list.map(x => <button className="chip" type="button" data-id={x.id} key={x.id} onClick={() => onPick(x.raw)}>{x.label}</button>)}</>);
}

export function mountSuggestView() {
  return list => put("locationSuggestions", list && list.length ? <>{list.map((o, i) => <option value={o.value} key={i}>{o.text}</option>)}</> : null);
}

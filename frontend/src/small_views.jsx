// El Niño card, health tips and the level-scale panel in React. Data, requests and wiring stay in enso_card.js, health_tips.js and scale_ui.js.
import { put } from "./slots.js";

function Enso({ s }) {
  const { e, L } = s;
  return (
    <>
      <div className="section-heading"><div><h3>🌐 El Niño {L("wx_status")}</h3><p className="muted">{L("wx_global_status_same_every_place")}</p></div></div>
      <ul className="em-list">
        <li><span>NOAA</span><b>{e.status || "El Niño Advisory"}</b></li>
        {e.strong_chance ? <li><span>{L("enso_strong_label")}</span><b>{String(e.strong_chance).replace(/greater than\s*/i, "> ")}</b></li> : null}
        {e.historic_chance_ond ? <li><span>{L("wx_oct_dec_2026_stronger_than")}</span><b>{e.historic_chance_ond}</b></li> : null}
        <li><span>WMO ({e.wmo.date})</span><b>{L("wx_persists_feb_2027_100")}</b></li>
      </ul>
      {e.stale ? <p className="agri-note tier-dry">⚠ {L("wx_information_over_45_days_old")}</p> : null}
      <p className="agri-note enso-place" ref={s.farm ? (el => { if (el) el.hidden = !s.compatible; }) : undefined}>{L("enso_for_place", { place: s.place })}</p>
      <p className="tiny muted">{L("wx_source")}: <a href={e.url} target="_blank" rel="noopener">NOAA CPC</a> · {L("common_updated")} {e.updated} · {L("wx_next")} {e.next_update} · <a href={e.dmh_url} target="_blank" rel="noopener">DMH ↗</a></p>
      {s.ws ? <p className="enso-link"><a className="em-num" href={s.ws} target="_blank" rel="noopener noreferrer">🔗 {e.warning_system_name || L("enso_warning_system")} ↗</a></p> : null}
    </>
  );
}
export function mountEnsoView() { return (id, s) => put(id, s ? <Enso s={s} /> : null); }

export function mountHealthTipsView() {
  return tips => put("healthTipsList", tips ? <>{tips.map((t, i) => (
    <article className={"health-tip " + t.tone} key={i}>
      <span className="health-tip-icon" aria-hidden="true">{t.icon}</span>
      <div><strong>{t.title}</strong><p>{t.text}</p></div>
    </article>))}</> : null);
}

function Scale({ s }) {
  const { sc, my, cur, L } = s;
  return (
    <>
      <div className="scale-head"><strong>{sc.icon} {my ? sc.titleMy : sc.titleEn}</strong><button type="button" className="scale-close" aria-label={L("wx_close")}>✕</button></div>
      <p className="tiny">{my ? sc.noteMy : sc.noteEn}</p>
      <ol className="scale-list">{sc.steps.map((st, i) => {
        const lo = i ? sc.steps[i - 1].max : null, hi = st.max;
        const range = hi === null ? `≥ ${lo}` : lo === null ? `< ${hi}` : `${lo} – ${hi}`;
        return <li className={cur && cur.idx === i ? "now" : ""} key={i}><span className={"lvl-pill t" + st.tone}>{my ? st.my : st.en}</span><span className="scale-range">{range} {sc.unit}</span><span className="scale-tip">{my ? st.tipMy : st.tipEn}</span></li>;
      })}</ol>
      {cur ? <p className="tiny scale-now">{L("wx_now")}: <strong>{my ? cur.step.my : cur.step.en}</strong></p> : null}
    </>
  );
}
export function mountScaleView() { return s => put("scalePanel", <Scale s={s} />); }

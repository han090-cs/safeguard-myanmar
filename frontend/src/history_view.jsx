// Climate history cards (Compare tab + Farming tab) in React. Data loading and events stay in history.js.
import { Fragment } from "preact";
import { put } from "./slots.js";

const C_EL = "#c2410c", C_LA = "#1d4ed8", C_NE = "#6b7280", C_WARM = "#c2410c", C_COOL = "#1d4ed8", C_RAIN = "#0f766e";
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const nice = (lo, hi, n) => { const step = (hi - lo) / n; return Array.from({ length: n + 1 }, (_, i) => lo + step * i); };
// Three year labels (first, middle, last), anchored so none runs past the edge; Burmese digits are wide, so more than three touched each other
function YearLabels({ y0, y1, X, H, num }) {
  const mid = Math.round((y0 + y1) / 10) * 5;
  return [[y0, "start"], [mid, "middle"], [y1, "end"]].map(([y, a]) => <text key={y} x={X(y).toFixed(1)} y={H - 11} text-anchor={a} font-size="11" fill="currentColor">{num(y)}</text>);
}
const LONG = {
  my: ["ဇန်နဝါရီ", "ဖေဖော်ဝါရီ", "မတ်", "ဧပြီ", "မေ", "ဇွန်", "ဇူလိုင်", "ဩဂုတ်", "စက်တင်ဘာ", "အောက်တိုဘာ", "နိုဝင်ဘာ", "ဒီဇင်ဘာ"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

function GridY({ ticks, Y, W, ml, mr, fmt }) {
  return ticks.map((t, i) => (
    <Fragment key={i}>
      <line x1={ml} x2={W - mr} y1={Y(t).toFixed(1)} y2={Y(t).toFixed(1)} stroke="currentColor" opacity=".13" />
      <text x={ml - 5} y={(Y(t) + 3.5).toFixed(1)} text-anchor="end" font-size="11" fill="currentColor">{fmt(t)}</text>
    </Fragment>
  ));
}

function TempChart({ r, base, x }) {
  const { L, num } = x;
  const W = 320, H = 182, ml = 46, mr = 10, mt = 17, mb = 30, v = r.temp, ys = r.years, y0 = ys[0], y1 = ys[ys.length - 1];
  const lo = Math.floor((Math.min(...v, base) - .1) * 5) / 5, hi = Math.ceil((Math.max(...v, base) + .1) * 5) / 5, sp = (hi - lo) || 1;
  const X = y => ml + (y - y0) / (y1 - y0) * (W - ml - mr), Y = t => mt + (1 - (t - lo) / sp) * (H - mt - mb);
  const mx = mean(ys), my_ = mean(v), sxx = ys.reduce((a, y) => a + (y - mx) ** 2, 0), sl = ys.reduce((a, y, i) => a + (y - mx) * (v[i] - my_), 0) / sxx, ic = my_ - sl * mx;
  const line = v.map((t, i) => `${X(ys[i]).toFixed(1)},${Y(t).toFixed(1)}`).join(" ");
  const last = v[v.length - 1];
  return (<>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={L("hist_temp")}>
      <GridY ticks={nice(lo, hi, 2)} Y={Y} W={W} ml={ml} mr={mr} fmt={t => num(t.toFixed(1))} />
      <YearLabels y0={y0} y1={y1} X={X} H={H} num={num} />
      <polyline fill="none" stroke="currentColor" opacity=".3" stroke-width="1.2" points={line} />
      <line x1={ml} x2={W - mr} y1={Y(base).toFixed(1)} y2={Y(base).toFixed(1)} stroke="currentColor" stroke-dasharray="4 3" opacity=".6" />
      <line x1={X(y0).toFixed(1)} x2={X(y1).toFixed(1)} y1={Y(ic + sl * y0).toFixed(1)} y2={Y(ic + sl * y1).toFixed(1)} stroke={C_WARM} stroke-width="2.4" stroke-linecap="round" />
      {v.map((t, i) => <circle key={i} cx={X(ys[i]).toFixed(1)} cy={Y(t).toFixed(1)} r={ys[i] === y1 ? 4 : 2.6} fill={t >= base ? C_WARM : C_COOL}><title>{num(ys[i])}: {num(t.toFixed(1))}°C</title></circle>)}
    </svg>
    <p className="hist-last"><strong>{L("hist_last", { y: num(y1), t: num(last.toFixed(1)), d: (last >= base ? "+" : "−") + num(Math.abs(last - base).toFixed(1)) })}</strong></p>
    <div className="hist-legend"><span><i className="lg-warm"></i>{L("hist_leg_warm")}</span><span><i className="lg-cool"></i>{L("hist_leg_cool")}</span><span><i className="lg-trend"></i>{L("hist_leg_trend")}</span></div>
  </>);
}

function RainYearChart({ r, x }) {
  const { L, num } = x;
  if (!r.rain || r.rain.length !== r.years.length) return null;
  const W = 320, H = 182, ml = 46, mr = 8, mt = 17, mb = 30, ys = r.years, v = r.rain, y0 = ys[0], y1 = ys[ys.length - 1], i91 = ys.indexOf(1991), i20 = ys.indexOf(2020);
  const avg = mean(v.slice(Math.max(0, i91), (i20 < 0 ? v.length : i20 + 1))), top = Math.ceil(Math.max(...v, avg) / 250) * 250;
  const bw = (W - ml - mr) / ys.length, X = i => ml + i * bw, Y = t => mt + (1 - t / top) * (H - mt - mb), col = { el_nino: C_EL, la_nina: C_LA };
  return (<>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={L("hist_rain_year")}>
      <GridY ticks={nice(0, top, 2)} Y={Y} W={W} ml={ml} mr={mr} fmt={t => num(Math.round(t))} />
      {v.map((t, i) => <rect key={i} x={(X(i) + bw * .12).toFixed(1)} y={Y(t).toFixed(1)} width={(bw * .76).toFixed(1)} height={(H - mb - Y(t)).toFixed(1)} rx="1" fill={col[(r.enso_by_year || {})[ys[i]]] || C_NE}><title>{num(ys[i])}: {num(t)} mm</title></rect>)}
      <YearLabels y0={y0} y1={y1} X={y => X(ys.indexOf(y)) + bw / 2} H={H} num={num} />
      <line x1={ml} x2={W - mr} y1={Y(avg).toFixed(1)} y2={Y(avg).toFixed(1)} stroke="currentColor" stroke-dasharray="4 3" stroke-width="1.4" />
    </svg>
    <div className="hist-legend"><span><i className="lg-el"></i>{L("hist_el_nino")}</span><span><i className="lg-la"></i>{L("hist_la_nina")}</span><span><i className="lg-ne"></i>{L("hist_neutral")}</span><span><i className="lg-avg"></i>{L("hist_leg_avg")} {num(Math.round(avg))} mm</span></div>
  </>);
}

// A typical year, one row per month: the name, a bar for the usual rain, and "rain mm · temperature" as plain text
function MonthRows({ r, x }) {
  const { num, my } = x, rain = r.clim_rain, t = r.clim_temp, names = LONG[my ? "my" : "en"], top = Math.max(...rain, 1);
  return (
    <ol className="mc-rows hist-months" aria-label={x.L("hist_month")}>
      {rain.map((m, i) => (
        <li key={i} className={`mc-row${i === x.month ? " now" : ""}`}>
          <span className="mc-m">{names[i]}</span>
          <span className="mc-bar" aria-hidden="true"><i className="mc-fill rain" style={{ left: 0, width: Math.max(1, m / top * 100).toFixed(1) + "%" }}></i></span>
          <strong className="mc-v">{num(Math.round(m))}<small> mm</small><span className="mc-t"> · {num(Math.round(t[i]))}°</span></strong>
        </li>
      ))}
    </ol>
  );
}

function ensoStats(r, L) {
  const e = r.jjas_by_enso, el = e.el_nino, ne = e.neutral;
  const c = (r.enso_vs_neutral || {}).el_nino, p = c && c.p != null ? c.p : null;
  return el && ne ? { el, ne, pct: Math.round(Math.abs(el.mean_mm - ne.mean_mm) / ne.mean_mm * 100), dir: L(el.mean_mm < ne.mean_mm ? "hist_less" : "hist_more"), p, sig: p != null && p < 0.05, ps: p == null ? "–" : (p < 0.001 ? "<0.001" : p.toFixed(3)) } : null;
}
const Cap = ({ t }) => <p className="tiny muted">{t}</p>;

function Picker({ s, x }) {
  const { L, my } = x, list = (s.DATA && s.DATA.regions) || [], cur = s.DATA && s.DATA.region_id;
  return (
    <div className="hist-pick"><label htmlFor="histRegion"><strong>{L("hist_region_pick")}</strong></label>
      <select key={s.REGION} id="histRegion" className="hist-select" data-cur={cur || ""} value={s.REGION}>
        <option value="">{L("hist_region_auto")}</option>
        {list.map(r => <option key={r.id} value={r.id}>{my ? r.my : r.en}</option>)}
      </select><p className="muted fs85">{L("hist_scope")}</p></div>
  );
}

function Today({ s, x }) {
  const { L, num, my } = x, { DATA } = s;
  if (s.FAIL) return <><p className="muted" role="status">{L("hist_err")}</p><button type="button" className="ghost-btn" data-history-retry="">{L("ux_retry")}</button></>;
  if (!DATA) return null;
  const r = DATA.region, nm = my ? r.my : r.en, tr = r.temp_trend_per_decade, i91 = r.years.indexOf(1991), i20 = r.years.indexOf(2020);
  const base = r.temp.slice(i91, i20 + 1).reduce((a, b) => a + b, 0) / (i20 - i91 + 1);
  const grp = ["el_nino", "la_nina", "neutral"].filter(k => r.jjas_by_enso[k]), top = Math.max(...grp.map(k => r.jjas_by_enso[k].mean_mm), 1), st = ensoStats(r, L);
  const evs = DATA.events.slice(-6).reverse();
  return (<>
    <div className="section-heading"><div><h3>{L("hist_title")}</h3><p className="muted">{nm} · {L("hist_hint")}</p></div><span className="source-tag">{L("hist_tag")}</span></div>
    <Picker s={s} x={x} />
    <h4>{L("hist_temp")} (°C)</h4><TempChart r={r} base={base} x={x} />
    <p><strong>{L("hist_trend_short", { v: num(Math.abs(tr).toFixed(2)), dir: L(tr >= 0 ? "hist_up" : "hist_down") })}</strong> <span className="muted">({num(r.temp_trend_ci95[0].toFixed(2))}–{num(r.temp_trend_ci95[1].toFixed(2))}°C)</span></p>
        <h4>{L("hist_rain_year")}</h4><RainYearChart r={r} x={x} />
    <h4>{L("hist_month_head")}</h4><MonthRows r={r} x={x} />
    <p className="muted">{L("hist_now")}: {num(r.clim_rain[x.month])} mm · {num(r.clim_temp[x.month])}°C</p>
    <h4>{L("hist_enso")}</h4>
    {grp.map(k => {
      const v = r.jjas_by_enso[k], w = (v.mean_mm / top * 100).toFixed(0);
      return <div key={k} className="hist-row"><div className="row-sb"><span>{L("hist_" + k)} <span className="muted">({L("hist_enso_n", { n: num(v.years) })})</span></span><strong>{num(v.mean_mm)} mm</strong></div><div className="hist-fill" data-w={w} style={{ width: w + "%" }}></div></div>;
    })}
    {st ? <><p><strong>{L("hist_vs_neutral", { pct: num(st.pct), dir: st.dir })}</strong> <span className="muted">({L("hist_el_nino")})</span></p></> : null}
    <details className="fold-card" data-detail-key="hist-about">
      <summary><span className="fold-t">{L("cmp_about_charts")}</span></summary>
      <Cap t={L("hist_cap_temp", { v: num(base.toFixed(1)) })} /><Cap t={L("hist_cap_rain_year")} /><Cap t={L("hist_cap_month")} />
      <Cap t={L("hist_cap_enso")} />{st ? <Cap t={L(st.sig ? "hist_sig" : "hist_nosig", { p: num(st.ps) })} /> : null}
    </details>
    {evs.length ? <details className="mc-details" data-detail-key="hist-events"><summary>{L("hist_more_events", { n: num(evs.length) })}</summary><ul>{evs.map((e, i) => <li key={i}><strong>{num(e.year)}-{num(String(e.month).padStart(2, "0"))}</strong> {e.name} <span className="muted">{e.severity}{e.source !== "dataset" ? " · " + L("hist_added") : ""}</span></li>)}</ul></details> : null}
    {DATA.distance_km > 120 ? <p className="muted">{L("hist_far", { km: num(DATA.distance_km), place: nm })}</p> : null}
  </>);
}

function Agri({ s, x }) {
  const { L, num, my } = x, { DATA, ENSO } = s;
  if (!DATA) return null;
  const r = DATA.region, st = ensoStats(r, L); if (!st) return null;
  const nm = my ? r.my : r.en;
  return (<>
    <div className="section-heading"><div><h3>{L("hist_agri_title")}</h3></div><span className="source-tag">{L("hist_tag")}</span></div>
    <p><strong>{st.sig ? L("hist_agri_line", { place: nm, n: num(st.el.years), pct: num(st.pct), dir: st.dir, a: num(st.el.mean_mm), b: num(st.ne.mean_mm) }) : L("hist_agri_nosig", { place: nm, pct: num(st.pct) })}</strong></p>
    {ENSO && ENSO.status ? <p className="muted">{L("hist_agri_now", { s: ENSO.status })}</p> : null}
  </>);
}

export function mountHistoryView() {
  return {
    draw: s => {
      const my = s.my;
      const x = { L: s.L, my, num: n => (my ? String(n).replace(/\d/g, d => "၀၁၂၃၄၅၆၇၈၉"[d]) : String(n)), month: s.month,
        MON: my ? ["ဇန်", "ဖေ", "မတ်", "ဧ", "မေ", "ဇွန်", "ဇူ", "ဩ", "စက်", "အောက်", "နို", "ဒီ"] : ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] };
      put("historyBody", <Today s={s} x={x} />);
      put("agriHistory", <Agri s={s} x={x} />);
    },
  };
}

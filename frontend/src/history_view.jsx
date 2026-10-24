// Climate history cards (Compare tab + Farming tab) in React. Data loading and events stay in history.js.
import { Fragment } from "react";
import { put } from "./slots.js";

const C_EL = "#c2410c", C_LA = "#1d4ed8", C_NE = "#6b7280", C_WARM = "#c2410c", C_COOL = "#1d4ed8", C_RAIN = "#0f766e";
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const nice = (lo, hi, n) => { const step = (hi - lo) / n; return Array.from({ length: n + 1 }, (_, i) => lo + step * i); };
const yearTicks = (y0, y1) => { const t = []; for (let y = y0; y <= y1; y += 10) t.push(y); if (y1 - t[t.length - 1] >= 5) t.push(y1); return t; };

function GridY({ ticks, Y, W, ml, mr, fmt }) {
  return ticks.map((t, i) => (
    <Fragment key={i}>
      <line x1={ml} x2={W - mr} y1={Y(t).toFixed(1)} y2={Y(t).toFixed(1)} stroke="currentColor" opacity=".13" />
      <text x={ml - 5} y={(Y(t) + 3.5).toFixed(1)} textAnchor="end" fontSize="10" fill="currentColor">{fmt(t)}</text>
    </Fragment>
  ));
}

function TempChart({ r, base, x }) {
  const { L, num } = x;
  const W = 320, H = 170, ml = 38, mr = 10, mt = 12, mb = 22, v = r.temp, ys = r.years, y0 = ys[0], y1 = ys[ys.length - 1];
  const lo = Math.floor((Math.min(...v, base) - .1) * 5) / 5, hi = Math.ceil((Math.max(...v, base) + .1) * 5) / 5, sp = (hi - lo) || 1;
  const X = y => ml + (y - y0) / (y1 - y0) * (W - ml - mr), Y = t => mt + (1 - (t - lo) / sp) * (H - mt - mb);
  const mx = mean(ys), my_ = mean(v), sxx = ys.reduce((a, y) => a + (y - mx) ** 2, 0), sl = ys.reduce((a, y, i) => a + (y - mx) * (v[i] - my_), 0) / sxx, ic = my_ - sl * mx;
  const line = v.map((t, i) => `${X(ys[i]).toFixed(1)},${Y(t).toFixed(1)}`).join(" ");
  const last = v[v.length - 1];
  return (<>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={L("hist_temp")}>
      <GridY ticks={nice(lo, hi, 3)} Y={Y} W={W} ml={ml} mr={mr} fmt={t => num(t.toFixed(1))} />
      {yearTicks(y0, y1).map(y => <text key={y} x={X(y).toFixed(1)} y={H - 5} textAnchor="middle" fontSize="10" fill="currentColor">{num(y)}</text>)}
      <polyline fill="none" stroke="currentColor" opacity=".3" strokeWidth="1.2" points={line} />
      <line x1={ml} x2={W - mr} y1={Y(base).toFixed(1)} y2={Y(base).toFixed(1)} stroke="currentColor" strokeDasharray="4 3" opacity=".6" />
      <line x1={X(y0).toFixed(1)} x2={X(y1).toFixed(1)} y1={Y(ic + sl * y0).toFixed(1)} y2={Y(ic + sl * y1).toFixed(1)} stroke={C_WARM} strokeWidth="2.4" strokeLinecap="round" />
      {v.map((t, i) => <circle key={i} cx={X(ys[i]).toFixed(1)} cy={Y(t).toFixed(1)} r={ys[i] === y1 ? 4 : 2.6} fill={t >= base ? C_WARM : C_COOL}><title>{num(ys[i])}: {num(t.toFixed(1))}°C</title></circle>)}
    </svg>
    <p className="hist-last"><strong>{L("hist_last", { y: num(y1), t: num(last.toFixed(1)), d: (last >= base ? "+" : "−") + num(Math.abs(last - base).toFixed(1)) })}</strong></p>
    <div className="hist-legend"><span><i className="lg-warm"></i>{L("hist_leg_warm")}</span><span><i className="lg-cool"></i>{L("hist_leg_cool")}</span><span><i className="lg-trend"></i>{L("hist_leg_trend")}</span></div>
  </>);
}

function RainYearChart({ r, x }) {
  const { L, num } = x;
  if (!r.rain || r.rain.length !== r.years.length) return null;
  const W = 320, H = 170, ml = 40, mr = 8, mt = 10, mb = 22, ys = r.years, v = r.rain, y0 = ys[0], y1 = ys[ys.length - 1], i91 = ys.indexOf(1991), i20 = ys.indexOf(2020);
  const avg = mean(v.slice(Math.max(0, i91), (i20 < 0 ? v.length : i20 + 1))), top = Math.ceil(Math.max(...v, avg) / 250) * 250;
  const bw = (W - ml - mr) / ys.length, X = i => ml + i * bw, Y = t => mt + (1 - t / top) * (H - mt - mb), col = { el_nino: C_EL, la_nina: C_LA };
  return (<>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={L("hist_rain_year")}>
      <GridY ticks={nice(0, top, 4)} Y={Y} W={W} ml={ml} mr={mr} fmt={t => num(Math.round(t))} />
      {v.map((t, i) => <rect key={i} x={(X(i) + bw * .12).toFixed(1)} y={Y(t).toFixed(1)} width={(bw * .76).toFixed(1)} height={(H - mb - Y(t)).toFixed(1)} rx="1" fill={col[(r.enso_by_year || {})[ys[i]]] || C_NE}><title>{num(ys[i])}: {num(t)} mm</title></rect>)}
      {yearTicks(y0, y1).map(y => <text key={y} x={(X(ys.indexOf(y)) + bw / 2).toFixed(1)} y={H - 5} textAnchor="middle" fontSize="10" fill="currentColor">{num(y)}</text>)}
      <line x1={ml} x2={W - mr} y1={Y(avg).toFixed(1)} y2={Y(avg).toFixed(1)} stroke="currentColor" strokeDasharray="4 3" strokeWidth="1.4" />
    </svg>
    <div className="hist-legend"><span><i className="lg-el"></i>{L("hist_el_nino")}</span><span><i className="lg-la"></i>{L("hist_la_nina")}</span><span><i className="lg-ne"></i>{L("hist_neutral")}</span><span><i className="lg-avg"></i>{L("hist_leg_avg")} {num(Math.round(avg))} mm</span></div>
  </>);
}

function MonthChart({ r, x }) {
  const { L, num, my, MON } = x;
  const W = 320, H = 180, ml = 36, mr = 34, mt = 14, mb = 22, cm = x.month, rain = r.clim_rain, t = r.clim_temp, MN = MON;
  const rt = Math.max(50, Math.ceil(Math.max(...rain) / 50) * 50), tl = Math.floor(Math.min(...t) - 1), th = Math.ceil(Math.max(...t) + 1), bw = (W - ml - mr) / 12;
  const X = i => ml + i * bw, YR = m => mt + (1 - m / rt) * (H - mt - mb), YT = c => mt + (1 - (c - tl) / ((th - tl) || 1)) * (H - mt - mb);
  const pts = t.map((c, i) => `${(X(i) + bw / 2).toFixed(1)},${YT(c).toFixed(1)}`).join(" ");
  return (<>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={L("hist_month")}>
      <GridY ticks={nice(0, rt, 4)} Y={YR} W={W} ml={ml} mr={mr} fmt={m => num(Math.round(m))} />
      {[tl, (tl + th) / 2, th].map((c, i) => <text key={i} x={W - mr + 5} y={(YT(c) + 3.5).toFixed(1)} fontSize="10" fill={C_WARM}>{num(Math.round(c))}°</text>)}
      {rain.map((m, i) => <rect key={i} x={(X(i) + bw * .14).toFixed(1)} y={YR(m).toFixed(1)} width={(bw * .72).toFixed(1)} height={(H - mb - YR(m)).toFixed(1)} rx="2" fill={C_RAIN} opacity={i === cm ? 1 : .45}><title>{MN[i]}: {num(m)} mm · {num(t[i])}°C</title></rect>)}
      <polyline fill="none" stroke={C_WARM} strokeWidth="2.2" points={pts} />
      {t.map((c, i) => <circle key={i} cx={(X(i) + bw / 2).toFixed(1)} cy={YT(c).toFixed(1)} r={i === cm ? 4.2 : 2.4} fill={C_WARM} />)}
      {MN.map((m, i) => <text key={i} x={(X(i) + bw / 2).toFixed(1)} y={H - 6} textAnchor="middle" fontSize={my ? 9.5 : 10} fontWeight={i === cm ? 700 : 400} fill="currentColor">{m}</text>)}
    </svg>
    <div className="hist-legend"><span><i className="lg-rain"></i>{L("hist_leg_rain")}</span><span><i className="lg-warm"></i>{L("hist_leg_temp")}</span></div>
  </>);
}

function ensoStats(r, L) {
  const e = r.jjas_by_enso, el = e.el_nino, ne = e.neutral;
  const c = (r.enso_vs_neutral || {}).el_nino, p = c && c.p != null ? c.p : null;
  return el && ne ? { el, ne, pct: Math.round(Math.abs(el.mean_mm - ne.mean_mm) / ne.mean_mm * 100), dir: L(el.mean_mm < ne.mean_mm ? "hist_less" : "hist_more"), p, sig: p != null && p < 0.05, ps: p == null ? "–" : (p < 0.001 ? "<0.001" : p.toFixed(3)) } : null;
}
const Cap = ({ t }) => <p className="muted fs85">{t}</p>;

function Picker({ s, x }) {
  const { L, my } = x, list = (s.DATA && s.DATA.regions) || [], cur = s.DATA && s.DATA.region_id;
  return (
    <div className="hist-pick"><label htmlFor="histRegion"><strong>{L("hist_region_pick")}</strong></label>
      <select key={s.REGION} id="histRegion" className="hist-select" data-cur={cur || ""} defaultValue={s.REGION}>
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
    <p><strong>{L("hist_trend_ci", { v: num(Math.abs(tr).toFixed(2)), dir: L(tr >= 0 ? "hist_up" : "hist_down"), lo: num(r.temp_trend_ci95[0].toFixed(2)), hi: num(r.temp_trend_ci95[1].toFixed(2)) })}</strong></p>
    <Cap t={L("hist_cap_temp", { v: num(base.toFixed(1)) })} />
    <h4>{L("hist_rain_year")}</h4><RainYearChart r={r} x={x} /><Cap t={L("hist_cap_rain_year")} />
    <h4>{L("hist_month")}</h4><MonthChart r={r} x={x} />
    <p className="muted">{L("hist_now")}: {num(r.clim_rain[x.month])} mm · {num(r.clim_temp[x.month])}°C</p><Cap t={L("hist_cap_month")} />
    <h4>{L("hist_enso")}</h4>
    {grp.map(k => {
      const v = r.jjas_by_enso[k], w = (v.mean_mm / top * 100).toFixed(0);
      return <div key={k} className="hist-row"><div className="row-sb"><span>{L("hist_" + k)} <span className="muted">({L("hist_enso_n", { n: num(v.years) })})</span></span><strong>{num(v.mean_mm)} mm</strong></div><div className="hist-fill" data-w={w} style={{ width: w + "%" }}></div></div>;
    })}
    {st ? <><p><strong>{L("hist_vs_neutral", { pct: num(st.pct), dir: st.dir })}</strong> <span className="muted">({L("hist_el_nino")})</span></p><p>{L(st.sig ? "hist_sig" : "hist_nosig", { p: num(st.ps) })}</p></> : null}
    <Cap t={L("hist_cap_enso")} />
    {evs.length ? <><h4>{L("hist_events")}</h4><ul>{evs.map((e, i) => <li key={i}><strong>{num(e.year)}-{num(String(e.month).padStart(2, "0"))}</strong> {e.name} <span className="muted">{e.severity}{e.source !== "dataset" ? " · " + L("hist_added") : ""}</span></li>)}</ul></> : null}
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

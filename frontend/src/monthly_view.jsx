// Compare tab: month-by-month temperature / rain against the 1991-2020 normal, in React. Data and events stay in monthly_compare.js.
import { put, clearSlot } from "./slots.js";

const MINUS = "−";
const COLORS = { temp: { pos: "#dc2626", neg: "#2563eb" }, rain: { pos: "#2563eb", neg: "#d97706" } };

/**
 * One row per month: the name, a bar that goes right when the month is above normal and left when below, and the number as plain text.
 * No axis and no numbers inside a drawing, so nothing can overlap on a narrow screen, and long Burmese month names have their own column.
 */
function Rows({ months, mode, x }) {
  const { L, digits, MON_LONG, fmt } = x;
  const key = mode === "temp" ? "temp_diff" : "rain_diff", C = COLORS[mode], u = mode === "temp" ? " °C" : " mm";
  const list = months.filter(m => m.status === "ok");
  const vals = list.map(m => m[key]);
  const pos = Math.max(0, ...vals), neg = Math.max(0, ...vals.map(v => -v)), span = (pos + neg) || 1;
  const zero = neg / span * 100;   // where the zero line sits, in % of the bar area: all-positive years start at the left edge
  const pending = months.length > list.length;
  return (
    <>
      <ol className="mc-rows" aria-label={L(mode === "temp" ? "mc_aria_temp" : "mc_aria_rain")}>
        {list.map((m, i) => {
          const v = vals[i], w = Math.max(v === 0 ? 0 : 2, Math.abs(v) / span * 100), c = v >= 0 ? C.pos : C.neg;
          const bar = { width: w.toFixed(1) + "%", [v >= 0 ? "left" : "right"]: (v >= 0 ? zero : 100 - zero).toFixed(1) + "%", "--c": c };
          return (
            <li key={m.month} className={`mc-row${m.partial ? " partial" : ""}`}>
              <span className="mc-m">{MON_LONG[m.month - 1]}{m.partial ? <small>{L("mc_days", { n: digits(m.days) })}</small> : null}</span>
              <span className="mc-bar" aria-hidden="true"><i className="mc-zero" style={{ left: zero.toFixed(1) + "%" }}></i><i className={`mc-fill${m.partial ? " hatch" : ""}`} style={bar}></i></span>
              <strong className={`mc-v ${v > 0 ? "pos" : v < 0 ? "neg" : ""}`}>{fmt(v, mode)}<small>{u}</small></strong>
            </li>
          );
        })}
      </ol>
      {pending ? <p className="muted fs85 mc-pending">{L("mc_pending")}</p> : null}
    </>
  );
}

const Sw = ({ c, h }) => <i className={`mc-sw${h ? " hatch" : ""}`} style={{ "--c": c }}></i>;

function Picker({ s, x }) {
  if (!s.REGIONS.length) return null;
  const { L, my } = x;
  return (
    <div className="hist-pick"><label htmlFor="mcRegion"><strong>{L("mc_region_pick")}</strong></label>
      <select key={s.REGION} id="mcRegion" className="hist-select" value={s.REGION}>
        <option value="">{L("mc_region_here")}</option>
        {s.REGIONS.map(r => <option key={r.id} value={r.id}>{my ? r.my : r.en}</option>)}
      </select></div>
  );
}

function place(s, x) {
  if (s.REGION && s.DATA?.region) return x.my ? s.DATA.region.my : s.DATA.region.en;
  const l = s.LOC || {}, my = x.my;
  const a = my ? (l.name || l.name_en) : (l.name_en || l.name), r = my ? (l.region_my || l.admin1) : (l.region || l.admin1_en || l.admin1);
  return [a, r].filter((v, i, arr) => v && arr.indexOf(v) === i).join(" · ");
}

function MonthlyView({ s }) {
  const my = s.my, L = s.L, digits = s.digits;
  const MON_SHORT = my ? ["ဇန်", "ဖေ", "မတ်", "ဧ", "မေ", "ဇွန်", "ဇူ", "ဩ", "စက်", "အောက်", "နို", "ဒီ"] : ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const MON_LONG = my ? ["ဇန်နဝါရီ", "ဖေဖော်ဝါရီ", "မတ်", "ဧပြီ", "မေ", "ဇွန်", "ဇူလိုင်", "ဩဂုတ်", "စက်တင်ဘာ", "အောက်တိုဘာ", "နိုဝင်ဘာ", "ဒီဇင်ဘာ"] : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const fmt = (v, mode) => {
    const d = mode === "temp" ? 1 : 0, r = Math.round(Math.abs(v) * 10 ** d) / 10 ** d;
    const t = d ? r.toFixed(1).replace(/\.0$/, "") : String(r);
    return (v > 0 && r !== 0 ? "+" : v < 0 && r !== 0 ? MINUS : "") + digits(t);
  };
  const x = { my, L, digits, MON_SHORT, MON_LONG, fmt };
  const head = <div className="section-heading"><div><h3>{L("mc_title")}</h3></div><span className="source-tag">ERA5</span></div>;
  const { DATA, FAIL, LOC, MODE } = s;
  if (FAIL) return <>{head}<Picker s={s} x={x} /><p className="muted" role="status">{L("mc_err")}</p><button type="button" className="ghost-btn" data-mc-retry="">{L("ux_retry")}</button></>;
  if (!LOC) return null;
  if (!DATA) return <>{head}<Picker s={s} x={x} /><p className="muted" role="status">{L("mc_loading")}</p></>;
  if (!DATA.available) return <>{head}<Picker s={s} x={x} /><p className="muted" role="status">{L("mc_unavail")}</p></>;
  const months = DATA.months || [], shown = months.filter(m => m.status === "ok");
  if (!shown.length) return <>{head}<Picker s={s} x={x} /><p className="muted" role="status">{L("mc_unavail")}</p></>;
  const partial = months.find(m => m.partial && m.status === "ok"), C = COLORS[MODE];
  const tab = (id, k) => <button type="button" role="tab" className={`mc-tab${MODE === id ? " active" : ""}`} data-mc-mode={id} aria-selected={MODE === id}>{L(k)}</button>;
  const sm = DATA.summary;
  let ytd = null;
  if (sm) {
    const t = (sm.temp_diff > 0 ? "+" : sm.temp_diff < 0 ? MINUS : "") + digits(Math.abs(sm.temp_diff).toFixed(1).replace(/\.0$/, ""));
    const pct = sm.rain_pct == null ? "" : ` (${L("mc_ytd_pct", { p: digits(sm.rain_pct) })})`;
    ytd = <p className="mc-ytd"><strong>{L("mc_ytd", { y: digits(DATA.year) })}</strong> {L("mc_ytd_rain", { r: digits(Math.round(sm.rain)) })}{pct} · {L("mc_ytd_temp", { t })}</p>;
  }
  const u = MODE === "temp" ? " °C" : " mm", d = MODE === "temp" ? 1 : 0, f = v => digits(Number(v).toFixed(d));
  return (<>
    {head}<Picker s={s} x={x} />
    <p className="muted mc-place"><strong>{place(s, x)}</strong></p>
    {ytd}
    <div className="mc-tabs" role="tablist" aria-label={L("mc_title")}>{tab("temp", "mc_tab_temp")}{tab("rain", "mc_tab_rain")}</div>
    <div className="mc-chart"><Rows months={months} mode={MODE} x={x} /></div>
    <div className="hist-legend">
      {MODE === "temp" ? <><span><Sw c={C.pos} />{L("mc_leg_warm")}</span><span><Sw c={C.neg} />{L("mc_leg_cool")}</span></> : <><span><Sw c={C.pos} />{L("mc_leg_wet")}</span><span><Sw c={C.neg} />{L("mc_leg_dry")}</span></>}
      {partial ? <span><Sw c="currentColor" h />{L("mc_leg_partial")}</span> : null}
    </div>
    <details className="mc-details" data-key="mc-table"><summary>{L("mc_table")}</summary><div className="cmp-scroll"><table className="cmp-table">
      <thead><tr><th scope="col">{L("mc_th_month")}</th><th scope="col">{L("mc_th_now")}</th><th scope="col">{L("mc_th_norm")}</th><th scope="col">{L("mc_th_diff")}</th></tr></thead>
      <tbody>{months.filter(m => m.status === "ok").map(m => {
        const now = MODE === "temp" ? m.temp : m.rain, nm = MODE === "temp" ? m.temp_normal : m.rain_normal, df = MODE === "temp" ? m.temp_diff : m.rain_diff;
        return <tr key={m.month}><th scope="row">{MON_LONG[m.month - 1]}{m.partial ? " *" : ""}</th><td>{f(now)}{u}</td><td>{f(nm)}{u}</td><td>{fmt(df, MODE)}{u}</td></tr>;
      })}</tbody></table></div></details>
    <details className="fold-card" data-detail-key="mc-about">
      <summary><span className="fold-t">{L("cmp_about_charts")}</span></summary>
    <p className="tiny muted">{L("mc_intro", { y: digits(DATA.year), a: digits(1991), b: digits(2020) })}</p>
    {DATA.data_through ? <p className="tiny muted">{L("mc_through", { d: s.fmtDay(DATA.data_through) })}</p> : null}
    {partial ? <p className="tiny muted">{L("mc_partial", { m: MON_LONG[partial.month - 1], n: digits(partial.days) })}</p> : null}
      <p className="tiny muted">{L("mc_source", { a: digits(1991), b: digits(2020) })}</p>
    </details>
  </>);
}

export function mountMonthlyView() {
  return {
    draw: s => put("monthlyCompareBody", <MonthlyView s={s} />),
    clear: () => clearSlot("monthlyCompareBody"),
  };
}

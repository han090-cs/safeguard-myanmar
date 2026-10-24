// Compare tab: month-by-month temperature / rain against the 1991-2020 normal, in React. Data and events stay in monthly_compare.js.
import { put, clearSlot } from "./slots.js";

const MINUS = "−";
const COLORS = { temp: { pos: "#dc2626", neg: "#2563eb" }, rain: { pos: "#2563eb", neg: "#d97706" } };

/** Rounded axis ticks symmetric around zero: [-2, -1, 0, 1, 2] x step. */
export function niceTicks(maxAbs, want = 2) {
  const raw = Math.max(maxAbs, 1e-6) / want, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const n = Math.max(1, Math.ceil(maxAbs / step - 1e-9));
  return { step, n, ticks: Array.from({ length: 2 * n + 1 }, (_, i) => (i - n) * step) };
}

function Chart({ months, mode, x }) {
  const { my, L, digits, MON_SHORT, MON_LONG, fmt } = x;
  const W = 340, H = 230, ml = 40, mr = 8, mt = 12, mb = 26, col = (W - ml - mr) / 12, LABEL = 15;
  const key = mode === "temp" ? "temp_diff" : "rain_diff", C = COLORS[mode];
  const vals = months.map(m => (m.status === "ok" ? m[key] : null));
  const maxAbs = Math.max(0, ...vals.filter(v => v != null).map(Math.abs));
  const plotH = H - mt - mb;
  let { n, step, ticks } = niceTicks(maxAbs);
  for (let i = 0; i < 4; i++) {
    const unit = plotH / (2 * n * step);
    if (maxAbs * unit + LABEL <= plotH / 2) break;
    n += 1; ticks = Array.from({ length: 2 * n + 1 }, (_, k) => (k - n) * step);
  }
  const top = n * step, Y = v => mt + (1 - (v + top) / (2 * top)) * plotH, y0 = Y(0);
  const unit = Math.abs(Y(top) - Y(0)) / top;
  const MN = MON_SHORT, ML = MON_LONG;
  const hatch = (id, c) => (
    <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill={c} opacity=".28" /><line x1="0" y1="0" x2="0" y2="5" stroke={c} strokeWidth="2.4" /></pattern>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={L(mode === "temp" ? "mc_aria_temp" : "mc_aria_rain")}>
      <defs>{hatch("mcHatchP" + mode, C.pos)}{hatch("mcHatchN" + mode, C.neg)}</defs>
      {ticks.map((t, i) => [
        <line key={"l" + i} x1={ml} x2={W - mr} y1={Y(t).toFixed(1)} y2={Y(t).toFixed(1)} stroke="currentColor" opacity={t === 0 ? 0.55 : 0.14} strokeWidth={t === 0 ? 1.4 : 1} />,
        <text key={"t" + i} x={ml - 5} y={(Y(t) + 3.5).toFixed(1)} textAnchor="end" fontSize="10" fill="currentColor" opacity=".85">{fmt(t, mode).replace(/^\+/, "").replace(MINUS + digits("0"), digits("0"))}</text>,
      ])}
      {months.map((m, i) => {
        const cx = ml + i * col + col / 2, v = vals[i];
        if (v == null) return null;
        const c = v >= 0 ? C.pos : C.neg, h = Math.max(1.5, Math.abs(v) * unit), y = v >= 0 ? y0 - h : y0;
        const fill = m.partial ? `url(#mcHatch${v >= 0 ? "P" : "N"}${mode})` : c;
        return (
          <rect key={"b" + i} x={(cx - col * 0.36).toFixed(1)} y={y.toFixed(1)} width={(col * 0.72).toFixed(1)} height={h.toFixed(1)} rx="2" fill={fill} {...(m.partial ? { stroke: c, strokeWidth: 1 } : {})}>
            <title>{ML[i]}: {fmt(v, mode)}{mode === "temp" ? " °C" : " mm"}</title></rect>
        );
      })}
      {months.map((m, i) => {
        const cx = ml + i * col + col / 2, v = vals[i];
        if (v == null) return null;
        const h = Math.max(1.5, Math.abs(v) * unit), y = v >= 0 ? y0 - h : y0, ly = v >= 0 ? y - 4 : y + h + 11;
        return <text key={"v" + i} x={cx.toFixed(1)} y={ly.toFixed(1)} textAnchor="middle" fontSize={my ? 9.5 : 10} fontWeight="700" fill="currentColor">{fmt(v, mode)}</text>;
      })}
      {months.map((m, i) => {
        const cx = ml + i * col + col / 2;
        return [
          <text key={"m" + i} x={cx.toFixed(1)} y={H - 8} textAnchor="middle" fontSize={my ? 9 : 10} fill="currentColor" opacity={m.status === "ok" ? 1 : 0.45}>{MN[i]}</text>,
          m.partial ? <circle key={"p" + i} cx={cx.toFixed(1)} cy={H - 2} r="1.6" fill="currentColor" opacity=".8" /> : null,
        ];
      })}
    </svg>
  );
}

const Sw = ({ c, h }) => <i className={`mc-sw${h ? " hatch" : ""}`} style={{ "--c": c }}></i>;

function Picker({ s, x }) {
  if (!s.REGIONS.length) return null;
  const { L, my } = x;
  return (
    <div className="hist-pick"><label htmlFor="mcRegion"><strong>{L("mc_region_pick")}</strong></label>
      <select key={s.REGION} id="mcRegion" className="hist-select" defaultValue={s.REGION}>
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
    <p className="muted">{L("mc_intro", { y: digits(DATA.year), a: digits(1991), b: digits(2020) })}</p>
    <div className="mc-tabs" role="tablist" aria-label={L("mc_title")}>{tab("temp", "mc_tab_temp")}{tab("rain", "mc_tab_rain")}</div>
    <div className="mc-chart"><Chart months={months} mode={MODE} x={x} /></div>
    <div className="hist-legend">
      {MODE === "temp" ? <><span><Sw c={C.pos} />{L("mc_leg_warm")}</span><span><Sw c={C.neg} />{L("mc_leg_cool")}</span></> : <><span><Sw c={C.pos} />{L("mc_leg_wet")}</span><span><Sw c={C.neg} />{L("mc_leg_dry")}</span></>}
      {partial ? <span><Sw c="currentColor" h />{L("mc_leg_partial")}</span> : null}
    </div>
    {DATA.data_through ? <p className="muted fs85">{L("mc_through", { d: s.fmtDay(DATA.data_through) })}</p> : null}
    {partial ? <p className="muted fs85">{L("mc_partial", { m: MON_LONG[partial.month - 1], n: digits(partial.days) })}</p> : null}
    <details className="mc-details" data-key="mc-table"><summary>{L("mc_table")}</summary><div className="cmp-scroll"><table className="cmp-table">
      <thead><tr><th scope="col">{L("mc_th_month")}</th><th scope="col">{L("mc_th_now")}</th><th scope="col">{L("mc_th_norm")}</th><th scope="col">{L("mc_th_diff")}</th></tr></thead>
      <tbody>{months.filter(m => m.status === "ok").map(m => {
        const now = MODE === "temp" ? m.temp : m.rain, nm = MODE === "temp" ? m.temp_normal : m.rain_normal, df = MODE === "temp" ? m.temp_diff : m.rain_diff;
        return <tr key={m.month}><th scope="row">{MON_LONG[m.month - 1]}{m.partial ? " *" : ""}</th><td>{f(now)}{u}</td><td>{f(nm)}{u}</td><td>{fmt(df, MODE)}{u}</td></tr>;
      })}</tbody></table></div></details>
    <p className="tiny muted">{L("mc_source", { a: digits(1991), b: digits(2020) })}</p>
  </>);
}

export function mountMonthlyView() {
  return {
    draw: s => put("monthlyCompareBody", <MonthlyView s={s} />),
    clear: () => clearSlot("monthlyCompareBody"),
  };
}

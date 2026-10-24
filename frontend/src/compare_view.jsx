// Compare tab (today vs the 1991-2020 ERA5 normal) in React. Data/state stay in compare.js; this file only draws.
import { Fragment } from "react";
import { put } from "./slots.js";

const ACC = "var(--accent,#0f766e)", W = 320;
const POS = { much_below_normal: 0, deficit: 0, below_normal: 1, near_normal: 2, above_normal: 3, surplus: 4, much_above_normal: 4 };

function makeFmt(my) {
  const digits = s => (my ? s.replace(/\d/g, x => "၀၁၂၃၄၅၆၇၈၉"[x]) : s);
  const num = (n, d = 1) => { let s = Number(n).toFixed(d); if (d > 0 && Number.isInteger(Number(s))) s = Number(s).toFixed(0); return digits(s); };
  const signed = (n, d = 1, u = "") => { const v = Number(n); const s = (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v), d); return s + (u ? " " + u : ""); };
  return { digits, num, signed };
}

const mv = (c, k) => { const m = (c.metrics || []).find(x => x.key === k); return m && m.value != null && isFinite(m.value) ? Number(m.value) : null; };
const dirOf = c => (/above|surplus/.test(c.level || "") ? "up" : /below|deficit/.test(c.level || "") ? "down" : c.level ? "in" : null);

function RangeChart({ title, value, lo, mid, hi, unit, from, to, f }) {
  const { num } = f, ml = 8, mr = 8, X = v => ml + (Math.min(to, Math.max(from, v)) - from) / (to - from) * (W - ml - mr);
  return (
    <svg viewBox={`0 0 ${W} 78`} width="100%" role="img" aria-label={`${title}: ${num(value)} ${unit}`}>
      <line x1={ml} x2={W - mr} y1="38" y2="38" stroke="currentColor" opacity=".25" strokeWidth="2" />
      <rect x={X(lo)} y="30" width={Math.max(2, X(hi) - X(lo))} height="16" rx="3" fill="#16a34a" opacity=".35" />
      <line x1={X(mid)} x2={X(mid)} y1="26" y2="50" stroke="currentColor" strokeWidth="2" />
      <circle cx={X(value)} cy="38" r="6.5" fill={ACC} stroke="#fff" strokeWidth="1.5" />
      <text x={X(value)} y="20" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">{num(value)} {unit}</text>
      {[lo, hi].map((v, i) => <text key={i} x={X(v)} y="68" textAnchor="middle" fontSize="12" fill="currentColor">{num(v)}</text>)}
      <text x={ml} y="68" fontSize="12" fill="currentColor" opacity=".6">{num(from, 0)}</text>
      <text x={W - mr} y="68" textAnchor="end" fontSize="12" fill="currentColor" opacity=".6">{num(to, 0)}</text>
    </svg>
  );
}

function Meter({ c, L }) {
  const pos = POS[c.level]; if (pos === undefined) return null;
  return (
    <div className="cmp-meter" aria-hidden="true">
      <div className="cmp-meter-bar">{[0, 1, 2, 3, 4].map(i => <span key={i} className={`cmp-seg${i === 2 ? " is-mid" : ""}${i === pos ? " is-on" : ""}`}></span>)}</div>
      <div className="cmp-meter-lbl"><span>{L("cmp_meter_low")}</span><span>{L("cmp_meter_norm")}</span><span>{L("cmp_meter_high")}</span></div>
    </div>
  );
}

function Pair({ a, b, unit, f }) {
  const { num } = f, mx = Math.max(a.v, b.v, 1);
  const bar = x => (
    <div className="cmp-bar"><div className="row-sb"><span>{x.l}</span><strong>{num(x.v, x.v < 1 ? 2 : 0)} {unit}</strong></div>
      <div className="cmp-fill" data-bg={x.c} data-w={Math.max(2, x.v / mx * 100).toFixed(0)} style={{ background: x.c, width: Math.max(2, x.v / mx * 100).toFixed(0) + "%" }}></div></div>
  );
  return <>{bar(a)}{bar(b)}</>;
}

function Tile({ c, loc, visual, stat, note }) {
  const d = dirOf(c), lab = loc(c.level_label), head = loc(c.headline);
  return (
    <div className={`cmp-blk${d ? " cmp-" + d : ""}`}><strong>{loc(c.title)}</strong>{lab ? <span className="cmp-state">{lab}</span> : null}
      {head ? <p className="cmp-head">{head}</p> : null}{visual}{stat ? <p className="cmp-stat">{stat}</p> : null}{note ? <p className="muted cmp-note">{note}</p> : null}</div>
  );
}

function Extra({ c, L, f, loc }) {
  const { num } = f, ms = (c.metrics || []).filter(m => m.value != null && isFinite(m.value)).slice(0, 6);
  if (!ms.length) return null;
  return <dl className="cmp-facts">{ms.map((m, i) => (
    <Fragment key={i}><dt>{loc(m.label)}</dt><dd>{num(Math.round(m.value * 100) / 100, Number.isInteger(m.value) ? 0 : 2)}{m.unit ? " " + (m.unit === "days" ? L("risk_days") : m.unit) : ""}</dd></Fragment>
  ))}</dl>;
}

export function CompareView({ cond, L, my }) {
  const f = makeFmt(my), { digits, num, signed } = f;
  const loc = o => (o && (o[my ? "my" : "en"] || o.en)) || "";
  const tiles = [], rows = [], lims = new Set(), srcs = new Set(); let up = 0, inn = 0, down = 0, n = 0;
  (cond && cond.conditions || []).forEach((c, idx) => {
    const d = dirOf(c); if (d) { n++; d === "up" ? up++ : d === "down" ? down++ : inn++; }
    (c.limitations || []).forEach(x => lims.add(loc(x))); (c.sources || []).forEach(x => srcs.add(x));
    const k = c.kind, title = loc(c.title); let done = false; const key = idx;
    if (k === "temperature_max" || k === "temperature_min") {
      const v = mv(c, k === "temperature_max" ? "forecast_tmax" : "forecast_tmin"), lo = mv(c, "normal_p10"), hi = mv(c, "normal_p90"), mid = mv(c, "normal_mean");
      if ([v, lo, hi, mid].every(x => x != null)) {
        const pad = Math.max(1, (hi - lo) * .6), diff = v - mid, st = v < lo ? "cmp_below" : v > hi ? "cmp_above" : "cmp_in";
        tiles.push(<Tile key={key} c={c} loc={loc}
          visual={<RangeChart title={title} value={v} lo={lo} mid={mid} hi={hi} unit="°C" from={Math.floor(Math.min(lo, v) - pad)} to={Math.ceil(Math.max(hi, v) + pad)} f={f} />}
          stat={<strong>{L("cmp_diff_mean")}: {signed(diff, 1, "°C")}</strong>} note={`${L("cmp_t_band")} (${num(lo)}–${num(hi)} °C); ${L("cmp_normal")} ${num(mid)} °C`} />);
        rows.push([title, `${num(v)} °C`, `${num(mid)} °C`, `${num(lo)}–${num(hi)} °C (${L("cmp_ref_t")})`, signed(diff, 1, "°C"), st, d, loc(c.level_label)]); done = true;
      }
    } else if (k === "rain_30d") {
      const v = mv(c, "total_30d"), lo = mv(c, "normal_q33"), hi = mv(c, "normal_q67"), mid = mv(c, "normal_median");
      if ([v, lo, hi, mid].every(x => x != null)) {
        const diff = v - mid, pct = mid > 0 ? Math.round(v / mid * 100) : null, st = v < lo ? "cmp_below" : v > hi ? "cmp_above" : "cmp_in";
        tiles.push(<Tile key={key} c={c} loc={loc}
          visual={<RangeChart title={title} value={v} lo={lo} mid={mid} hi={hi} unit="mm" from={0} to={Math.ceil(Math.max(hi * 1.4, v * 1.1, 10))} f={f} />}
          stat={<strong>{L("cmp_diff_med")}: {signed(diff, 0, "mm")}{pct != null ? ` · ${L("cmp_pct", { p: num(pct, 0) })}` : ""}</strong>} note={`${L("cmp_r_band")} (${num(lo)}–${num(hi)} mm); ${L("cmp_normal")} ${num(mid)} mm`} />);
        rows.push([title, `${num(v, 0)} mm`, `${num(mid, 0)} mm`, `${num(lo, 0)}–${num(hi, 0)} mm (${L("cmp_ref_r")})`, signed(diff, 0, "mm") + (pct != null ? ` (${num(pct, 0)}%)` : ""), st, d, loc(c.level_label)]); done = true;
      }
    } else if (k === "water_balance_14d") {
      const p = mv(c, "rain_14d"), e = mv(c, "et0_14d");
      if (p != null && e != null) {
        tiles.push(<Tile key={key} c={c} loc={loc} visual={<Pair a={{ l: L("cmp_rain14"), v: p, c: "#2563eb" }} b={{ l: L("cmp_et14"), v: e, c: "#d97706" }} unit="mm" f={f} />}
          stat={<strong>{L("cmp_net")}: {signed(p - e, 0, "mm")}</strong>} note={L("cmp_wb")} />);
        rows.push([title, `${num(p, 0)} mm`, `${num(e, 0)} mm`, "—", signed(p - e, 0, "mm"), null, d, loc(c.level_label)]); done = true;
      }
    } else if (k === "soil_moisture") {
      const nw = mv(c, "soil_moisture_now"), o = mv(c, "soil_moisture_7d_ago");
      if (nw != null && o != null) {
        tiles.push(<Tile key={key} c={c} loc={loc} visual={<Pair a={{ l: L("cmp_soil_now"), v: nw, c: "#0f766e" }} b={{ l: L("cmp_soil_prev"), v: o, c: "#94a3b8" }} unit="" f={f} />}
          stat={<strong>{L("cmp_soil_chg")}: {signed(nw - o, 2)}</strong>} note={L("cmp_soil")} />);
        rows.push([title, num(nw, 2), num(o, 2), "—", signed(nw - o, 2), null, d, loc(c.level_label)]); done = true;
      }
    }
    if (!done) tiles.push(<Tile key={key} c={c} loc={loc} visual={<><Meter c={c} L={L} /><Extra c={c} L={L} f={f} loc={loc} /></>} stat="" note="" />);
  });
  const limList = [...lims].filter(Boolean), srcList = [...srcs];
  const head = (<>
    <div className="section-heading"><div><h3>{L("cmp_title")}</h3></div><span className="source-tag">ERA5 1991–2020</span></div>
    <p className="agri-note tier-mid" role="note">{L("cmp_visible_caveat")}</p>
  </>);
  if (!tiles.length) return <>{head}<p className="muted">{L("cmp_none")}</p></>;
  const chip = (cls, k, v) => v ? <span className={`cmp-chip ${cls}`}><strong>{L("cmp_n", { n: num(v, 0) })}</strong> {L(k)}</span> : null;
  const stTxt = (s, lab) => (s ? L(s) : lab || "—");
  const upd = cond && cond.generated_at ? <p className="muted">{L("cmp_m_upd")}: {digits(String(cond.generated_at).replace("T", " ").replace(/:\d\d(\.\d+)?Z?$/, ""))} UTC</p> : null;
  return (<>
    {head}
    {n ? <div className="cmp-sum"><span>{L("cmp_sum_lead", { n: num(n, 0) })}</span>{chip("up", "cmp_sum_up", up)}{chip("in", "cmp_sum_in", inn)}{chip("down", "cmp_sum_down", down)}</div> : null}
    <div className="cmp-how"><strong>{L("cmp_how")}</strong><span className="cmp-lg"><i className="lg-band"></i>{L("cmp_lg_band")}</span><span className="cmp-lg"><i className="lg-dot"></i>{L("cmp_lg_today")}</span><span className="cmp-lg"><i className="lg-mid"></i>{L("cmp_lg_mid")}</span><p className="muted">{L("cmp_read")}</p></div>
    <div className="cmp-grid">{tiles}</div>
    {rows.length ? (
      <details className="cmp-details"><summary>{L("cmp_tbl_title")}</summary><div className="cmp-scroll"><table className="cmp-table"><thead><tr>{["cmp_th_ind", "cmp_th_now", "cmp_th_norm", "cmp_th_range", "cmp_th_diff", "cmp_th_state"].map(k => <th key={k} scope="col">{L(k)}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><th scope="row">{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td><td>{stTxt(r[5], r[7])}</td></tr>)}</tbody></table></div></details>
    ) : null}
    <details className="cmp-details"><summary>{L("cmp_method_title")}</summary>
      <ul className="cmp-method"><li>{L("cmp_m1")}</li><li>{L("cmp_m2")}</li><li>{L("cmp_m3")}</li></ul>
      {limList.length ? <><p className="mwr-label"><strong>{L("cmp_m_lim")}</strong></p><ul className="cmp-method">{limList.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
      {srcList.length ? <p className="muted">{L("cmp_m_src")}: {srcList.join("; ")}</p> : null}{upd}
    </details>
  </>);
}

export function mountCompareView(id = "compareCharts") {
  return (cond, L, my) => { put(id, <CompareView cond={cond} L={L} my={my} />); };
}

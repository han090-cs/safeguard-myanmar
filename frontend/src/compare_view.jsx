// Compare tab (today vs the 1991-2020 ERA5 normal) in React. Data/state stay in compare.js; this file only draws.
import { Fragment } from "preact";
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

function Meter({ c, L, pos: at, t }) {
  const pos = at !== undefined ? at : POS[c.level]; if (pos === undefined) return null;
  return (
    <div className="cmp-meter" aria-hidden="true">
      <div className="cmp-meter-bar">{[0, 1, 2, 3, 4].map(i => <span key={i} className={`cmp-seg${i === 2 ? " is-mid" : ""}${i === pos ? " is-on" : ""}`}></span>)}</div>
      <div className="cmp-meter-lbl"><span>{L(t ? "cmp_meter_cool" : "cmp_meter_low")}</span><span>{L("cmp_meter_norm")}</span><span>{L(t ? "cmp_meter_warm" : "cmp_meter_high")}</span></div>
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

function Tile({ c, loc, big, say, visual, normal, extra }) {
  // when the plain sentence is there, the state pill would say the same thing twice
  const d = dirOf(c), lab = loc(c.level_label), head = loc(c.headline);
  return (
    <div className={`cmp-blk${d ? " cmp-" + d : ""}`}>
      <div className="cmp-top"><strong className="cmp-title">{loc(c.title)}</strong>{lab && !say ? <span className="cmp-state">{lab}</span> : null}</div>
      {big}{say}{visual}{normal}
      {head && !big ? <p className="cmp-head">{head}</p> : null}{extra}
    </div>
  );
}

// one plain sentence under the number: what it means in everyday words
const Say = ({ d, children }) => <p className={`cmp-say${d ? " " + d : ""}`}>{children}</p>;
const posOf = (c, d) => (POS[c.level] !== undefined ? POS[c.level] : d === "up" ? 3 : d === "down" ? 1 : 2);

// the one big number of a tile, with its difference from normal as a coloured chip
function Big({ value, unit, delta, d, aria }) {
  return (
    <div className="cmp-big"><span className="cmp-val">{value}{unit ? <small>{unit}</small> : null}</span>
      {delta ? <span className={`cmp-delta${d ? " " + d : ""}`} aria-label={aria}>{delta}</span> : null}</div>
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
    const d = dirOf(c);
    if (d) { n++; d === "up" ? up++ : d === "down" ? down++ : inn++; }
    (c.limitations || []).forEach(x => lims.add(loc(x))); (c.sources || []).forEach(x => srcs.add(x));
    const k = c.kind, title = loc(c.title); let done = false; const key = idx;
    if (k === "temperature_max" || k === "temperature_min") {
      const v = mv(c, k === "temperature_max" ? "forecast_tmax" : "forecast_tmin"), lo = mv(c, "normal_p10"), hi = mv(c, "normal_p90"), mid = mv(c, "normal_mean");
      if ([v, lo, hi, mid].every(x => x != null)) {
        const diff = v - mid, st = v < lo ? "cmp_below" : v > hi ? "cmp_above" : "cmp_in", dd = num(Math.abs(diff), 1) + " °C";
        tiles.push(<Tile key={key} c={c} loc={loc}
          big={<Big value={num(v)} unit=" °C" d={d} aria={`${L("cmp_diff_mean")}: ${signed(diff, 1, "°C")}`} />}
          say={<Say d={d}>{d === "up" ? L("cmp_say_t_up", { d: dd }) : d === "down" ? L("cmp_say_t_down", { d: dd }) : L("cmp_say_t_in")}</Say>}
          visual={<Meter c={c} L={L} pos={posOf(c, d)} t />}
          normal={<p className="cmp-normal"><span>{L("cmp_lg_band")}</span> <strong>{num(lo)}–{num(hi)} °C</strong></p>} />);
        rows.push([title, `${num(v)} °C`, `${num(mid)} °C`, `${num(lo)}–${num(hi)} °C (${L("cmp_ref_t")})`, signed(diff, 1, "°C"), st, d, loc(c.level_label)]); done = true;
      }
    } else if (k === "rain_30d") {
      const v = mv(c, "total_30d"), lo = mv(c, "normal_q33"), hi = mv(c, "normal_q67"), mid = mv(c, "normal_median");
      if ([v, lo, hi, mid].every(x => x != null)) {
        const diff = v - mid, pct = mid > 0 ? Math.round(v / mid * 100) : null, st = v < lo ? "cmp_below" : v > hi ? "cmp_above" : "cmp_in";
        tiles.push(<Tile key={key} c={c} loc={loc}
          big={<Big value={num(v, 0)} unit=" mm" d={d} aria={`${L("cmp_diff_med")}: ${signed(diff, 0, "mm")}`} />}
          say={<Say d={d}>{L(d === "up" ? "cmp_say_r_up" : d === "down" ? "cmp_say_r_down" : "cmp_say_r_in")}</Say>}
          visual={<Meter c={c} L={L} pos={posOf(c, d)} />}
          normal={<p className="cmp-normal"><span>{L("cmp_lg_band")}</span> <strong>{num(lo, 0)}–{num(hi, 0)} mm</strong>{pct != null ? <em>{L("cmp_pct", { p: num(pct, 0) })}</em> : null}</p>} />);
        rows.push([title, `${num(v, 0)} mm`, `${num(mid, 0)} mm`, `${num(lo, 0)}–${num(hi, 0)} mm (${L("cmp_ref_r")})`, signed(diff, 0, "mm") + (pct != null ? ` (${num(pct, 0)}%)` : ""), st, d, loc(c.level_label)]); done = true;
      }
    } else if (k === "water_balance_14d") {
      const p = mv(c, "rain_14d"), e = mv(c, "et0_14d");
      if (p != null && e != null) {
        tiles.push(<Tile key={key} c={c} loc={loc}
          big={<Big value={signed(p - e, 0)} unit=" mm" delta="" d={d} />}
          say={p !== e ? <Say d={d}>{L(p > e ? "cmp_say_w_pos" : "cmp_say_w_neg", { n: num(Math.abs(p - e), 0) })}</Say> : null}
          visual={<><p className="cmp-cap">{L("cmp_net")}</p><Pair a={{ l: L("cmp_rain14"), v: p, c: "#2563eb" }} b={{ l: L("cmp_et14"), v: e, c: "#d97706" }} unit="mm" f={f} /></>}
          extra={<p className="muted cmp-note">{L("cmp_wb")}</p>} />);
        rows.push([title, `${num(p, 0)} mm`, `${num(e, 0)} mm`, "—", signed(p - e, 0, "mm"), null, d, loc(c.level_label)]); done = true;
      }
    } else if (k === "soil_moisture") {
      const nw = mv(c, "soil_moisture_now"), o = mv(c, "soil_moisture_7d_ago");
      if (nw != null && o != null) {
        tiles.push(<Tile key={key} c={c} loc={loc}
          big={<Big value={num(nw, 2)} unit="" d={d} aria={`${L("cmp_soil_chg")}: ${signed(nw - o, 2)}`} />}
          say={<Say d={d}>{L(Math.abs(nw - o) < 0.01 ? "cmp_say_s_same" : nw > o ? "cmp_say_s_up" : "cmp_say_s_down")}</Say>}
          visual={<Pair a={{ l: L("cmp_soil_now"), v: nw, c: "#0f766e" }} b={{ l: L("cmp_soil_prev"), v: o, c: "#94a3b8" }} unit="" f={f} />}
          extra={<p className="muted cmp-note">{L("cmp_soil")}</p>} />);
        rows.push([title, num(nw, 2), num(o, 2), "—", signed(nw - o, 2), null, d, loc(c.level_label)]); done = true;
      }
    }
    if (!done) tiles.push(<Tile key={key} c={c} loc={loc} visual={<><Meter c={c} L={L} /><Extra c={c} L={L} f={f} loc={loc} /></>} />);
  });
  const limList = [...lims].filter(Boolean), srcList = [...srcs];
  const head = (<>
    <div className="section-heading"><div><h3>{L("cmp_title")}</h3></div><span className="source-tag">ERA5 1991–2020</span></div>
    <p className="muted cmp-short" role="note">{L("cmp_short_note")}</p>
  </>);
  if (!tiles.length) return <>{head}<p className="muted">{L("cmp_none")}</p></>;
  const chip = (cls, k, v) => v ? <span className={`cmp-chip ${cls}`}><strong>{L("cmp_n", { n: num(v, 0) })}</strong> {L(k)}</span> : null;
  const stTxt = (s, lab) => (s ? L(s) : lab || "—");
  const upd = cond && cond.generated_at ? <p className="muted">{L("cmp_m_upd")}: {digits(String(cond.generated_at).replace("T", " ").replace(/:\d\d(\.\d+)?Z?$/, ""))} UTC</p> : null;
  return (<>
    {head}
    {n ? <div className="cmp-sum" role="status"><span>{L("cmp_sum_lead", { n: num(n, 0) })}</span>{chip("up", "cmp_sum_up", up)}{chip("in", "cmp_sum_in", inn)}{chip("down", "cmp_sum_down", down)}</div> : null}
    <div className="cmp-grid">{tiles}</div>
    {rows.length ? (
      <details className="cmp-details"><summary>{L("cmp_tbl_title")}</summary><div className="cmp-scroll"><table className="cmp-table"><thead><tr>{["cmp_th_ind", "cmp_th_now", "cmp_th_norm", "cmp_th_range", "cmp_th_diff", "cmp_th_state"].map(k => <th key={k} scope="col">{L(k)}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><th scope="row">{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td><td>{stTxt(r[5], r[7])}</td></tr>)}</tbody></table></div></details>
    ) : null}
    <details className="cmp-details"><summary>{L("cmp_method_title")}</summary>
      <ul className="cmp-method"><li>{L("cmp_visible_caveat")}</li><li>{L("cmp_read")}</li><li>{L("cmp_t_band")}</li><li>{L("cmp_r_band")}</li><li>{L("cmp_m1")}</li><li>{L("cmp_m2")}</li><li>{L("cmp_m3")}</li></ul>
      {limList.length ? <><p className="mwr-label"><strong>{L("cmp_m_lim")}</strong></p><ul className="cmp-method">{limList.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
      {srcList.length ? <p className="muted">{L("cmp_m_src")}: {srcList.join("; ")}</p> : null}{upd}
    </details>
  </>);
}

export function mountCompareView(id = "compareCharts") {
  return (cond, L, my) => { put(id, <CompareView cond={cond} L={L} my={my} />); };
}

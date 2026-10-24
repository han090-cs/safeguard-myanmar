// Moon-day card, SOS quick guide, emergency numbers and crop-disease watch in React. Calendar maths, i18n and place lookup stay in
// field_guides.js and emergency_card.js, which pass ready-made text.
import { Fragment } from "react";
import { put } from "./slots.js";

const Tel = ({ n }) => <a className="em-num" href={n.href}>{n.n}</a>;
const Nums = ({ nums }) => nums.map((n, i) => <Fragment key={i}>{i ? " · " : null}<Tel n={n} /></Fragment>);
const NatRows = ({ nat }) => nat.map((x, i) => <li key={i}><span>{x.label}</span><Tel n={x} /></li>);

function Moon({ s }) {
  return (
    <>
      <div className="section-heading"><div><h3>{s.title}</h3></div></div>
      <div className="moon-row"><span className="moon-icon" aria-hidden="true">{s.icon}</span>
        <div><strong>{s.line}</strong><br /><span className="muted">{s.year}{s.watat ? " · " + s.watat : ""}</span></div></div>
      <ul className="kv-list">{s.rows.map((r, i) => <li key={i}><span>{r.label}<br /><small className="muted">{r.sub}</small></span><b>{r.day}</b></li>)}</ul>
      {s.tide ? <p className={"agri-note tier-" + s.tide.tone}>{s.tide.text}</p> : null}
      <p className="tiny muted">{s.approx}</p>
    </>
  );
}
export function mountMoonView() { return s => put("moonCard", s ? <Moon s={s} /> : null); }

function SosItems({ s }) {
  return (
    <>
      {s.items.map((it, i) => <details className="sos-item" key={i}><summary>{it.title}</summary><ol className="guide-list">{it.steps.map((t, j) => <li key={j}>{t}</li>)}</ol></details>)}
      <p className="tiny muted">{s.numbers}</p>
    </>
  );
}
export function mountSosView() {
  return {
    card: s => put("sosCard", <><div className="section-heading"><div><h3>{s.title}</h3><p className="muted">{s.sub}</p></div></div><SosItems s={s} /></>),
    body: s => put("sosBody", <><SosItems s={s} /><ul className="em-list"><NatRows nat={s.nat} /></ul></>),
  };
}

export function mountEmergencyView() {
  return s => put("emergencyCard", (
    <>
      <div className="section-heading"><div><h3>📞 {s.title}</h3><p className="muted">{s.sub}</p></div></div>
      <ul className="em-list"><NatRows nat={s.nat} /></ul>
      {s.reg ? <><h4>{s.reg.title}</h4><ul className="em-list">{s.reg.rows.map((r, i) => <li key={i}><span>{r.label}</span><span className="em-nums"><Nums nums={r.nums} /></span></li>)}</ul></>
        : <p className="tiny muted">{s.notVerified}</p>}
      <h4>{s.dmh.title}</h4><ul className="em-list"><li><span>{s.dmh.label}</span><span className="em-nums"><Nums nums={s.dmh.nums} /></span></li></ul>
      <p className="tiny muted">{s.sources}</p>
    </>
  ));
}

export function mountDiseaseView() {
  return s => put("diseaseCard", s ? (
    <>
      <div className="section-heading"><div><h3>{s.title}</h3><p className="muted">{s.sub}</p></div></div>
      {s.hits.length ? <><ul className="guide-list">{s.hits.map((h, i) => <li key={i}>{h}</li>)}</ul><p className="tiny muted">{s.act}</p></> : <p className="agri-note tier-wet">{s.none}</p>}
    </>
  ) : null);
}

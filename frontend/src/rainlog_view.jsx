// "Did it rain?" card in React. Storage, the forecast snapshot and the answer logic stay in rainlog.js, which passes a ready-made model.
import { put } from "./slots.js";

function Btns({ list, on, pressed }) {
  return <div className="rl-btns">{list.map(b => (
    <button key={b.a} type="button" className="ghost-btn" data-rl={b.id} data-a={b.a}
      {...(pressed ? { "aria-pressed": b.on } : {})} onClick={() => on.answer(b.id, b.a)}>{b.label}</button>))}</div>;
}

function Card({ s }) {
  return (
    <>
      <div className="section-heading"><div><h3>☔ {s.head}</h3></div></div>
      {s.open.length ? s.open.map(x => (
        <div className="rl-ask" key={x.id}><strong>{x.day}</strong> <span className="muted">{x.fc}{x.auto ? " · " + x.auto : ""}</span><Btns list={x.btns} on={s.on} /></div>
      )) : <p className="muted">{s.none}</p>}
      {s.answered.length ? (
        <details open={s.editOpen} data-detail-key="rl-edit"><summary>{s.editLabel}</summary>
          {s.answered.map(x => <div className="rl-ask" key={x.id}><strong>{x.day}</strong><Btns list={x.btns} on={s.on} pressed /></div>)}
        </details>
      ) : null}
      <details className="mc-details rl-more" data-detail-key="rl-more"><summary>{s.moreLabel}</summary>
      <h4>{s.statsHead}</h4>
      {s.rows.map((r, i) => (
        <div className="rl-row" key={i}><div className="row-sb"><span>{r.label}</span><strong>{r.text}</strong></div>
          {r.w != null ? <div className="rl-fill" data-w={r.w} style={{ width: r.w + "%" }}></div> : null}</div>
      ))}
      <h4>{s.accHead}</h4>
      {s.acc ? <><p><strong>{s.acc.text}</strong></p><div className="rl-fill" data-w={s.acc.pct} style={{ width: s.acc.pct + "%" }}></div><p className="muted">{s.acc.note}</p></> : <p className="muted">{s.accFew}</p>}
      {s.brier.strong ? <p><strong>{s.brier.text}</strong></p> : <p className="muted">{s.brier.text}</p>}
      <p className="muted">{s.src}</p>
      </details>
      {s.canArchive ? <button type="button" className="ghost-btn" data-rl-clear="1" onClick={s.on.clear}>{s.archiveLabel}</button> : null}
      {s.failed ? <p role="alert">{s.failed}</p> : null}
      {s.undo ? <button type="button" className="ghost-btn" data-rl-undo="" onClick={s.on.undo}>{s.undo}</button> : null}
      {s.restore ? <button type="button" className="ghost-btn" data-rl-restore="" onClick={s.on.restore}>{s.restore}</button> : null}
    </>
  );
}

export function mountRainLogView() { return s => put("rainLogCard", s ? <Card s={s} /> : null); }

// "What matters today" panel, its compact home list and the "compared with normal" cards in React.
// risk_panel.js keeps the requests, cache, offline copy, state and the public MWRisk API; it passes ready-made text (no HTML) to these components.
// Everything is drawn as React text nodes, so API text can never be parsed as markup.
import { put } from "./slots.js";

const Sr = ({ t }) => <span className="mwr-sr">{t}</span>;
const Glyph = ({ g }) => <span className="mwr-glyph" aria-hidden="true">{g}</span>;
const Badge = ({ b }) => <span className={"mwr-class mwr-class--" + b.c}><Glyph g={b.glyph} />{" " + b.text}</span>;
const Ico = ({ s }) => (s ? <span className="mwr-icon" aria-hidden="true">{s}</span> : null);
const Links = ({ list }) => list.map((x, i) => <li key={i}>{x.href ? <a href={x.href} target="_blank" rel="noopener noreferrer">{x.text}</a> : x.text}</li>);

function Head({ h }) { return h ? <div className="mwr-head"><h2 className="mwr-title">{h.title}</h2><p className="mwr-subtitle">{h.subtitle}</p></div> : null; }

function Why({ w }) {
  return (
    <details className="mwr-why" data-detail-key={w.key}>
      <summary>{w.summary}</summary>
      <dl className="mwr-facts">{w.rows.flatMap((r, i) => [<dt key={"t" + i}>{r[0]}</dt>, <dd key={"d" + i}>{r[1]}</dd>])}</dl>
      {w.drivers ? <div><p className="mwr-label">{w.drivers.label}</p><ul className="mwr-drivers">{w.drivers.list.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null}
      {w.lims ? <div lang={w.lims.lang || undefined}><p className="mwr-label">{w.lims.label}</p><ul className="mwr-drivers">{w.lims.list.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null}
      <p className="mwr-tags"><span className="mwr-tag">{w.tagModel}</span>{w.tagProv ? <span className="mwr-tag mwr-tag--review">{w.tagProv}</span> : null}</p>
      {w.srcs ? <div><p className="mwr-label">{w.srcs.label}</p><ol className="mwr-src-list"><Links list={w.srcs.list} /></ol></div>
        : w.btn ? <button type="button" className="mwr-link-btn" disabled={w.btn.disabled} onClick={w.btn.onClick}>{w.btn.text}</button> : null}
      <div className="mwr-sources">
        {w.box ? (w.box.kind === "loading" ? <p className="mwr-muted" role="status">{w.box.text}</p>
          : w.box.kind === "error" ? <p className="mwr-muted">{w.box.text}</p>
          : <ol className="mwr-src-list"><Links list={w.box.list} /></ol>) : null}
      </div>
    </details>
  );
}

function OfficialSource({ o }) { return o ? <p className={o.cls}>{o.text}</p> : null; }

function Item({ it }) {
  return (
    <li className={"mwr-item mwr-sev-" + it.sev + " mwr-cls-" + it.cls}>
      <div className="mwr-item-top"><Badge b={it.badge} /><span className="mwr-pill">{it.pill}</span><span className="mwr-when"><Sr t={it.whenLabel} />{it.when}</span></div>
      <h3 className="mwr-what"><Ico s={it.icon} />{it.headline}</h3>
      <p className="mwr-sowhat"><Sr t={it.soWhatLabel} />{it.soWhat}</p>
      <div className="mwr-next"><p className="mwr-label">{it.nextLabel}</p><p>{it.next}</p></div>
      {it.who ? <div className="mwr-who"><p className="mwr-label">{it.who.label}</p><ul className="mwr-chips">{it.who.list.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null}
      <Why w={it.why} />
    </li>
  );
}

function Outlook({ o }) {
  return (
    <details className="mwr-outlook" open={o.open || undefined} onToggle={o.onToggle}>
      <summary>{o.summary}</summary>
      <div className="mwr-outlook-body">
        {o.body ? (o.body.kind === "loading" ? <p className="mwr-muted" role="status">{o.body.text}</p>
          : o.body.kind === "error" ? <p className="mwr-muted">{o.body.text}</p>
          : <OutlookBody b={o.body} />) : null}
      </div>
    </details>
  );
}

function OutlookBody({ b }) {
  return (
    <>
      <h3 className="mwr-subhead">{b.head}</h3>
      {!b.rows.length ? <p className="mwr-muted">{b.none}</p> : <ul className="mwr-outlook-list">{b.rows.map((r, i) => (
        <li className={"mwr-outlook-row mwr-sev-" + r.sev} key={i}><span className="mwr-pill">{r.pill}</span><span className="mwr-outlook-name">{r.name}</span><span className="mwr-outlook-days">{r.days}</span></li>))}</ul>}
      {b.cards.length ? <>
        <h3 className="mwr-subhead">{b.seasonal}</h3>
        <p className="mwr-tags"><span className="mwr-tag">{b.infoTag}</span>{b.prov ? <span className="mwr-tag mwr-tag--review">{b.prov}</span> : null}</p>
        <ul className="mwr-cards">{b.cards.map((c, i) => <li className="mwr-card" key={i}><p>{c}</p></li>)}</ul>
      </> : null}
    </>
  );
}

function Panel({ m }) {
  if (m.loading) return <><Head h={m.head} /><p className="mwr-status" role="status">{m.loading}</p></>;
  if (m.error) return <><Head h={m.head} /><div className={"mwr-message" + (m.error.outside ? "" : " mwr-message--error")} role="status"><p>{m.error.msg}</p>{m.error.retry ? <button type="button" className="mwr-retry" onClick={m.error.onRetry}>{m.error.retry}</button> : null}</div></>;
  return (
    <>
      <Head h={m.head} />
      {m.offline ? <p className="mwr-offline" role="status">{m.offline}</p> : null}
      {m.official.map((w, i) => (
        <section className="mwr-official" role="alert" key={i}>
          <p className="mwr-official-tag"><Glyph g={w.glyph} />{" " + w.tag}</p>
          <h3 className="mwr-official-title">{w.title}</h3>
          {w.summary ? <p>{w.summary}</p> : null}
          <p className="mwr-muted">{w.issued}{w.until}</p>
          {w.url ? <a href={w.url} target="_blank" rel="noopener noreferrer">{w.readOfficial}</a> : null}
        </section>
      ))}
      {m.none ? <div className="mwr-message" role="status"><p>{m.none.text}</p><p className="mwr-muted">{m.none.note}</p></div>
        : <ol className="mwr-list">{m.items.map((it, i) => <Item it={it} key={it.why.key + i} />)}</ol>}
      <Outlook o={m.outlook} />
      <footer className="mwr-foot">
        <OfficialSource o={m.foot.official} />
        <p className="mwr-muted">{m.foot.last ? <span className={m.foot.last.cls || undefined}>{m.foot.last.text}</span> : ""}{m.foot.sources ? " · " + m.foot.sources : ""}{m.foot.stale ? <strong className="mwr-stale">{" · " + m.foot.stale}</strong> : null}</p>
      </footer>
    </>
  );
}

function Summary({ m }) {
  if (m.msg) return <p className="mwr-muted" role="status">{m.msg}</p>;
  return (
    <>
      {m.offline ? <p className="mwr-offline" role="status">{m.offline}</p> : null}
      {m.official.map((w, i) => (
        <div className="mwr-sum-official" role="alert" key={i}>
          <Badge b={w.badge} />
          <p className="mwr-what">{w.title}</p>
          <p className="mwr-muted">{w.until}{w.url ? " · " : ""}{w.url ? <a href={w.url} target="_blank" rel="noopener noreferrer">{w.readOfficial}</a> : null}</p>
        </div>
      ))}
      {m.none ? <p className="mwr-sum-none">{m.none}</p> : (
        <ol className="mwr-sum-list">{m.items.map((it, i) => (
          <li className={"mwr-sum-item mwr-cls-" + it.cls} key={it.why.key + i}>
            <div className="mwr-item-top"><Badge b={it.badge} /><span className="mwr-when"><Sr t={it.whenLabel} />{it.when}</span></div>
            <p className="mwr-what"><Ico s={it.icon} />{it.headline}</p>
            <details className="mwr-sum-more"><summary>{it.canDo}</summary><p>{it.next}</p>{it.who ? <ul className="mwr-chips" aria-label={it.who.label}>{it.who.list.map((x, j) => <li key={j}>{x}</li>)}</ul> : null}</details>
            <Why w={it.why} />
          </li>))}</ol>
      )}
      <div className="mwr-sum-foot">
        <OfficialSource o={m.foot.official} />
        {m.foot.providers ? <p className="mwr-providers">{m.foot.providers}</p> : null}
        {m.foot.last ? <p className={m.foot.last.cls}>{m.foot.last.text}</p> : null}
        {m.foot.seeAll ? <button type="button" className="mwr-link-btn" onClick={m.foot.seeAll.onClick}>{m.foot.seeAll.text}</button> : null}
      </div>
    </>
  );
}

function Conditions({ m }) {
  if (m.loading) return <p className="mwr-muted" role="status">{m.loading}</p>;
  if (m.msg) return <p className="mwr-muted" role="status">{m.msg}</p>;
  return (
    <>
      {m.list.length ? <ul className="mwr-cond-list">{m.list.map((c, i) => (
        <li className={"mwr-cond-item" + (c.lvl ? " mwr-lvl-" + c.lvl : "")} key={i}>
          <p className="mwr-cond-title"><Ico s={c.icon} />{c.title}{c.agri ? <span className="mwr-tag">{c.agri}</span> : null}</p>
          {c.level ? <p className="mwr-level">{c.glyph ? <Glyph g={c.glyph} /> : null}{c.level}</p> : null}
          <p>{c.headline}</p>
          <details className="mwr-why"><summary>{c.details}</summary>
            <dl className="mwr-facts">{c.metrics.flatMap((x, j) => [<dt key={"t" + j}>{x[0]}</dt>, <dd key={"d" + j}>{x[1]}</dd>])}</dl>
            {c.lims ? <div><p className="mwr-label">{c.lims.label}</p><ul className="mwr-drivers">{c.lims.list.map((x, j) => <li key={j}>{x}</li>)}</ul></div> : null}
            {c.sources ? <p className="mwr-muted">{c.sources}</p> : null}
          </details>
        </li>))}</ul> : <p className="mwr-muted">{m.none}</p>}
      <footer className="mwr-foot">{m.last ? <p className="mwr-muted">{m.last}</p> : null}</footer>
    </>
  );
}

export function mountRiskView() {
  return {
    panel: (id, m) => put(id, m ? <Panel m={m} /> : null),
    summary: (id, m) => put(id, m ? <Summary m={m} /> : null),
    conditions: (id, m) => put(id, m ? <Conditions m={m} /> : null),
  };
}

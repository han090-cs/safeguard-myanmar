// Lab tab: the leaf check. leaf.js keeps the state and the rules and passes a ready-made model; this file only draws it.
import { put } from "./slots.js";

function Guide({ g, T, scope }) {
  if (!g) return null;
  return (
    <details className="lf-guide" data-detail-key={`lf-g-${scope}-${g.id}`}>
      <summary>{T("leaf_m_guide")}</summary>
      <p className="tiny muted">{g.sci} · {g.kind}</p>
      <h5>{T("leaf_m_signs")}</h5><p>{g.signs}</p>
      <h5>{T("leaf_m_prevent")}</h5><ul>{g.prevent.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {g.similar && g.similar.length ? (
        <>
          <h5>{T("leaf_m_similar")}</h5>
          <ul className="lf-similar">{g.similar.map(x => <li key={x.id}><b>{x.name}</b> — {x.signs}</li>)}</ul>
        </>
      ) : null}
    </details>
  );
}

function Bar({ p }) { return <div className="lf-bar" aria-hidden="true"><i data-w={p} style={{ width: p + "%" }}></i></div>; }

function Photo({ m }) {
  const { T, photo: ph, on } = m;
  return (
    <section className="lf-res" aria-labelledby="leafPhT" id="leafPhoto">
      <h4 id="leafPhT">{T("leaf_ph_title")}</h4>
      {!ph.supported ? <p className="muted">{T("leaf_ph_nocrop", { crop: ph.crop || "—" })}</p> : (
        <div aria-live="polite">
          {ph.state === "idle" ? (
            <button type="button" id="leafPhRun" className="ghost-btn lf-run" onClick={on.check}>{ph.first ? T("leaf_ph_run_first", { mb: ph.mb }) : T("leaf_ph_run")}</button>
          ) : null}
          {ph.state === "busy" ? (
            <div role="status" className="lf-busy">
              <p>{ph.loading ? T("leaf_ph_dl", { done: ph.done, total: ph.total }) : T("leaf_ph_busy")}</p>
              {ph.loading ? <Bar p={Math.round(ph.frac * 100)} /> : null}
            </div>
          ) : null}
          {ph.state === "err" ? (
            <div role="alert"><p>{ph.err}</p><button type="button" id="leafPhRetry" className="ghost-btn" onClick={on.check}>{T("leaf_retry")}</button></div>
          ) : null}
          {ph.res ? (
            <>
              <p className={"lf-status s-" + ph.res.status} id="leafPhLine"><strong>{ph.res.line}</strong></p>
              {ph.res.items.length ? (
                <ul className="lf-list" id="leafPhItems">
                  {ph.res.items.map(it => (
                    <li key={it.cls}>
                      <div className="row-sb"><span>{it.name}</span><b>{it.pct}%</b></div>
                      <Bar p={it.pct} />
                      <Guide g={it.guide} T={T} scope="ph" />
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="tiny muted">{ph.res.stamp}</p>
              <details className="lf-facts" data-detail-key="lf-facts"><summary>{T("leaf_ph_facts_title")}</summary><p>{ph.res.facts}</p></details>
            </>
          ) : null}
        </div>
      )}
      {ph.supported ? <p className="tiny muted">{T("leaf_ph_note")}</p> : null}
    </section>
  );
}

function AI({ m }) {
  const { T, ai, on } = m;
  if (!ai.show) return null;
  return (
    <section className="lf-res" aria-labelledby="leafAiT" id="leafAi">
      <h4 id="leafAiT">{T("leaf_ai_title")}</h4>
      {!ai.usable ? (
        <>
          <p id="leafAiNeed">{T("leaf_key_need")}</p>
          <button type="button" id="leafAiGoKey" className="ghost-btn lf-run" onClick={on.keyGo}>{T("leaf_key_goto")}</button>
        </>
      ) : null}
      <div aria-live="polite" hidden={!ai.usable}>
        {ai.state === "idle" || ai.state === "err" ? <button type="button" id="leafAiRun" className="ghost-btn lf-run" onClick={on.ask}>{T("leaf_ai_run")}</button> : null}
        {ai.state === "busy" ? <p role="status">{T("leaf_ai_busy")}</p> : null}
        {ai.err ? <p role="alert" id="leafAiErr">{ai.err}</p> : null}
        {ai.res ? (
          <>
            {ai.res.issue ? <p className="lf-status s-unsure" id="leafAiIssue">{ai.res.issue}</p> : null}
            {ai.res.healthy ? <p className="lf-status s-sure">{T("leaf_ai_healthy")}</p> : null}
            {ai.res.none && !ai.res.issue ? <p className="muted">{T("leaf_ai_none")}</p> : null}
            {ai.res.matches.length ? (
              <ul className="lf-list" id="leafAiItems">
                {ai.res.matches.map(x => (
                  <li key={x.id}>
                    <div className="row-sb"><span>{x.name}</span><span className={"lf-conf c-" + x.confKey}>{x.conf}</span></div>
                    {x.why ? <p className="tiny">{x.why}</p> : null}
                    <Guide g={x.guide} T={T} scope="ai" />
                  </li>
                ))}
              </ul>
            ) : null}
            {ai.res.other ? <p className="tiny"><strong>{T("leaf_ai_other")}</strong> {ai.res.other}</p> : null}
            <p className="tiny muted">{ai.res.stamp}</p>
          </>
        ) : null}
      </div>
      {ai.usable ? <p className="tiny muted">{ai.note}</p> : null}
    </section>
  );
}

/** The visitor's own AI key: its own card in the Lab. A password field that is NOT in a <form>, so the browser does not offer to store it. */
function Key({ m }) {
  const { T, on } = m, k = m.key;
  if (!k.show) return null;
  const save = () => { const inp = document.getElementById("leafKeyIn"); if (inp && on.keySave(inp.value)) inp.value = ""; };
  return (
    <section className="lf-res lf-key" aria-labelledby="leafKeyT" id="leafKey">
      <h4 id="leafKeyT">{T("leaf_key_title")}</h4>
      <p>{T("leaf_key_intro")}</p>
      <p className="tiny muted">{T("leaf_key_how")}</p>
      {k.has ? <p className="lf-status s-sure" id="leafKeyHas">{T("leaf_key_has", { masked: k.masked })}</p> : null}
      {k.bad ? <p className="lf-status s-unsure" id="leafKeyBad" role="alert">{T("leaf_key_bad")}</p> : null}
      <div className="lf-keybox">
        <label htmlFor="leafKeyIn" className="tiny">{T(k.has ? "leaf_key_label_new" : "leaf_key_label")}</label>
        <input id="leafKeyIn" className="lf-input" type="password" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="sk-ant-…" aria-describedby="leafKeyMsg" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
        <label className="lf-check" htmlFor="leafKeyRemember">
          <input type="checkbox" id="leafKeyRemember" checked={k.remember} onChange={e => on.keyRemember(e.target.checked)} />
          <span>{T("leaf_key_remember")}</span>
        </label>
        <div className="lf-actions">
          <button type="button" id="leafKeySave" className="ghost-btn lf-primary" onClick={save}>{T("leaf_key_save")}</button>
          {k.has ? <button type="button" id="leafKeyRm" className="ghost-btn lf-danger" onClick={on.keyRemove}>{T("leaf_key_remove")}</button> : null}
        </div>
      </div>
      <div id="leafKeyMsg" aria-live="polite">
        {k.note === "format" ? <p role="alert" id="leafKeyFormat">{T("leaf_key_err_format")}</p> : null}
        {k.note === "ok" ? <p id="leafKeyOk">{T("leaf_key_ok")}</p> : null}
        {k.note === "removed" ? <p id="leafKeyGone">{T("leaf_key_removed")}</p> : null}
      </div>
      <p className="tiny muted">{T("leaf_key_where")} <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">{T("leaf_key_link")}</a></p>
      <p className="tiny muted">{T("leaf_key_limit", { n: k.n })}</p>
      {k.shared ? <p className="tiny muted">{T("leaf_key_shared", { n: k.sharedN })}</p> : null}
    </section>
  );
}

function Signs({ m }) {
  const { T } = m;
  return (
    <section className="lf-res" aria-labelledby="leafMT" id="leafMatches">
      <h4 id="leafMT">{T("leaf_m_title")}</h4>
      {m.matchNote === "need" ? <p className="muted">{T("leaf_m_need")}</p> : null}
      {m.matchNote === "one" ? <p className="muted">{T("leaf_m_one")}</p> : null}
      {m.matchNote === "none" ? <p className="muted">{T("leaf_m_none")}</p> : null}
      {m.matches.length ? (
        <ul className="lf-list">
          {m.matches.map(x => (
            <li key={x.id} data-level={x.level}>
              <div className="row-sb"><b>{x.name}</b><span className={"lf-lv lv-" + x.level}>{x.levelText}</span></div>
              <p className="tiny muted">{x.hit}</p>
              <Guide g={x.guide} T={T} scope="sg" />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Others({ m }) {
  const { T } = m;
  if (!m.others || !m.others.length) return null;
  return (
    <details className="lf-res lf-fold" id="leafOther" data-detail-key="lf-oc">
      <summary>{T("leaf_oc_title")}</summary>
      <p className="tiny muted">{T("leaf_oc_clue")}</p>
      <ul className="lf-list">
        {m.others.map(o => <li key={o.id} data-cause={o.id}><b>{o.title}</b><p className="tiny">{o.text}</p></li>)}
      </ul>
      <details className="lf-guide" data-detail-key="lf-help">
        <summary>{T("leaf_help_title")}</summary>
        <p>{T("leaf_help")}</p>
      </details>
    </details>
  );
}

const HS = [["spray", 7], ["heat", 4], ["water", 6], ["snake", 5]];
const SRC = [
  ["FAO — pesticide safety", "https://www.fao.org/3/x5048e/x5048E0j.htm"],
  ["WHO — snakebite envenoming", "https://www.who.int/teams/control-of-neglected-tropical-diseases/snakebite-envenoming/treatment"],
  ["WHO — dengue", "https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue"],
  ["WHO — diarrhoeal disease", "https://www.who.int/news-room/fact-sheets/detail/diarrhoeal-disease"],
  ["WHO — heat and health", "https://www.who.int/news-room/fact-sheets/detail/climate-change-heat-and-health"],
  ["CDC — leptospirosis", "https://www.cdc.gov/leptospirosis/about/index.html"],
  ["TNAU — rice nutrient disorders", "https://agritech.tnau.ac.in/agriculture/agri_cropproduction_cereals_rice_tranpudlow_mainfield_nutrient_mgmt_deficiency.html"],
  ["Iowa State Extension — disease or environmental stress", "https://yardandgarden.extension.iastate.edu/how-to/biotic-vs-abiotic-distinguishing-disease-problems"],
];

function Health({ m }) {
  const { T } = m;
  return (
    <details className="lf-res lf-fold lf-health" id="leafHealth" data-detail-key="lf-hs">
      <summary>{T("leaf_hs_title")}</summary>
      <p className="tiny muted">{T("leaf_hs_intro")}</p>
      {HS.map(([g, n]) => (
        <details className="lf-guide" key={g} data-detail-key={`lf-hs-${g}`} id={`leafHs-${g}`}>
          <summary>{T(`leaf_hs_${g}_t`)}</summary>
          <ul>{Array.from({ length: n }, (_, i) => <li key={i}>{T(`leaf_hs_${g}_${i + 1}`)}</li>)}</ul>
        </details>
      ))}
      <details className="lf-guide" data-detail-key="lf-hs-src">
        <summary>{T("leaf_hs_src")}</summary>
        <p className="tiny muted">{T("leaf_src_note")}</p>
        <ul className="tiny">{SRC.map(([n, u]) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{n}</a></li>)}</ul>
      </details>
    </details>
  );
}

function Log({ m }) {
  const { T, log, on } = m;
  return (
    <section className="lf-log" aria-labelledby="leafLogT" id="leafLog">
      <h4 id="leafLogT">{T("leaf_log_title")}</h4>
      {log.rows.length ? (
        <>
          <div className="lf-table-wrap" tabIndex={0} role="region" aria-labelledby="leafLogT">
            <table className="lf-table">
              <thead><tr>{log.cols.map(c => <th key={c.id} scope="col">{c.h}</th>)}</tr></thead>
              <tbody>{log.rows.map(r => <tr key={r.id}>{log.cols.map(c => <td key={c.id}>{r[c.id] || "—"}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="lf-actions">
            <button type="button" id="leafCsv" className="ghost-btn" onClick={on.csv}>{T("leaf_csv")}</button>
            <button type="button" id="leafClear" className={"ghost-btn" + (m.clearArmed ? " lf-danger" : "")} onClick={on.clear}>{m.clearArmed ? T("leaf_clear_sure", { n: log.n }) : T("leaf_clear")}</button>
          </div>
        </>
      ) : <p className="muted" id="leafLogEmpty">{T("leaf_log_empty")}</p>}
      <p className="tiny muted">{log.note}</p>
    </section>
  );
}

function Sheet({ m }) {
  const { T, photo: ph, on } = m;
  const nOn = m.groups.reduce((n, g) => n + g.items.filter(x => x.on).length, 0);
  const pick = id => e => { on.photo(e.target.files && e.target.files[0]); e.target.value = ""; void id; };
  return (
    <>
      <div className="section-heading"><div><h3>{T("leaf_title")}</h3></div></div>
      <p className="muted lf-sub">{T("leaf_sub")}</p>
      <ol className="lf-steps">
        <li className="lf-step">
          <h4 className="lf-h" id="leafH1">{T("leaf_s1")}</h4>
          <select id="leafCrop" className="lf-select" aria-labelledby="leafH1" value={m.crop} onChange={e => on.crop(e.target.value)}>
            <option value="">{T("leaf_crop_ph")}</option>
            {m.crops.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </li>
        <li className="lf-step">
          <h4 className="lf-h" id="leafH2">{T("leaf_s2")}</h4>
          <p className="tiny muted">{T("leaf_photo_hint")}</p>
          {ph.src ? <img className="lf-thumb" id="leafThumb" src={ph.src} alt={T("leaf_photo_alt")} /> : null}
          <div className="lf-actions">
            <button type="button" id="leafCamBtn" className="ghost-btn" onClick={() => document.getElementById("leafCam")?.click()}>{T("leaf_cam")}</button>
            <button type="button" id="leafGalBtn" className="ghost-btn" onClick={() => document.getElementById("leafGal")?.click()}>{T("leaf_gal")}</button>
            {ph.src ? <button type="button" id="leafRm" className="ghost-btn" onClick={on.remove}>{T("leaf_rm")}</button> : null}
          </div>
          <input type="file" id="leafCam" accept="image/*" capture="environment" hidden onChange={pick("cam")} />
          <input type="file" id="leafGal" accept="image/*" hidden onChange={pick("gal")} />
          {ph.bad ? <p role="alert" id="leafPhotoBad">{T("leaf_photo_bad")}</p> : null}
          {ph.quality && ph.quality.length ? (
            <div className="lf-q" id="leafQ" role="status">
              <p className="tiny muted">{T("leaf_q_title")}</p>
              <ul>{ph.quality.map(q => <li key={q.id} data-q={q.id}>{q.text}</li>)}</ul>
            </div>
          ) : null}
          <details className="lf-guide lf-tips" id="leafTips" data-detail-key="lf-tips">
            <summary>{T("leaf_tips_title")}</summary>
            <ol>{[1, 2, 3, 4, 5, 6].map(i => <li key={i}>{T("leaf_tip_" + i)}</li>)}</ol>
          </details>
        </li>
        <li className="lf-step">
          <details className="lf-fold" id="leafSigns" data-detail-key="lf-signs">
          <summary><span className="lf-h" id="leafH3">{T("leaf_s3")}</span>{nOn ? <b className="lf-count">{nOn}</b> : null}</summary>
          <p className="tiny muted">{T("leaf_signs_hint")}</p>
          {m.groups.map(g => (
            <fieldset className="lf-group" key={g.g}>
              <legend>{g.label}</legend>
              <div className="lf-chips">
                {g.items.map(s => <button key={s.id} type="button" id={"leafSy-" + s.id} className={"lf-chip" + (s.on ? " on" : "")} aria-pressed={s.on} onClick={() => on.sign(s.id)}>{s.label}</button>)}
              </div>
            </fieldset>
          ))}
          </details>
        </li>
      </ol>
      {m.crop ? (
        <div className="lf-results">
          {ph.has ? <Photo m={m} /> : null}
          <AI m={m} />
          <Signs m={m} />
          <Others m={m} />
          <div className="lf-actions">
            <button type="button" id="leafSave" className="ghost-btn lf-primary" disabled={!m.canSave} onClick={on.save}>{T("leaf_save")}</button>
            <button type="button" id="leafReset" className="ghost-btn" onClick={on.reset}>{T("leaf_reset")}</button>
          </div>
          {m.saved === "ok" ? <p role="status" id="leafSaved">{T("leaf_saved")}</p> : null}
          {m.saved === "fail" ? <p role="alert" id="leafSaveFail">{T("leaf_save_fail")}</p> : null}
        </div>
      ) : null}
      <Key m={m} />
      <Log m={m} />
      <Health m={m} />
      <p className="tiny muted lf-foot">{T("leaf_foot")}</p>
    </>
  );
}

export function mountLeafView() { return m => put("leafCard", m ? <Sheet m={m} /> : null); }

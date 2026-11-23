// Farming tab VIEW in React. It only draws; data loading, navigation, tabs and region logic stay in agri.js.
// Markup (tags, classes, ids, data-attributes) is kept identical to the former string templates so styles and tests still apply.
import { Fragment } from "preact";
import { put } from "./slots.js";

const EN_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const NUM = ["၁","၂","၃","၄","၅","၆","၇","၈","၉","၁၀","၁၁","၁၂"];
const inR = (m, rs) => !!rs && rs.some(([a, b]) => (a <= b ? m >= a && m <= b : m >= a || m <= b));

// ctx: { L, my, MY (burmese month names), RES, DATA, month }
function useHelpers(ctx) {
  const { L, my, MY, RES } = ctx;
  const mn = m => (my ? MY : EN_MONTHS)[m - 1];
  const tx = (o, k) => (my ? o[k + "_my"] : o[k + "_en"]) || o[k + "_en"] || "";
  const fmt = rs => rs.map(([a, b]) => (a === b ? mn(a) : mn(a) + "–" + mn(b))).join(", ");
  const nextPlant = (c, m) => {
    if (!c.plant) return null;
    for (let k = 1; k <= 12; k++) { const mm = ((m - 1 + k) % 12) + 1; if (inR(mm, c.plant)) return mm; }
    return null;
  };
  return { L, my, mn, tx, fmt, nextPlant, RES };
}

const Mark = ({ v }) =>
  v === "v" ? <span className="vt vt-v" title="verified">✅</span>
  : v === "p" ? <span className="vt vt-p" title="partly verified">◐</span>
  : <span className="vt vt-u" title="owner document only">📄</span>;

const Badge = ({ c, L }) => <span className={`evb evb-${c}`}>{L("agrx_b_" + c)}</span>;

const joinDot = nodes => nodes.flatMap((n, i) => (i ? [" · ", n] : [n]));

function SrcLink({ id, RES }) {
  const s = RES && RES.sources[id];
  if (!s) return <>{id}</>;
  return <a href={s.url} target="_blank" rel="noopener noreferrer">{id}</a>;
}
const SrcLinks = ({ ids, RES }) => joinDot(ids.map(id => <SrcLink key={id} id={id} RES={RES} />));

function SrcRow({ id, RES }) {
  const s = RES.sources[id];
  if (!s) return <li>[{id}]</li>;
  return <li>[{id}] {s.publisher} — <a href={s.url} target="_blank" rel="noopener noreferrer">{s.source_title}</a> · {s.publication_or_reference_date}</li>;
}

const FIELD_KEYS = ["season","sowing","harvest","irrigation","water","soil","constraints","management","yield"];

function CropCard({ c, h }) {
  const { L, my, RES, tx } = h;
  const rows = [], unknown = [];
  for (const k of FIELD_KEYS) {
    const f = c.fields[k];
    if (f.state === "value") {
      let v = my ? f.my : f.en;
      if (k === "yield" && c.source_ids.includes("SRC001") && RES.sources.SRC001) v += ` (${L("agrx_ref")}: ${RES.sources.SRC001.publication_or_reference_date})`;
      rows.push(<div className="kv" key={k}><b>{L("agrx_f_" + k)}:</b> {v}</div>);
    } else if (f.state === "unknown") unknown.push(L("agrx_f_" + k));
  }
  return (
    <li className="crop plant">
      <div className="crop-top"><b>{my ? c.crop_my : c.crop_en}</b> <span className="tiny muted">{my ? c.type_my : c.type_en}</span> <Badge c={c.quality_class} L={L} /></div>
      <div className="tiny muted">{my ? c.quality_my : c.quality_en}</div>
      {rows}
      {unknown.length ? <div className="kv unk"><b>{L("agrx_unknown_list")}:</b> {unknown.join(", ")} — {L("agrx_unknown_hint")}</div> : null}
      <div className="tiny muted"><SrcLinks ids={c.source_ids} RES={RES} /></div>
    </li>
  );
}

function MonthBar({ c, m, my }) {
  return (
    <div className="mbar" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => i + 1).map(k => {
        const pl = inR(k, c.plant), hv = inR(k, c.harvest);
        return <i key={k} className={`mb ${pl && hv ? "both" : pl ? "pl" : hv ? "hv" : ""}${k === m ? " cur" : ""}`}>{my ? NUM[k - 1] : k}</i>;
      })}
    </div>
  );
}

function FarmHead({ ctx, rg, failed, loading, onRetry }) {
  const h = useHelpers(ctx), { L, tx, mn } = h;
  if (!ctx.RES || !ctx.DATA) {
    return (<>
      <div><h3>🌾 {L("farm_farming")}</h3><p className="muted">{failed ? L("agrx_error") : L("agrx_loading")}</p></div>
      {failed ? <button type="button" className="ghost-btn" onClick={onRetry}>{L("ux_retry")}</button> : null}
    </>);
  }
  return (<>
    <div><h3>🌾 {rg ? tx(rg, "name") : L("agrx_pick_title")}</h3>
      <p className="muted">{rg ? <>{L("farm_month")}: <b>{mn(ctx.month)}</b></> : L("agrx_pick_hint")}</p></div>
    <label className="region-pick"><span className="sr-only">{L("agrx_change")}</span>
      <select key={rg ? rg.id : ""} id="agriRegionSel" className="location-select" value={rg ? rg.id : ""}>
        <option value="">{L("agrx_select_ph")}</option>
        {ctx.RES.regions.map(r => <option key={r.id} value={r.id}>{tx(r, "name")}</option>)}
      </select></label>
  </>);
}

function Now({ ctx, rg }) {
  const h = useHelpers(ctx), { L, my, tx, mn, fmt, nextPlant, RES } = h, { DATA, month: m } = ctx;
  if (!rg) return (<>
    {/* the card above already says "pick a zone" and has the dropdown: no second heading here */}
    <ul className="region-list">{RES.regions.map(r => (
      <li key={r.id}><button type="button" className="region-btn" data-region={r.id}><b>{tx(r, "name")}</b><span className="tiny muted">{tx(r, "scope")}</span></button></li>
    ))}</ul>
  </>);
  const zk = rg.calendar_zone, z = zk && DATA.zones[zk];
  const typeKey = /overlay/i.test(rg.type_en) ? "agrx_type_overlay" : "agrx_type_aez";
  const mine = z ? DATA.crops.filter(c => c.zones.includes(zk)) : [];
  const active = mine.filter(c => inR(m, c.plant) || inR(m, c.harvest));
  const nx = z && !active.length ? mine.map(c => ({ c, n: nextPlant(c, m) })).filter(x => x.n).sort((a, b) => ((a.n - m + 12) % 12) - ((b.n - m + 12) % 12))[0] : null;
  const g = z ? DATA.monthly_general[String(m)] : null;
  return (<>
    {/* what to do this month comes first; the zone background is one folded card (the name is already in the card above) */}
    <h4>🌱 {L("farm_do_now")}</h4>
    {!z ? <p className="agri-note tier-mid">{L("agrx_cal_none")}</p> : (<>
      <p className="tiny muted">{L("agrx_cal_from", { zone: my ? z.my : z.en })}{rg.calendar_broad ? " " + L("agrx_cal_broad") : ""}</p>
      {!active.length ? (
        <p className="agri-note">{L("farm_month_not_main_sowing_harvest")}{nx ? <> {L("farm_next_up")}: <b>{my ? nx.c.my : nx.c.en}</b> ({mn(nx.n)})</> : ""}</p>
      ) : (
        <ul className="crop-list">{active.map(c => {
          const pl = inR(m, c.plant), hv = inR(m, c.harvest);
          return (<li key={c.en} className={`crop ${hv ? "harvest" : "plant"}`}>
            <div className="crop-top"><b>{my ? c.my : c.en}</b> <Mark v={c.v} /></div>
            <div className="crop-badges">{pl ? <span className="bd bd-plant">🌱 {L("farm_sow_now")}</span> : null}{hv ? <span className="bd bd-harvest">🌾 {L("farm_harvest_now")}</span> : null}</div>
          </li>);
        })}</ul>
      )}
      {g ? (<>
        <h4>{L("farm_general_tasks_month")} <Mark v="u" /></h4>
        <ul className="beh"><li><b>{L("farm_land_prep")}:</b> {g.prep}</li><li><b>{L("farm_care_harvest")}:</b> {g.care}</li></ul>
        <p className="tiny muted">{L("farm_owner_s_general_table_not")}</p>
      </>) : null}
    </>)}
    <details className="fold-card" data-detail-key="farm-about">
      <summary><span className="fold-t">{L("agrx_about")}</span><span className="fold-s">{tx(rg, "scope")}</span></summary>
      <p><span className="zone-chip">{L(typeKey)}</span></p>
      <dl className="kvl">
        {[["scope","agrx_scope"],["climate","agrx_climate"],["main_crops","agrx_main_crops"],["constraints","agrx_constraints"]].map(([k, lk]) => (
          <Fragment key={k}><dt>{L(lk)}</dt><dd>{tx(rg, k)}</dd></Fragment>
        ))}
      </dl>
      <p className="agri-note tier-mid"><b>{L("agrx_evidence")}:</b> {tx(rg, "evidence")}</p>
      <p className="tiny muted">{L("agrx_not_town")}</p>
      <p className="tiny muted"><SrcLinks ids={rg.source_ids} RES={RES} /></p>
    </details>
  </>);
}

function Crops({ ctx, rg }) {
  const h = useHelpers(ctx), { L, my, fmt } = h, { RES, DATA, month: m } = ctx;
  if (!rg) return <p className="agri-note tier-mid">{L("agrx_pick_hint")}</p>;
  const zk = rg.calendar_zone, z = zk && DATA.zones[zk];
  const mineR = RES.crops.filter(c => c.region_id === rg.id), nat = RES.crops.filter(c => c.scope === "national");
  const mine = z ? DATA.crops.filter(c => c.zones.includes(zk)) : [];
  return (<>
    <h3>🌾 {L("agrx_crops_title")}</h3>
    {mineR.length ? <ul className="crop-list">{mineR.map(c => <CropCard key={c.id || c.crop_en} c={c} h={h} />)}</ul> : <p className="agri-note tier-mid">{L("agrx_no_crops")}</p>}
    <h4>{L("agrx_national_title")}</h4>
    <ul className="crop-list">{nat.map(c => <CropCard key={c.id || c.crop_en} c={c} h={h} />)}</ul>
    {z ? (<>
      <h4>📅 {L("agrx_zone_calendar")}</h4>
      <p className="tiny muted">{L("agrx_cal_from", { zone: my ? z.my : z.en })}{rg.calendar_broad ? " " + L("agrx_cal_broad") : ""}</p>
      <p className="tiny muted"><i className="mb pl lg"></i> {L("farm_sow")} &nbsp; <i className="mb hv lg"></i> {L("farm_harvest")} &nbsp; <i className="mb cur lg"></i> {L("farm_month_2")}</p>
      <ul className="crop-list">{mine.map(c => {
        const cal = [c.plant ? `${L("farm_sow")}: ${fmt(c.plant)}` : "", c.harvest ? `${L("farm_harvest")}: ${fmt(c.harvest)}` : ""].filter(Boolean).join(" · ");
        return (<li key={c.en} className="crop idle">
          <div className="crop-top"><b>{my ? c.my : c.en}</b> <Mark v={c.v} />{c.perennial ? <span className="bd bd-idle">{L("farm_perennial")}</span> : null}</div>
          {c.perennial ? null : <MonthBar c={c} m={m} my={my} />}
          {cal ? <div className="tiny muted">{cal}</div> : null}
          {c.nm || c.ne ? <div className="tiny muted">{my ? c.nm : c.ne}</div> : null}
        </li>);
      })}</ul>
    </>) : null}
  </>);
}

function Beh({ ctx, rg }) {
  const { L, my } = useHelpers(ctx), { DATA } = ctx;
  if (!rg) return <p className="agri-note tier-mid">{L("agrx_pick_hint")}</p>;
  const zk = rg.calendar_zone, z = zk && DATA.zones[zk];
  return (<>
    <h3>🌦️ {L("farm_usual_seasonal_behaviour")}</h3>
    {z ? (<>
      <p className="tiny muted">{L("agrx_cal_from", { zone: my ? z.my : z.en })}</p>
      <ul className="beh">{z.beh.map((b, i) => <li key={i}>{my ? b.my : b.en} <span className="src">[{b.s}]</span></li>)}</ul>
    </>) : <p className="agri-note tier-mid">{L("agrx_cal_none")}</p>}
  </>);
}

function Soil({ ctx, rg }) {
  const h = useHelpers(ctx), { L, my, RES } = h, { DATA } = ctx;
  if (!rg) return <p className="agri-note tier-mid">{L("agrx_pick_hint")}</p>;
  const zk = rg.calendar_zone, z = zk && DATA.zones[zk];
  return (<>
    <h3>🧪 {L("agrx_soil_title")}</h3>
    <p className="agri-note tier-mid">{L("agrx_soil_none")}</p>
    <details className="fold"><summary>{L("agrx_soil_sources")}</summary>
      <ul className="beh">{RES.soils.map((s, i) => (
        <li key={i}><b>{s.title_my && my ? s.title_my : s.coverage_en}</b> <Badge c={s.quality_class} L={L} />
          <div className="tiny muted">{my ? s.text_my : s.detail_en}</div>
          <div className="tiny muted">{my ? s.quality_my : s.quality_en} · <SrcLinks ids={s.source_ids} RES={RES} /></div></li>
      ))}</ul></details>
    {z ? (<>
      <h4>{L("farm_soil_fertilizer")}</h4>
      <p className="tiny muted">{L("agrx_cal_from", { zone: my ? z.my : z.en })}</p>
      <p>{my ? z.soil_my : z.soil_en} <Mark v="u" /></p>
    </>) : null}
    <h4>{L("farm_checked_facts")}</h4>
    <p className="agri-note tier-mid" role="note"><strong>{L("agrx_fert_caution_title")}</strong> {L("agrx_fert_caution_body")}</p>
    <ul className="beh">{DATA.fert.verified.map((f, i) => <li key={i}>{my ? f.my : f.en} <span className="src">[{f.s}]</span></li>)}</ul>
    <details className="fold"><summary>{L("farm_reference_ratios_not_verified")}</summary>
      <ul className="beh">{DATA.fert.reference.map((f, i) => <li key={i}>{my ? f.my : f.en}</li>)}</ul>
      <p className="agri-note tier-mid">{L("farm_these_ratios_come_owner_s")}</p></details>
  </>);
}

function Src({ ctx, rg }) {
  const { L, my } = useHelpers(ctx), { RES, DATA } = ctx;
  const ids = rg
    ? Array.from(new Set([...rg.source_ids, ...RES.crops.filter(c => c.region_id === rg.id || c.scope === "national").flatMap(c => c.source_ids), ...RES.soils.flatMap(s => s.source_ids)])).sort()
    : Object.keys(RES.sources);
  return (<>
    <h3>{L("agrx_sources_title")}</h3>
    <p className="tiny muted">{L("agrx_dataset")}: {RES.dataset_version} · ✅ {L("farm_verified")} · ◐ {L("farm_partly")} · 📄 {L("farm_owner_document_only")} · {L("common_updated")} {DATA.updated}</p>
    <p className="tiny muted">{my ? RES.note_my : RES.note_en} {L("agrx_license")}</p>
    <ul className="beh">{ids.map(id => <SrcRow key={id} id={id} RES={RES} />)}</ul>
    {rg ? <details className="fold"><summary>{L("farm_sources")} (agri.json)</summary>
      <ul className="beh">{Object.entries(DATA.sources).map(([k, s]) => (
        <li key={k}>[{k}] {s.u ? <a href={s.u} target="_blank" rel="noopener noreferrer">{s.n}</a> : s.n}</li>
      ))}</ul></details> : null}
  </>);
}

const PANELS = { agriRoot: Now, agriCrops: Crops, agriBeh: Beh, agriSoil: Soil, agriSrc: Src };

/** Mount once; call the returned function with fresh state to redraw (synchronously, so scroll/focus restore keeps working). */
export function mountAgriView() {
  return function update(ctx, rg, extra) {
    const ready = !!(ctx.RES && ctx.DATA);
    put("farmHead", <FarmHead ctx={ctx} rg={rg} failed={extra.failed} onRetry={extra.onRetry} />);
    for (const [id, C] of Object.entries(PANELS)) put(id, ready ? <C ctx={ctx} rg={rg} /> : null);
  };
}

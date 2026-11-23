// International hazard feeds, river outlook, coastal waves and farm water balance in React. Data and events stay in feeds.js.
import { put } from "./slots.js";

const ICON = { earthquake: "📳", cyclone: "🌀", flood: "🌊", volcano: "🌋", drought: "🏜️", wildfire: "🔥" };

function Spark({ series }) {
  if (!series || series.length < 2) return null;
  const w = 140, h = 36, min = Math.min(...series), max = Math.max(...series), span = (max - min) || 1;
  const pts = series.map((v, i) => `${(i * (w / (series.length - 1))).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(" ");
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="river discharge trend"><polyline fill="none" stroke="currentColor" stroke-width="2" points={pts} /></svg>;
}

function FeedCard({ s }) {
  const { L, my, STATE, DATA, KIND, LEVEL, ago } = s;
  let body;
  if (STATE === "deferred") body = <><p className="tiny muted">{L("feeds_not_loaded_because_data_saver")}</p><button type="button" className="ghost-btn" data-feed="load">{L("feeds_load_now")}</button></>;
  else if (STATE === "loading" || STATE === "idle") body = <p className="tiny muted">{L("common_checking")}</p>;
  else if (STATE === "error") body = <><p className="agri-note tier-mid">{L("feeds_international_sources_temporarily_unreachable_try")}</p><button type="button" className="ghost-btn" data-feed="load">{L("feeds_retry")}</button></>;
  else {
    const a = DATA.alerts || [], errs = Object.keys(DATA.errors || {}).filter(k => k !== "glofas");
    body = (<>
      {!a.length ? <p className="agri-note">✓ {L("feeds_no_notable_earthquake_cyclone_flood")}</p> : (
        <ul className="feed-list">{a.map((x, i) => {
          const k = KIND[x.kind] || [x.kind, x.kind], lv = LEVEL[x.level] || LEVEL.info;
          const mag = x.kind === "earthquake" && x.magnitude != null ? ` M${x.magnitude}` : "";
          return (
            <li key={i} className={`feed-item lv-${x.level}`}>
              <div className="feed-top"><span className="feed-ico" aria-hidden="true">{ICON[x.kind] || "⚠️"}</span><b>{my ? k[0] : k[1]}{mag}</b><span className={`bd lvl-${x.level}`}>{my ? lv[0] : lv[1]}</span></div>
              <div className="feed-title">{x.title}</div>
              <div className="tiny muted">{x.distance_km} {L("common_km")} · {ago(x.time)} · {x.source}{x.url ? <> · <a href={x.url} target="_blank" rel="noopener">{L("feeds_details")} ↗</a></> : null}</div>
              {x.tsunami ? <div className="tiny">🌊 {L("feeds_tsunami_flag_set_check_official")}</div> : null}
            </li>
          );
        })}</ul>
      )}
      {errs.length ? <p className="tiny muted">⚠ {L("feeds_some_sources_failed")}: {errs.join(", ")}</p> : null}
      {DATA.elsewhere_count ? <p className="tiny muted">{L("feed_more_elsewhere", { count: DATA.elsewhere_count })}</p> : null}
      {DATA.stale ? <p className="tiny muted">{L("feeds_showing_last_data_received")}</p> : null}
    </>);
  }
  const n = STATE === "ok" && DATA ? (DATA.alerts || []).length : 0;
  return (
    <details className="fold-card" data-detail-key="feeds" open={n > 0 || STATE === "error"}>
      <summary><span className="fold-t">🌍 {L("feeds_international_sources")}</span><span className="fold-s">{L("feeds_automatic_usgs_gdacs_not_official")}</span>{n ? <span className="fold-n">{n}</span> : null}</summary>
      {body}
      <p className="tiny muted">{DATA && DATA.fetched_at ? L("feeds_checked") + ": " + ago(DATA.fetched_at) : ""}</p>
    </details>
  );
}

function River({ s }) {
  const { L, my, DATA } = s, r = DATA.river;
  const tr = { rising: [L("feed_rising"), "Rising", "↗"], falling: [L("feed_falling"), "Falling", "↘"], steady: [L("feed_steady"), "Steady", "→"] }[r.trend] || ["", "", ""];
  return (<>
    <div className="section-heading"><div><h3>🌊 {L("feeds_nearby_river_discharge_outlook")}</h3><p className="muted">GloFAS · {r.days} {L("feeds_days")}</p></div></div>
    <div className="river-row"><div><div className="tiny muted">{L("feeds_today")}</div><b>{r.today}</b> <span className="tiny">{r.unit}</span></div><div><div className="tiny muted">{L("feeds_peak")} ({String(r.peak_date).slice(5)})</div><b>{r.peak}</b> <span className="tiny">{r.unit}</span></div><div className="river-trend">{tr[2]} {my ? tr[0] : tr[1]}</div></div>
    <Spark series={r.series} />
    <p className="tiny muted">{L("feeds_model_estimate_largest_nearby_river")}{DATA.fetched_at ? " · " + L("feeds_checked") + ": " + s.ago(DATA.fetched_at) : ""}</p>
  </>);
}

function Sea({ s }) {
  const { L } = s, sea = s.EX.sea, p = sea.peak;
  const [txt, cls] = p >= 2.0 ? [L("feeds_high_waves_possible_check_dmh"), "tier-dry"] : p >= 1.0 ? [L("feeds_moderate_waves_possible_small_boats"), "tier-mid"] : [L("feeds_low_waves_expected"), "tier-wet"];
  return (<>
    <div className="section-heading"><div><h3>🌊 {L("feeds_coastal_wave_outlook")}</h3><p className="muted">Open-Meteo Marine · {sea.series.length} {L("feeds_days")}</p></div></div>
    <div className="river-row"><div><div className="tiny muted">{L("feeds_today_max")}</div><b>{sea.today}</b> <span className="tiny">m</span></div><div><div className="tiny muted">{L("feeds_peak")} ({String(sea.peak_date).slice(5)})</div><b>{sea.peak}</b> <span className="tiny">m</span></div></div>
    <Spark series={sea.series} /><p className={`agri-note ${cls}`}>{txt}</p>
    <p className="tiny muted">{L("feeds_model_estimate_differ_near_shore")}</p>
  </>);
}

function Water({ s }) {
  const { L } = s, w = s.EX.water, b = w.balance_mm;
  const msg = b <= -15 ? L("feeds_over_next_7_days_field") : b >= 15 ? L("feeds_rain_exceed_water_loss_watch") : L("feeds_rain_water_loss_roughly_balanced");
  const tcls = b <= -15 ? "tier-dry" : b >= 15 ? "tier-mid" : "tier-wet";
  return (<>
    <div className="section-heading"><div><h3>💧 {L("feeds_water_balance_7_days")}</h3><p className="muted">{L("feeds_rain_versus_water_field_loses")}</p></div></div>
    <ul className="em-list"><li><span>{L("common_rain")}</span><b>{w.rain_mm} {L("common_mm")}</b></li><li><span>{L("feeds_water_loss_et")}</span><b>{w.et0_mm} {L("common_mm")}</b></li><li><span>{L("feeds_balance")}</span><b>{b > 0 ? "+" : ""}{b} {L("common_mm")}</b></li>
      {w.soil_now_pct != null ? <li><span>{L("feeds_top_soil_moisture")}</span><b>{w.soil_now_pct}% → {w.soil_end_pct}% {({ drying: "↘", wetting: "↗", steady: "→" })[w.soil_trend] || ""}</b></li> : null}</ul>
    <p className={`agri-note ${tcls}`}>{msg}</p>
    <p className="tiny muted">{L("feeds_et_reference_value_well_watered")}</p>
  </>);
}

export function mountFeedsView() {
  return {
    draw: s => {
      put("feedCard", <FeedCard s={s} />);
      put("riverCard", s.STATE === "ok" && s.DATA && s.DATA.river ? <River s={s} /> : null);
    },
    drawExtras: s => {
      put("seaCard", s.EX && s.EX.sea ? <Sea s={s} /> : null);
      put("agriWater", s.EX && s.EX.water ? <Water s={s} /> : null);
    },
  };
}

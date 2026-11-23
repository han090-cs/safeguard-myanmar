// Today / Forecast tab cards in React: hourly strip + detail, 7-10 day list, temperature and rain charts, local rain / heat / cyclone cards.
// Only draws. Data preparation and event wiring stay in render_cards.js. Markup is identical to the former string templates.
import { Fragment } from "preact";
import { put, clearSlot } from "./slots.js";


function Hours({ rows, sel, x }) {
  return rows.map(r => {
    const wi = x.weatherInfo(r.c), on = r.t === sel;
    return (
      <button key={r.t} type="button" className={`hour${on ? " selected" : ""}`} data-hour={r.t} aria-pressed={on}>
        <small>{x.fmtTime(r.t)}</small><span className="emoji" aria-hidden="true" dangerouslySetInnerHTML={{ __html: x.wxIcon(r.c, x.isDayAtLocal(r.t)) }} /><strong>{x.temp(r.T)}</strong><small>{Math.round(r.p)}% ☔</small><span className="sr-only"> {x.my ? wi[1] : wi[0]}</span>
      </button>
    );
  });
}

function Stat({ k, v, c = "" }) { return <div className="hd-stat"><span>{k}</span><b className={c}>{v}</b></div>; }

function HourDetail({ rows, sel, x }) {
  const { L } = x;
  const r = rows.find(q => q.t === sel) || rows[0], wi = x.weatherInfo(r.c);
  const cls = r.p >= 70 ? "rain-high" : r.p >= 40 ? "rain-mid" : "rain-low";
  const Ts = rows.map(q => q.T).filter(v => v != null && !isNaN(v)), sum = rows.reduce((s, q) => s + (Number(q.r) || 0), 0);
  return (
    <div className="hd-card" role="region" aria-live="polite" aria-label={x.fmtTime(r.t)}>
      <div className="hd-top"><span className="hd-emoji" aria-hidden="true" dangerouslySetInnerHTML={{ __html: x.wxIcon(r.c, x.isDayAtLocal(r.t)) }} />
        <div className="hd-when"><strong>{x.fmtTime(r.t)}</strong><span className="muted">{x.fmtDay(r.t)}</span><span className="hd-sky">{x.my ? wi[1] : wi[0]}</span></div>
        <b className="hd-temp">{x.temp(r.T)}</b></div>
      <div className="hd-grid">
        <Stat k={L("wx_rain")} v={Math.round(r.p) + "%"} c={cls} />
        <Stat k={L("common_rain")} v={Number(r.r || 0).toFixed(1) + " " + L("common_mm")} />
        <Stat k={L("wx_humidity")} v={r.u == null ? "—" : Math.round(r.u) + "%"} />
        <Stat k={L("wx_wind")} v={r.w == null ? "—" : x.speed(r.w)} />
      </div>
      <p className="hd-day muted">{L("wx_high_low")}: <b>{Ts.length ? `${x.temp(Math.max(...Ts))} / ${x.temp(Math.min(...Ts))}` : "—"}</b> · {L("wx_total_rain")}: <b>{sum.toFixed(1)} {L("common_mm")}</b></p>
    </div>
  );
}

function Forecast({ rows, x }) {
  const { L } = x;
  return (<>
    <div className="forecast-head"><span>{L("wx_day")}</span><span>{L("wx_condition")}</span><span>{L("wx_temperature")}</span><span>{L("wx_rain_2")}</span></div>
    {rows.map(r => {
      const wi = x.weatherInfo(r.code);
      const rainClass = r.rain >= 70 ? "rain-high" : r.rain >= 40 ? "rain-mid" : "rain-low";
      const i = r.dayText.indexOf(" · ");
      return (
        <div key={r.tm} className={`forecast-row${r.far ? " far-day" : ""}`} title={r.far ? L("rain_far") : undefined}>
          <div>
            {i < 0 ? <strong>{r.dayText}</strong> : <><strong>{r.dayText.slice(0, i)}</strong><small className="fc-date">{r.dayText.slice(i + 3)}</small></>}
            {r.cal ? <small className={`mm-day${r.cal.u ? " mm-uposatha" : ""}`}>{r.cal.text}</small> : null}
          </div>
          <div className="fc-cond"><span className="fc-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: x.wxIcon(r.code, true) }} /><span className="condition-text">{x.my ? wi[1] : wi[0]}</span></div>
          <div className="forecast-temp"><strong>{x.temp(r.max)}</strong><span>{x.temp(r.min)}</span></div>
          <div className="rain-cell"><strong className={rainClass}>{r.rain}%</strong><span>{r.mm.toFixed(1)} mm{r.rain >= 70 && r.mm < 1 ? " · " + L("rain_low_amt") : ""}</span></div>
        </div>
      );
    })}
  </>);
}

function TempChart({ c, L }) {
  if (c.empty) return <p className="muted" role="status">{L("chart_no_temperature")}</p>;
  const { points, ticks, width, height, left, right, plotTop, plotBottom, x, y, number, valueLabel, unit, hasLow, description } = c;
  const lines = key => {
    const segs = []; let seg = [];
    points.forEach((p, i) => {
      if (Number.isFinite(p[key])) seg.push(`${x(i)},${y(p[key])}`);
      else if (seg.length) { segs.push(seg); seg = []; }
    });
    if (seg.length) segs.push(seg);
    return segs.map((sg, k) => <polyline key={k} className={`temperature-line temperature-line-${key === "value" ? "high" : "low"}`} points={sg.join(" ")} />);
  };
  const dots = (key, cls, dy) => points.map((p, i) => Number.isFinite(p[key]) ? (
    <Fragment key={i}>
      <circle className={`temperature-point ${cls}`} cx={x(i)} cy={y(p[key])} r="4.5" />
      <text className={`temperature-value ${cls}`} x={x(i)} y={y(p[key]) + dy} text-anchor="middle">{valueLabel(p[key])}</text>
    </Fragment>) : null);
  return (<>
    <div className="temperature-chart-legend"><span className="tl-high"><i aria-hidden="true"></i>{L("chart_daily_high")}</span>{hasLow ? <span className="tl-low"><i aria-hidden="true"></i>{L("chart_daily_low")}</span> : null}<span className="temperature-chart-unit">{unit}</span></div>
    <svg className="line-chart temperature-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="temperatureChartTitle temperatureChartDesc">
      <title id="temperatureChartTitle">{L("chart_temperature_label", { unit })}</title>
      <desc id="temperatureChartDesc">{description}</desc>
      {ticks.map(v => (
        <Fragment key={v}>
          <line className="temperature-grid" x1={left} x2={width - right} y1={y(v)} y2={y(v)} />
          <text className="temperature-axis" x={left - 10} y={y(v) + 5} text-anchor="end">{number(v)}°</text>
        </Fragment>
      ))}
      {hasLow ? lines("low") : null}{lines("value")}{hasLow ? dots("low", "temperature-low", 22) : null}{dots("value", "temperature-high", -13)}
      {points.map((p, i) => (
        <g key={i}><title>{`${p.day} ${p.dateLabel}`}</title>
          {Number.isFinite(p.value) || Number.isFinite(p.low) ? null : <text className="temperature-missing" x={x(i)} y={(plotTop + plotBottom) / 2} text-anchor="middle">{L("wx_unavailable")}</text>}
          <text className="temperature-weekday" x={x(i)} y="215" text-anchor="middle">{p.shortDay}</text><text className="temperature-date" x={x(i)} y="238" text-anchor="middle">{p.dateLabel}</text></g>
      ))}
    </svg>
    <p className="temperature-chart-note">{L("chart_date_format")}</p>
  </>);
}

function RainChart({ bars }) {
  return bars.map((b, i) => (
    <div key={i} className="rain-day"><div className="bar-wrap"><div className="rain-bar" data-height={b.h} style={{ "--bar-height": b.h + "%" }}></div></div><strong>{b.pct}%</strong><span>{b.day}</span></div>
  ));
}

function LocalRain({ p, L }) {
  return (<>
    <div className="section-heading"><div><h3>📍 {p.place} — {L("wx_next_7_days")}</h3><p className="muted">{L("wx_calculated_app_forecast_not_official")}</p></div></div>
    <ul className="em-list"><li><span>{L("wx_total_rain_model")}</span><b>{p.sum.toFixed(1)} {L("common_mm")}</b></li>
      <li><span>{L("wx_likely_dry_days")}</span><b>{p.dry} / {p.n}</b></li>
      <li><span>{L("wx_days_possible_scattered_showers")}</span><b>{p.scat} / {p.n}</b></li></ul>
    <p className={`agri-note tier-${p.tier}`}>{p.msg}</p>
  </>);
}

function Heat({ p, L }) {
  return (
    <details className="fold-card" data-detail-key="wx-heat" open={p.tier !== "wet"}>
      <summary><span className="fold-t">🌡️ {L("wx_heat_notice")}</span><span className="fold-s">{p.place} · {L("wx_highest_next_3_days")}: <b>{p.max.toFixed(0)}°C</b></span></summary>
      <p className={`agri-note tier-${p.tier}`}>{p.text}</p>
      {p.hydration ? <details className="fold-card fold-in hyd-box" data-detail-key="wx-hyd">
        <summary><span className="fold-t">{p.hydration.title}</span><span className="fold-s">{p.hydration.feels}</span></summary>
        <ul className="guide-list">{p.hydration.items.map((t, i) => <li key={i}>{t}</li>)}</ul></details> : null}
      <p className="tiny muted">{L("wx_levels_app_estimates_not_official")}</p>
    </details>
  );
}
function Cyclone({ L }) {
  return (
    <details className="fold-card" data-detail-key="wx-cyclone">
      <summary><span className="fold-t">🌀 {L("wx_cyclone_season")}</span><span className="fold-s">{L("wx_bay_bengal_storms_most_common")}</span></summary>
      <p className="tiny muted">{L("wx_check_official_storm_warnings_dmh")}</p>
      <a className="em-num" href="https://www.moezala.gov.mm/" target="_blank" rel="noopener">moezala.gov.mm ↗</a>
    </details>
  );
}

export function mountWeatherView() {
  return {
    hours: (rows, sel, x) => put("hourlyForecast", rows ? <Hours rows={rows} sel={sel} x={x} /> : null),
    detail: (rows, sel, x) => put("hourlyDetail", rows ? <HourDetail rows={rows} sel={sel} x={x} /> : null),
    forecast: (rows, x) => put("forecast", rows ? <Forecast rows={rows} x={x} /> : null),
    tempChart: (c, L) => put("tempChart", c ? <TempChart c={c} L={L} /> : null),
    rainChart: bars => put("rainChart", <RainChart bars={bars} />),
    localRain: (p, L) => put("agriLocal", p ? <LocalRain p={p} L={L} /> : null),
    heat: (p, L) => put("heatCard", p ? <Heat p={p} L={L} /> : null),
    cyclone: L => put("cycloneCard", L ? <Cyclone L={L} /> : null),
    // Used by other modules that used to empty these slots with replaceChildren(): keeps React and the DOM in step.
    clear: id => clearSlot(id),
  };
}

"""Environmental and agricultural conditions (information levels 2 and 3).

Each condition describes how current or recent weather compares with what is usual, or states a plain
accumulated quantity. None of them is a warning, none contains health or farming advice, and none applies a
threshold of its own: categories come from the location's own 1991–2020 distribution (terciles, and the
ETCCDI 10th/90th percentiles for temperature), and the wet-day definition (≥ 1 mm) is the ETCCDI convention.
See baseline.py for data sources and why forecast rainfall is not compared with normal.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from .baseline import MIN_OVERLAP_DAYS, RAIN_DAYS, Baseline, percentile_rank, temperature_class, tercile
from .indices import to_myanmar_digits
from .metrics import METRICS
from .normalize import NormalizedWeather
from .schemas import Condition, Localized, Metric, TimeWindow

log = logging.getLogger("risk_engine.conditions")

WET_DAY_MM = 1.0              # ETCCDI wet-day definition
WATER_BALANCE_DAYS = 14
FORECAST_DAYS = 7
MONTHS_MY = ["ဇန်နဝါရီ", "ဖေဖော်ဝါရီ", "မတ်", "ဧပြီ", "မေ", "ဇွန်", "ဇူလိုင်", "ဩဂုတ်", "စက်တင်ဘာ", "အောက်တိုဘာ",
             "နိုဝင်ဘာ", "ဒီဇင်ဘာ"]
MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FORECAST_SOURCE = "Open-Meteo forecast models (past days: model analysis)"

TEMP_LABELS = {
    "much_above_normal": ("ပုံမှန်ထက် သိသိသာသာ ပူ", "Much warmer than usual"),
    "above_normal": ("ပုံမှန်ထက် ပူ", "Warmer than usual"),
    "near_normal": ("ပုံမှန်အတိုင်း", "About usual"),
    "below_normal": ("ပုံမှန်ထက် အေး", "Cooler than usual"),
    "much_below_normal": ("ပုံမှန်ထက် သိသိသာသာ အေး", "Much cooler than usual"),
}
RAIN_LABELS = {
    "below_normal": ("ပုံမှန်ထက် နည်း", "Less than usual"),
    "near_normal": ("ပုံမှန်အတိုင်း", "About usual"),
    "above_normal": ("ပုံမှန်ထက် များ", "More than usual"),
}


def md(v) -> str:
    """Myanmar digits for numbers and numeric strings."""
    return to_myanmar_digits(str(v))


def L(my: str, en: str) -> Localized:
    return Localized(my=my, en=en)


def _f(v: float, nd: int = 1) -> str:
    s = f"{v:.{nd}f}"
    return s[:-2] if nd == 1 and s.endswith(".0") else s


def _date_my(d: date) -> str:
    return f"{MONTHS_MY[d.month - 1]} {md(d.day)} ရက်"


def _date_en(d: date) -> str:
    return f"{d.day} {MONTHS_EN[d.month - 1]}"


def _signed(v: float) -> str:
    return ("+" if v > 0 else "") + _f(v)


def _day_start(nw: NormalizedWeather, d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=nw.tz)


def _cid(kind: str, nw: NormalizedWeather, d: date) -> str:
    return f"{kind}:{nw.lat:.3f},{nw.lon:.3f}:{d.isoformat()}"


# ------------------------------------------------------------------------------------------------ temperature
def forecast_bias(nw: NormalizedWeather, bl: Baseline, var: str, today: date) -> tuple[Optional[float], int]:
    """Mean (forecast-model analysis − ERA5) over recent days where both exist; (None, n) if too few."""
    if bl.recent is None:
        return None, 0
    fc_var = "temperature_2m_max" if var == "tmax" else "temperature_2m_min"
    diffs = []
    for d, v in nw.daily.items(fc_var):
        if d >= today or v is None:
            continue
        e = bl.recent.value(var, d)
        if e is not None:
            diffs.append(v - e)
    if len(diffs) < MIN_OVERLAP_DAYS:
        return None, len(diffs)
    return round(sum(diffs) / len(diffs), 2), len(diffs)


def _temperature(nw: NormalizedWeather, bl: Optional[Baseline], today: date, var: str) -> Optional[Condition]:
    fc_var = "temperature_2m_max" if var == "tmax" else "temperature_2m_min"
    value = nw.daily.get(fc_var, today)
    if value is None:
        return None
    is_max = var == "tmax"
    kind = "temperature_max" if is_max else "temperature_min"
    title = L("နေ့အမြင့်ဆုံး အပူချိန်", "Daytime high") if is_max else L("ညအနိမ့်ဆုံး အပူချိန်", "Overnight low")
    word_my, word_en = ("အမြင့်ဆုံး", "high") if is_max else ("အနိမ့်ဆုံး", "low")
    window = TimeWindow(start=_day_start(nw, today), end=_day_start(nw, today + timedelta(days=1)))
    metrics = [Metric(key=f"forecast_{var}", label=L("ခန့်မှန်းတန်ဖိုး", "Forecast"), value=value, unit="°C")]
    sources = [FORECAST_SOURCE]

    bias, n_overlap = forecast_bias(nw, bl, var, today) if bl else (None, 0)
    stats = bl.normals.temperature_stats(var, today, shift=bias) if bl is not None and bias is not None else None
    if stats is None:
        return Condition(
            condition_id=_cid(kind, nw, today), kind=kind, domains=["environment"], title=title,
            headline=L(f"ယနေ့ ခန့်မှန်း{word_my}အပူချိန်က {md(_f(value))}°C ဖြစ်ပါတယ်။ ပုံမှန်နဲ့ နှိုင်းယှဉ်စရာ ဒေတာ အခု မရနိုင်ပါဘူး။",
                       f"Forecast {word_en} {_f(value)} °C. A comparison with normal is not available right now."),
            metrics=metrics, sources=sources, time_window=window,
            limitations=[L("ပုံမှန်တန်ဖိုး (ERA5) သို့မဟုတ် ချိန်ညှိဖို့ မကြာသေးခင်က ဒေတာ မလုံလောက်ပါဘူး။",
                           "The ERA5 normal or enough recent overlapping days for the adjustment were unavailable.")])

    rank = percentile_rank(stats["sorted"], value)
    level = temperature_class(rank)
    diff = round(value - stats["mean"], 1)
    lab = TEMP_LABELS[level]
    metrics += [
        Metric(key="normal_mean", label=L("ပုံမှန် ပျမ်းမျှ", "Normal (mean)"), value=stats["mean"], unit="°C"),
        Metric(key="anomaly", label=L("ကွာခြားချက်", "Difference from normal"), value=diff, unit="°C"),
        Metric(key="percentile_rank", label=L("ရာခိုင်နှုန်းအဆင့် (Percentile)", "Percentile rank"), value=rank, unit="%"),
        Metric(key="normal_p10", label=L("ပုံမှန် ၁၀ ရာခိုင်နှုန်းအဆင့်", "Normal 10th percentile"), value=stats["p10"], unit="°C"),
        Metric(key="normal_p90", label=L("ပုံမှန် ၉၀ ရာခိုင်နှုန်းအဆင့်", "Normal 90th percentile"), value=stats["p90"], unit="°C"),
        Metric(key="model_adjustment", label=L("မော်ဒယ်ကွာဟမှု ချိန်ညှိတန်ဖိုး", "Forecast-model adjustment"), value=bias, unit="°C"),
        Metric(key="overlap_days", label=L("ချိန်ညှိရာမှာ သုံးတဲ့ရက်", "Days used for adjustment"), value=n_overlap, unit="days"),
        Metric(key="sample_size", label=L("နှိုင်းယှဉ်တဲ့ နေ့ရက်အရေအတွက်", "Days in the comparison"), value=stats["n"], unit="days"),
    ]
    return Condition(
        condition_id=_cid(kind, nw, today), kind=kind, domains=["environment", "agriculture"] if is_max else ["environment"],
        level=level, level_label=L(*lab), title=title,
        headline=L(f"ယနေ့ ခန့်မှန်း{word_my}အပူချိန်က {md(_f(value))}°C ဖြစ်ပြီး ဒီအချိန်အတွက် ပုံမှန်က {md(_f(stats['mean']))}°C ခန့် ဖြစ်ပါတယ် "
                   f"({md(_signed(diff))}°C ကွာပါတယ်)။",
                   f"Forecast {word_en} {_f(value)} °C; usual for this time of year is about {_f(stats['mean'])} °C ({_signed(diff)} °C)."),
        metrics=metrics, time_window=window, sources=sources + [bl.source],
        baseline={"period": "1991–2020", "source": bl.source, "season_window_days": 15, "adjustment_c": bias,
                  "adjustment_overlap_days": n_overlap},
        limitations=[L(f"ခန့်မှန်းချက်ကို ERA5 ပုံမှန်တန်ဖိုးနဲ့ နှိုင်းယှဉ်ထားပြီး ခန့်မှန်းမော်ဒယ်နဲ့ ERA5 ရဲ့ မကြာသေးခင်က ကွာခြားချက် "
                       f"({md(_signed(bias))}°C၊ {md(n_overlap)} ရက်) နဲ့ ချိန်ညှိထားပါတယ်။ ပုံမှန်နဲ့ ဘယ်လောက်ကွာလဲဆိုတာ ပြတာသာဖြစ်ပြီး "
                       f"ကျန်းမာရေးအရ သတ်မှတ်ချက် မဟုတ်ပါဘူး။",
                       f"Forecast compared with ERA5 normals shifted by the forecast model's recent difference from ERA5 "
                       f"({_signed(bias)} °C over {n_overlap} days). Describes how unusual the day is; not a health threshold.")])


# ------------------------------------------------------------------------------------------------ rainfall
def _rain_30d(nw: NormalizedWeather, bl: Optional[Baseline]) -> Optional[Condition]:
    if bl is None or bl.recent is None:
        return None
    end = bl.recent.last_complete_day()
    if end is None:
        return None
    days = [end - timedelta(days=i) for i in range(RAIN_DAYS)]
    vals = [bl.recent.value("pr", d) for d in days]
    if any(v is None for v in vals):
        return None
    total = round(sum(vals), 1)
    stats = bl.normals.rain_stats(end, RAIN_DAYS)
    if stats is None:
        return None
    level = tercile(total, stats["q33"], stats["q67"])
    pct = round(100 * total / stats["median"]) if stats["median"] >= 5 else None
    start = days[-1]
    return Condition(
        condition_id=_cid("rain_30d", nw, end), kind="rain_30d", domains=["environment", "agriculture"],
        level=level, level_label=L(*RAIN_LABELS[level]), title=L("ရက် ၃၀ အတွင်း မိုးရေချိန်", "Rain over 30 days"),
        headline=L(f"{_date_my(end)} အထိ ရက် ၃၀ အတွင်း မိုးရေ {md(_f(total, 0))} မီလီမီတာ ရွာခဲ့ပါတယ်။ ဒီအချိန်အတွက် "
                   f"ပုံမှန်နှစ်တွေရဲ့ အလယ်အလတ်အုပ်စုမှာ {md(_f(stats['q33'], 0))}–{md(_f(stats['q67'], 0))} မီလီမီတာ ရွာလေ့ရှိပါတယ်။",
                   f"{_f(total, 0)} mm in the 30 days to {_date_en(end)}. For this time of year the middle third of years "
                   f"had {_f(stats['q33'], 0)}–{_f(stats['q67'], 0)} mm."),
        metrics=[Metric(key="total_30d", label=L("ရက် ၃၀ စုစုပေါင်း", "30-day total"), value=total, unit="mm"),
                 Metric(key="normal_median", label=L("ပုံမှန် အလယ်ကိန်း (Median)", "Normal median"), value=stats["median"], unit="mm"),
                 Metric(key="normal_q33", label=L("အောက်ဘက် တစ်ပုံသုံးပုံ ကန့်သတ်တန်ဖိုး", "Lower tercile limit"), value=stats["q33"], unit="mm"),
                 Metric(key="normal_q67", label=L("အထက်ဘက် တစ်ပုံသုံးပုံ ကန့်သတ်တန်ဖိုး", "Upper tercile limit"), value=stats["q67"], unit="mm"),
                 Metric(key="percent_of_median", label=L("ပုံမှန်ရဲ့ ရာခိုင်နှုန်း", "Percent of normal median"), value=pct, unit="%"),
                 Metric(key="sample_size", label=L("နှိုင်းယှဉ်တဲ့ ကာလ အရေအတွက်", "30-day periods compared"), value=stats["n"], unit="")],
        baseline={"period": "1991–2020", "source": bl.source, "season_window_days": 15, "compared_with": "ERA5 (same dataset)"},
        sources=[bl.source], time_window=TimeWindow(start=_day_start(nw, start), end=_day_start(nw, end + timedelta(days=1))),
        limitations=[L("ERA5 ကို ERA5 ချင်းပဲ နှိုင်းယှဉ်ထားပါတယ်။ ERA5 က ၅ ရက်ခန့် နောက်ကျလို့ နောက်ဆုံးရက်အနည်းငယ် မပါပါဘူး။ "
                       "ပြန်တွက်ထားတဲ့ (reanalysis) မိုးရေချိန်က မိုးရေချိန်တိုင်းကိရိယာနဲ့ တိုင်းတာတာနဲ့ ကွာနိုင်ပြီး တောင်ပေါ်ဒေသမှာ ပိုကွာနိုင်ပါတယ်။",
                       "ERA5 compared with ERA5 only. ERA5 runs about 5 days behind, so the latest days are not included. "
                       "Reanalysis rainfall can differ from rain gauges, especially in hilly areas.")])


def _rain_forecast(nw: NormalizedWeather, today: date) -> Optional[Condition]:
    days = [today + timedelta(days=i) for i in range(FORECAST_DAYS)]
    vals = [nw.daily.get("precipitation_sum", d) for d in days]
    if any(v is None for v in vals):
        return None
    total = round(sum(vals), 1)
    wet = sum(1 for v in vals if v >= WET_DAY_MM)
    return Condition(
        condition_id=_cid("rain_forecast_7d", nw, today), kind="rain_forecast_7d", domains=["environment", "agriculture"],
        title=L("နောက် ၇ ရက် မိုးရေချိန် ခန့်မှန်းချက်", "Rain forecast, next 7 days"),
        headline=L(f"နောက် ၇ ရက်အတွင်း မိုးရေ {md(_f(total, 0))} မီလီမီတာခန့် ရွာနိုင်ပြီး မိုးရွာနိုင်တဲ့ရက် {md(wet)} ရက် ရှိပါတယ်။",
                   f"About {_f(total, 0)} mm expected over the next 7 days, with rain on {wet} of them."),
        metrics=[Metric(key="total_7d", label=L("ရက် ၇ စုစုပေါင်း", "7-day total"), value=total, unit="mm"),
                 Metric(key="wet_days", label=L("မိုးရွာတဲ့ရက် (≥ ၁ မီလီမီတာ)", "Wet days (≥ 1 mm)"), value=wet, unit="days")],
        sources=[FORECAST_SOURCE],
        time_window=TimeWindow(start=_day_start(nw, today), end=_day_start(nw, today + timedelta(days=FORECAST_DAYS))),
        limitations=[L("မော်ဒယ်ခန့်မှန်းချက်ပါ။ ပုံမှန်နဲ့ မနှိုင်းယှဉ်ပါဘူး – မကြာသေးခင် ရက်သတ္တပတ်တွေမှာ ခန့်မှန်းမော်ဒယ်နဲ့ "
                       "ERA5 ရဲ့ မိုးရေချိန် ကွာခြားမှုက အချို့နေရာမှာ နှစ်ဆခန့်အထိ ရှိခဲ့လို့ပါ။",
                       "Model forecast. Not compared with normal: in recent weeks forecast models and ERA5 differed in "
                       "rainfall by up to about a factor of two at some locations.")])


def _spell(nw: NormalizedWeather, today: date) -> Optional[Condition]:
    past = [(d, v) for d, v in nw.daily.items("precipitation_sum") if d < today]
    if not past or past[-1][1] is None:
        return None
    last = past[-1][0]
    dry = past[-1][1] < WET_DAY_MM
    n = 0
    for _, v in reversed(past):
        if v is None or (v < WET_DAY_MM) != dry:
            break
        n += 1
    complete = n < len(past)                      # run began inside the data we have
    kind = "dry_spell" if dry else "wet_spell"
    n_txt_my = md(n) + ("" if complete else "+")
    n_txt_en = str(n) + ("" if complete else "+")
    if dry:
        title = L("မိုးမရွာတဲ့ရက် ဆက်တိုက်", "Dry days in a row")
        head = L(f"{_date_my(last)} အထိ မိုးရေ ၁ မီလီမီတာ မပြည့်တဲ့ရက် {n_txt_my} ရက် ဆက်တိုက် ရှိပါတယ်။",
                 f"{n_txt_en} days in a row with less than 1 mm of rain (to {_date_en(last)}).")
    else:
        title = L("မိုးရွာတဲ့ရက် ဆက်တိုက်", "Wet days in a row")
        head = L(f"{_date_my(last)} အထိ မိုးရေ ၁ မီလီမီတာနဲ့အထက် ရွာတဲ့ရက် {n_txt_my} ရက် ဆက်တိုက် ရှိပါတယ်။",
                 f"{n_txt_en} days in a row with at least 1 mm of rain (to {_date_en(last)}).")
    return Condition(
        condition_id=_cid(kind, nw, last), kind=kind, domains=["environment", "agriculture"], title=title, headline=head,
        metrics=[Metric(key="consecutive_days", label=L("ဆက်တိုက်ရက်", "Consecutive days"), value=n, unit="days"),
                 Metric(key="wet_day_threshold", label=L("မိုးရွာတဲ့ရက် သတ်မှတ်ချက် (ETCCDI)", "Wet-day definition (ETCCDI)"),
                        value=WET_DAY_MM, unit="mm")],
        sources=[FORECAST_SOURCE],
        time_window=TimeWindow(start=_day_start(nw, last - timedelta(days=n - 1)), end=_day_start(nw, last + timedelta(days=1))),
        limitations=[L("နေ့စဉ် မိုးရေချိန် မော်ဒယ်တွက်ချက်မှုကို အခြေခံထားပါတယ် (မိုးရွာတဲ့ရက် = ၁ မီလီမီတာနဲ့အထက်)။",
                       "Based on model estimates of daily rain (wet day: at least 1 mm, the ETCCDI convention).")]
        + ([] if complete else [L("ဆက်တိုက်ရက်က ရနိုင်တဲ့ ဒေတာ (ရက် ၂၈) ထက် ပိုရှည်နိုင်ပါတယ်။",
                                  "The run may be longer than the data available (28 days).")]))


def _water_balance(nw: NormalizedWeather, today: date) -> Optional[Condition]:
    days = [today - timedelta(days=i) for i in range(1, WATER_BALANCE_DAYS + 1)]
    p = [nw.daily.get("precipitation_sum", d) for d in days]
    e = [nw.daily.get("et0_fao_evapotranspiration", d) for d in days]
    if any(v is None for v in p + e):
        return None
    P, E = round(sum(p), 1), round(sum(e), 1)
    bal = round(P - E, 1)
    deficit = bal < 0
    return Condition(
        condition_id=_cid("water_balance_14d", nw, today), kind="water_balance_14d", domains=["agriculture"],
        level="deficit" if deficit else "surplus",
        level_label=L("ရေလိုအပ်မှု (Deficit)", "Deficit") if deficit else L("ရေပိုလျှံမှု (Surplus)", "Surplus"),
        title=L("ရေချိန်ခွင်လျှာ – မိုးရေနဲ့ ရေငွေ့ပျံနိုင်မှု", "Water balance: rain minus evaporation"),
        headline=L(f"ပြီးခဲ့တဲ့ ၁၄ ရက်အတွင်း မိုးရေ {md(_f(P, 0))} မီလီမီတာ ရွာပြီး ရေငွေ့ပျံနိုင်မှု {md(_f(E, 0))} မီလီမီတာ ရှိလို့ "
                   + (f"ရေ {md(_f(-bal, 0))} မီလီမီတာ လိုအပ်နေပါတယ်။" if deficit else f"ရေ {md(_f(bal, 0))} မီလီမီတာ ပိုလျှံပါတယ်။"),
                   f"Past 14 days: {_f(P, 0)} mm of rain and {_f(E, 0)} mm of potential evaporation, a "
                   + (f"deficit of {_f(-bal, 0)} mm." if deficit else f"surplus of {_f(bal, 0)} mm.")),
        metrics=[Metric(key="rain_14d", label=L("မိုးရေ (၁၄ ရက်)", "Rain (14 days)"), value=P, unit="mm"),
                 Metric(key="et0_14d", label=L("ရေငွေ့ပျံနိုင်မှု ET₀ (FAO-56)", "Reference evapotranspiration ET₀ (FAO-56)"), value=E, unit="mm"),
                 Metric(key="balance_14d", label=L("ခွင်လျှာ", "Balance"), value=bal, unit="mm")],
        sources=[FORECAST_SOURCE],
        time_window=TimeWindow(start=_day_start(nw, days[-1]), end=_day_start(nw, today)),
        limitations=[L("ရေငွေ့ပျံနိုင်မှုက FAO-56 ရည်ညွှန်း မြက်ခင်းအတွက် တွက်ထားတဲ့ တန်ဖိုးပါ။ သီးနှံတစ်ခုချင်းစီရဲ့ "
                       "အမှန်တကယ် ရေသုံးစွဲမှုက သီးနှံအမျိုးအစားနဲ့ ကြီးထွားမှုအဆင့်အလိုက် ကွာပါတယ်။ သီးနှံအလိုက် သတ်မှတ်ချက်ကို မသုံးထားပါ။",
                       "Potential evaporation is FAO-56 reference evapotranspiration (a grass reference); actual crop water use "
                       "depends on crop and growth stage. No crop-specific thresholds are applied.")])


def _soil_moisture(nw: NormalizedWeather, now: datetime) -> Optional[Condition]:
    var = "soil_moisture_9_to_27cm"
    cur = [v for _, v in nw.hourly.window(var, now - timedelta(hours=3), now + timedelta(hours=1))]
    ago = [v for _, v in nw.hourly.window(var, now - timedelta(days=7, hours=3), now - timedelta(days=7) + timedelta(hours=1))]
    if not cur or not ago:
        return None
    v, w = round(cur[-1], 3), round(ago[-1], 3)
    change = v - w
    trend_my = "တိုးလာပါတယ်" if change >= 0.01 else "လျော့နည်းလာပါတယ်" if change <= -0.01 else "သိပ်မပြောင်းလဲပါဘူး"
    trend_en = "up" if change >= 0.01 else "down" if change <= -0.01 else "little changed"
    return Condition(
        condition_id=_cid("soil_moisture", nw, now.date()), kind="soil_moisture", domains=["agriculture"],
        title=L("မြေဆီလွှာ စိုထိုင်းဆ", "Soil moisture"),
        headline=L(f"မြေအောက် ၉–၂၇ စင်တီမီတာ စိုထိုင်းဆ {md(_f(v, 2))} m³/m³ ဖြစ်ပြီး ပြီးခဲ့တဲ့ တစ်ပတ်က {md(_f(w, 2))} နဲ့ "
                   f"နှိုင်းယှဉ်ရင် {trend_my} (မော်ဒယ် ခန့်မှန်းချက်)။",
                   f"Soil moisture at 9–27 cm: {_f(v, 2)} m³/m³, {trend_en} from {_f(w, 2)} a week ago (model estimate)."),
        metrics=[Metric(key="soil_moisture_now", label=L("အခု", "Now"), value=v, unit="m³/m³"),
                 Metric(key="soil_moisture_7d_ago", label=L("တစ်ပတ်က", "A week ago"), value=w, unit="m³/m³")],
        sources=[FORECAST_SOURCE],
        time_window=TimeWindow(start=now - timedelta(days=7), end=now),
        limitations=[L("မြေပုံကွက် (grid) တစ်ကွက်အတွက် မော်ဒယ်ခန့်မှန်းချက်ဖြစ်ပြီး လယ်ကွင်းမှာ တိုင်းထားတာ မဟုတ်ပါဘူး။",
                       "Model estimate for a grid cell; not a field measurement.")])


def _climate_trend(nw: NormalizedWeather, bl: Optional[Baseline], today: date) -> Optional[Condition]:
    """How the daytime high for this time of year changed over 1991–2020 (descriptive, from the same ERA5 record)."""
    if bl is None:
        return None
    tr = bl.normals.trend("tmax", today)
    if tr is None:
        return None
    s, d = tr["slope_per_decade"], tr["recent_minus_all"]
    first, last = tr["first"], tr["last"]
    if tr["clear"] and s > 0:
        my = (f"နှစ်ရဲ့ ဒီအချိန်မှာ နေ့အမြင့်ဆုံး အပူချိန်က {md(first)}–{md(last)} အတွင်း ဆယ်စုနှစ်တစ်ခုကို {md(_f(s))}°C နှုန်း မြင့်လာတာ တွေ့ရပါတယ်။ "
              f"နောက်ဆုံး ၁၀ နှစ်က ၃၀ နှစ်ပျမ်းမျှထက် {md(_f(abs(d)))}°C {'ပိုပူ' if d >= 0 else 'ပိုအေး'}ပါတယ်။")
        en = (f"For this time of year the daytime high rose by about {_f(s)} °C per decade over {first}–{last}. "
              f"The latest 10 years were {_f(abs(d))} °C {'warmer' if d >= 0 else 'cooler'} than the 30-year mean.")
        level, lab = None, L("ပူလာတဲ့ လမ်းကြောင်း", "Warming trend")
    elif tr["clear"]:
        my = (f"နှစ်ရဲ့ ဒီအချိန်မှာ နေ့အမြင့်ဆုံး အပူချိန်က {md(first)}–{md(last)} အတွင်း ဆယ်စုနှစ်တစ်ခုကို {md(_f(abs(s)))}°C နှုန်း ကျလာတာ တွေ့ရပါတယ်။")
        en = f"For this time of year the daytime high fell by about {_f(abs(s))} °C per decade over {first}–{last}."
        level, lab = None, L("အေးလာတဲ့ လမ်းကြောင်း", "Cooling trend")
    else:
        my = (f"နှစ်ရဲ့ ဒီအချိန်မှာ နေ့အမြင့်ဆုံး အပူချိန်က {md(first)}–{md(last)} အတွင်း သိသာတဲ့ လမ်းကြောင်း မတွေ့ရပါဘူး "
              f"(ဆယ်စုနှစ်တစ်ခုကို {md(_signed(s))}°C၊ နှစ်စဉ်အပြောင်းအလဲထဲမှာပဲ ရှိပါတယ်)။")
        en = (f"No clear trend in the daytime high for this time of year over {first}–{last} "
              f"({_signed(s)} °C per decade, within year-to-year variation).")
        level, lab = None, None
    return Condition(
        condition_id=_cid("climate_trend", nw, today),
        kind="climate_trend", domains=["environment"], level=level, level_label=lab,
        title=L("၃၀ နှစ်အတွင်း အပူချိန် လမ်းကြောင်း", "30-year temperature trend"), headline=L(my, en),
        metrics=[Metric(key="slope_per_decade", label=L("ဆယ်စုနှစ်တစ်ခုအတွက် ပြောင်းလဲမှု", "Change per decade"), value=s, unit="°C"),
                 Metric(key="slope_se", label=L("မသေချာမှု (±)", "Uncertainty (±)"), value=tr["se_per_decade"], unit="°C"),
                 Metric(key="recent_minus_all", label=L("နောက်ဆုံး ၁၀ နှစ် ကွာခြားချက်", "Latest 10 years vs mean"), value=d, unit="°C"),
                 Metric(key="normal_mean", label=L("၃၀ နှစ် ပျမ်းမျှ", "30-year mean"), value=tr["mean"], unit="°C"),
                 Metric(key="n_years", label=L("နှစ်အရေအတွက်", "Years used"), value=tr["n_years"])],
        baseline={"period": f"{first}–{last}", "source": bl.source, "season_window_days": 7, "method": "OLS trend of seasonal mean"},
        sources=[bl.source],
        limitations=[L("ဒေသတစ်ခုတည်းရဲ့ မြေပုံကွက် (grid) ဒေတာ ၃၀ နှစ်ပဲ ပါလို့ လမ်းကြောင်းက မသေချာမှု ရှိပါတယ်။ ဒါက ဖြစ်ပျက်ခဲ့တာကို ဖော်ပြတာသာ ဖြစ်ပြီး နောက်ထပ်ဖြစ်မယ့်အရာကို ခန့်မှန်းတာ မဟုတ်ပါဘူး။",
                       "Only 30 years from one model grid cell, so the trend is uncertain. It describes the past and is not a forecast.")],
        time_window=TimeWindow(start=_day_start(nw, today), end=_day_start(nw, today + timedelta(days=1))))


def compute_conditions(nw: NormalizedWeather, bl: Optional[Baseline], now: datetime) -> list[Condition]:
    """All conditions that the available data supports. Each builder is isolated: missing data returns None
    and an unexpected failure is logged and skipped, never raised."""
    today = now.date()
    builders = [("temperature_max", lambda: _temperature(nw, bl, today, "tmax")),
                ("temperature_min", lambda: _temperature(nw, bl, today, "tmin")),
                ("rain_30d", lambda: _rain_30d(nw, bl)), ("rain_forecast_7d", lambda: _rain_forecast(nw, today)),
                ("spell", lambda: _spell(nw, today)), ("water_balance_14d", lambda: _water_balance(nw, today)),
                ("soil_moisture", lambda: _soil_moisture(nw, now)),
                ("climate_trend", lambda: _climate_trend(nw, bl, today))]
    out = []
    for name, build in builders:
        try:
            c = build()
        except Exception as exc:                    # noqa: BLE001
            log.exception("condition %s failed", name)
            METRICS.error(f"condition.{name}", exc)
            continue
        if c is not None:
            out.append(c)
    return out

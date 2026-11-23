// Plain-language health tips shown under the forecast, chosen from the current readings.
import { els, state } from "./core.js";
import { I18N, L } from "./i18n.js";
import { mountHealthTipsView } from "./views.js";
let draw=null;

const healthTip=(icon,title,text,tone="info")=>({icon,title,text,tone});

export function renderHealthTips(){
  if(!els.healthTips || !state.data) return;
  const my=state.lang==="my";
  const w=state.data.weather||{}, c=w.current||{}, d=w.daily||{}, a=state.data.air_quality||{};
  const code=Number(c.weather_code), tempC=Number(c.temperature_2m);
  const uv=Number(d.uv_index_max?.[0]), rain=Number(d.precipitation_probability_max?.[0]);
  const aqi=Number(a.current?.us_aqi), humidity=Number(c.relative_humidity_2m);
  const tips=[];
  if(Number.isFinite(uv) && uv>=11)
    tips.push(healthTip("🛑",L("wx_extreme_uv"),L("wx_stay_indoors_if_possible_if"),"danger"));
  else if(Number.isFinite(uv) && uv>=8)
    tips.push(healthTip("☀️",L("wx_very_high_uv"),L("wx_limit_midday_sun_use_shade"),"danger"));
  else if(Number.isFinite(uv) && uv>=6)
    tips.push(healthTip("☀️",L("wx_uv_high"),L("wx_use_shade_sun_protection_during"),"warn"));
  if(Number.isFinite(tempC) && tempC>=35)
    tips.push(healthTip("🥤",L("wx_high_heat"),
      L("wx_drink_water_regularly_reduce_strenuous"),"warn"));
  if(Number.isFinite(aqi) && aqi>=101)
    tips.push(healthTip("😷",L("wx_air_quality_needs_attention"),
      L("wx_consider_reducing_prolonged_outdoor_exertion"),"warn"));
  if([95,96,99].includes(code))
    tips.push(healthTip("⛈️",L("wx_thunderstorm"),
      L("wx_stay_indoors_during_thunderstorms_avoid"),"danger"));
  else if([65,82].includes(code) || (Number.isFinite(rain)&&rain>=70))
    tips.push(healthTip("🌧️",L("wx_heavy_rain_possible"),
      L("wx_watch_flooding_slippery_roads_reduced"),"warn"));
  const wet=[51,53,55,61,63,65,80,81,82].includes(code) || (Number.isFinite(rain)&&rain>=50);
  if(wet && Number.isFinite(tempC) && tempC>=24)   // standing water after rain breeds dengue mosquitoes (WHO)
    tips.push(healthTip("🦟",L("wx_mosquito_title"),L("wx_mosquito_text"),"info"));
  if([65,82].includes(code) || (Number.isFinite(rain)&&rain>=70))   // floodwater and safe drinking water (CDC, WHO)
    tips.push(healthTip("🚰",L("wx_floodwater_title"),L("wx_floodwater_text"),"warn"));
  if(Number.isFinite(humidity) && humidity>=85 && Number.isFinite(tempC) && tempC>=30)
    tips.push(healthTip("💧",L("wx_hot_humid"),
      L("wx_take_breaks_keep_hydrated_hot"),"info"));
  if(!tips.length)
    tips.push(healthTip("✓",L("wx_no_major_health_alert"),
      L("wx_no_major_weather_related_health"),"good"));
  draw=draw||mountHealthTipsView(); draw(tips.slice(0,4));
  if(els.healthIntro) els.healthIntro.textContent=my?I18N.my.healthIntro:I18N.en.healthIntro;
}

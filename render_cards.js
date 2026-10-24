// Pure rendering of the main cards: current conditions, hourly, 7-10 day forecast, charts and weather theme.
import { $, els, esc, fmtDay, fmtTime, speed, state, temp, weatherInfo } from "./core.js";
import { renderEnso } from "./enso_card.js";
import { L } from "./i18n.js";
import { hydrationModel, renderDisease, moonDayText } from "./field_guides.js";
import { myanmarDateOf, uposatha } from "./mm_calendar.js";
import { mountWeatherView, clearSlot } from "./views.js";

// The cards below are drawn by React (frontend/src/weather_view.jsx -> views.js). This file prepares the data and wires events.
let V=null;
const view=()=>V||(V=mountWeatherView());
const X=()=>({L,my:state.lang==="my",temp,fmtTime,fmtDay,speed,weatherInfo});
// Other modules that used to empty a card with replaceChildren() call this so React and the DOM stay in step.

// ---------------------------------------------------------------------------------------------------------------
// Level scales ("how high is high?") for every reading, in the style of the UV index. Each step: upper bound
// (exclusive), tone 0–5 (0 neutral, 1 fine, 2 be aware, 3 take care, 4 avoid/limit, 5 dangerous), a short label
// and a one-line tip, in Burmese and English. Thresholds follow common public scales (US AQI, WHO/WMO UV index,
// IMD/WMO daily-rain classes, Beaufort wind, NOAA heat index). They are guidance, not DMH warnings.


// Open-Meteo returns local wall-clock strings ("2026-09-29T14:00") plus utc_offset_seconds. Parsing them with the
// viewer's own time zone (as before) shifted the 24 h rain window and the hourly strip for anyone outside Myanmar.
export function omTs(str,w){
  if(!str) return NaN;
  const hasZone=/[zZ]$|[+-]\d\d:?\d\d$/.test(str);
  const iso=hasZone?str:(str.length<=10?str+"T00:00":str)+"Z";
  const t=Date.parse(iso);
  return hasZone?t:t-(Number(w?.utc_offset_seconds)||0)*1000;
}

export function applyWeatherTheme(c){
  const code=Number(c?.weather_code), isDay=Number(c?.is_day)===1, tempC=Number(c?.temperature_2m);
  document.body.classList.remove("weather-clear","weather-rain","weather-storm","weather-fog","weather-hot","weather-night");
  // Condition class always applies (rain/storm/fog/hot/clear); "night" is an
  // additional modifier layered on top, not a replacement — so a rainy night
  // still reads as "rainy", just dimmer, instead of flipping to plain black.
  if([95,96,99].includes(code)) document.body.classList.add("weather-storm");
  else if([45,48].includes(code)) document.body.classList.add("weather-fog");
  else if([51,53,55,61,63,65,71,73,75,80,81,82].includes(code)) document.body.classList.add("weather-rain");
  else if(tempC>=35) document.body.classList.add("weather-hot");
  else document.body.classList.add("weather-clear");
  if(!isDay) document.body.classList.add("weather-night");
}

// ---- Next 24 hours: a strip of hours; tapping one hour shows only that hour's details below (no long table) ----
let HOURS=null, HOUR_SEL="";
export function renderHourly(h,w){
  if(!h?.time){HOURS=null;view().hours(null);view().detail(null);return;}
  const now=Date.now(); let idx=h.time.findIndex(x=>omTs(x,w)>=now-30*60000); if(idx<0)idx=0;
  const end=Math.min(idx+24,h.time.length), rows=[];
  for(let j=idx;j<end;j++) rows.push({t:h.time[j],c:h.weather_code?.[j],T:h.temperature_2m?.[j],p:h.precipitation_probability?.[j]??0,r:h.precipitation?.[j]??0,u:h.relative_humidity_2m?.[j],w:h.wind_speed_10m?.[j]});
  HOURS=rows; if(!rows.some(r=>r.t===HOUR_SEL)) HOUR_SEL=rows[0]?.t||"";
  paintHours();
}
function paintHours(){
  if(!HOURS?.length){view().hours(null);view().detail(null);return;}
  view().hours(HOURS,HOUR_SEL,X());
  view().detail(HOURS,HOUR_SEL,X());
}
document.addEventListener("click",e=>{
  const b=e.target.closest?.("#hourlyForecast .hour[data-hour]"); if(!b||!HOURS) return;
  HOUR_SEL=b.dataset.hour; paintHours(); $("#hourlyForecast .hour.selected")?.scrollIntoView?.({block:"nearest",inline:"center",behavior:"smooth"});
});
document.addEventListener("keydown",e=>{
  if(!["ArrowLeft","ArrowRight"].includes(e.key)||!HOURS||!e.target.closest?.("#hourlyForecast .hour")) return;
  const i=HOURS.findIndex(x=>x.t===HOUR_SEL), n=Math.max(0,Math.min(HOURS.length-1,i+(e.key==="ArrowRight"?1:-1)));
  if(n===i) return; e.preventDefault(); HOUR_SEL=HOURS[n].t; paintHours(); $("#hourlyForecast .hour.selected")?.focus();
});

// Myanmar calendar under each forecast day: month and moon day (လဆန်း ၇ ရက်), with a mark on observance days (ဥပုသ်)
function calMark(iso){
  const md=myanmarDateOf(iso); if(!md) return null;
  const t=moonDayText(md), u=uposatha(md), icon=u==="full"?"🌕 ":u==="new"?"🌑 ":u==="half"?"🌓 ":"";
  return {text:icon+(u==="full"||u==="new"?t.mo+" "+t.day:t.day),u:!!u};
}

export function renderForecast(d){
  if(!d?.time){view().forecast(null);return;}
  const rows=d.time.map((tm,i)=>({tm,code:d.weather_code?.[i],rain:Math.round(d.precipitation_probability_max?.[i]??0),mm:Number(d.precipitation_sum?.[i]??0),
    max:d.temperature_2m_max?.[i],min:d.temperature_2m_min?.[i],far:i>=7,dayText:fmtDay(tm),cal:calMark(tm)}));
  view().forecast(rows,X());
}

// Keep dates in the forecast's calendar day, regardless of the viewer's time zone.
function temperatureChart(d){
  const my=state.lang==="my",digits="၀၁၂၃၄၅၆၇၈၉";
  const number=value=>{
    const text=String(Math.round(value*10)/10);
    return my?text.replace(/\d/g,digit=>digits[Number(digit)]):text;
  };
  const unit=`°${state.unit}`,valueLabel=value=>`${number(Math.round(value))}${unit}`;
  const conv=v=>{const c=v==null||v===""?NaN:Number(v);return state.unit==="F"?c*9/5+32:c;};
  const mins=d?.temperature_2m_min||[];
  const points=(d?.temperature_2m_max||[]).map((value,index)=>{
    const valueInUnit=conv(value), lowInUnit=conv(mins[index]);
    const raw=d.time?.[index]||"",date=/^\d{4}-\d{2}-\d{2}$/.test(raw)?new Date(raw+"T12:00:00Z"):null;
    const validDate=date&&!Number.isNaN(+date);
    const day=validDate?L(`chart_weekday_${date.getUTCDay()}`):L("wx_day");
    const dateLabel=validDate?`${number(date.getUTCDate())}/${number(date.getUTCMonth()+1)}`:number(index+1);
    return {value:valueInUnit,low:lowInUnit,day,shortDay:validDate?L(`chart_short_weekday_${date.getUTCDay()}`):day,dateLabel};
  });
  const values=points.flatMap(point=>[point.value,point.low]).filter(Number.isFinite);
  if(!values.length){view().tempChart({empty:true},L);return;}
  const low=Math.min(...values),high=Math.max(...values),padding=state.unit==="F"?4:2;
  const suggested=(high-low+padding*2)/4,magnitude=10**Math.floor(Math.log10(suggested));
  const step=[1,2,5,10].find(size=>size*magnitude>=suggested)*magnitude;
  const bottom=Math.floor((low-padding)/step)*step,top=Math.ceil((high+padding)/step)*step;
  const width=Math.max(420,70+55*(points.length-1)),height=260,left=46,right=24,plotTop=30,plotBottom=180;
  const x=index=>points.length===1?(left+width-right)/2:left+index*(width-left-right)/(points.length-1);
  const y=value=>plotBottom-(value-bottom)/(top-bottom)*(plotBottom-plotTop);
  const ticks=Array.from({length:Math.round((top-bottom)/step)+1},(_,index)=>bottom+index*step);
  const description=points.map(point=>`${point.day} ${point.dateLabel}: ${Number.isFinite(point.value)?valueLabel(point.value):L("wx_unavailable")} / ${Number.isFinite(point.low)?valueLabel(point.low):L("wx_unavailable")}`).join("; ");
  const hasLow=points.some(point=>Number.isFinite(point.low));
  view().tempChart({points,ticks,width,height,left,right,plotTop,plotBottom,x,y,number,valueLabel,unit,hasLow,description},L);
}

export function renderCharts(d){
  temperatureChart(d);
  const probs=d?.precipitation_probability_max||[];
  view().rainChart(probs.map((v,i)=>({h:Math.max(2,Math.min(100,Number(v)||0)),pct:Math.round(v||0),day:new Date(d.time[i]).toLocaleDateString(L("wx_en_us"),{weekday:"short",timeZone:"UTC"})})));
}

export function renderLocal(d,loc){
  if(!d?.weather?.current?.time){window.renderTodayBrief?.(null,loc);window.renderAgri?.(null,loc);["agriLocal","heatCard","cycloneCard"].forEach(clearSlot);clearSlot("diseaseCard");return;}
  try{window.renderTodayBrief&&window.renderTodayBrief(d,loc);}catch{} try{window.rainLogSnapshot&&window.rainLogSnapshot(d,loc);}catch{}
  try{window.renderAgri&&window.renderAgri(d,loc);}catch{}
  try{renderDisease(d.weather.hourly);}catch{}
  const my=state.lang==="my", w=(d&&d.weather)||{}, di=w.daily||{};
  const place=(my?loc.name:(loc.name_en||loc.name))||"";
  const rain=(di.precipitation_sum||[]).slice(0,7).map(Number).filter(Number.isFinite);
  const prob=(di.precipitation_probability_max||[]).slice(0,7).map(x=>x==null?NaN:Number(x));
  const code=(di.weather_code||[]).slice(0,7).map(Number);
  const tmax=(di.temperature_2m_max||[]).slice(0,3).map(Number).filter(Number.isFinite);
  const sum=rain.reduce((a,b)=>a+b,0);
  const showerCode=c=>[80,81,82,95,96,97,99].includes(c);
  // a day counts as "dry" only if the model total is tiny AND nothing hints at showers (chance >=30% or shower/thunder code)
  const hint=i=>(prob[i]>=30)||showerCode(code[i]);
  const dry=rain.filter((x,i)=>x<1&&!hint(i)).length;
  const scat=rain.filter((x,i)=>x<5&&hint(i)).length;
  // 1) local 7-day rain outlook (app-computed from the forecast, not an official drought statement)
  if(!rain.length){view().localRain(null,L);}
  else{
    let tier,msg;
    if(sum<5&&dry>=6){tier="dry";msg=L("wx_very_little_rain_expected_several");}
    else if(scat>=2&&sum<25){tier="mid";msg=L("wx_scattered_showers_possible_their_exact");}
    else if(sum<25){tier="mid";msg=L("wx_only_light_rain_expected_keep");}
    else{tier="wet";msg=L("wx_good_rain_expected_watch_waterlogging");}
    view().localRain({place,sum,dry,scat,n:rain.length,tier,msg},L);
  }
  // 2) heat card in the Alerts tab (heuristic thresholds, labelled as such)
  if(!tmax.length){view().heat(null,L);}
  else{
    const m=Math.max(...tmax); let lv,tx;
    const fl=(di.apparent_temperature_max||[]).slice(0,3).map(Number).filter(Number.isFinite), feels=fl.length?Math.max(...fl):NaN; // feels-like, for the drinking-water advice
    if(m>=40){lv="high";tx=L("wx_extreme_heat_possible_avoid_going");}
    else if(m>=37){lv="mid";tx=L("wx_hot_weather_likely_shift_outdoor");}
    else if(m>=35){lv="low";tx=L("wx_bit_hot_avoid_long_periods");}
    else{lv="ok";tx=L("wx_no_extreme_heat_expected");}
    view().heat({place,max:m,tier:lv==="ok"?"wet":lv==="low"?"mid":"dry",text:tx,hydration:hydrationModel(feels)},L);
  }
  // 3) cyclone-season note + official link
  view().cyclone(L);
  renderEnso(loc,place,sum,rain.length);
}

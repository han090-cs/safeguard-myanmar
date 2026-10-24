// Pure helpers (no DOM): wind-direction names, a small date helper, weather-based crop-disease watch.
// Kept free of imports so it can be unit-tested with plain Node (tests/nature.test.mjs).

const MY_DIRS=["မြောက်","အရှေ့မြောက်","အရှေ့","အရှေ့တောင်","တောင်","အနောက်တောင်","အနောက်","အနောက်မြောက်"];
const EN_DIRS=["N","NE","E","SE","S","SW","W","NW"];

/** Wind direction as a name. `deg` is the direction the wind blows FROM (meteorological convention).
 *  South-west wind during the rainy season (May-October) is the south-west monsoon. */
export function windName(deg, lang="my", month=null){
  if(deg==null||!Number.isFinite(Number(deg))) return "—";
  const i=Math.round((((Number(deg)%360)+360)%360)/45)%8, monsoon=i===5&&month>=5&&month<=10;
  if(lang==="my") return MY_DIRS[i]+"လေ"+(monsoon?" (မုတ်သုံလေ)":"");
  return EN_DIRS[i]+(monsoon?" (monsoon)":"");
}

export const addDays=(date,d)=>new Date((date instanceof Date?date.getTime():date)+d*86400000);

/** True when the place can feel tides (coast, delta and tidal river mouths). Inland rivers are not driven by the moon. */
export const TIDAL_REGION=/yangon|ရန်ကုန်|ayeyarwady|ayeyarwaddy|irrawaddy|ဧရာဝတီ|rakhine|arakan|ရခိုင်|\bmon\b|မွန်|tanintharyi|tenasserim|တနင်္သာရီ|bago|pegu|ပဲခူး/i;

/** Weather-based crop-disease watch. It only says the WEATHER suits the disease (it does not say the disease is present).
 *  Conditions come from published crop-protection sources (IRRI/CABI for rice blast, UC IPM + extension work for onion downy
 *  mildew, Michigan State/Wallin for potato late blight). Hourly relative humidity at 2 m is lower than inside a crop canopy,
 *  so the thresholds are applied to 2 m data as an estimate. Brown planthopper is NOT included: studies do not agree on a weather trigger.
 *  hourly: {time[], temperature_2m[], relative_humidity_2m[], precipitation[]}; returns up to `days` day entries. */
export const DISEASES=[
  {id:"blast",   crops:["rice"],             hoursRH:10, rh:90, tMin:17, tMax:28},
  {id:"lateBlight", crops:["potato","tomato"], hoursRH:10, rh:90, tMin:7,  tMax:27},
  {id:"downyMildew", crops:["onion"],        hoursRH:10, rh:90, tMin:6,  tMax:24}
];
export function diseaseWatch(hourly, days=3){
  const T=hourly?.time||[], H=hourly?.relative_humidity_2m||[], C=hourly?.temperature_2m||[], P=hourly?.precipitation||[];
  if(!T.length||!H.length||!C.length) return [];
  const byDay=new Map();
  T.forEach((tm,i)=>{ const d=String(tm).slice(0,10); if(!byDay.has(d)) byDay.set(d,[]); byDay.get(d).push(i); });
  const out=[];
  for(const [date,idx] of [...byDay].slice(0,days)){
    if(idx.length<20) continue; // incomplete day
    const temps=idx.map(i=>Number(C[i])).filter(Number.isFinite), mean=temps.reduce((a,b)=>a+b,0)/temps.length;
    const rainHours=idx.filter(i=>Number(P[i])>0).length;
    const hits=DISEASES.filter(ds=>{
      const wet=idx.filter(i=>Number(H[i])>=ds.rh).length;
      return wet>=ds.hoursRH && mean>=ds.tMin && mean<=ds.tMax;
    }).map(ds=>({id:ds.id,crops:ds.crops,wetHours:idx.filter(i=>Number(H[i])>=ds.rh).length}));
    out.push({date,meanTemp:mean,rainHours,hits});
  }
  return out;
}

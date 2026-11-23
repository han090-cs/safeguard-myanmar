import {readFileSync} from 'node:fs';
export const stamp=()=>new Date().toISOString();
export const places={
 shwebo:{id:'town-shwebo',name:'ရွှေဘို',name_en:'Shwebo',region:'Sagaing',region_my:'Sagaing',type:'Town',country:'Myanmar',country_code:'MM',latitude:22.55,longitude:95.7},
 yangon:{id:'town-yangon',name:'ရန်ကုန်',name_en:'Yangon',region:'Yangon',region_my:'Yangon',type:'Town',country:'Myanmar',country_code:'MM',latitude:16.84,longitude:96.17},
 other:{id:'town-nyaung',name:'ညောင်ရွှေ',name_en:'Nyaungshwe',region:'Shan',region_my:'Shan',type:'Town',country:'Myanmar',country_code:'MM',latitude:20.66,longitude:96.94}
};
export function weather(lat){
 const temperature=lat>20?25:30,day=new Date();day.setUTCHours(0,0,0,0);
 const hourlyTimes=Array.from({length:96},(_,i)=>new Date(+day+i*3600000).toISOString().slice(0,16));
 const dates=Array.from({length:7},(_,i)=>new Date(+day+i*86400000).toISOString().slice(0,10));
 const hourly={time:hourlyTimes};for(const [key,value] of Object.entries({temperature_2m:temperature,weather_code:3,precipitation_probability:40,precipitation:0.2,wind_speed_10m:8,relative_humidity_2m:70}))hourly[key]=hourlyTimes.map(()=>value);
 const daily={time:dates};for(const [key,value] of Object.entries({temperature_2m_max:temperature+6,temperature_2m_min:temperature-2,apparent_temperature_max:temperature+7,weather_code:3,precipitation_sum:2,precipitation_probability_max:40,uv_index_max:4,wind_gusts_10m_max:12}))daily[key]=dates.map(()=>value);
 daily.sunrise=dates.map(d=>d+'T06:00');daily.sunset=dates.map(d=>d+'T18:00');
 return {weather:{timezone:'Asia/Yangon',utc_offset_seconds:19800,current:{time:hourlyTimes[12],temperature_2m:temperature,apparent_temperature:temperature+2,weather_code:3,is_day:1,wind_speed_10m:8,wind_direction_10m:90,relative_humidity_2m:70,pressure_msl:1010,visibility:10000},daily,hourly},air_quality:{current:{us_aqi:40,pm2_5:8}},meta:{provider:'Fixture',fetched_at:Date.now()/1000,stale:false}};
}
export function climate(lat){const v=lat>20?31:36;return {generated_at:stamp(),conditions:[{kind:'temperature_max',title:{en:'Daytime high',my:'နေ့အပူချိန်'},headline:{en:`Place comparison ${v} °C`,my:`${v} °C`},level:'above_normal',level_label:{en:'Warmer than usual',my:'ပုံမှန်ထက်ပူ'},metrics:[{key:'forecast_tmax',value:v},{key:'normal_p10',value:24},{key:'normal_p90',value:32},{key:'normal_mean',value:28}],limitations:[],sources:[]}]};}
export async function mockApis(page,{weatherDelay=0,hospitalDelay=0}={}){
  await page.addInitScript(()=>{document.addEventListener("DOMContentLoaded",()=>{document.getElementById("topMore")?.classList.add("open")})});
 const counts={};await page.addInitScript(()=>localStorage.setItem('lang','en'));
 await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url()),path=u.pathname;counts[path]=(counts[path]||0)+1;
   const lat=Number(u.searchParams.get('lat'));
   let data;
   if(path==='/api/mimu-search'){const q=(u.searchParams.get('q')||'').toLowerCase();data={results:q.includes('shwe')&&q!=='shwebo'?[places.shwebo,places.other]:Object.values(places).filter(p=>[p.name,p.name_en.toLowerCase()].includes(q))};}
   else if(path==='/api/geocode')data={results:[]};
   else if(path==='/api/weather'){if(weatherDelay)await new Promise(r=>setTimeout(r,weatherDelay));data=weather(lat);}
   else if(path==='/api/v1/climate')data=climate(lat);
   else if(path==='/api/v1/what-matters-today')data={generated_at:stamp(),items:[],official_warnings:[],source_status:{},providers:[]};
   else if(path==='/api/v1/risk')data={generated_at:stamp(),model_signals:[],seasonal_context:[]};
   else if(path==='/api/dmh/alerts')data={alerts:[],source_status:{last_success_at:stamp(),stale:false,importer_enabled:true}};
   else if(path==='/api/flood')data={status:'not_configured',gauges:[]};
   else if(path==='/api/hospitals/nearest'){if(hospitalDelay)await new Promise(r=>setTimeout(r,hospitalDelay));data={source:'Fixture',total_available:6,results:Array.from({length:6},(_,i)=>({name:`${lat>20?'Shwebo':'Yangon'} Hospital ${i}`,name_en:`${lat>20?'Shwebo':'Yangon'} Hospital ${i}`,level:'General',township:'Township',beds:100,latitude:lat,longitude:96,distance_km:i+1,confidence:'high'}))};}
   else if(path==='/api/world-hazards')data={alerts:[{id:'usgs:1',source:'USGS',kind:'earthquake',level:'warning',title:'M 7.1 - Test Sea',magnitude:7.1,time:stamp(),lat:35.6,lon:139.7,url:'https://earthquake.usgs.gov/x'},{id:'eonet:1',source:'NASA EONET',kind:'wildfire',level:'info',title:'Wildfire Test',time:stamp(),lat:38.2,lon:-120.5,url:'javascript:alert(1)'}],errors:{},stale:false,fetched_at:stamp()};
   else if(path==='/api/hazard-feed')data={alerts:[],errors:{},fetched_at:stamp()};
   else if(path==='/api/local-extras')data={water:{balance_mm:-20,rain_mm:4,et0_mm:24}};
   else if(path==='/api/history')return route.fulfill({status:503,json:{detail:'Fixture history failure'}});
   else if(path==='/api/enso')data=JSON.parse(readFileSync(new URL('../../data/enso_status.json',import.meta.url),'utf8'));
   else if(path==='/api/agri'&&u.searchParams.has('lat')){data=JSON.parse(readFileSync(new URL('../../data/agri.json',import.meta.url),'utf8'));data.location_zone={zone:lat>20?'dry':'delta',region:lat>20?'Sagaing':'Yangon',mixed:false,confidence:'medium'};}
   else return route.continue();
   try{await route.fulfill({json:data});}catch{ /* Request may have been deliberately cancelled. */ }
 });return counts;
}
export async function choose(page,name){
 if(await page.locator('#dashboard').isVisible())await page.locator('[data-act=pick]:visible').first().click();
 await page.locator('#locationInput').fill(name);await page.locator('#searchForm button[type=submit]').click();
 await page.locator('#loading').waitFor({state:'hidden'});
}

/** Phone: Flood, Hospitals, Compare and Lab sit behind the bottom bar's More button; wider screens show them directly. */
export async function openTab(page,name){
  if(['flood','hospitals','compare','lab'].includes(name)&&await page.locator('.tab-more').isVisible())await page.locator('.tab-more').click();
  await page.locator('[data-tab='+name+']').click();
}
export async function openFarm(page){
  const go=page.locator('.tab-farm');if(await go.isVisible())await go.click();else await page.locator('#modeFarm').click();
}

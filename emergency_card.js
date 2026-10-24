// Emergency numbers card (national, DMH and per-region numbers).
import { state } from "./core.js";
import { L } from "./i18n.js";
import { mountEmergencyView } from "./views.js";
let draw=null;

const EMERGENCY_NATIONAL=[
  {k:"police",my:"ရဲ",en:"Police",num:"199"},
  {k:"ambulance",my:"လူနာတင်ယာဉ်",en:"Ambulance",num:"192"},
  {k:"fire",my:"မီးသတ်",en:"Fire",num:"191"}
];

const EMERGENCY_DMH={my:"မိုးလေဝသနှင့်ဇလဗေဒညွှန်ကြားမှုဦးစီးဌာန (ပြည်သူ့ဖုန်း)",en:"Dept. of Meteorology & Hydrology (public line)",nums:["067-411252","01-667766"]};

const EMERGENCY_REGIONAL=[
  {re:/yangon|rangoon|ရန်ကုန်/i,my:"ရန်ကုန်",en:"Yangon",rows:[
    {my:"ရဲ",en:"Police",nums:["01-549309"]},{my:"လူနာတင်ယာဉ်",en:"Ambulance",nums:["09-21060999"]}]},
  {re:/mandalay|မန္တလေး/i,my:"မန္တလေး",en:"Mandalay",rows:[
    {my:"ရဲ",en:"Police",nums:["02-4036871"]},{my:"လူနာတင်ယာဉ်",en:"Ambulance",nums:["02-4039835"]}]},
  {re:/nay\s*pyi\s*taw|naypyi?daw|naypyitaw|နေပြည်တော်/i,my:"နေပြည်တော်",en:"Nay Pyi Taw",rows:[
    {my:"ရဲ",en:"Police",nums:["067-414224"]},{my:"မီးသတ်",en:"Fire",nums:["067-420025","067-425540"]},{my:"လူနာတင်ယာဉ်",en:"Ambulance",nums:["067-420096"]}]}
  ,
  /* State / region police force numbers, Myanmar National Portal (Emergency Contact Number > Police Station). */
  ...[
    [/kachin|ကချင်/i,"ကချင်","Kachin",["09-781416702"]],
    [/kayah|kayar|karenni|ကယား/i,"ကယား","Kayah",["09-404081708"]],
    [/kayin|karen|ကရင်/i,"ကရင်","Kayin",["058-2021009","058-2021096"]],
    [/\bchin\b|ချင်း/i,"ချင်း","Chin",["09-254371205"]],
    [/sagaing|စစ်ကိုင်း/i,"စစ်ကိုင်း","Sagaing",["071-2022991","071-2022992"]],
    [/tanintharyi|tenasserim|တနင်္သာရီ/i,"တနင်္သာရီ","Tanintharyi",["059-2021034","059-2023550"]],
    [/bago|pegu|ပဲခူး/i,"ပဲခူး","Bago",["052-2221076"]],
    [/magway|magwe|မကွေး/i,"မကွေး","Magway",["063-2025016"]],
    [/^\s*mon\b|မွန်/i,"မွန်","Mon",["057-2027880","057-2027884"]],
    [/rakhine|arakan|ရခိုင်/i,"ရခိုင်","Rakhine",["09-893279319","09-679394981"]],
    [/shan|ရှမ်း/i,"ရှမ်း","Shan",["081-2202122","081-2124654"]],
    [/ayeyarwady|ayeyarwaddy|irrawaddy|ဧရာဝတီ/i,"ဧရာဝတီ","Ayeyarwady",["042-21030","042-25822"]]
  ].map(([re,my,en,nums])=>({re,my,en,rows:[{my:"ရဲတပ်ဖွဲ့ (ဒေသ)",en:"Regional police force",nums}]}))
];

const telHref=n=>"tel:"+String(n).replace(/[^0-9+]/g,"");
const telObj=n=>({n:String(n),href:telHref(n)});
export function nationalEmergencyRows(){
  const my=state.lang==="my";
  return EMERGENCY_NATIONAL.map(x=>({label:my?x.my:x.en,...telObj(x.num)}));
}

export function renderEmergency(){
  if(!document.getElementById("emergencyCard")) return;
  const my=state.lang==="my";
  const loc=state.location||{};
  const probe=[loc.admin1,loc.admin1_en].filter(Boolean).join(" ");
  const reg=EMERGENCY_REGIONAL.find(r=>r.re.test(probe));
  draw=draw||mountEmergencyView();
  draw({title:L("wx_emergency_numbers"),sub:L("wx_tap_number_call"),nat:nationalEmergencyRows(),
    reg:reg?{title:my?reg.my:reg.en,rows:reg.rows.map(r=>({label:my?r.my:r.en,nums:r.nums.map(telObj)}))}:null,notVerified:L("wx_local_numbers_region_not_verified"),
    dmh:{title:my?EMERGENCY_DMH.my:EMERGENCY_DMH.en,label:L("wx_weather_information"),nums:EMERGENCY_DMH.nums.map(telObj)},sources:L("wx_sources_myanmar_national_portal_dmh")});
}

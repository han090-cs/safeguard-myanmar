/* About dialog: purpose, what is inside, limits, how figures are worked out, glossary, privacy and credits.
   All long explanations live here so the data tabs stay clean. */
import { helpGroups } from "./help.js";
import { mountAboutView } from "./views.js";
{
  const my=()=>(window.__mwLang?window.__mwLang():"my")==="my";
  const C={
    title:["ဒီ website အကြောင်း","About this site"],
    close:["ပိတ်မယ်","Close"],
    s_goal:["ကျွန်တော်တို့ ရည်ရွယ်ချက်","Our purpose"],
    goal:[
      "မြန်မာနိုင်ငံက လူတွေ၊ အထူးသဖြင့် လယ်သမား၊ ငါးဖမ်းသမားနဲ့ ကျေးလက်က မိသားစုတွေ ကိုယ့်နေရာမှာ ဒီနေ့၊ ဒီအပတ် မိုးလေဝသ ဘယ်လိုရှိမလဲ ဆိုတာကို မြန်မာလို ရှင်းရှင်းလင်းလင်း၊ အခမဲ့ သိနိုင်ဖို့ ရည်ရွယ်ပါတယ်။",
      "စိုက်ပျိုးရေးအတွက် ဒေသအလိုက် အဓိကစိုက်ပျိုးတဲ့ သီးနှံတွေနဲ့ အခုရာသီဥတုကြောင့် ဖြစ်လာနိုင်တာတွေကို ကူညီပြသပါမယ်။",
      "ရေကြီးမှု၊ ပူလောင်မှု၊ လေထုညစ်ညမ်းမှုလို သဘာဝဘေးအန္တရာယ်တွေကို စောစောသိပြီး ကြိုတင်ကာကွယ်နိုင်ဖို့ ဒေသတွင်းဒေတာတွေကို တစ်နေရာတည်းမှာ စုပြထားပါတယ်။"],
    goal_en:[
      "To help people in Myanmar, especially farmers, fishers and rural families, see in plain Myanmar-language terms what the weather will do at their own place today and this week, free of charge.",
      "For farming, it shows the main crops grown in each region and what the current weather could mean for them.",
      "For natural hazards such as floods, heat and air pollution, it gathers regional data in one place so people can prepare early."],
    s_in:["ဘာတွေ ပါလဲ","What is inside"],
    inn:["ယနေ့: ဒီနေ့ ဘာလုပ်မလဲ အကျဉ်းနဲ့ အခုရာသီဥတု။ နှိုင်းယှဉ်ချက်: ပုံမှန်နဲ့ယှဉ်တဲ့ ဂရပ်တွေနဲ့ အရင်နှစ်တွေ။ ၇ ရက်: ခန့်မှန်းချက်နဲ့ မိုးရွာလား စစ်ကြည့်ခြင်း။ ရေကြီး၊ ဆေးရုံ၊ သတိပေး၊ စိုက်ပျိုးရေး tab တွေလည်း ပါပါတယ်။","Today: what to do today and current weather. Compare: charts against normal and past years. 7 days: forecast and a did-it-rain check. Plus Flood, Hospitals, Alerts and Farming."],
    s_lim:["သတိပြုရန်","Please note"],
    lim:[
      "ဒီ website က တရားဝင် သတိပေးချက် မဟုတ်ပါ။ မုန်တိုင်း၊ ရေကြီးနဲ့ အရေးပေါ်အခြေအနေတွေမှာ မြန်မာနိုင်ငံ မိုးလေဝသနှင့် ဇလဗေဒညွှန်ကြားမှုဦးစီးဌာန (DMH) နဲ့ ဒေသအာဏာပိုင်တွေရဲ့ ညွှန်ကြားချက်ကို အရင်လိုက်နာပါ။",
      "ခန့်မှန်းချက်တွေက မှားနိုင်ပါတယ်။ ရက်ဝေးလေ တိကျမှုလျော့ပြီး ၇ ရက်ကျော်တာတွေက လမ်းကြောင်းလောက်ပဲ ယူပါ။ မိုးရွာနိုင်ခြေ ၁၀၀% ပြတာက ကိုယ့်နေရာမှာ ရွာမယ်ဆိုတဲ့ အာမခံချက် မဟုတ်ပါဘူး။",
      "၁၉၈၅ ကစတဲ့ ရာသီဥတုသမိုင်းဒေတာက တွက်ချက်ထားတဲ့ ဒေတာ (simulation) ဖြစ်ပြီး မိုးတိုင်းတာစခန်းရဲ့ တိုင်းတာချက် မဟုတ်ပါ။ တိုင်း/ပြည်နယ်တစ်ခုကို ဗဟိုတစ်နေရာနဲ့ ကိုယ်စားပြုလို့ ကိုယ့်မြို့နဲ့ ကွာနိုင်ပါတယ်။",
      "ဆေးရုံစာရင်းက ၂၀၂၀ ခုနှစ် MIMU ဒေတာအစုကို အခြေခံပါတယ်။ ဖုန်းနံပါတ်၊ တည်နေရာတွေကို တစ်ခုချင်း အတည်မပြုရသေးလို့ သွားခင် ဖုန်းဆက်ပြီး အတည်ပြုပါ။",
      "စိုက်ပျိုးရေး အကြံပြုချက်တွေက အထွေထွေ လက်တွေ့စည်းမျဉ်းတွေပါ။ သီးနှံ၊ မြေအမျိုးအစား၊ ဆေးအမျိုးအစားအလိုက် ကွာပါတယ်။ ဆေးညွှန်းကိန်းကို ဦးစားပေးပြီး ဒေသဆိုင်ရာ စိုက်ပျိုးရေးဦးစီးဌာနနဲ့ ညှိပါ။",
      "ဒီ website ကို vibe coding နည်းနဲ့ (AI နဲ့ ပြောပြီး) တည်ဆောက်ထားတာမို့ ကုဒ်နဲ့ စာသား အနည်းငယ်ကို AI က ရေးပေးထားပါတယ်။ ဒါကြောင့် မြန်မာစာ အရေးအသား၊ စကားလုံးရွေးချယ်မှု၊ စာလုံးပေါင်းတွေမှာ အမှားနဲ့ အခက်အခဲ ရှိနိုင်ပါတယ်။ မှားနေတာ တွေ့ရင် ပြောပြပေးပါ၊ ပြင်ပေးပါမယ်။",
      "အရေးပေါ်လက်စွဲ၊ အပူမှာ ရေသောက်ပုံ၊ သီးနှံရောဂါ သတိပေးချက်တွေက အထွေထွေ လမ်းညွှန်ချက်တွေပါ။ ဆရာဝန်၊ ကျွမ်းကျင်သူရဲ့ အကြံကို အစားမထိုးပါဘူး။ ရင်းမြစ်: ရေသောက်ပမာဏနဲ့ ငလျင်အတွက် US CDC/NIOSH၊ အပူရှပ်အတွက် US OSHA၊ မိုးကြိုးနဲ့ ရေကြီးအတွက် US National Weather Service၊ စပါးဂုတ်ကျိုးအတွက် IRRI/CABI၊ အာလူး၊ ကြက်သွန်ရောဂါအတွက် UC IPM နဲ့ Michigan State University ဖြစ်ပါတယ်။",
      "သီးနှံရောဂါ သတိပေးချက်က ရာသီဥတု သင့်တော်နေတယ်ဆိုတာပဲ ပြတာပါ၊ ရောဂါ ဖြစ်နေပြီလို့ မပြောပါဘူး။ ပိုးညို (brown planthopper) လို ရာသီဥတုနဲ့ ခန့်မှန်းလို့ သုတေသနတွေက မကိုက်ညီတဲ့ ပိုးမွှားကို ထည့်မထားပါဘူး။",
      "လရဲ့အဆင့်ကို ကြယ်စင်ဗေဒနည်းနဲ့ တွက်ထားလို့ မြန်မာပြက္ခဒိန်နဲ့ တစ်ရက်လောက် ကွာနိုင်ပါတယ်။"],
    lim_en:[
      "This site is not an official warning. In cyclones, floods and emergencies follow the Department of Meteorology and Hydrology (DMH) and local authorities first.",
      "Forecasts can be wrong. Accuracy falls with distance, so treat days beyond 7 as a trend only. A 100% rain chance is not a promise of rain at your spot.",
      "Climate history from 1985 is simulated data, not gauge readings, and each state or region is represented by one centre point, so it may differ from your town.",
      "The hospital list is based on the 2020 MIMU dataset. Phone numbers and locations are not individually verified, so call ahead.",
      "Farming advice is general rules of thumb. Crop, soil and chemical matter; follow the product label and check with your local agriculture office.",
      "This site was built by vibe coding (talking it through with an AI), so some of the code and text was written by AI. As a result, the Myanmar-language wording, word choice and spelling may contain mistakes or read awkwardly. If you spot one, please tell us and we will fix it.",
      "The emergency guide, drinking-water advice and crop-disease watch are general guidance and do not replace a doctor or an expert. Sources: US CDC/NIOSH (drinking water, earthquakes), US OSHA (heat stroke), US National Weather Service (lightning, floods), IRRI/CABI (rice blast), UC IPM and Michigan State University (potato and onion diseases).",
      "The crop-disease watch only says the weather suits a disease; it does not say the disease is present. Pests such as brown planthopper are left out because studies do not agree on a weather trigger.",
      "Moon phase is calculated astronomically, so it can differ from the Myanmar calendar by about a day."],
    s_how:["ကိန်းဂဏန်း ဘယ်လိုတွက်လဲ","How figures are worked out"],
    how:[
      "ENSO နှိုင်းယှဉ်ချက်: နှစ်တစ်နှစ်ချင်းကို မိုးရာသီ (ဇွန်–စက်တင်ဘာ) မှာ အများဆုံးဖြစ်တဲ့ ENSO အဆင့်နဲ့ ခွဲပါတယ်။ El Niño နှစ် ၁၀ နှစ်နဲ့ ပုံမှန်နှစ် ၁၈ နှစ်ကို permutation test (၅၀၀၀ ကြိမ်) နဲ့ နှိုင်းပြီး p<0.05 ဆိုမှ \"ထင်ရှား\" လို့ ပြပါတယ်။ p ဆိုတာ ဖြစ်ရိုးဖြစ်စဉ်အရ ဒီလောက်ကွာနိုင်ခြေပါ။",
      "အပူချိန်တက်နှုန်း: နှစ်စဉ်ပျမ်းမျှကို မျဉ်းဖြောင့်နဲ့ တွက်ပြီး ၉၅% ယုံကြည်မှုကာလကို bootstrap (၂၀၀၀ ကြိမ်) နဲ့ ထုတ်ပါတယ်။ ကာလကျဉ်းလေ ဒေတာတည်ငြိမ်လေပါ။",
      "မိုးရွာလား စစ်ခြင်း: ပထမဆုံးပြခဲ့တဲ့ ခန့်မှန်းချက်ကို သိမ်းထားပြီး နောက်တစ်ရက်မှာ ကိုယ်တိုင်ဖြေတာ (သို့) model မိုးရေမှတ်တမ်း (၀.၁ မီလီမီတာနဲ့အထက်ဆို ရွာ) နဲ့ နှိုင်းပါတယ်။ ၁၀ ရက်ကျော်ရင် Brier score ကို ပြပါတယ်၊ ၀ အကောင်းဆုံးနဲ့ ၀.၂၅ ဆို အမြဲ ၅၀% ပြတာနဲ့ တူပါတယ်။",
      "ဒီနေ့ ဘာလုပ်မလဲ: အပူ (ခံစားရတဲ့ အပူချိန် ၃၃ နဲ့ ၃၉)၊ UV၊ AQI၊ လေပြင်း (၅၀ km/h) စတာကို စည်းမျဉ်းနဲ့ စီပါတယ်။ အပူအတွက် အမေရိကန် NWS heat index စံကို ယူထားတာမို့ မြန်မာအခြေအနေနဲ့ မစစ်ရသေးပါ။",
      "ပုံမှန်အကွာအဝေး: အပူချိန်မှာ ၃၀ နှစ်ရဲ့ အလယ် ၈၀% (အနိမ့်ဆုံးနဲ့ အမြင့်ဆုံး ၁၀% ဖယ်)၊ မိုးရေမှာ သုံးပိုင်းခွဲ အလယ်ပိုင်းပါ။"],
    how_en:[
      "ENSO comparison: each year is classed by its most common ENSO phase in Jun–Sep. Ten El Niño years are compared with about 18 neutral years by a 5000-shuffle permutation test, and only p<0.05 is called significant. p is the chance of seeing a gap this large by luck.",
      "Warming trend: a straight line through yearly means, with a 95% interval from a 2000-resample bootstrap. A narrower range means steadier data.",
      "Did it rain: the first forecast shown is saved and compared next day with your answer or a model rain record (0.1 mm or more counts as rain). From 10 days the Brier score is shown: 0 is perfect and 0.25 equals always saying 50%.",
      "What to do today: heat (feels-like 33 and 39), UV, AQI and gusts (50 km/h) are ranked by rules. Heat uses the US NWS heat-index scale, not yet checked for Myanmar.",
      "Normal range: for temperature the middle 80% of 30 years (lowest and highest 10% left out); for rain the middle third."],
    s_gloss:["အဓိပ္ပာယ်ဖွင့်ဆိုချက်","Glossary"],
    s_priv:["ကိုယ်ရေးကိုယ်တာ","Privacy"],
    priv:[
      "ခန့်မှန်းချက်ပြဖို့ ရွေးထားတဲ့ နေရာရဲ့ လတ္တီကျု၊ လောင်ဂျီကျုကို ဒီ website ရဲ့ server နဲ့ Open-Meteo ကို ပို့ပါတယ်။ အကောင့်၊ စကားဝှက် မလိုပါဘူး။",
      "မိုးရွာလား မှတ်တမ်း၊ ဘာသာစကား၊ စာလုံးအရွယ်လို ရွေးချယ်မှုတွေကို ဒီစက်ရဲ့ browser ထဲမှာပဲ သိမ်းပြီး ဘယ်ကိုမှ မပို့ပါဘူး။ ဒီ version မှာ ကြော်ငြာနဲ့ အသုံးပြုမှုခြေရာခံ (analytics) script မပါပါဘူး။"],
    priv_en:[
      "The latitude and longitude of the place you pick are sent to this site's server and to Open-Meteo to fetch the forecast. No account or password is needed.",
      "Your rain log, language and text size are kept only in this device's browser and never sent anywhere. This version has no ads and no analytics scripts."],
    s_cred:["ကျေးဇူးတင်စကား၊ ဒေတာအရင်းအမြစ်များ","Credits and data sources"],
    credtxt:["ဒီ website ကို ဖြစ်လာစေတဲ့ အဖွဲ့အစည်းတွေ၊ ဒေတာပေးသူတွေကို အလေးအနက် ကျေးဇူးတင်ပါတယ်။","With sincere thanks to the organisations and data providers who made this possible."],
    credgroups:[
      ["ရာသီဥတု ခန့်မှန်းချက်နဲ့ ရာသီသမိုင်း","Forecast and climate history",[
        ["Open-Meteo","https://open-meteo.com","Weather data by Open-Meteo.com (CC BY 4.0)"],
        ["ECMWF (IFS HRES model)","https://www.ecmwf.int","forecast model"],
        ["Copernicus Climate Change Service (ERA5)","https://climate.copernicus.eu","Contains modified Copernicus Climate Change Service information"],
        ["NOAA Climate Prediction Center","https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml","ENSO status"],
        ["WMO, India Meteorological Department RCC Pune, RIMES, UK Met Office (SASCOF-34)","http://rcc.imdpune.gov.in/","2026 monsoon outlook"],
        ["World Bank Climate Knowledge Portal","https://climateknowledgeportal.worldbank.org","climate history"],
        ["Meteoblue","https://www.meteoblue.com","simulation data"]]],
      ["တရားဝင်နဲ့ ရေကြီးမှု","Official and floods",[
        ["Department of Meteorology and Hydrology, Myanmar (DMH)","https://www.moezala.gov.mm","official warnings"],
        ["RIMES","https://www.rimes.int","regional early warning"],
        ["Google Flood Hub","https://sites.research.google/floods","flood forecasts"],
        ["GloFAS, Copernicus Emergency Management Service","https://global-flood.emergency.copernicus.eu","river discharge outlook"]]],
      ["နေရာ၊ ဆေးရုံ၊ ဘေးအန္တရာယ်သမိုင်း","Places, hospitals, disaster history",[
        ["Myanmar Information Management Unit (MIMU)","https://themimu.info","place names and codes, public hospitals (with CDE-Myanmar, 2020)"],
        ["Manulife Myanmar","","partner private hospital list"],
        ["ReliefWeb, ECHO and ACAPS","https://reliefweb.int","disaster records, 2025 Sagaing earthquake"]]],
      ["စံနှုန်းများ","Standards used",[
        ["WHO / WMO UV Index","https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index","UV levels"],
        ["US EPA Air Quality Index","https://www.airnow.gov/aqi/aqi-basics/","AQI levels"],
        ["US National Weather Service heat index","https://www.weather.gov/safety/heat-index","heat levels"],
        ["India Meteorological Department","https://mausam.imd.gov.in","rainfall intensity classes"]]],
      ["ဆော့ဖ်ဝဲ","Software",[
        ["FastAPI and Python","https://fastapi.tiangolo.com","server"]]]],
    agri:["စိုက်ပျိုးရေး အချက်အလက် အရင်းအမြစ်များ","Farming sources"],
    people:["ပုဂ္ဂိုလ်တွေကို ကျေးဇူးတင်ချင်ရင် data/about_people.json မှာ အမည်တွေ ထည့်ပါ။","To thank people by name, add them to data/about_people.json."],
  };
  const t=k=>C[k][my()?0:1];
  let AGRI=null;
  let draw=null;
  function model(){
    const m=my();
    return {m,C,t,help:helpGroups("all",m),agri:AGRI&&AGRI.sources?Object.values(AGRI.sources):null,
      people:(window.MW_PEOPLE&&window.MW_PEOPLE.length)?window.MW_PEOPLE:null};
  }
  function render(){
    const b=document.getElementById("aboutBody"); if(!b) return;
    document.getElementById("aboutTitle").textContent=t("title"); document.getElementById("aboutClose").setAttribute("aria-label",t("close"));
    draw=draw||mountAboutView(); draw(model());
  }
  function open(){
    const d=document.getElementById("aboutDialog"); if(!d) return;
    render();
    if(AGRI===null){ AGRI=false; fetch("/api/agri").then(r=>r.ok?r.json():null).then(j=>{AGRI=j||false; if(d.open) render();}).catch(()=>{}); fetch("/api/about-people").then(r=>r.ok?r.json():null).then(j=>{if(Array.isArray(j)){window.MW_PEOPLE=j; if(d.open) render();}}).catch(()=>{}); }
    if(typeof d.showModal==="function") d.showModal(); else d.setAttribute("open","");
  }
  document.addEventListener("click",e=>{
    if(e.target.closest("#aboutBtn,#aboutLink")){open();return;}
    if(e.target.closest("#aboutClose")){const d=document.getElementById("aboutDialog"); d.close?d.close():d.removeAttribute("open");return;}
    const d=document.getElementById("aboutDialog"); if(d&&e.target===d) d.close&&d.close();
  });
  window.addEventListener("mw-lang",()=>{const d=document.getElementById("aboutDialog"); if(d&&d.open) render();});
}

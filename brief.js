import { L as i18n } from "./i18n.js";
import { preserveView } from "./interaction.js";
import { fmtWallDateTime } from "./core.js";
import { mountBriefView, clearSlot } from "./views.js";
/* Smart Decision Engine: Today Brief + Solar Advisor + 24h Spray Window + Hydration + SMS Copy + Checklist */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const my=()=>(window.__mwLang?window.__mwLang():"my")==="my";
  const num=(n,d=0)=>{const s=Number(n).toFixed(d);return my()?s.replace(/\d/g,x=>"၀၁၂၃၄၅၆၇၈၉"[x]):s;};
  const hh=h=>num(h,0).padStart(my()?1:2,my()?"၀":"0")+":"+(my()?"၀၀":"00");
  let LAST=null, OFF=0, STATUS="", BUSY=false;
  const V=mountBriefView();

  const T={
    head:["ဒီနေ့ လုပ်သင့်တာတွေနဲ့ အကြံပြုချက်","Today's Actionable Guidance"],
    foot:["ဒေတာအရ တွက်ချက်ထားတဲ့ လက်တွေ့အကြံပြုချက်ပါ။ တရားဝင်သတိပေးချက်တွေကို အရင်လိုက်နာပါ။","Practical guidance computed from live forecast data. Follow official warnings first."],
    off:[n=>`တရားဝင်သတိပေးချက် ${num(n)} ခု ရှိနေပါတယ်။ အရင်ဖတ်ပါ`,n=>`${num(n)} official warning(s) active. Read them first`],
    share:["Viber / Facebook မှာ မျှဝေမယ်","Share (Viber, Facebook)"],
    sms:["📱 SMS အတို ကူးမယ်","📱 Copy Short SMS"],
    copied:["ကူးပြီးပါပြီ (Paste ချနိုင်ပါပြီ)","Copied to clipboard"],
    fail:["မျှဝေလို့ မရပါ","Could not share"],
    img:["🖼️ ပုံအဖြစ် မျှဝေမယ်","🖼️ Share as image"],
    imgSaved:["ပုံကို သိမ်းပြီးပါပြီ (Viber/Facebook မှာ ပုံထည့်ပြီး မျှဝေနိုင်ပါပြီ)","Image saved - attach it in Viber or Facebook"],
    offBtn:["သတိပေး tab ကို ဖွင့်မယ်","Open Warnings"],
    lightning:[`မိုးသက်လေပြင်းနဲ့ မိုးကြိုးအန္တရာယ် ရှိနိုင်ပါတယ်။ ကွင်းပြင်၊ သစ်ပင်ကြီးအောက်နဲ့ ရေပြင်အနီး မနေပါနဲ့။ လျှပ်စစ်ပစ္စည်းတွေ ပလပ်ဖြုတ်ထားပါ။`,`Thunderstorm & lightning risk. Avoid open fields, tall trees, and water. Unplug electronics.`],
    rainHeavy:[(a,b,m)=>`${a}–${b} နာရီဝန်းကျင် မိုးကြီးနိုင်ပါတယ် (ခန့်မှန်း ${m} mm)။ ရေလျှံတတ်တဲ့ နေရာတွေနဲ့ မြစ်ချောင်းအနီး သတိထားပါ။`,(a,b,m)=>`Heavy rain likely around ${a}–${b} (~${m} mm). Take rain gear and watch for flooding.`],
    rain:[(a,b,m)=>`${a}–${b} နာရီဝန်းကျင် မိုးရွာနိုင်ပါတယ် (ခန့်မှန်း ${m} mm)။ အပြင်ထွက်ရင် ထီး/မိုးကာ ယူသွားပါ။`,(a,b,m)=>`Rain likely around ${a}–${b} (~${m} mm). Bring an umbrella.`],
    drizzle:[(a,b)=>`${a}–${b} နာရီဝန်းကျင် မိုးဖွဲလောက်ပဲ ရွာနိုင်ပါတယ် (၁ မီလီမီတာအောက်)။`,(a,b)=>`Light sprinkle possible around ${a}–${b} (under 1 mm).`],
    maybe:[`မိုးရွာနိုင်ခြေ အနည်းငယ်ရှိပေမဲ့ အများအားဖြင့် ခြောက်သွေ့နိုင်ပါတယ်။ ထီးသေးသေးလေး ယူထားရင် စိတ်ချရပါတယ်။`,`Small chance of rain, though mostly dry. A compact umbrella is enough.`],
    dry:[`ဒီနေ့ မိုးရွာဖို့ နည်းပြီး ရာသီဥတု သာယာခြောက်သွေ့ပါမယ်။`,`Rain is unlikely today; dry conditions expected.`],
    heat2:[t=>`ခံစားရတဲ့ အပူချိန် ${t}°C အထိ တက်နိုင်ပြီး အန္တရာယ်ရှိတဲ့ အပူပါ။ နေ့လယ် ၁၁–၁၅ နာရီ အပြင်အလုပ်ကို ရှောင်ပြီး ရေနဲ့ ဓာတ်ဆားရည် သောက်ပါ။`,t=>`Feels-like up to ${t}°C (dangerous heat). Avoid outdoor work 11:00–15:00 and drink water/ORS.`],
    heat1:[t=>`ခံစားရတဲ့ အပူချိန် ${t}°C အထိ ပူနွေးနိုင်ပါတယ်။ ရေမကြာခဏ သောက်ပြီး အရိပ်ထဲမှာ နားပါ။`,t=>`Feels-like up to ${t}°C. Stay hydrated and take shade breaks.`],
    uv2:[u=>`UV ညွှန်းကိန်း ${u} (အလွန်မြင့်)။ နံနက် ၁၀ နာရီကနေ ညနေ ၄ နာရီအထိ အရိပ်ရှာပြီး ဦးထုပ်၊ နေကာမျက်မှန် သုံးပါ။`,u=>`UV index ${u} (very high). Seek shade 10:00–16:00 and wear a hat and sunglasses.`],
    uv1:[u=>`UV ညွှန်းကိန်း ${u}။ နေ့လယ်ပိုင်း အပြင်ထွက်ရင် နေရောင်ကာကွယ်ပါ။`,u=>`UV index ${u}. Use sun protection around midday.`],
    aqi2:[a=>`လေထုအရည်အသွေး AQI ${a} (မကောင်း)။ ကလေး၊ သက်ကြီးရွယ်အိုနဲ့ အသက်ရှူအခံရှိသူတွေ အပြင်ထွက်ရင် Mask တပ်ပါ။`,a=>`Air quality AQI ${a} (unhealthy). Sensitive groups should wear a mask outdoors.`],
    aqi1:[a=>`လေထုအရည်အသွေး AQI ${a}။ အထိခိုက်ခံသူတွေ အပြင်လှုပ်ရှားမှု လျှော့ပါ။`,a=>`Air quality AQI ${a}. Sensitive groups should cut back on outdoor activity.`],
    wind:[g=>`လေပြင်း ${g} km/h အထိ တိုက်နိုင်ပါတယ်။ လှေ၊ ခေါင်မိုးနဲ့ လွင့်စင်လွယ်တဲ့ ပစ္စည်းတွေကို သတိထားပါ။`,g=>`Wind gusts up to ${g} km/h. Secure boats, roofs, and loose items.`],
    clear:[`ဒီနေ့ အထူးသတိထားစရာ မရှိပါဘူး။`,`Nothing unusual to watch for today.`]
  };
  const t=(k,...a)=>{const v=T[k][my()?0:1];return typeof v==="function"?v(...a):v;};

  function calcSmartMetrics(d){
    const w=(d&&d.weather)||{}, c=w.current||{}, h=w.hourly||{}, dy=w.daily||{};
    const feels=Number(dy.apparent_temperature_max?.[0] ?? c.apparent_temperature ?? c.temperature_2m ?? 30);
    const liters = feels>=40 ? 4.0 : feels>=36 ? 3.5 : feels>=32 ? 3.0 : 2.2;
    const cups = Math.round(liters * 4);
    const orsNeed = feels>=36;

    const times=h.time||[], probs=h.precipitation_probability||[], winds=h.wind_speed_10m||[];
    const goodHrs=[];
    for(let i=0;i<Math.min(24,times.length);i++){
      const hr=Number(String(times[i]).slice(11,13));
      const p=Number(probs[i]??0), ws=Number(winds[i]??0);
      if(hr>=6 && hr<=17 && p<25 && ws<18) goodHrs.push(hr);
    }
    const windowTxt = goodHrs.length>=2
      ? (my()?`${hh(goodHrs[0])} ကနေ ${hh(goodHrs[goodHrs.length-1]+1)} အတွင်း (မိုး/လေ နည်းချိန်)`:`${hh(goodHrs[0])} – ${hh(goodHrs[goodHrs.length-1]+1)} (low rain & calm wind)`)
      : (my()?"ဒီနေ့ မိုး/လေ ရှိနေလို့ ဆေးဖျန်း/နေလှမ်းဖို့ မသင့်တော်သေးပါ":"Not ideal today due to rain chance or wind");

    // Solar & Battery Charging Outlook (based on UV + Rain Chance + Storm Code)
    const uv=Number(dy.uv_index_max?.[0] ?? 5);
    const chance=Number(dy.precipitation_probability_max?.[0] ?? 0);
    const code=Number(c.weather_code);
    const storm=[95,96,99,65,82].includes(code) || chance>=75;
    let solarTitle="", solarSub="";
    if(storm){
      solarTitle = my()?"⚡ ဆိုလာအားဝင် နည်းနိုင် · ဖုန်း/Powerbank ကြိုအားသွင်းထားပါ":"⚡ Low Solar Yield · Charge Powerbanks Now";
      solarSub = my()?"မိုးတိမ်ထူပြီး မိုးသက်လေပြင်းရှိနိုင်လို့ လျှပ်စစ်မီးပြတ်တောက်မှုအတွက် ကြိုတင်ပြင်ဆင်ထားပါ":"Heavy clouds/storms likely; charge backup batteries ahead of potential outages";
    } else if(uv>=7 && chance<35){
      solarTitle = my()?"☀️ ဆိုလာအားဝင် အထူးကောင်းမွန် (၁၀:၀၀ – ၁၅:၀၀)":"☀️ Excellent Solar Charging (10:00 – 15:00)";
      solarSub = my()?"နေရောင်ခြည် အပြည့်အဝရရှိပြီး ဘက်ထရီအားသွင်းဖို့နဲ့ သီးနှံအခြောက်ခံဖို့ အကောင်းဆုံးနေ့ဖြစ်ပါတယ်":"Strong sunlight expected; ideal for solar battery charging and crop drying";
    } else {
      solarTitle = my()?"🌤️ ဆိုလာအားဝင် အသင့်အတင့် ရှိမယ်":"🌤️ Moderate Solar Charging Expected";
      solarSub = my()?"တိမ်အသင့်အတင့် ရှိနိုင်လို့ မနက်ပိုင်းကတည်းက ဆိုလာနဲ့ ဘက်ထရီတွေကို အားသွင်းထားပါ":"Partial cloud cover; start charging solar batteries early in the morning";
    }
    return {liters, cups, orsNeed, windowTxt, solarTitle, solarSub};
  }

  function lines(d){
    const w=(d&&d.weather)||{}, c=w.current||{}, h=w.hourly||{}, dy=w.daily||{}, aq=((d&&d.air_quality)||{}).current||{}, out=[];
    if(OFF>0) out.push({p:10,i:"🚨",x:t("off",OFF),btn:true});
    const code=Number(c.weather_code), dcode=Number(dy.weather_code?.[0]);
    if([95,96,99].includes(code)||[95,96,99].includes(dcode)) out.push({p:9,i:"⚡",x:t("lightning")});
    const day=(dy.time||[])[0], nowH=String(c.time||"").slice(0,13);
    let hrs=[], mmLeft=0;
    (h.time||[]).forEach((tm,i)=>{ if(day&&String(tm).slice(0,10)===day&&(!nowH||String(tm).slice(0,13)>=nowH)){ const p=Number(h.precipitation_probability?.[i]), m=Number(h.precipitation?.[i]); if(Number.isFinite(m)) mmLeft+=m; if(Number.isFinite(p)&&p>=50) hrs.push(Number(String(tm).slice(11,13))); } });
    const chance=Number(dy.precipitation_probability_max?.[0]);
    if(hrs.length){ const a=hh(Math.min(...hrs)), b=hh(Math.max(...hrs)+1), m=num(mmLeft,mmLeft<10?1:0);
      if(mmLeft>=20) out.push({p:8,i:"⛈️",x:t("rainHeavy",a,b,m)}); else if(mmLeft>=1) out.push({p:5,i:"🌧️",x:t("rain",a,b,m)}); else out.push({p:2,i:"🌦️",x:t("drizzle",a,b)}); }
    else if(Number.isFinite(chance)&&chance>=30) out.push({p:2,i:"🌂",x:t("maybe")});
    else if(Number.isFinite(chance)) out.push({p:1,i:"☀️",x:t("dry")});
    const feels=Number(dy.apparent_temperature_max?.[0] ?? c.apparent_temperature);
    if(feels>=39) out.push({p:8,i:"🥵",x:t("heat2",num(feels))}); else if(feels>=33) out.push({p:4,i:"🌡️",x:t("heat1",num(feels))});
    const uv=Number(dy.uv_index_max?.[0]);
    if(uv>=8) out.push({p:6,i:"😎",x:t("uv2",num(uv))}); else if(uv>=3) out.push({p:3,i:"🧴",x:t("uv1",num(uv))});
    const a=Number(aq.us_aqi);
    if(a>=151) out.push({p:7,i:"😷",x:t("aqi2",num(a))}); else if(a>=101) out.push({p:4,i:"🌫️",x:t("aqi1",num(a))});
    const g=Number(dy.wind_gusts_10m_max?.[0] ?? c.wind_speed_10m);
    if(g>=45) out.push({p:6,i:"💨",x:t("wind",num(g))});
    out.sort((x,y)=>y.p-x.p);
    const top=out.filter(x=>x.p>=2).slice(0,5);
    return top.length?top:out.filter(x=>x.p>=1).slice(0,2).concat(out.some(x=>x.p>=1)?[]:[{p:0,i:"✅",x:t("clear")}]);
  }

  function renderCropMatrix(){ if(document.getElementById("agriCropMatrix")) V.crops({my:my()}); }

  function renderChecklist(){
    if(!document.getElementById("prepChecklistCard")) return;
    const KEY="mw_prep_checks_v1";
    let saved={}; try{saved=JSON.parse(localStorage.getItem(KEY)||"{}");}catch{}
    const items=[
      ["water","💧 သောက်ရေသန့် နဲ့ ဓာတ်ဆားထုပ်များ (အနည်းဆုံး ၃ ရက်စာ)","Clean drinking water & ORS packets (3-day supply)"],
      ["meds","💊 အရေးပေါ်ဆေးဝါး၊ ပတ်တီး နဲ့ အနာကျက်ဆေး","Essential medicines & first-aid kit"],
      ["light","🔦 ဓာတ်မီး၊ ဖယောင်းတိုင် နဲ့ အားသွင်းထားတဲ့ Powerbank","Flashlight, candles & fully charged powerbank"],
      ["docs","🗂️ မှတ်ပုံတင်၊ အိမ်ထောင်စုစာရင်းနဲ့ အရေးကြီးစာရွက်စာတမ်း (ရေလုံအိတ်နဲ့)","IDs, household documents & cash in a waterproof bag"],
      ["food","🥫 တာရှည်ခံ အစားအစာ (ဘီစကစ်၊ စည်သွပ်ဘူး၊ ရိက္ခာခြောက်)","Non-perishable dry food rations"],
      ["contact","📞 မိသားစု အရေးပေါ် ဆက်သွယ်ရန် ဖုန်းနံပါတ်စာရင်းနဲ့ စုရပ်","Written emergency phone numbers & family meeting point"]
    ];
    const doneCount=items.filter(([k])=>saved[k]).length;
    const pct=Math.round((doneCount/items.length)*100);
    V.checklist({head:my()?"သဘာဝဘေးအန္တရာယ် ကြိုတင်ပြင်ဆင်ရေး စစ်ဆေးရန်စာရင်း":"Emergency Go-Bag & Preparedness Checklist",
      sub:my()?`အသင့်ပြင်ဆင်ပြီး (${num(doneCount)} / ${num(items.length)} ·${num(pct)}%) — ပြီးတဲ့အချက်တွေကို အမှန်ခြစ်မှတ်ထားနိုင်ပါတယ်`:`Prepared (${doneCount} / ${items.length} ·${pct}%) — tap items to save your readiness`,
      pct,items:items.map(([k,m,e])=>({k,on:!!saved[k],text:my()?m:e})),
      on:{toggle:(k,v)=>{saved[k]=v;try{localStorage.setItem(KEY,JSON.stringify(saved));}catch{}preserveView(renderChecklist);}}});
  }


  // ---- Share as an image (1080x1350 PNG): today's key lines on a card people can post in Viber / Facebook ----
  const FONT='"Noto Sans Myanmar Local","Noto Sans Myanmar",Inter,system-ui,sans-serif';
  function wrapText(g,text,maxW){
    const parts=(typeof Intl!=="undefined"&&Intl.Segmenter)?[...new Intl.Segmenter(my()?"my":"en",{granularity:"word"}).segment(text)].map(x=>x.segment):(text.match(/\S+\s*|\s+/g)||[text]);
    const out=[];let cur="";
    for(const w of parts){const t=cur+w; if(!cur||g.measureText(t).width<=maxW){cur=t;}else{out.push(cur.trimEnd());cur=w.trimStart();}}
    if(cur)out.push(cur.trimEnd());
    return out.flatMap(l=>{ // a single unbroken run wider than the card: cut it at character-cluster edges
      if(g.measureText(l).width<=maxW)return [l];
      const res=[];let c2="";for(const ch of (l.match(/\P{M}\p{M}*/gu)||[l])){if(c2&&g.measureText(c2+ch).width>maxW){res.push(c2);c2="";}c2+=ch;} if(c2)res.push(c2); return res;});
  }
  const roundRect=(g,x,y,w,h,r)=>{g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();};
  async function makeShareImage(lines,place,when,tempText,rainText,col){
    const W=1080,H=1350,c=document.createElement("canvas");c.width=W;c.height=H;const g=c.getContext("2d");
    try{await Promise.all([document.fonts.load(`400 32px ${FONT}`),document.fonts.load(`700 32px ${FONT}`)]);}catch{}
    g.fillStyle="#eef5f0";g.fillRect(0,0,W,H);
    const hg=g.createLinearGradient(0,0,W,260);hg.addColorStop(0,"#0b4f2a");hg.addColorStop(1,"#1a8a42");g.fillStyle=hg;g.fillRect(0,0,W,260);
    try{const img=new Image();img.src="logo.png";await img.decode();g.save();roundRect(g,56,60,140,140,28);g.clip();g.drawImage(img,56,60,140,140);g.restore();}catch{}
    g.textBaseline="alphabetic";g.fillStyle="#fff";g.font=`700 68px ${FONT}`;g.fillText("မှီခိုရာ",224,128);
    g.fillStyle="#f6c453";g.font=`700 38px ${FONT}`;g.fillText("SafeGuard Myanmar",224,184);
    g.fillStyle="#fff";roundRect(g,40,220,W-80,340,32);g.fill();
    g.fillStyle="#0f2b1d";g.font=`700 54px ${FONT}`;const pl=wrapText(g,place,W-160).slice(0,2);pl.forEach((l,i)=>g.fillText(l,80,296+i*66));
    g.fillStyle="#48605f";g.font=`400 32px ${FONT}`;g.fillText(when,80,296+pl.length*66);
    g.fillStyle="#0b4f2a";g.font=`700 112px ${FONT}`;g.fillText(tempText,80,530);
    g.fillStyle="#137a36";g.font=`700 40px ${FONT}`;const rw=g.measureText(rainText).width;g.fillText(rainText,Math.max(540,W-80-rw),505);
    let y=596;
    for(const x of lines){
      g.font=`400 38px ${FONT}`;const tl=wrapText(g,x.x,W-240).slice(0,4),h=tl.length*54+44;
      if(y+h>H-190)break;
      g.fillStyle="#fff";roundRect(g,40,y,W-80,h,24);g.fill();g.fillStyle=col(x.p);g.fillRect(40,y+14,10,h-28);
      g.font=`400 44px ${FONT}`;g.fillStyle="#0f2b1d";g.fillText(x.i,72,y+62);
      g.font=`400 38px ${FONT}`;tl.forEach((l,i)=>g.fillText(l,140,y+58+i*54));
      y+=h+18;
    }
    g.fillStyle="#48605f";g.font=`400 26px ${FONT}`;wrapText(g,T.foot[my()?0:1],W-80).slice(0,2).forEach((l,i)=>g.fillText(l,40,H-120+i*38));
    g.fillStyle="#0b4f2a";g.font=`700 32px ${FONT}`;const site=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)?"":location.host;if(site)g.fillText(site,40,H-30);
    return await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error("toBlob")),"image/png"));
  }

  function render(){
    STATUS="";BUSY=false;
    renderChecklist();
    renderCropMatrix();
    if(!document.getElementById("todayBrief")||!LAST) return;
    paint();
  }
  function paint(){
    const L=lines(LAST.d), col=p=>p>=7?"#dc2626":p>=4?"#d97706":"#137a36";
    const win=calcSmartMetrics(LAST.d);
    const widgets=[
      {ico:"💧",label:my()?"ဒီနေ့ သောက်သင့်တဲ့ ရေပမာဏ":"Recommended Daily Water Intake",title:`${num(win.liters,1)} L (${my()?`ဖန်ခွက် ~${num(win.cups)} ခွက်`:`~${win.cups} cups`})`,
        sub:win.orsNeed?(my()?"အပူချိန်မြင့်လို့ ဓာတ်ဆားရည် (ORS) ပါ သောက်ပေးပါ":"High heat: include oral rehydration salts (ORS)"):(my()?"တစ်နေ့တာလုံး ရေကို မကြာခဏ သောက်ပေးပါ":"Sip water steadily throughout the day")},
      {ico:"🚜",label:my()?"ဆေးဖျန်းရန် / နေလှမ်းရန် အကောင်းဆုံးအချိန်":"Best Spraying & Drying Window",title:win.windowTxt,sub:my()?"နောက် ၂၄ နာရီ မိုးနဲ့ လေတိုက်နှုန်းအပေါ် တွက်ချက်ထားတယ်":"Computed from next 24h rain probability & wind speed"},
      {ico:"🔋",label:my()?"ဆိုလာနဲ့ လျှပ်စစ်အားသွင်းမှု အကြံပြုချက်":"Solar & Battery Charging Outlook",title:win.solarTitle,sub:win.solarSub}];
    const place=()=>{const loc=LAST.loc||{};return my()?loc.name:(loc.name_en||loc.name||"");};
    const time=()=>((LAST.d.weather||{}).current||{}).time||"";
    const local=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const feedback=text=>{STATUS=text;BUSY=false;paint();};
    const shareText=()=>`🛡️ SafeGuard Myanmar\n📍 ${place()} · ${time()}\n`+L.filter(x=>!x.btn).map(x=>`${x.i} ${x.x}`).join("\n")+`\n\n${T.foot[my()?0:1]}\n`+(local?i18n("ux_local_share"):location.href);
    const on={
      go:e=>{const tab=document.querySelector(`.tab[data-tab="${e.currentTarget.dataset.briefGo}"]`); if(tab) tab.click();},
      share:async()=>{try{if(navigator.share){await navigator.share({text:shareText()});return;}await navigator.clipboard.writeText(shareText());feedback(T.copied[my()?0:1]);}catch(e){if(e?.name!=="AbortError")feedback(T.fail[my()?0:1]);}},
      image:async()=>{
        BUSY=true;paint();
        try{
          const c=LAST.d?.weather?.current||{},dy=LAST.d?.weather?.daily||{},unit=window.MWR_STATE?.unit||"C",raw=Number(c.temperature_2m);
          const tempText=Number.isFinite(raw)?num(Math.round(unit==="F"?raw*9/5+32:raw))+"°"+unit:"—", chance=dy.precipitation_probability_max?.[0];
          const rainText=chance==null?"":(my()?"မိုးရွာနိုင်ခြေ ":"Rain chance ")+num(Math.round(chance))+"%";
          const blob=await makeShareImage(L.filter(x=>!x.btn),place(),fmtWallDateTime(c.time),tempText,rainText,col);
          const file=new File([blob],"safeguard-weather.png",{type:"image/png"});
          if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file]});}
          else{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="safeguard-weather.png";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);feedback(T.imgSaved[my()?0:1]);}
        }catch(e){if(e?.name!=="AbortError")feedback(T.fail[my()?0:1]);}
        finally{BUSY=false;paint();}
      },
      sms:async()=>{
        const c=LAST.d?.weather?.current||{},dy=LAST.d?.weather?.daily||{},unit=window.MWR_STATE?.unit||"C";
        const raw=Number(c.temperature_2m),temperature=Number.isFinite(raw)?`${Math.round(unit==="F"?raw*9/5+32:raw)}°${unit}`:"—";
        const chance=dy.precipitation_probability_max?.[0];
        const rain=chance==null?"—":`${Math.round(chance)}%`;
        const text=`[SafeGuard] ${place()} · ${time()}: ${temperature}, ${my()?"မိုးရွာနိုင်ခြေ":"Rain chance"} ${rain}. ${(L[0]?.x||"").slice(0,95)}`;
        try{await navigator.clipboard.writeText(text);feedback(T.copied[my()?0:1]);}catch{feedback(T.fail[my()?0:1]);}
      },
    };
    V.brief({head:T.head[my()?0:1],offBtn:T.offBtn[my()?0:1],share:T.share[my()?0:1],img:T.img[my()?0:1],sms:T.sms[my()?0:1],
      rows:(L.length?L:[{p:0,i:"✅",x:t("clear")}]).map(x=>({i:x.i,x:x.x,btn:!!x.btn,c:col(x.p)})),widgets,status:STATUS,imgBusy:BUSY,on});
  }
  window.renderTodayBrief=function(d,loc){LAST=d?{d,loc}:null;if(!d){clearSlot("todayBrief");return;}render();};
  window.setBriefOfficial=function(n){ n=Number(n)||0; if(n!==OFF){OFF=n;render();} };
  window.addEventListener("mw-lang",render);
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",()=>{renderChecklist();renderCropMatrix();});
  else {renderChecklist();renderCropMatrix();}
})();

/* "Did it rain?" check: the app saves the first forecast it showed for each day and place, you answer later, and the
   card counts how often high-chance days really got rain at YOUR place. Stored only in this browser (localStorage). */
import { clearSlot } from "./views.js";
import { mountRainLogView } from "./lazy_views.js";
{
  const KEY="mw_rain_log_v1";
  const my=()=>(window.__mwLang?window.__mwLang():"my")==="my";
  const num=(n,d=0)=>{const s=Number(n).toFixed(d);return my()?s.replace(/\d/g,x=>"၀၁၂၃၄၅၆၇၈၉"[x]):s;};
  const S={
    head:["မိုးရွာလား၊ မရွာဘူးလား","Did it rain?"],
    sub:["မနေ့က ခန့်မှန်းချက်က မှန်လား ဖြေပေးပါ၊ ကိုယ့်နေရာအတွက် ဘယ်လောက်အားကိုးရလဲ ဒီမှာ တွက်ပြပါမယ်။","Tell me if the forecast was right and this card works out how far to trust it for your own spot."],
    ask:["ဒီနေ့ ကိုယ့်နေရာမှာ မိုးရွာလား?","Did it rain at your place?"],
    fc:(c,m)=>my()?`ခန့်မှန်းချက်: ${num(c)}% · ${num(m,1)} မီလီမီတာ`:`Forecast: ${num(c)}% · ${num(m,1)} mm`,
    rain:["ရွာတယ်","Rained"],drizzle:["မိုးဖွဲလောက်","A sprinkle"],dry:["မရွာဘူး","Dry"],
    none:["ဖြေစရာ ရက် မရှိသေးပါ။ မနက်ဖြန် ပြန်ဖွင့်ကြည့်ပါ။","Nothing to answer yet. Open the app again tomorrow."],
    stats:["ခန့်မှန်းရာခိုင်နှုန်းအလိုက် တကယ်ရွာတဲ့ ရက်","Days it really rained, by forecast chance"],
    b:[["၃၀% အောက်","Under 30%"],["၃၀–၆၉%","30–69%"],["၇၀% နဲ့အထက်","70% and above"]],
    days:(k,n,dr)=>my()?`${num(n)} ရက်ထဲက ${num(k)} ရက် ရွာ${dr?` (မိုးဖွဲ ${num(dr)} ရက်ပါ)`:""}`:`${num(k)} of ${num(n)} days${dr?` (${num(dr)} only a sprinkle)`:""}`,
    few:n=>my()?`ဒေတာ မလုံလောက်သေး (${num(n)}/၃ ရက်)`:`Not enough yet (${num(n)}/3 days)`,
    note:["ရွာတယ်ဆိုတာ မိုးဖွဲအပါအဝင်ပါ (ခန့်မှန်းချက်က ၀.၁ မီလီမီတာကို တိုင်းလို့)။ ၇၀% မှာ ၁၀ ရက်ထဲ ၇ ရက်လောက် ရွာရင် ပုံမှန်ပါ။ ခန့်မှန်းချက်ကတော့ အဲဒီနေ့ ပထမဆုံး ဖွင့်ကြည့်ချိန်ကပါ။ ဒေတာက ဒီစက်ထဲမှာပဲ သိမ်းထားပြီး ဘယ်ကိုမှ မပို့ပါဘူး။","Rained includes a sprinkle (the forecast counts 0.1 mm). Around 7 of 10 days at 70% is normal. The forecast used is the first one shown that day. Data stays on this device and is never sent anywhere."],
    auto:mm=>my()?`မော်ဒယ်ရဲ့ မှတ်တမ်းအရ ${num(mm,1)} မီလီမီတာ ရွာခဲ့`:`Model record: ${num(mm,1)} mm fell`,
    src:(a,u)=>my()?`စုစုပေါင်း ${num(a+u)} ရက် (စက်ကစစ် ${num(a)}၊ ကိုယ်တိုင်ဖြေ ${num(u)})`:`${num(a+u)} days in total (${num(a)} auto-checked, ${num(u)} answered by you)`,
    bs:(b,s)=>my()?`Brier score ${num(b,2)} (၀ အကောင်းဆုံး၊ ၀.၂၅ ဆို အမြဲ ၅၀% ပြတာနဲ့ တူ)။ ကိုယ့်နေရာ ပျမ်းမျှကို ခန့်မှန်းတာထက် ${s==null?"နှိုင်းမရ":(s>0?`${num(s*100)}% ပိုကောင်း`:`${num(Math.abs(s)*100)}% ပိုဆိုး`)}။`:`Brier score ${num(b,2)} (0 is perfect, 0.25 equals always saying 50%). Versus guessing your local average: ${s==null?"not comparable":(s>0?`${num(s*100)}% better`:`${num(Math.abs(s)*100)}% worse`)}.`,
    bsfew:["Brier score တွက်ဖို့ အနည်းဆုံး ၁၀ ရက် လိုပါတယ်။","Brier score needs at least 10 days."],
    acchead:["ခန့်မှန်းချက် တိကျမှု","Forecast accuracy"],
    accfew:["တိကျမှုရာခိုင်နှုန်းတွက်ဖို့ အနည်းဆုံး ၁၀ ရက်စာ ရလဒ်လိုပါတယ်။ နေ့စဉ်ခန့်မှန်းချက်နဲ့ တကယ့်မိုးအခြေအနေကို မှတ်တမ်းတင်ပေးပါ။","At least 10 completed days are needed to estimate accuracy. Keep logging forecasts and actual rain."],
    acc:(p,n)=>my()?`တိကျမှု ${num(p)}% · ${num(n)} ရက်ကို စစ်ထားပါတယ်`:`${num(p)}% accurate · checked ${num(n)} days`,
    accnote:["မိုးရွာနိုင်ခြေ ၅၀% နဲ့အထက်ကို ‘ရွာမယ်’၊ ၅၀% အောက်ကို ‘မရွာဘူး’ လို့ ယူပြီး တကယ့်ရလဒ်နဲ့ ဘယ်လောက် ကိုက်လဲ တွက်ထားတာပါ။ ဒီစက်ထဲမှာ မှတ်တမ်းရှိတဲ့ ရက်တွေအတွက်ပဲ ဖြစ်ပြီး မော်ဒယ်တစ်ခုလုံးရဲ့ တိကျမှုကို အာမမခံပါဘူး။","Classification accuracy: forecasts ≥50% count as ‘rain’, below 50% as ‘dry’. This only reflects days logged on this device and does not guarantee overall model accuracy."],
    autonote:["စက်ကစစ်တာက အပြင်ဘက် မော်ဒယ်ရဲ့ မိုးရေချိန်မှတ်တမ်း (၀.၁ မီလီမီတာနဲ့အထက်ကို ရွာတယ်လို့ သတ်မှတ်) ဖြစ်ပြီး မိုးတိုင်းတာကိရိယာ မဟုတ်လို့ ကိုယ်တိုင်ဖြေတာ ပိုအကောင်းဆုံးပါ။","Auto-checks use an outside model's rain record (0.1 mm or more counts as rain), not a gauge, so your own answer is best."],
    clear:["မှတ်တမ်းဖျက်မယ်","Clear my log"],
  };
  const tx=k=>S[k][my()?0:1];
  let draw=null, CUR=null, TODAY="", UNDO=null,SAVE_FAILED=false,EDITOPEN=false;
  const load=()=>{try{const j=JSON.parse(localStorage.getItem(KEY)||"null");return j&&j.v===1?j:{v:1,s:{}};}catch{return {v:1,s:{}};}};
  const save=j=>{try{localStorage.setItem(KEY,JSON.stringify(j));SAVE_FAILED=false;return true;}catch{SAVE_FAILED=true;return false;}};
  const preserve=fn=>window.MWUX?window.MWUX.preserveView(fn):fn();
  const pk=loc=>`${Number(loc.lat).toFixed(2)},${Number(loc.lon).toFixed(2)}`;
  function render(){
    const el=document.getElementById("rainLogCard"); if(!el||!CUR) return;
    const j=load(), pl=pk(CUR), mine=Object.values(j.s).filter(x=>x.k===pl&&!x.archived);
    const open=mine.filter(x=>!x.ans).sort((a,b)=>a.date<b.date?1:-1).slice(0,3);
    const MM=["ဇန်နဝါရီ","ဖေဖော်ဝါရီ","မတ်","ဧပြီ","မေ","ဇွန်","ဇူလိုင်","ဩဂုတ်","စက်တင်ဘာ","အောက်တိုဘာ","နိုဝင်ဘာ","ဒီဇင်ဘာ"];
    const dn=d=>{const [y,m,dd]=d.split("-").map(Number); const rel=d===TODAY?(my()?"ယနေ့ · ":"Today · "):(TODAY&&new Date(TODAY+"T12:00:00")-new Date(d+"T12:00:00")===864e5?(my()?"မနေ့က · ":"Yesterday · "):"");
      return rel+(my()?`${num(dd)} ${MM[m-1]}`:new Date(y,m-1,dd).toLocaleDateString("en",{month:"short",day:"numeric"}));};
    const btnsFor=(x,pressed)=>["rain","drizzle","dry"].map(a=>({a,id:x.k+"|"+x.date,label:tx(a),on:pressed?x.ans===a:undefined}));
    const answered=mine.filter(x=>x.ans).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,7);
    const out=x=>x.ans?(x.ans!=="dry"?1:0):(x.auto!=null?(x.auto>=0.1?1:0):null);
    const done=mine.filter(x=>out(x)!==null);
    const rows=[[0,29],[30,69],[70,100]].map(([lo,hi],i)=>{const g=done.filter(x=>x.chance>=lo&&x.chance<=hi), k=g.filter(x=>out(x)===1).length, dr=g.filter(x=>x.ans==="drizzle").length;
      return {label:S.b[i][my()?0:1],text:g.length>=3?S.days(k,g.length,dr):S.few(g.length),w:g.length>=3?Math.max(2,k/g.length*100).toFixed(0):null};});
    let brier={strong:false,text:tx("bsfew")}, acc=null;
    if(done.length>=10){
      const os=done.map(out), bs=done.reduce((a,x,i)=>a+Math.pow(x.chance/100-os[i],2),0)/done.length, base=os.reduce((a,b)=>a+b,0)/os.length, ref=base*(1-base);
      brier={strong:true,text:S.bs(bs,ref>0?1-bs/ref:null)};
      const hits=done.filter(x=>((x.chance>=50)?1:0)===out(x)).length, pct=Math.round(hits/done.length*100);
      acc={text:S.acc(pct,done.length),pct,note:tx("accnote")};
    }
    const na=done.filter(x=>!x.ans).length;
    const on={
      answer:(key,a)=>{const jj=load(), e=jj.s[key]; EDITOPEN=true;if(e){UNDO={[key]:{...e}};e.ans=a;save(jj);}preserve(render);el.querySelector("[data-rl-undo]")?.focus({preventScroll:true});},
      clear:()=>{EDITOPEN=false;const jj=load();UNDO={};Object.entries(jj.s).forEach(([key,x])=>{if(x.k===pl&&!x.archived){UNDO[key]={...x};x.archived=true;}});save(jj);preserve(render);},
      undo:()=>{EDITOPEN=false;const jj=load();Object.assign(jj.s,UNDO);save(jj);UNDO=null;preserve(render);},
      restore:()=>{EDITOPEN=false;const jj=load();Object.values(jj.s).forEach(x=>{if(x.k===pl)x.archived=false;});save(jj);preserve(render);},
    };
    draw=draw||mountRainLogView();
    draw({editOpen:EDITOPEN,head:tx("head"),none:tx("none"),editLabel:my()?"အဖြေကို ပြင်ရန်":"Edit recent answers",moreLabel:my()?"စာရင်းနဲ့ တိကျမှု (အသေးစိတ်)":"Totals and accuracy",statsHead:tx("stats"),accHead:tx("acchead"),accFew:tx("accfew"),
      open:open.map(x=>({id:x.k+"|"+x.date,day:dn(x.date),fc:S.fc(x.chance,x.mm),auto:x.auto!=null?S.auto(x.auto):"",btns:btnsFor(x,false)})),
      answered:answered.map(x=>({id:x.k+"|"+x.date,day:dn(x.date),btns:btnsFor(x,true)})),
      rows,acc,brier,src:S.src(na,done.length-na),canArchive:done.length>0,archiveLabel:my()?"ဤနေရာ၏ မှတ်တမ်းကို သိမ်းပိတ်ရန်":"Archive this place’s log",
      failed:SAVE_FAILED?(my()?"သိမ်းမရပါ။ မှတ်တမ်းဟောင်းကို မဖျက်ထားပါ။":"Could not save. Your previous records were retained."):"",
      undo:UNDO?(my()?"ပြန်ယူရန်":"Undo"):"",
      restore:Object.values(j.s).some(x=>x.k===pl&&x.archived)?(my()?"သိမ်းပိတ်ထားသော မှတ်တမ်းကို ပြန်ဖွင့်ရန်":"Restore archived log for this place"):"",on});
  }
  const ASKED=new Set();
  function autoCheck(){
    if(!CUR||!TODAY) return; const pl=pk(CUR);
    const j=load(), need=Object.values(j.s).filter(x=>x.k===pl&&!x.ans&&x.auto==null&&x.date<TODAY);
    if(!need.length||ASKED.has(pl+TODAY)) return; ASKED.add(pl+TODAY);
    fetch(`/api/recent-rain?lat=${encodeURIComponent(CUR.lat)}&lon=${encodeURIComponent(CUR.lon)}`).then(r=>r.ok?r.json():null).then(res=>{
      if(!res||!res.days) return; const jj=load(); let ch=false;
      Object.values(jj.s).forEach(x=>{ if(x.k===pl&&!x.ans&&x.auto==null&&res.days[x.date]!=null){x.auto=Number(res.days[x.date]);ch=true;} });
      if(ch){save(jj);render();}
    }).catch(()=>{});
  }
  window.rainLogSnapshot=function(d,loc){
    try{
      const dy=(((d||{}).weather||{}).daily)||{}, date=(dy.time||[])[0], chance=Number(dy.precipitation_probability_max?.[0]), mm=Number(dy.precipitation_sum?.[0]);
      CUR=loc; TODAY=date||TODAY; if(!loc||!date||!Number.isFinite(chance)){render();return;}
      const j=load(), id=pk(loc)+"|"+date;
      if(!j.s[id]){ j.s[id]={k:pk(loc),date,chance:Math.round(chance),mm:Number.isFinite(mm)?mm:0,ans:null}; save(j); }
    }catch{}
    render(); autoCheck();
  };
  window.addEventListener("mw-place",()=>{CUR=null;TODAY="";clearSlot("rainLogCard");});
  window.addEventListener("mw-lang",render);
}

// Today brief, preparedness checklist and crop matrix in React. Weather rules, storage and sharing stay in brief.js, which passes models.
import { put } from "./slots.js";

const CROPS = [
["မိုးစပါး (Monsoon Rice)","ဇွန် – ဇူလိုင်","အောက်တိုဘာ – ဒီဇင်ဘာ","24°C – 32°C","ရေသွင်း/ရေထုတ် မှန်ကန်ဖို့နဲ့ ရိတ်သိမ်းချိန် အချိန်အခါမဟုတ် မိုးသတိထားပါ"],
      ["နွေစပါး (Summer Rice)","ဇန်နဝါရီ – ဖေဖော်ဝါရီ","ဧပြီ – မေ","26°C – 36°C","သွင်းရေ လုံလောက်ဖို့နဲ့ ပန်းပွင့်ချိန် အပူချိန်လွန်ကဲမှု သတိထားပါ"],
      ["မြေပဲ (Groundnut)","မေ – ဇွန် / အောက်တိုဘာ","စက်တင်ဘာ / ဖေဖော်ဝါရီ","25°C – 33°C","သဲနုန်းမြေမှာ ဖြစ်ထွန်းပြီး ရေဝပ်တာ လုံးဝမခံနိုင်ပါ"],
      ["နှမ်း (Sesame)","မေ – ဇွန် / စက်တင်ဘာ","ဩဂုတ် / ဒီဇင်ဘာ","27°C – 38°C","မိုးခေါင်ဒဏ်ခံနိုင်ပေမဲ့ အပင်ပေါက်ချိန်နဲ့ သီးပွင့်ချိန် မိုးကြီးရင် ပျက်စီးလွယ်တယ်"],
      ["မတ်ပဲ နဲ့ ပဲတီစိမ်း (Pulses)","အောက်တိုဘာ – နိုဝင်ဘာ","ဇန်နဝါရီ – မတ်","20°C – 32°C","စပါးအပြီး လက်ကျန်မြေအစိုဓာတ်နဲ့ စိုက်ပျိုးနိုင်ပြီး နှင်းခါးရိုက်တာ သတိထားပါ"],
      ["ပဲစဉ်းငုံ (Pigeon Pea)","မေ – ဇွန်","ဒီဇင်ဘာ – ဖေဖော်ဝါရီ","22°C – 35°C","အမြစ်နက်လို့ မိုးနည်းဒေသနဲ့ သင့်တော်ပြီး သီးနှံရောနှော စိုက်ပျိုးနိုင်တယ်"],
      ["အစေ့ထုတ်ပြောင်း (Maize)","မေ – ဇွန် / အောက်တိုဘာ","စက်တင်ဘာ / ဖေဖော်ဝါရီ","21°C – 32°C","အစေ့တည်ချိန် ရေမပြတ်ဖို့နဲ့ ငမြှောင်တောင်ပိုး သတိထားပါ"],
      ["ကြက်သွန်နီ နဲ့ အာလူး","အောက်တိုဘာ – ဒီဇင်ဘာ","ဖေဖော်ဝါရီ – ဧပြီ","15°C – 28°C","စိုထိုင်းဆများရင် မှိုရောဂါ ကျလွယ်လို့ ရေနုတ်မြောင်း ကောင်းရမယ်"]
];

export function mountBriefView() {
  return {
    brief: s => put("todayBrief", s ? <Brief s={s} /> : null),
    checklist: s => put("prepChecklistCard", <Checklist s={s} />),
    crops: s => put("agriCropMatrix", <Crops my={s.my} />),
  };
}

function Brief({ s }) {
  return (
    <>
      <div className="section-heading"><div><h3>📋 {s.head}</h3></div><span className="source-tag">SafeGuard Smart Guide</span></div>
      {s.rows.map((x, i) => (
        <div className="brief-row" key={i} data-bc={x.c} style={{ borderLeftColor: x.c }}><span aria-hidden="true" className="brief-ico">{x.i}</span>
          <div><strong>{x.x}</strong>{x.btn ? <div><button type="button" className="ghost-btn" data-brief-go="hazards" onClick={s.on.go}>{s.offBtn}</button></div> : null}</div></div>
      ))}
      <div className="smart-widgets-grid">
        {s.widgets.map((w, i) => <div className="smart-widget" key={i}><span>{w.ico}</span><div><small>{w.label}</small><strong>{w.title}</strong><small className="muted">{w.sub}</small></div></div>)}
      </div>
      <div className="brief-actions">
        <button type="button" className="ghost-btn" data-brief-share="1" onClick={s.on.share}>📤 {s.share}</button>
        <button type="button" className="ghost-btn" data-brief-image="1" disabled={s.imgBusy} onClick={s.on.image}>{s.img}</button>
        <button type="button" className="ghost-btn" data-brief-sms="1" onClick={s.on.sms}>{s.sms}</button>
      </div>
      {s.status ? <p className="tiny brief-copy-status" role="status">{s.status}</p> : null}
    </>
  );
}

function Checklist({ s }) {
  return (
    <>
      <div className="section-heading"><div><h3>🎒 {s.head}</h3><p className="muted">{s.sub}</p></div><span className="source-tag">SafeGuard Ready</span></div>
      <div className="wbar"><i data-w={s.pct} style={{ width: s.pct + "%" }}></i></div>
      <div className="prep-grid">
        {s.items.map(x => (
          <label className={"prep-item " + (x.on ? "checked" : "")} key={x.k}><input type="checkbox" data-prep={x.k} checked={x.on} onChange={e => s.on.toggle(x.k, e.target.checked)} /><span>{x.text}</span></label>
        ))}
      </div>
    </>
  );
}

function Crops({ my }) {
  const m = (a, b) => (my ? a : b);
  return (
    <>
      <div className="section-heading"><div><h3>📊 {m("မြန်မာ့အဓိက သီးနှံ (၈) မျိုးရဲ့ ရာသီဥတုနဲ့ စိုက်ပျိုးရေး လမ်းညွှန်ဇယား", "Myanmar Key Crops Climate & Management Matrix")}</h3><p className="muted">{m("သီးနှံအလိုက် စိုက်ချိန်၊ ရိတ်ချိန်၊ အပူချိန်နဲ့ အဓိက သတိထားရမယ့် အချက်များ", "Sowing/harvest windows, optimal temperature range, and key weather sensitivities")}</p></div><span className="source-tag">Agronomy Reference</span></div>
      <div className="cmp-scroll" tabIndex="0" role="region" aria-label="Table"><table className="cmp-table"><thead><tr><th>{m("သီးနှံအမည်", "Crop")}</th><th>{m("စိုက်ချိန်", "Sowing")}</th><th>{m("ရိတ်ချိန်", "Harvest")}</th><th>{m("အပူချိန်", "Temp")}</th><th>{m("အဓိက သတိထားရန်", "Key Advisory")}</th></tr></thead><tbody>
        {CROPS.map((r, i) => <tr key={i}><th scope="row">{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>)}
      </tbody></table></div>
    </>
  );
}

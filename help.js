import { L } from "./i18n.js";
/* Plain-language glossary cards at the bottom of the Today, 7-day and Compare tabs: what each figure means and how far to trust it. */
const TOPICS={"today": ["temp", "feels", "humid", "uv", "aqi", "wind"], "forecast": ["chance", "amount", "area", "far", "icon"], "compare": ["era5", "band", "anom", "trend", "enso", "water", "soil", "notofficial"]};
const GROUP={today:["ယနေ့","Today"],forecast:["၇ ရက်","7 days"],compare:["နှိုင်းယှဉ်ချက်","Compare"]};
/** Glossary groups for the About dialog: [{head, items:[{t, b}]}]. */
export const helpGroups=(which,my)=>(which==="all"?Object.keys(TOPICS):[which]).map(k=>({head:GROUP[k][my?0:1],items:(TOPICS[k]||[]).map(id=>({t:L("help_"+id+"_t"),b:L("help_"+id+"_b")}))}));

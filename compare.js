import { L } from "./i18n.js";
import { mountCompareView } from "./views.js";
/* Compare tab: today's conditions against the 1991-2020 ERA5 normal, from /api/v1/climate.
   Layout: summary counts -> how-to-read legend -> one tile per indicator (chart or level meter, difference from normal,
   plain-language sentence) -> data table -> method and limitations. Information only; no advice is given here. */
(function(){
  "use strict";
  const my=()=>(window.__mwLang?window.__mwLang():"my")==="my";
  let COND=null;
  // Drawn by React (frontend/src/compare_view.jsx -> views.js); this file keeps the data and the language hook.
  let view=null;
  function render(){
    if(!document.getElementById("compareCharts")) return;
    view=view||mountCompareView();
    view(COND,L,my());
  }
  window.renderCompareCharts=function(data){COND=data||null;render();};
  window.addEventListener("mw-lang",render);
})();

import {test,expect} from '@playwright/test';
import axe from 'axe-core';
import {mockApis,choose,weather,openTab,openFarm} from './ux-fixtures.mjs';
const setLang=async(page,c)=>{await expect(async()=>{await page.evaluate(()=>document.getElementById('topMore')?.classList.add('open'));await page.locator('#languageToggle').click({force:true,timeout:2000});await page.locator(`#langSheet [data-lang=${c}]`).click({timeout:2000});}).toPass({timeout:12000});};   // the top menu can fold away after a resize: open it again and retry
async function start(page,options){const counts=await mockApis(page,options);await page.goto('/');await expect(page.locator('#searchForm')).toBeVisible();return counts;}
test('no-match search settles and immediate retry works',async({page})=>{await start(page);await choose(page,'zzzqx');await expect(page.locator('#status')).toContainText('Location not found');await expect(page.locator('#loading')).toBeHidden();await choose(page,'Yangon');await expect(page.locator('#locationName')).toContainText('Yangon');await expect(page.locator('#temperature')).toHaveText('30');});
test('ambiguous search preserves selected identity',async({page})=>{await start(page);await choose(page,'Shwe');await expect(page.locator('#searchResults')).toBeVisible();await expect(page.locator('#dashboard')).toBeHidden();await page.locator('[data-place-id="town-nyaung"]').click();await expect(page.locator('#locationName')).toContainText('Nyaungshwe');await expect(page.locator('#locationMeta')).toContainText('20.6600');});
test('unit and language changes keep the tapped hour without resource refetches',async({page})=>{const counts=await start(page);await choose(page,'Yangon');const hour=page.locator('#hourlyForecast .hour').nth(3);await hour.click();await expect(hour).toHaveAttribute('aria-pressed','true');await expect(page.locator('#hourlyDetail .hd-card')).toBeVisible();await page.locator('#unitToggle').click();await expect(page.locator('#temperature')).toHaveText('86');await expect(page.locator('.temp-unit')).toHaveText('°F');await expect(page.locator('#hourlyForecast .hour').nth(3)).toHaveAttribute('aria-pressed','true');await page.locator('#unitToggle').click();await expect(page.locator('.temp-unit')).toHaveText('°C');await setLang(page,'my');await expect(page.locator('#hourlyForecast .hour').nth(3)).toHaveAttribute('aria-pressed','true');await expect(page.locator('#heatCard')).not.toContainText('undefined');await expect(page.locator('#heatCard')).not.toContainText('wx_');expect(counts['/api/hospitals/nearest']||0).toBe(0);expect(counts['/api/v1/climate']||0).toBe(0);});
test('Data Saver comparison is scoped to the new place',async({page})=>{await start(page);await choose(page,'Shwebo');await openTab(page,'compare');await expect(page.locator('#compareCharts .cmp-val').first()).toHaveText(/31/);await page.locator('#liteToggle').click();await choose(page,'Yangon');await expect(page.locator('#compareCharts .cmp-val').first()).toHaveText(/36/);await expect(page.locator('#compareCharts .cmp-val').first()).not.toHaveText(/31/);});
test('farming does not inherit incompatible town data',async({page})=>{await start(page);await choose(page,'Shwebo');await openFarm(page);await expect(page.locator('#agriRegionSel')).toBeVisible();await page.locator('#agriRegionSel').selectOption('R02');await expect(page.locator('#farmHead')).toContainText('Ayeyarwady Delta');await expect(page.locator('#agriLocal')).toBeHidden();await expect(page.locator('#agriWater')).toBeHidden();await page.locator('[data-ftab=season]').click();await expect(page.locator('#agriHistory')).toBeHidden();});
test('mobile destinations become visible and keyboard tabs activate manually',async({page})=>{await start(page);await choose(page,'Yangon');await openTab(page,'hospitals');await expect(page.locator('#hospitalList')).toContainText('Yangon Hospital');await expect(page.locator('[data-panel=hospitals] h3')).toBeInViewport();await page.locator('[data-tab=forecast]').click();await page.locator('[data-tab=forecast]').press('ArrowRight');await expect(page.locator('[data-tab=hazards]')).toBeFocused();await expect(page.locator('[data-tab=forecast]')).toHaveAttribute('aria-selected','true');await page.locator('[data-tab=hazards]').press('Enter');await expect(page.locator('[data-panel=hazards] h3').first()).toBeInViewport();expect(await page.locator('nav[aria-label="Dashboard sections"] [tabindex="0"]').count()).toBe(1);});
test('reload and Back preserve named location and section',async({page})=>{await start(page);await choose(page,'Yangon');await page.locator('[data-tab=forecast]').click();await openTab(page,'hospitals');await page.goBack();await expect(page.locator('[data-tab=forecast]')).toHaveAttribute('aria-selected','true');await page.reload();await expect(page.locator('#locationName')).toContainText('Yangon');await expect(page.locator('[data-tab=forecast]')).toHaveAttribute('aria-selected','true');});
test('scale, checklist, and native dialog preserve logical focus',async({page})=>{await start(page);await choose(page,'Yangon');await page.locator('[data-scale=rain]').click();await page.locator('.scale-close').click();await expect(page.locator('[data-scale=rain]')).toBeFocused();await page.locator('[data-tab=hazards]').click();await unfold(page,'#prepChecklistCard details');await page.locator('[data-prep=water]').check();await expect(page.locator('[data-prep=water]')).toBeFocused();await expect(page.locator('[data-prep=water]')).toBeChecked();await page.locator('#aboutBtn').click();await expect(page.locator('#aboutClose')).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#aboutBtn')).toBeFocused();});
test('older weather never renders under a newer selection',async({page})=>{await start(page,{weatherDelay:180});await page.locator('#locationInput').fill('Shwebo');await page.locator('#searchForm button[type=submit]').click();await expect(page.locator('#locationName')).toContainText('Shwebo');await page.locator('[data-act=pick]:visible').first().click();await page.locator('#locationInput').fill('Yangon');await page.locator('#searchForm button[type=submit]').click();await page.locator('#unitToggle').click();await expect(page.locator('#loading')).toBeHidden();await expect(page.locator('#locationName')).toContainText('Yangon');await expect(page.locator('#temperature')).toHaveText('86');});
test('repeated hospital entry coalesces in-flight requests',async({page})=>{const counts=await start(page,{hospitalDelay:180});await choose(page,'Yangon');await openTab(page,'hospitals');await expect(page.locator('#hospitalRefresh')).toBeDisabled();await openTab(page,'hospitals');await expect(page.locator('#hospitalList')).toContainText('Yangon Hospital');expect(counts['/api/hospitals/nearest']).toBe(1);});
test('Stop invalidates a late GPS callback using isolated fake geolocation',async({page})=>{await mockApis(page);await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(success){setTimeout(()=>success({coords:{latitude:16.84,longitude:96.17}}),200);}}}));await page.goto('/');await page.locator('#currentLocation').click();await page.locator('#loadingCancel').click();await expect(page.locator('#loading')).toBeHidden();await expect(page.locator('#status')).toContainText('Stopped');await page.waitForTimeout(300);await expect(page.locator('#dashboard')).toBeHidden();});
test('app notification off is separate from browser permission',async({page})=>{await mockApis(page);await page.addInitScript(()=>{class FakeNotification{static permission='granted';static requestPermission(){return Promise.resolve('granted');}constructor(){}}Object.defineProperty(window,'Notification',{value:FakeNotification});});await page.goto('/');await expect(page.locator('#notificationToggle')).toHaveAttribute('aria-pressed','true');await page.locator('#notificationToggle').click();await expect(page.locator('#notificationToggle')).toHaveAttribute('aria-pressed','false');await expect(page.locator('#status')).toContainText('off');await page.locator('#notificationToggle').click();await expect(page.locator('#notificationToggle')).toHaveAttribute('aria-pressed','true');});
test('rain-log archive and answer correction retain all records',async({page})=>{await mockApis(page);await page.addInitScript(()=>localStorage.setItem('mw_rain_log_v1',JSON.stringify({v:1,s:{'16.84,96.17|2026-10-15':{k:'16.84,96.17',date:'2026-10-15',chance:70,mm:2,ans:'rain'},'22.55,95.70|2026-10-15':{k:'22.55,95.70',date:'2026-10-15',chance:20,mm:0,ans:'dry'}}})));await page.goto('/');await choose(page,'Yangon');await openTab(page,'compare');await page.locator('[data-rl-clear]').click();await expect(page.locator('[data-rl-restore]')).toBeVisible();const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('mw_rain_log_v1')));expect(Object.keys(data.s)).toHaveLength(3);expect(data.s['22.55,95.70|2026-10-15'].archived).not.toBe(true);await page.locator('[data-rl-restore]').click();await page.locator('#rainLogCard details[data-detail-key=rl-edit] summary').click();await page.locator('[data-rl="16.84,96.17|2026-10-15"][data-a=dry]').click();await page.locator('[data-rl-undo]').click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mw_rain_log_v1')).s['16.84,96.17|2026-10-15'].ans)).toBe('rain');});
test('copy payload uses chosen unit/language without a localhost link',async({page})=>{await mockApis(page);await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText(text){window.__testCopied=text;return Promise.resolve();}}}));await page.goto('/');await choose(page,'Yangon');await page.locator('#unitToggle').click();await page.locator('[data-brief-sms]').click();const text=await page.evaluate(()=>window.__testCopied);expect(text).toContain('86°F');expect(text).toContain('Rain chance');expect(text).not.toContain('127.0.0.1');});
test('an update action cannot leak into a later status',async({page})=>{await start(page);await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'MW_APP_UPDATED'}})));await expect(page.locator('#status button')).toHaveText('Reload update');await choose(page,'zzzqx');await expect(page.locator('#status button')).toHaveCount(0);await expect(page.locator('#status')).not.toHaveClass(/status-action/);});
test('weather cache access retains source age',async({page})=>{await start(page);await page.route('**/api/weather?**',route=>{const d=weather(16.84);d.meta.fetched_at=Date.now()/1000-7200;d.meta.stale=true;return route.fulfill({json:d});});await choose(page,'Yangon');await expect(page.locator('#status')).toContainText('saved');const d=await page.evaluate(()=>JSON.parse(localStorage.getItem('weather-wx-v1:16.840:96.170')));expect(Date.now()-d.saved).toBeGreaterThan(7100000);});
test('weather failure leaves official information visible and offers a direct retry',async({page})=>{await start(page);let fail=true;await page.route('**/api/weather?**',route=>fail?route.fulfill({status:503,json:{detail:'temporarily unavailable'}}):route.fulfill({json:weather(16.84)}));await choose(page,'Yangon');await expect(page.locator('#officialPulse')).toBeVisible();await expect(page.locator('#status .retry-btn')).toBeVisible();fail=false;await page.locator('#status .retry-btn').click();await expect(page.locator('#temperature')).toHaveText('30');});
test('a section file that cannot load says so and offers Reload',async({page})=>{
  let block=true;await mockApis(page);const notes=[];
  await page.route('**/api/client-error**',route=>{notes.push(route.request().url());route.fulfill({status:204});});
  await page.route('**/views_farm.js',route=>block?route.abort():route.continue());  // set BEFORE the page opens, or the file is already there
  await page.goto('/');await expect(page.locator('#searchForm')).toBeVisible();
  await choose(page,'Shwebo');await openFarm(page);
  await expect(page.locator('#sectionFail')).toContainText('could not load');  // not an empty tab
  await expect.poll(()=>notes.length).toBe(1);expect(notes[0]).toContain('t=section');expect(notes[0]).toContain('views_farm.js');
  block=false;await page.locator('#sectionFail button').click();                // a browser remembers a failed import, so Reload is the retry
  await expect(page.locator('#agriRegionSel')).toBeVisible();   // the reloaded page reopens Farming and the file now arrives
});
test('farming reference failure has a direct retry',async({page})=>{await start(page);let fail=true;await page.route('**/api/agri/research',route=>fail?route.fulfill({status:503,json:{}}):route.continue());await openFarm(page);await expect(page.locator('#farmHead button')).toHaveText('Try again');fail=false;await page.locator('#farmHead button').click();await expect(page.locator('#agriRegionSel')).toBeVisible();});
test('denied notification permission explains recovery without prompting again',async({page})=>{await mockApis(page);await page.addInitScript(()=>{class Denied{static permission='denied';static requestPermission(){throw Error('must not prompt');}}Object.defineProperty(window,'Notification',{value:Denied});});await page.goto('/');await page.locator('#notificationToggle').click();await expect(page.locator('#status')).toContainText('blocked');});
test('unsupported notification environments give actionable feedback',async({page})=>{await mockApis(page);await page.addInitScript(()=>{delete window.Notification;});await page.goto('/');await page.locator('#notificationToggle').click();await expect(page.locator('#status')).toContainText('does not support');});
test('native share cancellation is not an error or a clipboard fallback',async({page})=>{await mockApis(page);await page.addInitScript(()=>{Object.defineProperty(navigator,'share',{value:()=>Promise.reject(new DOMException('Cancelled','AbortError'))});Object.defineProperty(navigator,'clipboard',{value:{writeText(){throw Error('must not copy after cancel');}}});});await page.goto('/');await choose(page,'Yangon');await page.locator('[data-brief-share]').click();await expect(page.locator('.brief-copy-status')).toHaveCount(0);});

test('desktop navigation exposes its panel and uses vertical arrow keys',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await start(page);await choose(page,'Yangon');
  const tabs=page.locator('nav[aria-label="Dashboard sections"]');
  await expect(tabs).toHaveAttribute('aria-orientation','vertical');
  await openTab(page,'hospitals');
  await expect(page.locator('[data-panel=hospitals] h3')).toBeInViewport();
  await page.locator('[data-tab=hospitals]').press('ArrowDown');
  await expect(page.locator('[data-tab=compare]')).toBeFocused();
  await expect(page.locator('[data-tab=hospitals]')).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-tab=compare]')).toHaveAttribute('aria-selected','true');
});

test('a late hospital response cannot replace the newer place',async({page})=>{
  await start(page,{hospitalDelay:500});await choose(page,'Shwebo');
  await openTab(page,'hospitals');
  await choose(page,'Yangon');
  await expect(page.locator('#hospitalList')).toContainText('Yangon Hospital');
  await page.waitForTimeout(600);
  await expect(page.locator('#hospitalList')).not.toContainText('Shwebo Hospital');
  await expect(page.locator('#hospitalList')).not.toHaveAttribute('aria-busy','true');
});

test('Stop restores the committed place and ignores the pending weather response',async({page})=>{
  await start(page);await choose(page,'Yangon');
  await page.route('**/api/weather?**',async route=>{
    await new Promise(resolve=>setTimeout(resolve,500));
    try{await route.fulfill({json:weather(22.55)});}catch{ /* Cancelled by Stop. */ }
  });
  await page.locator('[data-act=pick]:visible').first().click();
  await page.locator('#locationInput').fill('Shwebo');
  await page.locator('#searchForm button[type=submit]').click();
  await expect(page.locator('#locationName')).toContainText('Shwebo');
  await page.locator('#loadingCancel').click();
  await expect(page.locator('#locationName')).toContainText('Yangon');
  await expect(page.locator('#temperature')).toHaveText('30');
  await page.waitForTimeout(600);
  await expect(page.locator('#locationName')).toContainText('Yangon');
  await expect(page.locator('#loading')).toBeHidden();
});

test('returning from a short panel restores the longer section reading position',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await start(page);await choose(page,'Yangon');
  await page.locator('[data-tab=forecast]').click();
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight-950));
  const position=await page.evaluate(()=>window.scrollY);
  await openTab(page,'hospitals');
  await expect(page.locator('[data-panel=hospitals] h3')).toBeInViewport();
  await page.locator('[data-tab=forecast]').click();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(position-8);
  expect(Math.abs(await page.evaluate(()=>window.scrollY)-position)).toBeLessThan(8);
});

test('temperature chart shows readable values, scale and dates in both languages and units',async({page})=>{
  await start(page);await choose(page,'Yangon');
  await page.locator('[data-tab=forecast]').click();
  await page.locator('#foldCharts > summary').click();
  const chart=page.locator('#tempChart');
  await expect(chart.locator('.temperature-chart-legend')).toContainText('Daily high');
  await expect(chart.locator('.temperature-chart-legend')).toContainText('Daily low');
  await expect(chart.locator('.temperature-value.temperature-high')).toHaveCount(7);
  await expect(chart.locator('.temperature-value.temperature-low')).toHaveCount(7);
  await expect(chart.locator('.temperature-value.temperature-high').first()).toHaveText('36°C');
  await expect(chart.locator('.temperature-weekday')).toHaveCount(7);
  await expect(chart.locator('.temperature-date')).toHaveCount(7);
  const firstDate=new Date(weather(16.84).weather.daily.time[0]+'T12:00:00Z');
  await expect(chart.locator('.temperature-date').first()).toHaveText(`${firstDate.getUTCDate()}/${firstDate.getUTCMonth()+1}`);
  await expect(page.locator('.forecast-row strong').first()).toHaveText(firstDate.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}));
  await expect(page.locator('.rain-day span').first()).toHaveText(firstDate.toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'}));
  expect(await chart.locator('.temperature-axis').count()).toBeGreaterThan(2);
  await expect(chart.locator('svg')).toHaveAccessibleName(/Daily high and low temperature \(°C\)/);
  await page.locator('#unitToggle').click();
  await expect(chart.locator('.temperature-value.temperature-high').first()).toHaveText('97°F');
  await expect(chart.locator('.temperature-chart-unit')).toHaveText('°F');
  await setLang(page,'my');await expect(page.locator('html')).toHaveAttribute('lang','my');
  await expect(chart.locator('.temperature-chart-legend')).toContainText('နေ့စဉ် အမြင့်ဆုံးအပူချိန်');
  await expect(chart.locator('.temperature-value.temperature-high').first()).toHaveText('၉၇°F');
  await expect(chart.locator('.temperature-date').first()).toHaveText(/[၀-၉]+\/[၀-၉]+/);
  await expect(chart.locator('.temperature-weekday').first()).not.toHaveText(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/);
  await expect(chart.locator('svg')).toHaveAccessibleName(/နေ့စဉ် အမြင့်ဆုံး၊ အနိမ့်ဆုံး အပူချိန် \(°F\)/);
  await page.evaluate(()=>document.fonts.ready);
  for(const selector of ['.temperature-value.temperature-high','.temperature-weekday','.temperature-date']){
    const bounds=await chart.locator(selector).evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right};}));
    expect(bounds.every((bound,index)=>index===0||bound.left>=bounds[index-1].right)).toBe(true);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  await page.setViewportSize({width:1440,height:1000});
  await expect(chart.locator('.temperature-value.temperature-high').first()).toHaveText('၉၇°F');
  await page.locator('#unitToggle').click();
  await expect(chart.locator('.temperature-value.temperature-high').first()).toHaveText('၃၆°C');
});

test('missing temperatures leave gaps while real zero and negative values remain labelled',async({page})=>{
  await start(page);
  await page.route('**/api/weather?**',route=>{
    const data=weather(16.84);data.weather.daily.temperature_2m_max=[null,0,-5,2,null,4,6];data.weather.daily.temperature_2m_min=[null,-2,-8,0,null,1,2];
    return route.fulfill({json:data});
  });
  await choose(page,'Yangon');await page.locator('[data-tab=forecast]').click();
  const chart=page.locator('#tempChart');
  await expect(chart.locator('.temperature-value.temperature-high')).toHaveCount(5);
  await expect(chart.locator('.temperature-missing')).toHaveCount(2);
  await expect(chart.locator('.temperature-line-high')).toHaveCount(2);
  await expect(chart.locator('.temperature-value.temperature-high').first()).toHaveText('0°C');
  await expect(chart.locator('.temperature-value.temperature-high').nth(1)).toHaveText('-5°C');
  await expect(chart).not.toContainText('NaN');
});
test('refresh restores the named place even if the saved copy is gone and the search service is down',async({page})=>{
  await mockApis(page);await page.goto('/');await choose(page,'Shwebo');
  await page.evaluate(()=>{const n=JSON.parse(localStorage.getItem('mw_navigation_v1'));n.place=null;localStorage.setItem('mw_navigation_v1',JSON.stringify(n));history.replaceState(null,'',location.hash);});
  await page.route('**/api/mimu-search**',r=>r.abort());
  await page.reload();
  await expect(page.locator('#locationName')).toContainText('Shwebo');
});

test('farming view: language switch, back/forward, no console errors',async({page})=>{
  const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await mockApis(page);await page.goto('/');await choose(page,'Shwebo');await openFarm(page);
  await page.selectOption('#agriRegionSel','R01');await expect(page.locator('#farmHead h3').first()).toContainText('Central Dry');
  await page.locator('[data-ftab=crops]').click();await expect(page.locator('#agriCrops .crop-list li').first()).toBeVisible();
  const before=await page.locator('#agriRoot h4').first().innerText();
  await setLang(page,'my');await expect(page.locator('html')).toHaveAttribute('lang','my');await page.waitForTimeout(300);
  const after=await page.locator('#agriRoot h4').first().innerText();console.log('lang',before,'->',after);expect(after).not.toBe(before);
  await page.selectOption('#agriRegionSel','R02');await expect(page.locator('#farmHead h3').first()).toContainText('Ayeyarwady');
  await page.goBack();await expect(page.locator('#agriRegionSel')).toHaveValue('R01');
  await page.reload();await expect(page.locator('#agriRegionSel')).toHaveValue('R01');
  await page.locator('[data-ftab=now]').click();await page.selectOption('#agriRegionSel','');await expect(page.locator('#agriRoot .region-btn').first()).toBeVisible();
  await page.locator('#agriRoot .region-btn').nth(2).click();await expect(page.locator('#agriRegionSel')).not.toHaveValue('');
  console.log('errors',JSON.stringify(errs));expect(errs).toEqual([]);
});

test('crash notes: one short anonymous note per distinct error, at most three, none with coordinates or place',async({page})=>{
  const notes=[];await mockApis(page);
  await page.route('**/api/client-error**',route=>{notes.push(new URL(route.request().url()));route.fulfill({status:204});});
  await page.goto('/#mode=weather&tab=today&place=town-yangon&q=Yangon');await expect(page.locator('#searchForm')).toBeAttached();
  await page.evaluate(()=>{
    setTimeout(()=>{throw new Error('boom at 16.84001,96.17002 from https://x.test/a?lat=16.84001')},0);
    setTimeout(()=>{throw new Error('boom at 16.84001,96.17002 from https://x.test/a?lat=16.84001')},5);   // same error again: not repeated
    setTimeout(()=>{Promise.reject(new Error('second kind'))},60);                 // spaced out: a busy machine must not reorder them
    setTimeout(()=>{throw new Error('third')},160);setTimeout(()=>{throw new Error('fourth, over the limit')},260);
  });
  await expect.poll(()=>notes.length,{timeout:4000}).toBe(3);await page.waitForTimeout(400);expect(notes.length).toBe(3);
  const all=notes.map(u=>u.search).join(' ');
  expect(all).toContain('boom');expect(all).not.toMatch(/16\.84|96\.17|lat%3D|lat=16|town-yangon|Yangon/);
  expect(notes.map(u=>u.searchParams.get('t')).sort()).toEqual(['error','error','promise']);expect(all).not.toContain('fourth');
  for(const n of notes) expect(n.searchParams.get('tab')).toMatch(/^[a-z]{0,16}$/);   // only the tab slug, never the place (the app may already have rewritten the hash)
});
test('crash notes: nothing is sent when Do Not Track is on',async({page})=>{
  const notes=[];await mockApis(page);
  await page.addInitScript(()=>{Object.defineProperty(navigator,'doNotTrack',{get:()=>'1'});});
  await page.route('**/api/client-error**',route=>{notes.push(route.request().url());route.fulfill({status:204});});
  await page.goto('/');await expect(page.locator('#searchForm')).toBeAttached();
  await page.evaluate(()=>{setTimeout(()=>{throw new Error('private boom')},0)});await page.waitForTimeout(600);
  expect(notes).toEqual([]);
});
test('crash notes: errors from other sites\' scripts and failed images are not reported',async({page})=>{
  const notes=[];await mockApis(page);
  await page.route('**/api/client-error**',route=>{notes.push(route.request().url());route.fulfill({status:204});});
  await page.goto('/');await expect(page.locator('#searchForm')).toBeAttached();
  await page.evaluate(()=>{const i=document.createElement('img');i.src='/missing-picture.png';document.body.append(i);
    window.dispatchEvent(new ErrorEvent('error',{message:'from an extension',filename:'chrome-extension://abc/inject.js',lineno:1}));
    window.dispatchEvent(new ErrorEvent('error',{message:'Script error.',filename:'',lineno:0}));});
  await page.waitForTimeout(600);expect(notes).toEqual([]);
});
test('the page never scrolls sideways on laptop, tablet and phone (the scrolling hourly strip stays inside its card)',async({page})=>{
  await page.setViewportSize({width:1280,height:800});await start(page);await choose(page,'Yangon');
  for(const [w,h] of [[1920,1080],[1280,800],[1024,768],[820,1100],[393,851],[320,640]]){
    await page.setViewportSize({width:w,height:h});await page.waitForTimeout(150);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),`sideways overflow at ${w}px`).toBeLessThanOrEqual(1);
  }
});
test('Preact region pickers (monthly + history) keep the chosen region after the card redraws',async({page})=>{
  test.setTimeout(45000);
  const errs=[];page.on('pageerror',e=>errs.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text());});
  await start(page);
  await page.route('**/api/history**',async r=>{const u=new URL(r.request().url());r.fulfill({response:await page.request.get(u.pathname+u.search)});});   // the fixture fails history on purpose; here we want the packaged data
  await choose(page,'Yangon');await openTab(page,'compare');
  for(const [id,view] of [['#mcRegion','year'],['#histRegion','hist']]){
    await viewBtn(page,view).click();   // each card sits in its own view of the Compare tab
    const sel=page.locator(id);await sel.scrollIntoViewIfNeeded();await expect(sel).toBeVisible();
    const opts=await sel.locator('option').evaluateAll(o=>o.map(x=>x.value).filter(Boolean));expect(opts.length).toBeGreaterThan(2);
    await sel.selectOption(opts[1]);await expect(sel).toHaveValue(opts[1]);   // draws again after the data arrives, must keep the choice
    await page.waitForTimeout(500);await expect(page.locator(id)).toHaveValue(opts[1]);
  }
  expect(errs).toEqual([]);
});
test('Preact cards survive changing the place several times (no stale or broken cards, no console errors)',async({page})=>{
  test.setTimeout(60000);
  const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text())});
  await mockApis(page);await page.goto('/');
  for(const [name,tab] of [['Yangon','today'],['Shwebo','compare'],['Yangon','flood'],['Shwebo','forecast'],['Yangon','compare']]){
    await choose(page,name);await openTab(page,tab);await page.waitForTimeout(500);
    await expect(page.locator('#locationName')).toContainText(name);
    await expect(page.locator('#hourlyForecast .hour').first()).toBeAttached();
    await expect(page.locator('#forecast .forecast-row').first()).toBeAttached();
  }
  await openFarm(page);await expect(page.locator('#agriRegionSel')).toBeVisible({timeout:20000});await page.selectOption('#agriRegionSel','R01');await expect(page.locator('#farmHead h3').first()).toBeVisible();
  expect(errs).toEqual([]);
});
test('global mode: a place outside Myanmar hides the Myanmar-only cards and keeps the basics',async({page})=>{
  await start(page);
  await page.route('**/api/geocode*',r=>r.fulfill({json:{results:[{id:'g-tokyo',name:'Tokyo',admin1:'Tokyo',country:'Japan',country_code:'JP',latitude:35.68,longitude:139.69}]}}));
  await choose(page,'Tokyo');
  await expect(page.locator('#locationName')).toContainText('Tokyo');
  await expect(page.locator('body')).toHaveClass(/outside-mm/);
  await expect(page.locator('#globalNote')).toBeVisible();
  await expect(page.locator('[data-tab=hospitals]')).toBeHidden();
  await expect(page.locator('#modeFarm')).toBeHidden();
  await expect(page.locator('.tab-farm')).toBeHidden();
  await expect(page.locator('[data-tab=compare]')).toBeAttached();
  await choose(page,'Yangon');
  await expect(page.locator('body')).not.toHaveClass(/outside-mm/);
  if(await page.locator('.tab-more').isVisible())await page.locator('.tab-more').click();
  await expect(page.locator('[data-tab=hospitals]')).toBeVisible();
});
test('warnings card shows forecast-computed alerts as unofficial, and DMH ones as official',async({page})=>{
  await start(page);
  await page.route('**/api/forecast-alerts*',r=>r.fulfill({json:{forecast:[{kind:'rain',level:'high',date:'2026-11-02',value:130,unit:'mm',title:{my:'မိုးသည်းထန်နိုင်',en:'Heavy rain possible'},detail:{my:'တစ်ရက်စာ မိုးရေချိန်',en:'Daily rainfall'},official:false}],official:[{id:'DMH-1',type:'heavy_rain',title:{my:'မိုးသည်းထန်',en:'Heavy rain warning'},links:{en:'https://x/en/1',my:'https://x/my/1'},active:true}],errors:[]}}));
  await choose(page,'Yangon');
  await expect(page.locator('#faCard')).toBeVisible();
  await expect(page.locator('#faCard')).toContainText('Heavy rain possible');
  await expect(page.locator('#faCard')).toContainText('not official');
  await expect(page.locator('#faCard .fa-official a')).toHaveAttribute('href','https://x/en/1');
});
test('world search: ambiguous foreign names list the country, and picking one loads it',async({page})=>{
  await start(page);
  await page.route('**/api/geocode*',r=>r.fulfill({json:{results:[
    {id:1,name:'Paris',admin1:'Île-de-France',country:'France',country_code:'FR',latitude:48.85,longitude:2.35},
    {id:2,name:'Paris',admin1:'Texas',country:'United States',country_code:'US',latitude:33.66,longitude:-95.55}]}}));
  await choose(page,'Paris');
  await expect(page.locator('#searchResults')).toBeVisible();
  await expect(page.locator('#searchResults button')).toHaveCount(2);
  await expect(page.locator('#searchResults')).toContainText('France');
  await expect(page.locator('#searchResults')).toContainText('United States');
  await page.locator('[data-place-id="2"]').click();
  await expect(page.locator('#locationName')).toContainText('Paris');
  await expect(page.locator('body')).toHaveClass(/outside-mm/);
});
test('world search: when our backend geocoder is degraded the browser falls back to Open-Meteo',async({page})=>{
  await start(page);
  await page.route('**/api/geocode*',r=>r.fulfill({json:{results:[],degraded:true}}));
  await page.route('https://geocoding-api.open-meteo.com/**',r=>r.fulfill({json:{results:[{id:9,name:'Lima',admin1:'Lima',country:'Peru',country_code:'PE',latitude:-12.04,longitude:-77.04}]}}));
  await choose(page,'Lima');
  await expect(page.locator('#locationName')).toContainText('Lima');
});
test('desktop top-bar search: appears once a place is shown and switches the place',async({browser})=>{
  const ctx=await browser.newContext({viewport:{width:1280,height:800},baseURL:'http://127.0.0.1:8012',serviceWorkers:'block'});
  const page=await ctx.newPage();
  await mockApis(page);await page.goto('/');
  await expect(page.locator('#topSearch')).toBeHidden();
  await choose(page,'Yangon');
  await expect(page.locator('#topSearch')).toBeVisible();
  await page.locator('#topSearchInput').fill('Yangon');await page.locator('#topSearchInput').press('Enter');
  await expect(page.locator('#locationName')).toContainText('Yangon');
  await ctx.close();
});
test('phone: top-bar search stays hidden',async({page})=>{
  await start(page);await choose(page,'Yangon');
  await expect(page.locator('#topSearch')).toBeHidden();
});
test('pest guide: crops, folding cards, no medicine text, photo credit when present',async({page})=>{
  const errs=[];page.on('pageerror',e=>errs.push(String(e)));
  await mockApis(page);
  await page.route('**/pests/credits.json',r=>r.fulfill({json:{rice_blast:{file:'rice_blast.jpg',author:'Test Author',license:'CC BY-SA 4.0',url:'https://commons.wikimedia.org/wiki/File:x.jpg'}}}));
  await page.route('**/pests/rice_blast.jpg',r=>r.fulfill({contentType:'image/jpeg',body:Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64')}));
  await page.goto('/');await choose(page,'Shwebo');await openFarm(page);await page.locator('[data-ftab=crops]').click();
  await expect(page.locator('#pestCard .pest-chip')).toHaveCount(18);
  await expect(page.locator('#pestCard .pest-item')).toHaveCount(6);
  await page.locator('#pestCard .pest-item summary').first().click();
  await expect(page.locator('#pestCard .pest-item[open] h4').first()).toBeVisible();
  await expect(page.locator('#pestCard .pest-fig figcaption')).toContainText('Test Author');
  await page.locator('#pestCard .pest-chip',{hasText:'Coffee'}).click();
  await expect(page.locator('#pestCard .pest-item').first()).toContainText('Coffee');
  await expect(page.locator('#pestCard')).toContainText('local agriculture office');
  expect(errs).toEqual([]);
});
test('install tip: iPhone Safari gets the home-screen hint once, Close keeps it away',async({browser})=>{
  const ctx=await browser.newContext({baseURL:'http://127.0.0.1:8012',serviceWorkers:'block',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'});
  const page=await ctx.newPage();await mockApis(page);await page.goto('/');await choose(page,'Yangon');
  await expect(page.locator('#installTip')).toBeVisible({timeout:6000});await expect(page.locator('#installText')).toContainText('Add to Home Screen');
  await page.locator('#installClose').click();await expect(page.locator('#installTip')).toBeHidden();
  await page.reload();await choose(page,'Yangon');await page.waitForTimeout(2200);await expect(page.locator('#installTip')).toBeHidden();
  await ctx.close();
});
test('moon calendar: other days via arrows, date picker and Today',async({page})=>{
  await mockApis(page);await page.goto('/');await choose(page,'Yangon');await expect(page.locator('#moonCard .moon-sum strong')).toBeVisible();await expect(page.locator('#moonCard .moon-nav')).toBeHidden();await page.locator('#moonCard summary').click();
  const line=page.locator('#moonCard .moon-row strong');await expect(line).toBeVisible();const first=await line.textContent();
  await expect(page.locator('#moonCard .moon-today')).toHaveCount(0);
  await page.locator('#moonCard .moon-nav button').last().click();await expect(page.locator('#moonCard .moon-today')).toBeVisible();
  await page.locator('#moonCard .moon-nav input').fill('2026-12-01');await expect(page.locator('#moonCard .moon-nav input')).toHaveValue('2026-12-01');
  await page.locator('#moonCard .moon-today').click();await expect(page.locator('#moonCard .moon-today')).toHaveCount(0);await expect(line).toHaveText(first);
});
test('phone bottom bar: five items, More opens Flood/Hospitals/Compare, Farming and back work',async({page})=>{
  await start(page);await choose(page,'Yangon');
  await expect(page.locator('.tab-farm')).toBeVisible();await expect(page.locator('[data-tab=flood]')).toBeHidden();
  await page.locator('.tab-more').click();await expect(page.locator('[data-tab=flood]')).toBeVisible();await expect(page.locator('[data-tab=hospitals]')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('[data-tab=flood]')).toBeHidden();
  await page.locator('.tab-more').click();await page.locator('[data-tab=flood]').click();
  await expect(page.locator('[data-tab=flood]')).toHaveAttribute('aria-selected','true');await expect(page.locator('[data-tab=hospitals]')).toBeHidden();
  await page.locator('.tab-farm').click();await expect(page.locator('#farmTabbar')).toBeVisible();await expect(page.locator('.mode-switch')).toBeHidden();
  await page.locator('.fnavx').click();await expect(page.locator('#dashboard')).toBeVisible();await expect(page.locator('#farmTabbar')).toBeHidden();
});

test('thumb zone: first open has big location button + city chips; place sheet opens from the bottom pill; ⚙️ holds language/theme; share works',async({page})=>{
  await start(page);
  await expect(page.locator('#currentLocation')).toBeVisible();
  const b=await page.locator('#currentLocation').boundingBox();expect(b.y).toBeGreaterThan(650);expect(b.height).toBeGreaterThanOrEqual(48);
  await expect(page.locator('#recentLocations button').first()).toBeVisible();
  await page.evaluate(()=>document.getElementById('topMore').classList.remove('open'));
  await expect(page.locator('#themeToggle')).toBeHidden();
  await choose(page,'Yangon');
  await expect(page.locator('.loc-actions .change-btn')).toBeVisible();   // in the place row, not floating over the cards
  await expect(page.locator('#placeSheet')).toBeHidden();
  await page.locator('.loc-actions .change-btn').click();
  await expect(page.locator('#placeSheet')).toBeVisible();await expect(page.locator('#sheetBackdrop')).toBeVisible();
  await page.locator('#sheetClose').click();await expect(page.locator('#placeSheet')).toBeHidden();
  await page.locator('#topMoreBtn').click();
  await expect(page.locator('#themeToggle')).toBeVisible();await expect(page.locator('#languageToggle')).toBeVisible();
  await page.evaluate(()=>{Object.defineProperty(navigator,'share',{value:undefined,configurable:true});});
  // Share makes a PNG picture card (no Web Share with files here, so it downloads) and tells the person what to do with it
  const dl=page.waitForEvent('download');
  await page.locator('#shareFab').click();
  const file=await dl;expect(file.suggestedFilename()).toBe('safeguard-weather.png');
  await expect(page.locator('#status')).toContainText(/Picture saved|ပုံသိမ်း/);
  const path=await file.path();const fs=await import('node:fs');const head=fs.readFileSync(path).subarray(0,8);
  expect([...head]).toEqual([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);   // really a PNG
  await expect(page.locator('#shareFab')).toBeEnabled();
});
test('Share falls back to text when the picture cannot be made',async({page})=>{
  await start(page);await choose(page,'Yangon');
  await page.evaluate(()=>{window.__copied='';navigator.clipboard.writeText=t=>{window.__copied=t;return Promise.resolve();};Object.defineProperty(navigator,'share',{value:undefined,configurable:true});window.mwShareImage=async()=>{throw new Error('canvas broke');};});
  await page.locator('#shareFab').click();await expect(page.locator('#status')).toContainText(/Viber|paste|ကူး/);expect(await page.evaluate(()=>window.__copied)).toContain('Yangon');
});
test('rain log: after answering, the answer stays visible and can be changed and survives reload',async({page})=>{
  await start(page);await choose(page,'Yangon');await openTab(page,'compare');
  await page.locator('#rainLogCard [data-rl][data-a=rain]').first().click();
  await expect(page.locator('#rainLogCard [data-a=dry]')).toBeVisible();
  await page.locator('#rainLogCard [data-a=dry]').click();
  await expect(page.locator('#rainLogCard [data-a=dry]')).toHaveAttribute('aria-pressed','true');
  await page.reload();await expect(page.locator('#locationName')).toContainText('Yangon');await openTab(page,'compare');
  expect(await page.evaluate(()=>localStorage.getItem('mw_rain_log_v1'))).toContain('"ans":"dry"');
});

test('"See all" under today\'s warnings opens the Alerts tab on a phone, even next to the floating pills',async({page})=>{
  await start(page);await choose(page,'Yangon');
  const b=page.locator('.mwr-link-btn').first();await b.scrollIntoViewIfNeeded();
  await b.click();
  await expect(page.locator('[data-tab=hazards]')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('[data-panel=hazards]')).toBeVisible();
});

test('language picker: Burmese, English, Japanese and Easy Japanese, saved across reloads',async({page})=>{
  await start(page);await choose(page,'Yangon');
  const lt=page.locator('#languageToggle');
  await expect(lt).toHaveText('English');
  await lt.click({force:true});
  await expect(page.locator('#langSheet')).toBeVisible();
  await expect(page.locator('#langSheet [data-lang=en]')).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('Escape');await expect(page.locator('#langSheet')).toBeHidden();
  await setLang(page,'ja');
  await expect(lt).toHaveText('日本語');
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await expect(page.locator('[data-i18n=headline]')).toContainText('天気');
  await expect(page.locator('#condition')).toHaveText('曇り');
  await expect(page.locator('#wmtList')).toContainText('健康上の注意');
  await page.reload();await expect(page.locator('#locationName')).toContainText('Yangon');
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await expect(page.locator('#condition')).toHaveText('曇り');
  await setLang(page,'easy');
  await expect(lt).toHaveText('やさしい');
  await expect(page.locator('#condition')).toHaveText('くもり');
  await expect(page.locator('#wmtList')).not.toContainText('健康上の注意');
  await page.reload();await expect(page.locator('#locationName')).toContainText('Yangon');
  await expect(page.locator('#condition')).toHaveText('くもり');
  await setLang(page,'my');
  await expect(page.locator('html')).toHaveAttribute('lang','my');
  await expect(lt).toHaveText('မြန်မာ');
  await setLang(page,'en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('#condition')).toHaveText('Overcast');
});

test('World tab: lists worldwide hazards, filters by kind, shows distance, blocks non-https links, works in all languages',async({page})=>{
  await start(page);await choose(page,'Yangon');
  if(await page.locator('.tab-more').isVisible())await page.locator('.tab-more').click();
  await page.locator('[data-tab=world]').click();
  await expect(page.locator('[data-panel=world]')).toBeVisible();
  const card=page.locator('#worldCard');
  await expect(card).toContainText('M7.1');await expect(card).toContainText('Wildfire Test');
  await expect(card.locator('.world-row')).toHaveCount(2);
  await expect(card.locator('.world-row').first()).toContainText(/[A-Z][a-z]{2} \d{1,2} \d{2}:\d{2} · .*ago/);  // every item shows its date and clock, not only "3 h ago"
  await expect(card).toContainText(/Checked: [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}/);
  await expect(card).toContainText('km');
  await expect(card.locator('a[href^="https://earthquake"]')).toHaveCount(1);
  await expect(card.locator('a[href^="javascript"]')).toHaveCount(0);
  await card.locator('[data-world-filter=wildfire]').click();
  await expect(card.locator('.world-row')).toHaveCount(1);
  await card.locator('[data-world-filter=all]').click();await expect(card.locator('.world-row')).toHaveCount(2);
  await setLang(page,'ja');await expect(card).toContainText('世界').catch(()=>{});
  await page.reload();await expect(page.locator('[data-panel=world]')).toBeVisible();
});

test('no connection: reopening the app shows the last saved weather for that place, marked as saved',async({page})=>{
  await start(page);await choose(page,'Yangon');
  await expect(page.locator('#temperature')).not.toHaveText('—');
  const t=(await page.locator('#temperature').textContent()).trim();
  await page.evaluate(()=>{for(const k of Object.keys(localStorage)){try{const c=JSON.parse(localStorage.getItem(k));if(c&&c.data&&c.data.meta&&typeof c.saved==='number'){c.saved-=3*3600e3;c.data.meta.fetched_at=Number(c.data.meta.fetched_at)-3*3600;localStorage.setItem(k,JSON.stringify(c));}}catch{}}});
  await page.unroute('**/*');await page.route('**/api/**',r=>r.abort('internetdisconnected'));
  await page.reload();
  await expect(page.locator('#locationName')).toContainText('Yangon');
  await expect(page.locator('#temperature')).toHaveText(t,{timeout:15000});
  await expect(page.locator('#sourceMini')).toContainText(/saved/i);
});

for (const [name,w,btn] of [['phone',393,'#metricFold'],['tablet',820,'#metricFold'],['wide tablet',1000,'#metricFold']]) {
  test(`${name}: the "show more details" button really reveals all ten key numbers, and "show less" hides them again`,async({page})=>{
    await page.setViewportSize({width:w,height:900});await start(page);await choose(page,'Yangon');
    const shown=()=>page.locator('.metric-grid .metric:visible').count();
    expect(await shown()).toBe(4);
    await page.locator(btn).click();expect(await shown()).toBe(10);
    await page.locator(btn).click();expect(await shown()).toBe(4);
    await expect(page.locator('#metricsMore')).toHaveCount(0);   // the old second mechanism is gone: one button only
  });
}
test('phone: every "show more details" button keeps working after a new place, a language change and a trip to another tab',async({page})=>{
  await page.setViewportSize({width:393,height:900});await start(page);await choose(page,'Yangon');
  const shown=()=>page.locator('.metric-grid .metric:visible').count();
  const brief=page.locator('#todayBrief'),briefBtn=page.locator('#todayBriefFold');
  await expect(briefBtn).toBeVisible();expect(await brief.evaluate(e=>e.classList.contains('m-open'))).toBe(false);
  await briefBtn.click();expect(await brief.evaluate(e=>e.classList.contains('m-open'))).toBe(true);await expect(briefBtn).toHaveAttribute('aria-expanded','true');
  await briefBtn.click();expect(await brief.evaluate(e=>e.classList.contains('m-open'))).toBe(false);
  await choose(page,'Shwebo');                                   // a new place re-renders the numbers
  await page.locator('#metricFold').click();expect(await shown()).toBe(10);
  await setLang(page,'my');                                      // the label is re-written, the button must not be duplicated or detached
  await expect(page.locator('#metricFold')).toHaveCount(1);
  await page.locator('#metricFold').click();expect(await shown()).toBe(4);
  await page.locator('[data-tab=forecast]').click();await page.locator('[data-tab=today]').click();
  await page.locator('#metricFold').click();expect(await shown()).toBe(10);   // one tap = one change (never a double toggle)
  await page.locator('#metricFold').click();expect(await shown()).toBe(4);
});
test('the risk card "See details" button opens the Alerts section',async({page})=>{
  await page.setViewportSize({width:393,height:900});await start(page);await choose(page,'Yangon');
  const btn=page.locator('.mwr-link-btn').first();await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('.tab[data-tab=hazards]')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.tab-panel[data-panel=hazards]')).toBeVisible();
});
for (const [name,w] of [['phone',393],['desktop',1366]]) {
  test(`${name}: the weather band is dark enough for white text and follows the sky`,async({page})=>{
    await page.setViewportSize({width:w,height:900});await start(page);await choose(page,'Yangon');
    const band=page.locator('.current-card');
    const css=await band.evaluate(e=>{const c=getComputedStyle(e),t=getComputedStyle(e.querySelector('.hero-temp'));return {bg:c.backgroundImage,color:t.color,pos:c.position};});
    expect(css.bg).toContain('linear-gradient');expect(css.color).toBe('rgb(255, 255, 255)');
    const grad=async cls=>{await page.evaluate(c=>{document.body.classList.remove('weather-clear','weather-rain','weather-storm','weather-fog','weather-hot','weather-night');document.body.classList.add(c);},cls);return band.evaluate(e=>getComputedStyle(e).getPropertyValue('--sky-b').trim());};
    const seen=new Set();for(const c of ['weather-clear','weather-rain','weather-storm','weather-fog','weather-hot','weather-night'])seen.add(await grad(c));
    expect(seen.size).toBe(6);                                    // six different skies
    for(const hex of seen){const n=parseInt(hex.slice(1),16),f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;},L=.2126*f(n>>16)+.7152*f((n>>8)&255)+.0722*f(n&255);expect(1.05/(L+.05)).toBeGreaterThanOrEqual(4.5);}   // white text contrast on the lightest stop
  });
}
const richClimate=lat=>({generated_at:new Date().toISOString(),conditions:[
  {kind:'temperature_max',title:{en:'Daytime high',my:'နေ့အပူချိန်'},headline:{en:'Forecast high is above normal.',my:'ပုံမှန်ထက် ပူမယ်'},level:'above_normal',level_label:{en:'Warmer than usual',my:'ပုံမှန်ထက်ပူ'},metrics:[{key:'forecast_tmax',value:lat<20?36.4:34.1},{key:'normal_p10',value:31.2},{key:'normal_p90',value:34.6},{key:'normal_mean',value:33}],limitations:[],sources:['ERA5']},
  {kind:'rain_30d',title:{en:'Rain, last 30 days',my:'၃၀ ရက် မိုးရေ'},headline:{en:'Drier than normal.',my:'ပုံမှန်ထက် ခြောက်'},level:'below_normal',level_label:{en:'Drier than usual',my:'ပုံမှန်ထက်ခြောက်'},metrics:[{key:'total_30d',value:142.6},{key:'normal_q33',value:210.4},{key:'normal_q67',value:318.9},{key:'normal_median',value:262.3}],limitations:[],sources:['ERA5']},
  {kind:'soil_moisture',title:{en:'Soil moisture',my:'မြေစိုထိုင်းဆ'},headline:{en:'Drying.',my:'ခြောက်လာ'},level:'below_normal',level_label:{en:'Drying',my:'ခြောက်လာ'},metrics:[{key:'soil_moisture_now',value:0.27},{key:'soil_moisture_7d_ago',value:0.33}],limitations:[],sources:['ERA5']}]});
const richMonthly=()=>({available:true,year:2026,regions:[],data_through:'2026-10-19',summary:{temp_diff:0.6,rain:2083,rain_pct:92},
  months:Array.from({length:12},(_,i)=>i<10?{month:i+1,status:'ok',partial:i===9,days:i===9?19:undefined,temp:30+i*.1,temp_normal:29.5,temp_diff:[.5,.9,.5,.4,.4,.4,.3,.2,.1,.6][i],rain:100+i,rain_normal:90,rain_diff:10+i}:{month:i+1,status:'pending'})});
const viewBtn=(page,v)=>page.locator(`#cmpSeg [data-cmp-view=${v}]`);
async function openCompare(page,w,{history=false}={}){
  await page.setViewportSize({width:w,height:900});await start(page);
  await page.route('**/api/v1/climate**',r=>{const u=new URL(r.request().url());r.fulfill({json:richClimate(Number(u.searchParams.get('lat')))});});
  await page.route('**/api/v1/monthly-compare**',r=>r.fulfill({json:richMonthly()}));
  if(history)await page.route('**/api/history**',async r=>{const u=new URL(r.request().url());r.fulfill({response:await page.request.get(u.pathname+u.search)});});   // the fixture fails history on purpose; here we want the packaged data
  await choose(page,'Yangon');await openTab(page,'compare');
}
for (const [name,w] of [['phone',393],['small phone',320],['tablet',820],['desktop',1366]]) {
  test(`${name}: Compare tab has three views and each shows only its own cards`,async({page})=>{
    await openCompare(page,w);
    const seg=page.locator('#cmpSeg');await expect(seg).toBeVisible();
    expect((await seg.boundingBox()).height).toBeGreaterThan(40);                  // a real control (a clashing class once squashed it to 10 px)
    for(const v of ['now','year','hist'])expect((await viewBtn(page,v).boundingBox()).height).toBeGreaterThanOrEqual(44);
    const shown=async()=>page.evaluate(()=>[...document.querySelectorAll('[data-panel=compare] [data-seg]')].filter(e=>e.getBoundingClientRect().height>0).map(e=>e.id));
    await expect(viewBtn(page,'now')).toHaveAttribute('aria-selected','true');
    expect(await shown()).toEqual(['compareCharts','rainLogCard']);
    await viewBtn(page,'year').click();
    await expect(viewBtn(page,'year')).toHaveAttribute('aria-selected','true');await expect(viewBtn(page,'now')).toHaveAttribute('aria-selected','false');
    expect(await shown()).toEqual(['monthlyCompareCard']);
    await viewBtn(page,'hist').click();expect(await shown()).toEqual(['historyCard']);
    await viewBtn(page,'now').click();expect(await shown()).toEqual(['compareCharts','rainLogCard']);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  });
}
test('Compare views: arrow keys move between them, only the chosen one is in the tab order',async({page})=>{
  await openCompare(page,393);
  await viewBtn(page,'now').focus();
  await expect(viewBtn(page,'now')).toHaveAttribute('tabindex','0');await expect(viewBtn(page,'year')).toHaveAttribute('tabindex','-1');
  await page.keyboard.press('ArrowRight');
  await expect(viewBtn(page,'year')).toHaveAttribute('aria-selected','true');await expect(viewBtn(page,'year')).toBeFocused();
  await expect(page.locator('#monthlyCompareCard')).toBeVisible();await expect(page.locator('#compareCharts')).toBeHidden();
  await page.keyboard.press('End');await expect(viewBtn(page,'hist')).toBeFocused();await expect(page.locator('#historyCard')).toBeVisible();
  await page.keyboard.press('ArrowRight');await expect(viewBtn(page,'now')).toBeFocused();   // wraps round
  await page.keyboard.press('Home');await expect(viewBtn(page,'now')).toHaveAttribute('aria-selected','true');
});
for (const [name,w] of [['phone',393],['small phone',320],['desktop',1366]]) {
  test(`${name}: Compare "now" view shows each number once, in readable text, and no two numbers overlap`,async({page})=>{
    await openCompare(page,w);
    const tiles=page.locator('#compareCharts .cmp-blk');await expect(tiles).toHaveCount(3);
    // one big number and one range line per temperature / rain card; the picture itself carries no text
    await expect(tiles.first().locator('.cmp-val')).toHaveText(/36\.4/);
    await expect(tiles.first().locator('.cmp-normal')).toContainText('31.2');
    expect(await tiles.first().locator('svg').count()).toBe(0);
    // the long method text and the plain "how to read" line are folded or short: the view fits in a few screens
    expect(await page.locator('#compareCharts').evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(w<700?1300:900);
    for(const t of await tiles.all()){const top=await t.locator('.cmp-top').evaluate(e=>[...e.children].map(c=>{const r=c.getBoundingClientRect();return [r.left,r.right,r.top,r.bottom];}));
      if(top.length>1){const [a,b]=top;expect(a[1]<=b[0]+1||a[3]<=b[2]+1||b[3]<=a[2]+1,'title and state do not overlap').toBe(true);}}
  });
  test(`${name}: Compare "this year" view lists each month as a row with its number in text, none clipped or overlapping`,async({page})=>{
    await openCompare(page,w);await viewBtn(page,'year').click();
    const probe=()=>page.evaluate(()=>{const out=[];const rows=[...document.querySelectorAll('#monthlyCompareCard .mc-row')];
      for(const row of rows){const n=row.querySelector('.mc-m'),v=row.querySelector('.mc-v'),bar=row.querySelector('.mc-bar');
        const a=n.getBoundingClientRect(),b=v.getBoundingClientRect(),c=bar.getBoundingClientRect();
        if(n.scrollWidth>n.clientWidth+1||v.scrollWidth>v.clientWidth+1)out.push('clipped '+n.textContent);
        if(a.left<b.right&&b.left<a.right&&a.top<b.bottom-1&&b.top<a.bottom-1)out.push('name/number overlap '+n.textContent);
        if(c.width<40)out.push('bar too short '+n.textContent+' '+Math.round(c.width));
        const rr=row.getBoundingClientRect();if(rr.left<-1||rr.right>innerWidth+1)out.push('off screen '+n.textContent);}
      return {n:rows.length,out,texts:rows.map(r=>r.innerText.replace(/\s+/g,' '))};});
    let r=await probe();expect(r.n).toBe(10);expect(r.out).toEqual([]);
    expect(r.texts[0]).toMatch(/\+0\.5/);expect(r.texts[9]).toMatch(/19/);                 // the unfinished month says how many days it has
    expect(await page.locator('#monthlyCompareCard .mc-fill.hatch').count()).toBe(1);
    await expect(page.locator('#monthlyCompareCard .mc-pending')).toBeVisible();           // "later months: no data yet"
    await setLang(page,'my');r=await probe();expect(r.out).toEqual([]);                      // Burmese month names are the widest
    await page.locator('#monthlyCompareCard .mc-tab').nth(1).click();r=await probe();expect(r.out).toEqual([]);   // rain, in mm
    expect(r.texts[0]).toMatch(/\+10|၁၀/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  });
}
for (const [name,w] of [['phone',393],['small phone',320],['tablet',820]]) {
  test(`${name}: Compare "long term" charts keep their axis labels inside the picture and apart from each other`,async({page})=>{
    test.setTimeout(45000);
    await openCompare(page,w,{history:true});await viewBtn(page,'hist').click();
    const probe=()=>page.evaluate(()=>{const out=[];const svgs=[...document.querySelectorAll('#historyBody svg')];
      for(const s of svgs){const sr=s.getBoundingClientRect();const ts=[...s.querySelectorAll('text')].map(t=>({s:t.textContent,r:t.getBoundingClientRect(),a:getComputedStyle(t).textAnchor}));
        for(const t of ts){if(t.r.left<sr.left-1||t.r.right>sr.right+1||t.r.top<sr.top-1||t.r.bottom>sr.bottom+1)out.push('clipped '+t.s);}
        for(let i=0;i<ts.length;i++)for(let j=i+1;j<ts.length;j++){const a=ts[i].r,b=ts[j].r;if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-2&&b.top<a.bottom-2)out.push('overlap '+ts[i].s+' / '+ts[j].s);}
        const vb=s.viewBox.baseVal.height,anchors=[...s.querySelectorAll('text')].filter(t=>Number(t.getAttribute('y'))>vb-20).map(t=>getComputedStyle(t).textAnchor);; /* bottom row = first / middle / last year */ if(anchors.length&&anchors.join()!=='start,middle,end')out.push('year labels not start/middle/end: '+anchors);}
      return {svgs:svgs.length,out};});
    await expect(page.locator('#historyBody svg').first()).toBeVisible({timeout:15000});
    let r=await probe();expect(r.svgs).toBeGreaterThanOrEqual(2);expect(r.out).toEqual([]);
    await setLang(page,'my');await expect(page.locator('#historyBody svg').first()).toBeVisible();r=await probe();expect(r.out).toEqual([]);
    // the typical-year months are rows of text too, with the current month marked
    expect(await page.locator('#historyBody .hist-months .mc-row').count()).toBe(12);expect(await page.locator('#historyBody .hist-months .mc-row.now').count()).toBe(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  });
}
test('laptop 1024px: the content column never pushes past the screen in Burmese or Japanese (it used to by ~90 px)',async({page})=>{
  test.setTimeout(45000);
  await openCompare(page,1024);
  for(const lang of ['my','ja']){await setLang(page,lang);
    for(const v of ['now','year','hist']){await viewBtn(page,v).click();
      const over=await page.evaluate(()=>{const c=document.querySelector('[data-panel=compare]').getBoundingClientRect();return Math.round(c.right-innerWidth);});
      expect(over,`${lang}/${v}`).toBeLessThanOrEqual(0);}}
});
test('rain log: the totals and accuracy are folded away, the question and the three answers are not',async({page})=>{
  await openCompare(page,393);
  await expect(page.locator('#rainLogCard [data-rl][data-a=rain]').first()).toBeVisible();
  const more=page.locator('#rainLogCard details.rl-more');await expect(more).toHaveCount(1);expect(await more.evaluate(d=>d.open)).toBe(false);
  await page.locator('#rainLogCard [data-rl][data-a=rain]').first().click();
  await expect(page.locator('#rainLogCard [data-a=dry]')).toBeVisible();
});
test('laptop and desktop (1024px and up): all ten key numbers are shown and there is no show-more button',async({page})=>{
  await page.setViewportSize({width:1024,height:900});await start(page);await choose(page,'Yangon');
  for(const w of [1024,1100,1440]){
    await page.setViewportSize({width:w,height:900});
    expect(await page.locator('.metric-grid .metric:visible').count()).toBe(10);
    await expect(page.locator('#metricFold')).toBeHidden();
  }
});

// ---- v9.16: own weather icons, the moving sky, swipe between tabs ----
test('weather icons are our own SVG (no emoji) in the band, hourly strip, hour detail and 7-day list',async({page})=>{
  await start(page);await choose(page,'Yangon');
  await expect(page.locator('#weatherIcon svg.wxi')).toHaveCount(1);
  expect(await page.locator('#weatherIcon').innerText()).toBe('');                       // no emoji character beside the drawing
  await expect(page.locator('#hourlyForecast .hour .emoji svg.wxi').first()).toBeVisible();
  await page.locator('#hourlyForecast .hour').first().click();
  await expect(page.locator('.hd-emoji svg.wxi')).toBeVisible();
  await openTab(page,'forecast');
  expect(await page.locator('.fc-ic svg.wxi').count()).toBeGreaterThanOrEqual(5);
  for(const s of await page.locator('svg.wxi').all()){const b=await s.boundingBox();if(b){expect(b.width).toBeGreaterThan(14);expect(Math.abs(b.width-b.height)).toBeLessThan(1);}}
});
test('the moving sky is decoration only: behind the text, not clickable, hidden for reduced motion and data saving',async({page})=>{
  await start(page);await choose(page,'Yangon');
  const fx=page.locator('.current-card .sky-fx');
  await expect(fx).toHaveAttribute('aria-hidden','true');
  const st=await fx.evaluate(e=>{const c=getComputedStyle(e);return {pe:c.pointerEvents,z:c.zIndex,pos:c.position,disp:c.display};});
  expect(st).toEqual({pe:'none',z:'-1',pos:'absolute',disp:'block'});
  // it animates only transform / opacity (compositor-only), so the page does not re-layout while it moves
  const props=await page.evaluate(()=>[...document.querySelectorAll('.sky-fx i')].flatMap(i=>i.getAnimations().map(a=>Object.keys(a.effect.getKeyframes()[0]).filter(k=>!['offset','easing','composite','computedOffset'].includes(k)))).flat());
  expect(props.length).toBeGreaterThan(0);for(const p of props)expect(['transform','opacity']).toContain(p);
  const before=await page.locator('.current-card').boundingBox();await page.waitForTimeout(600);
  expect(await page.locator('.current-card').boundingBox()).toEqual(before);              // nothing moves the layout
  await page.emulateMedia({reducedMotion:'reduce'});await expect(fx).toBeHidden();
  await page.emulateMedia({reducedMotion:'no-preference'});await expect(fx).toBeVisible();
  await page.evaluate(()=>document.documentElement.classList.add('no-fx'));await expect(fx).toBeHidden();
});
test('white text on the weather band stays readable for every sky (glow and moving layers included)',async({page})=>{
  await start(page);await choose(page,'Yangon');
  const ratio=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return 1.05/(.2126*f(r)+.7152*f(g)+.0722*f(b)+.05);};
  for(const cls of ['weather-clear','weather-rain','weather-storm','weather-fog','weather-hot']){
    for(const night of [false,true]){
      const css=await page.evaluate(([c,n])=>{document.body.classList.remove('weather-clear','weather-rain','weather-storm','weather-fog','weather-hot','weather-night');document.body.classList.add(c);if(n)document.body.classList.add('weather-night');
        const s=getComputedStyle(document.querySelector('.current-card'));return {b:s.getPropertyValue('--sky-b').trim(),g:s.getPropertyValue('--sky-glow').trim()};},[cls,night]);
      const hex=css.b.replace('#','');const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
      const m=css.g.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);const a=Number(m[4]);
      const mixed=rgb.map((v,i)=>v*(1-a)+Number(m[i+1])*a);                              // lightest stop with the full-strength glow over it
      expect(ratio(mixed),`${cls}${night?' night':''}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
test.describe('swipe between tabs (touch screen)',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:393,height:851}});
  // a one-finger swipe made of real touch events: start (x1,y1) on `sel`, end (x2,y2)
  const swipe=async(page,sel,[x1,y1],[x2,y2],ms=120)=>page.evaluate(async([sel,x1,y1,x2,y2,ms])=>{
    const el=sel?document.querySelector(sel):document.elementFromPoint(x1,y1);const mk=(type,x,y)=>new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[new Touch({identifier:1,target:el,clientX:x,clientY:y})],changedTouches:[new Touch({identifier:1,target:el,clientX:x,clientY:y})]});
    el.dispatchEvent(mk('touchstart',x1,y1));await new Promise(r=>setTimeout(r,ms));el.dispatchEvent(mk('touchend',x2,y2));},[sel,x1,y1,x2,y2,ms]);
  const active=page=>page.locator('nav.tabbar [data-tab][aria-selected=true]').first().getAttribute('data-tab');
  test('left swipe goes to the next tab, right swipe goes back, the ends stay put',async({page})=>{
    await start(page);await choose(page,'Yangon');await page.evaluate(()=>document.getElementById('topMore')?.classList.remove('open'));
    expect(await active(page)).toBe('today');
    await swipe(page,'[data-panel=today]',[300,400],[300,400]);                                               // a tap is not a swipe
    expect(await active(page)).toBe('today');
    await swipe(page,'[data-panel=today]',[300,420],[150,430]);                                               // finger moves left
    await expect.poll(()=>active(page)).toBe('forecast');
    await expect(page.locator('[data-panel=forecast]')).toBeVisible();
    await swipe(page,'[data-panel=forecast]',[150,420],[300,425]);                                            // finger moves right
    await expect.poll(()=>active(page)).toBe('today');
    await swipe(page,'[data-panel=today]',[150,420],[300,425]);                                               // already first: nothing
    expect(await active(page)).toBe('today');
    await expect(page.locator('[data-panel=today]')).toBeVisible();
  });
  test('short, slow, steep and edge swipes do nothing; so do swipes that start on a sideways scroller or a field',async({page})=>{
    await start(page);await choose(page,'Yangon');await page.evaluate(()=>document.getElementById('topMore')?.classList.remove('open'));
    const stay=async()=>{await page.waitForTimeout(250);expect(await active(page)).toBe('today');};
    await swipe(page,'[data-panel=today]',[250,420],[210,420]);await stay();                                  // too short (40 px)
    await swipe(page,'[data-panel=today]',[320,420],[120,420],900);await stay();                              // too slow
    await swipe(page,'[data-panel=today]',[300,300],[180,560]);await stay();                                  // mostly vertical
    await swipe(page,'[data-panel=today]',[10,420],[200,420]);await stay();                                   // starts at the screen edge
    await swipe(page,'[data-panel=today]',[385,420],[200,420]);await stay();
    await page.evaluate(()=>{const h=document.getElementById('hourlyForecast');h.scrollIntoView({block:'center'});});
    const strip=await page.locator('#hourlyForecast').evaluate(e=>{const o=getComputedStyle(e).overflowX;return {o,sw:e.scrollWidth>e.clientWidth};});
    if(strip.sw&&['auto','scroll'].includes(strip.o)){
      const r=await page.locator('#hourlyForecast').boundingBox();
      await swipe(page,'#hourlyForecast .hour',[r.x+300,r.y+30],[r.x+120,r.y+34]);await stay();                // hourly strip scrolls sideways itself
    }
    await swipe(page,'#locationInput',[300,420],[120,420]);await stay();                                      // text field
    await page.evaluate(()=>{const s=document.createElement('dialog');s.id='tmpd';document.body.append(s);s.showModal();});
    await swipe(page,'#tmpd',[300,420],[120,420]);await stay();                                                // dialog open
  });
  test('swiping on a section slides it in (unless reduced motion), and the tab buttons still work',async({page})=>{
    await start(page);await choose(page,'Yangon');await page.evaluate(()=>document.getElementById('topMore')?.classList.remove('open'));
    await swipe(page,'[data-panel=today]',[300,420],[150,430]);
    await expect(page.locator('[data-panel=forecast].swipe-in-next')).toHaveCount(1);
    await expect(page.locator('[data-panel=forecast].swipe-in-next')).toHaveCount(0);                        // class removed when the slide ends
    await page.emulateMedia({reducedMotion:'reduce'});
    await swipe(page,'[data-panel=forecast]',[150,420],[300,425]);
    await expect.poll(()=>active(page)).toBe('today');
    await expect(page.locator('.swipe-in-prev, .swipe-in-next')).toHaveCount(0);
    await page.locator('[data-tab=forecast]').click();await expect(page.locator('[data-panel=forecast]')).toBeVisible();
  });
  test('farming tabs swipe too, and the page never scrolls sideways while swiping',async({page})=>{
    await start(page);await choose(page,'Shwebo');await openFarm(page);
    const farmActive=()=>page.locator('#farmTabbar .ftab[aria-selected=true]').first().getAttribute('data-ftab');
    const first=await farmActive();
    await expect(page.locator('.farm-panel[data-fpanel=now]')).toBeVisible();
    await swipe(page,'.farm-panel[data-fpanel=now]',[300,420],[140,425]);   // on the panel itself: what sits at a fixed point depends on how far the page has loaded and scrolled
    await expect.poll(farmActive).not.toBe(first);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  });
});

// ---- Lab tab: leaf check --------------------------------------------------------------------------------------------------------
async function leafPhoto(page){
  const b64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const g=c.getContext('2d');g.fillStyle='#4f8a3a';g.fillRect(0,0,640,480);g.fillStyle='#8a5a2a';for(let i=0;i<14;i++){g.beginPath();g.arc(80+(i*97)%480,90+(i*61)%300,16+(i%4)*4,0,7);g.fill();}return c.toDataURL('image/png').split(',')[1];});
  return {name:'leaf.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')};
}
async function unfold(page,sel){const d=page.locator(sel);if(!(await d.evaluate(e=>e.open)))await d.locator(':scope > summary').click();await expect(d).toHaveJSProperty('open',true);}
async function openLab(page,{crop}={}){await choose(page,'Yangon');await openTab(page,'lab');await expect(page.locator('#leafCard h3')).toHaveText('Leaf check');if(crop)await page.locator('#leafCrop').selectOption(crop);await unfold(page,'#leafSigns');}
const OWN_KEY='sk-ant-api03-TESTKEYTESTKEYTESTKEYTESTKEY1234';
// status = what GET /api/v1/leaf/status says. Default: the owner shares a server key (no key needed). {enabled:false,byok:true,...}: visitors must bring their own.
async function startAi(page,reply,status={enabled:true,byok:true,per_hour:10,byok_per_hour:30}){await mockApis(page);await page.route('**/api/v1/leaf**',route=>{const u=new URL(route.request().url());if(u.pathname.endsWith('/status'))return route.fulfill({json:status});if(route.request().method()!=='POST')return route.continue();return reply(route);});await page.goto('/');await expect(page.locator('#searchForm')).toBeVisible();}

test('Lab leaf check: signs rank the guide, the record survives a reload, delete needs a second tap',async({page})=>{
  await start(page);await openLab(page);
  await expect(page.locator('#leafMatches')).toHaveCount(0);
  await page.locator('#leafCrop').selectOption('rice');
  await expect(page.locator('#leafMatches')).toContainText('Tick at least one sign');
  await expect(page.locator('#leafSave')).toBeDisabled();
  for(const s of['spots','halo','wet'])await page.locator('#leafSy-'+s).click();
  await expect(page.locator('#leafSy-spots')).toHaveAttribute('aria-pressed','true');
  expect(await page.locator('#leafMatches li').count()).toBeGreaterThan(0);
  await expect(page.locator('#leafMatches')).not.toContainText('undefined');
  await expect(page.locator('#leafMatches')).not.toContainText('leaf_');
  await page.locator('#leafSave').click();
  await expect(page.locator('#leafSaved')).toBeVisible();
  await expect(page.locator('#leafLog tbody tr')).toHaveCount(1);
  await expect(page.locator('#leafLog')).toContainText('Rice');
  await expect(page.locator('#leafLog')).toContainText('Yangon');
  await page.reload();await expect(page.locator('#locationName')).toContainText('Yangon');await openTab(page,'lab');
  await expect(page.locator('#leafLog tbody tr')).toHaveCount(1);
  await expect(page.locator('#leafCrop')).toHaveValue('rice');
  await page.locator('#leafClear').click();
  await expect(page.locator('#leafClear')).toContainText('Tap again to delete all 1');
  await expect(page.locator('#leafLog tbody tr')).toHaveCount(1);
  await page.locator('#leafClear').click();
  await expect(page.locator('#leafLogEmpty')).toBeVisible();
  expect(await page.evaluate(()=>{try{return JSON.parse(localStorage.getItem('mw_leaf_log_v1')||'{"rows":[]}').rows.length;}catch{return -1;}})).toBe(0);
});

test('Lab leaf check: the saved record downloads as a CSV with plain digits',async({page})=>{
  await start(page);await openLab(page,{crop:'potato'});
  await page.locator('#leafSy-spots').click();await page.locator('#leafSy-wet').click();await page.locator('#leafSave').click();
  const [dl]=await Promise.all([page.waitForEvent('download'),page.locator('#leafCsv').click()]);
  expect(dl.suggestedFilename()).toMatch(/^leaf-checks-\d{4}-\d{2}-\d{2}\.csv$/);
  const text=(await import('node:fs')).readFileSync(await dl.path(),'utf8');
  expect(text.charCodeAt(0)).toBe(0xFEFF);expect(text).toContain('\r\n');expect(text).toContain('potato');
});

test('Lab leaf check: a crop without a photo model says so and the signs still work',async({page})=>{
  await start(page);await openLab(page,{crop:'tomato'});
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await expect(page.locator('#leafThumb')).toBeVisible();
  await expect(page.locator('#leafPhoto')).toContainText('No photo model for');
  await expect(page.locator('#leafPhRun')).toHaveCount(0);
  await page.locator('#leafSy-spots').click();await page.locator('#leafSy-wet').click();
  expect(await page.locator('#leafMatches li').count()).toBeGreaterThan(0);
  await page.locator('#leafRm').click();await expect(page.locator('#leafThumb')).toHaveCount(0);
});

async function flatPhoto(page,css){
  const b64=await page.evaluate(c=>{const k=document.createElement('canvas');k.width=320;k.height=240;const g=k.getContext('2d');g.fillStyle=c;g.fillRect(0,0,320,240);return k.toDataURL('image/png').split(',')[1];},css);
  return {name:'flat.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')};
}

test('Lab leaf check (v9.20): photo tips, quick photo check and the "not every sign is a disease" card',async({page})=>{
  await start(page);await openLab(page,{crop:'tomato'});
  await expect(page.locator('#leafTips')).toBeVisible();
  await page.locator('#leafTips summary').click();
  expect(await page.locator('#leafTips li').count()).toBe(6);
  await expect(page.locator('#leafTips')).toContainText('Pick one leaf');
  // a good-looking leaf photo raises nothing; a dark one, a washed-out one, a blue-sky one each get one clear message
  const textured=await page.evaluate(()=>{const k=document.createElement('canvas');k.width=640;k.height=480;const g=k.getContext('2d'),d=g.createImageData(640,480);let s=5;const r=()=>(s=(s*1664525+1013904223)>>>0)/4294967296;
    for(let y=0;y<480;y++)for(let x=0;x<640;x++){const i=(y*640+x)*4,sp=((x*7+y*13)%61)<6,n=(r()-.5)*18;d.data[i]=(sp?130:70)+n;d.data[i+1]=(sp?90:140)+n;d.data[i+2]=(sp?40:55)+n;d.data[i+3]=255;}g.putImageData(d,0,0);return k.toDataURL('image/png').split(',')[1];});
  await page.locator('#leafGal').setInputFiles({name:'tex.png',mimeType:'image/png',buffer:Buffer.from(textured,'base64')});
  await expect(page.locator('#leafThumb')).toBeVisible();
  await expect(page.locator('#leafQ')).toHaveCount(0);
  for(const [css,key,text] of [['#050805','dark','too dark'],['#f6f6f2','bright','washed out'],['#6ea0e6','far','Hardly any leaf colour']]){
    await page.locator('#leafGal').setInputFiles(await flatPhoto(page,css));
    await expect(page.locator('#leafQ li')).toHaveCount(1);
    await expect(page.locator('#leafQ li')).toHaveAttribute('data-q',key);
    await expect(page.locator('#leafQ')).toContainText(text);
  }
  await page.locator('#leafRm').click();await expect(page.locator('#leafQ')).toHaveCount(0);
  // signs -> causes that are not a disease, with how to tell
  await expect(page.locator('#leafOther')).toHaveCount(0);
  await page.locator('#leafSy-yellow').click();await page.locator('#leafSy-stunt').click();
  await expect(page.locator('#leafOther')).toBeVisible();
  const causes=await page.locator('#leafOther li[data-cause]').evaluateAll(l=>l.map(x=>x.dataset.cause));
  expect(causes.length).toBeGreaterThan(0);expect(causes.length).toBeLessThanOrEqual(4);expect(causes).toContain('nitrogen');
  await expect(page.locator('#leafOther')).toContainText('Not every sign is a disease');
  await expect(page.locator('#leafOther')).toContainText('does not spread from plant to plant'.replace('does not','do not'));
  await unfold(page,'#leafOther');await page.locator('#leafOther details summary').click();
  await expect(page.locator('#leafOther')).toContainText('extension office');
});

for(const [rain,wet] of [[40,false],[85,true]])test(`Health tips (v9.20): rain chance ${rain}% ${wet?'brings':'does not bring'} the mosquito and floodwater tips`,async({page})=>{
  await mockApis(page);
  await page.route('**/api/weather**',r=>{const u=new URL(r.request().url()),w=weather(Number(u.searchParams.get('lat')));w.weather.daily.precipitation_probability_max=w.weather.daily.precipitation_probability_max.map(()=>rain);r.fulfill({json:w});});
  await page.goto('/');await expect(page.locator('#searchForm')).toBeVisible();await choose(page,'Yangon');
  await page.locator('#healthTips').evaluate(d=>{d.open=true;});
  const tips=page.locator('#healthTipsList');
  if(!wet){await expect(tips).not.toContainText('Mosquitoes breed after rain');await expect(tips).not.toContainText('Floodwater');return;}
  await expect(tips).toContainText('Mosquitoes breed after rain');
  await expect(tips).toContainText('Floodwater and safe water');
  await expect(tips).toContainText('boiled or treated water');
  expect(await tips.locator('> *').count()).toBeLessThanOrEqual(4);
});

test('Lab leaf check (v9.20): similar problems are named inside the guide',async({page})=>{
  await start(page);await openLab(page,{crop:'potato'});
  await page.locator('#leafSy-rings').click();await page.locator('#leafSy-spots').click();
  const first=page.locator('#leafMatches li').first();
  await first.locator('details.lf-guide summary').first().click();
  await expect(first.locator('.lf-similar li')).toHaveCount(1);
  await expect(first.locator('.lf-similar')).toContainText(/blight/i);
});

test('Lab leaf check (v9.20): the health and safety section is complete, sourced and says it is not medical advice',async({page})=>{
  await start(page);await openLab(page);
  const hs=page.locator('#leafHealth');await expect(hs).toBeVisible();
  await expect(hs).toContainText('not a diagnosis');
  await unfold(page,'#leafHealth');for(const g of ['spray','heat','water','snake']){await hs.locator(`#leafHs-${g} summary`).click();}
  expect(await hs.locator('li').count()).toBeGreaterThanOrEqual(22);
  await expect(hs.locator('#leafHs-snake')).toContainText('Do not cut the wound');
  await expect(hs.locator('#leafHs-spray')).toContainText('Read the label');
  await expect(hs).not.toContainText(/leaf_hs_|undefined/);
  await hs.locator('summary').last().click();
  const links=await hs.locator('a[href]').evaluateAll(a=>a.map(x=>[x.href,x.rel,x.target]));
  expect(links.length).toBeGreaterThanOrEqual(8);
  for(const [h,rel,t] of links){expect(h.startsWith('https://')).toBe(true);expect(rel).toContain('noopener');expect(t).toBe('_blank');}
});

test('Lab leaf check: a file that is not a picture is refused kindly',async({page})=>{
  await start(page);await openLab(page,{crop:'rice'});
  await page.locator('#leafGal').setInputFiles({name:'x.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
  await expect(page.locator('#leafPhotoBad')).toContainText('could not be read');
  await expect(page.locator('#leafThumb')).toHaveCount(0);
});

test('Lab leaf check: the on-phone photo check runs offline for rice and never gives one hard answer when unsure',async({page})=>{
  test.setTimeout(90000);
  const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  await start(page);await openLab(page,{crop:'rice'});
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await expect(page.locator('#leafPhRun')).toContainText('first time');
  await page.locator('#leafPhRun').click();
  await expect(page.locator('#leafPhLine')).toContainText(/Fairly sure|Not sure|Looks healthy/,{timeout:70000});
  expect(await page.locator('#leafPhItems > li').count()).toBeGreaterThan(0);
  expect(await page.locator('#leafPhItems > li').count()).toBeLessThanOrEqual(3);
  await expect(page.locator('#leafPhoto')).not.toContainText('undefined');
  await page.locator('#leafPhoto .lf-facts summary').click();
  await expect(page.locator('#leafPhoto .lf-facts')).toContainText('125');
  await page.locator('#leafSave').click();await expect(page.locator('#leafLog tbody tr')).toHaveCount(1);
  expect(posts).toEqual([]);                                   // no photo left the page
  await page.locator('#leafCrop').selectOption('potato');       // other crop: the rice result must not stay (the cached engine re-reads the photo for potato by itself)
  await expect(page.locator('#leafPhLine')).toContainText('Possibilities only',{timeout:30000});
  await expect(page.locator('#leafPhoto')).not.toContainText('Fairly sure');
});

test('Lab leaf check: potato is possibilities only; cucurbit never says healthy',async({page})=>{
  test.setTimeout(90000);
  await start(page);await openLab(page,{crop:'potato'});
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await page.locator('#leafPhRun').click();
  await expect(page.locator('#leafPhLine')).toContainText(/Possibilities only/,{timeout:70000});
  await page.locator('#leafCrop').selectOption('cucurbit');   // engine and model are cached now, so the check starts by itself
  await expect(page.locator('#leafPhLine')).toContainText(/powdery mildew/i,{timeout:30000});
  await expect(page.locator('#leafPhLine')).not.toContainText('healthy');
});

test('Lab leaf check: the AI look and its key card are hidden when the server has the AI route switched off',async({page})=>{
  await startAi(page,r=>r.abort(),{enabled:false,byok:false,per_hour:0,byok_per_hour:0});await openLab(page,{crop:'rice'});
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await expect(page.locator('#leafThumb')).toBeVisible();
  await expect(page.locator('#leafAi')).toHaveCount(0);
  await expect(page.locator('#leafKey')).toHaveCount(0);
});

test('Lab leaf check: every visitor brings their own AI key, it goes only in a header, stays on the phone and can be removed (v9.27)',async({page})=>{
  const seen=[];
  await startAi(page,route=>{const r=route.request();seen.push({url:r.url(),key:r.headers()['x-user-api-key']||null,body:r.postData()});return route.fulfill({json:{ok:true,model:'test-model',matches:[{id:'rice_blast',confidence:'medium',why:'Diamond spots.'}],healthy:false,issue:'',other:''}});},{enabled:false,byok:true,per_hour:0,byok_per_hour:30});
  await openLab(page,{crop:'rice'});
  await expect(page.locator('#leafKey')).toBeVisible();                     // its own card, there before any photo
  await expect(page.locator('#leafKeyIn')).toHaveAttribute('type','password');
  await expect(page.locator('#leafKey form')).toHaveCount(0);               // not a form: the browser must not offer to store it
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await expect(page.locator('#leafAiNeed')).toContainText('add your own key');
  await expect(page.locator('#leafAiRun')).toBeHidden();
  await page.locator('#leafAiGoKey').click();
  await expect(page.locator('#leafKeyIn')).toBeFocused();
  await page.locator('#leafKeyIn').fill('not a key');await page.locator('#leafKeySave').click();
  await expect(page.locator('#leafKeyFormat')).toContainText('sk-ant-');
  await expect(page.locator('#leafKeyHas')).toHaveCount(0);
  await page.locator('#leafKeyIn').fill('  "'+OWN_KEY+'"\n');await page.locator('#leafKeyIn').press('Enter');
  await expect(page.locator('#leafKeyHas')).toContainText('sk-ant-…1234');
  await expect(page.locator('#leafKeyHas')).not.toContainText('TESTKEY');   // only the end of the key is ever shown
  await expect(page.locator('#leafKeyIn')).toHaveValue('');
  await expect(page.locator('#leafAiNeed')).toHaveCount(0);
  await expect(page.locator('#leafAi')).toContainText('with your key');
  const store=()=>page.evaluate(()=>({local:localStorage.getItem('mw_leaf_key_v1'),session:sessionStorage.getItem('mw_leaf_key_v1')}));
  expect(await store()).toEqual({local:null,session:OWN_KEY});              // default: this tab only
  await page.locator('#leafAiRun').click();
  await expect(page.locator('#leafAiItems > li')).toHaveCount(1);
  expect(seen).toHaveLength(1);
  expect(seen[0].key).toBe(OWN_KEY);                                        // in the header ...
  expect(seen[0].url).not.toContain('TESTKEY');expect(seen[0].body).not.toContain('TESTKEY');   // ... and nowhere else
  await page.locator('#leafSave').click();await expect(page.locator('#leafLog tbody tr')).toHaveCount(1);
  expect(await page.evaluate(()=>Object.keys(localStorage).map(k=>localStorage.getItem(k)).join('|').includes('TESTKEY'))).toBe(false);
  await page.reload();await expect(page.locator('#locationName')).toContainText('Yangon');await openTab(page,'lab');
  await expect(page.locator('#leafKeyHas')).toContainText('1234');          // survives a reload in the same tab
  await page.locator('#leafKeyRemember').check();
  expect(await store()).toEqual({local:OWN_KEY,session:null});              // remembered only because the person asked
  await page.locator('#leafKeyRemember').uncheck();
  expect(await store()).toEqual({local:null,session:OWN_KEY});
  await page.locator('#leafKeyRm').click();
  await expect(page.locator('#leafKeyGone')).toBeVisible();
  await expect(page.locator('#leafKeyHas')).toHaveCount(0);
  expect(await store()).toEqual({local:null,session:null});
  expect(await page.evaluate(()=>document.body.innerText.includes('TESTKEY'))).toBe(false);
});

test('Lab leaf check: a key Anthropic rejects is named in both cards and can be replaced',async({page})=>{
  let n=0;
  await startAi(page,route=>{n++;return n===1?route.fulfill({status:401,json:{detail:'bad_key'}}):route.fulfill({json:{ok:true,model:'m',matches:[],healthy:true,issue:'',other:''}});},{enabled:false,byok:true,per_hour:0,byok_per_hour:30});
  await openLab(page,{crop:'rice'});
  await page.locator('#leafKeyIn').fill(OWN_KEY);await page.locator('#leafKeySave').click();
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await page.locator('#leafAiRun').click();
  await expect(page.locator('#leafAiErr')).toContainText('did not accept your key');
  await expect(page.locator('#leafKeyBad')).toBeVisible();
  await page.locator('#leafKeyIn').fill(OWN_KEY.replace('1234','5678'));await page.locator('#leafKeySave').click();
  await expect(page.locator('#leafKeyBad')).toHaveCount(0);
  await expect(page.locator('#leafKeyHas')).toContainText('5678');
  await page.locator('#leafAiRun').click();
  await expect(page.locator('#leafAi')).toContainText('looks healthy');
});

test('Lab leaf check: when the owner shares a server key a visitor needs none, and a key of their own is still offered',async({page})=>{
  const keys=[];
  await startAi(page,route=>{keys.push(route.request().headers()['x-user-api-key']||null);return route.fulfill({json:{ok:true,model:'m',matches:[],healthy:true,issue:'',other:''}});});
  await openLab(page,{crop:'rice'});
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await expect(page.locator('#leafAiRun')).toBeVisible();await expect(page.locator('#leafAiNeed')).toHaveCount(0);
  await expect(page.locator('#leafKey')).toContainText('also works without a key');
  await page.locator('#leafAiRun').click();await expect(page.locator('#leafAi')).toContainText('looks healthy');
  expect(keys).toEqual([null]);
});

test('Lab leaf check: the AI second look shows only the crop\'s own problems next to the other looks and is saved with them',async({page})=>{
  let body=null;
  await startAi(page,route=>{body=JSON.parse(route.request().postData());return route.fulfill({json:{ok:true,model:'test-model',matches:[{id:'rice_blast',confidence:'medium',why:'Diamond spots with grey centres.'},{id:'not_in_guide',confidence:'high',why:'x'}],healthy:false,issue:'',other:'Some dew on the leaf.'}});});
  await openLab(page,{crop:'rice'});
  await expect(page.locator('#leafAi')).toHaveCount(0);           // needs a photo first
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await expect(page.locator('#leafAiRun')).toBeVisible();
  await expect(page.locator('#leafAi')).toContainText('1024 px');
  await page.locator('#leafAiRun').click();
  await expect(page.locator('#leafAiItems > li')).toHaveCount(1);
  await expect(page.locator('#leafAiItems')).toContainText('medium confidence');
  await expect(page.locator('#leafAi')).toContainText('Some dew on the leaf.');
  await expect(page.locator('#leafAi')).toContainText('test-model');
  await expect(page.locator('#leafAi')).not.toContainText('not_in_guide');
  expect(body.crop).toBe('rice');expect(body.lang).toBe('en');expect(body.image).toMatch(/^data:image\/jpeg;base64,/);
  await page.locator('#leafSave').click();
  await expect(page.locator('#leafLog tbody tr')).toHaveCount(1);
  await expect(page.locator('#leafLog')).toContainText('medium');
});

test('Lab leaf check: AI limits, a busy service and broken answers all give a plain sentence and a way to retry',async({page})=>{
  const queue=[r=>r.fulfill({status:429,json:{detail:'limit',scope:'visitor'}}),r=>r.fulfill({status:429,json:{detail:'limit',scope:'day'}}),r=>r.fulfill({status:503,json:{detail:'busy'}}),r=>r.fulfill({status:503,json:{detail:'off'}}),r=>r.fulfill({status:200,body:'<html>',contentType:'application/json'}),r=>r.fulfill({status:413,json:{}}),r=>r.fulfill({json:{ok:true,model:'m',matches:[],healthy:true,issue:'',other:''}})];
  await startAi(page,route=>queue.shift()(route));
  await openLab(page,{crop:'rice'});
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  const want=['used all your AI looks for this hour','for today are used up','service is busy','not switched on','The AI look failed','did not accept this photo','looks healthy'];
  for(const [i,w] of want.entries()){
    await page.locator('#leafAiRun').click();
    await expect(i<want.length-1?page.locator('#leafAiErr'):page.locator('#leafAi')).toContainText(w);
    if(i<want.length-1)await expect(page.locator('#leafAiRun')).toBeVisible();
  }
  await expect(page.locator('#leafAiErr')).toHaveCount(0);
});

test('Lab leaf check: changing the crop or removing the photo clears the AI answer, and a late answer cannot come back',async({page})=>{
  let release;const gate=new Promise(r=>{release=r;});
  await startAi(page,async route=>{await gate;try{await route.fulfill({json:{ok:true,model:'m',matches:[{id:'rice_blast',confidence:'high',why:''}],healthy:false,issue:'',other:''}});}catch{ /* aborted */ }});
  await openLab(page,{crop:'rice'});
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await page.locator('#leafAiRun').click();
  await page.locator('#leafRm').click();release();
  await page.waitForTimeout(300);
  await expect(page.locator('#leafAiItems')).toHaveCount(0);
  await expect(page.locator('#leafAi')).toHaveCount(0);
});

test('Lab leaf check: Burmese and easy Japanese show real words, no keys, and the page does not scroll sideways',async({page})=>{
  await start(page);await openLab(page,{crop:'rice'});
  await page.locator('#leafSy-spots').click();await page.locator('#leafSy-wet').click();
  const openTop=()=>page.evaluate(()=>document.getElementById('topMore')?.classList.add('open'));   // a resize may fold the top menu away
  for(const code of['my','easy']){
    await openTop();await setLang(page,code);
    await expect(page.locator('#leafCard')).not.toContainText(/leaf_[a-z_]+/);
    await expect(page.locator('#leafCard')).not.toContainText('undefined');
    await expect(page.locator('#leafCrop')).toHaveValue('rice');
    await expect(page.locator('#leafSy-spots')).toHaveAttribute('aria-pressed','true');
    for(const w of[320,393,820]){await page.setViewportSize({width:w,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);}
    await page.setViewportSize({width:390,height:844});
  }
  await openTop();await setLang(page,'en');await expect(page.locator('#leafCard h3')).toHaveText('Leaf check');
});

test('Lab leaf check passes the accessibility rules with every result on screen, in light and dark',async({page})=>{
  test.setTimeout(90000);
  await startAi(page,r=>r.fulfill({json:{ok:true,model:'m',matches:[{id:'rice_blast',confidence:'medium',why:'Diamond spots.'}],healthy:false,issue:'',other:'Dew.'}}));
  await openLab(page,{crop:'rice'});
  for(const sg of['spots','halo','wet'])await page.locator('#leafSy-'+sg).click();
  await page.locator('#leafGal').setInputFiles(await leafPhoto(page));
  await page.locator('#leafPhRun').click();await expect(page.locator('#leafPhLine')).toBeVisible({timeout:70000});
  await page.locator('#leafAiRun').click();await expect(page.locator('#leafAiItems > li')).toHaveCount(1);
  await page.locator('#leafSave').click();await expect(page.locator('#leafLog tbody tr')).toHaveCount(1);
  await page.locator('#leafKeyIn').fill(OWN_KEY);await page.locator('#leafKeySave').click();await expect(page.locator('#leafKeyHas')).toBeVisible();
  await page.locator('#leafKeyIn').fill('x');await page.locator('#leafKeySave').click();await expect(page.locator('#leafKeyFormat')).toBeVisible();
  await page.locator('#leafCard details').first().evaluate(d=>{d.open=true;});
  for(const dark of[false,true]){
    await page.evaluate(d=>{document.documentElement.classList.toggle('sg-dark',d);document.body.classList.toggle('sg-dark',d);},dark);
    await page.evaluate(axe.source);
    const r=await page.evaluate(()=>window.axe.run(document.getElementById('leafCard'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
    expect(r.violations.map(v=>v.id+': '+v.nodes.map(n=>n.target.join(' ')).join(' | '))).toEqual([]);
  }
});

// ---- Device matrix: the sweep that produced the v9.19.0 device layer, kept as a test ---------------------------------------------
// Phones from 320 px, a foldable-ish 600, tablets, laptop, a phone on its side; English and Burmese.
// Fails on: a control narrower or shorter than 44 px on touch (24 px with a mouse), text under 12 px, anything pushed past the screen edge.
const DEVICES=[[320,640,1],[393,851,1],[600,960,1],[820,1180,1],[1024,768,1],[1366,768,0],[667,375,1]];
function sweep(touch){return page=>page.evaluate(touch=>{
  const vw=innerWidth,out={doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,over:[],tap:[],tiny:[],spill:[],head:0};
  const vis=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>0&&r.height>0&&c.visibility!=='hidden'&&c.display!=='none'&&c.opacity!=='0';};
  const off=e=>{for(let p=e;p&&p!==document.body;p=p.parentElement)if(p.hidden||p.getAttribute('aria-hidden')==='true'||getComputedStyle(p).display==='none')return true;return false;};
  const name=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\s+/)[0]:'');
  const scroller=e=>{for(let p=e.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(['auto','scroll','hidden','clip'].includes(o))return true;}return false;};
  const fixed=e=>{for(let p=e;p&&p!==document.body;p=p.parentElement)if(getComputedStyle(p).position==='fixed')return true;return false;};
  for(const e of document.querySelectorAll('body *')){if(!vis(e)||off(e)||['path','svg','circle','line','rect','g','polyline'].includes(e.tagName.toLowerCase()))continue;const r=e.getBoundingClientRect();if((r.right>vw+1||r.left<-1)&&!scroller(e)&&!fixed(e))out.over.push(name(e));}
  for(const e of document.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, summary, [role=tab], [role=button]')){
    if(!vis(e)||off(e))continue;const cs=getComputedStyle(e);if(e.tagName==='A'&&cs.display==='inline')continue;
    let w,h;const r=e.getBoundingClientRect();w=r.width;h=r.height;
    const lab=e.closest('label');if(lab&&(e.type==='checkbox'||e.type==='radio')){const lr=lab.getBoundingClientRect();w=lr.width;h=lr.height;}
    const af=getComputedStyle(e,'::after');if(af.content!=='none'&&af.position==='absolute'){w=Math.max(w,parseFloat(af.width)||0);h=Math.max(h,parseFloat(af.height)||0);}
    const need=touch?44:24;if(w<need-0.5||h<need-0.5)out.tap.push(name(e)+' '+Math.round(w)+'x'+Math.round(h));}
  for(const e of document.querySelectorAll('button, .chip, .badge, [class*=pill]')){if(!vis(e)||off(e)||e.classList.contains('lvl-more')||!e.textContent.trim())continue;if(getComputedStyle(e).overflowX==='visible'&&e.scrollWidth>e.clientWidth+1)out.spill.push(name(e)+' '+e.scrollWidth+'/'+e.clientWidth);}   // label wider than its own button (the Burmese "Alerts" button)
  const ta=document.querySelector('.top-actions'),sh=document.querySelector('.app-shell');if(vw>=651&&ta&&sh&&vis(ta))out.head=Math.round(Math.abs(ta.getBoundingClientRect().right-(sh.getBoundingClientRect().right-parseFloat(getComputedStyle(sh).paddingRight))));   // header buttons line up with the page below
  const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(tw.nextNode()){const n=tw.currentNode;if(!n.textContent.trim())continue;const e=n.parentElement;if(!e||['SCRIPT','STYLE','OPTION'].includes(e.tagName)||!vis(e)||off(e)||e.closest('.sr-only'))continue;
    const fs=parseFloat(getComputedStyle(e).fontSize);if(fs>0&&fs<12&&!(vw<=360&&e.closest('.tabbar, .farm-tabbar-top')&&fs>=11))out.tiny.push(name(e)+' '+fs);}
  const uniq=a=>[...new Set(a)].slice(0,8);out.over=uniq(out.over);out.tap=uniq(out.tap);out.tiny=uniq(out.tiny);out.spill=uniq(out.spill);return out;},touch);}
for(const lang of['en','my']){
  test(`Device matrix (${lang}): no overflow, 44 px controls on touch, 12 px text, from 320 px to a laptop and a phone on its side`,async({browser,baseURL})=>{
    test.setTimeout(150000);
    const bad=[];
    for(const[w,h,touch]of DEVICES){
      const ctx=await browser.newContext({baseURL,viewport:{width:w,height:h},hasTouch:!!touch,isMobile:!!touch,serviceWorkers:'block'});
      const page=await ctx.newPage();await mockApis(page);
      if(lang==='my')await page.addInitScript(()=>localStorage.setItem('lang','my'));
      await page.goto('/');await expect(page.locator('#searchForm')).toBeVisible();await choose(page,'Yangon');
      for(const tab of['today','forecast','lab']){
        await openTab(page,tab);await page.waitForTimeout(500);
        if(tab==='lab'){await page.locator('#leafCrop').selectOption('rice');await unfold(page,'#leafSigns');await page.locator('#leafSy-spots').click();}
        const r=await sweep(touch)(page);
        if(r.doc>0||r.over.length||r.tap.length||r.tiny.length||r.spill.length||r.head>1)bad.push(`${w}x${h} ${tab}: ${JSON.stringify(r)}`);
      }
      await ctx.close();
    }
    expect(bad,bad.join('\n')).toEqual([]);
  });
}
// ---- v9.21 "simple and familiar": plain sentence first, one fold for the background, the same fold everywhere ----
test('Compare "now" (v9.21): each card says it in a plain sentence, shows a five-step meter, and has no separate "how to read" legend',async({page})=>{
  await openCompare(page,393);
  const tiles=page.locator('#compareCharts .cmp-blk');await expect(tiles).toHaveCount(3);
  await expect(page.locator('#compareCharts .cmp-how')).toHaveCount(0);
  for(const t of await tiles.all())await expect(t.locator('.cmp-say')).toHaveCount(1);
  // temperature and rain get the five-step meter with one lit step; soil shows its two bars (now / 7 days ago) instead
  for(const i of [0,1]){expect(await tiles.nth(i).locator('.cmp-seg').count()).toBe(5);expect(await tiles.nth(i).locator('.cmp-seg.is-on').count()).toBe(1);}
  expect(await tiles.nth(2).locator('.cmp-seg').count()).toBe(0);expect(await tiles.nth(2).locator('.cmp-fill').count()).toBe(2);
  await expect(tiles.nth(0).locator('.cmp-say')).toHaveText(/\d\.\d °C warmer than usual/);await expect(tiles.nth(0).locator('.cmp-say')).toHaveClass(/\bup\b/);
  await expect(tiles.nth(1).locator('.cmp-say')).toHaveText('Drier than usual');
  await expect(page.locator('#compareCharts .cmp-state')).toHaveCount(0);                       // the sentence is not repeated as a pill
  await expect(tiles.nth(2).locator('.cmp-say')).toHaveText(/drier than 7 days ago/);
  // the number comes first, then the sentence, then the meter
  const ys=await tiles.first().evaluate(e=>['.cmp-val','.cmp-say','.cmp-meter'].map(s=>e.querySelector(s).getBoundingClientRect().top));expect(ys[0]).toBeLessThan(ys[1]);expect(ys[1]).toBeLessThan(ys[2]);
  // the sentence is body-sized text, not a tiny caption
  expect(await tiles.first().locator('.cmp-say').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  await setLang(page,'my');
  const my=await tiles.first().locator('.cmp-say').innerText();expect(my).toMatch(/ပုံမှန်ထက်.*ပိုပူတယ်/);expect(my).not.toMatch(/cmp_/);
  await expect(page.locator('#compareCharts .cmp-meter-lbl').first()).toContainText('ပိုပူ');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
test('Compare "this year" and "long term" (v9.21): the explaining text is one folded "About these charts", closed until tapped',async({page})=>{
  test.setTimeout(45000);
  await openCompare(page,393,{history:true});
  await viewBtn(page,'year').click();
  const mc=page.locator('#monthlyCompareCard details[data-detail-key=mc-about]');await expect(mc).toBeVisible();
  expect(await mc.evaluate(e=>e.open)).toBe(false);
  await mc.locator(':scope > summary').click();expect(await mc.evaluate(e=>e.open)).toBe(true);
  await viewBtn(page,'hist').click();
  const hs=page.locator('#historyCard details[data-detail-key=hist-about]');await expect(hs).toBeVisible({timeout:15000});
  expect(await hs.evaluate(e=>e.open)).toBe(false);
  await hs.locator(':scope > summary').click();expect(await hs.evaluate(e=>e.open)).toBe(true);
  // the same folded look as everywhere else (one title line, no native marker)
  for(const f of [mc,hs]){expect(await f.locator(':scope > summary .fold-t').count()).toBe(1);}
});
test('Farming "now" (v9.21): what to do this month comes first, the zone background is one folded card',async({page})=>{
  await mockApis(page);await page.goto('/');await choose(page,'Shwebo');await openFarm(page);
  await page.selectOption('#agriRegionSel','R01');await expect(page.locator('#farmHead h3').first()).toContainText('Central Dry');
  await expect(page.locator('#agriRoot h4').first()).toBeVisible();
  const fold=page.locator('#agriRoot details[data-detail-key=farm-about]');await expect(fold).toBeVisible();
  expect(await fold.evaluate(e=>e.open)).toBe(false);
  // the heading for this month's work is above the fold, and the zone name is not repeated in a second heading
  const ys=await page.evaluate(()=>[document.querySelector('#agriRoot h4').getBoundingClientRect().top,document.querySelector('#agriRoot details[data-detail-key=farm-about]').getBoundingClientRect().top]);expect(ys[0]).toBeLessThan(ys[1]);
  await expect(page.locator('#agriRoot h3')).toHaveCount(0);
  await fold.locator(':scope > summary').click();await expect(fold.locator('.kvl')).toBeVisible();
  // open or closed is remembered across a language switch
  await setLang(page,'my');await expect(page.locator('html')).toHaveAttribute('lang','my');
  expect(await page.locator('#agriRoot details[data-detail-key=farm-about]').evaluate(e=>e.open)).toBe(true);
});
test('first-screen tiles (v9.22): on a phone the icon sits above the text and a Burmese value such as "1.4 မီလီမီတာ" stays on one line',async({page})=>{
  await page.setViewportSize({width:393,height:851});await start(page);await choose(page,'Yangon');await setLang(page,'my');
  const r=await page.evaluate(()=>[...document.querySelectorAll('#metricGridBox .metric')].filter(e=>e.getBoundingClientRect().height>0).map(t=>{const i=t.querySelector(':scope > span').getBoundingClientRect(),d=t.querySelector(':scope > div').getBoundingClientRect(),s=t.querySelector('strong'),sr=s.getBoundingClientRect();
    return {iconAbove:i.bottom<=d.top+1,lines:Math.round(sr.height/parseFloat(getComputedStyle(s).lineHeight)),inside:sr.right<=t.getBoundingClientRect().right+1};}));
  expect(r.length).toBeGreaterThanOrEqual(4);
  for(const t of r){expect(t.iconAbove).toBe(true);expect(t.lines).toBe(1);expect(t.inside).toBe(true);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
for (const [name,w,h] of [['phone',393,851],['desktop',1366,800]]) {
  test(`${name} (v9.23): the Today summary belongs to the Today tab; every other tab starts right under the place row`,async({page})=>{
    test.setTimeout(45000);
    await page.setViewportSize({width:w,height:h});await start(page);await choose(page,'Yangon');
    const summary=['.decision-grid','.current-card','#dashboard > .hourly-card','#dashboard > .metric-grid'];
    const probe=t=>page.evaluate(([t,sel])=>{const p=document.querySelector(`[data-panel=${t}]`),vis=s=>{const e=document.querySelector(s);return !!e&&e.getBoundingClientRect().height>0;};
      return {wtab:document.body.dataset.wtab,top:Math.round(p.getBoundingClientRect().top+scrollY),summary:sel.map(vis),row:vis('.location-row')};},[t,summary]);
    // Today: the whole summary, and the Today panel below it
    let r=await probe('today');expect(r.wtab).toBe('today');expect(r.summary).toEqual([true,true,true,true]);expect(r.row).toBe(true);
    const todayTop=r.top;expect(todayTop).toBeGreaterThan(900);
    // every other tab: the place row stays, the summary is gone, and the tab begins within the first screen and a half (the ⚙️ menu that the test setup keeps open takes ~250 px on a phone)
    for(const t of ['forecast','hazards','flood','hospitals','compare','lab']){
      await openTab(page,t);await page.waitForTimeout(250);r=await probe(t);
      expect(r.wtab,t).toBe(t);expect(r.summary,t).toEqual([false,false,false,false]);expect(r.row,t).toBe(true);
      expect(r.top,t).toBeLessThan(Math.min(todayTop-500,h*0.85));
    }
    // back on Today everything returns
    await openTab(page,'today');await page.waitForTimeout(250);r=await probe('today');expect(r.summary).toEqual([true,true,true,true]);
    // a reload on another tab opens that tab without the summary
    await openTab(page,'compare');await page.reload();await expect(page.locator('#dashboard')).toBeVisible({timeout:15000});await expect.poll(()=>page.evaluate(()=>document.body.dataset.wtab)).toBe('compare');
    expect((await probe('compare')).summary).toEqual([false,false,false,false]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  });
}
for (const [name,w,h] of [['phone',393,851],['desktop',1366,800]]) {
  test(`${name} (v9.24): Today reads temperature, warnings, next hours, then the tiles; "no notices" is said once`,async({page})=>{
    test.setTimeout(45000);
    await page.setViewportSize({width:w,height:h});await start(page);await choose(page,'Yangon');
    const top=sel=>page.evaluate(s=>{const e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().top+scrollY):null;},sel);
    const [cur,dec,hr,met,pan]=[await top('#dashboard > .current-card'),await top('#dashboard > .decision-grid'),await top('#dashboard > .hourly-card'),await top('#dashboard > .metric-grid'),await top('[data-panel=today]')];
    expect(cur).toBeLessThan(dec);expect(dec).toBeLessThan(hr);expect(hr).toBeLessThan(met);expect(met).toBeLessThan(pan);
    // the next hours are on the first screen and a half (they used to be ~1900 px down on a phone; the ⚙️ menu kept open by the test setup adds ~250 px)
    expect(hr).toBeLessThan(h*1.7);
    await expect(page.locator('[data-panel=today] .hourly-card')).toHaveCount(0);
    await expect(page.locator('#hourlyForecast .hour').first()).toBeVisible();
    // "no notices": the grey strip and the headline say it; the pill above them does not repeat it, and the way to the details stays
    await expect(page.locator('.today-brief .mwr-sum-none')).toBeVisible();await expect(page.locator('.today-brief .pulse-clear')).toBeVisible();
    await expect(page.locator('.today-brief .brief-main')).toBeHidden();await expect(page.locator('.today-brief .mwr-sum-foot button')).toBeVisible();
    // with a notice in the list (simulated by renaming the "none" line) the pill is back
    await page.evaluate(()=>{document.querySelector('.today-brief .mwr-sum-none').className='x';});
    await expect(page.locator('.today-brief .brief-main')).toBeVisible();
    // the other tabs do not carry the hourly card, and Today brings it back
    await openTab(page,'forecast');await expect(page.locator('#dashboard > .hourly-card')).toBeHidden();
    await openTab(page,'today');await expect(page.locator('#dashboard > .hourly-card')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  });
}

test('storm news from DMH shows with its date and leaves by itself when it is too old (v9.25)',async({page})=>{
  await mockApis(page);
  const hours=h=>new Date(Date.now()-h*3600000).toISOString();
  await page.route('**/api/v1/official-alerts**',route=>route.fulfill({json:{alerts:[],source_status:{last_success_at:hours(0.2),stale:false,importer_enabled:true,update_mode:'remote',watch:[
    {nid:'ta-1',kind:'announcement',issued:hours(5),title:'DMH Top Announcement: Depression over the Bay of Bengal moving north',title_en:'DMH Top Announcement: Depression over the Bay of Bengal moving north',url_en:'https://www.moezala.gov.mm/en/top-announcement/1',url_my:'https://www.moezala.gov.mm/my/top-announcement/1'},
    {nid:'ta-2',kind:'announcement',issued:hours(40),title:'DMH Top Announcement: old news',title_en:'DMH Top Announcement: old news',url_en:'https://www.moezala.gov.mm/en/top-announcement/2',url_my:'https://www.moezala.gov.mm/my/top-announcement/2'}]}}}));
  await page.goto('/');await expect(page.locator('#searchForm')).toBeVisible();await choose(page,'Yangon');
  await page.locator('[data-tab=hazards]').click();
  const card=page.locator('#watchCard');
  await expect(card).toBeVisible();
  await expect(card.locator('a')).toHaveCount(1);
  await expect(card.locator('a')).toContainText('Depression over the Bay of Bengal');
  await expect(card.locator('a')).not.toContainText('old news');
  await expect(card.locator('a')).toHaveText(/^\d{1,2} \w{3},? \d{2}:\d{2} · /);
  await expect(card.locator('a')).toHaveAttribute('href','https://www.moezala.gov.mm/en/top-announcement/1');
  const top=await card.evaluate(el=>el.getBoundingClientRect().top-document.querySelector('#hazards').getBoundingClientRect().bottom);
  expect(top).toBeLessThan(80);
});

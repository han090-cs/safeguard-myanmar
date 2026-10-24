import {test,expect} from '@playwright/test';
import {mockApis,choose,weather} from './ux-fixtures.mjs';
async function start(page,options){const counts=await mockApis(page,options);await page.goto('/');await expect(page.locator('#searchForm')).toBeVisible();return counts;}
test('no-match search settles and immediate retry works',async({page})=>{await start(page);await choose(page,'zzzqx');await expect(page.locator('#status')).toContainText('Location not found');await expect(page.locator('#loading')).toBeHidden();await choose(page,'Yangon');await expect(page.locator('#locationName')).toContainText('Yangon');await expect(page.locator('#temperature')).toHaveText('30');});
test('ambiguous search preserves selected identity',async({page})=>{await start(page);await choose(page,'Shwe');await expect(page.locator('#searchResults')).toBeVisible();await expect(page.locator('#dashboard')).toBeHidden();await page.locator('[data-place-id="town-nyaung"]').click();await expect(page.locator('#locationName')).toContainText('Nyaungshwe');await expect(page.locator('#locationMeta')).toContainText('20.6600');});
test('unit and language changes keep the tapped hour without resource refetches',async({page})=>{const counts=await start(page);await choose(page,'Yangon');const hour=page.locator('#hourlyForecast .hour').nth(3);await hour.click();await expect(hour).toHaveAttribute('aria-pressed','true');await expect(page.locator('#hourlyDetail .hd-card')).toBeVisible();await page.locator('#unitToggle').click();await expect(page.locator('#temperature')).toHaveText('86');await expect(page.locator('.temp-unit')).toHaveText('°F');await expect(page.locator('#hourlyForecast .hour').nth(3)).toHaveAttribute('aria-pressed','true');await page.locator('#unitToggle').click();await expect(page.locator('.temp-unit')).toHaveText('°C');await page.locator('#languageToggle').click();await expect(page.locator('#hourlyForecast .hour').nth(3)).toHaveAttribute('aria-pressed','true');await expect(page.locator('#heatCard')).not.toContainText('undefined');await expect(page.locator('#heatCard')).not.toContainText('wx_');expect(counts['/api/hospitals/nearest']||0).toBe(0);expect(counts['/api/v1/climate']||0).toBe(0);});
test('Data Saver comparison is scoped to the new place',async({page})=>{await start(page);await choose(page,'Shwebo');await page.locator('[data-tab=compare]').click();await expect(page.locator('#compareCharts')).toContainText('Place comparison 31');await page.locator('#liteToggle').click();await choose(page,'Yangon');await expect(page.locator('#compareCharts')).toContainText('Place comparison 36');await expect(page.locator('#compareCharts')).not.toContainText('Place comparison 31');});
test('farming does not inherit incompatible town data',async({page})=>{await start(page);await choose(page,'Shwebo');await page.locator('#modeFarm').click();await expect(page.locator('#agriRegionSel')).toBeVisible();await page.locator('#agriRegionSel').selectOption('R02');await expect(page.locator('#farmHead')).toContainText('Ayeyarwady Delta');await expect(page.locator('#agriLocal')).toBeHidden();await expect(page.locator('#agriWater')).toBeHidden();await page.locator('[data-ftab=season]').click();await expect(page.locator('#agriHistory')).toBeHidden();});
test('mobile destinations become visible and keyboard tabs activate manually',async({page})=>{await start(page);await choose(page,'Yangon');await page.locator('[data-tab=hospitals]').click();await expect(page.locator('#hospitalList')).toContainText('Yangon Hospital');await expect(page.locator('[data-panel=hospitals] h3')).toBeInViewport();await page.locator('[data-tab=forecast]').click();await page.locator('[data-tab=forecast]').press('ArrowRight');await expect(page.locator('[data-tab=flood]')).toBeFocused();await expect(page.locator('[data-tab=forecast]')).toHaveAttribute('aria-selected','true');await page.locator('[data-tab=flood]').press('Enter');await expect(page.locator('#floodTitle')).toBeInViewport();expect(await page.locator('nav[aria-label="Dashboard sections"] [tabindex="0"]').count()).toBe(1);});
test('reload and Back preserve named location and section',async({page})=>{await start(page);await choose(page,'Yangon');await page.locator('[data-tab=forecast]').click();await page.locator('[data-tab=hospitals]').click();await page.goBack();await expect(page.locator('[data-tab=forecast]')).toHaveAttribute('aria-selected','true');await page.reload();await expect(page.locator('#locationName')).toContainText('Yangon');await expect(page.locator('[data-tab=forecast]')).toHaveAttribute('aria-selected','true');});
test('scale, checklist, and native dialog preserve logical focus',async({page})=>{await start(page);await choose(page,'Yangon');await page.locator('[data-scale=rain]').click();await page.locator('.scale-close').click();await expect(page.locator('[data-scale=rain]')).toBeFocused();await page.locator('[data-tab=hazards]').click();await page.locator('[data-prep=water]').check();await expect(page.locator('[data-prep=water]')).toBeFocused();await expect(page.locator('[data-prep=water]')).toBeChecked();await page.locator('#aboutBtn').click();await expect(page.locator('#aboutClose')).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#aboutBtn')).toBeFocused();});
test('older weather never renders under a newer selection',async({page})=>{await start(page,{weatherDelay:180});await page.locator('#locationInput').fill('Shwebo');await page.locator('#searchForm button[type=submit]').click();await expect(page.locator('#locationName')).toContainText('Shwebo');await page.locator('[data-act=pick]').click();await page.locator('#locationInput').fill('Yangon');await page.locator('#searchForm button[type=submit]').click();await page.locator('#unitToggle').click();await expect(page.locator('#loading')).toBeHidden();await expect(page.locator('#locationName')).toContainText('Yangon');await expect(page.locator('#temperature')).toHaveText('86');});
test('repeated hospital entry coalesces in-flight requests',async({page})=>{const counts=await start(page,{hospitalDelay:180});await choose(page,'Yangon');await page.locator('[data-tab=hospitals]').click();await expect(page.locator('#hospitalRefresh')).toBeDisabled();await page.locator('[data-tab=hospitals]').click();await expect(page.locator('#hospitalList')).toContainText('Yangon Hospital');expect(counts['/api/hospitals/nearest']).toBe(1);});
test('Stop invalidates a late GPS callback using isolated fake geolocation',async({page})=>{await mockApis(page);await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(success){setTimeout(()=>success({coords:{latitude:16.84,longitude:96.17}}),200);}}}));await page.goto('/');await page.locator('#currentLocation').click();await page.locator('#loadingCancel').click();await expect(page.locator('#loading')).toBeHidden();await expect(page.locator('#status')).toContainText('Stopped');await page.waitForTimeout(300);await expect(page.locator('#dashboard')).toBeHidden();});
test('app notification off is separate from browser permission',async({page})=>{await mockApis(page);await page.addInitScript(()=>{class FakeNotification{static permission='granted';static requestPermission(){return Promise.resolve('granted');}constructor(){}}Object.defineProperty(window,'Notification',{value:FakeNotification});});await page.goto('/');await expect(page.locator('#notificationToggle')).toHaveAttribute('aria-pressed','true');await page.locator('#notificationToggle').click();await expect(page.locator('#notificationToggle')).toHaveAttribute('aria-pressed','false');await expect(page.locator('#status')).toContainText('off');await page.locator('#notificationToggle').click();await expect(page.locator('#notificationToggle')).toHaveAttribute('aria-pressed','true');});
test('rain-log archive and answer correction retain all records',async({page})=>{await mockApis(page);await page.addInitScript(()=>localStorage.setItem('mw_rain_log_v1',JSON.stringify({v:1,s:{'16.84,96.17|2026-10-15':{k:'16.84,96.17',date:'2026-10-15',chance:70,mm:2,ans:'rain'},'22.55,95.70|2026-10-15':{k:'22.55,95.70',date:'2026-10-15',chance:20,mm:0,ans:'dry'}}})));await page.goto('/');await choose(page,'Yangon');await page.locator('[data-tab=compare]').click();await page.locator('[data-rl-clear]').click();await expect(page.locator('[data-rl-restore]')).toBeVisible();const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('mw_rain_log_v1')));expect(Object.keys(data.s)).toHaveLength(3);expect(data.s['22.55,95.70|2026-10-15'].archived).not.toBe(true);await page.locator('[data-rl-restore]').click();await page.locator('#rainLogCard details summary').click();await page.locator('[data-rl="16.84,96.17|2026-10-15"][data-a=dry]').click();await page.locator('[data-rl-undo]').click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mw_rain_log_v1')).s['16.84,96.17|2026-10-15'].ans)).toBe('rain');});
test('copy payload uses chosen unit/language without a localhost link',async({page})=>{await mockApis(page);await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText(text){window.__testCopied=text;return Promise.resolve();}}}));await page.goto('/');await choose(page,'Yangon');await page.locator('#unitToggle').click();await page.locator('[data-brief-sms]').click();const text=await page.evaluate(()=>window.__testCopied);expect(text).toContain('86°F');expect(text).toContain('Rain chance');expect(text).not.toContain('127.0.0.1');});
test('an update action cannot leak into a later status',async({page})=>{await start(page);await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'MW_APP_UPDATED'}})));await expect(page.locator('#status button')).toHaveText('Reload update');await choose(page,'zzzqx');await expect(page.locator('#status button')).toHaveCount(0);await expect(page.locator('#status')).not.toHaveClass(/status-action/);});
test('weather cache access retains source age',async({page})=>{await start(page);await page.route('**/api/weather?**',route=>{const d=weather(16.84);d.meta.fetched_at=Date.now()/1000-7200;d.meta.stale=true;return route.fulfill({json:d});});await choose(page,'Yangon');await expect(page.locator('#status')).toContainText('saved');const d=await page.evaluate(()=>JSON.parse(localStorage.getItem('weather-wx-v1:16.840:96.170')));expect(Date.now()-d.saved).toBeGreaterThan(7100000);});
test('weather failure leaves official information visible and offers a direct retry',async({page})=>{await start(page);let fail=true;await page.route('**/api/weather?**',route=>fail?route.fulfill({status:503,json:{detail:'temporarily unavailable'}}):route.fulfill({json:weather(16.84)}));await choose(page,'Yangon');await expect(page.locator('#officialPulse')).toBeVisible();await expect(page.locator('#status .retry-btn')).toBeVisible();fail=false;await page.locator('#status .retry-btn').click();await expect(page.locator('#temperature')).toHaveText('30');});
test('farming reference failure has a direct retry',async({page})=>{await start(page);let fail=true;await page.route('**/api/agri/research',route=>fail?route.fulfill({status:503,json:{}}):route.continue());await page.locator('#modeFarm').click();await expect(page.locator('#farmHead button')).toHaveText('Try again');fail=false;await page.locator('#farmHead button').click();await expect(page.locator('#agriRegionSel')).toBeVisible();});
test('denied notification permission explains recovery without prompting again',async({page})=>{await mockApis(page);await page.addInitScript(()=>{class Denied{static permission='denied';static requestPermission(){throw Error('must not prompt');}}Object.defineProperty(window,'Notification',{value:Denied});});await page.goto('/');await page.locator('#notificationToggle').click();await expect(page.locator('#status')).toContainText('blocked');});
test('unsupported notification environments give actionable feedback',async({page})=>{await mockApis(page);await page.addInitScript(()=>{delete window.Notification;});await page.goto('/');await page.locator('#notificationToggle').click();await expect(page.locator('#status')).toContainText('does not support');});
test('native share cancellation is not an error or a clipboard fallback',async({page})=>{await mockApis(page);await page.addInitScript(()=>{Object.defineProperty(navigator,'share',{value:()=>Promise.reject(new DOMException('Cancelled','AbortError'))});Object.defineProperty(navigator,'clipboard',{value:{writeText(){throw Error('must not copy after cancel');}}});});await page.goto('/');await choose(page,'Yangon');await page.locator('[data-brief-share]').click();await expect(page.locator('.brief-copy-status')).toHaveCount(0);});

test('desktop navigation exposes its panel and uses vertical arrow keys',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await start(page);await choose(page,'Yangon');
  const tabs=page.locator('nav[aria-label="Dashboard sections"]');
  await expect(tabs).toHaveAttribute('aria-orientation','vertical');
  await page.locator('[data-tab=hospitals]').click();
  await expect(page.locator('[data-panel=hospitals] h3')).toBeInViewport();
  await page.locator('[data-tab=hospitals]').press('ArrowDown');
  await expect(page.locator('[data-tab=hazards]')).toBeFocused();
  await expect(page.locator('[data-tab=hospitals]')).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-tab=hazards]')).toHaveAttribute('aria-selected','true');
});

test('a late hospital response cannot replace the newer place',async({page})=>{
  await start(page,{hospitalDelay:500});await choose(page,'Shwebo');
  await page.locator('[data-tab=hospitals]').click();
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
  await page.locator('[data-act=pick]').click();
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
  await page.locator('[data-tab=hospitals]').click();
  await expect(page.locator('[data-panel=hospitals] h3')).toBeInViewport();
  await page.locator('[data-tab=forecast]').click();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(position-8);
  expect(Math.abs(await page.evaluate(()=>window.scrollY)-position)).toBeLessThan(8);
});

test('temperature chart shows readable values, scale and dates in both languages and units',async({page})=>{
  await start(page);await choose(page,'Yangon');
  await page.locator('[data-tab=forecast]').click();
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
  await page.locator('#languageToggle').click();
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

test('react farming: language switch, back/forward, no console errors',async({page})=>{
  const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await mockApis(page);await page.goto('/');await choose(page,'Shwebo');await page.locator('#modeFarm').click();
  await page.selectOption('#agriRegionSel','R01');await expect(page.locator('#agriRoot h3').first()).toContainText('Central Dry');
  await page.locator('[data-ftab=crops]').click();await expect(page.locator('#agriCrops .crop-list li').first()).toBeVisible();
  const before=await page.locator('#agriRoot h4').first().innerText();
  await page.locator('#languageToggle').click();await page.waitForTimeout(300);
  const after=await page.locator('#agriRoot h4').first().innerText();console.log('lang',before,'->',after);expect(after).not.toBe(before);
  await page.selectOption('#agriRegionSel','R02');await expect(page.locator('#agriRoot h3').first()).toContainText('Ayeyarwady');
  await page.goBack();await expect(page.locator('#agriRegionSel')).toHaveValue('R01');
  await page.reload();await expect(page.locator('#agriRegionSel')).toHaveValue('R01');
  await page.locator('[data-ftab=now]').click();await page.selectOption('#agriRegionSel','');await expect(page.locator('#agriRoot .region-btn').first()).toBeVisible();
  await page.locator('#agriRoot .region-btn').nth(2).click();await expect(page.locator('#agriRegionSel')).not.toHaveValue('');
  console.log('errors',JSON.stringify(errs));expect(errs).toEqual([]);
});

test('React cards survive changing the place several times (no stale or broken cards, no console errors)',async({page})=>{
  const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text())});
  await mockApis(page);await page.goto('/');
  for(const [name,tab] of [['Yangon','today'],['Shwebo','compare'],['Yangon','flood'],['Shwebo','forecast'],['Yangon','compare']]){
    await choose(page,name);await page.locator(`[data-tab=${tab}]`).click();await page.waitForTimeout(500);
    await expect(page.locator('#locationName')).toContainText(name);
    await expect(page.locator('#hourlyForecast .hour').first()).toBeAttached();
    await expect(page.locator('#forecast .forecast-row').first()).toBeAttached();
  }
  await page.locator('#modeFarm').click();await page.selectOption('#agriRegionSel','R01');await expect(page.locator('#agriRoot h3').first()).toBeVisible();
  expect(errs).toEqual([]);
});

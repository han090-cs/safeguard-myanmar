import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function harness(){
 const handlers={},records=new Map();let network;
 const cache={async match(request){return records.get(typeof request==='string'?request:request.url)?.clone();},async put(request,response){records.set(typeof request==='string'?request:request.url,response.clone());}};
 const caches={async open(){return cache;},async match(request){return records.get(typeof request==='string'?request:request.url)?.clone();},async keys(){return [];},async delete(){return true;}};
 const sandbox={Response,Request,Headers,URL,Date,setTimeout,clearTimeout,caches,fetch:(...args)=>network(...args),importScripts(){},SW_VERSION:'ux-test',self:{navigator:{},addEventListener:(type,handler)=>handlers[type]=handler}};
 vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),sandbox);
 return {records,network:fn=>network=fn,async request(path){let response;const tasks=[];handlers.fetch({request:new Request('http://local.test'+path),respondWith:p=>response=Promise.resolve(p),waitUntil:p=>tasks.push(p)});const r=await response;await Promise.all(tasks);return r;}};
}
test('offline weather is stale and preserves the original provider time',async()=>{
 const h=harness(),fetched=Date.now()/1000-3600;h.network(async()=>Response.json({weather:{},meta:{fetched_at:fetched,stale:false}}));
 await h.request('/api/weather?lat=16&lon=96');h.network(async()=>{throw Error('offline');});
 const r=await h.request('/api/weather?lat=16&lon=96'),data=await r.json();assert.equal(data.meta.fetched_at,fetched);assert.equal(data.meta.stale,true);assert.equal(data.meta.offline_cache,true);
});
test('offline DMH absence cannot become a newly verified all-clear',async()=>{
 const h=harness(),last=new Date(Date.now()-3600000).toISOString();h.network(async()=>Response.json({alerts:[],source_status:{last_success_at:last,stale:false}}));
 await h.request('/api/dmh/alerts');h.network(async()=>{throw Error('offline');});
 const data=await (await h.request('/api/dmh/alerts')).json();assert.equal(data.source_status.last_success_at,last);assert.equal(data.source_status.stale,true);
});
test('warning caches without a trustworthy cache time are not reused',async()=>{
 const h=harness();h.records.set('http://local.test/api/dmh/alerts',Response.json({alerts:[],source_status:{stale:false}}));h.network(async()=>{throw Error('offline');});
 assert.equal((await h.request('/api/dmh/alerts')).type,'error');
});

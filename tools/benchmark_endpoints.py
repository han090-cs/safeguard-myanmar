#!/usr/bin/env python3
import argparse,asyncio,time
import httpx

async def bench(client,url,n):
    lat=[]; codes={}
    gate=asyncio.Event()
    async def one():
        await gate.wait(); t=time.perf_counter()
        try:
            r=await client.get(url); code=r.status_code
        except Exception: code=0
        lat.append((time.perf_counter()-t)*1000); codes[code]=codes.get(code,0)+1
    tasks=[asyncio.create_task(one()) for _ in range(n)]
    gate.set(); await asyncio.gather(*tasks)
    lat.sort(); q=lambda p: lat[min(len(lat)-1,int(p*len(lat))-1)] if lat else 0
    return {"requests":n,"rps":round(1000*n/max(max(lat),1),1),"p50_ms":round(q(.5),1),"p95_ms":round(q(.95),1),"p99_ms":round(q(.99),1),"max_ms":round(max(lat),1) if lat else 0,"status":codes}

async def main():
 p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:8765');p.add_argument('--users',type=int,default=100);p.add_argument('--only',default='');a=p.parse_args()
 eps={
  'health':'/health',
  'status':'/api/status',
  'mimu':'/api/mimu-search?q=ရန်ကုန်&limit=8',
  'hospitals':'/api/hospitals/nearest?lat=16.85&lon=96.18&limit=8',
  'regions':'/api/regions',
 }
 async with httpx.AsyncClient(timeout=20, limits=httpx.Limits(max_connections=max(a.users,100), max_keepalive_connections=max(a.users,100))) as c:
  for name,path in eps.items():
   if a.only and name!=a.only: continue
   print(name,await bench(c,a.base.rstrip('/')+path,a.users))

if __name__=='__main__': asyncio.run(main())

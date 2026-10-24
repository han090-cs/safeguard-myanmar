#!/usr/bin/env python3
import argparse,asyncio,time
import httpx

async def run(base, users, seconds):
    url=base.rstrip("/")+"/api/status"; lat=[]; codes={}; start=time.perf_counter(); end=start+seconds
    sem=asyncio.Semaphore(min(users,2000))
    async with httpx.AsyncClient(timeout=15) as c:
      async def one():
        while time.perf_counter()<end:
          async with sem:
            t=time.perf_counter()
            try:r=await c.get(url); code=r.status_code
            except Exception:code=0
            lat.append((time.perf_counter()-t)*1000); codes[code]=codes.get(code,0)+1
      await asyncio.gather(*(one() for _ in range(users)))
    lat.sort(); n=len(lat); pct=lambda p:lat[min(n-1,max(0,int(n*p)-1))] if n else 0
    print({"users":users,"seconds":seconds,"requests":n,"rps":round(n/max(seconds,1),2),"p50_ms":round(pct(.50),1),"p95_ms":round(pct(.95),1),"p99_ms":round(pct(.99),1),"max_ms":round(max(lat),1) if lat else 0,"status":codes})

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--base",default="http://127.0.0.1:8000");p.add_argument("--users",type=int,default=10);p.add_argument("--seconds",type=int,default=15);a=p.parse_args();asyncio.run(run(a.base,a.users,a.seconds))

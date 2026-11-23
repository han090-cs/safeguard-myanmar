#!/usr/bin/env python3
"""Download one freely licensed photo per pest/disease from Wikimedia Commons into pests/ and write pests/credits.json.

Run on your own computer (needs internet):   python3 tools/fetch_commons_images.py
Only CC0, public domain, CC BY and CC BY-SA files are kept; author, licence and the Commons page are saved for the credit line.
Re-run any time; entries that already have a photo are skipped. Delete a line from pests/credits.json (and the .jpg) to pick again.
Always look at the photos once before publishing: a search can return a wrong picture."""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pests"; OUT.mkdir(exist_ok=True)
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "SafeGuardMyanmar-pest-guide/1.0 (educational; contact via GitHub han090-cs)"}
OK = re.compile(r"^(CC0|Public domain|PD|CC[ -]BY(?:[ -]SA)?(?:[ -]\d\.\d)?)", re.I)

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()

def api(**p):
    return json.loads(get(API + "?" + urllib.parse.urlencode({"format": "json", **p})))

def entries():
    js = (ROOT / "pests.js").read_text(encoding="utf-8")
    return re.findall(r'E\("([a-z0-9_]+)","[a-z]+","[a-z]+","([^"]+)","([^"]+)"', js)

def find(term):
    q = api(action="query", list="search", srsearch=f'{term} filetype:bitmap', srnamespace=6, srlimit=8)
    for hit in q["query"]["search"]:
        t = hit["title"]
        info = api(action="query", titles=t, prop="imageinfo", iiprop="url|extmetadata", iiurlwidth=640)
        page = next(iter(info["query"]["pages"].values()))
        ii = (page.get("imageinfo") or [None])[0]
        if not ii: continue
        md = ii.get("extmetadata", {})
        lic = (md.get("LicenseShortName", {}).get("value") or "").strip()
        if not OK.match(lic) or not ii.get("thumburl", "").lower().endswith((".jpg", ".jpeg")): continue
        author = re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", "")).strip()[:120]
        return {"title": t, "url": ii["descriptionurl"], "thumb": ii["thumburl"], "author": author or "unknown", "license": lic}
    return None

def main():
    cp = OUT / "credits.json"
    credits = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else {}
    for pid, en, sci in entries():
        if pid in credits and (OUT / credits[pid]["file"]).exists(): continue
        for term in (sci, en):
            try: r = find(term)
            except Exception as e: print("error", pid, e, file=sys.stderr); r = None
            if r: break
        if not r: print("no free photo:", pid); continue
        fn = pid + ".jpg"; (OUT / fn).write_bytes(get(r["thumb"]))
        credits[pid] = {"file": fn, "author": r["author"], "license": r["license"], "url": r["url"], "title": r["title"]}
        cp.write_text(json.dumps(credits, ensure_ascii=False, indent=1), encoding="utf-8")
        print("ok", pid, r["license"], r["title"]); time.sleep(1)

if __name__ == "__main__":
    main()

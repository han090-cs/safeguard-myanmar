#!/usr/bin/env python3
"""Import a normalized hospital CSV into data/hospitals.db.

This intentionally does not scrape DOMS pages. Prepare a CSV from a permitted,
verifiable source first, then import it locally. Required columns are listed in
 data/hospitals.example.csv.
"""
from __future__ import annotations
import argparse, csv, sqlite3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'data'/'hospitals.db'
REQUIRED=['id','name_my','name_en','level_my','level_en','beds','region_pcode','region_my','region_en','district','township_pcode','township_my','township_en','lat','lon','confidence']

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('csv_path', type=Path)
    ap.add_argument('--replace', action='store_true', help='replace the hospitals table after validation')
    args=ap.parse_args()
    rows=[]
    with args.csv_path.open('r',encoding='utf-8-sig',newline='') as f:
        r=csv.DictReader(f)
        missing=[c for c in REQUIRED if c not in (r.fieldnames or [])]
        if missing: raise SystemExit('Missing columns: '+', '.join(missing))
        for i,row in enumerate(r,2):
            if not row.get('id') or not row.get('name_my') and not row.get('name_en'):
                raise SystemExit(f'Row {i}: id and at least one hospital name are required')
            try: lat=float(row['lat']); lon=float(row['lon'])
            except ValueError as exc: raise SystemExit(f'Row {i}: lat/lon must be numeric') from exc
            if not (-90<=lat<=90 and -180<=lon<=180): raise SystemExit(f'Row {i}: invalid coordinates')
            rows.append(tuple(row.get(c,'') for c in REQUIRED))
    con=sqlite3.connect(DB)
    try:
        con.execute('PRAGMA foreign_keys=ON')
        if args.replace:
            con.execute('DROP TABLE IF EXISTS hospitals')
            con.execute('''CREATE TABLE hospitals (
              id TEXT PRIMARY KEY,name_my TEXT,name_en TEXT,level_my TEXT,level_en TEXT,beds TEXT,
              region_pcode TEXT,region_my TEXT,region_en TEXT,district TEXT,township_pcode TEXT,
              township_my TEXT,township_en TEXT,lat REAL,lon REAL,confidence TEXT)''')
        else:
            con.execute('''CREATE TABLE IF NOT EXISTS hospitals (
              id TEXT PRIMARY KEY,name_my TEXT,name_en TEXT,level_my TEXT,level_en TEXT,beds TEXT,
              region_pcode TEXT,region_my TEXT,region_en TEXT,district TEXT,township_pcode TEXT,
              township_my TEXT,township_en TEXT,lat REAL,lon REAL,confidence TEXT)''')
        con.executemany('INSERT OR REPLACE INTO hospitals VALUES ('+','.join('?' for _ in REQUIRED)+')', rows)
        con.commit()
        print(f'Imported {len(rows)} hospital records into {DB}')
    finally: con.close()

if __name__=='__main__': main()

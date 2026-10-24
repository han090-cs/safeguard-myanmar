from pathlib import Path
import sqlite3
BASE=Path(__file__).resolve().parents[1]
for path, sqls in [(BASE/"data/mimu_locations.db", [
 "CREATE INDEX IF NOT EXISTS idx_locations_name ON locations(name)",
 "CREATE INDEX IF NOT EXISTS idx_locations_type_name ON locations(type,name)",
 "CREATE INDEX IF NOT EXISTS idx_locations_admin1_type_name ON locations(admin1,type,name)",
]),(BASE/"data/hospitals.db", [
 "CREATE INDEX IF NOT EXISTS idx_hospitals_township_en ON hospitals(township_en)",
 "CREATE INDEX IF NOT EXISTS idx_hospitals_name_en ON hospitals(name_en)",
 "CREATE INDEX IF NOT EXISTS idx_hospitals_region_township ON hospitals(region_en,township_en)",
])]:
    c=sqlite3.connect(path)
    for q in sqls:c.execute(q)
    c.commit();c.execute("PRAGMA optimize");c.close()
print("Runtime indexes prepared")

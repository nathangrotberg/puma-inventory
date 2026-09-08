#!/usr/bin/env bash
# Export the QuickBase side of the facility join to qb-facilities.json.
# Read-only. Needs Nathan's QuickBase connector skill (outside this repo).
#   ./scripts/export-qb-facilities.sh > qb-facilities.json
set -euo pipefail
QB="${QB_CLI:-$HOME/.claude/skills/quickbase/scripts/qb.py}"
python3 "$QB" query br96xsmve --top 500 \
  --select "Facility Handle,Location - Facility Name,Paying Entity" \
| python3 -c '
import json,sys
rows=json.load(sys.stdin).get("records",[])
def v(r,k):
    x=r.get(k); return (x.get("value") if isinstance(x,dict) else x) or ""
fac={}
for r in rows:
    h=str(v(r,"Facility Handle")).strip()
    if not h or h=="---": continue
    fac.setdefault(h,{"name":str(v(r,"Location - Facility Name")).strip(),
                      "entity":str(v(r,"Paying Entity")).strip(),"pos":0})
    fac[h]["pos"]+=1
json.dump({"facilities":fac},sys.stdout,indent=1)
'

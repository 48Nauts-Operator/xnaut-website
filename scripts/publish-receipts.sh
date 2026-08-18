#!/bin/zsh
# Publish local attestation receipts to xnaut.dev/attest.
#
# The verifier page is generic; this is the only step between "the HSM signed
# it" and "anyone can verify it". Reads the app's append-only attestations.jsonl,
# rewrites attest/receipts.json newest-first, commits and pushes when changed.
#
# Run:  ./scripts/publish-receipts.sh
# ponytail: git push IS the deploy on GitHub Pages; a backend would be a second
# system to attest. If receipts ever need to appear without a human running
# this, hook it into the plugin's attest path or a cron.

set -e
cd ${0:a:h:h}
SRC=~/Library/Application\ Support/xnaut/attestations.jsonl

python3 - "$SRC" <<'PY'
import json, pathlib, sys
src = pathlib.Path(sys.argv[1])
rows = []
for line in src.read_text().splitlines():
    try:
        r = json.loads(line)
    except ValueError:
        continue
    rows.append({k: r[k] for k in ("ts","subject","digest","key_name","algorithm","signature") if k in r})
rows.sort(key=lambda r: r["ts"], reverse=True)
out = pathlib.Path("attest/receipts.json")
new = json.dumps({"receipts": rows}, indent=2) + "\n"
if out.read_text() == new:
    print("no new receipts"); raise SystemExit(0)
out.write_text(new)
print(f"published {len(rows)} receipt(s)")
PY

if ! git diff --quiet attest/receipts.json; then
  git add attest/receipts.json
  git commit -m "feat(attest): publish $(python3 -c "import json;print(len(json.load(open('attest/receipts.json'))['receipts']))") receipt(s)"
  git push forgejo main
  git push origin main
fi

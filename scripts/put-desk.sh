#!/usr/bin/env bash
# Write a desk.json into KV. The app picks it up on its next open; no deploy.
#   npm run desk:put -- path/to/desk.json
set -euo pipefail
FILE="${1:-public/data/desk.json}"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$FILE"   # refuse broken JSON
npx wrangler kv key put --binding DESK --remote desk.json --path "$FILE"

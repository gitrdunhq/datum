Report which lanes of epic {{epicBranch}} already have epic-scoped completion markers.

Run this exact script from the repo root and return ONLY its stdout — raw JSON, no markdown fences, no commentary. It calls `datum lane-state read` (the deterministic CLI, not hand-written file parsing) once per task id:

```
OUT='{}'
for TID in {{taskIdsSpace}}; do
  R=$(datum lane-state read --epic "{{epicBranch}}" --task "$TID")
  STATUS=$(echo "$R" | jq -r '.status // "not_found"')
  if [ "$STATUS" = "not_found" ]; then continue; fi
  MC=$(echo "$R" | jq -r '.merge_commit // ""')
  SHASH=$(echo "$R" | jq -r '.spec_hash // ""')
  ANC=false
  if [ -n "$MC" ] && git merge-base --is-ancestor "$MC" "{{epicBranch}}" 2>/dev/null; then
    ANC=true
  fi
  OUT=$(echo "$OUT" | jq --arg tid "$TID" --arg status "$STATUS" --arg spec_hash "$SHASH" --argjson ancestor "$ANC" \
    '. + {($tid): {status: $status, spec_hash: $spec_hash, ancestor: $ancestor}}')
done
echo "$OUT"
```

If no markers exist for any task id, the script prints `{}` — that is the correct output. Do not create any files or directories.

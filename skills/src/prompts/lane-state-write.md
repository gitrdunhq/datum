Record epic-scoped completion markers for lanes just squash-merged into {{epicBranch}}.

Run this exact script from the repo root and return ONLY the word DONE. It calls `datum lane-state write` (the deterministic CLI, not hand-written JSON) once per entry:

```
MC=$(git rev-parse {{epicBranch}})
echo '{{entriesJson}}' | jq -c '.[]' | while read -r e; do
  TID=$(echo "$e" | jq -r '.task_id')
  SHASH=$(echo "$e" | jq -r '.spec_hash')
  datum lane-state write --epic "{{epicBranch}}" --task "$TID" --status completed \
    --merge-commit "$MC" --spec-hash "$SHASH" --run-id "{{runId}}" > /dev/null
done
echo DONE
```

Do not write files directly; all state must go through the `datum lane-state write` CLI call above.

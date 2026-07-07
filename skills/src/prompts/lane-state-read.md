Report which lanes of epic {{epicBranch}} already have epic-scoped completion markers.

Run this exact script from the repo root and return ONLY its stdout — raw JSON, no markdown fences, no commentary:

```
python3 - <<'PYEOF'
import json, glob, os, subprocess
out = {}
for f in sorted(glob.glob('.datum/epics/{{epicSlug}}/lane-state/*.json')):
    try:
        d = json.load(open(f))
    except Exception:
        continue
    mc = d.get('merge_commit', '')
    anc = False
    if mc:
        anc = subprocess.run(['git', 'merge-base', '--is-ancestor', mc, '{{epicBranch}}'],
                             capture_output=True).returncode == 0
    tid = d.get('task_id') or os.path.basename(f)[:-5]
    out[tid] = {'status': d.get('status', ''), 'spec_hash': d.get('spec_hash', ''), 'ancestor': anc}
print(json.dumps(out))
PYEOF
```

If the lane-state directory does not exist, the script prints `{}` — that is the correct output. Do not create any files or directories.

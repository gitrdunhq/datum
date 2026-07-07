Record epic-scoped completion markers for lanes just squash-merged into {{epicBranch}}.

Run this exact script from the repo root and return ONLY the word DONE:

```
python3 - <<'PYEOF'
import json, os, subprocess, datetime
entries = json.loads('''{{entriesJson}}''')
merge_commit = subprocess.check_output(['git', 'rev-parse', '{{epicBranch}}']).decode().strip()
ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
d = '.datum/epics/{{epicSlug}}/lane-state'
os.makedirs(d, exist_ok=True)
for e in entries:
    marker = {
        'schema_version': '1.0',
        'task_id': e['task_id'],
        'status': 'completed',
        'epic_branch': '{{epicBranch}}',
        'merge_commit': merge_commit,
        'spec_hash': e['spec_hash'],
        'run_id': '{{runId}}',
        'completed_at': ts,
    }
    with open(os.path.join(d, e['task_id'] + '.json'), 'w') as fh:
        json.dump(marker, fh, indent=2)
        fh.write('\n')
print('DONE')
PYEOF
```

Do not commit these files; they are local scheduler state.

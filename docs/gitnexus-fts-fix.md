# GitNexus FTS Fix — Read-Only Connection Blocks Extension Load

**Date:** 2026-05-22  
**Affects:** gitnexus 1.6.4, 1.6.5, 1.6.6-rc.34 (confirmed)  
**Upstream issues:** #1090, #1191, #1255, #1287, #1403, #1449  
**Symptom:** `gitnexus_query` always returns empty + `"FTS indexes missing — keyword search degraded"`

---

## Root Cause

The MCP server pool opens every LadybugDB connection **read-only** (`openReadOnlyDatabase`), then immediately calls `loadFTSExtension(conn, { policy: 'load-only' })` on one of those read-only connections.

`LOAD EXTENSION fts` in KuzuDB/LadybugDB writes to the database catalog to register the extension. On a read-only connection that write is rejected. The `extensionManager.ensure()` with `policy: 'load-only'` catches the failure, calls `markUnavailable()`, and returns `false`. `shared.ftsLoaded` is set to `false` for the lifetime of the process.

Every subsequent `QUERY_FTS_INDEX` call is skipped — BM25 returns 0ms with the "FTS indexes missing" warning for every query until the server restarts (which hits the same wall again).

The FTS indexes **do exist** on disk (created correctly by `gitnexus analyze`). The problem is purely in extension loading on the query-path connection.

---

## The Broken Code

**File:** `dist/core/lbug/pool-adapter.js` — `doInitLbug()`, around line 524

```js
// BROKEN: loadFTSExtension on a read-only connection always fails
if (!shared.ftsLoaded) {
    shared.ftsLoaded = await loadFTSExtension(available[0], { policy: 'load-only' });
}
```

`available[0]` is a `Connection` from the **read-only** `shared.db`. `LOAD fts` needs write access to the catalog. It fails. `ftsLoaded = false`. Done.

---

## The Fix

Open a **temporary read-write connection** just to load the extension, then close it. The read-only pool connections run queries normally — they don't need to load the extension themselves because LadybugDB shares extension state at the `Database` level, not per-`Connection`.

**File:** `dist/core/lbug/pool-adapter.js`

### Step 1 — add a helper after `openReadOnlyDatabase`

```js
/**
 * Load the FTS extension via a short-lived read-write connection on the same
 * database file. Required because LOAD EXTENSION writes to the LadybugDB
 * catalog, which is rejected on read-only connections.
 *
 * The extension state is shared at the Database level, so once loaded here
 * the read-only pool connections can call QUERY_FTS_INDEX without issue.
 * The temporary connection is closed immediately after loading.
 */
async function loadFTSViaWritableConnection(dbPath) {
    let db;
    let conn;
    silenceStdout();
    try {
        db = createLbugDatabase(lbug, dbPath, { throwOnWalReplayFailure: false });
        await db.init();
        conn = new lbug.Connection(db);
        const loaded = await loadFTSExtension(conn, { policy: 'auto' });
        return loaded;
    } catch {
        return false;
    } finally {
        if (conn) await conn.close().catch(() => {});
        if (db) await db.close().catch(() => {});
        restoreStdout();
    }
}
```

### Step 2 — replace the broken FTS load block in `doInitLbug`

```js
// BEFORE (broken):
if (!shared.ftsLoaded) {
    if (process.platform === 'win32') {
        shared.ftsLoaded = (await hasLocalWinFtsExtension())
            ? await loadFTSExtension(available[0], { policy: 'load-only' })
            : true;
    } else {
        shared.ftsLoaded = await loadFTSExtension(available[0], { policy: 'load-only' });
    }
}

// AFTER (fixed):
if (!shared.ftsLoaded) {
    if (process.platform === 'win32') {
        shared.ftsLoaded = (await hasLocalWinFtsExtension())
            ? await loadFTSViaWritableConnection(dbPath)
            : true;
    } else {
        shared.ftsLoaded = await loadFTSViaWritableConnection(dbPath);
    }
}
```

Apply the same replacement to `initLbugWithDb()` (~line 603) — same pattern, same fix, `dbPath` is the parameter there too.

---

## How to Apply the Patch to the Local npx Cache

Find the active gitnexus pool-adapter used by the MCP server:

```bash
# Find which cache the running gitnexus mcp process uses
ps aux | grep "gitnexus mcp" | grep -v grep
# Note the path, e.g. /Users/you/.npm/_npx/HASH/node_modules/gitnexus/...
```

Then edit `dist/core/lbug/pool-adapter.js` in that cache directory:

1. Add `loadFTSViaWritableConnection` after `openReadOnlyDatabase` (around line 394)
2. Replace the two `loadFTSExtension(available[0], { policy: 'load-only' })` calls in `doInitLbug` and `initLbugWithDb`
3. Restart the MCP server (restart Claude Code or kill the gitnexus mcp process on port 3282)
4. Run `npx gitnexus@rc analyze --repair-fts` to rebuild FTS indexes
5. Test with `gitnexus_query({ query: "delete remove file", repo: "bodyGuy" })`

---

## Why `policy: 'auto'` is Safe Here

The temporary RW connection only runs for ~100ms at pool init time. `analyze` holds the DB write lock only while rebuilding — the MCP server starts after analyze finishes, so there's no lock conflict. The `policy: 'auto'` allows install+load without a network round-trip because the FTS extension binary is already on disk at `~/.lbdb/extension/`.

---

## Verification

After the fix, a working BM25 query looks like:

```json
{
  "timing": { "bm25": 118.9, "vector": 2.3 },
  // results populated
}
```

A broken one looks like:

```json
{
  "timing": { "bm25": 0.1, "vector": 0.5 },
  "warning": "FTS indexes missing"
}
```

BM25 at 0.1ms = hit an empty index and returned immediately. BM25 at 100ms+ = index was searched.

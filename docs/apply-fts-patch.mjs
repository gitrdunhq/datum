import { readFileSync, writeFileSync } from 'fs';

const target = `${process.env.HOME}/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/core/lbug/pool-adapter.js`;

let src = readFileSync(target, 'utf8');

// 1. Inject the RW helper before openReadOnlyDatabase
const INJECT_BEFORE = `async function openReadOnlyDatabase(dbPath) {`;
const HELPER = `async function loadFTSViaWritableConnection(dbPath) {
    let db;
    let conn;
    silenceStdout();
    try {
        db = createLbugDatabase(lbug, dbPath, { throwOnWalReplayFailure: false });
        await db.init();
        conn = new lbug.Connection(db);
        return await loadFTSExtension(conn, { policy: 'auto' });
    }
    catch {
        return false;
    }
    finally {
        if (conn) await conn.close().catch(() => {});
        if (db) await db.close().catch(() => {});
        restoreStdout();
    }
}
`;

if (src.includes('loadFTSViaWritableConnection')) {
    console.log('Patch already applied.');
    process.exit(0);
}

if (!src.includes(INJECT_BEFORE)) {
    console.error('ERROR: Could not find insertion point. Wrong file version?');
    process.exit(1);
}

src = src.replace(INJECT_BEFORE, HELPER + INJECT_BEFORE);

// 2. Replace both load-only calls with the RW helper
const BROKEN = `shared.ftsLoaded = await loadFTSExtension(available[0], { policy: 'load-only' });`;
const FIXED  = `shared.ftsLoaded = await loadFTSViaWritableConnection(dbPath);`;

const count = (src.match(new RegExp(BROKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
if (count !== 2) {
    console.error(`ERROR: Expected 2 occurrences of the broken call, found ${count}.`);
    process.exit(1);
}

src = src.replaceAll(BROKEN, FIXED);

writeFileSync(target, src, 'utf8');
console.log(`Patched ${target}`);
console.log('Now kill and restart the gitnexus mcp process on port 3282.');

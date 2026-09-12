const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Free-hosting-friendly by default: with no TURSO_DATABASE_URL set, this
// writes to a local SQLite file - fine for local use, but that file does NOT
// survive a free host's restarts. Set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN)
// to a free Turso database (see the deployment guide) for a database that
// persists no matter where the app itself runs or restarts.
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(DATA_DIR, 'macelleria.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const client = createClient({ url, authToken });

// ---------------------------------------------------------------------
// A thin shim so the rest of the app can keep writing
// db.prepare(sql).get/all/run(...params) - just awaited, since libSQL's
// client is promise-based (it talks to a remote database) where
// better-sqlite3's was synchronous (it talked to a local file directly).
// ---------------------------------------------------------------------

function toArgs(params) {
  // A single plain-object argument means named placeholders (@name/:name);
  // anything else (including zero args) is positional (?) placeholders.
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object' && !Array.isArray(params[0])) {
    return params[0];
  }
  return params;
}

function rowsToObjects(result) {
  // libSQL rows already expose named-column access; spreading gives a plain
  // object so callers (and JSON.stringify) behave exactly as they did with
  // better-sqlite3's plain-object rows.
  return result.rows.map(r => ({ ...r }));
}

function makeStatement(sql, exec) {
  return {
    async get(...params) {
      const result = await exec({ sql, args: toArgs(params) });
      return result.rows.length ? { ...result.rows[0] } : undefined;
    },
    async all(...params) {
      const result = await exec({ sql, args: toArgs(params) });
      return rowsToObjects(result);
    },
    async run(...params) {
      const result = await exec({ sql, args: toArgs(params) });
      return {
        lastInsertRowid: result.lastInsertRowid === undefined || result.lastInsertRowid === null
          ? undefined : Number(result.lastInsertRowid),
        changes: result.rowsAffected
      };
    }
  };
}

const db = {
  prepare(sql) {
    return makeStatement(sql, (req) => client.execute(req));
  },

  // Runs `fn(txDb)` inside a single write transaction. `fn` must be async
  // and do all its work through the `txDb` handed to it (which has the same
  // prepare().get/all/run shape). Commits on success, rolls back on throw.
  async transaction(fn) {
    const tx = await client.transaction('write');
    const txDb = { prepare: (sql) => makeStatement(sql, (req) => tx.execute(req)) };
    try {
      const result = await fn(txDb);
      await tx.commit();
      return result;
    } catch (err) {
      try { await tx.rollback(); } catch (e) { /* already closed */ }
      throw err;
    }
  },

  async migrate() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.executeMultiple(schema);
  }
};

module.exports = db;

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const previousName = 'wifi_csi_safety';
const targetName = 'onguard';

async function snapshot(database) {
  const client = new Client({ database, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows: [result] } = await client.query(`SELECT
      current_database() AS database,
      (SELECT count(*)::text FROM gateways) AS gateways,
      (SELECT count(*)::text FROM events) AS events,
      (SELECT count(*)::text FROM event_actions) AS event_actions,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY singleton_id) FROM settings s) AS settings`);
    delete result.database;
    return JSON.stringify(result);
  } finally { await client.end(); }
}

async function renameDatabase() {
  const envPath = path.resolve(__dirname, '..', '.env');
  const envText = fs.readFileSync(envPath, 'utf8');
  if (![previousName, targetName].includes(process.env.PGDATABASE) || process.env.PGUSER !== 'wifi_csi_app') {
    throw new Error('This command only renames the default project database.');
  }
  if (!/^PGDATABASE=[^\r\n]*$/m.test(envText)) throw new Error('PGDATABASE is missing from .env.');
  const admin = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: 'postgres',
    user: process.env.WIFI_CSI_ADMIN_USER || 'postgres',
    password: process.env.WIFI_CSI_ADMIN_PASSWORD,
    connectionTimeoutMillis: 5000,
  });
  try {
    await admin.connect();
    const { rows } = await admin.query(`SELECT datname, pg_get_userbyid(datdba) AS owner
      FROM pg_database WHERE datname = ANY($1::text[])`, [[previousName, targetName]]);
    const previous = rows.find(row => row.datname === previousName);
    const target = rows.find(row => row.datname === targetName);
    if (previous && target) throw new Error('Both database names exist. No databases were changed.');
    if (!previous && !target) throw new Error('Project database not found. Run db:setup for a new installation.');
    if ((previous || target).owner !== process.env.PGUSER) throw new Error('Unexpected database owner. No databases were changed.');
    if (previous) {
      const before = await snapshot(previousName);
      const connections = await admin.query('SELECT 1 FROM pg_stat_activity WHERE datname = $1', [previousName]);
      if (connections.rowCount) throw new Error('Close the Node server and database clients connected to wifi_csi_safety, then retry. No connections were forcibly closed.');
      await admin.query('ALTER DATABASE wifi_csi_safety RENAME TO onguard');
      console.log('Renamed wifi_csi_safety to onguard; no database was recreated.');
      if (await snapshot(targetName) !== before) throw new Error('Database renamed, but verification differs. Check onguard before updating .env.');
    } else {
      await snapshot(targetName);
      console.log('onguard already exists; project login and tables verified.');
    }
    // Read again so unrelated local settings are preserved.
    const latest = fs.readFileSync(envPath, 'utf8');
    if (!/^PGDATABASE=[^\r\n]*$/m.test(latest)) throw new Error('Database is onguard; set PGDATABASE=onguard in .env manually.');
    fs.writeFileSync(envPath, latest.replace(/^PGDATABASE=[^\r\n]*$/m, `PGDATABASE=${targetName}`));
    console.log('Updated .env to PGDATABASE=onguard. Existing records, settings and login credentials were kept.');
  } finally { await admin.end(); }
}

if (require.main === module) renameDatabase().catch(error => {
  // Database errors may include SQL or credentials; only our own messages are safe to print.
  console.error(error.code ? `Database rename failed (${error.code}). Check local credentials and permissions; then retry db:rename.` : error.message);
  process.exitCode = 1;
});

module.exports = { renameDatabase };

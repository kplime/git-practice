const { Client } = require('pg');

async function setup() {
  // Only create this project's default database and role. Never change existing credentials.
  if (process.env.PGUSER !== 'wifi_csi_app' || process.env.PGDATABASE !== 'onguard') {
    throw new Error('For an existing/custom database, configure .env and run db:check instead.');
  }
  const password = process.env.PGPASSWORD;
  if (!password || password.startsWith('replace-with-')) throw new Error('Run npm.cmd run setup first.');
  const admin = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.WIFI_CSI_ADMIN_USER || 'postgres',
    password: process.env.WIFI_CSI_ADMIN_PASSWORD,
    database: 'postgres',
    connectionTimeoutMillis: 5000,
  });
  try {
    await admin.connect();
    const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['wifi_csi_app']);
    if (!role.rowCount) {
      const { rows: [quoted] } = await admin.query('SELECT quote_literal($1) AS password', [password]);
      await admin.query(`CREATE ROLE wifi_csi_app LOGIN PASSWORD ${quoted.password}`);
      console.log('Created project role wifi_csi_app.');
    } else {
      console.log('Project role already exists; its password was not changed.');
    }
    const legacy = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', ['wifi_csi_safety']);
    if (legacy.rowCount) throw new Error('Run db:rename to preserve the existing project database.');
    const db = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', ['onguard']);
    if (!db.rowCount) {
      await admin.query('CREATE DATABASE onguard OWNER wifi_csi_app');
      console.log('Created project database onguard.');
    } else {
      console.log('Project database already exists; existing contents were kept.');
    }
  } finally {
    await admin.end();
  }
  const { pool, initializeDatabase } = require('../src/db');
  try {
    await initializeDatabase();
    console.log('Project database login and schema initialization passed.');
  } finally {
    await pool.end();
  }
}

setup().catch(() => {
  // SQL errors may contain passwords. Keep setup output free of query/error details.
  console.error('DB setup failed. If the old wifi_csi_safety database exists, run db:rename first. Otherwise check the local administrator credentials, then the project credentials and permissions in .env. Existing role passwords are never reset by this script.');
  process.exitCode = 1;
});

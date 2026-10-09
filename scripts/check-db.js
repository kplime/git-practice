const { pool } = require('../src/db');

(async () => {
  try {
    await pool.query('SELECT 1');
    const { rows } = await pool.query(`SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename IN ('gateways', 'events', 'event_actions', 'settings', 'activity_history')`);
    console.log(`PostgreSQL login passed. Project tables found: ${rows.length}/5.`);
    if (rows.length !== 5) console.log('Start the server to initialize the project tables.');
  } catch (error) {
    console.error(`PostgreSQL check failed (${error.code || 'CONNECTION_ERROR'}). Check PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD in .env.`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

const { Pool } = require('pg');

const pool = new Pool({
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  options: process.env.PGOPTIONS || undefined,
});

pool.on('error', (error) => {
  console.error('PostgreSQL idle connection error:', error.message);
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gateways (
      gateway_id TEXT PRIMARY KEY,
      generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
      sequence INTEGER NOT NULL DEFAULT -1 CHECK (sequence >= -1),
      sensor_available BOOLEAN NOT NULL DEFAULT FALSE,
      quality_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (quality_status IN ('AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN')),
      bed_state TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (bed_state IN ('IN_BED', 'OUT_OF_BED', 'UNKNOWN')),
      measured_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ,
      is_demo BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      gateway_id TEXT NOT NULL REFERENCES gateways(gateway_id),
      event_type TEXT NOT NULL CHECK (event_type IN (
        'FALL_SUSPECTED', 'NON_RETURN_WARNING', 'SENSOR_UNAVAILABLE', 'GATEWAY_OFFLINE'
      )),
      occurred_at TIMESTAMPTZ NOT NULL,
      detected_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL,
      score REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
      quality_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      model_version TEXT,
      payload_json JSONB NOT NULL,
      state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
      acknowledged_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      observed BOOLEAN NOT NULL DEFAULT FALSE,
      resolution_reason TEXT,
      is_demo BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events(occurred_at DESC);

    CREATE TABLE IF NOT EXISTS event_actions (
      action_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(event_id),
      action_type TEXT NOT NULL CHECK (action_type IN ('CREATED', 'ACKNOWLEDGED', 'RESOLVED')),
      actor TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS settings (
      singleton_id SMALLINT PRIMARY KEY CHECK (singleton_id = 1),
      version INTEGER NOT NULL DEFAULT 1,
      non_return_minutes INTEGER NOT NULL DEFAULT 10 CHECK (non_return_minutes BETWEEN 1 AND 1440),
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE gateways ADD COLUMN IF NOT EXISTS bed_exited_at TIMESTAMPTZ;
    ALTER TABLE gateways ADD COLUMN IF NOT EXISTS applied_settings_version INTEGER
      CHECK (applied_settings_version IS NULL OR applied_settings_version >= 1);
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS bed_monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS bed_monitoring_mode TEXT NOT NULL DEFAULT 'ALL_DAY'
      CHECK (bed_monitoring_mode IN ('ALL_DAY', 'TIME_RANGE'));
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS bed_monitoring_start TIME(0) NOT NULL DEFAULT '22:00';
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS bed_monitoring_end TIME(0) NOT NULL DEFAULT '07:00';
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS fall_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS sensor_fault_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS gateway_fault_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await pool.query(`
    INSERT INTO settings (singleton_id, version, non_return_minutes, updated_at)
    VALUES (1, 1, 10, NOW())
    ON CONFLICT (singleton_id) DO NOTHING
  `);
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, initializeDatabase, withTransaction };

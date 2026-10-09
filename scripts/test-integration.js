// Uses a new temporary schema; existing project rows and settings are never changed.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { Client } = require('pg');

async function availablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

(async () => {
  const schema = `safety_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionTimeoutMillis: 5000 });
  let created = false;
  let server;
  let serverOutput = '';
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const port = await availablePort();
    const token = randomUUID();
    server = spawn(process.execPath, ['src/server.js'], {
      cwd: path.resolve(__dirname, '..'), windowsHide: true,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), GATEWAY_TOKEN: token, PGOPTIONS: `-c search_path=${schema}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (chunk) => { serverOutput += chunk; });
    server.stderr.on('data', (chunk) => { serverOutput += chunk; });
    const base = `http://127.0.0.1:${port}`;
    const call = async (url, method = 'GET', body, auth = false) => {
      const response = await fetch(`${base}/api${url}`, {
        method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
      });
      return { status: response.status, body: await response.json() };
    };
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (server.exitCode !== null) throw new Error(`Test server stopped: ${serverOutput}`);
      try { if ((await call('/health')).status === 200) { ready = true; break; } } catch { /* wait for listen */ }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(ready, true, 'server health');
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /app\.js/);
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
    assert.equal((await call('/status')).body.gateway.connected, false);

    const timestamp = new Date().toISOString();
    const payload = { eventId: 'test-fall', gatewayId: 'test-gateway', type: 'FALL_SUSPECTED', occurredAt: timestamp, detectedAt: timestamp, score: 0.8, isDemo: true };
    assert.equal((await call('/ingest/events', 'POST', payload)).status, 401);
    assert.equal((await call('/ingest/events', 'POST', payload, true)).status, 201);
    assert.equal((await call('/status')).body.gateway.connected, false, 'event replay is not a heartbeat');
    assert.equal((await call('/ingest/events', 'POST', payload, true)).body.duplicate, true);
    assert.equal((await call('/ingest/events', 'POST', { ...payload, score: 0.9 }, true)).status, 409);
    assert.equal((await call('/ingest/events', 'POST', { event_id: 'snake_case' }, true)).status, 400);
    assert.equal((await call('/ingest/events', 'POST', { ...payload, eventId: 'bad-score', score: 2 }, true)).status, 400);
    assert.equal((await call('/events/test-fall')).body.isDemo, true);

    const demoHeartbeat = { gatewayId: 'demo-test-gateway', generation: 1, sequence: 1, sensorAvailable: true, qualityStatus: 'AVAILABLE', measuredAt: timestamp, appliedSettingsVersion: 1, isDemo: true };
    assert.equal((await call('/ingest/status', 'POST', demoHeartbeat, true)).status, 202);
    const demoOnlyStatus = (await call('/status')).body;
    assert.equal(demoOnlyStatus.gateway.connected, false, 'fresh sample heartbeats never establish live observation');
    assert.equal(demoOnlyStatus.gateway.receivedAt, null);
    assert.equal(demoOnlyStatus.sensor.available, false);
    assert.equal(demoOnlyStatus.sensor.fresh, false);
    assert.equal(demoOnlyStatus.sensor.measuredAt, null);
    assert.equal('bedState' in demoOnlyStatus, false);
    assert.equal('bedExitedAt' in demoOnlyStatus, false);
    assert.equal(demoOnlyStatus.settings.appliedVersion, null);
    const heartbeat = { gatewayId: 'real-test-gateway', generation: 1, sequence: 1, sensorAvailable: true, qualityStatus: 'AVAILABLE', measuredAt: timestamp, isDemo: false };
    assert.equal((await call('/ingest/status', 'POST', heartbeat, true)).status, 202);
    assert.equal((await call('/ingest/status', 'POST', heartbeat, true)).status, 409);
    assert.equal((await call('/status')).body.gateway.connected, true);
    assert.equal((await call('/status')).body.isDemo, false);
    assert.equal((await call('/status')).body.sensor.fresh, true);
    assert.equal((await call('/status')).body.settings.appliedVersion, null, 'legacy heartbeat never claims settings applied');
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, sequence: 2, appliedSettingsVersion: 1 }, true)).status, 202);
    const extendedStatus = (await call('/status')).body;
    assert.equal('bedExitedAt' in extendedStatus, false);
    assert.equal(extendedStatus.settings.appliedVersion, 1);
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, sequence: 3, measuredAt: new Date(Date.now() - 60000).toISOString() }, true)).status, 202);
    const staleMeasurement = (await call('/status')).body;
    assert.equal(staleMeasurement.gateway.connected, true);
    assert.equal(staleMeasurement.sensor.fresh, false, 'recent heartbeat does not refresh old measurements');
    assert.ok(staleMeasurement.sensor.ageSeconds >= 60);
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, sequence: 4, measuredAt: 'bad-date' }, true)).status, 400);
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, sequence: 4, appliedSettingsVersion: 0 }, true)).status, 400);
    const acknowledged = await call('/events/test-fall/ack', 'POST', {});
    assert.equal(acknowledged.body.item.state, 'ACKNOWLEDGED');
    assert.equal(acknowledged.body.item.resolvedAt, null, 'ack does not resolve');
    assert.equal((await call('/events/test-fall/ack', 'POST', {})).body.duplicate, true);
    assert.equal((await call('/events/test-fall/resolve', 'POST', { observed: false, reason: 'test' })).status, 400);
    const resolution = 'Generated integration test observation';
    assert.equal((await call('/events/test-fall/resolve', 'POST', { observed: true, reason: resolution })).body.item.state, 'RESOLVED');
    assert.equal((await call('/events/test-fall/resolve', 'POST', { observed: true, reason: resolution })).status, 409);
    assert.equal((await call('/events/test-fall')).body.actions.length, 3);

    for (const [id, type] of [['test-fault-a', 'SENSOR_UNAVAILABLE'], ['test-fault-b', 'GATEWAY_OFFLINE']]) {
      assert.equal((await call('/ingest/events', 'POST', { ...payload, eventId: id, type }, true)).status, 201);
    }
    assert.equal((await call('/events?type=FAULT')).body.items.length, 2);
    assert.equal((await call('/events?state=RESOLVED')).body.items.length, 1);
    const ids = [];
    let cursor;
    do {
      const pageResult = await call(`/events?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(pageResult.status, 200);
      ids.push(...pageResult.body.items.map((event) => event.eventId));
      cursor = pageResult.body.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 3, 'same-timestamp cursor loses no events');
    assert.equal(new Set(ids).size, 3);
    assert.equal((await call('/events?cursor=invalid')).status, 400);
    // A Korean calendar day: start is inclusive, next midnight is exclusive.
    const periodFrom = '2026-10-04T15:00:00.000Z';
    const periodTo = '2026-10-05T15:00:00.000Z';
    for (const [id, at] of [
      ['period-before', '2026-10-04T14:59:59.999Z'],
      ['period-start', periodFrom],
      ['period-last', '2026-10-05T14:59:59.999Z'],
      ['period-after', periodTo],
    ]) {
      assert.equal((await call('/ingest/events', 'POST', { ...payload, eventId: id, occurredAt: at, detectedAt: at }, true)).status, 201);
    }
    const periodParams = new URLSearchParams({ from: periodFrom, to: periodTo });
    const bounded = (await call(`/events?${periodParams}`)).body;
    assert.deepEqual(bounded.items.map(event => event.eventId), ['period-last', 'period-start']);
    const periodFirst = (await call(`/events?${periodParams}&limit=1`)).body;
    const periodSecond = (await call(`/events?${periodParams}&limit=1&cursor=${encodeURIComponent(periodFirst.nextCursor)}`)).body;
    assert.deepEqual([...periodFirst.items, ...periodSecond.items].map(event => event.eventId), ['period-last', 'period-start']);
    assert.equal((await call('/events/period-start/ack', 'POST', {})).status, 200);
    const combined = (await call(`/events?${periodParams}&state=ACKNOWLEDGED&type=FALL_SUSPECTED`)).body;
    assert.deepEqual(combined.items.map(event => event.eventId), ['period-start']);
    assert.equal((await call(`/events?${periodParams}&type=FAULT`)).body.items.length, 0);
    for (const [id, at] of [
      ['minute-last', '2026-10-04T15:00:59.999Z'],
      ['minute-after', '2026-10-04T15:01:00.000Z'],
    ]) assert.equal((await call('/ingest/events', 'POST', { ...payload, eventId: id, occurredAt: at, detectedAt: at }, true)).status, 201);
    const minuteParams = new URLSearchParams({ from: periodFrom, to: '2026-10-04T15:01:00.000Z' });
    assert.deepEqual((await call(`/events?${minuteParams}`)).body.items.map(event => event.eventId), ['minute-last', 'period-start'], 'whole end minute is included; next minute is excluded');
    const lowerOnly = (await call(`/events?from=${encodeURIComponent(periodFrom)}`)).body.items;
    assert.equal(lowerOnly.some(event => event.eventId === 'period-before'), false);
    assert.equal(lowerOnly.some(event => event.eventId === 'period-after'), true);
    const upperOnly = (await call(`/events?to=${encodeURIComponent(periodTo)}`)).body.items;
    assert.equal(upperOnly.some(event => event.eventId === 'period-before'), true);
    assert.equal(upperOnly.some(event => event.eventId === 'period-after'), false);
    for (const invalid of [
      'from=bad-date', 'from=2026-02-30T00:00:00.000Z', 'to=2026-10-06',
      `from=${periodTo}&to=${periodFrom}`, `from=${periodFrom}&to=${periodFrom}`,
      `from=${periodFrom}&from=${periodFrom}`,
    ]) assert.equal((await call(`/events?${invalid}`)).status, 400, invalid);
    const initial = (await call('/settings')).body;
    assert.equal(initial.timeZone, 'Asia/Seoul');
    for (const key of ['fallAlertEnabled', 'sensorFaultAlertEnabled', 'gatewayFaultAlertEnabled']) assert.equal(initial[key], true);
    const legacySettings = ['nonReturnMinutes', 'bedMonitoringEnabled', 'bedMonitoringMode', 'bedMonitoringStart', 'bedMonitoringEnd'];
    for (const key of legacySettings) assert.equal(key in initial, false);
    const storedBefore = (await admin.query(`SELECT * FROM "${schema}".settings`)).rows[0];
    for (const invalid of [
      { nonReturnMinutes: 15 }, { bedMonitoringEnabled: true }, { bedMonitoringMode: 'ALL_DAY' },
      { bedMonitoringStart: '22:00' }, { bedMonitoringEnd: '07:00' }, { arbitraryField: 1 }, {},
      { fallAlertEnabled: false, nonReturnMinutes: 15 },
    ]) assert.equal((await call('/settings', 'PATCH', invalid)).status, 400);
    assert.deepEqual((await call('/settings')).body, initial, 'retired settings requests do not change saved values');
    const updated = (await call('/settings', 'PATCH', { fallAlertEnabled: false })).body;
    assert.equal(updated.version, initial.version + 1);
    assert.equal(updated.sensorFaultAlertEnabled, true, 'partial patch preserves other options');
    assert.deepEqual((await call('/gateway/settings', 'GET', undefined, true)).body, updated);
    const storedAfter = (await admin.query(`SELECT * FROM "${schema}".settings`)).rows[0];
    for (const key of ['non_return_minutes', 'bed_monitoring_enabled', 'bed_monitoring_mode', 'bed_monitoring_start', 'bed_monitoring_end']) {
      assert.equal(storedAfter[key], storedBefore[key], 'historical settings columns remain intact');
    }
    assert.equal('nonReturnMinutes' in (await call('/status')).body.settings, false);
    const previousEvents = (await call('/events?limit=100')).body;
    const alertOptions = { fallAlertEnabled: false, sensorFaultAlertEnabled: false, gatewayFaultAlertEnabled: true };
    const beforeAlerts = (await call('/settings')).body;
    const changedAlerts = (await call('/settings', 'PATCH', alertOptions)).body;
    assert.equal(changedAlerts.version, beforeAlerts.version + 1);
    for (const [key, value] of Object.entries(alertOptions)) assert.equal(changedAlerts[key], value);
    assert.deepEqual((await call('/gateway/settings', 'GET', undefined, true)).body, changedAlerts);
    for (const invalid of [{ fallAlertEnabled: 'false' }, { sensorFaultAlertEnabled: 0 }, { gatewayFaultAlertEnabled: null }]) {
      assert.equal((await call('/settings', 'PATCH', invalid)).status, 400);
    }
    assert.deepEqual((await call('/settings')).body, changedAlerts);
    assert.deepEqual((await call('/events?limit=100')).body, previousEvents, 'changing alert options preserves event history');
    // Emulate an already stored record from the previous contract. Preserve its
    // original payload, actions and timestamps; never convert it to low activity.
    const legacyPayload = { ...payload, eventId: 'legacy-non-return', type: 'NON_RETURN_WARNING',
      score: null, qualityStatus: 'UNKNOWN', modelVersion: null, details: {} };
    await admin.query(`INSERT INTO "${schema}".events
      (event_id, gateway_id, event_type, occurred_at, detected_at, received_at, payload_json, is_demo)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,TRUE)`,
      [legacyPayload.eventId, legacyPayload.gatewayId, legacyPayload.type, timestamp, timestamp, timestamp, JSON.stringify(legacyPayload)]);
    await admin.query(`INSERT INTO "${schema}".event_actions (event_id, action_type, actor, created_at)
      VALUES ($1,'CREATED','gateway',$2)`, [legacyPayload.eventId, timestamp]);
    assert.equal((await call('/events?type=NON_RETURN_WARNING')).body.items[0].eventId, legacyPayload.eventId);
    assert.equal((await call('/ingest/events', 'POST', legacyPayload, true)).body.duplicate, true);
    assert.equal((await call('/ingest/events', 'POST', { ...legacyPayload, score: 0.9 }, true)).status, 409);
    const beforeRetired = (await call('/events?limit=100')).body;
    const retired = await call('/ingest/events', 'POST', { ...legacyPayload, eventId: 'new-non-return' }, true);
    assert.equal(retired.status, 400);
    assert.equal(retired.body.error.code, 'RETIRED_EVENT_TYPE');
    assert.deepEqual((await call('/events?limit=100')).body, beforeRetired);
    assert.equal((await call('/events/legacy-non-return/ack', 'POST', {})).body.item.state, 'ACKNOWLEDGED');
    assert.equal((await call('/events/legacy-non-return/resolve', 'POST', { observed: true, reason: 'Historical incident checked directly' })).body.item.state, 'RESOLVED');
    const legacyDetail = (await call('/events/legacy-non-return')).body;
    assert.equal(legacyDetail.type, 'NON_RETURN_WARNING');
    assert.equal(legacyDetail.occurredAt, timestamp);
    assert.equal(legacyDetail.actions.length, 3);
    assert.equal((await call('/missing')).status, 404);
    const python = path.join(__dirname, '..', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (fs.existsSync(python)) {
      const policy = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_detection_policy.py'], {
        cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(policy.status, 0, `Python detection policy: ${policy.stderr || policy.error?.message || ''}`);
      console.log('PASS: Python retired episode rejection, independent options and unchanged retry/status handling.');
      const demo = spawnSync(python, ['python/send_demo.py'], {
        cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, API_BASE_URL: base, GATEWAY_TOKEN: token },
      });
      assert.equal(demo.status, 0, `Python API smoke: ${demo.stderr || demo.error?.message || ''}`);
      const pythonEvents = (await call('/events')).body.items.filter((event) => event.details.source === 'send_demo.py');
      assert.equal(pythonEvents.length, 3);
      assert.equal(pythonEvents.every((event) => event.isDemo), true);
      console.log('PASS: Python gateway client -> real Express API -> PostgreSQL (three labelled demo events).');
    } else { console.log('SKIP: Python API smoke (.venv not installed).'); }
    const seed = () => {
      const result = spawnSync(process.execPath, ['scripts/demo.js', '--seed-only'], {
        cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
      });
      assert.equal(result.status, 0, `Sample seeding: ${result.stderr || result.error?.message || ''}`);
      return result.stdout;
    };
    const legacySample = { ...payload, eventId: 'sample-ui-01', details: { source: 'ui-sample-v1' } };
    assert.equal((await call('/ingest/events', 'POST', legacySample, true)).status, 201);
    await call('/events/sample-ui-01/ack', 'POST', {});
    const legacySampleBefore = (await call('/events/sample-ui-01')).body;
    assert.match(seed(), /inserted 24/);
    assert.deepEqual((await call('/events/sample-ui-01')).body, legacySampleBefore, 'v2 seeding leaves v1 records and handling intact');
    const samples = (await call('/events?limit=100')).body.items.filter((event) => event.details.source === 'ui-sample-v2');
    assert.equal(samples.length, 24);
    assert.equal(new Set(samples.map((event) => event.type)).size, 4);
    assert.equal(new Set(samples.map((event) => event.state)).size, 3);
    assert.equal(samples.every((event) => event.isDemo && event.type !== 'NON_RETURN_WARNING'), true);
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, gatewayId: 'real-room', isDemo: false, measuredAt: new Date().toISOString() }, true)).status, 202);
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, gatewayId: 'sample-room-gateway', isDemo: true, measuredAt: new Date().toISOString() }, true)).status, 202);
    assert.equal((await call('/events/sample-ui-v2-04')).body.actions.length, 3);
    await call('/events/sample-ui-v2-01/ack', 'POST', {});
    const beforeReseed = (await call('/events/sample-ui-v2-01')).body;
    assert.match(seed(), /inserted 0/);
    const afterReseed = (await call('/events/sample-ui-v2-01')).body;
    assert.deepEqual(afterReseed, beforeReseed, 'repeated seeding keeps actions and user handling');
    assert.equal((await call('/status')).body.gateway.id, 'real-room', 'real heartbeat takes priority over sample fixtures');
    await admin.query(`UPDATE "${schema}".gateways SET received_at=NOW()-INTERVAL '1 minute', measured_at=NOW()-INTERVAL '1 minute' WHERE is_demo=FALSE AND received_at IS NOT NULL`);
    const staleRealStatus = (await call('/status')).body;
    assert.equal(staleRealStatus.gateway.connected, false, 'fresh samples cannot replace a stale real gateway');
    assert.equal(staleRealStatus.sensor.fresh, false);
    assert.equal(staleRealStatus.isDemo, false);
    assert.equal(staleRealStatus.activity, null);

    // Latest activity is independent of heartbeat freshness and is never filled
    // from demo data or retained when an accepted heartbeat omits activity.
    const activityEnd = new Date().toISOString();
    const activity = { score: 0.1, windowStartedAt: new Date(Date.parse(activityEnd) - 10000).toISOString(),
      modelVersion: 'activity-v1', calibrationVersion: 'room-v1' };
    const activityStatus = { ...heartbeat, gatewayId: 'activity-test', sequence: 1,
      measuredAt: activityEnd, activity, isDemo: false };
    assert.equal((await call('/ingest/status', 'POST', activityStatus, true)).status, 202);
    assert.deepEqual((await call('/status')).body.activity, activity);
    assert.equal((await call('/ingest/status', 'POST', { ...activityStatus, gatewayId: 'activity-demo', isDemo: true }, true)).status, 202);
    assert.equal((await call('/status')).body.gateway.id, 'activity-test');
    for (const invalid of [{ score: null }, { score: true }, { score: 1.1 },
      { modelVersion: '' }, { calibrationVersion: '' }, { windowStartedAt: activityEnd }]) {
      const rejected = await call('/ingest/status', 'POST', { ...activityStatus, sequence: 2, activity: { ...activity, ...invalid } }, true);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error.code, 'INVALID_ACTIVITY');
    }
    assert.equal((await call('/ingest/status', 'POST', { ...activityStatus, isDemo: undefined }, true)).status, 400);
    assert.deepEqual((await call('/status')).body.activity, activity, 'invalid requests preserve last accepted measurement');
    assert.equal((await call('/ingest/status', 'POST', { ...activityStatus, sequence: 2, activity: undefined }, true)).status, 202);
    assert.equal((await call('/status')).body.activity, null, 'heartbeat without activity cannot retain an old score');
    assert.equal((await call('/ingest/status', 'POST', { ...activityStatus, sequence: 3, qualityStatus: 'DEGRADED' }, true)).status, 202);
    assert.equal((await call('/status')).body.activity, null);
    assert.equal((await call('/ingest/status', 'POST', { ...activityStatus, sequence: 4 }, true)).status, 202);
    await admin.query(`UPDATE "${schema}".gateways SET measured_at=NOW()-INTERVAL '1 minute' WHERE gateway_id='activity-test'`);
    assert.equal((await call('/status')).body.activity, null, 'old measurement is not a current activity score');

    const lowSettings = (await call('/settings')).body;
    assert.equal(lowSettings.lowActivityEnabled, false);
    assert.equal(lowSettings.lowActivityMinutes, 30);
    assert.equal(lowSettings.lowActivityThreshold, 0.2);
    assert.equal(lowSettings.lowActivityMode, 'ALL_DAY');
    assert.equal(lowSettings.lowActivityStart, '22:00');
    assert.equal(lowSettings.lowActivityEnd, '07:00');
    for (const invalid of [{ lowActivityEnabled: 'true' }, { lowActivityMinutes: 0 }, { lowActivityMinutes: 1441 },
      { lowActivityMinutes: 1.5 }, { lowActivityMinutes: true }, { lowActivityThreshold: -0.1 },
      { lowActivityThreshold: 1.1 }, { lowActivityThreshold: null }, { lowActivityThreshold: '0.2' }]) {
      assert.equal((await call('/settings', 'PATCH', invalid)).status, 400);
    }
    assert.deepEqual((await call('/settings')).body, lowSettings);
    const configuredLow = (await call('/settings', 'PATCH', { lowActivityEnabled: true, lowActivityMinutes: 1, lowActivityThreshold: 0.15 })).body;
    assert.equal(configuredLow.version, lowSettings.version + 1);
    assert.equal(configuredLow.lowActivityEnabled, true);
    assert.equal(configuredLow.lowActivityMinutes, 1);
    assert.equal(configuredLow.lowActivityThreshold, 0.15);
    assert.equal(configuredLow.fallAlertEnabled, lowSettings.fallAlertEnabled);
    assert.deepEqual((await call('/gateway/settings', 'GET', undefined, true)).body, configuredLow);

    // Exercise the migration against an old event-type constraint, preserving
    // every existing row/settings value and allowing repeated initialization.
    const countsBeforeMigration = (await admin.query(`SELECT count(*)::integer AS count FROM "${schema}".events`)).rows[0].count;
    // The old contract could not contain low activity samples. Keep the old
    // constraint simulation non-destructive even after v2 seeding.
    await admin.query(`ALTER TABLE "${schema}".events DROP CONSTRAINT events_event_type_check;
      ALTER TABLE "${schema}".events ADD CONSTRAINT events_event_type_check CHECK
      (event_type IN ('FALL_SUSPECTED','NON_RETURN_WARNING','SENSOR_UNAVAILABLE','GATEWAY_OFFLINE')) NOT VALID`);
    assert.match(seed(), /inserted 0/);
    assert.equal((await admin.query(`SELECT count(*)::integer AS count FROM "${schema}".events`)).rows[0].count, countsBeforeMigration);
    assert.deepEqual((await call('/settings')).body, configuredLow);
    assert.equal((await call('/events/legacy-non-return')).body.actions.length, 3);

    if (fs.existsSync(python)) {
      const generate = spawnSync(python, ['-c', `import json
from datetime import datetime, timedelta, timezone
from python.activity import iso_timestamp
from python.low_activity import LowActivityDetector
end = datetime.now(timezone.utc).replace(microsecond=0)
start = end - timedelta(minutes=1)
detector = LowActivityDetector('python-activity-test')
settings = json.loads('${JSON.stringify(configuredLow)}')
for index in range(1, 7):
    at = start + timedelta(seconds=index * 10)
    result = detector.update({'gatewayId': 'python-activity-test', 'generation': 1, 'sequence': index,
        'sensorAvailable': True, 'qualityStatus': 'AVAILABLE', 'isDemo': True, 'measuredAt': iso_timestamp(at),
        'activity': {'score': 0.1, 'windowStartedAt': iso_timestamp(at - timedelta(seconds=10)),
                     'modelVersion': 'activity-v1', 'calibrationVersion': 'room-v1'}}, settings, at)
print(json.dumps(result.event))`], { cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 10000 });
      assert.equal(generate.status, 0, `Python low activity detector: ${generate.stderr}`);
      const detected = JSON.parse(generate.stdout);
      assert.equal(detected.type, 'LOW_ACTIVITY');
      assert.equal(detected.isDemo, true);
      assert.equal((await call('/ingest/events', 'POST', detected, true)).status, 201);
      assert.equal((await call('/ingest/events', 'POST', detected, true)).body.duplicate, true);
      assert.equal((await call('/events?type=LOW_ACTIVITY')).body.items[0].eventId, detected.eventId);
      assert.equal((await call(`/events/${detected.eventId}/ack`, 'POST', {})).body.item.state, 'ACKNOWLEDGED');
      assert.equal((await call(`/events/${detected.eventId}/resolve`, 'POST', { observed: true, reason: 'Generated test observation' })).body.item.state, 'RESOLVED');
      const detail = (await call(`/events/${detected.eventId}`)).body;
      assert.equal(detail.actions.length, 3);
      assert.equal(detail.details.durationSeconds, 60);
      const invalidEvidence = await call('/ingest/events', 'POST', { ...detected, eventId: 'invalid-low',
        details: { ...detected.details, durationSeconds: 59 } }, true);
      assert.equal(invalidEvidence.status, 400);
      assert.equal(invalidEvidence.body.error.code, 'INVALID_LOW_ACTIVITY_EVENT');
      // Settings changed after occurrence must not discard durable replays.
      await call('/settings', 'PATCH', { lowActivityEnabled: false });
      assert.equal((await call('/ingest/events', 'POST', detected, true)).body.duplicate, true);
      console.log('PASS: Python continuous-window detector -> API -> DB, low activity handling and replay.');
    }
    // Activity history: real ingestion only, no invented scores or implicit replay.
    assert.equal((await fetch(`${base}/activity-history.js`)).status, 200);
    const historyGateway = 'history-test';
    const historyEnd = new Date(Date.now() - 1000).toISOString();
    const historyBody = { ...activityStatus, gatewayId: historyGateway, measuredAt: historyEnd,
      activity: { ...activity, score: 0, windowStartedAt: new Date(Date.parse(historyEnd) - 10000).toISOString() } };
    const sendHistory = patch => call('/ingest/status', 'POST', { ...historyBody, ...patch }, true);
    assert.equal((await sendHistory({})).status, 202);
    assert.equal((await sendHistory({})).status, 409);
    assert.equal((await sendHistory({ sequence: 2, activity: undefined })).status, 202);
    assert.equal((await sendHistory({ sequence: 3 })).status, 202);
    assert.equal((await sendHistory({ sequence: 4, sensorAvailable: false })).status, 202);
    const oldAt = new Date(Date.now() - 60000).toISOString();
    assert.equal((await sendHistory({ sequence: 5, measuredAt: oldAt,
      activity: { ...activity, windowStartedAt: new Date(Date.parse(oldAt) - 10000).toISOString() } })).status, 202);
    assert.equal((await sendHistory({ gatewayId: 'history-demo', isDemo: true })).status, 202);
    assert.equal((await sendHistory({ gatewayId: 'history-unclassified', isDemo: undefined, activity: undefined })).status, 202);
    assert.equal((await call('/activity/history?gatewayId=history-demo')).body.items.length, 0);
    assert.equal((await call('/activity/history?gatewayId=history-unclassified')).body.items.length, 0);
    const historyBounds = { gatewayId: historyGateway, from: new Date(Date.parse(historyEnd) - 1000).toISOString(), to: new Date(Date.now() + 1000).toISOString() };
    const historyURL = new URLSearchParams(historyBounds);
    const history = (await call(`/activity/history?${historyURL}`)).body;
    assert.equal(history.items.length, 5, 'only accepted real statuses generate history');
    assert.deepEqual(history.items.map(item => item.reason), ['STALE_MEASUREMENT', 'SENSING_UNAVAILABLE', 'REPEATED_MEASUREMENT', 'NO_ACTIVITY', null]);
    assert.equal(history.items.at(-1).score, 0, 'real zero is a measurement, not missing input');
    assert.ok(history.items.slice(0, 4).every(item => item.score === null));
    const boundary = await call(`/activity/history?${new URLSearchParams({ gatewayId: historyGateway, from: historyEnd, to: new Date(Date.parse(historyEnd) + 1).toISOString() })}`);
    assert.equal(boundary.body.items.length, 1, 'from is inclusive');
    assert.equal((await call(`/activity/history?${new URLSearchParams({ gatewayId: historyGateway, from: historyBounds.from, to: historyEnd })}`)).body.items.length, 0, 'to is exclusive');
    const firstHistory = (await call(`/activity/history?${historyURL}&limit=2`)).body;
    const collectedHistory = [...firstHistory.items];
    let historyCursor = firstHistory.nextCursor;
    while (historyCursor) {
      const next = await call(`/activity/history?limit=2&cursor=${encodeURIComponent(historyCursor)}`);
      assert.equal(next.status, 200); assert.equal(next.body.gatewayId, historyGateway);
      assert.equal(next.body.from, historyBounds.from); collectedHistory.push(...next.body.items); historyCursor = next.body.nextCursor;
    }
    assert.equal(new Set(collectedHistory.map(item => item.sequence)).size, 5);
    assert.deepEqual(collectedHistory, history.items);
    for (const suffix of ['limit=0', 'limit=1001', 'limit=2junk', 'cursor=invalid', 'to=bad',
      'from=2026-10-01T00:00:00Z&to=2026-10-09T00:00:00Z']) assert.equal((await call(`/activity/history?${suffix}`)).status, 400);
    assert.equal((await call(`/activity/history?gatewayId=another-room&cursor=${encodeURIComponent(firstHistory.nextCursor)}`)).status, 400);

    // The row lock serializes racing retries and history + latest status roll back together.
    const beforeEvents = (await admin.query(`SELECT count(*)::int AS count FROM "${schema}".activity_history`)).rows[0].count;
    await call('/ingest/events', 'POST', { ...payload, eventId: 'history-event-only', gatewayId: historyGateway }, true);
    assert.equal((await admin.query(`SELECT count(*)::int AS count FROM "${schema}".activity_history`)).rows[0].count, beforeEvents);
    const races = await Promise.all([sendHistory({ sequence: 6 }), sendHistory({ sequence: 6 })]);
    assert.deepEqual(races.map(item => item.status).sort(), [202, 409]);
    await admin.query(`ALTER TABLE "${schema}".activity_history ADD CONSTRAINT test_fail_history CHECK (sequence <> 7) NOT VALID`);
    assert.equal((await sendHistory({ sequence: 7 })).status, 500);
    assert.equal((await admin.query(`SELECT sequence FROM "${schema}".gateways WHERE gateway_id=$1`, [historyGateway])).rows[0].sequence, 6);
    await admin.query(`ALTER TABLE "${schema}".activity_history DROP CONSTRAINT test_fail_history`);
    assert.equal((await sendHistory({ sequence: 7 })).status, 202, 'failed transaction did not consume sequence');
    assert.equal((await call('/activity/history')).body.gatewayId, historyGateway, 'default scope uses latest non-demo heartbeat');
    assert.equal((await sendHistory({ gatewayId: 'history-new-demo', isDemo: true })).status, 202);
    assert.equal((await call('/activity/history')).body.gatewayId, historyGateway);
    // Force tied timestamps to verify tuple pagination; the exact last page has no false cursor.
    await admin.query(`UPDATE "${schema}".activity_history SET sampled_at=$1 WHERE gateway_id=$2 AND score IS NULL`, [historyEnd, historyGateway]);
    const tiedFirst = (await call(`/activity/history?${historyURL}&limit=6`)).body;
    const tiedLast = (await call(`/activity/history?limit=1&cursor=${encodeURIComponent(tiedFirst.nextCursor)}`)).body;
    assert.equal(new Set([...tiedFirst.items, ...tiedLast.items].map(item => item.sequence)).size, 7);
    assert.equal(tiedLast.nextCursor, null);
    const scheduled = (await call('/settings', 'PATCH', { lowActivityEnabled: true, lowActivityMode: 'TIME_RANGE', lowActivityStart: '22:30', lowActivityEnd: '07:15' })).body;
    assert.equal(scheduled.lowActivityMode, 'TIME_RANGE'); assert.equal(scheduled.lowActivityStart, '22:30');
    assert.equal(scheduled.lowActivityEnd, '07:15'); assert.equal(scheduled.timeZone, 'Asia/Seoul');
    assert.deepEqual((await call('/gateway/settings', 'GET', undefined, true)).body, scheduled);
    for (const invalid of [{ lowActivityMode: 'OTHER' }, { lowActivityMode: null }, { lowActivityStart: '24:00' },
      { lowActivityEnd: '07:60' }, { lowActivityStart: '7:00' }, { lowActivityStart: ['22:00'] },
      { lowActivityEnd: '' }, { lowActivityStart: '07:15' }, { lowActivityStart: '12:00', lowActivityEnd: '12:00' }]) {
      const rejected = await call('/settings', 'PATCH', invalid);
      assert.equal(rejected.status, 400); assert.equal(rejected.body.error.code, 'INVALID_LOW_ACTIVITY_SCHEDULE');
      assert.deepEqual((await call('/settings')).body, scheduled, 'invalid schedule never changes other settings or version');
    }
    const allDay = (await call('/settings', 'PATCH', { lowActivityMode: 'ALL_DAY' })).body;
    assert.equal(allDay.lowActivityStart, '22:30'); assert.equal(allDay.lowActivityEnd, '07:15');
    assert.equal(allDay.lowActivityMode, 'ALL_DAY'); assert.equal(allDay.version, scheduled.version + 1);
    if (fs.existsSync(python)) {
      const policy = spawnSync(python, ['-c', `import json
from python.detection_policy import detection_enabled
settings = json.loads('${JSON.stringify(scheduled)}')
assert detection_enabled('LOW_ACTIVITY', settings, '2026-10-08T13:30:00Z')
assert detection_enabled('LOW_ACTIVITY', settings, '2026-10-08T22:14:59Z')
assert not detection_enabled('LOW_ACTIVITY', settings, '2026-10-08T22:15:00Z')
assert not detection_enabled('LOW_ACTIVITY', settings, '2026-10-08T13:29:59Z')`],
        { cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 10000 });
      assert.equal(policy.status, 0, `API settings -> Python overnight policy: ${policy.stderr}`);
    }
    console.log('PASS: overnight low activity settings, partial updates, invalid schedule rollback and Python policy.');
    console.log('PASS: real activity history, missing/repeated/stale gaps, bounded periods, cursor ties, concurrent retries and atomic rollback.');
    console.log('PASS: activity validation/freshness/source isolation, low activity settings and legacy constraint migration.');
    console.log('PASS: static files, auth, freshness, settings application, idempotency, handling, filters, pagination and 24 repeat-safe samples.');
  } catch (error) {
    console.error('Integration verification failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (server && server.exitCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve));
      server.kill();
      await exited;
    }
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
})();

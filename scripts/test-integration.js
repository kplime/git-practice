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

    const demoHeartbeat = { gatewayId: 'demo-test-gateway', generation: 1, sequence: 1, sensorAvailable: true, qualityStatus: 'AVAILABLE', bedState: 'OUT_OF_BED', measuredAt: timestamp, bedExitedAt: timestamp, appliedSettingsVersion: 1, isDemo: true };
    assert.equal((await call('/ingest/status', 'POST', demoHeartbeat, true)).status, 202);
    const demoOnlyStatus = (await call('/status')).body;
    assert.equal(demoOnlyStatus.gateway.connected, false, 'fresh sample heartbeats never establish live observation');
    assert.equal(demoOnlyStatus.gateway.receivedAt, null);
    assert.equal(demoOnlyStatus.sensor.available, false);
    assert.equal(demoOnlyStatus.sensor.fresh, false);
    assert.equal(demoOnlyStatus.sensor.measuredAt, null);
    assert.equal(demoOnlyStatus.bedState, 'UNKNOWN');
    assert.equal(demoOnlyStatus.bedExitedAt, null);
    assert.equal(demoOnlyStatus.settings.appliedVersion, null);
    const heartbeat = { gatewayId: 'real-test-gateway', generation: 1, sequence: 1, sensorAvailable: true, qualityStatus: 'AVAILABLE', bedState: 'OUT_OF_BED', measuredAt: timestamp, isDemo: false };
    assert.equal((await call('/ingest/status', 'POST', heartbeat, true)).status, 202);
    assert.equal((await call('/ingest/status', 'POST', heartbeat, true)).status, 409);
    assert.equal((await call('/status')).body.gateway.connected, true);
    assert.equal((await call('/status')).body.isDemo, false);
    assert.equal((await call('/status')).body.sensor.fresh, true);
    assert.equal((await call('/status')).body.settings.appliedVersion, null, 'legacy heartbeat never claims settings applied');
    const exitedAt = new Date(Date.now() - 14 * 60000).toISOString();
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, sequence: 2, bedExitedAt: exitedAt, appliedSettingsVersion: 1 }, true)).status, 202);
    const extendedStatus = (await call('/status')).body;
    assert.equal(extendedStatus.bedExitedAt, exitedAt);
    assert.equal(extendedStatus.settings.appliedVersion, 1);
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, sequence: 3, measuredAt: new Date(Date.now() - 60000).toISOString() }, true)).status, 202);
    const staleMeasurement = (await call('/status')).body;
    assert.equal(staleMeasurement.gateway.connected, true);
    assert.equal(staleMeasurement.sensor.fresh, false, 'recent heartbeat does not refresh old measurements');
    assert.ok(staleMeasurement.sensor.ageSeconds >= 60);
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, sequence: 4, bedExitedAt: 'bad-date' }, true)).status, 400);
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
    assert.equal(initial.bedMonitoringEnabled, true);
    assert.equal(initial.bedMonitoringMode, 'ALL_DAY', 'existing all-day behavior is preserved');
    assert.equal(initial.timeZone, 'Asia/Seoul');
    for (const key of ['fallAlertEnabled', 'sensorFaultAlertEnabled', 'gatewayFaultAlertEnabled']) assert.equal(initial[key], true);
    assert.equal((await call('/settings', 'PATCH', { nonReturnMinutes: 0 })).status, 400);
    const updated = (await call('/settings', 'PATCH', { nonReturnMinutes: 15 })).body;
    assert.equal(updated.version, initial.version + 1);
    assert.equal((await call('/gateway/settings', 'GET', undefined, true)).body.nonReturnMinutes, 15);
    const schedule = { bedMonitoringEnabled: true, bedMonitoringMode: 'TIME_RANGE', bedMonitoringStart: '22:00', bedMonitoringEnd: '07:00' };
    const scheduled = await call('/settings', 'PATCH', schedule);
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.body.version, updated.version + 1);
    assert.equal(scheduled.body.nonReturnMinutes, 15, 'partial patch preserves other fields');
    for (const [key, value] of Object.entries(schedule)) assert.equal(scheduled.body[key], value);
    assert.deepEqual((await call('/gateway/settings', 'GET', undefined, true)).body, scheduled.body);
    assert.equal((await call('/status')).body.settings.bedMonitoringStart, '22:00');
    for (const invalid of [
      { bedMonitoringStart: '24:00' }, { bedMonitoringEnd: '7:00' }, { bedMonitoringEnabled: 'true' },
      { bedMonitoringMode: 'NIGHT' }, { bedMonitoringEnd: '22:00' }, { arbitraryField: 1 }, {},
    ]) assert.equal((await call('/settings', 'PATCH', invalid)).status, 400, JSON.stringify(invalid));
    assert.deepEqual((await call('/settings')).body, scheduled.body, 'invalid requests change neither settings nor version');
    const disabled = (await call('/settings', 'PATCH', { bedMonitoringEnabled: false })).body;
    assert.equal(disabled.bedMonitoringEnabled, false);
    assert.equal(disabled.bedMonitoringStart, '22:00');
    assert.equal((await call('/settings', 'PATCH', { bedMonitoringEnabled: true, bedMonitoringMode: 'ALL_DAY' })).status, 200);
    const previousEvents = (await call('/events?limit=100')).body;
    const alertOptions = { fallAlertEnabled: false, sensorFaultAlertEnabled: false, gatewayFaultAlertEnabled: true };
    const beforeAlerts = (await call('/settings')).body;
    const changedAlerts = (await call('/settings', 'PATCH', alertOptions)).body;
    assert.equal(changedAlerts.version, beforeAlerts.version + 1);
    for (const [key, value] of Object.entries(alertOptions)) assert.equal(changedAlerts[key], value);
    assert.equal(changedAlerts.nonReturnMinutes, beforeAlerts.nonReturnMinutes);
    assert.equal(changedAlerts.bedMonitoringStart, beforeAlerts.bedMonitoringStart);
    assert.deepEqual((await call('/gateway/settings', 'GET', undefined, true)).body, changedAlerts);
    for (const invalid of [{ fallAlertEnabled: 'false' }, { sensorFaultAlertEnabled: 0 }, { gatewayFaultAlertEnabled: null }]) {
      assert.equal((await call('/settings', 'PATCH', invalid)).status, 400);
    }
    assert.deepEqual((await call('/settings')).body, changedAlerts);
    assert.deepEqual((await call('/events?limit=100')).body, previousEvents, 'changing alert options preserves event history');
    assert.equal((await call('/missing')).status, 404);
    const python = path.join(__dirname, '..', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (fs.existsSync(python)) {
      const policy = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_detection_policy.py'], {
        cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(policy.status, 0, `Python schedule policy: ${policy.stderr || policy.error?.message || ''}`);
      console.log('PASS: Python schedule boundaries, overnight windows, disabled/all-day mode and fall/fault isolation.');
      const demo = spawnSync(python, ['python/send_demo.py'], {
        cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, API_BASE_URL: base, GATEWAY_TOKEN: token },
      });
      assert.equal(demo.status, 0, `Python API smoke: ${demo.stderr || demo.error?.message || ''}`);
      const pythonEvents = (await call('/events')).body.items.filter((event) => event.details.source === 'send_demo.py');
      assert.equal(pythonEvents.length, 4);
      assert.equal(pythonEvents.every((event) => event.isDemo), true);
      console.log('PASS: Python gateway client -> real Express API -> PostgreSQL (four labelled demo events).');
    } else { console.log('SKIP: Python API smoke (.venv not installed).'); }
    const seed = () => {
      const result = spawnSync(process.execPath, ['scripts/demo.js', '--seed-only'], {
        cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
      });
      assert.equal(result.status, 0, `Sample seeding: ${result.stderr || result.error?.message || ''}`);
      return result.stdout;
    };
    assert.match(seed(), /inserted 24/);
    const samples = (await call('/events?limit=100')).body.items.filter((event) => event.details.source === 'ui-sample-v1');
    assert.equal(samples.length, 24);
    assert.equal(new Set(samples.map((event) => event.type)).size, 4);
    assert.equal(new Set(samples.map((event) => event.state)).size, 3);
    assert.equal(samples.every((event) => event.isDemo), true);
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, gatewayId: 'real-room', isDemo: false, measuredAt: new Date().toISOString() }, true)).status, 202);
    assert.equal((await call('/ingest/status', 'POST', { ...heartbeat, gatewayId: 'sample-room-gateway', isDemo: true, measuredAt: new Date().toISOString() }, true)).status, 202);
    assert.equal((await call('/events/sample-ui-04')).body.actions.length, 3);
    await call('/events/sample-ui-01/ack', 'POST', {});
    const beforeReseed = (await call('/events/sample-ui-01')).body;
    assert.match(seed(), /inserted 0/);
    const afterReseed = (await call('/events/sample-ui-01')).body;
    assert.deepEqual(afterReseed, beforeReseed, 'repeated seeding keeps actions and user handling');
    assert.equal((await call('/status')).body.gateway.id, 'real-room', 'real heartbeat takes priority over sample fixtures');
    await admin.query(`UPDATE "${schema}".gateways SET received_at=NOW()-INTERVAL '1 minute', measured_at=NOW()-INTERVAL '1 minute' WHERE is_demo=FALSE AND received_at IS NOT NULL`);
    const staleRealStatus = (await call('/status')).body;
    assert.equal(staleRealStatus.gateway.connected, false, 'fresh samples cannot replace a stale real gateway');
    assert.equal(staleRealStatus.sensor.fresh, false);
    assert.equal(staleRealStatus.isDemo, false);
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

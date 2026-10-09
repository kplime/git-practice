const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { pool, initializeDatabase, withTransaction } = require('./db');
const { parseActivity, validLowActivityEvent, validScore, validMinutes } = require('./activity');
const { historySample, historyQuery, mapSample } = require('./activity-history');

const app = express();
const projectRoot = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3002);
const offlineAfterSeconds = 15;
const validEventTypes = new Set([
  'FALL_SUSPECTED',
  'LOW_ACTIVITY',
  'SENSOR_UNAVAILABLE',
  'GATEWAY_OFFLINE',
]);

// Historical non-return events remain queryable; new episodes are retired.
const readableEventTypes = new Set([...validEventTypes, 'NON_RETURN_WARNING']);

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb', strict: true }));

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function constantTimeEqual(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireGatewayToken(req, res, next) {
  const expected = process.env.GATEWAY_TOKEN;
  const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!expected || expected === 'replace-with-a-long-random-secret') {
    return sendError(res, 503, 'GATEWAY_AUTH_NOT_CONFIGURED', '게이트웨이 토큰이 설정되지 않았습니다.');
  }
  if (!constantTimeEqual(expected, supplied)) {
    return sendError(res, 401, 'UNAUTHORIZED', '게이트웨이 인증에 실패했습니다.');
  }
  return next();
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mapEvent(row) {
  return {
    eventId: row.event_id,
    gatewayId: row.gateway_id,
    type: row.event_type,
    occurredAt: new Date(row.occurred_at).toISOString(),
    detectedAt: new Date(row.detected_at).toISOString(),
    receivedAt: new Date(row.received_at).toISOString(),
    score: row.score,
    qualityStatus: row.quality_status,
    modelVersion: row.model_version,
    state: row.state,
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    observed: row.observed,
    resolutionReason: row.resolution_reason,
    isDemo: row.is_demo,
    details: row.payload_json.details || {},
  };
}

async function getSettings() {
  const { rows: [row] } = await pool.query(
    'SELECT * FROM settings WHERE singleton_id = 1',
  );
  return {
    version: row.version,
    fallAlertEnabled: row.fall_alert_enabled,
    sensorFaultAlertEnabled: row.sensor_fault_alert_enabled,
    gatewayFaultAlertEnabled: row.gateway_fault_alert_enabled,
    lowActivityEnabled: row.low_activity_enabled,
    lowActivityMinutes: row.low_activity_minutes,
    lowActivityThreshold: row.low_activity_threshold,
    lowActivityMode: row.low_activity_mode,
    lowActivityStart: row.low_activity_start.slice(0, 5),
    lowActivityEnd: row.low_activity_end.slice(0, 5),
    timeZone: 'Asia/Seoul',
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'wifi-csi-elderly-safety', time: new Date().toISOString() });
});

app.get('/api/status', async (_req, res) => {
  const { rows: [row] } = await pool.query(`SELECT * FROM gateways
    WHERE is_demo = FALSE AND received_at IS NOT NULL
    ORDER BY received_at DESC, gateway_id DESC LIMIT 1`);
  const settings = await getSettings();
  const now = Date.now();

  if (!row) {
    return res.json({
      gateway: { connected: false, receivedAt: null, ageSeconds: null },
      sensor: { available: false, qualityStatus: 'UNKNOWN', measuredAt: null, ageSeconds: null, fresh: false },
      activity: null,
      settings: { ...settings, appliedVersion: null },
      isDemo: false,
      fetchedAt: new Date(now).toISOString(),
    });
  }

  const ageSeconds = row.received_at
    ? Math.max(0, Math.floor((now - new Date(row.received_at).getTime()) / 1000))
    : null;
  const measurementAgeMs = row.measured_at ? now - new Date(row.measured_at).getTime() : null;
  const observable = ageSeconds !== null && ageSeconds <= offlineAfterSeconds && row.sensor_available &&
    row.quality_status === 'AVAILABLE' && measurementAgeMs !== null && measurementAgeMs >= -5000 &&
    measurementAgeMs <= offlineAfterSeconds * 1000;
  return res.json({
    gateway: {
      id: row.gateway_id,
      connected: ageSeconds !== null && ageSeconds <= offlineAfterSeconds,
      receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
      ageSeconds,
      generation: row.generation,
      sequence: row.sequence,
    },
    sensor: {
      available: row.sensor_available,
      qualityStatus: row.quality_status,
      measuredAt: row.measured_at ? new Date(row.measured_at).toISOString() : null,
      ageSeconds: measurementAgeMs === null ? null : Math.max(0, Math.floor(measurementAgeMs / 1000)),
      fresh: measurementAgeMs !== null && measurementAgeMs >= -5000 && measurementAgeMs <= offlineAfterSeconds * 1000,
    },
    settings: { ...settings, appliedVersion: row.applied_settings_version },
    activity: observable ? row.activity_json : null,
    isDemo: row.is_demo,
    fetchedAt: new Date(now).toISOString(),
  });
});

app.get('/api/activity/history', async (req, res) => {
  let query;
  try { query = historyQuery(req.query); }
  catch (error) { return sendError(res, 400, error.message, '기기·조회 기간(최대 7일)·조회 개수·페이지를 확인해 주세요.'); }
  if (!query.gatewayId) {
    const { rows: [latest] } = await pool.query(`SELECT gateway_id FROM gateways
      WHERE is_demo = FALSE AND received_at IS NOT NULL ORDER BY received_at DESC, gateway_id DESC LIMIT 1`);
    query.gatewayId = latest?.gateway_id ?? null;
  }
  const values = [query.gatewayId, query.from, query.to];
  let continuation = '';
  if (query.cursor) {
    values.push(query.cursor.at, query.cursor.generation, query.cursor.sequence);
    continuation = 'AND (sampled_at, generation, sequence) < ($4::timestamptz, $5::integer, $6::integer)';
  }
  values.push(query.limit + 1);
  const { rows } = await pool.query(`SELECT * FROM activity_history WHERE gateway_id = $1
    AND sampled_at >= $2::timestamptz AND sampled_at < $3::timestamptz ${continuation}
    ORDER BY sampled_at DESC, generation DESC, sequence DESC LIMIT $${values.length}`, values);
  const items = rows.slice(0, query.limit).map(mapSample);
  const last = items.at(-1);
  const nextCursor = rows.length > query.limit ? Buffer.from(JSON.stringify({
    gatewayId: query.gatewayId, from: query.from, to: query.to,
    at: last.sampledAt, generation: last.generation, sequence: last.sequence,
  })).toString('base64url') : null;
  return res.json({ gatewayId: query.gatewayId, from: query.from, to: query.to, items, nextCursor });
});

app.get('/api/events', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
  const clauses = [];
  const values = [];
  const bounds = {};
  for (const key of ['from', 'to']) {
    const value = req.query[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
        !validTimestamp(value) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) {
      return sendError(res, 400, 'INVALID_PERIOD', '조회 기간은 올바른 UTC ISO 시각으로 지정하세요.');
    }
    bounds[key] = new Date(value);
  }
  if (bounds.from && bounds.to && bounds.from >= bounds.to) {
    return sendError(res, 400, 'INVALID_PERIOD', '종료 시각은 시작 시각 이후여야 합니다.');
  }
  for (const [key, operator] of [['from', '>='], ['to', '<']]) {
    if (!bounds[key]) continue;
    values.push(bounds[key].toISOString());
    clauses.push(`occurred_at ${operator} $${values.length}::timestamptz`);
  }

  if (req.query.cursor !== undefined) {
    let cursor;
    try { cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString('utf8')); } catch { /* invalid cursor */ }
    if (!cursor || !validTimestamp(cursor.at) || !validIdentifier(cursor.id)) {
      return sendError(res, 400, 'INVALID_CURSOR', '서버가 반환한 nextCursor를 그대로 사용하세요.');
    }
    values.push(cursor.at, cursor.id);
    clauses.push(`(occurred_at, event_id) < ($${values.length - 1}::timestamptz, $${values.length}::text)`);
  }
  if (req.query.type !== undefined) {
    if (req.query.type === 'FAULT') {
      clauses.push("event_type IN ('SENSOR_UNAVAILABLE', 'GATEWAY_OFFLINE')");
    } else {
      if (!readableEventTypes.has(req.query.type)) return sendError(res, 400, 'INVALID_TYPE', '지원하지 않는 사건 유형입니다.');
      values.push(req.query.type);
      clauses.push(`event_type = $${values.length}`);
    }
  }
  if (req.query.state !== undefined) {
    if (!['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(req.query.state)) {
      return sendError(res, 400, 'INVALID_STATE', '지원하지 않는 처리 상태입니다.');
    }
    values.push(req.query.state);
    clauses.push(`state = $${values.length}`);
  }

  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM events ${where} ORDER BY occurred_at DESC, event_id DESC LIMIT $${values.length}`,
    values,
  );
  return res.json({
    items: rows.map(mapEvent),
    nextCursor: rows.length === limit ? Buffer.from(JSON.stringify({
      at: new Date(rows.at(-1).occurred_at).toISOString(), id: rows.at(-1).event_id,
    })).toString('base64url') : null,
  });
});

app.get('/api/events/:id', async (req, res) => {
  const { rows: [event] } = await pool.query('SELECT * FROM events WHERE event_id = $1', [req.params.id]);
  if (!event) return sendError(res, 404, 'EVENT_NOT_FOUND', '사건을 찾을 수 없습니다.');

  const { rows } = await pool.query(`
    SELECT action_type, actor, created_at, detail_json
    FROM event_actions WHERE event_id = $1 ORDER BY action_id ASC
  `, [req.params.id]);
  const actions = rows.map((row) => ({
    type: row.action_type,
    actor: row.actor,
    createdAt: new Date(row.created_at).toISOString(),
    detail: row.detail_json,
  }));
  return res.json({ ...mapEvent(event), actions });
});

app.post('/api/events/:id/ack', async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: [event] } = await client.query('SELECT * FROM events WHERE event_id = $1 FOR UPDATE', [req.params.id]);
    if (!event) return { missing: true };
    if (event.state === 'RESOLVED') return { item: mapEvent(event), duplicate: true };

    if (event.state === 'OPEN') {
      const now = new Date();
      const { rows: [updated] } = await client.query(`
        UPDATE events SET state = 'ACKNOWLEDGED', acknowledged_at = $1
        WHERE event_id = $2 RETURNING *
      `, [now, req.params.id]);
      await client.query(`
        INSERT INTO event_actions (event_id, action_type, actor, created_at)
        VALUES ($1, 'ACKNOWLEDGED', 'guardian', $2)
      `, [req.params.id, now]);
      return { item: mapEvent(updated), duplicate: false };
    }
    return { item: mapEvent(event), duplicate: true };
  });

  if (result.missing) return sendError(res, 404, 'EVENT_NOT_FOUND', '사건을 찾을 수 없습니다.');
  return res.json(result);
});

app.post('/api/events/:id/resolve', async (req, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (req.body?.observed !== true || reason.length < 3 || reason.length > 1000) {
    return sendError(res, 400, 'RESOLUTION_REQUIRES_OBSERVATION', '직접 관찰 확인과 3~1000자의 해소 사유가 필요합니다.');
  }

  const result = await withTransaction(async (client) => {
    const { rows: [event] } = await client.query('SELECT * FROM events WHERE event_id = $1 FOR UPDATE', [req.params.id]);
    if (!event) return { missing: true };
    if (event.state === 'RESOLVED') return { alreadyResolved: true };

    const now = new Date();
    const { rows: [updated] } = await client.query(`
      UPDATE events SET state = 'RESOLVED', resolved_at = $1, observed = TRUE, resolution_reason = $2
      WHERE event_id = $3 RETURNING *
    `, [now, reason, req.params.id]);
    await client.query(`
      INSERT INTO event_actions (event_id, action_type, actor, created_at, detail_json)
      VALUES ($1, 'RESOLVED', 'guardian', $2, $3::jsonb)
    `, [req.params.id, now, JSON.stringify({ observed: true, reason })]);
    return { item: mapEvent(updated) };
  });

  if (result.missing) return sendError(res, 404, 'EVENT_NOT_FOUND', '사건을 찾을 수 없습니다.');
  if (result.alreadyResolved) return sendError(res, 409, 'ALREADY_RESOLVED', '이미 해소 기록이 있습니다.');
  return res.json(result);
});

app.get('/api/settings', async (_req, res) => res.json(await getSettings()));

app.patch('/api/settings', async (req, res) => {
  const keys = Object.keys(req.body || {});
  const allowed = ['fallAlertEnabled', 'sensorFaultAlertEnabled', 'gatewayFaultAlertEnabled',
    'lowActivityEnabled', 'lowActivityMinutes', 'lowActivityThreshold',
    'lowActivityMode', 'lowActivityStart', 'lowActivityEnd'];
  if (!keys.length || keys.some((key) => !allowed.includes(key))) {
    return sendError(res, 400, 'INVALID_SETTINGS', '변경할 수 없는 설정이 포함됐습니다.');
  }
  const patch = req.body;
  if (['fallAlertEnabled', 'sensorFaultAlertEnabled', 'gatewayFaultAlertEnabled', 'lowActivityEnabled'].some((key) => keys.includes(key) && typeof patch[key] !== 'boolean')) {
    return sendError(res, 400, 'INVALID_ALERT_OPTIONS', '감지 사용 여부는 켜기 또는 끄기로 지정해 주세요.');
  }
  if ((keys.includes('lowActivityMinutes') && !validMinutes(patch.lowActivityMinutes)) ||
      (keys.includes('lowActivityThreshold') && !validScore(patch.lowActivityThreshold))) {
    return sendError(res, 400, 'INVALID_LOW_ACTIVITY_SETTINGS', '저활동 기준은 1~1440분 정수와 0~1 활동 지표로 지정해 주세요.');
  }
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if ((keys.includes('lowActivityMode') && !['ALL_DAY', 'TIME_RANGE'].includes(patch.lowActivityMode)) ||
      ['lowActivityStart', 'lowActivityEnd'].some(key => keys.includes(key) && !validTime(patch[key]))) {
    return sendError(res, 400, 'INVALID_LOW_ACTIVITY_SCHEDULE', '감지 시간대와 시작·종료 시각(HH:mm)을 확인해 주세요.');
  }
  const saved = await withTransaction(async (client) => {
    const { rows: [current] } = await client.query('SELECT * FROM settings WHERE singleton_id = 1 FOR UPDATE');
    const start = patch.lowActivityStart ?? current.low_activity_start.slice(0, 5);
    const end = patch.lowActivityEnd ?? current.low_activity_end.slice(0, 5);
    if (start === end) return false;
    await client.query(`UPDATE settings SET
      fall_alert_enabled = $1, sensor_fault_alert_enabled = $2, gateway_fault_alert_enabled = $3,
      low_activity_enabled = $4, low_activity_minutes = $5, low_activity_threshold = $6,
      low_activity_mode = $7, low_activity_start = $8::time, low_activity_end = $9::time,
      version = version + 1, updated_at = NOW() WHERE singleton_id = 1`,
    [patch.fallAlertEnabled ?? current.fall_alert_enabled,
      patch.sensorFaultAlertEnabled ?? current.sensor_fault_alert_enabled,
      patch.gatewayFaultAlertEnabled ?? current.gateway_fault_alert_enabled,
      patch.lowActivityEnabled ?? current.low_activity_enabled, patch.lowActivityMinutes ?? current.low_activity_minutes,
      patch.lowActivityThreshold ?? current.low_activity_threshold,
      patch.lowActivityMode ?? current.low_activity_mode, start, end]);
    return true;
  });
  if (!saved) return sendError(res, 400, 'INVALID_LOW_ACTIVITY_SCHEDULE', '시작 시각과 종료 시각은 다르게 지정해 주세요. 상시 감지는 상시를 선택하세요.');
  return res.json(await getSettings());
});

app.get('/api/gateway/settings', requireGatewayToken, async (_req, res) => res.json(await getSettings()));

app.post('/api/ingest/status', requireGatewayToken, async (req, res) => {
  const body = req.body || {};
  const qualityStatuses = new Set(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN']);
  const activity = parseActivity(body);
  if (activity === false) return sendError(res, 400, 'INVALID_ACTIVITY', '활동 지표·측정 구간·출처·버전을 확인해 주세요.');

  if (!validIdentifier(body.gatewayId) || !Number.isSafeInteger(body.generation) || body.generation < 1 || body.generation > 2147483647 ||
      !Number.isSafeInteger(body.sequence) || body.sequence < 0 || body.sequence > 2147483647 || typeof body.sensorAvailable !== 'boolean' ||
      !qualityStatuses.has(body.qualityStatus) ||
      (body.measuredAt !== null && !validTimestamp(body.measuredAt)) ||
      (body.isDemo !== undefined && typeof body.isDemo !== 'boolean') ||
      (body.appliedSettingsVersion !== undefined && body.appliedSettingsVersion !== null &&
        (!Number.isInteger(body.appliedSettingsVersion) || body.appliedSettingsVersion < 1 || body.appliedSettingsVersion > 2147483647))) {
    return sendError(res, 400, 'INVALID_STATUS', '상태 필드 또는 값이 올바르지 않습니다.');
  }

  const receivedAt = await withTransaction(async client => {
    await client.query('INSERT INTO gateways (gateway_id) VALUES ($1) ON CONFLICT (gateway_id) DO NOTHING', [body.gatewayId]);
    const { rows: [previous] } = await client.query('SELECT * FROM gateways WHERE gateway_id = $1 FOR UPDATE', [body.gatewayId]);
    if (body.generation < previous.generation || (body.generation === previous.generation && body.sequence <= previous.sequence)) return null;
    const received = new Date();
    const sample = historySample(body, activity, previous, received);
    const currentActivity = body.sensorAvailable && body.qualityStatus === 'AVAILABLE' && activity && (!sample || !sample.reason) ? activity : null;
    await client.query(`UPDATE gateways SET generation=$2, sequence=$3, sensor_available=$4, quality_status=$5,
      measured_at=$6, received_at=$7, is_demo=$8, applied_settings_version=$9, activity_json=$10::jsonb,
      activity_watermark_at=$11 WHERE gateway_id=$1`, [body.gatewayId, body.generation, body.sequence,
      body.sensorAvailable, body.qualityStatus, body.measuredAt || null, received, body.isDemo ?? false,
      body.appliedSettingsVersion ?? null, currentActivity ? JSON.stringify(currentActivity) : null,
      sample ? sample.watermark : body.generation === previous.generation ? previous.activity_watermark_at : null]);
    if (sample) await client.query(`INSERT INTO activity_history
      (gateway_id,generation,sequence,sampled_at,measured_at,received_at,window_started_at,score,quality_status,model_version,calibration_version,reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [body.gatewayId, body.generation, body.sequence,
      sample.sampledAt, body.measuredAt || null, received, activity?.windowStartedAt ?? null, sample.score,
      body.qualityStatus, activity?.modelVersion ?? null, activity?.calibrationVersion ?? null, sample.reason]);
    return received;
  });
  if (!receivedAt) return sendError(res, 409, 'STALE_STATUS', '이전 세대 또는 순번의 상태입니다.');
  return res.status(202).json({ accepted: true, receivedAt: receivedAt.toISOString() });
});

app.post('/api/ingest/events', requireGatewayToken, async (req, res) => {
  const body = req.body || {};
  if (body.type === 'LOW_ACTIVITY' && !validLowActivityEvent(body)) {
    return sendError(res, 400, 'INVALID_LOW_ACTIVITY_EVENT', '저활동 사건의 관측 시간·활동 지표·기준·출처를 확인해 주세요.');
  }
  if (!validIdentifier(body.eventId) || !validIdentifier(body.gatewayId) || !readableEventTypes.has(body.type) ||
      !validTimestamp(body.occurredAt) || !validTimestamp(body.detectedAt)) {
    return sendError(res, 400, 'INVALID_EVENT', '사건 필수 필드 또는 값이 올바르지 않습니다.');
  }
  if (body.score !== undefined && body.score !== null &&
      (typeof body.score !== 'number' || !Number.isFinite(body.score) || body.score < 0 || body.score > 1)) {
    return sendError(res, 400, 'INVALID_SCORE', 'score는 0~1 숫자여야 합니다.');
  }

  if ((body.qualityStatus !== undefined && !['AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'].includes(body.qualityStatus)) ||
      (body.isDemo !== undefined && typeof body.isDemo !== 'boolean')) {
    return sendError(res, 400, 'INVALID_EVENT', '품질 상태 또는 시험 데이터 표시가 올바르지 않습니다.');
  }

  const payload = {
    eventId: body.eventId,
    gatewayId: body.gatewayId,
    type: body.type,
    occurredAt: body.occurredAt,
    detectedAt: body.detectedAt,
    score: body.score ?? null,
    qualityStatus: typeof body.qualityStatus === 'string' ? body.qualityStatus : 'UNKNOWN',
    modelVersion: typeof body.modelVersion === 'string' ? body.modelVersion.slice(0, 100) : null,
    details: body.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : {},
    isDemo: body.isDemo ?? false,
  };

  if (!validEventTypes.has(payload.type)) {
    const { rows: [previous] } = await pool.query(
      'SELECT payload_json FROM events WHERE event_id = $1', [payload.eventId],
    );
    if (!previous) return sendError(res, 400, 'RETIRED_EVENT_TYPE', '더 이상 새로 생성하지 않는 사건 유형입니다.');
    if (stableJson(previous.payload_json) !== stableJson(payload)) {
      return sendError(res, 409, 'EVENT_ID_CONFLICT', '같은 eventId에 다른 내용이 전달되었습니다.');
    }
    return res.json({ accepted: true, duplicate: true, eventId: payload.eventId });
  }

  const result = await withTransaction(async (client) => {
    await client.query(`INSERT INTO gateways (gateway_id) VALUES ($1)
      ON CONFLICT (gateway_id) DO NOTHING`, [payload.gatewayId]);
    const receivedAt = new Date();
    const inserted = await client.query(`
      INSERT INTO events (event_id, gateway_id, event_type, occurred_at, detected_at, received_at,
        score, quality_status, model_version, payload_json, is_demo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
    `, [payload.eventId, payload.gatewayId, payload.type, payload.occurredAt, payload.detectedAt,
      receivedAt, payload.score, payload.qualityStatus, payload.modelVersion, JSON.stringify(payload), payload.isDemo]);
    if (!inserted.rowCount) {
      const { rows: [previous] } = await client.query(
        'SELECT payload_json FROM events WHERE event_id = $1', [payload.eventId],
      );
      return {
        duplicate: previous && stableJson(previous.payload_json) === stableJson(payload),
        conflict: !previous || stableJson(previous.payload_json) !== stableJson(payload),
      };
    }
    await client.query(`
      INSERT INTO event_actions (event_id, action_type, actor, created_at, detail_json)
      VALUES ($1, 'CREATED', 'gateway', $2, $3::jsonb)
    `, [payload.eventId, receivedAt, JSON.stringify({ type: payload.type })]);
    return { conflict: false, duplicate: false, receivedAt };
  });

  if (result.conflict) return sendError(res, 409, 'EVENT_ID_CONFLICT', '같은 eventId에 다른 내용이 전달되었습니다.');
  if (result.duplicate) {
    return res.status(200).json({ accepted: true, duplicate: true, eventId: payload.eventId });
  }
  return res.status(201).json({
    accepted: true,
    duplicate: false,
    eventId: payload.eventId,
    receivedAt: result.receivedAt.toISOString(),
  });
});

app.use(express.static(path.join(projectRoot, 'public'), { dotfiles: 'deny', index: 'index.html' }));
app.use('/api', (_req, res) => sendError(res, 404, 'NOT_FOUND', 'API 경로를 찾을 수 없습니다.'));
app.use((_req, res) => res.status(404).send('페이지를 찾을 수 없습니다.'));

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return sendError(res, 400, 'INVALID_JSON', 'JSON 형식이 올바르지 않습니다.');
  }
  console.error('API error:', error.code || error.name);
  return sendError(res, 500, 'INTERNAL_ERROR', '서버 내부 오류가 발생했습니다.');
});

async function start() {
  await initializeDatabase();
  const server = app.listen(port, host, (error) => {
    if (error) return; // Express 5 also invokes the callback when binding fails.
    console.log(`온가드(OnGuard) 시제품 서버: http://${host}:${port}`);
    console.log(`PostgreSQL: ${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || '(환경 변수 기본값)'}`);
  });
  server.on('error', async (error) => {
    console.error(error.code === 'EADDRINUSE'
      ? `포트 ${port}가 사용 중입니다. .env의 PORT와 API_BASE_URL을 함께 변경하세요.`
      : `서버 연결 오류: ${error.code || error.name}`);
    await pool.end();
    process.exitCode = 1;
  });

  async function shutdown() {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch(async (error) => {
  console.error('서버를 시작하지 못했습니다. PostgreSQL 접속 설정과 DB 권한을 확인하세요.');
  console.error(error.message);
  await pool.end();
  process.exitCode = 1;
});

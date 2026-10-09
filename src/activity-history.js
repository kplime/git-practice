const { validUtcTimestamp } = require('./activity');
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
const integer = (value, min) => Number.isInteger(value) && value >= min && value <= 2147483647;
const maxSpan = 7 * 86400000;

// A received heartbeat can describe a gap. Never replace an unknown score with 0.
function historySample(body, activity, previous, receivedAt) {
  if (body.isDemo !== false) return null;
  const watermark = previous.generation === body.generation ? previous.activity_watermark_at : null;
  const end = body.measuredAt ? Date.parse(body.measuredAt) : NaN;
  const age = receivedAt.getTime() - end;
  let reason = null;
  if (!body.sensorAvailable || body.qualityStatus !== 'AVAILABLE') reason = 'SENSING_UNAVAILABLE';
  else if (!activity) reason = 'NO_ACTIVITY';
  else if (age < -5000 || age > 15000) reason = 'STALE_MEASUREMENT';
  else if (watermark && end <= new Date(watermark).getTime()) reason = 'REPEATED_MEASUREMENT';
  const nextWatermark = activity && body.sensorAvailable && body.qualityStatus === 'AVAILABLE' &&
    age >= -5000 && age <= 15000 && (!watermark || end > new Date(watermark).getTime())
    ? new Date(end) : watermark;
  return { sampledAt: reason ? receivedAt : new Date(end), reason,
    score: reason ? null : activity.score, watermark: nextWatermark || null };
}

function historyQuery(query, now = new Date()) {
  let cursor = null;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string' || query.cursor.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error('INVALID_CURSOR');
    try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { throw new Error('INVALID_CURSOR'); }
    if (!cursor || !identifier(cursor.gatewayId) || !validUtcTimestamp(cursor.at) ||
        !validUtcTimestamp(cursor.from) || !validUtcTimestamp(cursor.to) ||
        !integer(cursor.generation, 1) || !integer(cursor.sequence, 0)) throw new Error('INVALID_CURSOR');
  }
  if (query.gatewayId !== undefined && !identifier(query.gatewayId)) throw new Error('INVALID_GATEWAY');
  const limitValue = query.limit ?? '500';
  if (typeof limitValue !== 'string' || !/^\d{1,4}$/.test(limitValue) || +limitValue < 1 || +limitValue > 1000) throw new Error('INVALID_LIMIT');
  const to = query.to ?? cursor?.to ?? now.toISOString();
  if (!validUtcTimestamp(to)) throw new Error('INVALID_PERIOD');
  const from = query.from ?? cursor?.from ?? new Date(Date.parse(to) - 3600000).toISOString();
  if (!validUtcTimestamp(from) || !validUtcTimestamp(to) || Date.parse(from) >= Date.parse(to) ||
      Date.parse(to) - Date.parse(from) > maxSpan) throw new Error('INVALID_PERIOD');
  const bounds = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  if (cursor && ((query.gatewayId !== undefined && query.gatewayId !== cursor.gatewayId) ||
      bounds.from !== cursor.from || bounds.to !== cursor.to || Date.parse(cursor.at) < Date.parse(from) ||
      Date.parse(cursor.at) >= Date.parse(to))) throw new Error('INVALID_CURSOR');
  return { ...bounds, gatewayId: query.gatewayId ?? cursor?.gatewayId ?? null, limit: +limitValue, cursor };
}

function mapSample(row) {
  const iso = value => value ? new Date(value).toISOString() : null;
  return { generation: row.generation, sequence: row.sequence, sampledAt: iso(row.sampled_at),
    measuredAt: iso(row.measured_at), receivedAt: iso(row.received_at), windowStartedAt: iso(row.window_started_at),
    score: row.score, qualityStatus: row.quality_status, modelVersion: row.model_version,
    calibrationVersion: row.calibration_version, reason: row.reason };
}

module.exports = { historySample, historyQuery, mapSample };

const test = require('node:test');
const assert = require('node:assert/strict');
const { historySample, historyQuery } = require('../src/activity-history');
const now = new Date('2026-10-08T00:00:10.000Z');
const body = { isDemo: false, generation: 1, sensorAvailable: true, qualityStatus: 'AVAILABLE', measuredAt: now.toISOString() };
const activity = { score: 0, windowStartedAt: '2026-10-08T00:00:00.000Z' };

test('history records explicit real zero and gaps, excluding demo and unidentified sources', () => {
  assert.equal(historySample({ ...body, isDemo: true }, activity, {}, now), null);
  assert.equal(historySample({ ...body, isDemo: undefined }, activity, {}, now), null);
  const sample = historySample(body, activity, {}, now);
  assert.equal(sample.score, 0); assert.equal(sample.reason, null);
  for (const [patch, input, reason] of [
    [{}, null, 'NO_ACTIVITY'], [{ qualityStatus: 'DEGRADED' }, activity, 'SENSING_UNAVAILABLE'],
    [{ sensorAvailable: false }, activity, 'SENSING_UNAVAILABLE'],
    [{ measuredAt: '2026-10-07T23:59:00.000Z' }, activity, 'STALE_MEASUREMENT'],
    [{ measuredAt: '2026-10-08T00:00:16.000Z' }, activity, 'STALE_MEASUREMENT'],
  ]) {
    const gap = historySample({ ...body, ...patch }, input, {}, now);
    assert.equal(gap.score, null); assert.equal(gap.reason, reason); assert.equal(gap.sampledAt, now);
  }
});

test('measurement watermark survives missing input and excludes replay, while a new generation starts afresh', () => {
  const previous = { generation: 1, activity_watermark_at: now };
  assert.equal(historySample(body, null, previous, now).watermark, now);
  assert.equal(historySample(body, activity, previous, now).reason, 'REPEATED_MEASUREMENT');
  assert.equal(historySample({ ...body, generation: 2 }, activity, previous, now).reason, null);
  assert.equal(historySample({ ...body, generation: 2 }, null, previous, now).watermark, null);
});

test('future or unavailable input cannot poison the watermark for subsequent fresh observations', () => {
  const previous = { generation: 1, activity_watermark_at: new Date(now.getTime() - 10000) };
  const future = historySample({ ...body, measuredAt: '2026-10-09T00:00:10.000Z' }, activity, previous, now);
  assert.equal(future.reason, 'STALE_MEASUREMENT'); assert.equal(future.watermark, previous.activity_watermark_at);
  assert.equal(historySample(body, activity, { ...previous, activity_watermark_at: future.watermark }, now).score, 0);
  assert.equal(historySample({ ...body, sensorAvailable: false }, activity, previous, now).watermark, previous.activity_watermark_at);
  for (const offset of [-5000, 15000]) {
    const fresh = historySample({ ...body, measuredAt: new Date(now.getTime() - offset).toISOString() }, activity, {}, now);
    assert.equal(fresh.reason, null);
  }
});

test('history periods are strict, bounded and limits are not silently coerced', () => {
  assert.equal(historyQuery({}, now).from, '2026-10-07T23:00:10.000Z');
  for (const query of [{ from: 'bad' }, { to: 'bad' }, { to: ['2026-10-08T00:00:10Z'] },
    { from: '2026-02-30T00:00:00Z' }, { from: now.toISOString(), to: now.toISOString() },
    { from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:01Z' }]) assert.throws(() => historyQuery(query, now), /INVALID_PERIOD/);
  for (const limit of ['0', '1001', '3junk', '-1', '1.5', ['1'], 1]) assert.throws(() => historyQuery({ limit }, now), /INVALID_LIMIT/);
  assert.equal(historyQuery({ from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z', limit: '1000' }).limit, 1000);
});

test('history cursors pin gateway and period across requests and reject changed scope', () => {
  const scope = { gatewayId: 'room-1', from: '2026-10-08T00:00:00.000Z', to: '2026-10-08T01:00:00.000Z',
    at: '2026-10-08T00:30:00.000Z', generation: 1, sequence: 3 };
  const cursor = Buffer.from(JSON.stringify(scope)).toString('base64url');
  assert.equal(historyQuery({ cursor }).gatewayId, 'room-1');
  assert.equal(historyQuery({ cursor }).to, scope.to);
  for (const patch of [{ gatewayId: 'room-2' }, { from: '2026-10-07T23:00:00Z' }, { to: '2026-10-08T02:00:00Z' }])
    assert.throws(() => historyQuery({ cursor, ...patch }), /INVALID_CURSOR/);
  for (const value of ['invalid', ['invalid'], Buffer.from(JSON.stringify({ ...scope, sequence: -1 })).toString('base64url')])
    assert.throws(() => historyQuery({ cursor: value }), /INVALID_CURSOR/);
});

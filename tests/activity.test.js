const test = require('node:test');
const assert = require('node:assert/strict');
const { parseActivity, validLowActivityEvent } = require('../src/activity');

const status = {
  measuredAt: '2026-10-08T00:00:10.000Z', isDemo: true,
  activity: { score: 0, windowStartedAt: '2026-10-08T00:00:00.000Z',
    modelVersion: 'activity-v1', calibrationVersion: 'room-v1' },
};
const event = {
  occurredAt: '2026-10-08T00:01:00.000Z', detectedAt: '2026-10-08T00:01:00.000Z',
  score: null, qualityStatus: 'AVAILABLE', isDemo: true, modelVersion: 'activity-v1',
  details: { lowSince: '2026-10-08T00:00:00.000Z', durationSeconds: 60,
    thresholdMinutes: 1, activityThreshold: 0.2, activityScore: 0.1,
    settingsVersion: 1, calibrationVersion: 'room-v1' },
};

test('activity allows valid zero but rejects missing source, invalid scores and unproven windows', () => {
  assert.deepEqual(parseActivity(status), status.activity);
  assert.equal(parseActivity({}), null);
  assert.equal(parseActivity({ activity: null }), null);
  for (const score of [true, null, '0', -0.1, 1.1, NaN, Infinity]) {
    assert.equal(parseActivity({ ...status, activity: { ...status.activity, score } }), false);
  }
  for (const patch of [{ isDemo: undefined }, { measuredAt: null }, { activity: [] },
    { measuredAt: '2026-02-30T00:00:10Z' }, { measuredAt: '2026-10-08T00:00:10' },
    { measuredAt: '2026-10-08T00:00:00Z' }, { measuredAt: '2026-10-08T00:00:15.001Z' }]) {
    assert.equal(parseActivity({ ...status, ...patch }), false);
  }
  for (const patch of [{ modelVersion: '' }, { calibrationVersion: null }, { windowStartedAt: 'bad-date' }]) {
    assert.equal(parseActivity({ ...status, activity: { ...status.activity, ...patch } }), false);
  }
});

test('low activity evidence must agree on the duration, threshold time, score and source', () => {
  assert.equal(validLowActivityEvent(event), true);
  for (const patch of [{ durationSeconds: 59 }, { durationSeconds: 61 }, { thresholdMinutes: 2 },
    { activityScore: 0.3 }, { activityScore: null }, { activityThreshold: true },
    { calibrationVersion: '' }, { settingsVersion: 0 }, { lowSince: 'bad-date' }]) {
    assert.equal(validLowActivityEvent({ ...event, details: { ...event.details, ...patch } }), false);
  }
  for (const patch of [{ isDemo: undefined }, { score: 0.8 }, { qualityStatus: 'DEGRADED' },
    { occurredAt: '2026-10-08T00:00:00Z' }]) {
    assert.equal(validLowActivityEvent({ ...event, ...patch }), false);
  }
});

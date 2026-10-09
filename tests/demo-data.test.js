const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoEvents, fixtureSource } = require('../src/demo-data');
const { validLowActivityEvent } = require('../src/activity');

test('v2 samples include valid low activity evidence, all handling states and new IDs', () => {
  const events = createDemoEvents(Date.parse('2026-10-08T00:00:00.000Z'));
  assert.equal(events.length, 24);
  assert.equal(new Set(events.map(event => event.eventId)).size, 24);
  assert.deepEqual(new Set(events.map(event => event.type)), new Set([
    'FALL_SUSPECTED', 'LOW_ACTIVITY', 'SENSOR_UNAVAILABLE', 'GATEWAY_OFFLINE',
  ]));
  for (const event of events) {
    assert.equal(event.isDemo, true);
    assert.equal(event.details.source, fixtureSource);
    assert.match(event.eventId, /^sample-ui-v2-/);
    if (event.type === 'LOW_ACTIVITY') assert.equal(validLowActivityEvent(event), true);
  }
  assert.deepEqual(new Set(events.filter(event => event.type === 'LOW_ACTIVITY').map(event => event.state)),
    new Set(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']));
});

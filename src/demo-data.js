const { withTransaction } = require('./db');

const gatewayId = 'sample-room-gateway';
const fixtureSource = 'ui-sample-v2';
const eventTypes = ['FALL_SUSPECTED', 'LOW_ACTIVITY', 'SENSOR_UNAVAILABLE', 'GATEWAY_OFFLINE'];
const reasons = {
  FALL_SUSPECTED: '직접 확인 결과 빠르게 앉는 동작이었습니다. 다친 곳 없이 일상 활동을 이어갔습니다.',
  LOW_ACTIVITY: '직접 확인 결과 앉아서 쉬고 있었습니다. 대화와 움직임을 확인하고 기록했습니다.',
  SENSOR_UNAVAILABLE: '센서 케이블을 다시 연결하고 감지 상태가 복구된 것을 확인했습니다.',
  GATEWAY_OFFLINE: '기기의 네트워크를 다시 연결하고 신호 수신을 확인했습니다.',
};

function createDemoEvents(now = Date.now()) {
  return Array.from({ length: 24 }, (_, index) => {
    const first = [
      { type: 'FALL_SUSPECTED', state: 'OPEN', minutes: 1 },
      { type: 'LOW_ACTIVITY', state: 'OPEN', minutes: 4 },
      { type: 'FALL_SUSPECTED', state: 'ACKNOWLEDGED', minutes: 18 },
      { type: 'SENSOR_UNAVAILABLE', state: 'RESOLVED', minutes: 60 },
      { type: 'GATEWAY_OFFLINE', state: 'RESOLVED', minutes: 75 },
      { type: 'LOW_ACTIVITY', state: 'ACKNOWLEDGED', minutes: 140 },
    ];
    const item = first[index] || {
      type: eventTypes[index % eventTypes.length], state: 'RESOLVED',
      minutes: (Math.floor((index - 6) / 6) + 1) * 1440 + 20 + index * 7,
    };
    const occurred = now - item.minutes * 60000;
    return {
      // New fixture IDs leave all v1 records and guardian actions untouched.
      eventId: `sample-ui-v2-${String(index + 1).padStart(2, '0')}`,
      gatewayId, type: item.type, state: item.state,
      occurredAt: new Date(occurred).toISOString(),
      detectedAt: new Date(occurred + 1000).toISOString(),
      receivedAt: new Date(occurred + 2000).toISOString(),
      acknowledgedAt: item.state === 'OPEN' ? null : new Date(occurred + 60000).toISOString(),
      resolvedAt: item.state === 'RESOLVED' ? new Date(occurred + 120000).toISOString() : null,
      resolutionReason: item.state === 'RESOLVED' ? reasons[item.type] : null,
      score: item.type === 'FALL_SUSPECTED' ? 0.82 : null,
      qualityStatus: item.type === 'SENSOR_UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE',
      modelVersion: 'sample-only', isDemo: true,
      details: { source: fixtureSource, layoutId: 'sample-room-01',
        ...(item.type === 'LOW_ACTIVITY' ? {
          lowSince: new Date(occurred - 30 * 60000).toISOString(), durationSeconds: 1801,
          thresholdMinutes: 30, activityThreshold: 0.2, activityScore: 0.08,
          settingsVersion: 1, calibrationVersion: 'sample-room-v2',
        } : {}),
      },
    };
  });
}

async function seedDemo(now = Date.now()) {
  return withTransaction(async (client) => {
    const existing = await client.query('SELECT is_demo FROM gateways WHERE gateway_id = $1', [gatewayId]);
    if (existing.rowCount && !existing.rows[0].is_demo) throw new Error('Sample gateway ID is used by non-demo data.');
    await client.query('INSERT INTO gateways (gateway_id, is_demo) VALUES ($1, TRUE) ON CONFLICT DO NOTHING', [gatewayId]);
    let inserted = 0;
    for (const event of createDemoEvents(now)) {
      const previous = await client.query('SELECT is_demo, payload_json FROM events WHERE event_id = $1', [event.eventId]);
      if (previous.rowCount) {
        if (!previous.rows[0].is_demo || previous.rows[0].payload_json.details?.source !== fixtureSource) {
          throw new Error('Sample event ID is already used by other data.');
        }
        continue; // Keep the user's acknowledgements, reasons and timestamps on repeat runs.
      }
      await client.query(`INSERT INTO events
        (event_id, gateway_id, event_type, occurred_at, detected_at, received_at, score, quality_status,
         model_version, payload_json, state, acknowledged_at, resolved_at, observed, resolution_reason, is_demo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,TRUE)`,
      [event.eventId, event.gatewayId, event.type, event.occurredAt, event.detectedAt, event.receivedAt,
        event.score, event.qualityStatus, event.modelVersion, JSON.stringify(event), event.state,
        event.acknowledgedAt, event.resolvedAt, event.state === 'RESOLVED', event.resolutionReason]);
      const actions = [
        { type: 'CREATED', actor: 'gateway', at: event.receivedAt, detail: { type: event.type } },
      ];
      if (event.acknowledgedAt) actions.push({ type: 'ACKNOWLEDGED', actor: 'guardian', at: event.acknowledgedAt, detail: {} });
      if (event.resolvedAt) actions.push({ type: 'RESOLVED', actor: 'guardian', at: event.resolvedAt, detail: { observed: true, reason: event.resolutionReason } });
      for (const action of actions) {
        await client.query(`INSERT INTO event_actions (event_id, action_type, actor, created_at, detail_json)
          VALUES ($1,$2,$3,$4,$5::jsonb)`, [event.eventId, action.type, action.actor, action.at, JSON.stringify(action.detail)]);
      }
      inserted++;
    }
    return inserted;
  });
}

module.exports = { seedDemo, createDemoEvents, gatewayId, fixtureSource };

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const historyApp = fs.readFileSync(path.join(root, 'public/activity-history.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const timestamp = '2026-10-06T12:00:00.000Z';
const baseEvent = { eventId: 'test-a', gatewayId: 'demo', type: 'FALL_SUSPECTED', state: 'OPEN', occurredAt: timestamp, detectedAt: timestamp, receivedAt: timestamp, isDemo: true, actions: [] };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function settle() { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); }

function mount(overrides = {}) {
  const dom = new JSDOM(html, { url: overrides.url || 'http://127.0.0.1:3002/', runScripts: 'outside-only', pretendToBeVisual: true });
  const style = dom.window.document.createElement('style');
  style.textContent = css;
  dom.window.document.head.append(style);
  const calls = [];
  const timers = [];
  dom.window.setInterval = (callback) => { timers.push(callback); return timers.length; };
  overrides.setup?.(dom.window);
  dom.window.fetch = async (path, options) => {
    calls.push({ path, ...options });
    if (overrides.fetch) {
      const result = await overrides.fetch(path, options);
      if (result) return result;
    }
    if (path === '/api/status') return response({ gateway: { connected: false, receivedAt: timestamp, ageSeconds: 60 }, sensor: { available: true, qualityStatus: 'AVAILABLE', measuredAt: timestamp }, isDemo: true, fetchedAt: timestamp });
    if (path === '/api/settings') return response({ version: 1, updatedAt: timestamp });
    if (path.startsWith('/api/activity/history?')) {
      const params = new URL(path, 'http://localhost').searchParams;
      return response({ gatewayId: null, from: params.get('from'), to: params.get('to'), items: [], nextCursor: null });
    }
    if (path.startsWith('/api/events?')) return response({ items: [baseEvent], nextCursor: null });
    if (path === '/api/events/test-a') return response(baseEvent);
    throw new Error(`Unmocked request ${path}`);
  };
  dom.window.eval(app);
  dom.window.eval(historyApp);
  return { dom, document: dom.window.document, calls, timers };
}

function activityStatus(overrides = {}) {
  const measuredAt = new Date().toISOString();
  return { isDemo: false, gateway: { connected: true, receivedAt: measuredAt },
    sensor: { available: true, qualityStatus: 'AVAILABLE', measuredAt, fresh: true },
    activity: { score: 0.1, windowStartedAt: new Date(Date.parse(measuredAt) - 10000).toISOString(),
      modelVersion: 'activity-v1', calibrationVersion: 'room-v1' },
    settings: { version: 1, appliedVersion: 1, updatedAt: measuredAt,
      lowActivityEnabled: true, lowActivityMinutes: 30, lowActivityThreshold: 0.2 },
    ...overrides };
}

function historyResponse(path, items = [], nextCursor = null) {
  const params = new URL(path, 'http://localhost').searchParams;
  return response({ gatewayId: 'room-history', from: params.get('from'), to: params.get('to'), items, nextCursor });
}
function historyItem(sequence, score, reason = null) {
  const end = Date.now() - sequence * 10000;
  return { generation: 1, sequence, sampledAt: new Date(end).toISOString(),
    windowStartedAt: new Date(end - 5000).toISOString(), score, reason };
}

test('activity history draws separate measured windows including zero, with gaps and accessible records', async () => {
  const items = [historyItem(1, 0), historyItem(2, null, 'SENSING_UNAVAILABLE'), historyItem(3, 0.8)];
  const { dom, document } = mount({ fetch: async path => path.startsWith('/api/activity/history?') ? historyResponse(path, items) : undefined });
  try {
    await settle();
    assert.equal(document.getElementById('history-plot').hidden, false);
    const marks = document.querySelectorAll('#history-marks line');
    assert.equal(marks.length, 2); assert.equal(marks[0].getAttribute('y1'), '110');
    assert.equal(document.querySelectorAll('#history-marks path, #history-marks polyline').length, 0, 'no interpolation across gaps');
    assert.match(document.getElementById('history-message').textContent, /측정 2개 · 관측 불가 1개/);
    assert.match(document.getElementById('history-record-list').textContent, /관측 불가/);
    assert.match(document.getElementById('history-axis-end').textContent, /\d{2}:\d{2}:\d{2}$/);
    assert.equal(document.getElementById('history-period-panel').open, false);
  } finally { dom.window.close(); }
});

test('activity history presets and custom dates send bounded local minute-inclusive periods', async () => {
  const { dom, document, calls } = mount();
  try {
    await settle();
    for (const hours of [6, 24, 1]) {
      document.querySelector(`[data-history-hours="${hours}"]`).click(); await settle();
      const params = new URL(calls.at(-1).path, 'http://localhost').searchParams;
      assert.equal(Date.parse(params.get('to')) - Date.parse(params.get('from')), hours * 3600000);
    }
    const submit = async () => { document.getElementById('history-period-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle(); };
    const before = calls.length;
    await submit(); assert.equal(calls.length, before);
    document.getElementById('history-start-date').value = '2026-10-08';
    document.getElementById('history-end-date').value = '2026-10-08';
    document.getElementById('history-start-time').value = '09:00';
    document.getElementById('history-end-time').value = '10:00'; await submit();
    const params = new URL(calls.at(-1).path, 'http://localhost').searchParams;
    assert.equal(params.get('from'), new Date('2026-10-08T09:00:00').toISOString());
    assert.equal(params.get('to'), new Date('2026-10-08T10:01:00').toISOString());
    assert.equal(document.querySelector('[data-history-hours="1"]').getAttribute('aria-pressed'), 'false');
    let count = calls.length;
    document.getElementById('history-start-date').value = '2026-10-09'; await submit(); assert.equal(calls.length, count);
    document.getElementById('history-start-date').value = '2026-09-01'; await submit(); assert.equal(calls.length, count);
    assert.match(document.getElementById('history-period-error').textContent, /7일/);
  } finally { dom.window.close(); }
});

test('activity history distinguishes no records, unavailable observations and query failure', async () => {
  let phase = 'empty';
  const { dom, document } = mount({ fetch: async path => {
    if (!path.startsWith('/api/activity/history?')) return;
    if (phase === 'failed') return response({}, 500);
    return historyResponse(path, phase === 'empty' ? [] : [historyItem(1, null, 'NO_ACTIVITY')]);
  } });
  try {
    await settle(); assert.match(document.getElementById('history-message').textContent, /기록이 없어요/);
    phase = 'gap'; document.getElementById('history-refresh').click(); await settle();
    assert.match(document.getElementById('history-message').textContent, /측정 0개 · 관측 불가 1개/);
    assert.equal(document.getElementById('history-plot').hidden, true);
    phase = 'failed'; document.getElementById('history-refresh').click(); await settle();
    assert.match(document.getElementById('history-message').textContent, /불러오지 못/);
    assert.equal(document.getElementById('history-records').hidden, true);
  } finally { dom.window.close(); }
});

test('history pagination pins scope, retries failures and merges records without duplicates', async () => {
  const item = historyItem(1, 0.4);
  let fail = true;
  const { dom, document, calls } = mount({ fetch: async path => {
    if (!path.startsWith('/api/activity/history?')) return;
    const params = new URL(path, 'http://localhost').searchParams;
    if (!params.has('cursor')) return historyResponse(path, [item], 'next-page');
    if (fail) return response({}, 500);
    return historyResponse(path, [item, historyItem(2, 0.1)]);
  } });
  try {
    await settle(); assert.equal(document.getElementById('history-more').hidden, false);
    document.getElementById('history-more').click(); await settle();
    assert.equal(document.querySelectorAll('#history-marks line').length, 1, 'append failure keeps existing data');
    assert.match(document.getElementById('history-message').textContent, /다시 시도/);
    fail = false; document.getElementById('history-more').click(); await settle();
    const params = new URL(calls.at(-1).path, 'http://localhost').searchParams;
    assert.equal(params.get('gatewayId'), 'room-history'); assert.equal(params.get('cursor'), 'next-page');
    assert.equal(document.querySelectorAll('#history-marks line').length, 2);
    assert.equal(document.getElementById('history-more').hidden, true);
  } finally { dom.window.close(); }
});

test('late history response cannot replace a newer period and automatic refresh respects custom periods', async () => {
  let resolveFirst;
  let count = 0;
  const { dom, document, calls, timers } = mount({ fetch: async path => {
    if (!path.startsWith('/api/activity/history?')) return;
    if (++count === 1) return new Promise(resolve => { resolveFirst = () => resolve(historyResponse(path, [historyItem(1, 0.9)])); });
    return historyResponse(path, [historyItem(2, 0.2)]);
  } });
  try {
    await settle(); document.querySelector('[data-history-hours="6"]').click(); await settle();
    resolveFirst(); await settle();
    assert.match(document.getElementById('history-record-list').textContent, /0.2$/);
    assert.doesNotMatch(document.getElementById('history-record-list').textContent, /0.9/);
    const before = calls.filter(call => call.path.startsWith('/api/activity/history?')).length;
    await timers[1](); await settle();
    assert.equal(calls.filter(call => call.path.startsWith('/api/activity/history?')).length, before + 1);
    document.getElementById('history-start-date').value = document.getElementById('history-end-date').value = '2026-10-08';
    document.getElementById('history-period-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    const customCount = calls.length; await timers[1](); await settle(); assert.equal(calls.length, customCount);
  } finally { dom.window.close(); }
});

test('current activity displays valid zero, hides invalid or demo inputs, and clears after a failed query', async () => {
  let status = activityStatus();
  let failed = false;
  const { dom, document, timers } = mount({ fetch: async path => {
    if (path === '/api/status') return failed ? response({ error: { message: 'offline' } }, 500) : response(status);
  } });
  try {
    await settle();
    assert.equal(document.getElementById('activity-score').textContent, '0.10');
    assert.equal(document.getElementById('activity-state').textContent, '낮은 활동');
    assert.equal(document.getElementById('activity-meter').hidden, false);
    assert.match(document.getElementById('activity-measured-at').textContent, /\d{2}:\d{2}:\d{2}$/);
    status = activityStatus(); status.activity.score = 0; await timers[0]();
    assert.equal(document.getElementById('activity-score').textContent, '0.00');
    assert.equal(document.getElementById('activity-meter').getAttribute('aria-valuetext'), '0.00');
    status.activity.score = 0.20001; await timers[0]();
    assert.equal(document.getElementById('activity-score').textContent, '0.20001');
    assert.equal(document.getElementById('activity-state').textContent, '활동 변화');
    for (const patch of [{ isDemo: true }, { isDemo: undefined }, { activity: null },
      { gateway: { connected: false } }, { sensor: { ...status.sensor, fresh: false } },
      { sensor: { ...status.sensor, qualityStatus: 'DEGRADED' } },
      { activity: { ...status.activity, score: null } }, { activity: { ...status.activity, score: '0.1' } },
      { activity: { ...status.activity, modelVersion: '' } }, { activity: { ...status.activity, calibrationVersion: null } },
      { sensor: { ...status.sensor, measuredAt: '2026-01-01T00:00:00.000Z' } }]) {
      status = { ...activityStatus(), ...patch }; await timers[0]();
      assert.equal(document.getElementById('activity-score').textContent, '—');
      assert.equal(document.getElementById('activity-state').textContent, '확인 불가');
      assert.equal(document.getElementById('activity-meter').hidden, true);
      assert.equal(document.getElementById('activity-measured-at').textContent, '기록 없음');
    }
    status = activityStatus(); await timers[0]();
    assert.equal(document.getElementById('activity-score').textContent, '0.10');
    failed = true; await timers[0]();
    assert.equal(document.getElementById('activity-meter').hidden, true);
    assert.equal(document.getElementById('activity-score').textContent, '—');
  } finally { dom.window.close(); }
});

test('current activity uses only a confirmed applied criterion and never claims prolonged inactivity', async () => {
  let status = activityStatus();
  status.activity.score = 0.4;
  const { dom, document, timers } = mount({ fetch: async path => path === '/api/status' ? response(status) : undefined });
  try {
    await settle();
    assert.equal(document.getElementById('activity-state').textContent, '활동 변화');
    status.settings = { ...status.settings, version: 2, lowActivityThreshold: 0.5 }; await timers[0]();
    assert.equal(document.getElementById('activity-state').textContent, '측정됨');
    assert.match(document.getElementById('activity-help').textContent, /기기 적용/);
    status.settings.appliedVersion = 2; await timers[0]();
    assert.equal(document.getElementById('activity-state').textContent, '낮은 활동');
    assert.doesNotMatch(document.getElementById('activity-summary').textContent, /정상|안전|30분 경과|장시간 저활동 발생/);
  } finally { dom.window.close(); }
});

test('low activity settings preserve edits through polling and failed saves then save all options together', async () => {
  let settings = activityStatus().settings;
  let failSave = true;
  const { dom, document, calls, timers } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response(activityStatus({ settings }));
    if (path === '/api/settings' && options.method === 'PATCH') {
      if (failSave) return response({ error: { message: 'save failed' } }, 500);
      settings = { ...settings, ...JSON.parse(options.body), version: settings.version + 1 };
      return response(settings);
    }
  } });
  try {
    await settle();
    const minutes = document.getElementById('low-activity-minutes');
    const threshold = document.getElementById('low-activity-sensitivity');
    const form = document.getElementById('settings-form');
    assert.equal(minutes.disabled, false);
    minutes.value = '45'; minutes.dispatchEvent(new dom.window.Event('input'));
    threshold.value = '3'; threshold.dispatchEvent(new dom.window.Event('input'));
    await timers[0]();
    assert.equal(minutes.value, '45'); assert.equal(threshold.value, '3');
    assert.equal(document.getElementById('settings-unsaved').hidden, false);
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(minutes.value, '45'); assert.equal(threshold.value, '3');
    assert.match(document.getElementById('settings-message').textContent, /저장하지 못/);
    assert.equal(document.getElementById('low-activity-enabled').disabled, false);
    failSave = false;
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    const saved = JSON.parse(calls.filter(call => call.method === 'PATCH').at(-1).body);
    assert.deepEqual(saved, { lowActivityEnabled: true, lowActivityMinutes: 45, lowActivityThreshold: 0.3,
      lowActivityMode: 'ALL_DAY', lowActivityStart: '22:00', lowActivityEnd: '07:00',
      fallAlertEnabled: true, sensorFaultAlertEnabled: true, gatewayFaultAlertEnabled: true });
    assert.equal(document.getElementById('settings-unsaved').hidden, true);
    assert.match(document.querySelector('#settings-alerts .detection-chip').textContent, /장시간 저활동 감지 켜짐.*45분.*민감도 3.*상시/);
    assert.equal(document.getElementById('settings-application').textContent, '적용 확인 중');
  } finally { dom.window.close(); }
});

test('low activity disabled fields can be cleared without blocking switch-off, and enabled values are validated', async () => {
  let settings = activityStatus().settings;
  const { dom, document, calls } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response(activityStatus({ settings }));
    if (path === '/api/settings' && options.method === 'PATCH') {
      settings = { ...settings, ...JSON.parse(options.body), version: settings.version + 1 };
      return response(settings);
    }
  } });
  try {
    await settle();
    const enabled = document.getElementById('low-activity-enabled');
    const minutes = document.getElementById('low-activity-minutes');
    const threshold = document.getElementById('low-activity-sensitivity');
    const submit = async () => { document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle(); };
    minutes.value = ''; threshold.value = '';
    enabled.checked = false; enabled.dispatchEvent(new dom.window.Event('change'));
    assert.equal(minutes.disabled, true); assert.equal(threshold.required, false);
    await submit();
    assert.equal(settings.lowActivityEnabled, false);
    assert.equal(settings.lowActivityMinutes, 30); assert.equal(settings.lowActivityThreshold, 0.2);
    enabled.checked = true; enabled.dispatchEvent(new dom.window.Event('change'));
    for (const timeValue of ['', '0', '1441', '1.5']) {
      minutes.value = timeValue;
      const before = calls.filter(call => call.method === 'PATCH').length;
      await submit();
      assert.equal(calls.filter(call => call.method === 'PATCH').length, before);
      assert.equal(document.getElementById('settings-message').hidden, false);
    }
    minutes.value = '1440'; threshold.value = '0'; threshold.dispatchEvent(new dom.window.Event('input')); await submit();
    assert.equal(settings.lowActivityMinutes, 1440); assert.equal(settings.lowActivityThreshold, 0);
    threshold.value = '10'; threshold.dispatchEvent(new dom.window.Event('input')); await submit();
    assert.equal(settings.lowActivityThreshold, 1);
  } finally { dom.window.close(); }
});

test('low activity filter composes with period/state and detail evidence survives acknowledgement and resolution', async () => {
  let current = { ...baseEvent, eventId: 'test-low', type: 'LOW_ACTIVITY',
    details: { lowSince: '2026-10-06T11:29:59.000Z', durationSeconds: 1801,
      thresholdMinutes: 30, activityThreshold: 0.2, activityScore: 0.08,
      monitoringMode: 'TIME_RANGE', monitoringStart: '22:00', monitoringEnd: '07:00' } };
  const { dom, document, calls } = mount({ fetch: async (path, options) => {
    if (path.startsWith('/api/events?')) return response({ items: [current], nextCursor: null });
    if (path === '/api/events/test-low') return response(current);
    if (path.endsWith('/ack')) { current = { ...current, state: 'ACKNOWLEDGED', acknowledgedAt: timestamp }; return response({ item: current }); }
    if (path.endsWith('/resolve')) { current = { ...current, state: 'RESOLVED', resolvedAt: timestamp, resolutionReason: JSON.parse(options.body).reason }; return response({ item: current }); }
  } });
  try {
    await settle();
    const filter = document.querySelector('[data-filter="LOW_ACTIVITY"]'); filter.click(); await settle();
    assert.equal(filter.getAttribute('aria-pressed'), 'true');
    const state = document.getElementById('event-state-filter'); state.value = 'OPEN'; state.dispatchEvent(new dom.window.Event('change')); await settle();
    document.getElementById('event-start-date').value = '2026-10-06';
    document.getElementById('event-period-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    let query = calls.filter(call => call.path.startsWith('/api/events?')).at(-1).path;
    assert.match(query, /type=LOW_ACTIVITY/); assert.match(query, /state=OPEN/); assert.match(query, /from=/);
    document.querySelector('#events-list a').click(); await settle();
    assert.equal(document.getElementById('detail-low-activity').hidden, false);
    assert.equal(document.getElementById('detail-type').textContent, '장시간 저활동');
    assert.equal(document.getElementById('detail-low-duration').textContent, '30분 1초');
    assert.match(document.getElementById('detail-low-criteria').textContent, /30분.*민감도 2/);
    assert.equal(document.getElementById('detail-low-schedule').textContent, '22:00~07:00 (한국 시간)');
    assert.equal(document.querySelector('#detail-icon use').getAttribute('href'), '#i-low-activity');
    assert.equal(document.querySelector('#events-list .icon use').getAttribute('href'), '#i-low-activity');
    assert.equal(document.getElementById('detail-low-score').textContent, '0.08');
    document.getElementById('ack-button').click(); await settle();
    assert.equal(document.getElementById('detail-state').textContent, '확인됨');
    assert.equal(document.getElementById('detail-low-duration').textContent, '30분 1초');
    document.getElementById('observed').checked = true;
    document.getElementById('reason').value = '직접 대화하고 움직임을 확인했습니다.';
    document.getElementById('reason').dispatchEvent(new dom.window.Event('input'));
    document.getElementById('resolve-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(document.getElementById('detail-state').textContent, '해소됨');
    assert.equal(document.getElementById('detail-low-activity').hidden, false);
    dom.window.history.replaceState({}, '', '?eventId=test-a#detail');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate')); await settle();
    assert.equal(document.getElementById('detail-low-activity').hidden, true);
  } finally { dom.window.close(); }
});

test('sensitivity scale preserves a precise saved threshold until moved and then snaps to 0 through 10', async () => {
  let settings = { ...activityStatus().settings, lowActivityThreshold: 0.150001 };
  const { dom, document, calls } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response(activityStatus({ settings }));
    if (path === '/api/settings' && options.method === 'PATCH') {
      settings = { ...settings, ...JSON.parse(options.body), version: settings.version + 1 }; return response(settings);
    }
  } });
  try {
    await settle();
    const slider = document.getElementById('low-activity-sensitivity');
    assert.equal(slider.type, 'range'); assert.equal(slider.min, '0'); assert.equal(slider.max, '10');
    assert.equal(document.querySelectorAll('.sensitivity-ticks span').length, 11);
    assert.equal(document.getElementById('low-activity-sensitivity-value').textContent, '1.50001');
    assert.equal(document.getElementById('settings-unsaved').hidden, true);
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(JSON.parse(calls.filter(call => call.method === 'PATCH').at(-1).body).lowActivityThreshold, 0.150001);
    slider.value = '3.7'; slider.dispatchEvent(new dom.window.Event('input'));
    assert.equal(slider.value, '4'); assert.equal(document.getElementById('low-activity-sensitivity-value').textContent, '4');
    assert.match(slider.getAttribute('aria-valuetext'), /민감도 4/);
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(settings.lowActivityThreshold, 0.4);
    assert.equal(document.querySelector('#low-activity-settings h2 use').getAttribute('href'), '#i-low-activity');
  } finally { dom.window.close(); }
});

test('low activity schedule hides all-day times and preserves overnight edits through polling and failed saves', async () => {
  let settings = { ...activityStatus().settings, lowActivityMode: 'ALL_DAY', lowActivityStart: '22:00', lowActivityEnd: '07:00' };
  let fail = true;
  const { dom, document, timers } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response(activityStatus({ settings }));
    if (path === '/api/settings' && options.method === 'PATCH') {
      if (fail) return response({}, 500);
      settings = { ...settings, ...JSON.parse(options.body), version: settings.version + 1 }; return response(settings);
    }
  } });
  try {
    await settle();
    const mode = document.getElementById('low-activity-mode'), start = document.getElementById('low-activity-start'), end = document.getElementById('low-activity-end');
    const submit = async () => { document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle(); };
    assert.equal(document.getElementById('low-activity-time-fields').hidden, true); assert.equal(start.disabled, true);
    mode.value = 'TIME_RANGE'; mode.dispatchEvent(new dom.window.Event('change'));
    assert.equal(document.getElementById('low-activity-time-fields').hidden, false); assert.equal(start.required, true);
    start.value = '22:30'; end.value = '07:15'; start.dispatchEvent(new dom.window.Event('input'));
    await timers[0](); await submit();
    assert.equal(mode.value, 'TIME_RANGE'); assert.equal(start.value, '22:30'); assert.equal(end.value, '07:15');
    assert.match(document.getElementById('settings-message').textContent, /저장하지 못/);
    fail = false; await submit();
    assert.equal(settings.lowActivityMode, 'TIME_RANGE'); assert.equal(settings.lowActivityStart, '22:30');
    assert.match(document.querySelector('#settings-alerts .detection-chip').textContent, /민감도 2.*22:30~07:15/);
    mode.value = 'ALL_DAY'; mode.dispatchEvent(new dom.window.Event('change'));
    assert.equal(document.getElementById('low-activity-time-fields').hidden, true); assert.equal(start.required, false);
    mode.value = 'TIME_RANGE'; mode.dispatchEvent(new dom.window.Event('change'));
    assert.equal(start.value, '22:30'); assert.equal(end.value, '07:15');
  } finally { dom.window.close(); }
});

test('invalid scheduled times cannot save but switching detection off still works', async () => {
  let settings = { ...activityStatus().settings, lowActivityMode: 'TIME_RANGE', lowActivityStart: '22:00', lowActivityEnd: '07:00' };
  const { dom, document, calls } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response(activityStatus({ settings }));
    if (path === '/api/settings' && options.method === 'PATCH') { settings = { ...settings, ...JSON.parse(options.body), version: 2 }; return response(settings); }
  } });
  try {
    await settle();
    const submit = async () => { document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle(); };
    const start = document.getElementById('low-activity-start'), end = document.getElementById('low-activity-end');
    for (const pair of [['22:00', '22:00'], ['', '07:00']]) {
      start.value = pair[0]; end.value = pair[1]; start.dispatchEvent(new dom.window.Event('input')); await submit();
      assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
      assert.match(document.getElementById('settings-message').textContent, /시작·종료/);
    }
    const enabled = document.getElementById('low-activity-enabled'); enabled.checked = false; enabled.dispatchEvent(new dom.window.Event('change')); await submit();
    assert.equal(settings.lowActivityEnabled, false); assert.equal(settings.lowActivityStart, '22:00');
    assert.equal(start.disabled, true); assert.equal(document.getElementById('low-activity-sensitivity').disabled, true);
  } finally { dom.window.close(); }
});

test('outside a scheduled period the home still shows the actual measured activity without claiming detection', async () => {
  const korea = new Date(Date.now() + 9 * 3600000);
  const minutes = korea.getUTCHours() * 60 + korea.getUTCMinutes();
  const stamp = offset => { const value = (minutes + offset) % 1440; return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; };
  const settings = { ...activityStatus().settings, lowActivityMode: 'TIME_RANGE', lowActivityStart: stamp(10), lowActivityEnd: stamp(20) };
  const { dom, document } = mount({ fetch: async path => path === '/api/status' ? response(activityStatus({ settings })) : undefined });
  try {
    await settle(); assert.equal(document.getElementById('activity-meter').hidden, false);
    assert.equal(document.getElementById('activity-score').textContent, '0.10');
    assert.equal(document.getElementById('activity-state').textContent, '측정됨');
    assert.match(document.getElementById('activity-help').textContent, /시간대 밖/);
  } finally { dom.window.close(); }
});

test('stale heartbeat never shows current observation or developer-only copy', async () => {
  const { dom, document } = mount();
  try {
    await settle();
    assert.match(document.getElementById('sensor-state').textContent, /확인 불가/);
    assert.equal(document.getElementById('status-demo'), null);
    assert.doesNotMatch(document.getElementById('events-list').textContent, /시험 데이터|개발 시제품/);
  } finally { dom.window.close(); }
});

test('sample or unclassified signals cannot show live measurement, timestamps or settings application', async () => {
  let source = true;
  const { dom, document, timers } = mount({ fetch: async path => {
    if (path === '/api/status') return response({
      isDemo: source, gateway: { connected: true, receivedAt: timestamp },
      sensor: { available: true, fresh: true, qualityStatus: 'AVAILABLE', measuredAt: timestamp },
      settings: { version: 1, updatedAt: timestamp, appliedVersion: 1 },
    });
  } });
  try {
    await settle();
    for (source of [true, undefined]) {
      await timers[0]();
      assert.equal(document.getElementById('status-badge').textContent, '연결 대기');
      assert.equal(document.getElementById('status-badge').classList.contains('success'), false);
      assert.equal(document.getElementById('measured-at').textContent, '기록 없음');
      assert.equal(document.getElementById('received-at').textContent, '기록 없음');
      assert.equal(document.getElementById('settings-application').textContent, '연결 필요');
      assert.equal(document.getElementById('settings-gateway-state').textContent, '연결 대기');
      assert.notEqual(document.getElementById('settings-sensor-state').textContent, '측정 중');
      assert.equal(document.querySelectorAll('#events-list .event').length, 1, 'sample event history remains available');
    }
    source = false; await timers[0]();
    assert.equal(document.getElementById('status-badge').textContent, '정상');
    assert.equal(document.getElementById('sensor-state').textContent, '측정 중');
    assert.notEqual(document.getElementById('measured-at').textContent, '기록 없음');
    assert.equal(document.getElementById('settings-application').textContent, '적용됨');
  } finally { dom.window.close(); }
});

test('late filter responses cannot replace the newly selected filter', async () => {
  let release;
  const { dom, document } = mount({ fetch: async (path) => {
    if (path.includes('type=FALL_SUSPECTED')) return new Promise((resolve) => { release = resolve; });
    if (path.includes('type=FAULT')) return response({ items: [{ ...baseEvent, eventId: 'test-b', type: 'SENSOR_UNAVAILABLE' }], nextCursor: null });
  } });
  try {
    await settle();
    document.querySelector('[data-filter="FALL_SUSPECTED"]').click();
    await settle();
    document.querySelector('[data-filter="FAULT"]').click();
    await settle();
    release(response({ items: [baseEvent], nextCursor: null }));
    await settle();
    assert.equal(document.querySelector('#events-list a').dataset.eventId, 'test-b');
  } finally { dom.window.close(); }
});

test('ack and resolution are separate requests and require observation plus a reason', async () => {
  let current = structuredClone(baseEvent);
  const hostileReason = '<img src=x onerror=alert(1)> observed and safe';
  const { dom, document, calls } = mount({ fetch: async (path, options) => {
    if (path === '/api/events/test-a') return response(current);
    if (path.endsWith('/ack')) {
      current = { ...current, state: 'ACKNOWLEDGED', acknowledgedAt: timestamp };
      return response({ item: current, duplicate: false });
    }
    if (path.endsWith('/resolve')) {
      const payload = JSON.parse(options.body);
      current = { ...current, state: 'RESOLVED', resolutionReason: payload.reason, resolvedAt: timestamp, actions: [{ type: 'RESOLVED', createdAt: timestamp, detail: { reason: payload.reason } }] };
      return response({ item: current });
    }
  } });
  try {
    await settle();
    document.querySelector('#events-list a').click();
    await settle();
    assert.equal(document.getElementById('ack-button').disabled, false);
    assert.equal(document.getElementById('resolve-button').disabled, true);
    const resolutionButton = document.getElementById('resolve-button');
    const disabledColor = dom.window.getComputedStyle(resolutionButton).backgroundColor;
    assert.equal(disabledColor, 'rgb(238, 238, 232)');
    assert.equal(document.getElementById('detail-summary').classList.contains('warning'), true);
    assert.equal(document.getElementById('resolve-form').hidden, false);
    document.getElementById('ack-button').click();
    await settle();
    assert.equal(document.getElementById('detail-state').textContent, '확인됨');
    assert.equal(document.getElementById('detail-summary').classList.contains('blue'), true);
    assert.equal(document.getElementById('detail-summary').classList.contains('warning'), false);
    assert.equal(calls.filter((call) => call.path.endsWith('/resolve')).length, 0);
    document.getElementById('observed').checked = true;
    document.getElementById('observed').dispatchEvent(new dom.window.Event('change'));
    document.getElementById('reason').value = hostileReason;
    document.getElementById('reason').dispatchEvent(new dom.window.Event('input'));
    assert.equal(document.getElementById('resolve-button').disabled, false);
    assert.notEqual(dom.window.getComputedStyle(resolutionButton).backgroundColor, disabledColor);
    document.getElementById('resolve-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(document.getElementById('detail-state').textContent, '해소됨');
    assert.equal(document.getElementById('detail-summary').classList.contains('success'), true);
    assert.equal(document.getElementById('detail-summary').classList.contains('blue'), false);
    assert.equal(document.getElementById('detail-state').classList.contains('success'), true);
    assert.equal(document.querySelector('#detail-actions img'), null, 'user content is text, not HTML');
    assert.match(document.getElementById('resolution-record').textContent, /<img/);
    assert.equal(document.getElementById('resolve-button').disabled, true);
    assert.equal(document.getElementById('resolve-form').hidden, true);
  } finally { dom.window.close(); }
});

test('failed settings save keeps typed input and does not claim a saved version', async () => {
  const { dom, document } = mount({ fetch: async (path, options) => {
    if (path === '/api/settings' && options.method === 'PATCH') return response({ error: { message: 'test save failed' } }, 500);
  } });
  try {
    await settle();
    const savedAt = document.getElementById('settings-updated').textContent;
    document.getElementById('fall-alert-enabled').checked = false;
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(document.getElementById('fall-alert-enabled').checked, false);
    assert.equal(document.getElementById('settings-updated').textContent, savedAt);
    assert.match(document.getElementById('settings-message').textContent, /저장하지 못/);
    assert.equal(document.getElementById('settings-save').disabled, false);
    assert.equal(document.getElementById('settings-unsaved').hidden, false);
  } finally { dom.window.close(); }
});

test('non-JSON Live Preview response is reported as an API connection problem', async () => {
  const { dom, document } = mount({ fetch: async () => new Response('<html>preview</html>', { headers: { 'content-type': 'text/html' } }) });
  try {
    await settle();
    assert.match(document.getElementById('connection-message').textContent, /연결할 수 없습니다/);
    assert.equal(document.getElementById('settings-save').disabled, true);
  } finally { dom.window.close(); }
});

test('fresh communication cannot hide an unavailable, old or degraded measurement', async () => {
  let sensor = { available: true, qualityStatus: 'AVAILABLE', measuredAt: timestamp, fresh: false };
  const { dom, document, timers } = mount({ fetch: async (path) => {
    if (path === '/api/status') return response({ isDemo: false, gateway: { connected: true, receivedAt: timestamp }, sensor, settings: { version: 1, updatedAt: timestamp, appliedVersion: 1 } });
  } });
  try {
    await settle();
    assert.equal(document.getElementById('status-badge').textContent, '감지 확인 필요');
    for (const update of [{ available: false, fresh: true, qualityStatus: 'UNAVAILABLE' }, { available: true, fresh: true, qualityStatus: 'DEGRADED' }]) {
      sensor = { ...sensor, ...update }; await timers[0]();
      assert.equal(document.getElementById('status-badge').classList.contains('success'), false);
    }
    sensor = { ...sensor, available: true, fresh: true, qualityStatus: 'AVAILABLE' }; await timers[0]();
    assert.equal(document.getElementById('status-badge').textContent, '정상');
  } finally { dom.window.close(); }
});

test('settings polling preserves edits and requires matching applied version', async () => {
  let settings = { version: 1, updatedAt: timestamp, appliedVersion: 1 };
  const { dom, document, timers } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response({ isDemo: false, gateway: { connected: true }, sensor: { available: true, fresh: true, qualityStatus: 'AVAILABLE' }, settings });
    if (path === '/api/settings' && options.method === 'PATCH') {
      settings = { ...settings, version: 2, fallAlertEnabled: false };
      return response(settings);
    }
  } });
  try {
    await settle();
    assert.equal(document.getElementById('settings-application').textContent, '적용됨');
    const input = document.getElementById('fall-alert-enabled');
    input.checked = false; input.dispatchEvent(new dom.window.Event('input'));
    await timers[0](); assert.equal(input.checked, false);
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(document.getElementById('settings-application').textContent, '적용 확인 중');
    assert.equal(document.getElementById('fall-alert-enabled').checked, false);
    assert.equal(document.getElementById('settings-unsaved').hidden, true);
    settings.appliedVersion = 2; await timers[0]();
    assert.equal(document.getElementById('settings-application').textContent, '적용됨');
  } finally { dom.window.close(); }
});

test('state filtering resets pagination and refresh retains both filters', async () => {
  const { dom, document, calls } = mount({ fetch: async (path) => {
    if (path.includes('type=FAULT') && !path.includes('state=')) return response({ items: [baseEvent], nextCursor: 'old-cursor' });
    if (path.includes('state=RESOLVED')) return response({ items: [], nextCursor: null });
  } });
  try {
    await settle();
    document.querySelector('[data-filter="FAULT"]').click(); await settle();
    assert.equal(document.getElementById('load-more').hidden, false);
    const select = document.getElementById('event-state-filter'); select.value = 'RESOLVED'; select.dispatchEvent(new dom.window.Event('change'));
    await settle();
    const filtered = calls.filter((call) => call.path.includes('type=FAULT') && call.path.includes('state=RESOLVED'));
    assert.equal(filtered.length, 1); assert.doesNotMatch(filtered[0].path, /cursor/);
    assert.equal(document.getElementById('load-more').hidden, true);
    document.getElementById('events-refresh').click(); await settle();
    assert.equal(calls.filter((call) => call.path.includes('type=FAULT') && call.path.includes('state=RESOLVED')).length, 2);
  } finally { dom.window.close(); }
});

test('permission and successful notification request are separate from display confirmation', async () => {
  let sent = 0;
  const { dom, document } = mount({ setup: (window) => {
    function Notification() { sent++; }
    Notification.permission = 'default';
    Notification.requestPermission = async () => { Notification.permission = 'granted'; return 'granted'; };
    window.Notification = Notification;
    Object.defineProperty(window.navigator, 'serviceWorker', { value: {
      register: async () => ({}), ready: Promise.resolve({ showNotification: async () => { sent++; } }),
    } });
  } });
  try {
    await settle(); assert.equal(document.getElementById('show-notification').disabled, true);
    document.getElementById('enable-notifications').click(); await settle();
    assert.equal(document.getElementById('notification-permission').textContent, '허용됨');
    document.getElementById('show-notification').click(); await settle();
    assert.equal(sent, 1);
    assert.equal(document.getElementById('notification-test-status').textContent, '확인 필요');
    assert.equal(document.getElementById('push-status').textContent, '연결 필요');
    document.getElementById('confirm-notification').click();
    assert.equal(document.getElementById('notification-test-status').textContent, '표시 확인됨');
    dom.window.Notification.permission = 'denied';
    dom.window.location.hash = '#notifications'; await settle();
    assert.equal(document.getElementById('show-notification').disabled, true);
  } finally { dom.window.close(); }
});

test('detail click switches visible screen and browser back/forward restores routes', async () => {
  const { dom, document } = mount({ url: 'http://127.0.0.1:3002/#events' });
  const visible = (id) => {
    assert.equal(document.getElementById(id).hidden, false);
    assert.equal(dom.window.getComputedStyle(document.getElementById(id)).display, 'block');
    assert.deepEqual([...document.querySelectorAll('.screen.active')].map((screen) => screen.id), [id]);
  };
  const travel = async (method) => {
    const navigated = new Promise((resolve) => dom.window.addEventListener('popstate', resolve, { once: true }));
    dom.window.history[method](); await navigated; await settle();
  };
  try {
    await settle(); visible('events');
    document.querySelector('#events-list a h3').click(); await settle();
    visible('detail');
    assert.equal(document.getElementById('events').hidden, true);
    assert.equal(document.getElementById('detail-content').hidden, false);
    assert.equal(document.querySelector('.nav-events').getAttribute('aria-current'), 'page');
    assert.equal(document.getElementById('detail-type').textContent, '낙상 의심');
    await travel('back'); visible('events');
    await travel('forward'); visible('detail');
  } finally { dom.window.close(); }
});

test('direct detail URL renders the selected incident on load', async () => {
  const { dom, document } = mount({ url: 'http://127.0.0.1:3002/?eventId=test-a#detail' });
  try {
    await settle();
    assert.equal(document.getElementById('detail').hidden, false);
    assert.equal(document.getElementById('home').hidden, true);
    assert.equal(document.getElementById('detail-content').hidden, false);
    assert.equal(dom.window.getComputedStyle(document.getElementById('detail')).display, 'block');
  } finally { dom.window.close(); }
});

test('date period includes both dates, composes with filters/pagination and survives detail return', async () => {
  const { dom, document, calls } = mount({ url: 'http://127.0.0.1:3002/#events', fetch: async (path) => {
    if (path.startsWith('/api/events?') && path.includes('from=')) return response({ items: [baseEvent], nextCursor: 'period-cursor' });
  } });
  try {
    await settle();
    document.getElementById('event-period-panel').open = true;
    document.querySelector('[data-filter="FALL_SUSPECTED"]').click(); await settle();
    const select = document.getElementById('event-state-filter'); select.value = 'OPEN'; select.dispatchEvent(new dom.window.Event('change')); await settle();
    document.getElementById('event-start-date').value = '2026-10-03';
    document.getElementById('event-end-date').value = '2026-10-06';
    const form = document.getElementById('event-period-form'); form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    const lastQuery = () => new URL(calls.filter(call => call.path.startsWith('/api/events?')).at(-1).path, 'http://localhost').searchParams;
    let query = lastQuery();
    assert.equal(query.get('from'), new Date('2026-10-03T00:00:00').toISOString());
    assert.equal(query.get('to'), new Date('2026-10-07T00:00:00').toISOString());
    assert.equal(query.get('type'), 'FALL_SUSPECTED'); assert.equal(query.get('state'), 'OPEN');
    assert.equal(query.has('cursor'), false);
    document.getElementById('load-more').click(); await settle();
    query = lastQuery(); assert.equal(query.get('cursor'), 'period-cursor'); assert.equal(query.has('from'), true);
    document.querySelector('#events-list a').click(); await settle();
    dom.window.location.hash = '#events'; await settle();
    query = lastQuery(); assert.equal(query.has('from'), true); assert.equal(query.has('cursor'), false);
    const requestsBeforeInvalid = calls.length;
    document.getElementById('event-end-date').value = '2026-10-02';
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(calls.length, requestsBeforeInvalid);
    assert.equal(document.getElementById('event-period-error').hidden, false);
    document.getElementById('event-period-reset').click(); await settle();
    query = lastQuery(); assert.equal(query.has('from'), false); assert.equal(query.has('to'), false); assert.equal(query.has('cursor'), false);
    assert.equal(query.get('type'), 'FALL_SUSPECTED'); assert.equal(query.get('state'), 'OPEN');
    assert.equal(document.getElementById('event-period-summary').textContent, '전체 기간');
  } finally { dom.window.close(); }
});

test('date period allows a single day and one-sided bounds', async () => {
  const { dom, document, calls } = mount();
  try {
    await settle();
    document.getElementById('event-period-panel').open = true;
    const form = document.getElementById('event-period-form');
    const start = document.getElementById('event-start-date'); const end = document.getElementById('event-end-date');
    const query = () => new URL(calls.at(-1).path, 'http://localhost').searchParams;
    start.value = '2026-10-06'; end.value = '2026-10-06';
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(query().get('to'), new Date('2026-10-07T00:00:00').toISOString());
    end.value = ''; form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(query().has('from'), true); assert.equal(query().has('to'), false);
    start.value = ''; end.value = '2026-10-06'; form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(query().has('from'), false); assert.equal(query().has('to'), true);
  } finally { dom.window.close(); }
});

test('time period retains its bounds through pagination and clears all date/time inputs on reset', async () => {
  const { dom, document, calls } = mount({ fetch: async (path) => {
    if (path.startsWith('/api/events?') && path.includes('from=')) return response({ items: [baseEvent], nextCursor: 'time-cursor' });
  } });
  try {
    await settle();
    const panel = document.getElementById('event-period-panel'); panel.open = true;
    document.getElementById('event-start-date').value = '2026-10-05';
    document.getElementById('event-end-date').value = '2026-10-06';
    document.getElementById('event-start-time').value = '22:15';
    document.getElementById('event-end-time').value = '07:45';
    const form = document.getElementById('event-period-form');
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    const query = () => new URL(calls.filter(call => call.path.startsWith('/api/events?')).at(-1).path, 'http://localhost').searchParams;
    assert.equal(query().get('from'), new Date('2026-10-05T22:15:00').toISOString());
    assert.equal(query().get('to'), new Date('2026-10-06T07:46:00').toISOString());
    panel.open = false;
    assert.match(panel.querySelector('summary').textContent, /22:15.*07:45/);
    document.getElementById('load-more').click(); await settle();
    assert.equal(query().get('cursor'), 'time-cursor');
    assert.equal(query().get('from'), new Date('2026-10-05T22:15:00').toISOString());
    assert.equal(query().get('to'), new Date('2026-10-06T07:46:00').toISOString());
    panel.open = true;
    document.getElementById('event-period-reset').click(); await settle();
    for (const id of ['event-start-date', 'event-end-date', 'event-start-time', 'event-end-time']) assert.equal(document.getElementById(id).value, '');
    assert.equal(query().has('from'), false); assert.equal(query().has('to'), false); assert.equal(query().has('cursor'), false);
  } finally { dom.window.close(); }
});

test('time period rejects time without a date and reversed times, and includes a whole selected end minute', async () => {
  const { dom, document, calls } = mount();
  try {
    await settle();
    document.getElementById('event-period-panel').open = true;
    const form = document.getElementById('event-period-form');
    const submit = async () => { form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle(); };
    const query = () => new URL(calls.at(-1).path, 'http://localhost').searchParams;
    const startDate = document.getElementById('event-start-date'); const endDate = document.getElementById('event-end-date');
    const startTime = document.getElementById('event-start-time'); const endTime = document.getElementById('event-end-time');
    startTime.value = '09:00'; let before = calls.length; await submit();
    assert.equal(calls.length, before); assert.equal(document.getElementById('event-period-error').hidden, false);
    startDate.value = endDate.value = '2026-10-06'; endTime.value = '08:59'; before = calls.length; await submit();
    assert.equal(calls.length, before);
    endTime.value = '09:00'; await submit();
    assert.equal(query().get('from'), new Date('2026-10-06T09:00:00').toISOString());
    assert.equal(query().get('to'), new Date('2026-10-06T09:01:00').toISOString());
    assert.equal(document.getElementById('event-period-error').hidden, true);
    endTime.value = '23:59'; await submit();
    assert.equal(query().get('to'), new Date('2026-10-07T00:00:00').toISOString());
    endDate.value = ''; endTime.value = ''; await submit();
    assert.equal(query().get('from'), new Date('2026-10-06T09:00:00').toISOString()); assert.equal(query().has('to'), false);
    startDate.value = ''; startTime.value = ''; endDate.value = '2026-10-06'; endTime.value = '12:30'; await submit();
    assert.equal(query().has('from'), false); assert.equal(query().get('to'), new Date('2026-10-06T12:31:00').toISOString());
    endDate.value = ''; before = calls.length; await submit(); assert.equal(calls.length, before);
  } finally { dom.window.close(); }
});

test('incident types stay visible while state and period collapse together', async () => {
  const { dom, document } = mount({ url: 'http://127.0.0.1:3002/#events' });
  try {
    await settle();
    const panel = document.getElementById('event-period-panel');
    assert.equal(panel.open, false);
    assert.ok(document.querySelector('#events .filters').compareDocumentPosition(panel) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(panel.contains(document.getElementById('event-state-filter')), true);
    assert.equal(panel.contains(document.getElementById('event-period-form')), true);
    panel.querySelector('summary').click(); assert.equal(panel.open, true);
    const state = document.getElementById('event-state-filter'); state.value = 'RESOLVED'; state.dispatchEvent(new dom.window.Event('change')); await settle();
    document.getElementById('event-start-date').value = '2026-10-06';
    document.getElementById('event-period-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    panel.querySelector('summary').click(); assert.equal(panel.open, false);
    assert.match(panel.querySelector('summary').textContent, /2026-10-06 이후/);
    assert.match(panel.querySelector('summary').textContent, /해소됨/);
  } finally { dom.window.close(); }
});

test('retired bed controls and filter stay absent even with legacy settings', async () => {
  const { dom, document, calls } = mount({ fetch: async path => {
    if (path === '/api/settings') return response({ version: 1, updatedAt: timestamp,
      bedMonitoringEnabled: true, bedMonitoringMode: 'TIME_RANGE' });
  } });
  try {
    await settle();
    for (const id of ['bed-state', 'bed-exit-info', 'bed-alert-settings', 'bed-monitoring-enabled', 'non-return-minutes']) {
      assert.equal(document.getElementById(id), null);
    }
    assert.equal(document.querySelector('[data-filter="NON_RETURN_WARNING"]'), null);
    assert.doesNotMatch(document.getElementById('settings-alerts').textContent, /미복귀/);
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    assert.deepEqual(Object.keys(JSON.parse(calls.find(call => call.method === 'PATCH').body)).sort(),
      ['fallAlertEnabled', 'gatewayFaultAlertEnabled', 'lowActivityEnabled', 'lowActivityEnd', 'lowActivityMinutes', 'lowActivityMode', 'lowActivityStart', 'lowActivityThreshold', 'sensorFaultAlertEnabled']);
  } finally { dom.window.close(); }
});

test('alert switches save independently while device state appears first and save appears last', async () => {
  let settings = { version: 1, updatedAt: timestamp,
    fallAlertEnabled: true, sensorFaultAlertEnabled: true, gatewayFaultAlertEnabled: true };
  const { dom, document, calls, timers } = mount({ url: 'http://127.0.0.1:3002/#settings', fetch: async (path, options) => {
    if (path === '/api/settings') {
      if (options.method === 'PATCH') settings = { ...settings, ...JSON.parse(options.body), version: settings.version + 1 };
      return response(settings);
    }
    if (path === '/api/status') return response({ isDemo: false, gateway: { connected: true }, sensor: { available: true, fresh: true, qualityStatus: 'AVAILABLE' }, settings: { ...settings, appliedVersion: 1 } });
  } });
  try {
    await settle();
    const form = document.getElementById('settings-form');
    assert.ok(document.getElementById('settings-status').compareDocumentPosition(form) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(form.lastElementChild.id, 'settings-save');
    assert.equal(form.parentElement.lastElementChild, form);
    assert.equal(document.getElementById('settings-gateway-state').textContent, '연결됨');
    assert.equal(document.getElementById('settings-sensor-state').textContent, '측정 중');
    for (const id of ['fall-alert-enabled', 'sensor-fault-alert-enabled']) {
      document.getElementById(id).checked = false;
      document.getElementById(id).dispatchEvent(new dom.window.Event('change'));
    }
    await timers[0]();
    assert.equal(document.getElementById('fall-alert-enabled').checked, false);
    assert.equal(document.getElementById('sensor-fault-alert-enabled').checked, false);
    assert.equal(document.getElementById('gateway-fault-alert-enabled').checked, true);
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    const body = JSON.parse(calls.filter(call => call.method === 'PATCH').at(-1).body);
    assert.equal(body.fallAlertEnabled, false); assert.equal(body.sensorFaultAlertEnabled, false); assert.equal(body.gatewayFaultAlertEnabled, true);
    assert.equal(body.nonReturnMinutes, undefined); assert.equal(body.bedMonitoringMode, undefined);
    assert.match(document.getElementById('settings-alerts').textContent, /낙상 의심 감지 꺼짐.*센싱 장애 감지 꺼짐.*기기 통신 장애 감지 켜짐/);
    assert.equal(document.getElementById('settings-application').textContent, '적용 확인 중');
  } finally { dom.window.close(); }
});

test('home distinguishes pending incidents, an empty result and a failed query', async () => {
  let phase = 'pending';
  const { dom, document, timers } = mount({ fetch: async (path) => {
    if (path === '/api/events?state=OPEN&limit=5') {
      if (phase === 'failed') return response({ error: { message: 'query failed' } }, 500);
      return response({ items: phase === 'pending' ? [baseEvent] : [], nextCursor: null });
    }
  } });
  try {
    await settle();
    const card = document.getElementById('home-event-summary');
    assert.equal(card.classList.contains('warning'), true);
    const event = document.querySelector('#home-events .event');
    assert.match(event.getAttribute('aria-label'), /낙상 의심.*미확인.*상세 보기/);
    assert.equal(event.querySelectorAll('p').length, 1, 'long descriptions stay on the detail page');
    phase = 'empty'; await timers[0]();
    assert.equal(card.classList.contains('warning'), false);
    assert.equal(card.classList.contains('white'), true);
    assert.match(document.getElementById('home-events').textContent, /미확인 사건이 없/);
    phase = 'failed'; await timers[0]();
    assert.equal(card.classList.contains('warning'), true);
    assert.match(document.getElementById('home-events').textContent, /조회 실패/);
    assert.doesNotMatch(document.getElementById('home-events').textContent, /사건이 없/);
  } finally { dom.window.close(); }
});

test('unsaved edits, saving progress and saved versus applied states remain distinct', async () => {
  let settings = { version: 1, updatedAt: timestamp };
  let appliedVersion = 1;
  let finishSave;
  const { dom, document, timers } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response({ isDemo: false, gateway: { connected: true }, sensor: { available: true, fresh: true, qualityStatus: 'AVAILABLE' }, settings: { ...settings, appliedVersion } });
    if (path === '/api/settings') {
      if (options.method === 'PATCH') return new Promise(resolve => {
        finishSave = () => { settings = { ...settings, ...JSON.parse(options.body), version: 2 }; resolve(response(settings)); };
      });
      return response(settings);
    }
  } });
  try {
    await settle();
    const input = document.getElementById('fall-alert-enabled');
    const notice = document.getElementById('settings-unsaved');
    const form = document.getElementById('settings-form');
    assert.equal(notice.hidden, true);
    input.checked = false; input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(notice.hidden, false);
    input.checked = true; input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(notice.hidden, true, 'returning to the saved value clears the notice');
    input.checked = false; input.dispatchEvent(new dom.window.Event('input'));
    await timers[0]();
    assert.equal(input.checked, false); assert.equal(notice.hidden, false);
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.match(notice.textContent, /저장하고/);
    assert.equal(form.getAttribute('aria-busy'), 'true');
    assert.equal(document.getElementById('settings-save').disabled, true);
    assert.match(document.getElementById('settings-save').textContent, /저장 중/);
    finishSave(); await settle();
    assert.equal(notice.hidden, true);
    assert.equal(form.getAttribute('aria-busy'), 'false');
    assert.equal(document.getElementById('settings-message').hidden, false);
    assert.equal(document.getElementById('settings-application').textContent, '적용 확인 중');
    await timers[0]();
    assert.equal(document.getElementById('settings-message').hidden, false, 'polling preserves saved feedback');
    appliedVersion = 2; await timers[0]();
    assert.equal(document.getElementById('settings-application').textContent, '적용됨');
    assert.equal(document.querySelectorAll('#settings-alerts .detection-chip').length, 4);
    assert.match(document.querySelector('#settings-alerts .detection-chip:nth-child(2)').textContent, /낙상 의심 감지 꺼짐/);
    assert.equal(dom.window.getComputedStyle(document.querySelector('.toggle-row')).minHeight, '48px');
    assert.equal(dom.window.getComputedStyle(document.querySelector('.back')).minHeight, '44px');
  } finally { dom.window.close(); }
});

test('date groups merge across pages, deduplicate incidents and escape handling reasons', async () => {
  const reason = '<img src=x onerror=alert(1)> 직접 확인';
  const sameDay = { ...baseEvent, eventId: 'same-day', type: 'NON_RETURN_WARNING', state: 'RESOLVED',
    occurredAt: '2026-10-06T11:00:00.000Z', resolvedAt: timestamp, resolutionReason: reason };
  const previousDay = { ...baseEvent, eventId: 'previous-day', state: 'ACKNOWLEDGED',
    occurredAt: '2026-10-05T11:00:00.000Z', acknowledgedAt: timestamp };
  const { dom, document } = mount({ url: 'http://127.0.0.1:3002/#events', fetch: async path => {
    if (path.startsWith('/api/events?') && !path.includes('state=OPEN')) {
      return response(path.includes('cursor=') ? { items: [baseEvent, sameDay, previousDay], nextCursor: null }
        : { items: [baseEvent], nextCursor: 'next-page' });
    }
  } });
  try {
    await settle();
    assert.equal(document.querySelectorAll('#events-list .event-group').length, 1);
    document.getElementById('load-more').click(); await settle();
    const groups = document.querySelectorAll('#events-list .event-group');
    assert.equal(groups.length, 2);
    assert.equal(groups[0].querySelectorAll('.event').length, 2);
    assert.equal(groups[1].querySelectorAll('.event').length, 1);
    assert.equal(document.getElementById('load-more').hidden, true);
    assert.match(document.querySelector('#events-list [data-event-id="test-a"] .event-footer').textContent, /보호자 확인 기록 없음/);
    assert.match(document.querySelector('#events-list [data-event-id="previous-day"] .event-footer').textContent, /보호자 확인/);
    const resolved = document.querySelector('#events-list [data-event-id="same-day"]');
    assert.equal(resolved.querySelector('.event-reason').textContent, reason);
    assert.equal(resolved.querySelector('img'), null);
    assert.equal(resolved.querySelector('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(resolved.querySelector('svg use').getAttribute('href'), '#i-list');
    assert.match(resolved.getAttribute('aria-label'), /미복귀 · 이전 기록.*해소됨/);
    assert.equal(document.querySelector('#home-events .event-footer'), null);
  } finally { dom.window.close(); }
});

test('details show server receipt separately without implying push delivery', async () => {
  const receivedAt = '2026-10-06T12:00:03.000Z';
  const { dom, document } = mount({ url: 'http://127.0.0.1:3002/?eventId=test-a#detail', fetch: async path => {
    if (path === '/api/events/test-a') return response({ ...baseEvent, receivedAt,
      actions: [{ type: 'CREATED', createdAt: receivedAt, detail: {} }] });
  } });
  try {
    await settle();
    assert.match(document.getElementById('detail-received').textContent, /\d{2}:\d{2}:03$/);
    assert.notEqual(document.getElementById('detail-received').textContent, document.getElementById('detail-detected').textContent);
    assert.match(document.getElementById('detail-actions').textContent, /서버에 사건 저장/);
    assert.doesNotMatch(document.getElementById('detail-actions').textContent, /푸시.*접수|전달 완료/);
    assert.equal(document.querySelector('#detail-icon use').getAttribute('href'), '#i-alert');
  } finally { dom.window.close(); }
});

test('measurement age and settings application require actual signals and survive missing or failed status safely', async () => {
  let phase = 'actual';
  const { dom, document, timers } = mount({ fetch: async path => {
    if (path !== '/api/status') return;
    if (phase === 'failed') return response({ error: { message: 'offline' } }, 500);
    return response({ isDemo: phase === 'sample', gateway: { connected: phase !== 'stale', receivedAt: timestamp },
      sensor: { available: true, fresh: true, measuredAt: timestamp, ageSeconds: 7, qualityStatus: 'AVAILABLE' },
      fetchedAt: timestamp,
      settings: { version: 2, appliedVersion: 1, updatedAt: timestamp, nonReturnMinutes: 10 } });
  } });
  try {
    await settle();
    assert.match(document.getElementById('observation-age').textContent, /측정 7초 전/);
    assert.equal(document.getElementById('settings-application').textContent, '적용 확인 중');
    phase = 'stale'; await timers[0]();
    assert.equal(document.getElementById('settings-application').textContent, '연결 필요');
    phase = 'sample'; await timers[0]();
    assert.match(document.getElementById('observation-age').textContent, /측정 기록 없음/);
    assert.doesNotMatch(document.getElementById('observation-age').textContent, /7초 전/);
    assert.equal(document.getElementById('settings-application').textContent, '연결 필요');
    phase = 'failed'; await timers[0]();
    assert.match(document.getElementById('observation-age').textContent, /조회하지 못/);
  } finally { dom.window.close(); }
});

test('device identity and granted permission never claim remote push is ready', async () => {
  const { dom, document } = mount({ url: 'http://127.0.0.1:3002/#notifications', setup: window => {
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' });
    window.Notification = { permission: 'granted' };
  } });
  try {
    await settle();
    assert.equal(document.getElementById('notification-device').textContent, '안드로이드 · Chrome');
    assert.equal(document.getElementById('notification-permission').textContent, '허용됨');
    assert.equal(document.getElementById('push-status').textContent, '연결 필요');
    assert.match(document.getElementById('push-status').closest('section').textContent, /원격 알림 수신이 연결되지/);
    assert.doesNotMatch(document.getElementById('notification-help').textContent, /받을 수 있습니다/);
  } finally { dom.window.close(); }
});

test('notification switch persists off, blocks displays and resumes only with permission', async () => {
  let sent = 0;
  let closed = 0;
  const { dom, document } = mount({ setup: window => {
    function Notification() { sent++; this.close = () => { closed++; }; }
    Notification.permission = 'granted';
    window.Notification = Notification;
  } });
  let persisted;
  try {
    await settle();
    const toggle = document.getElementById('notification-enabled');
    assert.equal(toggle.checked, true);
    document.getElementById('show-notification').click(); await settle();
    assert.equal(sent, 1);
    toggle.click(); await settle();
    assert.equal(closed, 1);
    assert.equal(document.getElementById('notification-enabled-status').textContent, '꺼짐');
    assert.equal(document.getElementById('notification-permission').textContent, '허용됨');
    assert.equal(document.getElementById('show-notification').disabled, true);
    assert.equal(document.getElementById('confirm-notification').hidden, true);
    document.getElementById('show-notification').dispatchEvent(new dom.window.MouseEvent('click'));
    await settle(); assert.equal(sent, 1);
    persisted = dom.window.localStorage.getItem('onguard.notifications.enabled');
    assert.equal(persisted, 'false');
    toggle.click(); await settle();
    assert.equal(document.getElementById('show-notification').disabled, false);
    document.getElementById('show-notification').click(); await settle();
    assert.equal(sent, 2);
    dom.window.Notification.permission = 'denied';
    toggle.click(); toggle.click(); await settle();
    assert.equal(document.getElementById('show-notification').disabled, true);
    assert.equal(document.getElementById('notification-permission').textContent, '차단됨');
  } finally { dom.window.close(); }
  const restored = mount({ setup: window => {
    window.localStorage.setItem('onguard.notifications.enabled', persisted);
    window.Notification = { permission: 'granted' };
  } });
  try {
    await settle();
    assert.equal(restored.document.getElementById('notification-enabled').checked, false);
    assert.equal(restored.document.getElementById('show-notification').disabled, true);
  } finally { restored.dom.window.close(); }
});

test('turning notifications off while service worker is preparing cancels the display', async () => {
  let ready;
  let sent = 0;
  const { dom, document } = mount({ setup: window => {
    window.Notification = { permission: 'granted' };
    Object.defineProperty(window.navigator, 'serviceWorker', { value: {
      register: async () => ({}), ready: new Promise(resolve => { ready = resolve; }),
    } });
  } });
  try {
    await settle();
    document.getElementById('show-notification').click(); await settle();
    document.getElementById('notification-enabled').click();
    ready({ showNotification: async () => { sent++; } }); await settle();
    assert.equal(sent, 0);
    assert.equal(document.getElementById('notification-test-status').textContent, '알림 꺼짐');
    assert.equal(document.getElementById('confirm-notification').hidden, true);
  } finally { dom.window.close(); }
});

test('late notification completion after switching off is closed and never offered for confirmation', async () => {
  let complete;
  let closed = 0;
  const registration = {
    showNotification: () => new Promise(resolve => { complete = resolve; }),
    getNotifications: async options => {
      assert.equal(options.tag, 'onguard-display-test');
      return [{ close: () => { closed++; } }];
    },
  };
  const { dom, document } = mount({ setup: window => {
    window.Notification = { permission: 'granted' };
    Object.defineProperty(window.navigator, 'serviceWorker', { value: {
      register: async () => registration, ready: Promise.resolve(registration),
    } });
  } });
  try {
    await settle();
    document.getElementById('show-notification').click(); await settle();
    document.getElementById('notification-enabled').click();
    complete(); await settle();
    assert.equal(closed, 1);
    assert.equal(document.getElementById('confirm-notification').hidden, true);
    assert.equal(document.getElementById('notification-test-status').textContent, '알림 꺼짐');
  } finally { dom.window.close(); }
});

test('notification preferences follow another tab and storage failures never claim a saved change', async () => {
  const { dom, document } = mount({ setup: window => { window.Notification = { permission: 'granted' }; } });
  try {
    await settle();
    dom.window.localStorage.setItem('onguard.notifications.enabled', 'false');
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'onguard.notifications.enabled', newValue: 'false' }));
    assert.equal(document.getElementById('notification-enabled').checked, false);
    assert.equal(document.getElementById('show-notification').disabled, true);
    dom.window.Storage.prototype.setItem = () => { throw new Error('blocked'); };
    document.getElementById('notification-enabled').click(); await settle();
    assert.equal(document.getElementById('notification-enabled').checked, false);
    assert.equal(dom.window.localStorage.getItem('onguard.notifications.enabled'), 'false');
    assert.match(document.getElementById('connection-message').textContent, /저장하지 못/);
  } finally { dom.window.close(); }
  const blocked = mount({ setup: window => {
    window.Notification = { permission: 'granted' };
    window.Storage.prototype.getItem = () => { throw new Error('blocked'); };
  } });
  try {
    await settle();
    assert.equal(blocked.document.getElementById('notification-enabled').disabled, true);
    assert.equal(blocked.document.getElementById('notification-enabled-status').textContent, '저장 불가');
    assert.equal(blocked.document.getElementById('show-notification').disabled, true);
    assert.equal(blocked.document.getElementById('home').hidden, false);
  } finally { blocked.dom.window.close(); }
});

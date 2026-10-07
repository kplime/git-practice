const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
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
    if (path === '/api/status') return response({ gateway: { connected: false, receivedAt: timestamp, ageSeconds: 60 }, sensor: { available: true, qualityStatus: 'AVAILABLE', measuredAt: timestamp }, bedState: 'IN_BED', isDemo: true, fetchedAt: timestamp });
    if (path === '/api/settings') return response({ version: 1, nonReturnMinutes: 10, updatedAt: timestamp });
    if (path.startsWith('/api/events?')) return response({ items: [baseEvent], nextCursor: null });
    if (path === '/api/events/test-a') return response(baseEvent);
    throw new Error(`Unmocked request ${path}`);
  };
  dom.window.eval(app);
  return { dom, document: dom.window.document, calls, timers };
}

test('stale heartbeat never shows current bed occupancy or developer-only copy', async () => {
  const { dom, document } = mount();
  try {
    await settle();
    assert.match(document.getElementById('bed-state').textContent, /확인할 수 없/);
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
      bedState: 'OUT_OF_BED', bedExitedAt: new Date(Date.now() - 14 * 60000).toISOString(),
      settings: { version: 1, nonReturnMinutes: 10, updatedAt: timestamp, appliedVersion: 1 },
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
      assert.equal(document.getElementById('bed-exit-info').hidden, true);
      assert.match(document.getElementById('bed-state').textContent, /확인할 수 없/);
      assert.equal(document.getElementById('settings-application').textContent, '연결 필요');
      assert.equal(document.getElementById('settings-gateway-state').textContent, '연결 대기');
      assert.notEqual(document.getElementById('settings-sensor-state').textContent, '측정 중');
      assert.equal(document.querySelectorAll('#events-list .event').length, 1, 'sample event history remains available');
    }
    source = false; await timers[0]();
    assert.equal(document.getElementById('status-badge').textContent, '정상');
    assert.equal(document.getElementById('sensor-state').textContent, '측정 중');
    assert.notEqual(document.getElementById('measured-at').textContent, '기록 없음');
    assert.equal(document.getElementById('bed-exit-info').hidden, false);
    assert.equal(document.getElementById('settings-application').textContent, '적용됨');
  } finally { dom.window.close(); }
});

test('late filter responses cannot replace the newly selected filter', async () => {
  let release;
  const { dom, document } = mount({ fetch: async (path) => {
    if (path.includes('type=FALL_SUSPECTED')) return new Promise((resolve) => { release = resolve; });
    if (path.includes('type=NON_RETURN_WARNING')) return response({ items: [{ ...baseEvent, eventId: 'test-b', type: 'NON_RETURN_WARNING' }], nextCursor: null });
  } });
  try {
    await settle();
    document.querySelector('[data-filter="FALL_SUSPECTED"]').click();
    await settle();
    document.querySelector('[data-filter="NON_RETURN_WARNING"]').click();
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
    document.getElementById('non-return-minutes').value = '22';
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(document.getElementById('non-return-minutes').value, '22');
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
    assert.match(document.getElementById('bed-state').textContent, /확인할 수 없/);
  } finally { dom.window.close(); }
});

test('fresh communication cannot hide an unavailable, old or degraded measurement', async () => {
  let sensor = { available: true, qualityStatus: 'AVAILABLE', measuredAt: timestamp, fresh: false };
  const { dom, document, timers } = mount({ fetch: async (path) => {
    if (path === '/api/status') return response({ isDemo: false, gateway: { connected: true, receivedAt: timestamp }, sensor, bedState: 'OUT_OF_BED', bedExitedAt: new Date(Date.now() - 14 * 60000).toISOString(), settings: { version: 1, nonReturnMinutes: 10, updatedAt: timestamp, appliedVersion: 1 } });
  } });
  try {
    await settle();
    assert.equal(document.getElementById('status-badge').textContent, '감지 확인 필요');
    assert.match(document.getElementById('bed-state').textContent, /확인할 수 없/);
    assert.equal(document.getElementById('bed-exit-info').hidden, true);
    for (const update of [{ available: false, fresh: true, qualityStatus: 'UNAVAILABLE' }, { available: true, fresh: true, qualityStatus: 'DEGRADED' }]) {
      sensor = { ...sensor, ...update }; await timers[0]();
      assert.equal(document.getElementById('status-badge').classList.contains('success'), false);
      assert.equal(document.getElementById('bed-exit-info').hidden, true);
    }
    sensor = { ...sensor, available: true, fresh: true, qualityStatus: 'AVAILABLE' }; await timers[0]();
    assert.equal(document.getElementById('status-badge').textContent, '정상');
    assert.equal(document.getElementById('bed-exit-info').hidden, false);
    assert.match(document.getElementById('bed-exit-info').textContent, /14분 경과.*10분/);
  } finally { dom.window.close(); }
});

test('settings polling preserves edits and requires matching applied version', async () => {
  let settings = { version: 1, nonReturnMinutes: 10, updatedAt: timestamp, appliedVersion: 1 };
  const { dom, document, timers } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response({ isDemo: false, gateway: { connected: true }, sensor: { available: true, fresh: true, qualityStatus: 'AVAILABLE' }, bedState: 'IN_BED', settings });
    if (path === '/api/settings' && options.method === 'PATCH') {
      settings = { ...settings, version: 2, nonReturnMinutes: 22 };
      return response(settings);
    }
  } });
  try {
    await settle();
    assert.equal(document.getElementById('settings-application').textContent, '적용됨');
    const input = document.getElementById('non-return-minutes');
    input.value = '22'; input.dispatchEvent(new dom.window.Event('input'));
    await timers[0](); assert.equal(input.value, '22');
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(document.getElementById('settings-application').textContent, '적용 확인 중');
    assert.equal(document.getElementById('non-return-minutes').value, '22');
    assert.equal(document.getElementById('settings-unsaved').hidden, true);
    settings.appliedVersion = 2; await timers[0]();
    assert.equal(document.getElementById('settings-application').textContent, '적용됨');
    input.value = '0'; document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    assert.equal(document.getElementById('settings-message').hidden, false);
    assert.match(document.getElementById('settings-message').textContent, /1~1440/);
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

test('bed schedule saves with the threshold and polling preserves unsaved time edits', async () => {
  let settings = { version: 1, nonReturnMinutes: 10, updatedAt: timestamp, bedMonitoringEnabled: true, bedMonitoringMode: 'ALL_DAY', bedMonitoringStart: '22:00', bedMonitoringEnd: '07:00', timeZone: 'Asia/Seoul' };
  const { dom, document, timers, calls } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response({ isDemo: false, gateway: { connected: true }, sensor: { available: true, fresh: true, qualityStatus: 'AVAILABLE' }, bedState: 'IN_BED', settings: { ...settings, appliedVersion: 1 } });
    if (path === '/api/settings' && options.method === 'PATCH') {
      settings = { ...settings, ...JSON.parse(options.body), version: settings.version + 1 };
      return response(settings);
    }
  } });
  try {
    await settle();
    assert.equal(document.getElementById('bed-monitoring-enabled').checked, true);
    assert.equal(document.getElementById('bed-monitoring-times').hidden, true);
    assert.equal(document.getElementById('bed-monitoring-start').disabled, true);
    const group = document.getElementById('bed-alert-settings');
    for (const id of ['bed-monitoring-start', 'bed-monitoring-end', 'non-return-minutes']) assert.equal(group.contains(document.getElementById(id)), true);
    const mode = document.getElementById('bed-monitoring-mode');
    mode.value = 'TIME_RANGE'; mode.dispatchEvent(new dom.window.Event('change'));
    assert.equal(document.getElementById('bed-monitoring-times').hidden, false);
    assert.equal(document.getElementById('bed-monitoring-start').disabled, false);
    const end = document.getElementById('bed-monitoring-end'); end.value = '06:00'; end.dispatchEvent(new dom.window.Event('input'));
    assert.equal(mode.value, 'TIME_RANGE', 'editing a time directly selects that custom window');
    await timers[0]();
    assert.equal(end.value, '06:00'); assert.equal(mode.value, 'TIME_RANGE');
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.deepEqual(JSON.parse(calls.filter(call => call.method === 'PATCH').at(-1).body), {
      nonReturnMinutes: 10, bedMonitoringEnabled: true, bedMonitoringMode: 'TIME_RANGE', bedMonitoringStart: '22:00', bedMonitoringEnd: '06:00',
      fallAlertEnabled: true, sensorFaultAlertEnabled: true, gatewayFaultAlertEnabled: true,
    });
    assert.match(document.getElementById('bed-monitoring-summary').textContent, /22:00 ~ 06:00.*다음 날/);
    assert.equal(document.getElementById('settings-application').textContent, '적용 확인 중');
    end.value = '22:00'; end.dispatchEvent(new dom.window.Event('input'));
    const beforeInvalid = calls.length;
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(calls.length, beforeInvalid);
    assert.equal(document.getElementById('settings-message').hidden, false);
    const enabled = document.getElementById('bed-monitoring-enabled'); enabled.checked = false; enabled.dispatchEvent(new dom.window.Event('change'));
    assert.equal(mode.disabled, true); assert.equal(end.disabled, true);
    assert.equal(document.getElementById('non-return-minutes').disabled, true);
    assert.equal(document.getElementById('settings-save').disabled, false);
    document.getElementById('settings-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    assert.equal(settings.bedMonitoringEnabled, false);
    assert.match(document.getElementById('bed-monitoring-summary').textContent, /감지 꺼짐/);
    assert.match(document.getElementById('settings-alerts').textContent, /미복귀 감지 꺼짐/);
  } finally { dom.window.close(); }
});

test('alert switches save independently while device state appears first and save appears last', async () => {
  let settings = { version: 1, nonReturnMinutes: 10, updatedAt: timestamp,
    bedMonitoringEnabled: true, bedMonitoringMode: 'ALL_DAY', bedMonitoringStart: '22:00', bedMonitoringEnd: '07:00',
    fallAlertEnabled: true, sensorFaultAlertEnabled: true, gatewayFaultAlertEnabled: true };
  const { dom, document, calls, timers } = mount({ url: 'http://127.0.0.1:3002/#settings', fetch: async (path, options) => {
    if (path === '/api/settings') {
      if (options.method === 'PATCH') settings = { ...settings, ...JSON.parse(options.body), version: settings.version + 1 };
      return response(settings);
    }
    if (path === '/api/status') return response({ isDemo: false, gateway: { connected: true }, sensor: { available: true, fresh: true, qualityStatus: 'AVAILABLE' }, bedState: 'IN_BED', settings: { ...settings, appliedVersion: 1 } });
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
    assert.equal(body.nonReturnMinutes, 10); assert.equal(body.bedMonitoringMode, 'ALL_DAY');
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
  let settings = { version: 1, nonReturnMinutes: 10, updatedAt: timestamp };
  let appliedVersion = 1;
  let finishSave;
  const { dom, document, timers } = mount({ fetch: async (path, options) => {
    if (path === '/api/status') return response({ isDemo: false, gateway: { connected: true }, sensor: { available: true, fresh: true, qualityStatus: 'AVAILABLE' }, bedState: 'IN_BED', settings: { ...settings, appliedVersion } });
    if (path === '/api/settings') {
      if (options.method === 'PATCH') return new Promise(resolve => {
        finishSave = () => { settings = { ...settings, ...JSON.parse(options.body), version: 2 }; resolve(response(settings)); };
      });
      return response(settings);
    }
  } });
  try {
    await settle();
    const input = document.getElementById('non-return-minutes');
    const notice = document.getElementById('settings-unsaved');
    const form = document.getElementById('settings-form');
    assert.equal(notice.hidden, true);
    input.value = '22'; input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(notice.hidden, false);
    input.value = '10'; input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(notice.hidden, true, 'returning to the saved value clears the notice');
    input.value = '22'; input.dispatchEvent(new dom.window.Event('input'));
    await timers[0]();
    assert.equal(input.value, '22'); assert.equal(notice.hidden, false);
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
    assert.match(document.querySelector('#settings-alerts .detection-chip').textContent, /미복귀 감지 켜짐/);
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
    assert.equal(resolved.querySelector('svg use').getAttribute('href'), '#i-bed');
    assert.match(resolved.getAttribute('aria-label'), /미복귀.*해소됨/);
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
      fetchedAt: timestamp, bedState: 'OUT_OF_BED', bedExitedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      settings: { version: 2, appliedVersion: 1, updatedAt: timestamp, nonReturnMinutes: 10 } });
  } });
  try {
    await settle();
    assert.match(document.getElementById('observation-age').textContent, /측정 7초 전/);
    assert.equal(document.getElementById('bed-exited-at').hidden, false);
    assert.equal(document.getElementById('settings-application').textContent, '적용 확인 중');
    phase = 'stale'; await timers[0]();
    assert.equal(document.getElementById('settings-application').textContent, '연결 필요');
    assert.equal(document.getElementById('bed-exited-at').hidden, true);
    phase = 'sample'; await timers[0]();
    assert.match(document.getElementById('observation-age').textContent, /측정 기록 없음/);
    assert.doesNotMatch(document.getElementById('observation-age').textContent, /7초 전/);
    assert.equal(document.getElementById('settings-application').textContent, '연결 필요');
    phase = 'failed'; await timers[0]();
    assert.match(document.getElementById('observation-age').textContent, /조회하지 못/);
    assert.equal(document.getElementById('bed-exited-at').hidden, true);
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

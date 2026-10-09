(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const types = {
    FALL_SUSPECTED: ['낙상 의심', '낙상과 유사한 움직임 패턴이 감지되었습니다. 직접 상태를 확인해 주세요.'],
    LOW_ACTIVITY: ['장시간 저활동', '낮은 활동 지표가 설정한 시간 동안 이어졌습니다. 직접 상태를 확인해 주세요.'],
    NON_RETURN_WARNING: ['미복귀 · 이전 기록', '기능 정리 전에 저장된 미복귀 사건입니다. 현재 감지 유형에는 포함되지 않습니다.'],
    SENSOR_UNAVAILABLE: ['장애 · 센싱 연결', 'CSI 수집 또는 품질에 문제가 있어 관측 상태를 확인할 수 없습니다.'],
    GATEWAY_OFFLINE: ['장애 · 기기 통신', '연결이 끊겨 감지 상태를 확인할 수 없습니다.'],
  };
  const states = { OPEN: '미확인', ACKNOWLEDGED: '확인됨', RESOLVED: '해소됨' };
  const typeIcons = { FALL_SUSPECTED: 'i-alert', LOW_ACTIVITY: 'i-low-activity', NON_RETURN_WARNING: 'i-list', SENSOR_UNAVAILABLE: 'i-wifi', GATEWAY_OFFLINE: 'i-monitor' };
  const qualities = { AVAILABLE: '사용 가능', DEGRADED: '품질 저하', UNAVAILABLE: '사용 불가', UNKNOWN: '확인 불가' };
  const validActivityScore = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  const validLowMinutes = value => Number.isInteger(value) && value >= 1 && value <= 1440;
  const activityNumber = value => Number(value.toFixed(2)) === value ? value.toFixed(2) : String(value);
  const validActivityVersion = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
  const validScheduleTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const sensitivityNumber = threshold => String(Number((threshold * 10).toPrecision(12)));
  // Keep an existing precise threshold until the user moves the sensitivity control.
  let draftActivityThreshold = 0.2;
  function lowActivityScheduled(settings, at = Date.now()) {
    if (!settings.lowActivityMode || settings.lowActivityMode === 'ALL_DAY') return true;
    if (settings.lowActivityMode !== 'TIME_RANGE' || !validScheduleTime(settings.lowActivityStart) || !validScheduleTime(settings.lowActivityEnd)) return false;
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const korea = new Date(at + 9 * 3600000);
    const current = korea.getUTCHours() * 60 + korea.getUTCMinutes();
    const start = minutes(settings.lowActivityStart), end = minutes(settings.lowActivityEnd);
    return start < end ? current >= start && current < end : start > end && (current >= start || current < end);
  }
  let filter = '';
  let stateFilter = '';
  let period = { from: '', to: '' };
  let activePage = null;
  let nextCursor = null;
  let listGeneration = 0;
  let listedEvents = [];
  let detailGeneration = 0;
  let selectedEvent = null;
  let settingsLoaded = false;
  let settingsLoading = false;
  let settingsSaving = false;
  let actionPending = false;
  let refreshing = false;
  let feedbackTimer = null;
  let latestStatus = null;
  let savedSettings = null;
  let settingsDirty = false;
  let notificationPending = false;
  const notificationPreferenceKey = 'onguard.notifications.enabled';
  const notificationTag = 'onguard-display-test';
  let notificationsEnabled = false;
  let notificationStorageAvailable = false;
  let notificationGeneration = 0;
  let displayedNotification = null;

  function readNotificationPreference() {
    try {
      notificationsEnabled = localStorage.getItem(notificationPreferenceKey) !== 'false';
      notificationStorageAvailable = true;
    } catch {
      notificationsEnabled = false;
      notificationStorageAvailable = false;
    }
  }
  readNotificationPreference();

  const time = (value) => {
    if (!value) return '기록 없음';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '기록 없음';
    const datePart = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date);
    const timePart = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
    return `${datePart} ${timePart}`;
  };
  const text = (id, value) => { $(id).textContent = value; };
  function node(tag, value, className) {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = value;
    if (className) element.className = className;
    return element;
  }
  function message(value, failed = false) {
    const banner = $('connection-message');
    clearTimeout(feedbackTimer);
    if (!value) { banner.hidden = true; return; }
    text('connection-message', value);
    banner.hidden = false;
    banner.classList.toggle('error', failed);
    if (!failed) feedbackTimer = setTimeout(() => { banner.hidden = true; }, 3000);
  }
  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`/api${path}`, {
        ...options, signal: controller.signal, cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...options.headers },
      });
      const isJson = response.headers.get('content-type')?.includes('application/json');
      if (!isJson) throw new Error('연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || `요청 실패 (${response.status})`);
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('응답이 늦어지고 있어요. 다시 시도해 주세요.');
      if (error instanceof TypeError) throw new Error('연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function eventCard(event, compact = false) {
    const card = node('a', undefined, 'event');
    card.href = `?eventId=${encodeURIComponent(event.eventId)}#detail`;
    card.dataset.eventId = event.eventId;
    const heading = node('div', undefined, 'section-head');
    const title = node('h3', undefined, 'with-icon');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${typeIcons[event.type] || 'i-list'}`);
    icon.append(use);
    title.append(icon, node('span', types[event.type]?.[0] || event.type));
    heading.append(title, node('span', states[event.state] || event.state, `badge ${event.state === 'OPEN' ? 'alert' : event.state === 'RESOLVED' ? 'success' : ''}`));
    card.append(heading, node('p', `${time(event.occurredAt)} 발생`, 'small muted'));
    if (!compact) {
      const footer = node('div', undefined, 'event-footer');
      const summary = node('span', undefined, 'event-handling');
      if (event.state === 'RESOLVED') {
        summary.append(node('span', event.resolvedAt ? `${time(event.resolvedAt)} 해소 기록` : '해소 시각 기록 없음'));
        if (event.resolutionReason) summary.append(node('span', event.resolutionReason, 'event-reason'));
      } else summary.textContent = event.acknowledgedAt ? `${time(event.acknowledgedAt)} 보호자 확인` : '보호자 확인 기록 없음';
      const chevron = node('span', '›', 'event-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      footer.append(summary, chevron);
      card.append(footer);
    }
    card.setAttribute('aria-label', `${types[event.type]?.[0] || event.type} · ${states[event.state] || event.state} · ${time(event.occurredAt)} 발생 · 상세 보기`);
    return card;
  }

  function renderEventGroups() {
    const groups = new Map();
    const dateLabel = value => {
      const date = new Date(value);
      return value && Number.isFinite(date.getTime()) ? date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '날짜 확인 필요';
    };
    const today = dateLabel(new Date());
    for (const event of listedEvents) {
      const label = dateLabel(event.occurredAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(event);
    }
    $('events-list').replaceChildren(...[...groups].map(([label, events]) => {
      const section = node('section', undefined, 'event-group');
      const heading = node('h2', `${label === today ? '오늘 · ' : ''}${label}`, 'group-title');
      section.append(heading, ...events.map(event => eventCard(event)));
      return section;
    }));
    if (!listedEvents.length) $('events-list').append(node('p', '해당하는 사건이 없습니다.', 'muted'));
  }

  async function loadEvents(append = false) {
    const generation = ++listGeneration;
    const params = new URLSearchParams({ limit: '20' });
    if (filter) params.set('type', filter);
    if (stateFilter) params.set('state', stateFilter);
    if (period.from) params.set('from', period.from);
    if (period.to) params.set('to', period.to);
    if (append && nextCursor) params.set('cursor', nextCursor);
    $('load-more').disabled = true;
    $('events-refresh').disabled = true;
    try {
      const result = await api(`/events?${params}`);
      if (generation !== listGeneration) return;
      listedEvents = append ? [...new Map([...listedEvents, ...result.items].map(event => [event.eventId, event])).values()] : result.items;
      renderEventGroups();
      nextCursor = result.nextCursor;
      $('load-more').hidden = !nextCursor;
    } catch (error) {
      if (generation !== listGeneration) return;
      if (!append) $('events-list').replaceChildren(node('p', `사건 조회 실패: ${error.message}`, 'alert-title'));
      message(error.message, true);
    } finally { if (generation === listGeneration) { $('load-more').disabled = false; $('events-refresh').disabled = false; } }
  }

  function actualStatus(result) {
    if (result.isDemo === false) return result;
    return {
      gateway: { connected: false, receivedAt: null, ageSeconds: null },
      sensor: { available: false, qualityStatus: 'UNKNOWN', measuredAt: null, ageSeconds: null, fresh: false },
      activity: null,
      fetchedAt: result.fetchedAt,
      settings: result.settings ? { ...result.settings, appliedVersion: null } : undefined,
      isDemo: false,
    };
  }

  function renderActivity() {
    const status = latestStatus;
    const raw = status?.activity;
    const measured = status?.sensor.measuredAt ? Date.parse(status.sensor.measuredAt) : NaN;
    const started = raw?.windowStartedAt ? Date.parse(raw.windowStartedAt) : NaN;
    const age = Date.now() - measured;
    const valid = status?.isDemo === false && status.gateway.connected && status.sensor.available === true &&
      status.sensor.fresh === true && status.sensor.qualityStatus === 'AVAILABLE' &&
      raw && validActivityScore(raw.score) && validActivityVersion(raw.modelVersion) && validActivityVersion(raw.calibrationVersion) && Number.isFinite(started) &&
      measured > started && measured - started <= 15000 && age >= -5000 && age <= 15000;
    $('activity-meter').hidden = !valid;
    text('activity-score', valid ? activityNumber(raw.score) : '—');
    text('activity-measured-at', valid ? time(status.sensor.measuredAt) : '기록 없음');
    if (!valid) {
      text('activity-state', '확인 불가');
      text('activity-help', '현재 활동 지표를 확인할 수 없어요.');
      $('activity-meter').removeAttribute('aria-valuetext');
      return;
    }
    $('activity-meter').value = raw.score;
    $('activity-meter').setAttribute('aria-valuetext', activityNumber(raw.score));
    const applied = savedSettings && status.settings?.appliedVersion === savedSettings.version &&
      validActivityScore(savedSettings.lowActivityThreshold);
    if (applied && savedSettings.lowActivityEnabled === true && !lowActivityScheduled(savedSettings)) {
      text('activity-state', '측정됨');
      text('activity-help', '지정한 저활동 감지 시간대 밖이에요.');
      return;
    }
    text('activity-state', !applied ? '측정됨' : raw.score <= savedSettings.lowActivityThreshold ? '낮은 활동' : '활동 변화');
    text('activity-help', applied ? '지표가 낮을수록 움직임 변화가 작아요.' : '감지 기준의 기기 적용을 확인하고 있어요.');
  }

  async function loadStatus() {
    try {
      const result = actualStatus(await api('/status'));
      latestStatus = result;
      const connected = result.gateway.connected;
      const observable = connected && result.sensor.available && result.sensor.fresh === true && result.sensor.qualityStatus === 'AVAILABLE';
      text('status-badge', !connected ? result.gateway.receivedAt ? '연결 끊김' : '연결 대기' : observable ? '정상' : '감지 확인 필요');
      $('status-badge').classList.toggle('success', observable);
      $('status-badge').classList.toggle('alert', !observable);
      text('gateway-state', connected ? '기기 연결됨' : result.gateway.receivedAt ? '기기 연결 끊김' : '기기 연결 대기');
      text('gateway-id', connected ? '신호를 받고 있어요.' : result.gateway.receivedAt ? '마지막 신호가 오래됐어요.' : '아직 신호를 받지 못했어요.');
      text('sensor-state', !connected ? '감지 상태 확인 불가' : observable ? '측정 중' : result.sensor.available && !result.sensor.fresh ? '측정 신호가 오래됐어요.' : '감지 상태 확인 필요');
      text('sensor-quality', connected ? `감지 상태: ${qualities[result.sensor.qualityStatus] || '확인 불가'}` : '연결을 확인해 주세요.');
      text('measured-at', time(result.sensor.measuredAt));
      text('received-at', time(result.gateway.receivedAt));
      const age = result.sensor.measuredAt && Number.isFinite(result.sensor.ageSeconds) && result.sensor.ageSeconds >= 0
        ? `마지막 측정 ${result.sensor.ageSeconds}초 전` : '측정 기록 없음';
      text('observation-age', `${age}${result.fetchedAt ? ` · 조회 ${time(result.fetchedAt)}` : ''}`);
      if (result.settings) renderSettings(result.settings, !settingsDirty && !settingsSaving);
      renderSettingsApplication();
    } catch (error) {
      latestStatus = null;
      text('status-badge', '조회 실패');
      $('status-badge').classList.remove('success');
      $('status-badge').classList.add('alert');
      text('sensor-state', '감지 상태 확인 불가');
      text('sensor-quality', '최신 상태를 조회하지 못했습니다.');
      text('gateway-state', '연결 상태 확인 불가');
      text('gateway-id', '연결을 확인해 주세요.');
      text('observation-age', '최신 측정 상태를 조회하지 못했어요.');
      renderSettingsApplication();
      throw error;
    }
  }

  async function loadHomeEvents() {
    try {
      const result = await api('/events?state=OPEN&limit=5');
      $('home-event-summary').classList.toggle('warning', result.items.length > 0);
      $('home-event-summary').classList.toggle('white', result.items.length === 0);
      $('home-events').replaceChildren(...(result.items.length ? result.items.map(event => eventCard(event, true)) : [node('p', '미확인 사건이 없어요.', 'small muted')]));
    } catch (error) {
      $('home-event-summary').classList.add('warning');
      $('home-event-summary').classList.remove('white');
      $('home-events').replaceChildren(node('p', `사건 조회 실패: ${error.message}`, 'small'));
      throw error;
    }
  }

  function detailButtons() {
    $('ack-button').disabled = actionPending || !selectedEvent || selectedEvent.state !== 'OPEN';
    const resolved = selectedEvent?.state === 'RESOLVED';
    $('ack-button').textContent = !selectedEvent || selectedEvent.state === 'OPEN' ? '알림 확인' : '확인 기록됨';
    $('ack-help').hidden = Boolean(resolved);
    $('resolve-form').hidden = Boolean(resolved);
    $('resolve-help').hidden = Boolean(resolved);
    $('observed').disabled = actionPending || !selectedEvent || resolved;
    $('reason').disabled = actionPending || !selectedEvent || resolved;
    $('resolve-button').disabled = actionPending || !selectedEvent || resolved || !$('observed').checked || $('reason').value.trim().length < 3;
  }
  function renderDetail(event) {
    selectedEvent = event;
    $('detail-content').hidden = false;
    text('detail-message', '');
    text('detail-id', time(event.occurredAt));
    text('detail-type', types[event.type]?.[0] || event.type);
    $('detail-icon').querySelector('use').setAttribute('href', `#${typeIcons[event.type] || 'i-list'}`);
    text('detail-description', types[event.type]?.[1] || '사건을 확인하세요.');
    $('detail-low-activity').hidden = event.type !== 'LOW_ACTIVITY';
    if (event.type === 'LOW_ACTIVITY') {
      const details = event.details || {};
      text('detail-low-since', time(details.lowSince));
      const seconds = typeof details.durationSeconds === 'number' && Number.isFinite(details.durationSeconds) && details.durationSeconds >= 0
        ? Math.floor(details.durationSeconds) : null;
      text('detail-low-duration', seconds === null ? '기록 없음' : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`);
      text('detail-low-criteria', validLowMinutes(details.thresholdMinutes) && validActivityScore(details.activityThreshold)
        ? `${details.thresholdMinutes}분 · 민감도 ${sensitivityNumber(details.activityThreshold)}` : '기록 없음');
      text('detail-low-score', validActivityScore(details.activityScore) ? activityNumber(details.activityScore) : '기록 없음');
      text('detail-low-schedule', details.monitoringMode === 'ALL_DAY' ? '상시' :
        details.monitoringMode === 'TIME_RANGE' && validScheduleTime(details.monitoringStart) && validScheduleTime(details.monitoringEnd)
          ? `${details.monitoringStart}~${details.monitoringEnd} (한국 시간)` : '기록 없음');
    }
    text('detail-state', states[event.state] || event.state);
    $('detail-state').classList.toggle('alert', event.state === 'OPEN');
    $('detail-state').classList.toggle('success', event.state === 'RESOLVED');
    $('detail-type').classList.toggle('alert-title', event.state === 'OPEN');
    for (const [className, state] of [['warning', 'OPEN'], ['blue', 'ACKNOWLEDGED'], ['success', 'RESOLVED']]) {
      $('detail-summary').classList.toggle(className, event.state === state);
    }
    $('detail-summary').classList.toggle('white', !['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(event.state));
    for (const [id, key] of [['occurred', 'occurredAt'], ['detected', 'detectedAt'], ['received', 'receivedAt'], ['acknowledged', 'acknowledgedAt'], ['resolved', 'resolvedAt']]) text(`detail-${id}`, time(event[key]));
    $('detail-actions').replaceChildren(...event.actions.map((action) => {
      const item = node('li');
      item.append(node('time', time(action.createdAt)), node('strong', action.type === 'CREATED' ? '서버에 사건 저장' : action.type === 'ACKNOWLEDGED' ? '보호자 알림 확인' : action.type === 'RESOLVED' ? '상황 해소 기록' : action.type));
      if (action.detail?.reason) item.append(node('p', action.detail.reason, 'small muted'));
      return item;
    }));
    text('resolution-record', event.resolutionReason ? `해소 사유: ${event.resolutionReason}` : '');
    detailButtons();
  }
  async function loadDetail() {
    const generation = ++detailGeneration;
    const id = new URLSearchParams(location.search).get('eventId');
    if (selectedEvent?.eventId !== id) {
      selectedEvent = null;
      $('observed').checked = false;
      $('reason').value = '';
    }
    $('detail-content').hidden = true;
    detailButtons();
    if (!id) { text('detail-message', '사건을 선택해 주세요.'); return; }
    text('detail-message', '사건을 조회하는 중입니다.');
    try {
      const event = await api(`/events/${encodeURIComponent(id)}`);
      if (generation === detailGeneration) renderDetail(event);
    } catch (error) {
      if (generation === detailGeneration) {
        selectedEvent = null;
        detailButtons();
        text('detail-message', `사건 조회 실패: ${error.message}`);
      }
    }
  }

  async function mutateEvent(action, body) {
    if (!selectedEvent || actionPending) return;
    const id = selectedEvent.eventId;
    actionPending = true;
    detailButtons();
    try {
      await api(`/events/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(body || {}) });
      message(action === 'ack' ? '알림 확인을 기록했습니다.' : '상황 해소 사유를 기록했습니다.');
      if (new URLSearchParams(location.search).get('eventId') === id) await loadDetail();
      await Promise.all([loadHomeEvents(), loadEvents()]);
    } catch (error) { message(error.message, true); }
    finally { actionPending = false; detailButtons(); }
  }

  function settingsControls(enabled) {
    for (const id of ['low-activity-enabled', 'fall-alert-enabled', 'sensor-fault-alert-enabled', 'gateway-fault-alert-enabled', 'settings-save']) $(id).disabled = !enabled;
    updateLowActivityControls(enabled);
    updateSettingsNotice();
  }
  function settingsValues(settings) {
    const source = settings || {
      lowActivityEnabled: $('low-activity-enabled').checked,
      lowActivityMinutes: $('low-activity-minutes').value,
      lowActivityThreshold: draftActivityThreshold,
      lowActivityMode: $('low-activity-mode').value,
      lowActivityStart: $('low-activity-start').value,
      lowActivityEnd: $('low-activity-end').value,
      fallAlertEnabled: $('fall-alert-enabled').checked,
      sensorFaultAlertEnabled: $('sensor-fault-alert-enabled').checked,
      gatewayFaultAlertEnabled: $('gateway-fault-alert-enabled').checked,
    };
    return {
      lowActivityEnabled: source.lowActivityEnabled === true,
      lowActivityMinutes: source.lowActivityMinutes === '' ? '' : Number(source.lowActivityMinutes ?? 30),
      lowActivityThreshold: source.lowActivityThreshold === '' ? '' : Number(source.lowActivityThreshold ?? 0.2),
      lowActivityMode: source.lowActivityMode ?? 'ALL_DAY',
      lowActivityStart: source.lowActivityStart ?? '22:00',
      lowActivityEnd: source.lowActivityEnd ?? '07:00',
      fallAlertEnabled: source.fallAlertEnabled !== false,
      sensorFaultAlertEnabled: source.sensorFaultAlertEnabled !== false,
      gatewayFaultAlertEnabled: source.gatewayFaultAlertEnabled !== false,
    };
  }
  function updateSettingsNotice() {
    $('settings-unsaved').hidden = !settingsDirty && !settingsSaving;
    text('settings-unsaved', settingsSaving ? '변경 내용을 저장하고 있어요.' : '저장하지 않은 변경사항이 있어요.');
    text('settings-save', settingsSaving ? '저장 중…' : '감지 설정 저장');
    $('settings-form').setAttribute('aria-busy', String(settingsSaving));
  }
  function settingsChanged() {
    settingsDirty = !savedSettings || JSON.stringify(settingsValues()) !== JSON.stringify(settingsValues(savedSettings));
    $('settings-message').hidden = true;
    updateLowActivityControls(settingsLoaded && !settingsSaving);
    updateSettingsNotice();
  }
  function updateLowActivityControls(enabled) {
    const active = enabled && $('low-activity-enabled').checked;
    for (const id of ['low-activity-minutes', 'low-activity-sensitivity', 'low-activity-mode']) {
      $(id).disabled = !active;
      $(id).required = id === 'low-activity-minutes' && active;
    }
    const timed = $('low-activity-mode').value === 'TIME_RANGE';
    $('low-activity-time-fields').hidden = !timed;
    $('low-activity-schedule-help').hidden = !timed;
    for (const id of ['low-activity-start', 'low-activity-end']) {
      $(id).disabled = !active || !timed;
      $(id).required = active && timed;
    }
    const sensitivity = sensitivityNumber(draftActivityThreshold);
    text('low-activity-sensitivity-value', sensitivity);
    $('low-activity-sensitivity').setAttribute('aria-valuetext', `민감도 ${sensitivity}, 0에서 10 사이`);
  }
  function renderSettingsApplication() {
    const connected = latestStatus?.gateway.connected;
    const applied = connected && savedSettings && latestStatus.settings?.appliedVersion === savedSettings.version;
    text('settings-application', !savedSettings ? '확인 불가' : !connected ? '연결 필요' : applied ? '적용됨' : '적용 확인 중');
    $('settings-application').classList.toggle('success', Boolean(applied));
    text('settings-gateway-state', !latestStatus ? '확인 불가' : connected ? '연결됨' : latestStatus.gateway.receivedAt ? '연결 끊김' : '연결 대기');
    const observable = connected && latestStatus.sensor.available && latestStatus.sensor.fresh && latestStatus.sensor.qualityStatus === 'AVAILABLE';
    text('settings-sensor-state', observable ? '측정 중' : '확인 필요');
    if (savedSettings) {
      text('settings-updated', `마지막 저장 · ${time(savedSettings.updatedAt)}`);
      $('settings-alerts').replaceChildren(...[
        ['장시간 저활동 감지', 'lowActivityEnabled'], ['낙상 의심 감지', 'fallAlertEnabled'], ['센싱 장애 감지', 'sensorFaultAlertEnabled'], ['기기 통신 장애 감지', 'gatewayFaultAlertEnabled'],
      ].map(([label, key]) => {
        const off = key === 'lowActivityEnabled' ? savedSettings[key] !== true : savedSettings[key] === false;
        const chip = node('span', undefined, `detection-chip${off ? ' off' : ''}`);
        chip.append(node('span', `${label} `), node('strong', off ? '꺼짐' : '켜짐'));
        if (key === 'lowActivityEnabled' && !off && validLowMinutes(savedSettings.lowActivityMinutes) && validActivityScore(savedSettings.lowActivityThreshold)) {
          chip.append(node('span', `· ${savedSettings.lowActivityMinutes}분 · 민감도 ${sensitivityNumber(savedSettings.lowActivityThreshold)} · ${savedSettings.lowActivityMode === 'TIME_RANGE' ? `${savedSettings.lowActivityStart}~${savedSettings.lowActivityEnd} (한국 시간)` : '상시'}`, 'criteria'));
        }
        return chip;
      }));
    }
    renderActivity();
  }
  function renderSettings(result, setInput = true) {
    if (savedSettings && result.version < savedSettings.version) return;
    savedSettings = result;
    settingsLoaded = true;
    if (setInput) {
      $('low-activity-enabled').checked = result.lowActivityEnabled === true;
      $('low-activity-minutes').value = result.lowActivityMinutes ?? 30;
      draftActivityThreshold = result.lowActivityThreshold ?? 0.2;
      $('low-activity-sensitivity').value = sensitivityNumber(draftActivityThreshold);
      $('low-activity-mode').value = result.lowActivityMode ?? 'ALL_DAY';
      $('low-activity-start').value = result.lowActivityStart ?? '22:00';
      $('low-activity-end').value = result.lowActivityEnd ?? '07:00';
      $('fall-alert-enabled').checked = result.fallAlertEnabled !== false;
      $('sensor-fault-alert-enabled').checked = result.sensorFaultAlertEnabled !== false;
      $('gateway-fault-alert-enabled').checked = result.gatewayFaultAlertEnabled !== false;
      settingsDirty = false;
    }
    settingsControls(!settingsSaving);
    renderSettingsApplication();
  }
  async function loadSettings() {
    if (settingsLoading) return;
    settingsLoading = true;
    try { renderSettings(await api('/settings'), !settingsDirty && !settingsSaving); $('settings-message').hidden = true; }
    catch { settingsLoaded = false; settingsControls(false); text('settings-message', '설정을 불러오지 못했어요. 새로고침해 주세요.'); $('settings-message').hidden = false; }
    finally { settingsLoading = false; }
  }
  async function refresh() {
    if (refreshing || document.hidden) return;
    refreshing = true;
    $('refresh-button').disabled = true;
    try {
      const results = await Promise.allSettled([loadStatus(), loadHomeEvents()]);
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) message(failure.reason.message, true);
      else if ($('connection-message').classList.contains('error')) message('');
      if (!settingsLoaded) await loadSettings();
    } finally { refreshing = false; $('refresh-button').disabled = false; }
  }
  function route() {
    const requested = location.hash || '#home';
    const page = ['#home', '#events', '#detail', '#settings', '#notifications'].includes(requested) ? requested : '#home';
    for (const screen of document.querySelectorAll('.screen')) {
      const visible = `#${screen.id}` === page;
      screen.classList.toggle('active', visible);
      screen.hidden = !visible;
    }
    if (activePage !== null && activePage !== page) {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
    activePage = page;
    for (const link of document.querySelectorAll('.navigation a')) {
      if (link.hash === page || (page === '#detail' && link.hash === '#events')) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (page === '#detail') loadDetail();
    else { ++detailGeneration; }
    if (page === '#events') loadEvents();
    if (page === '#settings' && !settingsLoaded) loadSettings();
    updateNotificationState();
  }

  function notificationsAllowed() {
    return notificationStorageAvailable && notificationsEnabled && 'Notification' in window && Notification.permission === 'granted';
  }
  async function closeDisplayedNotifications(registration) {
    try {
      displayedNotification?.close?.();
      displayedNotification = null;
      registration ||= await navigator.serviceWorker?.getRegistration?.();
      const notifications = await registration?.getNotifications?.({ tag: notificationTag });
      for (const notification of notifications || []) notification.close();
    } catch { /* Turning off future displays remains effective if closing old ones fails. */ }
  }
  function updateNotificationState() {
    readNotificationPreference();
    const ua = navigator.userAgent || '';
    const device = /Android/i.test(ua) ? '안드로이드' : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ? 'iOS / iPadOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '이 기기';
    const browser = /EdgA?\//i.test(ua) ? 'Edge' : /SamsungBrowser\//i.test(ua) ? '삼성 인터넷' : /Firefox\/|FxiOS\//i.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : '이 브라우저';
    text('notification-device', `${device} · ${browser}`);
    const supported = 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    const enabled = supported && notificationStorageAvailable && notificationsEnabled;
    $('notification-enabled').checked = enabled;
    $('notification-enabled').disabled = !supported || !notificationStorageAvailable;
    text('notification-enabled-status', !supported ? '지원되지 않음' : !notificationStorageAvailable ? '저장 불가' : enabled ? '켜짐' : '꺼짐');
    $('notification-enabled-status').classList.toggle('success', enabled);
    text('notification-enabled-help', notificationStorageAvailable
      ? '끄면 이 브라우저에서 온가드 알림을 표시하지 않아요.'
      : '이 브라우저에서 설정을 저장할 수 없어요. 사이트 데이터 저장을 허용한 뒤 다시 열어 주세요.');
    text('notification-permission', !supported ? '지원되지 않음' : ({ granted: '허용됨', denied: '차단됨', default: '허용 필요' }[permission] || '확인 불가'));
    $('notification-permission').classList.toggle('success', permission === 'granted');
    $('enable-notifications').hidden = !supported || permission === 'granted';
    $('enable-notifications').disabled = !enabled || permission === 'denied';
    $('enable-notifications').textContent = permission === 'denied' ? '브라우저 설정에서 허용해 주세요' : '알림 허용';
    $('show-notification').disabled = !notificationsAllowed() || notificationPending;
    if (!enabled || permission !== 'granted') { $('confirm-notification').hidden = true; text('notification-test-status', !enabled ? '알림 꺼짐' : '확인 전'); }
    else if ($('notification-test-status').textContent === '알림 꺼짐') text('notification-test-status', '확인 전');
    text('notification-help', !supported
      ? '이 브라우저에서는 알림을 사용할 수 없습니다.'
      : !enabled ? '알림을 사용하려면 이 브라우저 알림을 켜 주세요.'
      : permission === 'denied'
        ? '브라우저 설정에서 이 사이트의 알림을 허용해 주세요.'
        : permission === 'granted' ? '권한이 허용되었어요. 아래에서 알림 표시를 확인해 주세요.' : '알림을 받으려면 권한을 허용해 주세요.');
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-event-id]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState(null, '', link.href);
    route();
  });
  for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
    filter = button.dataset.filter;
    nextCursor = null;
    $('load-more').hidden = true;
    for (const item of document.querySelectorAll('[data-filter]')) {
      item.classList.toggle('selected', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    }
    loadEvents();
  });
  $('load-more').addEventListener('click', () => loadEvents(true));
  $('event-period-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const start = $('event-start-date').value;
    const end = $('event-end-date').value;
    const startTime = $('event-start-time').value;
    const endTime = $('event-end-time').value;
    if ((startTime && !start) || (endTime && !end)) {
      text('event-period-error', '시각을 지정하려면 해당 시작일 또는 종료일도 선택해 주세요.');
      $('event-period-error').hidden = false;
      return;
    }
    const from = start ? new Date(`${start}T${startTime || '00:00'}:00`) : null;
    let to = end ? new Date(`${end}T${endTime || '00:00'}:00`) : null;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
      text('event-period-error', '조회할 날짜를 다시 확인해 주세요.');
      $('event-period-error').hidden = false;
      return;
    }
    if (to) {
      if (endTime) to = new Date(to.getTime() + 60000); // Include the selected end minute.
      else to.setDate(to.getDate() + 1);
    }
    if (from && to && from >= to) {
      text('event-period-error', '종료 날짜·시각은 시작 날짜·시각과 같거나 이후여야 해요.');
      $('event-period-error').hidden = false;
      return;
    }
    period = { from: from ? from.toISOString() : '', to: to ? to.toISOString() : '' };
    $('event-period-error').hidden = true;
    const startLabel = `${start}${startTime ? ` ${startTime}` : ''}`;
    const endLabel = `${end}${endTime ? ` ${endTime}` : ''}`;
    text('event-period-summary', start && end ? `${startLabel} ~ ${endLabel} 발생` : start ? `${startLabel} 이후 발생` : end ? `${endLabel}까지 발생` : '전체 기간');
    nextCursor = null;
    $('load-more').hidden = true;
    loadEvents();
  });
  $('event-period-reset').addEventListener('click', () => {
    $('event-start-date').value = '';
    $('event-end-date').value = '';
    $('event-start-time').value = '';
    $('event-end-time').value = '';
    period = { from: '', to: '' };
    text('event-period-summary', '전체 기간');
    $('event-period-error').hidden = true;
    nextCursor = null;
    $('load-more').hidden = true;
    loadEvents();
  });
  $('events-refresh').addEventListener('click', () => loadEvents());
  $('event-state-filter').addEventListener('change', () => {
    stateFilter = $('event-state-filter').value;
    text('event-state-summary', states[stateFilter] || '전체 상태');
    nextCursor = null;
    loadEvents();
  });
  $('refresh-button').addEventListener('click', refresh);
  $('notification-enabled').addEventListener('change', () => {
    const enabled = $('notification-enabled').checked;
    try { localStorage.setItem(notificationPreferenceKey, String(enabled)); }
    catch { updateNotificationState(); message('알림 설정을 저장하지 못했어요. 다시 시도해 주세요.', true); return; }
    ++notificationGeneration;
    if (!enabled) closeDisplayedNotifications();
    updateNotificationState();
    message(enabled ? '이 브라우저의 알림을 켰어요.' : '이 브라우저의 알림을 껐어요.');
  });
  window.addEventListener('storage', event => {
    if (event.key !== notificationPreferenceKey && event.key !== null) return;
    ++notificationGeneration;
    updateNotificationState();
    if (!notificationsEnabled) closeDisplayedNotifications();
  });
  $('enable-notifications').addEventListener('click', async () => {
    if (!notificationStorageAvailable || !notificationsEnabled || !('Notification' in window)) return;
    try {
      await Notification.requestPermission();
      updateNotificationState();
      if (Notification.permission === 'granted') message('알림을 허용했어요.');
    } catch { message('알림 권한을 변경하지 못했어요. 브라우저 설정을 확인해 주세요.', true); }
  });
  $('show-notification').addEventListener('click', async () => {
    if (notificationPending || !notificationsAllowed()) return updateNotificationState();
    const generation = notificationGeneration;
    notificationPending = true;
    $('confirm-notification').hidden = true;
    text('notification-test-status', '요청 중');
    updateNotificationState();
    try {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.register('/sw.js');
        let readyTimeout;
        let registration;
        try {
          registration = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => {
            readyTimeout = setTimeout(() => reject(new Error('알림 준비 시간 초과')), 8000);
          })]);
        } finally { clearTimeout(readyTimeout); }
        if (generation !== notificationGeneration || !notificationsAllowed()) return;
        await registration.showNotification('온가드(OnGuard)', { body: '이 기기에서 알림을 받을 수 있어요.', tag: notificationTag });
        if (generation !== notificationGeneration || !notificationsAllowed()) { await closeDisplayedNotifications(registration); return; }
      } else {
        displayedNotification = new Notification('온가드(OnGuard)', { body: '이 기기에서 알림을 받을 수 있어요.', tag: notificationTag });
      }
      text('notification-test-status', '확인 필요');
      $('confirm-notification').hidden = false;
      message('알림을 보냈어요. 기기에서 표시됐는지 확인해 주세요.');
    } catch {
      if (generation === notificationGeneration && notificationsAllowed()) {
        text('notification-test-status', '요청 실패'); message('알림을 표시하지 못했어요. 브라우저 설정을 확인해 주세요.', true);
      }
    }
    finally { notificationPending = false; updateNotificationState(); }
  });
  $('confirm-notification').addEventListener('click', () => {
    if ($('confirm-notification').hidden) return;
    text('notification-test-status', '표시 확인됨');
    $('confirm-notification').hidden = true;
  });
  $('ack-button').addEventListener('click', () => mutateEvent('ack'));
  $('observed').addEventListener('change', detailButtons);
  $('reason').addEventListener('input', detailButtons);
  $('resolve-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if ($('resolve-button').disabled) return;
    mutateEvent('resolve', { observed: $('observed').checked, reason: $('reason').value.trim() });
  });
  for (const id of ['low-activity-enabled', 'low-activity-minutes', 'low-activity-sensitivity', 'low-activity-mode', 'low-activity-start', 'low-activity-end', 'fall-alert-enabled', 'sensor-fault-alert-enabled', 'gateway-fault-alert-enabled']) {
    const changed = () => {
      if (id === 'low-activity-sensitivity') {
        const value = Math.round(Number($('low-activity-sensitivity').value));
        $('low-activity-sensitivity').value = String(value);
        draftActivityThreshold = value / 10;
      }
      settingsChanged();
    };
    $(id).addEventListener('input', changed);
    $(id).addEventListener('change', changed);
  }
  $('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (settingsSaving || !settingsLoaded) return;
    const values = settingsValues();
    if (values.lowActivityEnabled && (!validLowMinutes(values.lowActivityMinutes) || !validActivityScore(values.lowActivityThreshold))) {
      text('settings-message', '지속 시간은 1~1440분 정수, 민감도는 0~10으로 지정해 주세요.');
      $('settings-message').hidden = false;
      return;
    }
    // Turning detection off must work even while the disabled fields are empty.
    if (!values.lowActivityEnabled) {
      values.lowActivityMinutes = validLowMinutes(values.lowActivityMinutes) ? values.lowActivityMinutes : savedSettings?.lowActivityMinutes ?? 30;
      values.lowActivityThreshold = validActivityScore(values.lowActivityThreshold) ? values.lowActivityThreshold : savedSettings?.lowActivityThreshold ?? 0.2;
    }
    if (values.lowActivityEnabled && values.lowActivityMode === 'TIME_RANGE' &&
        (!validScheduleTime(values.lowActivityStart) || !validScheduleTime(values.lowActivityEnd) || values.lowActivityStart === values.lowActivityEnd)) {
      text('settings-message', '감지 시작·종료 시각을 다르게 지정해 주세요. 상시 감지는 상시를 선택하세요.');
      $('settings-message').hidden = false;
      return;
    }
    if (!values.lowActivityEnabled || values.lowActivityMode === 'ALL_DAY') {
      if (!validScheduleTime(values.lowActivityStart) || !validScheduleTime(values.lowActivityEnd) || values.lowActivityStart === values.lowActivityEnd) {
        values.lowActivityStart = savedSettings?.lowActivityStart ?? '22:00';
        values.lowActivityEnd = savedSettings?.lowActivityEnd ?? '07:00';
      }
    }
    settingsSaving = true;
    $('settings-message').hidden = true;
    settingsControls(false);
    try {
      renderSettings(await api('/settings', { method: 'PATCH', body: JSON.stringify(values) }));
      text('settings-message', '변경 내용을 저장했어요.');
      $('settings-message').hidden = false;
    } catch { settingsDirty = true; text('settings-message', '저장하지 못했어요. 다시 시도해 주세요.'); $('settings-message').hidden = false; }
    finally { settingsSaving = false; settingsControls(true); }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); route(); } });
  text('home-date', `돌봄 공간 · ${new Date().toLocaleDateString('ko-KR')}`);
  route();
  refresh();
  if ((location.hash || '#home') !== '#events') loadEvents();
  setInterval(refresh, 5000);
})();

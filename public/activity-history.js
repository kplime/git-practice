(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const maxRecords = 5000;
  const reasons = { NO_ACTIVITY: '활동값 없음', SENSING_UNAVAILABLE: '관측 불가', STALE_MEASUREMENT: '오래된 측정', REPEATED_MEASUREMENT: '반복 측정' };
  const format = value => new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
  let hours = 1;
  let custom = null;
  let result = null;
  let generation = 0;
  let controller = null;
  let pending = false;

  function presets() {
    for (const button of document.querySelectorAll('[data-history-hours]')) {
      const selected = !custom && Number(button.dataset.historyHours) === hours;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }
  function clearPlot() {
    $('history-marks').replaceChildren();
    $('history-record-list').replaceChildren();
    $('history-plot').hidden = true;
    $('history-records').hidden = true;
    $('history-more').hidden = true;
  }
  function render() {
    clearPlot();
    const { items, from, to, nextCursor } = result;
    const valid = items.filter(item => item.reason === null && typeof item.score === 'number' &&
      Number.isFinite(item.score) && item.score >= 0 && item.score <= 1 &&
      Date.parse(item.windowStartedAt) < Date.parse(item.sampledAt) &&
      Date.parse(item.sampledAt) - Date.parse(item.windowStartedAt) <= 15000);
    // An incomplete page only describes its loaded part of the selected period.
    const start = nextCursor && items.length ? Math.max(Date.parse(from), Math.min(...items.map(item =>
      Date.parse(item.reason === null ? item.windowStartedAt : item.sampledAt)))) : Date.parse(from);
    const end = Date.parse(to);
    const x = value => 24 + Math.max(0, Math.min(1, (Date.parse(value) - start) / (end - start))) * 288;
    const marks = valid.map(item => {
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      mark.setAttribute('x1', x(item.windowStartedAt)); mark.setAttribute('x2', x(item.sampledAt));
      mark.setAttribute('y1', 110 - item.score * 100); mark.setAttribute('y2', 110 - item.score * 100);
      mark.setAttribute('class', 'history-sample');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${format(item.sampledAt)} · ${item.score}`;
      mark.append(title);
      return mark;
    });
    $('history-marks').replaceChildren(...marks);
    $('history-plot').hidden = !valid.length;
    $('history-axis-start').textContent = format(start);
    $('history-axis-end').textContent = format(end);
    $('history-chart-description').textContent = `${format(start)}부터 ${format(end)}까지 유효한 측정 ${valid.length}개. 관측하지 못한 구간은 표시하지 않습니다.`;
    $('history-message').textContent = !items.length ? '해당 기간에 활동 기록이 없어요.' :
      `측정 ${valid.length}개 · 관측 불가 ${items.length - valid.length}개${nextCursor ? ' · 이전 기록이 더 있어요.' : ''}`;
    if (nextCursor && items.length >= maxRecords) $('history-message').textContent += ' 더 보려면 기간을 좁혀 주세요.';
    $('history-more').hidden = !nextCursor || items.length >= maxRecords;
    $('history-records').hidden = !items.length;
    $('history-record-list').replaceChildren(...items.slice(0, 20).map(item => {
      const row = document.createElement('li');
      const label = document.createElement('time'); label.dateTime = item.sampledAt; label.textContent = format(item.sampledAt);
      const value = document.createElement('strong');
      value.textContent = item.reason === null && typeof item.score === 'number' ? String(item.score) : reasons[item.reason] || '관측 불가';
      row.append(label, value); return row;
    }));
  }
  async function load(append = false) {
    if (append && (!result?.nextCursor || pending)) return;
    const request = ++generation;
    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), 8000);
    pending = true;
    $('history-refresh').disabled = true;
    $('history-more').disabled = true;
    let bounds;
    if (append) bounds = { from: result.from, to: result.to };
    else if (custom) bounds = custom;
    else { const end = Date.now(); bounds = { from: new Date(end - hours * 3600000).toISOString(), to: new Date(end).toISOString() }; }
    const params = new URLSearchParams({ ...bounds, limit: '500' });
    if (append) { params.set('cursor', result.nextCursor); params.set('gatewayId', result.gatewayId); }
    if (!append) {
      result = null; clearPlot();
      $('history-range').textContent = `${format(bounds.from)} ~ ${format(bounds.to)}`;
      $('history-message').textContent = '활동 기록을 불러오고 있어요.';
    }
    try {
      const response = await fetch(`/api/activity/history?${params}`, { signal: activeController.signal });
      if (!response.ok) throw new Error('history request failed');
      const data = await response.json();
      if (request !== generation) return;
      if (!Array.isArray(data.items) || !Number.isFinite(Date.parse(data.from)) || !Number.isFinite(Date.parse(data.to))) throw new Error('invalid history');
      if (append) {
        if (data.gatewayId !== result.gatewayId || data.from !== result.from || data.to !== result.to) throw new Error('changed history scope');
        const seen = new Set(result.items.map(item => `${item.generation}:${item.sequence}`));
        data.items = [...result.items, ...data.items.filter(item => !seen.has(`${item.generation}:${item.sequence}`))].slice(0, maxRecords);
      }
      result = data; render();
    } catch {
      if (request !== generation) return;
      if (!append) clearPlot();
      $('history-message').textContent = append ? '이전 기록을 불러오지 못했어요. 다시 시도해 주세요.' : '활동 기록을 불러오지 못했어요. 새로고침해 주세요.';
    } finally {
      clearTimeout(timeout);
      if (request === generation) { pending = false; $('history-refresh').disabled = false; $('history-more').disabled = false; }
    }
  }
  for (const button of document.querySelectorAll('[data-history-hours]')) button.addEventListener('click', () => {
    hours = Number(button.dataset.historyHours); custom = null; presets();
    $('history-period-error').hidden = true; load();
  });
  $('history-period-form').addEventListener('submit', event => {
    event.preventDefault();
    const startDate = $('history-start-date').value, endDate = $('history-end-date').value;
    const startTime = $('history-start-time').value, endTime = $('history-end-time').value;
    const from = new Date(`${startDate}T${startTime || '00:00'}:00`);
    let to = new Date(`${endDate}T${endTime || '00:00'}:00`);
    if (endTime) to = new Date(to.getTime() + 60000);
    else to.setDate(to.getDate() + 1);
    let error = '';
    if (!startDate || !endDate || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) error = '시작일과 종료일을 선택해 주세요.';
    else if (from >= to) error = '종료 날짜·시각을 시작 이후로 정해 주세요.';
    else if (to - from > 7 * 86400000) error = '조회 기간은 최대 7일로 정해 주세요.';
    $('history-period-error').hidden = !error;
    $('history-period-error').textContent = error;
    if (error) return;
    custom = { from: from.toISOString(), to: to.toISOString() }; presets(); load();
  });
  $('history-refresh').addEventListener('click', () => load());
  $('history-more').addEventListener('click', () => load(true));
  load();
  setInterval(() => {
    if (!document.hidden && (!location.hash || location.hash === '#home') && !pending && !custom && (!result || result.items.length <= 500)) load();
  }, 30000);
})();

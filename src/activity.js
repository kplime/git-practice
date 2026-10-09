// Contract validation only. CSI feature extraction runs in the local collector.
const validScore = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const validMinutes = value => Number.isInteger(value) && value >= 1 && value <= 1440;
const validVersion = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
const validUtcTimestamp = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

function parseActivity(body) {
  if (body.activity === undefined || body.activity === null) return null;
  const value = body.activity;
  if (typeof value !== 'object' || Array.isArray(value) || typeof body.isDemo !== 'boolean' ||
      !validScore(value.score) || !validVersion(value.modelVersion) || !validVersion(value.calibrationVersion) ||
      !validUtcTimestamp(value.windowStartedAt) || !validUtcTimestamp(body.measuredAt)) return false;
  const duration = Date.parse(body.measuredAt) - Date.parse(value.windowStartedAt);
  if (duration <= 0 || duration > 15000) return false;
  return { score: value.score, windowStartedAt: value.windowStartedAt,
    modelVersion: value.modelVersion, calibrationVersion: value.calibrationVersion };
}

function validLowActivityEvent(body) {
  const details = body.details;
  if (!details || typeof details !== 'object' || Array.isArray(details) || typeof body.isDemo !== 'boolean' ||
      body.qualityStatus !== 'AVAILABLE' || !validVersion(body.modelVersion) || body.score != null ||
      !validUtcTimestamp(body.occurredAt) || !validUtcTimestamp(body.detectedAt) ||
      !validUtcTimestamp(details.lowSince) || !validMinutes(details.thresholdMinutes) ||
      !validScore(details.activityThreshold) || !validScore(details.activityScore) ||
      details.activityScore > details.activityThreshold || !validVersion(details.calibrationVersion) ||
      !Number.isInteger(details.settingsVersion) || details.settingsVersion < 1 ||
      typeof details.durationSeconds !== 'number' || !Number.isFinite(details.durationSeconds)) return false;
  const duration = (Date.parse(body.detectedAt) - Date.parse(details.lowSince)) / 1000;
  return duration >= details.thresholdMinutes * 60 && Math.abs(duration - details.durationSeconds) < 0.001 &&
    Date.parse(body.occurredAt) === Date.parse(details.lowSince) + details.thresholdMinutes * 60000;
}

module.exports = { parseActivity, validLowActivityEvent, validScore, validMinutes, validUtcTimestamp };

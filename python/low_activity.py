"""Continuous-window low activity detection. No hardware or network side effects."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
from uuid import uuid4

try:
    from .activity import ActivityWindow, FRESHNESS, FUTURE_TOLERANCE, iso_timestamp, unit_score
    from .low_activity_schedule import schedule_config, schedule_interval
except ImportError:
    from activity import ActivityWindow, FRESHNESS, FUTURE_TOLERANCE, iso_timestamp, unit_score
    from low_activity_schedule import schedule_config, schedule_interval


@dataclass(frozen=True)
class DetectionResult:
    state: str = "UNKNOWN"
    score: float | None = None
    low_since: str | None = None
    duration_seconds: float = 0
    event: dict | None = None
    ignored: bool = False


class LowActivityDetector:
    """Use one instance per gateway. Restarting loses unproven elapsed time.

    Only adjacent, non-overlapping windows count. Discontinuity resets the
    episode. An uninterrupted episode emits one payload, to be durably queued
    by the caller before transport. ACK/resolution does not rearm the detector.
    """

    def __init__(self, gateway_id):
        if not isinstance(gateway_id, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,120}", gateway_id):
            raise ValueError("Invalid gateway ID")
        self.gateway_id = gateway_id
        self._generation = None
        self._sequence = None
        self._measurement_watermark = None
        self._source = None
        self._config = None
        self._schedule = ("ALL_DAY", 1320, 420)
        self._enabled = False
        self._clear_episode()

    def _clear_episode(self):
        self._low_since = None
        self._last_end = None
        self._emitted = False
        self._result = DetectionResult()

    @staticmethod
    def _now(value):
        value = value or datetime.now(timezone.utc)
        if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("now must be a timezone-aware datetime")
        return value

    def check_stale(self, now=None):
        """Call on collector idle ticks as well as update; never emit on a tick."""
        now = self._now(now)
        if self._enabled and self._schedule[0] == "TIME_RANGE" and schedule_interval(now, self._schedule) is None:
            self._clear_episode()
            self._result = DetectionResult("PAUSED")
            return self._result
        if self._last_end is not None and not -FUTURE_TOLERANCE <= now - self._last_end <= FRESHNESS:
            self._clear_episode()
        return self._result

    def update(self, status, settings, now=None):
        now = self._now(now)
        self.check_stale(now)
        enabled = settings.get("lowActivityEnabled", False)
        minutes = settings.get("lowActivityMinutes", 30)
        threshold = settings.get("lowActivityThreshold", 0.2)
        version = settings.get("version")
        if (type(enabled) is not bool or type(minutes) is not int or not 1 <= minutes <= 1440
                or not unit_score(threshold) or (enabled and (type(version) is not int or version < 1))):
            self._clear_episode()
            raise ValueError("Invalid low activity settings")
        try:
            schedule = schedule_config(settings)
        except ValueError:
            self._clear_episode()
            raise
        config = (enabled, minutes, threshold, schedule)
        if config != self._config:
            self._clear_episode()
            self._config = config
        self._schedule, self._enabled = schedule, enabled

        if not isinstance(status, dict) or status.get("gatewayId") != self.gateway_id:
            self._clear_episode()
            raise ValueError("Use one detector per gateway")
        generation, sequence = status.get("generation"), status.get("sequence")
        if (type(generation) is not int or not 1 <= generation <= 2147483647
                or type(sequence) is not int or not 0 <= sequence <= 2147483647):
            self._clear_episode()
            return self._result
        if self._generation is not None and (generation < self._generation
                or (generation == self._generation and sequence <= self._sequence)):
            return DetectionResult(self._result.state, self._result.score,
                                   self._result.low_since, self._result.duration_seconds, ignored=True)
        if generation != self._generation:
            self._clear_episode()
            self._measurement_watermark = None
            self._source = None
        elif sequence != self._sequence + 1:
            self._clear_episode()
        self._generation, self._sequence = generation, sequence
        try:
            window = ActivityWindow.from_status(status, now)
        except (ValueError, TypeError):
            self._clear_episode()
            return self._result
        if self._measurement_watermark is not None and window.ended_at <= self._measurement_watermark:
            self._clear_episode()
            return self._result
        self._measurement_watermark = window.ended_at
        if enabled and schedule[0] == "TIME_RANGE":
            bounds = schedule_interval(window.ended_at, schedule)
            if bounds is None or window.started_at < bounds[0] or not bounds[0] <= now < bounds[1]:
                self._clear_episode()
                self._result = DetectionResult("PAUSED", window.score)
                return self._result
        source = (status["isDemo"], window.model_version, window.calibration_version)
        if source != self._source or (self._last_end is not None and window.started_at != self._last_end):
            self._clear_episode()
        self._source, self._last_end = source, window.ended_at
        state = "LOW" if window.score <= threshold else "ACTIVE"
        if state == "ACTIVE" or not enabled:
            self._low_since = None
            self._emitted = False
            self._result = DetectionResult(state, window.score)
            return self._result
        if self._low_since is None:
            self._low_since = window.started_at
        duration = (window.ended_at - self._low_since).total_seconds()
        event = None
        if duration >= minutes * 60 and not self._emitted:
            event = {
                "eventId": str(uuid4()), "gatewayId": self.gateway_id, "type": "LOW_ACTIVITY",
                "occurredAt": iso_timestamp(self._low_since + timedelta(minutes=minutes)),
                "detectedAt": iso_timestamp(window.ended_at), "score": None,
                "qualityStatus": "AVAILABLE", "modelVersion": window.model_version,
                "isDemo": status["isDemo"],
                "details": {"lowSince": iso_timestamp(self._low_since), "durationSeconds": duration,
                            "thresholdMinutes": minutes, "activityThreshold": threshold,
                            "activityScore": window.score, "settingsVersion": version,
                            "calibrationVersion": window.calibration_version,
                            "monitoringMode": schedule[0], "timeZone": "Asia/Seoul",
                            "monitoringStart": f"{schedule[1] // 60:02}:{schedule[1] % 60:02}",
                            "monitoringEnd": f"{schedule[2] // 60:02}:{schedule[2] % 60:02}"},
            }
            self._emitted = True
        # Store event-free state: idle checks and duplicate packets cannot re-emit.
        self._result = DetectionResult(state, window.score, iso_timestamp(self._low_since), duration)
        return DetectionResult(state, window.score, self._result.low_since, duration, event)

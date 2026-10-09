"""Validated activity windows from a collector, not a CSI feature extractor."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import math
import re

FRESHNESS = timedelta(seconds=15)
FUTURE_TOLERANCE = timedelta(seconds=5)
UTC_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z")


def utc_timestamp(value):
    if not isinstance(value, str) or not UTC_TIMESTAMP.fullmatch(value):
        raise ValueError("Use a UTC ISO timestamp with at most millisecond precision")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso_timestamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def unit_score(value):
    return type(value) in (int, float) and 0 <= value <= 1 and math.isfinite(value)


@dataclass(frozen=True)
class ActivityWindow:
    started_at: datetime
    ended_at: datetime
    score: float
    model_version: str
    calibration_version: str

    @classmethod
    def from_status(cls, status, now):
        """Reject missing/invalid/old measurements rather than assuming zero."""
        raw = status.get("activity")
        if not isinstance(raw, dict) or type(status.get("isDemo")) is not bool:
            raise ValueError("Activity requires an explicit source and an object")
        if status.get("sensorAvailable") is not True or status.get("qualityStatus") != "AVAILABLE":
            raise ValueError("Activity requires usable sensing")
        start = utc_timestamp(raw.get("windowStartedAt"))
        end = utc_timestamp(status.get("measuredAt"))
        if not timedelta(0) < end - start <= FRESHNESS:
            raise ValueError("Activity windows must be positive and at most 15 seconds")
        if not -FUTURE_TOLERANCE <= now - end <= FRESHNESS:
            raise ValueError("Measurement is stale or too far in the future")
        if not unit_score(raw.get("score")):
            raise ValueError("Activity score must be a finite number from 0 to 1")
        for key in ("modelVersion", "calibrationVersion"):
            value = raw.get(key)
            if not isinstance(value, str) or not value.strip() or len(value) > 100:
                raise ValueError(f"Invalid {key}")
        return cls(start, end, raw["score"], raw["modelVersion"], raw["calibrationVersion"])

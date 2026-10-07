"""Control which new detection episodes the runtime may create.

Raw measurements, heartbeat status and existing event retries stay independent.
This policy is not a CSI detector.
"""
from datetime import datetime, timedelta, timezone

KOREA_TIME = timezone(timedelta(hours=9), name="Asia/Seoul")


def bed_monitoring_active(settings, at=None):
    """Return whether non-return detection is enabled at an aware instant.

    Start is inclusive; end is exclusive. A start after end crosses midnight.
    Old settings without schedule fields keep the original all-day behavior.
    """
    if not settings.get("bedMonitoringEnabled", True):
        return False
    mode = settings.get("bedMonitoringMode", "ALL_DAY")
    if mode == "ALL_DAY":
        return True
    if mode != "TIME_RANGE":
        raise ValueError("Unsupported bedMonitoringMode")
    if at is None:
        at = datetime.now(timezone.utc)
    if isinstance(at, str):
        at = datetime.fromisoformat(at.replace("Z", "+00:00"))
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("Use a timezone-aware instant")

    def minutes(value):
        if not isinstance(value, str) or len(value) != 5 or value[2] != ":":
            raise ValueError("Use HH:MM schedule times")
        hour, minute = map(int, value.split(":"))
        if not 0 <= hour < 24 or not 0 <= minute < 60:
            raise ValueError("Invalid schedule time")
        return hour * 60 + minute

    start = minutes(settings["bedMonitoringStart"])
    end = minutes(settings["bedMonitoringEnd"])
    if start == end:
        raise ValueError("Use ALL_DAY for a full day")
    local = at.astimezone(KOREA_TIME)
    current = local.hour * 60 + local.minute
    return start <= current < end if start < end else current >= start or current < end


def detection_enabled(event_type, settings, at=None):
    """Check before creating a new episode; only non-return uses a schedule.

    The legacy *AlertEnabled API field names remain compatible with saved data.
    Switching off an episode type does not switch off shared sensor collection.
    """
    if event_type in {"NON_RETURN_WARNING", "BED_EXIT"}:
        return bed_monitoring_active(settings, at)
    key = {
        "FALL_SUSPECTED": "fallAlertEnabled",
        "SENSOR_UNAVAILABLE": "sensorFaultAlertEnabled",
        "GATEWAY_OFFLINE": "gatewayFaultAlertEnabled",
    }.get(event_type)
    if key:
        return settings.get(key, True)
    raise ValueError("Unsupported detection type")


def alert_allowed(event_type, settings, at=None):
    """Compatibility entry point for callers using the earlier policy name."""
    return detection_enabled(event_type, settings, at)

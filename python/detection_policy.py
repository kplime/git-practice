"""Gate new episodes by saved options. This policy does not analyze CSI."""
try:
    from .low_activity_schedule import schedule_active
except ImportError:
    from low_activity_schedule import schedule_active


def detection_enabled(event_type, settings, at=None):
    """Check before creating an episode; keep shared sensing independent.

    at selects the low activity daily schedule. Retired bed/non-return types
    cannot create new episodes, even with previously saved settings.
    """
    if event_type in {"NON_RETURN_WARNING", "BED_EXIT"}:
        return False
    if event_type == "LOW_ACTIVITY":
        try:
            return settings.get("lowActivityEnabled", False) is True and schedule_active(settings, at)
        except (ValueError, TypeError):
            return False
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

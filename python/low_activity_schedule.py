"""Daily low-activity windows in the project's fixed Korea time zone."""
from datetime import datetime, timedelta, timezone
import re

try:
    from .activity import utc_timestamp
except ImportError:
    from activity import utc_timestamp

KOREA_TIME = timezone(timedelta(hours=9))


def schedule_config(settings):
    mode = settings.get("lowActivityMode", "ALL_DAY")
    times = [settings.get("lowActivityStart", "22:00"), settings.get("lowActivityEnd", "07:00")]
    if (mode not in ("ALL_DAY", "TIME_RANGE") or settings.get("timeZone", "Asia/Seoul") != "Asia/Seoul"
            or any(not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value) for value in times)
            or times[0] == times[1]):
        raise ValueError("Invalid low activity schedule")
    return (mode, *[int(value[:2]) * 60 + int(value[3:]) for value in times])


def schedule_interval(at, config):
    """Return containing [start, end), None when paused; ALL_DAY has no bounds."""
    if config[0] == "ALL_DAY":
        return None
    if isinstance(at, str):
        at = utc_timestamp(at)
    if at is None:
        at = datetime.now(timezone.utc)
    if not isinstance(at, datetime) or at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("Schedule requires an aware datetime")
    local = at.astimezone(KOREA_TIME)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    start, end = midnight + timedelta(minutes=config[1]), midnight + timedelta(minutes=config[2])
    if config[1] > config[2]:
        if local < end:
            start -= timedelta(days=1)
        else:
            end += timedelta(days=1)
    return (start, end) if start <= local < end else None


def schedule_active(settings, at=None):
    config = schedule_config(settings)
    return config[0] == "ALL_DAY" or schedule_interval(at, config) is not None

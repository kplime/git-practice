import unittest
from datetime import datetime, timedelta, timezone

from python.activity import ActivityWindow, iso_timestamp
from python.low_activity import LowActivityDetector
from python.detection_policy import detection_enabled

BASE = datetime(2026, 10, 8, 0, 0, tzinfo=timezone.utc)


class LowActivityTests(unittest.TestCase):
    def setUp(self):
        self.detector = LowActivityDetector("room-01")
        self.settings = {"version": 1, "lowActivityEnabled": True,
                         "lowActivityMinutes": 1, "lowActivityThreshold": 0.2}

    def status(self, index, **overrides):
        end = BASE + timedelta(seconds=index * 10)
        value = {"gatewayId": "room-01", "generation": 1, "sequence": index,
                 "sensorAvailable": True, "qualityStatus": "AVAILABLE", "isDemo": False,
                 "measuredAt": iso_timestamp(end),
                 "activity": {"score": 0.1, "windowStartedAt": iso_timestamp(end - timedelta(seconds=10)),
                              "modelVersion": "activity-v1", "calibrationVersion": "room-v1"}}
        value.update(overrides)
        return value

    def feed(self, index, **overrides):
        value = self.status(index, **overrides)
        return self.detector.update(value, self.settings, BASE + timedelta(seconds=index * 10))

    def test_exact_threshold_emits_once_and_idle_or_duplicate_does_not_repeat(self):
        for index in range(1, 6):
            result = self.feed(index)
            self.assertIsNone(result.event)
            self.assertEqual(result.duration_seconds, index * 10)
        result = self.feed(6)
        self.assertEqual(result.event["type"], "LOW_ACTIVITY")
        self.assertEqual(result.event["occurredAt"], iso_timestamp(BASE + timedelta(minutes=1)))
        self.assertEqual(result.event["details"]["lowSince"], iso_timestamp(BASE))
        self.assertIsNone(result.event["score"])
        self.assertFalse(result.event["isDemo"])
        self.assertTrue(self.feed(6).ignored)
        self.assertIsNone(self.feed(7).event)
        self.assertIsNone(self.detector.check_stale(BASE + timedelta(seconds=72)).event)

    def test_observed_active_window_rearms_a_new_episode(self):
        first = [self.feed(i) for i in range(1, 7)][-1].event
        activity = self.status(7)["activity"] | {"score": 0.21}
        self.assertEqual(self.feed(7, activity=activity).state, "ACTIVE")
        for index in range(8, 13):
            self.assertIsNone(self.feed(index).event)
        second = self.feed(13).event
        self.assertNotEqual(first["eventId"], second["eventId"])
        self.assertEqual(second["details"]["lowSince"], iso_timestamp(BASE + timedelta(seconds=70)))

    def test_missing_unavailable_degraded_or_invalid_activity_resets_elapsed_time(self):
        cases = [{"activity": None}, {"sensorAvailable": False}, {"qualityStatus": "DEGRADED"},
                 {"qualityStatus": "UNKNOWN"}, {"measuredAt": None}, {"isDemo": None}]
        for overrides in cases:
            with self.subTest(overrides=overrides):
                self.setUp()
                for index in range(1, 6):
                    self.feed(index)
                result = self.feed(6, **overrides)
                self.assertEqual(result.state, "UNKNOWN")
                self.assertEqual(result.duration_seconds, 0)
                self.assertIsNone(result.event)
                self.assertEqual(self.feed(7).duration_seconds, 10)

    def test_gap_overlap_and_missing_sequence_restart_without_backfilling(self):
        for adjustment, skip in [(1, False), (-1, False), (0, True)]:
            with self.subTest(adjustment=adjustment, skip=skip):
                self.setUp()
                for index in range(1, 6):
                    self.feed(index)
                raw = self.status(6)["activity"]
                raw["windowStartedAt"] = iso_timestamp(BASE + timedelta(seconds=50 + adjustment))
                result = self.feed(6, activity=raw, sequence=7 if skip else 6)
                self.assertEqual(result.duration_seconds, 10 - adjustment)
                self.assertIsNone(result.event)

    def test_duplicate_and_old_generation_never_add_time_or_replace_current_state(self):
        for index in range(1, 6):
            self.feed(index)
        result = self.detector.update(self.status(4), self.settings, BASE + timedelta(seconds=51))
        self.assertTrue(result.ignored)
        self.assertEqual(result.duration_seconds, 50)
        self.feed(6, generation=2, sequence=0)
        result = self.feed(7, generation=1, sequence=99)
        self.assertTrue(result.ignored)
        self.assertEqual(result.duration_seconds, 10)

    def test_repeated_measurement_with_new_sequence_cannot_accumulate(self):
        for index in range(1, 6):
            self.feed(index)
        old = self.status(5)
        old["sequence"] = 6
        result = self.detector.update(old, self.settings, BASE + timedelta(seconds=60))
        self.assertEqual(result.state, "UNKNOWN")
        self.assertIsNone(result.event)
        self.assertEqual(self.feed(7).duration_seconds, 10)

    def test_idle_expiry_returns_unknown_and_restarts(self):
        for index in range(1, 6):
            self.feed(index)
        self.assertEqual(self.detector.check_stale(BASE + timedelta(seconds=65)).state, "LOW")
        self.assertEqual(self.detector.check_stale(BASE + timedelta(seconds=66)).state, "UNKNOWN")
        self.assertEqual(self.feed(7).duration_seconds, 10)

    def test_disabled_by_default_and_reenable_starts_a_new_interval(self):
        self.assertFalse(detection_enabled("LOW_ACTIVITY", {}))
        self.settings["lowActivityEnabled"] = False
        for index in range(1, 8):
            result = self.feed(index)
            self.assertIsNone(result.event)
            self.assertEqual(result.duration_seconds, 0)
        self.settings["lowActivityEnabled"] = True
        self.assertEqual(self.feed(8).duration_seconds, 10)

    def test_relevant_settings_change_resets_but_unrelated_version_change_does_not(self):
        for index in range(1, 6):
            self.feed(index)
        self.settings.update(version=2, fallAlertEnabled=False)
        self.assertEqual(self.feed(6).event["details"]["settingsVersion"], 2)
        self.settings.update(version=3, lowActivityThreshold=0.15)
        self.assertEqual(self.feed(7).duration_seconds, 10)
        self.settings.update(version=4, lowActivityMinutes=2)
        self.assertEqual(self.feed(8).duration_seconds, 10)

    def test_source_model_or_calibration_change_never_combines_intervals(self):
        for key, value in [("isDemo", True), ("modelVersion", "activity-v2"), ("calibrationVersion", "room-v2")]:
            with self.subTest(key=key):
                self.setUp()
                for index in range(1, 6):
                    self.feed(index)
                raw = self.status(6)
                if key == "isDemo":
                    raw[key] = value
                else:
                    raw["activity"][key] = value
                result = self.detector.update(raw, self.settings, BASE + timedelta(seconds=60))
                self.assertEqual(result.duration_seconds, 10)
                self.assertIsNone(result.event)

    def test_demo_episode_keeps_demo_flag(self):
        result = None
        for index in range(1, 7):
            result = self.feed(index, isDemo=True)
        self.assertTrue(result.event["isDemo"])

    def test_invalid_score_and_window_never_become_zero_activity(self):
        for score in [True, None, "0.1", -0.1, 1.1, float("nan"), float("inf"), 10 ** 1000]:
            with self.subTest(score=repr(score)[:30]):
                raw = self.status(1)["activity"] | {"score": score}
                self.assertEqual(self.feed(1, activity=raw).state, "UNKNOWN")
                self.detector = LowActivityDetector("room-01")
        for offset in [0, 16, -1]:
            raw = self.status(1)["activity"] | {"windowStartedAt": iso_timestamp(BASE + timedelta(seconds=10 - offset))}
            self.assertEqual(self.feed(1, activity=raw).state, "UNKNOWN")
            self.detector = LowActivityDetector("room-01")

    def test_score_equal_to_threshold_is_low_and_zero_is_valid(self):
        for score in [0, 0.2]:
            self.detector = LowActivityDetector("room-01")
            raw = self.status(1)["activity"] | {"score": score}
            self.assertEqual(self.feed(1, activity=raw).state, "LOW")

    def test_timestamp_freshness_future_tolerance_and_required_versions(self):
        for age, valid in [(15, True), (15.001, False), (-5, True), (-5.001, False)]:
            with self.subTest(age=age):
                status = self.status(1)
                now = BASE + timedelta(seconds=10 + age)
                if valid:
                    ActivityWindow.from_status(status, now)
                else:
                    with self.assertRaises(ValueError):
                        ActivityWindow.from_status(status, now)
        for changes in [{"modelVersion": ""}, {"calibrationVersion": None},
                        {"windowStartedAt": "2026-02-30T00:00:00Z"}]:
            raw = self.status(1)["activity"] | changes
            self.assertEqual(self.feed(1, activity=raw).state, "UNKNOWN")
            self.detector = LowActivityDetector("room-01")

    def test_invalid_settings_and_wrong_gateway_fail_closed(self):
        for patch in [{"lowActivityMinutes": True}, {"lowActivityMinutes": 0}, {"lowActivityMinutes": 1441},
                      {"lowActivityThreshold": "0.2"}, {"lowActivityEnabled": "true"}, {"version": None}]:
            with self.subTest(patch=patch):
                with self.assertRaises(ValueError):
                    self.detector.update(self.status(1), self.settings | patch, BASE + timedelta(seconds=10))
        with self.assertRaises(ValueError):
            self.feed(1, gatewayId="different-room")
        with self.assertRaises(ValueError):
            self.detector.update(self.status(1), self.settings, datetime(2026, 10, 8))

    def test_daily_schedule_boundaries_and_overnight_policy(self):
        for start, end, at, allowed in [
            ("09:00", "18:00", "2026-10-08T00:00:00Z", True),
            ("09:00", "18:00", "2026-10-08T08:59:59Z", True),
            ("09:00", "18:00", "2026-10-08T09:00:00Z", False),
            ("22:00", "07:00", "2026-10-08T13:00:00Z", True),
            ("22:00", "07:00", "2026-10-08T21:59:59Z", True),
            ("22:00", "07:00", "2026-10-08T22:00:00Z", False),
            ("22:00", "07:00", "2026-10-08T12:59:59Z", False),
        ]:
            settings = self.settings | {"lowActivityMode": "TIME_RANGE", "lowActivityStart": start, "lowActivityEnd": end}
            self.assertEqual(detection_enabled("LOW_ACTIVITY", settings, at), allowed)

    def test_schedule_end_clears_on_idle_before_stale_and_next_day_starts_fresh(self):
        self.settings.update(lowActivityMode="TIME_RANGE", lowActivityStart="09:00", lowActivityEnd="09:02")
        for index in range(1, 12):
            result = self.feed(index)
        self.assertEqual(result.duration_seconds, 110)
        paused = self.detector.check_stale(BASE + timedelta(minutes=2))
        self.assertEqual(paused.state, "PAUSED")
        self.assertEqual(paused.duration_seconds, 0)
        tomorrow = BASE + timedelta(days=1, seconds=10)
        raw = self.status(12) | {"measuredAt": iso_timestamp(tomorrow)}
        raw["activity"]["windowStartedAt"] = iso_timestamp(tomorrow - timedelta(seconds=10))
        result = self.detector.update(raw, self.settings, tomorrow)
        self.assertEqual(result.duration_seconds, 10)
        self.assertIsNone(result.event)

    def test_windows_crossing_schedule_edges_are_not_accumulated(self):
        self.settings.update(lowActivityMode="TIME_RANGE", lowActivityStart="09:00", lowActivityEnd="09:01")
        raw = self.status(1)["activity"] | {"windowStartedAt": iso_timestamp(BASE - timedelta(seconds=5))}
        self.assertEqual(self.feed(1, activity=raw).state, "PAUSED")
        for index in range(2, 6):
            self.assertIsNone(self.feed(index).event)
        final = self.feed(6)
        self.assertEqual(final.state, "PAUSED")
        self.assertEqual(final.duration_seconds, 0)
        self.assertIsNone(final.event)

    def test_overnight_episode_records_schedule_and_continues_across_midnight(self):
        self.settings.update(lowActivityMode="TIME_RANGE", lowActivityStart="22:00", lowActivityEnd="07:00")
        start = BASE + timedelta(hours=14, minutes=59, seconds=30)  # Korea 23:59:30.
        for index in range(1, 7):
            end = start + timedelta(seconds=index * 10)
            raw = self.status(index) | {"measuredAt": iso_timestamp(end)}
            raw["activity"]["windowStartedAt"] = iso_timestamp(end - timedelta(seconds=10))
            result = self.detector.update(raw, self.settings, end)
        self.assertEqual(result.duration_seconds, 60)
        self.assertEqual(result.event["details"]["monitoringMode"], "TIME_RANGE")
        self.assertEqual(result.event["details"]["monitoringStart"], "22:00")
        self.assertEqual(result.event["details"]["monitoringEnd"], "07:00")
        self.assertEqual(result.event["details"]["timeZone"], "Asia/Seoul")

    def test_schedule_changes_reset_and_invalid_schedules_fail_closed(self):
        for index in range(1, 6):
            self.feed(index)
        self.settings.update(lowActivityMode="TIME_RANGE", lowActivityStart="09:00", lowActivityEnd="18:00")
        self.assertEqual(self.feed(6).duration_seconds, 10)
        self.settings["lowActivityEnd"] = "17:00"
        self.assertEqual(self.feed(7).duration_seconds, 10)
        for patch in [{"lowActivityMode": "OTHER"}, {"lowActivityStart": "24:00"},
                      {"lowActivityEnd": "17:60"}, {"lowActivityStart": "9:00"},
                      {"lowActivityEnd": "09:00"}, {"lowActivityStart": None}, {"timeZone": "UTC"}]:
            with self.subTest(patch=patch):
                with self.assertRaises(ValueError):
                    self.detector.update(self.status(8), self.settings | patch, BASE + timedelta(seconds=80))
                self.assertFalse(detection_enabled("LOW_ACTIVITY", self.settings | patch, iso_timestamp(BASE)))


if __name__ == "__main__":
    unittest.main()

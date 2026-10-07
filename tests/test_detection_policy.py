import unittest
from datetime import datetime
from unittest.mock import Mock

from python.detection_policy import alert_allowed, bed_monitoring_active, detection_enabled
from python.gateway_client import GatewayClient


class BedScheduleTests(unittest.TestCase):
    def setUp(self):
        self.settings = {
            "bedMonitoringEnabled": True,
            "bedMonitoringMode": "TIME_RANGE",
            "bedMonitoringStart": "22:00",
            "bedMonitoringEnd": "07:00",
        }

    def test_overnight_includes_start_and_excludes_end(self):
        for instant, expected in [
            ("2026-10-06T12:59:59Z", False),  # Korea 21:59:59
            ("2026-10-06T13:00:00Z", True),   # Korea 22:00
            ("2026-10-06T16:00:00Z", True),   # Korea next day 01:00
            ("2026-10-06T21:59:59Z", True),   # Korea 06:59:59
            ("2026-10-06T22:00:00Z", False),  # Korea 07:00
        ]:
            with self.subTest(instant=instant):
                self.assertEqual(bed_monitoring_active(self.settings, instant), expected)

    def test_daytime_window(self):
        self.settings.update(bedMonitoringStart="09:00", bedMonitoringEnd="18:00")
        self.assertTrue(bed_monitoring_active(self.settings, "2026-10-06T00:00:00Z"))
        self.assertFalse(bed_monitoring_active(self.settings, "2026-10-06T09:00:00Z"))

    def test_disabled_and_all_day(self):
        self.settings["bedMonitoringEnabled"] = False
        self.assertFalse(bed_monitoring_active(self.settings, "2026-10-06T13:00:00Z"))
        self.settings.update(bedMonitoringEnabled=True, bedMonitoringMode="ALL_DAY")
        self.assertTrue(bed_monitoring_active(self.settings, "2026-10-06T00:00:00Z"))
        self.assertTrue(bed_monitoring_active({}, "2026-10-06T00:00:00Z"))

    def test_falls_and_faults_ignore_bed_schedule(self):
        self.settings["bedMonitoringEnabled"] = False
        self.assertFalse(alert_allowed("NON_RETURN_WARNING", self.settings))
        for event_type in ["FALL_SUSPECTED", "SENSOR_UNAVAILABLE", "GATEWAY_OFFLINE"]:
            self.assertTrue(alert_allowed(event_type, self.settings))

    def test_alert_switches_are_independent(self):
        event_keys = {
            "FALL_SUSPECTED": "fallAlertEnabled",
            "SENSOR_UNAVAILABLE": "sensorFaultAlertEnabled",
            "GATEWAY_OFFLINE": "gatewayFaultAlertEnabled",
        }
        for event_type, key in event_keys.items():
            with self.subTest(event_type=event_type):
                settings = {key: False}
                self.assertFalse(alert_allowed(event_type, settings))
                for other in event_keys:
                    if other != event_type:
                        self.assertTrue(alert_allowed(other, settings))
                self.assertTrue(alert_allowed("NON_RETURN_WARNING", settings))

    def test_invalid_configuration_or_naive_time_rejected(self):
        with self.assertRaises(ValueError):
            bed_monitoring_active(self.settings, datetime(2026, 10, 6))
        self.settings["bedMonitoringEnd"] = "22:00"
        with self.assertRaises(ValueError):
            bed_monitoring_active(self.settings, "2026-10-06T13:00:00Z")
        self.settings["bedMonitoringEnd"] = "24:00"
        with self.assertRaises(ValueError):
            bed_monitoring_active(self.settings, "2026-10-06T13:00:00Z")

    def test_disabled_new_episodes_keep_status_and_existing_retries(self):
        client = object.__new__(GatewayClient)
        client.request = Mock(return_value={"accepted": True})
        payload = {"type": "FALL_SUSPECTED", "detectedAt": "2026-10-06T13:00:00Z"}
        settings = {"fallAlertEnabled": False}
        self.assertFalse(detection_enabled(payload["type"], settings))
        self.assertIsNone(client.send_detection_event(payload, settings))
        client.request.assert_not_called()
        client.send_status({"sensorAvailable": True})
        client.request.assert_called_once_with("POST", "/ingest/status", {"sensorAvailable": True})
        client.request.reset_mock()
        client.send_event(payload)
        client.request.assert_called_once_with("POST", "/ingest/events", payload)
        client.request.reset_mock()
        self.assertEqual(client.send_detection_event(payload, {"fallAlertEnabled": True}), {"accepted": True})
        client.request.assert_called_once_with("POST", "/ingest/events", payload)

    def test_unknown_detection_type_rejected(self):
        with self.assertRaises(ValueError):
            detection_enabled("UNKNOWN", {})


if __name__ == "__main__":
    unittest.main()

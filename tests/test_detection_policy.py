import unittest
from unittest.mock import Mock

from python.detection_policy import alert_allowed, detection_enabled
from python.gateway_client import GatewayClient


class DetectionPolicyTests(unittest.TestCase):
    def test_retired_types_never_create_new_episodes(self):
        client = object.__new__(GatewayClient)
        client.request = Mock()
        for settings in ({}, {"bedMonitoringEnabled": True, "bedMonitoringMode": "ALL_DAY"}):
            for event_type in ("NON_RETURN_WARNING", "BED_EXIT"):
                self.assertFalse(detection_enabled(event_type, settings))
                self.assertIsNone(client.send_detection_event({"type": event_type}, settings))
        client.request.assert_not_called()

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

"""CamelCase gateway API client. CSI parsing, inference and durable retries are separate."""
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

try:
    from .detection_policy import detection_enabled
except ImportError:  # Direct execution from python/send_demo.py.
    from detection_policy import detection_enabled


class GatewayClient:
    def __init__(self):
        load_dotenv(Path(__file__).resolve().parents[1] / ".env")
        self.base_url = os.getenv("API_BASE_URL", "http://127.0.0.1:3002").rstrip("/")
        token = os.getenv("GATEWAY_TOKEN", "")
        if not token or token.startswith("replace-with-"):
            raise ValueError("Set GATEWAY_TOKEN in the project .env first.")
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}"})

    def request(self, method, path, payload=None):
        response = self.session.request(
            method, f"{self.base_url}/api{path}", json=payload, timeout=(3, 8)
        )
        response.raise_for_status()
        return response.json()

    def send_status(self, payload):
        return self.request("POST", "/ingest/status", payload)

    def send_event(self, payload):
        # Retrying code must reuse payload.eventId and the original payload unchanged.
        return self.request("POST", "/ingest/events", payload)

    def send_detection_event(self, payload, settings):
        """Send a new episode only when enabled; return None when disabled.

        Inference should also check detection_enabled before creating an episode.
        Outbox retries must use send_event so later settings cannot erase history.
        """
        if not detection_enabled(payload["type"], settings, payload.get("detectedAt")):
            return None
        return self.send_event(payload)

    def get_settings(self):
        return self.request("GET", "/gateway/settings")

    def close(self):
        self.session.close()

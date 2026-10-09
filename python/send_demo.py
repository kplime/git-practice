"""Send clearly marked generated events. This does not collect CSI or detect falls."""
import argparse
import time
import uuid
from datetime import datetime, timezone

import requests
from gateway_client import GatewayClient


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--heartbeat-seconds", type=int, default=0, choices=range(0, 3601), metavar="0..3600")
    args = parser.parse_args()
    client = GatewayClient()
    gateway_id = f"demo-{uuid.uuid4()}"
    status = {
        "gatewayId": gateway_id, "generation": 1, "sequence": 0,
        "sensorAvailable": True, "qualityStatus": "AVAILABLE",
        "measuredAt": utc_now(), "isDemo": True,
    }
    try:
        client.send_status(status)
        for event_type in ("FALL_SUSPECTED", "SENSOR_UNAVAILABLE", "GATEWAY_OFFLINE"):
            timestamp = utc_now()
            event_id = str(uuid.uuid4())
            result = client.send_event({
                "eventId": event_id, "gatewayId": gateway_id, "type": event_type,
                "occurredAt": timestamp, "detectedAt": timestamp, "score": None,
                "qualityStatus": "UNKNOWN", "modelVersion": "generated-demo",
                "details": {"source": "send_demo.py"}, "isDemo": True,
            })
            print(f"Generated demo event accepted: {result['eventId']} ({event_type})")
        deadline = time.monotonic() + args.heartbeat_seconds
        while time.monotonic() < deadline:
            time.sleep(min(5, max(0, deadline - time.monotonic())))
            status["sequence"] += 1
            status["measuredAt"] = utc_now()
            client.send_status(status)
        print("Demo finished. All records are marked isDemo=true. No CSI was collected.")
    except requests.RequestException as error:
        code = error.response.status_code if error.response is not None else "connection failed"
        raise SystemExit(f"Demo request failed ({code}). Check the Node server and project .env.") from None
    finally:
        client.close()


if __name__ == "__main__":
    main()

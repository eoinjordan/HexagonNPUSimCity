# Reads the host-side llama.cpp quantization sweep and streams it to the browser.
#
# App Lab runs this file inside a container that bind-mounts only the app
# directory, so the sweep itself runs on the host (tools/applab/sweep.py) and
# hands results over through data/sweep.json.

import json
import threading
import time
from pathlib import Path

from arduino.app_bricks.web_ui import WebUI
from arduino.app_utils import App

SWEEP_FILE = Path(__file__).resolve().parent.parent / "data" / "sweep.json"
# Long enough to read each city layout, short enough to feel live.
DWELL_SECONDS = 8.0
POLL_SECONDS = 2.0

ui = WebUI()
_state = {"report": None, "current": None}
_lock = threading.Lock()


def _load():
    try:
        report = json.loads(SWEEP_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return report if isinstance(report.get("samples"), list) and report["samples"] else None


def _status():
    with _lock:
        report, current = _state["report"], _state["current"]
    if report is None:
        return {
            "state": "waiting",
            "message": "No sweep yet. Run ~/hexsim/sweep.py on the board.",
            "samples": [],
            "current": None,
        }
    return {
        "state": "ready",
        "message": f"{len(report['samples'])} quantizations measured on {report.get('host', 'the board')}",
        "generatedAt": report.get("generatedAt"),
        "threads": report.get("threads"),
        "samples": report["samples"],
        "current": current,
    }


def _broadcast(sample):
    with _lock:
        _state["current"] = sample
    ui.send_message("sample", sample)


def _cycle():
    """Publish one quantization at a time so the city visibly changes per format."""
    index = 0
    stamp = None
    while True:
        report = _load()
        if report is None:
            ui.send_message("status", _status())
            time.sleep(POLL_SECONDS)
            continue
        if report.get("generatedAt") != stamp:
            stamp, index = report.get("generatedAt"), 0
            with _lock:
                _state["report"] = report
            ui.send_message("status", _status())
        samples = report["samples"]
        _broadcast(samples[index % len(samples)])
        index += 1
        time.sleep(DWELL_SECONDS)


ui.expose_api("GET", "/sweep", _status)
ui.on_connect(lambda sid: ui.send_message("status", _status()))

threading.Thread(target=_cycle, name="sweep-cycle", daemon=True).start()

App.run()  # blocks until the app is stopped

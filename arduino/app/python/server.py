"""HTTP host and telemetry API for the HexagonNPUCity connector.

Serves the built 3D sim (Vite ``dist``) and exposes a small JSON telemetry API
driven by the illustrative :class:`HexagonModel`. Standard-library only, so it
runs and is testable off-device (not just on the Arduino UNO Q).

Endpoints:
    GET  /                        the built web app (static files)
    GET  /api/telemetry           current illustrative state (JSON)
    GET  /api/meta                available precisions / workloads (JSON)
    POST /api/control/workload    {"value": "vision-conv"}
    POST /api/control/precision   {"value": "INT4"}
    POST /api/control/cycle-workload
    POST /api/control/cycle-precision
"""

from __future__ import annotations

import json
import os
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Dict, Optional, Tuple

from hexagon_model import PRECISIONS, WORKLOADS, HexagonModel


class Telemetry:
    """Thread-safe wrapper that steps the model and serves snapshots."""

    def __init__(self, model: Optional[HexagonModel] = None) -> None:
        self.model = model or HexagonModel()
        self._lock = threading.Lock()
        self._stop = threading.Event()

    def step(self, dt: float) -> None:
        with self._lock:
            self.model.step(dt)

    def snapshot(self) -> Dict[str, object]:
        with self._lock:
            return self.model.snapshot()

    def _mutate(self, fn: Callable[[], object]) -> Dict[str, object]:
        with self._lock:
            fn()
            return self.model.snapshot()

    def set_workload(self, workload_id: str) -> Dict[str, object]:
        return self._mutate(lambda: self.model.set_workload(workload_id))

    def set_precision(self, precision: str) -> Dict[str, object]:
        return self._mutate(lambda: self.model.set_precision(precision))

    def cycle_workload(self) -> Dict[str, object]:
        return self._mutate(self.model.cycle_workload)

    def cycle_precision(self) -> Dict[str, object]:
        return self._mutate(self.model.cycle_precision)

    def run_forever(self, hz: float = 20.0) -> None:
        period = 1.0 / hz
        last = time.monotonic()
        while not self._stop.is_set():
            now = time.monotonic()
            self.step(now - last)
            last = now
            time.sleep(period)

    def start_background(self, hz: float = 20.0) -> threading.Thread:
        thread = threading.Thread(target=self.run_forever, kwargs={"hz": hz}, daemon=True)
        thread.start()
        return thread

    def stop(self) -> None:
        self._stop.set()


def _make_handler(telemetry: Telemetry, web_root: str):
    class Handler(SimpleHTTPRequestHandler):
        # ``directory`` keeps static serving sandboxed to the web root and
        # blocks path traversal (handled by SimpleHTTPRequestHandler).
        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, directory=web_root, **kwargs)

        def log_message(self, *args) -> None:  # keep the App Lab console quiet
            pass

        def _send_json(self, obj: object, code: int = 200) -> None:
            body = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> object:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            return json.loads(raw or b"{}")

        def do_GET(self) -> None:  # noqa: N802 (http.server naming)
            path = self.path.split("?", 1)[0]
            if path == "/api/telemetry":
                self._send_json(telemetry.snapshot())
                return
            if path == "/api/meta":
                self._send_json(
                    {
                        "app": "HexagonNPUCity",
                        "host": "arduino-uno-q",
                        "precisions": PRECISIONS,
                        "workloads": WORKLOADS,
                    }
                )
                return
            super().do_GET()

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            try:
                data = self._read_json()
            except (json.JSONDecodeError, ValueError):
                self._send_json({"error": "invalid JSON body"}, 400)
                return
            try:
                if path == "/api/control/workload":
                    self._send_json(telemetry.set_workload(str(data["value"])))  # type: ignore[index]
                    return
                if path == "/api/control/precision":
                    self._send_json(telemetry.set_precision(str(data["value"])))  # type: ignore[index]
                    return
                if path == "/api/control/cycle-workload":
                    self._send_json(telemetry.cycle_workload())
                    return
                if path == "/api/control/cycle-precision":
                    self._send_json(telemetry.cycle_precision())
                    return
            except (KeyError, TypeError):
                self._send_json({"error": "missing 'value'"}, 400)
                return
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json({"error": "not found"}, 404)

    return Handler


def default_web_root() -> str:
    """Resolve the directory holding the built web app.

    Order: ``$HEXAGON_WEB_ROOT`` -> ``<here>/web`` (deployed layout) ->
    the repo's ``dist`` (local development).
    """
    env = os.environ.get("HEXAGON_WEB_ROOT")
    if env:
        return env
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = (
        os.path.join(here, "web"),
        os.path.abspath(os.path.join(here, "..", "..", "..", "dist")),
    )
    for candidate in candidates:
        if os.path.isdir(candidate):
            return candidate
    return os.path.join(here, "web")


def serve(
    web_root: str,
    host: str = "0.0.0.0",
    port: int = 7080,
    telemetry: Optional[Telemetry] = None,
    step: bool = True,
) -> Tuple[ThreadingHTTPServer, Telemetry]:
    """Build (but do not yet run) the HTTP server. Caller runs ``serve_forever``."""
    telemetry = telemetry or Telemetry()
    if step:
        telemetry.start_background()
    httpd = ThreadingHTTPServer((host, port), _make_handler(telemetry, web_root))
    return httpd, telemetry


if __name__ == "__main__":
    root = default_web_root()
    listen_port = int(os.environ.get("HEXAGON_PORT", "7080"))
    server, _telemetry = serve(root, port=listen_port)
    print(f"HexagonNPUCity connector serving {root} on http://localhost:{listen_port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

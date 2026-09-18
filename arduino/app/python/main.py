"""HexagonNPUCity — Arduino App Lab connector (UNO Q entry point).

Runs on the UNO Q's Linux side (Qualcomm Dragonwing MPU) and:
  * serves the built 3D Hexagon NPU sim over HTTP for the board's display /
    the LAN,
  * mirrors the sim's illustrative telemetry onto the two MPU-driven RGB LEDs
    (LED1 = precision colour, LED2 = workload colour), and
  * bridges to the STM32 sketch so the MCU reflects precision + load on LED3,
    and an optional button cycles the workload.

Everything is an ILLUSTRATIVE model — no datasheet figures, no real hardware
measurement. See arduino/README.md and docs/verification.md.
"""

import os
import sys
import threading
import time

# Make the sibling modules importable regardless of the App's working dir.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from arduino.app_utils import App, Bridge  # noqa: E402  (App Lab runtime)

try:  # LED1/LED2 helper is optional depending on the App Lab runtime version.
    from arduino.app_utils import Leds  # type: ignore  # noqa: E402
except Exception:  # pragma: no cover - depends on on-device runtime
    Leds = None

from hexagon_model import PRECISIONS, WORKLOADS  # noqa: E402
from server import Telemetry, default_web_root, serve  # noqa: E402

PORT = int(os.environ.get("HEXAGON_PORT", "7080"))

telemetry = Telemetry()

# Expose control to the microcontroller (button -> workload / precision).
Bridge.provide("cycle_workload", lambda *_: telemetry.cycle_workload()["workload"])
Bridge.provide("cycle_precision", lambda *_: telemetry.cycle_precision()["precision"])

# Host the built sim. The background stepper advances the model at 20 Hz.
_httpd, _telemetry = serve(default_web_root(), port=PORT, telemetry=telemetry)
threading.Thread(target=_httpd.serve_forever, daemon=True).start()


def _push_to_hardware(snap: dict) -> None:
    """Reflect the current state onto the board's LEDs and the MCU."""
    if Leds is not None:
        pr, pg, pb = snap["precisionRgb"]
        wr, wg, wb = snap["workloadRgb"]
        try:
            Leds.set_led1_color(pr, pg, pb)
            Leds.set_led2_color(wr, wg, wb)
        except Exception:  # pragma: no cover - hardware only
            pass
    precision_index = PRECISIONS.index(snap["precision"])
    workload_index = WORKLOADS.index(snap["workload"])
    tensor_util_pct = int(round(snap["util"]["tensor"] * 100))
    try:
        # Fire-and-forget: the MCU pulses LED3 at a rate set by utilisation.
        Bridge.notify("hexagon_state", precision_index, workload_index, tensor_util_pct)
    except Exception:  # pragma: no cover - hardware only
        pass


def loop() -> None:
    _push_to_hardware(telemetry.snapshot())
    time.sleep(0.2)


App.run(user_loop=loop)

"""Illustrative behavioural model of the Qualcomm Hexagon NPU.

A faithful, dependency-free Python port of the web app's simulation
(``src/sim/model.ts``). Every figure here is ILLUSTRATIVE and scaled for
legibility: switching workload or precision produces a believable, readable
change across the accelerators, not a datasheet value. The defaults are kept in
sync with ``docs/verification.md``.

This module imports nothing beyond the Python standard library, so it runs and
is unit-tested on any machine, not only on the Arduino UNO Q.
"""

from __future__ import annotations

import copy
import math
from typing import Dict, List, Tuple

# Order matters: these indices are what we send to the microcontroller.
PRECISIONS: List[str] = ["INT4", "INT8", "INT16", "FP16"]
WORKLOADS: List[str] = ["llm-decode", "vision-conv", "idle"]

WORKLOAD_LABELS: Dict[str, str] = {
    "llm-decode": "LLM decode",
    "vision-conv": "Vision / conv",
    "idle": "Idle",
}

# Precision -> display colour, matching the web app's quantization badge.
PRECISION_HEX: Dict[str, str] = {
    "INT4": "#ff6a3d",
    "INT8": "#ffb020",
    "INT16": "#35d07f",
    "FP16": "#22d3ee",
}

# Precision -> binary RGB for the board's on/off LEDs (nearest primary to the
# hues above). The UNO Q RGB LEDs are driven per-channel, so we quantise the
# colour to one of eight combinations.
PRECISION_RGB: Dict[str, Tuple[int, int, int]] = {
    "INT4": (1, 0, 0),   # red
    "INT8": (1, 1, 0),   # yellow
    "INT16": (0, 1, 0),  # green
    "FP16": (0, 1, 1),   # cyan
}

# Workload -> binary RGB for the second status LED.
WORKLOAD_RGB: Dict[str, Tuple[int, int, int]] = {
    "llm-decode": (0, 0, 1),   # blue
    "vision-conv": (1, 0, 1),  # magenta
    "idle": (0, 0, 0),         # off
}

# Whether a precision is *integer quantized*. FP16 is reduced precision, not
# integer quantization, and the UI/hardware should say so honestly.
QUANTIZED: Dict[str, bool] = {
    "INT4": True,
    "INT8": True,
    "INT16": True,
    "FP16": False,
}

# The reviewed, ILLUSTRATIVE figures the model runs on. These mirror
# DEFAULT_SIM_CONFIG in src/sim/model.ts exactly.
DEFAULT_CONFIG: Dict[str, object] = {
    "peak_tops": {"INT4": 80, "INT8": 45, "INT16": 22, "FP16": 20},
    "token_ceil": {"INT4": 95, "INT8": 62, "INT16": 34, "FP16": 30},
    "workloads": {
        "llm-decode": {
            "scalar": 0.35, "vector": 0.5, "tensor": 0.82,
            "vtcm": 0.72, "token_scale": 1, "micro_tiles": 640,
        },
        "vision-conv": {
            "scalar": 0.24, "vector": 0.72, "tensor": 0.92,
            "vtcm": 0.8, "token_scale": 0, "micro_tiles": 900,
        },
        "idle": {
            "scalar": 0.06, "vector": 0.05, "tensor": 0.04,
            "vtcm": 0.12, "token_scale": 0, "micro_tiles": 40,
        },
    },
    "power": {"base": 0.4, "scalar": 0.6, "vector": 1.1, "tensor": 2.4},
    "supported_opsets": [13, 17, 19, 21],
}


def clamp01(value: float) -> float:
    """Clamp a value into the inclusive range [0, 1]."""
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def approach(current: float, target: float, rate: float, dt: float) -> float:
    """Exponentially chase ``target`` from ``current``.

    Matches ``approach`` in src/core/util.ts:
    ``current + (target - current) * (1 - exp(-rate * dt))``.
    """
    return current + (target - current) * -math.expm1(-rate * dt)


class HexagonModel:
    """A small behavioural model of the Hexagon NPU under load.

    Utilisation of each accelerator chases a per-workload target; the headline
    metrics (TOPS, tokens/s, power) are derived from the current precision and
    the tensor engine's utilisation, exactly as the web app does.
    """

    RATE = 2.2  # how fast utilisation chases its target

    def __init__(self, config: Dict[str, object] | None = None) -> None:
        self.config = copy.deepcopy(config or DEFAULT_CONFIG)
        self.t = 0.0
        self.workload = "llm-decode"
        self.precision = "INT8"
        self.util = {"scalar": 0.0, "vector": 0.0, "tensor": 0.0}
        self.vtcm_occupancy = 0.0
        self.micro_tiles = 0.0
        self.tops = 0.0
        self.tokens_per_sec = 0.0
        self.power_watts = 0.0
        self.paused = False
        self._refresh_metrics()

    # -- control ---------------------------------------------------------
    def set_workload(self, workload_id: str) -> str:
        if workload_id not in self.config["workloads"]:  # type: ignore[operator]
            raise ValueError(f"unknown workload: {workload_id!r}")
        self.workload = workload_id
        self._refresh_metrics()
        return self.workload

    def set_precision(self, precision: str) -> str:
        if precision not in PRECISIONS:
            raise ValueError(f"unknown precision: {precision!r}")
        self.precision = precision
        self._refresh_metrics()
        return self.precision

    def cycle_workload(self) -> str:
        index = WORKLOADS.index(self.workload)
        return self.set_workload(WORKLOADS[(index + 1) % len(WORKLOADS)])

    def cycle_precision(self) -> str:
        index = PRECISIONS.index(self.precision)
        return self.set_precision(PRECISIONS[(index + 1) % len(PRECISIONS)])

    def toggle_pause(self) -> bool:
        self.paused = not self.paused
        return self.paused

    # -- simulation ------------------------------------------------------
    def _refresh_metrics(self) -> None:
        workload = self.config["workloads"][self.workload]  # type: ignore[index]
        peak = self.config["peak_tops"][self.precision]      # type: ignore[index]
        ceil = self.config["token_ceil"][self.precision]     # type: ignore[index]
        power = self.config["power"]                         # type: ignore[assignment]
        self.tops = peak * self.util["tensor"]
        self.tokens_per_sec = ceil * workload["token_scale"] * self.util["tensor"]
        self.power_watts = (
            power["base"]
            + self.util["scalar"] * power["scalar"]
            + self.util["vector"] * power["vector"]
            + self.util["tensor"] * power["tensor"]
        )

    def step(self, dt: float) -> None:
        """Advance the model by ``dt`` seconds."""
        if self.paused or not math.isfinite(dt) or dt <= 0:
            return
        dt = min(dt, 0.1)
        self.t += dt
        target = self.config["workloads"][self.workload]  # type: ignore[index]
        rate = self.RATE
        self.util["scalar"] = approach(self.util["scalar"], target["scalar"], rate, dt)
        self.util["vector"] = approach(self.util["vector"], target["vector"], rate, dt)
        self.util["tensor"] = approach(self.util["tensor"], target["tensor"], rate, dt)
        self.vtcm_occupancy = approach(self.vtcm_occupancy, target["vtcm"], rate, dt)
        self.micro_tiles = approach(self.micro_tiles, target["micro_tiles"], 1.6, dt)
        self._refresh_metrics()

    def settle(self, seconds: float = 6.0, dt: float = 1.0 / 30.0) -> "HexagonModel":
        """Advance until utilisation has effectively reached the target."""
        for _ in range(max(1, int(seconds / dt))):
            self.step(dt)
        return self

    # -- output ----------------------------------------------------------
    def snapshot(self) -> Dict[str, object]:
        """A JSON-serialisable view of the current state."""
        return {
            "t": round(self.t, 3),
            "workload": self.workload,
            "workloadLabel": WORKLOAD_LABELS[self.workload],
            "precision": self.precision,
            "quantized": QUANTIZED[self.precision],
            "tops": round(self.tops, 2),
            "tokensPerSec": round(self.tokens_per_sec, 2),
            "powerWatts": round(self.power_watts, 3),
            "util": {key: round(value, 4) for key, value in self.util.items()},
            "vtcmOccupancy": round(self.vtcm_occupancy, 4),
            "microTiles": round(self.micro_tiles, 1),
            "paused": self.paused,
            "color": PRECISION_HEX[self.precision],
            "precisionRgb": list(PRECISION_RGB[self.precision]),
            "workloadRgb": list(WORKLOAD_RGB[self.workload]),
        }

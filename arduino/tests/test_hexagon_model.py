"""Unit tests for the illustrative Hexagon model (no board required).

Run: ``python3 -m unittest discover -s arduino/tests`` or ``arduino/scripts/test-local.sh``.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app", "python")))

from hexagon_model import (  # noqa: E402
    DEFAULT_CONFIG,
    PRECISIONS,
    QUANTIZED,
    WORKLOADS,
    HexagonModel,
)


class TestHexagonModel(unittest.TestCase):
    def test_precisions_and_workloads(self):
        self.assertEqual(PRECISIONS, ["INT4", "INT8", "INT16", "FP16"])
        self.assertEqual(WORKLOADS, ["llm-decode", "vision-conv", "idle"])

    def test_defaults_match_web_app(self):
        self.assertEqual(DEFAULT_CONFIG["peak_tops"]["INT8"], 45)
        self.assertEqual(DEFAULT_CONFIG["token_ceil"]["INT4"], 95)
        self.assertEqual(DEFAULT_CONFIG["supported_opsets"], [13, 17, 19, 21])

    def test_initial_state(self):
        model = HexagonModel()
        self.assertEqual(model.workload, "llm-decode")
        self.assertEqual(model.precision, "INT8")
        self.assertFalse(model.paused)

    def test_steady_state_int8_llm_decode(self):
        model = HexagonModel().settle()
        # util.tensor -> 0.82, scalar -> 0.35, vector -> 0.5
        self.assertAlmostEqual(model.util["tensor"], 0.82, delta=1e-3)
        self.assertAlmostEqual(model.tops, 45 * 0.82, delta=0.05)         # 36.9
        self.assertAlmostEqual(model.tokens_per_sec, 62 * 0.82, delta=0.05)  # 50.84
        expected_power = 0.4 + 0.35 * 0.6 + 0.5 * 1.1 + 0.82 * 2.4         # 3.128
        self.assertAlmostEqual(model.power_watts, expected_power, delta=0.02)

    def test_precision_scales_tops(self):
        model = HexagonModel()
        model.set_precision("INT4")
        model.settle()
        self.assertAlmostEqual(model.tops, 80 * 0.82, delta=0.05)  # 65.6

    def test_idle_and_vision_have_no_tokens(self):
        for workload in ("idle", "vision-conv"):
            model = HexagonModel()
            model.set_workload(workload)
            model.settle()
            self.assertEqual(model.tokens_per_sec, 0.0)

    def test_fp16_is_reduced_precision_not_quantized(self):
        self.assertTrue(QUANTIZED["INT4"])
        self.assertTrue(QUANTIZED["INT8"])
        self.assertTrue(QUANTIZED["INT16"])
        self.assertFalse(QUANTIZED["FP16"])
        model = HexagonModel()
        model.set_precision("FP16")
        self.assertFalse(model.snapshot()["quantized"])
        model.set_precision("INT8")
        self.assertTrue(model.snapshot()["quantized"])

    def test_cycle_wraps(self):
        model = HexagonModel()
        self.assertEqual(model.precision, "INT8")
        self.assertEqual(model.cycle_precision(), "INT16")
        model.set_precision("FP16")
        self.assertEqual(model.cycle_precision(), "INT4")
        model.set_workload("idle")
        self.assertEqual(model.cycle_workload(), "llm-decode")

    def test_unknown_values_raise(self):
        model = HexagonModel()
        with self.assertRaises(ValueError):
            model.set_precision("INT2")
        with self.assertRaises(ValueError):
            model.set_workload("mining")

    def test_pause_freezes_step(self):
        model = HexagonModel().settle()
        tensor = model.util["tensor"]
        model.toggle_pause()
        model.set_workload("idle")
        for _ in range(60):
            model.step(1 / 30)
        # Paused: utilisation should not have chased the new (much lower) target.
        self.assertAlmostEqual(model.util["tensor"], tensor, delta=1e-6)

    def test_snapshot_shape(self):
        snap = HexagonModel().snapshot()
        for key in (
            "workload", "workloadLabel", "precision", "quantized", "tops",
            "tokensPerSec", "powerWatts", "util", "vtcmOccupancy", "microTiles",
            "color", "precisionRgb", "workloadRgb",
        ):
            self.assertIn(key, snap)
        self.assertEqual(snap["color"], "#ffb020")           # INT8 hue
        self.assertEqual(snap["precisionRgb"], [1, 1, 0])    # yellow
        self.assertEqual(snap["workloadRgb"], [0, 0, 1])     # blue (llm-decode)


if __name__ == "__main__":
    unittest.main()

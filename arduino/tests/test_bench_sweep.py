"""Tests for the host-side llama-bench sweep (scripts/bench-sweep.py).

Loaded by path because the filename is hyphenated, matching the other
bench-* scripts.
"""

import importlib.util
import unittest
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "bench_sweep", Path(__file__).resolve().parent.parent / "scripts" / "bench-sweep.py"
)
bench_sweep = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(bench_sweep)


class ParseRowsTest(unittest.TestCase):
    def test_splits_prompt_and_generation_rows(self):
        prompt, generation = bench_sweep.parse_rows([
            {"n_prompt": 64, "n_gen": 0, "avg_ts": 118.4},
            {"n_prompt": 0, "n_gen": 32, "avg_ts": 27.9},
        ])
        self.assertEqual(prompt, 118.4)
        self.assertEqual(generation, 27.9)

    def test_missing_or_unusable_rates_stay_none(self):
        self.assertEqual(bench_sweep.parse_rows([]), (None, None))
        self.assertEqual(
            bench_sweep.parse_rows([
                {"n_prompt": 64, "n_gen": 0, "avg_ts": 0},
                {"n_prompt": 0, "n_gen": 32, "avg_ts": -1},
            ]),
            (None, None),
        )
        self.assertEqual(
            bench_sweep.parse_rows([{"n_prompt": 64, "n_gen": 0, "avg_ts": "fast"}]),
            (None, None),
        )
        self.assertEqual(bench_sweep.parse_rows([{"avg_ts": 10.0}]), (None, None))


class QuantOfTest(unittest.TestCase):
    def test_recognises_the_swept_formats(self):
        for name, expected in [
            ("SmolLM2-135M-Instruct-Q4_0.gguf", "Q4_0"),
            ("SmolLM2-135M-Instruct-Q4_K_M.gguf", "Q4_K_M"),
            ("SmolLM2-135M-Instruct-Q5_K_M.gguf", "Q5_K_M"),
            ("SmolLM2-135M-Instruct-Q8_0.gguf", "Q8_0"),
            ("SmolLM2-135M-Instruct-f16.gguf", "F16"),
        ]:
            self.assertEqual(bench_sweep.quant_of(Path(name)), expected, name)

    def test_rejects_formats_the_visualization_cannot_map(self):
        for name in ["SmolLM2-135M-Instruct-Q2_K.gguf", "model.gguf", "notes.txt"]:
            self.assertIsNone(bench_sweep.quant_of(Path(name)), name)


class DetectBackendTest(unittest.TestCase):
    def test_reports_cpu_when_no_compute_dsp_is_present(self):
        """The QRB2210 exposes only fastrpc-adsp, so there is no HTP to claim."""
        original = bench_sweep.Path
        try:
            bench_sweep.Path = lambda p: type("P", (), {"exists": staticmethod(lambda: False)})()
            self.assertEqual(bench_sweep.detect_backend(), ("cpu", "CPU"))
            bench_sweep.Path = lambda p: type("P", (), {"exists": staticmethod(lambda: True)})()
            self.assertEqual(bench_sweep.detect_backend(), ("hexagon-htp", "HTP0"))
        finally:
            bench_sweep.Path = original


if __name__ == "__main__":
    unittest.main()

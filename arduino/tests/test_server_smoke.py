"""Smoke tests for the HTTP host + telemetry API (no board required).

Starts the server on an ephemeral port bound to localhost and exercises the
static serving and JSON API. Run via ``arduino/scripts/test-local.sh``.
"""

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app", "python")))

from server import serve  # noqa: E402


def _request(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, exc.read()
        finally:
            exc.close()


class TestServerSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        with open(os.path.join(cls._tmp.name, "index.html"), "w", encoding="utf-8") as handle:
            handle.write("<!doctype html><title>HEXAGON-MARKER</title>")
        # step=False keeps the model deterministic (no background stepping).
        cls.httpd, cls.telemetry = serve(cls._tmp.name, host="127.0.0.1", port=0, step=False)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls._tmp.cleanup()

    def base(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def test_serves_index(self):
        status, body = _request(self.base("/"))
        self.assertEqual(status, 200)
        self.assertIn(b"HEXAGON-MARKER", body)

    def test_telemetry_json(self):
        # Shared server across the class, so assert membership, not a fixed value.
        status, body = _request(self.base("/api/telemetry"))
        self.assertEqual(status, 200)
        snap = json.loads(body)
        self.assertIn(snap["precision"], ["INT4", "INT8", "INT16", "FP16"])
        self.assertIn(snap["workload"], ["llm-decode", "vision-conv", "idle"])
        self.assertIn("tops", snap)

    def test_meta_json(self):
        status, body = _request(self.base("/api/meta"))
        self.assertEqual(status, 200)
        meta = json.loads(body)
        self.assertIn("INT4", meta["precisions"])
        self.assertIn("vision-conv", meta["workloads"])

    def test_control_precision(self):
        status, body = _request(self.base("/api/control/precision"), "POST", {"value": "INT4"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["precision"], "INT4")

    def test_control_workload(self):
        status, body = _request(self.base("/api/control/workload"), "POST", {"value": "vision-conv"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["workload"], "vision-conv")

    def test_bad_precision_is_rejected(self):
        status, body = _request(self.base("/api/control/precision"), "POST", {"value": "INT2"})
        self.assertEqual(status, 400)

    def test_no_path_traversal(self):
        status, body = _request(self.base("/../../../../../../etc/passwd"))
        self.assertNotIn(b"root:", body)


if __name__ == "__main__":
    unittest.main()

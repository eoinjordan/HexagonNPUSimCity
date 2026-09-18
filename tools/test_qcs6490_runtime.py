from array import array
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import sys
import tempfile
import threading
import unittest

from qcs6490_runtime import BusyError, WorkloadRuntime, compare_scores, create_server, decode_scores, run_llm, upstream_address, vision_profile


def events():
    return [
        {"Message": "EXECUTE", "Timing Source": "BACKEND", "Event Identifier": identifier,
         "Unit of Measurement": unit, "Event Level": level, "Time": value}
        for identifier, unit, level, value in (
            ("QNN (execute) time", "US", "ROOT", "2000"),
            ("Accelerator (execute) time", "US", "ROOT", "1700"),
            ("Accelerator (execute) time (cycles)", "CYCLES", "ROOT", "12000"),
            ("Conv_0:OpId_17 (cycles)", "CYCLES", "SUB-EVENT", "11000"),
        )
    ]


class RuntimeTests(unittest.TestCase):
    def test_cpu_worker_timings_and_compatibility_proxy_preserve_responses(self):
        calls = []

        class Worker(BaseHTTPRequestHandler):
            def log_message(self, *_arguments):
                pass

            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append((self.path, request))
                if self.path == "/completion":
                    payload = json.dumps({"content": "fixture text", "timings": {"predicted_n": 32, "predicted_ms": 6400}}).encode()
                    content_type = "application/json"
                else:
                    payload = b'data: {"choices":[{"delta":{"content":"fixture"}}]}\n\ndata: [DONE]\n\n'
                    content_type = "text/event-stream"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        worker = ThreadingHTTPServer(("127.0.0.1", 0), Worker)
        worker_thread = threading.Thread(target=worker.serve_forever, daemon=True)
        worker_thread.start()
        upstream = f"http://127.0.0.1:{worker.server_port}"
        runtime = WorkloadRuntime(lambda image: None, lambda: run_llm(upstream, "oddessy-vlm"))
        gateway = create_server(runtime, upstream, 0)
        gateway_thread = threading.Thread(target=gateway.serve_forever, daemon=True)
        gateway_thread.start()
        try:
            result = runtime.run("llm-decode")
            self.assertEqual(result["backend"], "cpu")
            self.assertEqual(result["tokensPerSecond"], 5)
            self.assertEqual(calls[0][1]["n_predict"], 32)
            request = {"model": "oddessy-vlm", "messages": [{"role": "user", "content": "fixture"}], "stream": True}
            connection = HTTPConnection("127.0.0.1", gateway.server_port, timeout=5)
            connection.request("POST", "/v1/chat/completions", json.dumps(request), {"Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader("X-Hexagon-Backend"), "cpu")
            self.assertIn(b"data: [DONE]", response.read())
            connection.close()
            self.assertEqual(calls[-1], ("/v1/chat/completions", request))
            self.assertFalse(runtime.lock.locked())
        finally:
            for server in (gateway, worker):
                server.shutdown()
                server.server_close()
            gateway_thread.join()
            worker_thread.join()

    def test_modes_are_explicit_idle_dispatches_nothing_and_npu_evidence_is_required(self):
        dispatched = []
        runtime = WorkloadRuntime(lambda image: dispatched.append("vision") or {
            "backend": "qnn-htp", "profile": {"acceleratorExecutionVerified": True}},
            lambda: dispatched.append("llm") or {"backend": "cpu"})
        self.assertEqual(runtime.run("idle")["backend"], "none")
        self.assertEqual(dispatched, [])
        self.assertEqual(runtime.run("vision-conv")["backend"], "qnn-htp")
        self.assertEqual(runtime.run("llm-decode")["backend"], "cpu")
        self.assertEqual(dispatched, ["vision", "llm"])
        self.assertEqual(runtime.status()["activeWorkload"], "idle")
        runtime.vision = lambda image: {"backend": "cpu"}
        with self.assertRaises(ValueError):
            runtime.run("vision-conv")
        self.assertFalse(runtime.lock.locked())
        runtime.acquire("vision-conv")
        with self.assertRaises(BusyError):
            runtime.run("idle")
        runtime.release()

    def test_upstream_is_loopback_only(self):
        self.assertEqual(upstream_address("http://127.0.0.1:8088"), ("127.0.0.1", 8088))
        for value in ("http://192.168.1.7:8088", "http://user:secret@localhost", "http://localhost/path", "http://localhost?query=1"):
            with self.assertRaises(ValueError):
                upstream_address(value)

    def test_http_workload_guardrails_and_static_file_boundary(self):
        runtime = WorkloadRuntime(lambda image: {"backend": "qnn-htp", "profile": {"acceleratorExecutionVerified": True}}, lambda: {"backend": "cpu"})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "web"
            root.mkdir()
            (root / "index.html").write_text("runtime fixture")
            (Path(directory) / "outside.txt").write_text("private")
            (root / "escape.txt").symlink_to(Path(directory) / "outside.txt")
            server = create_server(runtime, "http://127.0.0.1:1", 0, root)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            def request(path, body=None, headers=None):
                connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                connection.request("POST" if body is not None else "GET", path, body, headers or {})
                response = connection.getresponse()
                result = response.status, response.read()
                connection.close()
                return result
            try:
                self.assertEqual(request("/")[0], 200)
                self.assertEqual(request("/escape.txt")[0], 404)
                self.assertEqual(request("/api/runtime/status", headers={"Origin": "https://example.com"})[0], 403)
                self.assertEqual(request("/api/runtime/status", headers={"Host": "example.com"})[0], 403)
                self.assertEqual(request("/api/runtime/models?provider=ollama")[0], 400)
                body = json.dumps({"provider": "qcs6490", "workload": "idle"})
                self.assertEqual(request("/api/runtime/run", body)[0], 415)
                headers = {"X-Hexagon-Request": "1", "Content-Type": "application/json"}
                status, payload = request("/api/runtime/run", body, headers)
                self.assertEqual(status, 200)
                self.assertFalse(json.loads(payload)["inferenceRequested"])
                self.assertEqual(runtime.dispatched, 0)
                self.assertEqual(request("/api/runtime/run", " " * 1025, headers)[0], 400)
                runtime.acquire("llm-decode")
                self.assertEqual(request("/api/runtime/run", body, headers)[0], 409)
                runtime.release()
            finally:
                server.shutdown()
                server.server_close()
                worker.join()

    def test_reference_requires_full_vector_similarity_and_same_top_prediction(self):
        reference = [0.2] * 1000
        reference[17] = 10.0
        self.assertTrue(compare_scores(reference, reference)["top1Matches"])
        for invalid in ([0.0] * 1000, [float("nan")] * 1000, reference[:-1]):
            with self.assertRaises(ValueError):
                compare_scores(reference, invalid)
        changed = list(reference)
        changed[18] = 10.1
        with self.assertRaises(ValueError):
            compare_scores(reference, changed)

    def test_vision_requires_real_convolution_and_accelerator_events(self):
        profile = vision_profile(events())
        self.assertEqual(profile["executionMs"], 2.0)
        self.assertTrue(profile["acceleratorExecutionVerified"])
        with self.assertRaises(ValueError):
            vision_profile(events()[:-1])
        with self.assertRaises(ValueError):
            vision_profile(events() + [events()[0]])
        rows = events()
        rows[-1]["Time"] = "nan"
        with self.assertRaises(ValueError):
            vision_profile(rows)

    def test_zero_or_adjacent_activation_entries_do_not_prove_convolution(self):
        rows = events()
        rows[-1]["Time"] = "0"
        with self.assertRaises(ValueError):
            vision_profile(rows)
        rows.append(events()[-1])
        profile = vision_profile(rows)
        self.assertEqual(profile["zeroDurationConvolutionEntries"], 1)
        self.assertEqual(len(profile["convolutionOperators"]), 1)
        rows = events()
        rows[-1]["Event Identifier"] = "/net/features/1/conv/2/Clip:OpId_47 (cycles)"
        with self.assertRaises(ValueError):
            vision_profile(rows)

    def test_scores_require_complete_finite_output(self):
        labels = [str(index) for index in range(1000)]
        scores = array("f", [0.0] * 1000)
        scores[17] = 12.0
        if sys.byteorder != "little":
            scores.byteswap()
        logits, top = decode_scores(scores.tobytes(), labels)
        self.assertEqual(top[0]["index"], 17)
        self.assertGreater(top[0]["probability"], 0.99)
        self.assertTrue(all(math.isfinite(value) for value in logits))
        with self.assertRaises(ValueError):
            decode_scores(scores.tobytes()[:-1], labels)
        with self.assertRaises(ValueError):
            decode_scores(bytes(4000), labels)


if __name__ == "__main__":
    unittest.main()
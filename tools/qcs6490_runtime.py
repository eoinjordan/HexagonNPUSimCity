import argparse
from array import array
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import mimetypes
from pathlib import Path
import os
import re
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit

from qnn_validate import execute, fingerprint, read_profile

WORKLOADS = {
    "vision-conv": {"model": "MobileNet-v2 W8A16", "backend": "qnn-htp"},
    "llm-decode": {"model": "oddessy-vlm", "backend": "cpu"},
    "idle": {"model": "No inference", "backend": "none"},
}
PROXY_GET_PATHS = {"/health", "/props", "/metrics", "/slots", "/v1/models"}
PROXY_POST_PATHS = {"/v1/chat/completions", "/v1/completions", "/completion", "/tokenize", "/detokenize"}


class BusyError(RuntimeError):
    pass


def upstream_address(value: str) -> tuple[str, int]:
    parsed = urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment):
        raise ValueError("LLM upstream must be a loopback HTTP origin without credentials or paths")
    return parsed.hostname, parsed.port or 80


def run_llm(upstream: str, model: str) -> dict:
    host, port = upstream_address(upstream)
    connection = HTTPConnection(host, port, timeout=120)
    payload = {"model": model, "prompt": "Explain matrix multiplication in one short sentence.",
               "stream": False, "n_predict": 32, "temperature": 0, "cache_prompt": False}
    started = time.monotonic()
    try:
        connection.request("POST", "/completion", json.dumps(payload), {"Content-Type": "application/json"})
        response = connection.getresponse()
        encoded = response.read(1024 * 1024 + 1)
        if response.status != 200 or len(encoded) > 1024 * 1024:
            raise RuntimeError(f"LLM upstream returned an invalid response (HTTP {response.status})")
        result = json.loads(encoded)
    finally:
        connection.close()
    elapsed = (time.monotonic() - started) * 1000
    text = result.get("content")
    timings = result.get("timings", {})
    tokens = timings.get("predicted_n")
    duration = timings.get("predicted_ms")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("LLM did not generate text")
    if (type(tokens) is not int or tokens <= 0 or tokens > 32 or type(duration) not in {float, int}
            or not math.isfinite(duration) or duration <= 0):
        raise ValueError("LLM did not report valid generation timings")
    return {"source": "qcs6490", "workload": "llm-decode", "model": model, "backend": "cpu",
            "elapsedMs": elapsed, "generatedTokens": tokens, "generationMs": duration,
            "tokensPerSecond": tokens * 1000 / duration, "response": text,
            "acceleratorExecutionVerified": False,
            "scope": "CPU-only llama.cpp worker; generation timings exclude prompt processing. No NPU LLM claim."}


class WorkloadRuntime:
    def __init__(self, vision, llm, model: str = "oddessy-vlm"):
        self.vision = vision
        self.llm = llm
        self.model = model
        self.lock = threading.Lock()
        self.active = "idle"
        self.dispatched = 0
        self.last = None

    def status(self) -> dict:
        return {"source": "qcs6490", "activeWorkload": self.active,
                "busy": self.lock.locked(), "inferenceRequestsDispatched": self.dispatched,
                "npuUtilization": None, "powerWatts": None,
                "scope": "Gateway activity only; other board services may run independently."}

    def acquire(self, workload: str) -> None:
        if not self.lock.acquire(blocking=False):
            raise BusyError("A workload is already running; no concurrent inference is queued")
        self.active = workload

    def release(self) -> None:
        self.active = "idle"
        self.lock.release()

    def run(self, workload: str, image: Path | None = None) -> dict:
        if workload not in WORKLOADS:
            raise ValueError("Unknown workload")
        self.acquire(workload)
        try:
            if workload == "idle":
                result = {**self.status(), "workload": "idle", "backend": "none", "model": "No inference",
                          "busy": False, "inferenceRequested": False, "tokensPerSecond": None,
                          "scope": "No inference dispatched by this request. Not a measurement of global NPU idle or zero power."}
            else:
                self.dispatched += 1
                result = self.vision(image) if workload == "vision-conv" else self.llm()
                result = {key: value for key, value in result.items() if key != "logits"}
                if workload == "vision-conv" and (result.get("backend") != "qnn-htp"
                        or result.get("profile", {}).get("acceleratorExecutionVerified") is not True):
                    raise ValueError("Vision worker did not provide HTP execution evidence")
            result["source"] = "qcs6490"
            self.last = result
            return result
        finally:
            self.release()


def create_server(runtime: WorkloadRuntime, upstream: str, port: int,
                  web_root: Path | None = None, upload_root: Path | None = None) -> ThreadingHTTPServer:
    upstream_host, upstream_port = upstream_address(upstream)
    root = web_root.resolve() if web_root else None

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_arguments):
            pass

        def respond(self, status: int, payload: dict) -> None:
            encoded = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            self.wfile.write(encoded)

        def trusted_request(self) -> bool:
            listening_port = self.server.server_address[1]
            hosts = {f"127.0.0.1:{listening_port}", f"localhost:{listening_port}", f"[::1]:{listening_port}"}
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            if host not in hosts or (origin is not None and origin != f"http://{host}"):
                self.respond(403, {"error": "Host or Origin rejected"})
                return False
            return True

        def read_body(self, limit: int) -> bytes:
            if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) > 1:
                raise ValueError("Ambiguous request framing")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= limit:
                raise ValueError("Request body is missing or exceeds the limit")
            self.connection.settimeout(15)
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Incomplete request body")
            return body

        def proxy(self, body: bytes | None = None) -> None:
            generation = self.command == "POST" and urlsplit(self.path).path in {"/completion", "/v1/completions", "/v1/chat/completions"}
            if generation:
                runtime.acquire("llm-decode")
                runtime.dispatched += 1
            connection = HTTPConnection(upstream_host, upstream_port, timeout=120)
            sent = False
            try:
                headers = {name: self.headers[name] for name in ("Content-Type", "Authorization", "Accept") if name in self.headers}
                connection.request(self.command, self.path, body, headers)
                response = connection.getresponse()
                self.send_response(response.status)
                self.send_header("Content-Type", response.getheader("Content-Type", "application/json"))
                self.send_header("X-Hexagon-Backend", "cpu")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.end_headers()
                sent = True
                self.close_connection = True
                while chunk := response.read1(64 * 1024):
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except OSError:
                if not sent:
                    self.respond(502, {"error": "CPU LLM worker unavailable"})
            finally:
                connection.close()
                if generation:
                    runtime.release()

        def do_GET(self) -> None:
            if not self.trusted_request():
                return
            path = urlsplit(self.path).path
            if path in {"/api/runtime/status", "/healthz"}:
                self.respond(200, runtime.status())
            elif path == "/api/runtime/models":
                if parse_qs(urlsplit(self.path).query).get("provider", ["qcs6490"]) != ["qcs6490"]:
                    self.respond(400, {"error": "This gateway provides qcs6490 workloads only"})
                    return
                workloads = [{"id": identity, **description} for identity, description in WORKLOADS.items()]
                workloads[1]["model"] = runtime.model
                self.respond(200, {"models": [entry["model"] for entry in workloads], "workloads": workloads})
            elif path in PROXY_GET_PATHS:
                self.proxy()
            elif root is not None and not path.startswith("/api/"):
                candidate = (root / unquote(path).lstrip("/")).resolve()
                if candidate == root:
                    candidate = root / "index.html"
                if not candidate.is_relative_to(root) or not candidate.is_file():
                    self.respond(404, {"error": "Not found"})
                    return
                encoded = candidate.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")
                self.send_header("Content-Length", str(len(encoded)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
                self.end_headers()
                self.wfile.write(encoded)
            else:
                self.respond(404, {"error": "Not found"})

        def do_POST(self) -> None:
            if not self.trusted_request():
                return
            path = urlsplit(self.path).path
            try:
                if path in PROXY_POST_PATHS:
                    self.proxy(self.read_body(32 * 1024 * 1024))
                    return
                if path not in {"/api/runtime/run", "/api/runtime/vision"}:
                    self.respond(404, {"error": "Not found"})
                    return
                if self.headers.get("X-Hexagon-Request") != "1":
                    self.respond(415, {"error": "Explicit workload request required"})
                    return
                content_type = self.headers.get("Content-Type", "").split(";", 1)[0]
                if path == "/api/runtime/vision":
                    if content_type not in {"image/jpeg", "image/png"}:
                        raise ValueError("Only PNG or JPEG images are accepted")
                    image_data = self.read_body(8 * 1024 * 1024)
                    with tempfile.TemporaryDirectory(prefix="upload-", dir=upload_root) as directory:
                        image = Path(directory) / "input-image"
                        image.write_bytes(image_data)
                        result = runtime.run("vision-conv", image)
                else:
                    if content_type != "application/json":
                        self.respond(415, {"error": "JSON request required"})
                        return
                    data = json.loads(self.read_body(1024))
                    if not isinstance(data, dict) or data.get("provider") != "qcs6490" or not isinstance(data.get("workload"), str):
                        raise ValueError("Expected provider qcs6490 and an explicit workload")
                    result = runtime.run(data["workload"])
                self.respond(200, result)
            except BusyError as error:
                self.respond(409, {"error": str(error)})
            except (ValueError, TypeError) as error:
                self.respond(400, {"error": str(error)[:240]})
            except Exception:
                self.respond(502, {"error": "Workload failed; inspect the retained board diagnostics"})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)

def image_input(path: Path) -> bytes:
    from PIL import Image, ImageOps

    with Image.open(path) as source:
        if source.width * source.height > 16_000_000:
            raise ValueError("Image exceeds the 16-megapixel limit")
        image = ImageOps.exif_transpose(source).convert("RGB")
        if min(image.size) < 1:
            raise ValueError("Empty image")
        width, height = image.size
        if width <= height:
            size = (256, int(height * 256 / width))
        else:
            size = (int(width * 256 / height), 256)
        image = image.resize(size, Image.Resampling.BILINEAR)
        left = round((image.width - 224) / 2)
        top = round((image.height - 224) / 2)
        image = image.crop((left, top, left + 224, top + 224))
        pixels = array("f", (value / 255.0 for value in image.tobytes()))
        if sys.byteorder != "little":
            pixels.byteswap()
        return pixels.tobytes()


def vision_profile(rows: list[dict[str, str]]) -> dict:
    measurements = {}
    convolutions = []
    zero_convolutions = 0
    wanted = {
        ("QNN (execute) time", "US"): "executionMs",
        ("Accelerator (execute) time", "US"): "acceleratorMicroseconds",
        ("Accelerator (execute) time (cycles)", "CYCLES"): "acceleratorCycles",
    }
    for row in rows:
        if row["Message"] != "EXECUTE" or row["Timing Source"] != "BACKEND":
            continue
        identifier = row["Event Identifier"]
        key = wanted.get((identifier, row["Unit of Measurement"]))
        convolution = bool(re.search(r"(?:^|/)Conv[^/:]*:OpId_\d+ \(cycles\)$", identifier, re.IGNORECASE)) and row["Event Level"] == "SUB-EVENT" and row["Unit of Measurement"] == "CYCLES"
        if key is None and not convolution:
            continue
        value = float(row["Time"])
        if not math.isfinite(value) or value < 0 or (value == 0 and not convolution):
            raise ValueError("Profile has a non-positive or invalid execution measurement")
        if convolution:
            if value > 0:
                convolutions.append({"operator": identifier, "cycles": value})
            else:
                zero_convolutions += 1
        elif row["Event Level"] == "ROOT":
            if key in measurements:
                raise ValueError("Expected one vision execution, not duplicate profile events")
            measurements[key] = value / 1000 if key == "executionMs" else value
    if set(measurements) != set(wanted.values()) or not convolutions:
        raise ValueError("Missing positive HTP execution and convolution evidence")
    return {**measurements, "convolutionOperators": convolutions, "zeroDurationConvolutionEntries": zero_convolutions, "acceleratorExecutionVerified": True}


def decode_scores(payload: bytes, labels: list[str]) -> tuple[list[float], list[dict]]:
    if len(payload) != 1000 * 4 or len(labels) != 1000:
        raise ValueError("Expected exactly 1000 float32 outputs and ImageNet labels")
    scores = array("f")
    scores.frombytes(payload)
    if sys.byteorder != "little":
        scores.byteswap()
    if not all(math.isfinite(value) for value in scores) or max(scores) == min(scores):
        raise ValueError("Vision output contains invalid or constant logits")
    weights = [math.exp(value - max(scores)) for value in scores]
    total = sum(weights)
    top = sorted(range(1000), key=lambda index: scores[index], reverse=True)[:5]
    return list(scores), [{"index": index, "label": labels[index], "probability": weights[index] / total} for index in top]


def compare_scores(actual: list[float], reference: list[float]) -> dict:
    if len(actual) != 1000 or len(reference) != 1000:
        raise ValueError("Reference comparison requires 1000 logits")
    if not all(math.isfinite(value) for value in actual + reference):
        raise ValueError("Reference comparison contains non-finite logits")
    actual_power = sum(value * value for value in actual)
    reference_power = sum(value * value for value in reference)
    if actual_power <= 0 or reference_power <= 0:
        raise ValueError("Reference comparison has zero energy")
    similarity = sum(first * second for first, second in zip(actual, reference)) / math.sqrt(actual_power * reference_power)
    actual_top = max(range(1000), key=lambda index: actual[index])
    reference_top = max(range(1000), key=lambda index: reference[index])
    if similarity < 0.98 or actual_top != reference_top:
        raise ValueError(f"Vision reference mismatch: cosine={similarity}, top1={actual_top}/{reference_top}")
    return {
        "status": "pass", "comparedLogits": 1000, "cosineSimilarity": similarity,
        "minimumCosineSimilarity": 0.98, "top1Matches": True, "top1Index": actual_top,
        "rootMeanSquareError": math.sqrt(sum((first - second) ** 2 for first, second in zip(actual, reference)) / 1000),
        "maxAbsoluteError": max(abs(first - second) for first, second in zip(actual, reference)),
        "reference": "SNPE CPU, identical quantized DLC", "scope": "Single-image numerical smoke check, not dataset accuracy",
    }


def run_vision(sdk: Path, model: Path, image: Path, labels_path: Path, artifacts_root: Path,
               reference_dlc: Path | None = None) -> dict:
    libraries = sdk / "lib" / "aarch64-ubuntu-gcc9.4"
    binaries = sdk / "bin" / "aarch64-ubuntu-gcc9.4"
    backend = libraries / "libQnnHtp.so"
    net_run = binaries / "qnn-net-run"
    viewer = binaries / "qnn-profile-viewer"
    for required in (model, image, labels_path, backend, net_run, viewer):
        if not required.is_file():
            raise ValueError(f"Required file is missing: {required}")
    if Path("/sys/devices/soc0/machine").read_text().strip() != "QCS6490":
        raise ValueError("This validated configuration requires QCS6490")
    artifacts_root.mkdir(parents=True, exist_ok=True)
    artifacts = Path(tempfile.mkdtemp(prefix="vision-", dir=artifacts_root))
    input_path = artifacts / "input.raw"
    input_path.write_bytes(image_input(image))
    input_list = artifacts / "inputs.txt"
    input_list.write_text(str(input_path) + "\n")
    output_dir = artifacts / "output"
    environment = dict(os.environ)
    environment.update({"LD_LIBRARY_PATH": str(libraries), "ADSP_LIBRARY_PATH": str(sdk / "lib/hexagon-v68/unsigned")})
    started = time.monotonic()
    execute([str(net_run), "--backend", str(backend), "--retrieve_context", str(model),
             "--input_list", str(input_list), "--output_dir", str(output_dir),
             "--shared_buffer", "--profiling_level", "detailed", "--num_inferences", "1"],
            environment, artifacts / "execute.log")
    elapsed = (time.monotonic() - started) * 1000
    outputs = list((output_dir / "Result_0").glob("*.raw"))
    profiles = list(output_dir.glob("qnn-profiling-data_*.log"))
    if len(outputs) != 1 or len(profiles) != 1:
        raise ValueError("Missing or ambiguous vision outputs/profile")
    labels = labels_path.read_text().splitlines()
    scores, top = decode_scores(outputs[0].read_bytes(), labels)
    csv_path = artifacts / "profile.csv"
    execute([str(viewer), "--input_log", str(profiles[0]), "--output", str(csv_path)], environment, artifacts / "profile.txt")
    evidence = vision_profile(read_profile(csv_path))
    report = {
        "kind": "qcs6490-vision-inference", "workload": "vision-conv", "backend": "qnn-htp",
        "model": "MobileNet-v2 W8A16", "cpuFallback": False, "elapsedMs": elapsed,
        "top5": top, "logits": scores, "profile": evidence, "artifacts": str(artifacts),
        "sha256": {"context": fingerprint(model), "image": fingerprint(image), "input": fingerprint(input_path)},
        "scope": "Image classification; CPU preprocessing/postprocessing, HTP graph execution. Not a VLM, dataset accuracy result, or utilization/power measurement.",
    }
    if reference_dlc is not None:
        reference_output = artifacts / "cpu-reference"
        execute([str(binaries / "snpe-net-run"), "--container", str(reference_dlc),
                 "--input_list", str(input_list), "--output_dir", str(reference_output)],
                environment, artifacts / "reference.log")
        reference_files = list(reference_output.rglob("*.raw"))
        if len(reference_files) != 1:
            raise ValueError("Missing or ambiguous CPU reference output")
        reference_scores, _ = decode_scores(reference_files[0].read_bytes(), labels)
        report["referenceComparison"] = compare_scores(scores, reference_scores)
        report["sha256"]["referenceDlc"] = fingerprint(reference_dlc)
    report["sha256"]["labels"] = fingerprint(labels_path)
    (artifacts / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Run QCS6490 NPU vision, CPU language, or idle workloads.")
    parser.add_argument("--sdk-root", type=Path, required=True)
    parser.add_argument("--vision-context", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--reference-dlc", type=Path)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=8092)
    parser.add_argument("--llm-url", default="http://127.0.0.1:8088")
    parser.add_argument("--llm-model", default="oddessy-vlm")
    parser.add_argument("--web-root", type=Path)
    arguments = parser.parse_args()
    if arguments.serve:
        if not 1024 <= arguments.port <= 65535:
            parser.error("Port must be between 1024 and 65535")
        arguments.artifacts.mkdir(parents=True, exist_ok=True)
        runtime = WorkloadRuntime(
            lambda image: run_vision(arguments.sdk_root.resolve(), arguments.vision_context.resolve(),
                                     (image or arguments.image).resolve(), arguments.labels.resolve(), arguments.artifacts.resolve()),
            lambda: run_llm(arguments.llm_url, arguments.llm_model), arguments.llm_model)
        server = create_server(runtime, arguments.llm_url, arguments.port, arguments.web_root, arguments.artifacts)
        print(f"QCS6490 runtime: http://127.0.0.1:{server.server_port}/?runtime=qcs6490", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return 0
    report = run_vision(arguments.sdk_root.resolve(), arguments.vision_context.resolve(),
                        arguments.image.resolve(), arguments.labels.resolve(), arguments.artifacts.resolve(),
                        arguments.reference_dlc.resolve() if arguments.reference_dlc else None)
    print(json.dumps({key: value for key, value in report.items() if key != "logits"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
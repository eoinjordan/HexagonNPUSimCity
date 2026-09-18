import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import tempfile
from datetime import datetime, timezone

WIDTH = 64
BATCH = 32
FIXTURES = 8
RUNS = 32
WARMUPS = 8


def fixture_input(fixture: int) -> bytes:
    return bytes(128 + 8 * ((index + fixture) % 8 - 4) for index in range(BATCH * WIDTH))


def fixture_output(fixture: int) -> bytes:
    activation = fixture_input(fixture)
    result = bytearray()
    for row in range(BATCH):
        for column in range(WIDTH):
            total = sum(
                (activation[row * WIDTH + inner] - 128)
                * ((inner * 17 + column * 13) % 5 - 2)
                for inner in range(WIDTH)
            )
            if total % 8:
                raise ValueError("Fixture requires an unspecified rounding rule")
            result.append(max(0, min(255, 128 + total // 8)))
    return bytes(result)


def verify_outputs(output_dir: Path, runs: int = RUNS) -> int:
    expected = [fixture_output(fixture) for fixture in range(FIXTURES)]
    results = list(output_dir.glob("Result_*/output_native.raw"))
    if len(results) != runs:
        raise ValueError(f"Expected {runs} outputs, found {len(results)}")
    for index in range(runs):
        actual = (output_dir / f"Result_{index}" / "output_native.raw").read_bytes()
        if actual != expected[index % FIXTURES]:
            raise ValueError(f"Incorrect output at inference {index}")
    return runs * BATCH * WIDTH


def read_profile(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        rows = csv.reader(handle, skipinitialspace=True)
        header = next((row for row in rows if row and row[0].strip() == "Msg Timestamp"), None)
        if header is None:
            raise ValueError("Vendor profile CSV header not found")
        header = [field.strip() for field in header]
        required = {"Message", "Time", "Unit of Measurement", "Timing Source", "Event Level", "Event Identifier"}
        if not required.issubset(header):
            raise ValueError("Vendor profile CSV fields are missing")
        result = []
        for row in rows:
            if not row:
                continue
            if len(row) != len(header):
                raise ValueError("Malformed vendor profile CSV row")
            result.append(dict(zip(header, (field.strip() for field in row))))
        return result


def summarize_profile(rows: list[dict[str, str]], runs: int = RUNS, warmups: int = WARMUPS) -> dict:
    if not 0 <= warmups < runs:
        raise ValueError("Invalid measured-run count")
    host_times = []
    accelerator_times = []
    accelerator_cycles = []
    matmul_cycles = []
    for row in rows:
        if row["Message"] != "EXECUTE" or row["Timing Source"] != "BACKEND":
            continue
        identifier = row["Event Identifier"]
        unit = row["Unit of Measurement"]
        level = row["Event Level"]
        destination = None
        if identifier == "QNN (execute) time" and unit == "US" and level == "ROOT":
            destination = host_times
        elif identifier == "Accelerator (execute) time" and unit == "US" and level == "ROOT":
            destination = accelerator_times
        elif identifier == "Accelerator (execute) time (cycles)" and unit == "CYCLES" and level == "ROOT":
            destination = accelerator_cycles
        elif identifier.startswith("dense_matmul:") and unit == "CYCLES" and level == "SUB-EVENT":
            destination = matmul_cycles
        if destination is not None:
            value = float(row["Time"])
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"Invalid execution measurement: {identifier}")
            destination.append(value)
    for values in (host_times, accelerator_times, accelerator_cycles, matmul_cycles):
        if len(values) != runs:
            raise ValueError(f"Expected {runs} execution-profile events, found {len(values)}")
    samples = [value / 1000 for value in host_times[warmups:]]
    return {
        "samplesMs": samples,
        "meanMs": statistics.mean(samples),
        "medianMs": statistics.median(samples),
        "minMs": min(samples),
        "maxMs": max(samples),
        "acceleratorExecutionVerified": True,
        "profileEvidence": {
            "acceleratorMicroseconds": accelerator_times,
            "acceleratorCycles": accelerator_cycles,
            "matmulCycles": matmul_cycles,
        },
    }


def fingerprint(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def execute(arguments: list[str], environment: dict[str, str], log: Path) -> None:
    with log.open("w") as output:
        subprocess.run(arguments, env=environment, stdout=output, stderr=subprocess.STDOUT, check=True, timeout=120)


def validate(sdk: Path, exporter: Path, artifacts: Path) -> dict:
    libraries = sdk / "lib" / "aarch64-ubuntu-gcc9.4"
    binaries = sdk / "bin" / "aarch64-ubuntu-gcc9.4"
    backend = libraries / "libQnnHtp.so"
    net_run = binaries / "qnn-net-run"
    profiler = binaries / "qnn-profile-viewer"
    for required in (backend, net_run, profiler, exporter):
        if not required.is_file():
            raise ValueError(f"Required file is missing: {required}")
    environment = dict(os.environ)
    environment.update({
        "QNN_LIB_PATH": str(libraries),
        "LD_LIBRARY_PATH": str(libraries),
        "ADSP_LIBRARY_PATH": str(sdk / "lib" / "hexagon-v68" / "unsigned"),
    })
    manifest_path = artifacts / "graph.json"
    execute([str(exporter), str(manifest_path), "--export-context"], environment, artifacts / "export.log")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("status") != "exported" or manifest.get("backendId") != 6 or manifest.get("soc") != "QCS6490":
        raise ValueError("The exporter did not select QNN HTP on QCS6490")
    if len(manifest["fixtures"]) != FIXTURES:
        raise ValueError("Missing exported fixtures")
    for index, fixture in enumerate(manifest["fixtures"]):
        if Path(fixture["input"]).read_bytes() != fixture_input(index):
            raise ValueError("Exported stimulus disagrees with the independent fixture")
        if Path(fixture["expected"]).read_bytes() != fixture_output(index):
            raise ValueError("Exported oracle disagrees with the independent calculation")
    output_dir = artifacts / "outputs"
    execute([
        str(net_run), "--backend", str(backend), "--retrieve_context", manifest["context"],
        "--input_list", manifest["inputList"], "--output_dir", str(output_dir),
        "--use_native_input_files", "--use_native_output_files", "--shared_buffer",
        "--profiling_level", "detailed", "--num_inferences", str(RUNS), "--keep_num_outputs", str(RUNS),
    ], environment, artifacts / "execute.log")
    checked_values = verify_outputs(output_dir)
    profiles = sorted(output_dir.glob("qnn-profiling-data_*.log"), key=lambda path: int(path.stem.rsplit("_", 1)[1]))
    if not profiles:
        raise ValueError("No vendor hardware profile was produced")
    rows = []
    for index, profile in enumerate(profiles):
        csv_path = artifacts / f"profile-{index}.csv"
        execute([str(profiler), "--input_log", str(profile), "--output", str(csv_path)],
                environment, artifacts / f"profile-{index}.txt")
        rows.extend(read_profile(csv_path))
    result = summarize_profile(rows)
    result.update({
        "model": manifest["model"], "soc": manifest["soc"], "coreApiVersion": manifest["coreApiVersion"],
        "runtime": f"Qualcomm QAIRT {sdk.name} / qnn-net-run", "backendId": manifest["backendId"],
        "checkedValues": checked_values, "verified": True, "status": "pass", "backend": "qnn-htp",
        "cpuFallback": False, "tokensPerSecond": None,
        "method": {
            "fixtures": FIXTURES, "executions": RUNS, "discardedWarmups": WARMUPS,
            "measuredRuns": RUNS - WARMUPS, "profiling": "detailed on every execution",
            "timingScope": "QNN host graph-execution duration including RPC and profiling overhead; excludes context loading and tensor file I/O",
            "quantization": "UINT8 affine, scale 0.125, zero point 128 for inputs, weights and outputs",
        },
        "sha256": {"exporter": fingerprint(exporter), "backend": fingerprint(backend),
                   "netRun": fingerprint(net_run), "context": fingerprint(Path(manifest["context"]))},
    })
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a fixed quantized graph on QCS6490 using the vendor QNN HTP runner.")
    parser.add_argument("--sdk-root", type=Path, required=True)
    parser.add_argument("--exporter", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    arguments = parser.parse_args()
    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    artifacts = Path(tempfile.mkdtemp(prefix="run-", dir=arguments.output_dir.resolve()))
    report = {
        "kind": "qnn-htp-arithmetic-validation", "status": "fail", "verified": False,
        "checkedAt": datetime.now(timezone.utc).isoformat(), "artifacts": str(artifacts),
        "scope": "Fixed quantized arithmetic, not LLM inference, task accuracy, peak TOPS, HMX-only attribution, utilization or power.",
    }
    try:
        report.update(validate(arguments.sdk_root.resolve(), arguments.exporter.resolve(), artifacts))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        report["error"] = str(error)
    serialized = json.dumps(report, indent=2) + "\n"
    (artifacts / "report.json").write_text(serialized)
    with tempfile.NamedTemporaryFile("w", dir=arguments.output_dir, delete=False) as output:
        output.write(serialized)
        temporary = Path(output.name)
    temporary.replace(arguments.output_dir / "report.json")
    print(serialized, end="")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
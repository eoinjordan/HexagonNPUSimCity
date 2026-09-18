#!/usr/bin/env python3
"""Run llama-bench once per quantization and publish the results as JSON.

App Lab runs application Python inside a container that bind-mounts only the app
directory, so this host-side script writes its output into that directory rather
than exposing a port. The App reads the file and streams it to the browser.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HOME = Path.home()
LLAMA = HOME / "hexsim" / "llama"
MODELS = HOME / "hexsim" / "models"
DEFAULT_OUT = HOME / "ArduinoApps" / "hexagon_npu_simcity" / "data" / "sweep.json"

# Only formats the visualization knows how to map, ordered coarse -> fine so the
# city walks from the most aggressive quantization up to full half precision.
QUANT_ORDER = ["Q4_0", "Q4_K_M", "Q5_K_M", "Q8_0", "F16"]

# Present on boards whose Hexagon has a compute DSP hosting an HTP (Dragonwing
# IQ-class parts such as the VENTUNO Q). Absent on the UNO Q's QRB2210, which
# exposes only /dev/fastrpc-adsp.
HEXAGON_NODE = Path("/dev/fastrpc-cdsp")


def hexagon_available() -> bool:
    return HEXAGON_NODE.exists()


def describe_backend(rows: list[dict]) -> tuple[str, str]:
    """Report the backend llama-bench actually ran on.

    Taken from the tool's own `backends`/`devices` fields rather than inferred
    from the hardware, so a board that has an NPU but a CPU-only llama.cpp build
    is still reported as CPU.
    """
    backends = str(rows[0].get("backends", "") if rows else "").strip()
    devices = str(rows[0].get("devices", "") if rows else "").strip()
    label = backends or "CPU"
    hexagon = "htp" in label.lower() or "hexagon" in label.lower()
    device = devices if devices and devices.lower() not in {"auto", "none", ""} else label
    return ("hexagon-htp" if hexagon else "cpu"), device or "CPU"


def parse_rows(rows: list[dict]) -> tuple[float | None, float | None]:
    """Pull (prompt tok/s, generation tok/s) out of llama-bench JSON rows."""
    prompt = generation = None
    for row in rows:
        try:
            rate = float(row.get("avg_ts"))
        except (TypeError, ValueError):
            continue
        if rate <= 0:
            continue
        if int(row.get("n_prompt") or 0) > 0:
            prompt = rate
        elif int(row.get("n_gen") or 0) > 0:
            generation = rate
    return prompt, generation


def bench(model: Path, threads: int, n_prompt: int, n_gen: int, reps: int) -> list[dict]:
    env = dict(os.environ, LD_LIBRARY_PATH=str(LLAMA / "lib"))
    args = [
        str(LLAMA / "bin" / "llama-bench"),
        "-m", str(model),
        "-p", str(n_prompt),
        "-n", str(n_gen),
        "-r", str(reps),
        "-t", str(threads),
        "-o", "json",
    ]
    if hexagon_available():
        # The Hexagon backend is offload-based, so it takes -ngl like a GPU.
        env.setdefault("GGML_HEXAGON_DEVICES", "HTP0")
        args += ["-ngl", "99"]
    result = subprocess.run(
        args,
        env=env,
        capture_output=True,
        text=True,
        timeout=900,
        check=True,
    )
    return json.loads(result.stdout)


def quant_of(path: Path) -> str | None:
    match = re.search(r"-(Q\d[_A-Za-z0-9]*|f16|bf16)\.gguf$", path.name, re.IGNORECASE)
    if not match:
        return None
    token = match.group(1).upper()
    return token if token in QUANT_ORDER else None


def sweep(threads: int, n_prompt: int, n_gen: int, reps: int) -> dict:
    by_quant = {quant_of(p): p for p in sorted(MODELS.glob("*.gguf"))}
    samples = []
    backend = device = None
    for quant in QUANT_ORDER:
        model = by_quant.get(quant)
        if model is None:
            continue
        print(f"[sweep] {quant} -> {model.name}", flush=True)
        try:
            rows = bench(model, threads, n_prompt, n_gen, reps)
            prompt, generation = parse_rows(rows)
            backend, device = describe_backend(rows)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
            print(f"[sweep] {quant} failed: {exc}", file=sys.stderr, flush=True)
            continue
        samples.append({
            "model": model.stem,
            "quantization": quant,
            "backend": backend,
            "device": device,
            "sizeBytes": model.stat().st_size,
            "promptTokensPerSecond": prompt,
            "tokensPerSecond": generation,
        })
        print(f"[sweep] {quant}: pp={prompt} tg={generation} on {backend}", flush=True)
    return {
        "generatedAt": time.time(),
        "host": os.uname().nodename,
        "threads": threads,
        "nPrompt": n_prompt,
        "nGen": n_gen,
        "samples": samples,
    }


def publish(report: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    # Write-then-rename so a reader never sees a half-written file.
    with tempfile.NamedTemporaryFile("w", dir=out.parent, delete=False) as handle:
        json.dump(report, handle, indent=2)
        tmp = Path(handle.name)
    tmp.chmod(0o644)  # NamedTemporaryFile defaults to 0600; the App container must read it.
    tmp.replace(out)
    print(f"[sweep] wrote {len(report['samples'])} samples to {out}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    parser.add_argument("--n-prompt", type=int, default=64)
    parser.add_argument("--n-gen", type=int, default=32)
    parser.add_argument("--reps", type=int, default=2)
    parser.add_argument("--loop", type=int, default=0, help="seconds between sweeps; 0 runs once")
    args = parser.parse_args()

    if not (LLAMA / "bin" / "llama-bench").exists():
        print(f"llama-bench not found under {LLAMA}; run setup-board.sh first", file=sys.stderr)
        return 1

    while True:
        publish(sweep(args.threads, args.n_prompt, args.n_gen, args.reps), args.out)
        if args.loop <= 0:
            return 0
        time.sleep(args.loop)


if __name__ == "__main__":
    raise SystemExit(main())

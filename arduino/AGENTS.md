# AGENTS.md — HexagonNPUCity Arduino connector

Guidance for humans and coding agents extending the Arduino App Lab connector in
this `arduino/` folder. Scoped to the connector; the repo‑wide guide is
[../AGENTS.md](../AGENTS.md).

## What this is

An Arduino App Lab **App** for the **Arduino UNO Q** (Qualcomm Dragonwing MPU +
STM32 MCU) that hosts the HexagonNPUSimCity web app and reflects its illustrative
telemetry on the board. Two "brains":

- **MPU (Linux/Python)** — `app/python/`: serves the sim over HTTP, runs the
  illustrative model, drives LED1/LED2, and talks to the MCU over the Bridge.
- **MCU (STM32/Arduino)** — `app/sketch/`: drives LED3 and reads the button.

`bench/` is a second, independent App: it runs a real `llama-bench` quantization
sweep and drives the *embedded* web app with the measured token rates. App Lab
runs one App at a time, so the two never run together.

## Ground rules

- **Illustrative only.** Never present figures as measured NPU counters. Keep
  `hexagon_model.py` in sync with `src/sim/model.ts` and `docs/verification.md`.
  FP16 is *reduced precision*, not integer quantization — keep `QUANTIZED` honest.
- **Never claim an NPU ran the work.** Dragonwing IQ-class boards (e.g. VENTUNO Q,
  IQ8) expose a cDSP hosting an HTP; the UNO Q's QRB2210 exposes only
  `/dev/fastrpc-adsp` and cannot load llama.cpp's Hexagon backend. `bench/` must
  keep labelling each result from the `backends` field llama-bench reports, via
  `describe_backend()` — never from hardware probing alone, since an NPU-capable
  board can still be running a CPU-only build.
- **A rate that wasn't reported stays `null`.** Never derive tokens/sec from wall
  time as a stand-in, in either `bench-sweep.py` or `src/runtime/applab.ts`.
- **Standard library only** on the Python side (plus the on‑device
  `arduino.app_utils`). If you must add a package, list it in
  `app/python/requirements.txt` — App Lab installs it with `uv`.
- **Keep the model testable off‑device.** `hexagon_model.py` and `server.py` must
  import nothing from `arduino.app_utils`. Only `main.py` may (it runs on the
  board and is not imported by tests).
- **Bridge safety.** Never call `Bridge.call()` / `Monitor.print()` inside a
  function registered with `Bridge.provide()`; use `provide_safe()` for callbacks
  that touch `digitalWrite`/globals. Keep the MCU `loop()` free of long `delay()`.

## Common changes

- **New telemetry field:** add it in `HexagonModel.snapshot()` (with a test in
  `tests/test_hexagon_model.py`); it appears in `/api/telemetry` automatically.
- **New HTTP endpoint:** add a branch in `server.py` `do_GET`/`do_POST` and a case
  in `tests/test_server_smoke.py`.
- **New LED behaviour (MPU):** map state → RGB in `main.py::_push_to_hardware`
  using the `Leds` module (`set_led1_color`/`set_led2_color`, args 0/1 per channel).
- **New MCU behaviour:** edit `sketch/sketch.ino`. Precision→colour lives in
  `PREC_RGB`; the pulse period is derived from `g_util`. Register MCU functions
  with `Bridge.provide_safe`.
- **A Brick (camera, web UI, database):** add it via the App Lab UI so it writes
  the `bricks:` entry in `app.yaml` correctly, then `import` it in `main.py`.
  Don't hand‑edit the `bricks:` list.

## Test & ship

```bash
arduino/scripts/test-local.sh     # Python model + HTTP smoke (no board)
arduino/scripts/run-local.sh      # preview the served sim locally
arduino/scripts/deploy.sh <host>  # build web, copy to board, restart via App CLI
arduino/scripts/bench-deploy.sh <user@host>   # install the measured bench App
```

CI runs `tests/` on every change to `arduino/**`
(`.github/workflows/arduino-connector.yml`); it does not gate the web app's
Pages deploy.

## Facts worth knowing

- Apps live in `/home/arduino/ArduinoApps/<AppTitle>/` on the board; login user
  is `arduino`. App title here is **HexagonNPUCity**.
- App CLI: `arduino-app-cli app {new,start,stop,restart,logs,list}`,
  `properties set default user:<name>`, `system set-name`.
- UNO Q RGB LEDs: **LED1/LED2 = MPU** (`Leds` module or `/sys/class/leds/*`),
  **LED3/LED4 = MCU** (`digitalWrite`, **active‑LOW**). `LED3_R/G/B` are predefined.
- Bridge transport: msgpack RPC over `/dev/ttyHS1` ↔ `Serial1`, 256‑byte max
  message. Don't open those interfaces directly.

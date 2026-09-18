# HexagonNPUCity — Arduino App Lab connector

An [Arduino App Lab](https://docs.arduino.cc/software/app-lab/) app that runs the
**HexagonNPUSimCity** visualization on an **Arduino UNO Q**, and mirrors the
sim's illustrative telemetry onto the board's hardware.

The UNO Q is a fitting host: it pairs a **Qualcomm Dragonwing QRB2210** MPU
(quad Cortex‑A53 + Adreno GPU, running Debian Linux) with an **STM32U585** MCU
(Cortex‑M33, Zephyr). This connector uses *both brains* — exactly the kind of
heterogeneous compute the Hexagon NPU sim is about.

> **Illustrative, not measured.** Every figure comes from the same illustrative
> model as the web app (`src/sim/model.ts`); nothing here reads real NPU
> counters. Independent educational project — not affiliated with, sponsored by,
> or endorsed by Qualcomm or Arduino. Hexagon, Snapdragon and Dragonwing are
> trademarks of Qualcomm; Arduino and UNO Q are trademarks of Arduino S.r.l.

## What it does

- **Hosts the 3D sim** over HTTP on the board (`http://<board>:7080/`), so the
  UNO Q's display — or any device on the LAN — shows the full visualization.
- **MPU RGB LEDs** (LED1/LED2): LED1 shows the current numeric **precision** as a
  colour (INT4 red · INT8 yellow · INT16 green · FP16 cyan), LED2 shows the
  **workload** (LLM decode blue · Vision magenta · Idle off).
- **MCU RGB LED** (LED3, via the Bridge): shows the precision colour and
  **pulses at a rate set by tensor‑engine utilisation** — a busier workload
  pulses faster.
- **Optional button** (D4 → GND): cycles the workload on the board, which the
  sim and LEDs reflect live.

```
        Browser / UNO Q display                 STM32U585 (MCU, Zephyr)
                 │  http                              ▲   Bridge RPC
                 ▼                                    │  (msgpack over serial)
        ┌───────────────────┐   Bridge.notify   ┌─────┴───────────────┐
        │ python/server.py  │ ────────────────► │ sketch/sketch.ino   │
        │  static + /api    │  "hexagon_state"  │  LED3 pulse + button│
        │ python/main.py    │ ◄──────────────── │  "cycle_workload"   │
        │  Leds LED1/LED2   │   Bridge.notify   └─────────────────────┘
        │ hexagon_model.py  │
        └───────────────────┘   Qualcomm QRB2210 (MPU, Debian Linux)
```

## Layout

```
arduino/
  app/                      the deployable Arduino App
    app.yaml                manifest (name, icon, exposed port)
    README.md               shown in the App Lab UI
    python/
      main.py               UNO Q entry point (App.run) — wires HTTP + LEDs + Bridge
      server.py             HTTP host + JSON telemetry/control API (stdlib only)
      hexagon_model.py      illustrative model, ported 1:1 from src/sim/model.ts
      requirements.txt      (empty — standard library only)
      web/                  the built sim (copied in at deploy time)
    sketch/
      sketch.ino            MCU: LED3 pulse + optional button, over the Bridge
      sketch.yaml           board/library config (App Lab manages this)
  bench/                    companion App: measured llama.cpp quantization sweep
    app.yaml                manifest (web_ui brick, port 7000)
    python/main.py          reads the sweep and streams it over WebSocket
    assets/                 page that embeds the live sim and relays samples
    data/sweep.json         written by the host-side sweep (not in git)
  tests/                    Python model + HTTP smoke + sweep tests (no board needed)
  scripts/                  setup-ssh · deploy · run-local · test-local
                            bench-setup-board · bench-sweep · bench-deploy
  AGENTS.md                 how to extend this connector
```

## Try it locally (no board)

```bash
arduino/scripts/test-local.sh     # run the Python tests
arduino/scripts/run-local.sh      # serve the sim + API at http://localhost:7080/
```

The telemetry API the board exposes:

| Method + path | Purpose |
| --- | --- |
| `GET /` | the built sim |
| `GET /api/telemetry` | current illustrative state (JSON) |
| `GET /api/meta` | available precisions / workloads |
| `POST /api/control/precision` | `{"value":"INT4"}` |
| `POST /api/control/workload` | `{"value":"vision-conv"}` |
| `POST /api/control/cycle-workload` · `.../cycle-precision` | advance one step |

## Deploy to the UNO Q

The board logs in as `arduino@<host>` (default host below: `echoglow-eoin`).

```bash
# 1) One-time: keyless SSH. Prompts for the board password once — type it yourself.
arduino/scripts/setup-ssh.sh echoglow-eoin

# 2) Build the web app, copy the App to the board, and (re)start it via the App CLI.
arduino/scripts/deploy.sh echoglow-eoin
```

Then open `http://echoglow-eoin:7080/` (or the board's IP). To launch on boot:
`ssh echoglow-eoin "arduino-app-cli app restart /home/arduino/ArduinoApps/HexagonNPUCity"`
and toggle **Run at startup** in App Lab, or
`arduino-app-cli properties set default user:HexagonNPUCity`.

You can also just open the `arduino/app` folder in Arduino App Lab and press
**Run** — App Lab compiles the sketch, flashes the MCU, and starts the Python
container.

### If `echoglow-eoin` doesn't resolve

`setup-ssh.sh` adds a `Host echoglow-eoin` block to `~/.ssh/config` using
`HostName echoglow-eoin.local` (mDNS). If your board isn't on mDNS, edit that
`HostName` to the board's IP address or Tailscale name.

## Configuration

- **Port** — `HEXAGON_PORT` (default `7080`), also declared in `app.yaml` `ports`.
- **Web root** — `HEXAGON_WEB_ROOT` (defaults to `python/web`, then the repo `dist`).
- **Figures** — edit `DEFAULT_CONFIG` in
  [app/python/hexagon_model.py](app/python/hexagon_model.py); keep it in sync with
  `src/sim/model.ts` and `docs/verification.md`.

## Companion App — HexagonNPUCity Bench (measured)

`bench/` is a second App Lab App that does the opposite of `app/`: instead of
showing the illustrative model, it **measures** something real. It runs
`llama-bench` over five GGUF quantizations of one model and drives the embedded
visualization with the results, so switching format visibly changes the city
because the *measurement* changed.

> **Which board has an NPU?** The **VENTUNO Q** pairs a Qualcomm Dragonwing IQ8
> (up to 40 dense TOPS) with an STM32H5, and Dragonwing IQ-class parts expose a
> compute DSP hosting an HTP — the device llama.cpp's Hexagon backend targets.
> The **UNO Q**'s QRB2210 does not: it exposes only `/dev/fastrpc-adsp` and an
> `adsp` remoteproc, with no cDSP, no `/usr/lib/rfsa` and no QNN libraries, so
> the Hexagon backend cannot load there and llama.cpp measures its CPU.
>
> `bench-sweep.py` never assumes either way. It offloads to `HTP0` when
> `/dev/fastrpc-cdsp` exists, then labels each result from the `backends` field
> **llama-bench itself reports** — so a board that has an NPU but a CPU-only
> llama.cpp build is still reported as `cpu`.

```bash
# 1) One-time on the board: build llama.cpp and fetch the GGUFs (~700 MB).
scp arduino/scripts/bench-setup-board.sh <board>:~/ && ssh <board> ~/bench-setup-board.sh

# 2) Install the App and the sweep service, then start it.
arduino/scripts/bench-deploy.sh arduino@<board>
ssh <board> 'arduino-app-cli app start user:hexagon_npu_simcity'
```

Open `http://<board>:7000/`. App Lab runs **one App at a time**, so starting the
bench stops `HexagonNPUCity` and vice versa.

### How it reaches the visualization

App Lab runs application Python in a container that bind-mounts only the app
directory, so the sweep cannot be executed from inside it. Instead the sweep runs
on the board host and hands results over through a file; no extra port is opened.

```
host: bench-sweep.py ──► bench/data/sweep.json ──► container: python/main.py
                                                        │ WebSocket (web_ui brick)
                                                        ▼
                                              assets/app.js
                                                        │ postMessage
                                                        ▼
                          <iframe> eoinjordan.github.io/HexagonNPUSimCity/
                                          src/runtime/applab.ts
```

The embedded page accepts samples only from loopback and RFC1918 origins, and
replies `ready` to the sender's own origin — never `*`.

| Knob | Where |
| --- | --- |
| Models / quantizations swept | `QUANTS` in [scripts/bench-setup-board.sh](scripts/bench-setup-board.sh) and `QUANT_ORDER` in [scripts/bench-sweep.py](scripts/bench-sweep.py) |
| Sweep interval | `--loop` in the `hexsim-sweep` user service |
| Seconds each format is shown | `DWELL_SECONDS` in [bench/python/main.py](bench/python/main.py) |
| GGUF → simulation format map | `QUANT_PRECISION` in [../src/runtime/applab.ts](../src/runtime/applab.ts) |

## References

- Arduino App Lab — [Apps](https://docs.arduino.cc/software/app-lab/apps/about-apps/) ·
  [Bridge API](https://docs.arduino.cc/software/app-lab/bridge/bridge-api/) ·
  [App CLI](https://docs.arduino.cc/software/app-lab/cli/commands/)
- [Arduino UNO Q](https://docs.arduino.cc/hardware/uno-q/) ·
  [UNO Q user manual](https://docs.arduino.cc/tutorials/uno-q/user-manual)
- [Qualcomm Hexagon NPU](https://www.qualcomm.com/processors/hexagon) ·
  the sim's own [docs/verification.md](../docs/verification.md)

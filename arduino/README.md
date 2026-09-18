# HexagonNPUCity — Arduino App Lab connector

Two [Arduino App Lab](https://docs.arduino.cc/software/app-lab/) apps for the
**HexagonNPUSimCity** project: an **Arduino UNO Q** illustrative API/LED host
on port 7080, and a separate measured llama.cpp bench viewer on port 7000.
They are not the native Ubuntu/QCS6490 validator; see the
[dedicated NPU support guide](../docs/qcs6490-npu.md) for that verified path.

The UNO Q is a fitting host: it pairs a **Qualcomm Dragonwing QRB2210** MPU
(quad Cortex‑A53 + Adreno GPU, running Debian Linux) with an **STM32U585** MCU
(Cortex‑M33, Zephyr). This connector uses *both brains* — exactly the kind of
heterogeneous compute the Hexagon NPU sim is about.

> **Two distinct modes.** The API/LED app uses illustrative coefficients matching
> the web defaults. The bench app shows tool-reported token rates, not CPU
> utilization or NPU counters. Independent educational project — not affiliated with, sponsored by,
> or endorsed by Qualcomm or Arduino. Hexagon, Snapdragon and Dragonwing are
> trademarks of Qualcomm; Arduino and UNO Q are trademarks of Arduino S.r.l.

## What it does

- **Hosts the 3D sim** over HTTP on the board (`http://<board>:7080/`), so the
  UNO Q's display — or any device on the LAN — shows the full visualization.
- **MPU RGB LEDs** (LED1/LED2): LED1 shows the current numeric **precision** as a
  colour (INT4 red · INT8 yellow · INT16 green · FP16 cyan), LED2 shows the
  **workload** (LLM decode blue · Vision magenta · Idle off).
- **MCU RGB LED** (LED3, via the Bridge): shows the precision colour and
  **pulses at a rate set by simulated tensor-engine utilisation** — a busier workload
  pulses faster.
- **Optional button** (D4 → GND): cycles the Python model's workload and LED
  state on the board.

The Python model/API and browser simulation are currently **independent state
owners**. The browser does not poll `/api/telemetry` or send its selectors to
`/api/control/*`; hosting the web build does not synchronize those controls with
the LEDs. Use the API or MCU button to control the board-side model. The Python
model shares defaults and equations, but omits the web model's seeded jitter,
steps at 20 Hz, and initializes its base power immediately, so it is not a
bit-for-bit, frame-by-frame port. Hardware updates are sent every 0.2 seconds.

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
      hexagon_model.py      independent illustrative model with matching defaults
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
npm ci                          # from the repository root; Node >=22.18
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

Use Python 3.10+ for the connector's type syntax. The local preview builds the
web app only when `dist/index.html` is missing; run `npm run build` yourself to
refresh an existing build after frontend edits.

**Trusted LAN only:** this server listens on `0.0.0.0`, exposes unauthenticated
control endpoints, and has no runtime-proxy-style Host/Origin allowlist or
request-size limit. Keep it behind a trusted network/firewall. Its safety model
is not the same as the loopback-only service in
[the native/runtime guide](../docs/native.md).

## Deploy to the UNO Q

The board logs in as `arduino@<host>` (default host below: `echoglow-eoin`).

```bash
# 1) One-time: keyless SSH. Prompts for the board password once — type it yourself.
mkdir -p ~/.ssh
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

Deployment requires Node/npm and rsync on the development host, SSH access to
the board, and an installed Arduino App CLI. The deploy script rebuilds `dist`,
overlays Python/sketch files, replaces the deployed `python/web` directory, and
preserves an existing App Lab-managed `sketch.yaml`. It targets
`/home/arduino/ArduinoApps/HexagonNPUCity`; it is not a generic `ubuntu` user
deployment script. Local tests do not establish LED/Bridge operation on a board.

### If `echoglow-eoin` doesn't resolve

`setup-ssh.sh` adds a `Host echoglow-eoin` block to `~/.ssh/config` using
`HostName echoglow-eoin.local` (mDNS). If your board isn't on mDNS, edit that
`HostName` to the board's IP address or Tailscale name.

Pass a bare alias, not a name already ending in `.local`, because the script
appends that suffix. Existing alias blocks are left unchanged. It reuses or
creates `~/.ssh/id_ed25519_echoglow` (an unencrypted dedicated key), backs up the
SSH config before adding a new alias, and copies only the public key. Verify
the host fingerprint and protect the private key; enter passwords in the
terminal, not in logs or chat.

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
visualization's measurement readout and display precision. The animated TOPS,
power, utilization and main tokens/s meters still use the simulation model.

> **Board capability is not runtime validation.** The supplied setup script
> builds CPU llama.cpp for the UNO Q's QRB2210, whose observed BSP has no
> cDSP/HTP path for this backend. A VENTUNO Q or another NPU-capable board still
> needs a compatible runtime/kernel build and an actual checked workload.
> QCS6490's cDSP presence did not make the tested GenieX GGUF path work.
>
> `bench-sweep.py` requests `HTP0` and `-ngl 99` when `/dev/fastrpc-cdsp` exists,
> then classifies the first benchmark row's backend text. That request and label
> are not output checks or per-operator offload evidence. An HTP run must be
> independently validated before making a hardware-support claim.

```bash
# 1) One-time on the board: build llama.cpp and fetch the GGUFs (~700 MB).
scp arduino/scripts/bench-setup-board.sh <board>:~/ && ssh <board> ~/bench-setup-board.sh

# 2) Install the App and the sweep service, then start it.
arduino/scripts/bench-deploy.sh arduino@<board> ~/.ssh/id_ed25519_echoglow
ssh arduino@<board> 'arduino-app-cli app start user:hexagon_npu_simcity'
```

Open `http://<board>:7000/`. App Lab runs **one App at a time**, so starting the
bench stops `HexagonNPUCity` and vice versa.

The setup script creates `~/hexsim/venv`, builds `llama-bench` under
`~/hexsim/llama.cpp` with two build jobs, and installs binaries/libraries under
`~/hexsim/llama`. It downloads SmolLM2-135M-Instruct Q4_0, Q4_K_M, Q5_K_M, Q8_0,
and F16 GGUFs into `~/hexsim/models`. It uses current upstream/Hugging Face
branches, not pinned content hashes; record revisions and model hashes before
publishing comparisons. It does not install a QNN or direct-Hexagon backend.

`bench-deploy.sh` requires the board's WebUI example assets at
`/var/lib/arduino-app-cli/examples/inspirational/platform_unoq/color-your-leds/assets/libs`.
It copies those libraries rather than vendoring them. It installs a
`hexsim-sweep.service` **user service**, repeating the sweep every 900 seconds.
If no systemd user session is available, the script prints a warning and you
must start the sweep manually:

```sh
~/hexsim/venv/bin/python ~/hexsim/sweep.py
systemctl --user status hexsim-sweep.service
journalctl --user -u hexsim-sweep.service
systemctl --user stop hexsim-sweep.service
```

App Lab's one-app limit does not stop that separate host-side service. Stop or
disable the service explicitly when no longer needed. Default sweep settings
are 64 prompt tokens, 32 generated tokens, two repetitions and `os.cpu_count()`
threads; options are `--threads`, `--n-prompt`, `--n-gen`, `--reps`, `--out`, and
`--loop`. A missing model is skipped; a failing model is logged and skipped.
An empty/partial sweep is not a full five-format validation.

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

The embedded page accepts HTTP(S) loopback, RFC1918, `.local`, and configured
exact extra origins, and replies `ready` to the sender's own origin, never `*`.
The envelope uses channel `hexagon-npu-simcity`, version `1`, and `hello`,
`ready`, or `sample` message types. A sample includes `model`, `quantization`,
`backend`, `device`, and prompt/generation token rates; malformed labels or
unknown formats/backends are rejected and invalid rates display as unavailable.
This is a trusted-LAN integration, not authenticated hardware telemetry.

The WebUI app exposes `GET /sweep`, polls for the first report every two seconds,
and cycles reported formats every eight seconds. Its iframe points to the
published GitHub Pages build, so loading it needs access to that site and does
not automatically use local frontend edits. Q4-family formats select the INT4
display bucket, Q5/Q6/Q8 select INT8, and F16/BF16 select FP16; those buckets do
not change the model's actual format.

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

# Native Packages and Measured Runtimes

## Status and Boundaries

The current installer release is **v1.1.0**, with Debian package version
`1.1.0-1`. Use the [README download table](../README.md#v110-preview-installers)
for version-pinned assets, checksums and platform requirements. The rebuilt
web assets include the optional QCS6490 gateway panel; the installers do not
bundle or configure the board's QAIRT/model dependencies.

The web city remains illustrative. A separate **Runtime measurements** panel can
show timings from a local inference server or an explicit native arithmetic run.
Measured values never replace the city's synthetic TOPS/power/utilization values.

| Target | Implemented | Verification boundary |
| --- | --- | --- |
| Android ARM64 | Local WebView shell; CPU sample; optional QNN-enabled AAR/HTP library path | APK build and Java unit tests run locally. No phone/emulator was attached. Default APK is CPU-only, not secretly QNN-accelerated. |
| Windows ARM64 | WebView2 shell; official ONNX Runtime QNN package; WiX MSI definition | Cross-compilation and publish payload verified; shared C# workload executes on CPU in tests. MSI creation/install and QNN device execution require Windows. |
| Linux Debian package | Architecture-independent static web build, Python loopback launcher, desktop entry | CI installs/removes the package on its Ubuntu runner. This packages the visualization, not an NPU runtime. |
| QCS6490 on Ubuntu | QNN HTP matrix validation and MobileNet vision, plus a loopback workload gateway | Matrix oracle and vision reference/profile checks passed. The web Runtime panel runs NPU vision, CPU language, or no-dispatch idle; Android/Windows native hosts are separate. |
| Local runtimes | Ollama, llama.cpp, LM Studio v0 adapters; opt-in 32-token sample | Adapter contracts are unit-tested. A local Mac llama.cpp run is recorded; its timing API does not verify the hardware backend. Ollama/LM Studio hardware runs are not established by that result. |

For the board setup, complete reproduction steps, measured results, and failed
GenieX/llama.cpp alternatives, use the dedicated
[QCS6490 NPU support guide](qcs6490-npu.md). The QCS6490 result does not certify
the Android or Windows hosts, an NPU LLM, or the city's synthetic counters.

The deployed QCS6490 gateway replaces the board's model entry point on loopback
8088 and forwards language/VLM compatibility requests to the preserved CPU
worker on 8089. It serves the visualization at `/?runtime=qcs6490`, with explicit
NPU vision, CPU LLM, and idle actions. Use a same-port SSH tunnel for browser
access. See [gateway usage, model provenance and rollback](qcs6490-npu.md#multi-workload-gateway).
This Python gateway is separate from the Node `npm run runtime` proxy described
below; the Node proxy still supports only Ollama, llama.cpp and LM Studio.

## Small Native Workload

`npm run native:prepare` generates a reproducible 4,520-byte ONNX model and builds
the shared web assets. The model uses fixed UINT8 `[1,64]` input/output tensors,
scale `0.125`, zero point `128`, and a quantize/dequantize MatMul with a 64x64
identity matrix. The output oracle is therefore the input itself, including the
CPU edge cases tested at 0 and 255.

Native runners perform three warm-ups and 25 measured calls on a background
thread. Every output is checked. The reported milliseconds cover `session.run`,
not model creation, calibration or the browser animation. This tiny test is
primarily an integration/output check, not a meaningful peak-throughput or power
benchmark. Do not compare its timings to an LLM's tokens/s.

QNN runs explicitly select the HTP backend and set
`session.disable_cpu_ep_fallback=1`. Missing providers, libraries, incompatible
operators or output mismatches return errors. They do not silently retry on CPU.
The CPU action is separately labelled. Successful strict session execution is
provider evidence, not a per-engine utilization or watts measurement.

## Android

Reference and inspiration, as requested:
[Edge Impulse example-android-inferencing](https://github.com/edgeimpulse/example-android-inferencing),
especially its [QNN hardware-acceleration example](https://github.com/edgeimpulse/example-android-inferencing/tree/main/qnn-hardware-acceleration).
The local checkout was inspected as a reference; its application code and models
were not copied. It uses a TFLite QNN delegate; this shell uses ONNX Runtime QNN,
so the runtime packages are not interchangeable.

Requirements: JDK 17, Gradle 8.13, Android SDK platform 35, and an ARM64 device
with API 28+ and an up-to-date Android System WebView.

```sh
npm ci
npm run native:prepare
export ANDROID_HOME="$HOME/Library/Android/sdk"
gradle -p native/android --no-daemon --console=plain testDebugUnitTest lintDebug assembleDebug
```

The preview APK is at
`native/android/app/build/outputs/apk/debug/app-debug.apk`. It uses a debug signing
key, is for evaluation only, and contains the standard CPU ONNX Runtime AAR.

### Enable QNN

Build a QNN-enabled ONNX Runtime Android AAR against the matching QAIRT SDK using
the official [QNN build instructions](https://onnxruntime.ai/docs/build/eps.html#qnn).
The Java bindings must be compatible with the pinned 1.23.2 API. Supply the
matching Android ARM64 QNN runtime libraries, HTP stubs and DSP skeletons for the
chosen device under a directory containing `arm64-v8a/`. Follow the SDK's exact
redistribution and compatibility requirements; do not mix arbitrary SDK versions
or copy Windows DLLs/TFLite delegates into an ONNX Runtime build.

```sh
gradle -p native/android --no-daemon --console=plain \
  -PqnnAar=/absolute/path/onnxruntime-qnn.aar \
  -PqnnLibs=/absolute/path/qnn-jni-libs \
  assembleDebug
```

The app sets the DSP search path, opens `libQnnHtp.so` from its packaged native
library directory, and rejects a QNN request when that provider is absent.
Default public CI deliberately does not redistribute an arbitrary private SDK
bundle. A production QNN APK needs the correct libraries, license review,
stable signing key and physical-device test before release.

Web content is bundled locally through WebViewAssetLoader; the native message
bridge accepts only the main frame at its exact asset origin. External web
requests/navigation are blocked. The Android shell's local-server connectors are
not enabled through this restriction; use its native sample actions instead.

## Windows on Snapdragon

Requirements: Windows 11 ARM64, current Snapdragon drivers, Microsoft Edge
WebView2 Runtime, .NET SDK 10 for building, and a supported QNN HTP device such as
a compatible Snapdragon X Elite system. The app is not an x64-emulated NPU build.

```powershell
npm ci
npm run native:prepare
dotnet test native/windows/tests/Native.Tests.csproj -c Release -p:RestoreLockedMode=true
dotnet publish native/windows/HexagonNPUSimCity.csproj -c Release -r win-arm64 --self-contained true -o native/windows/publish -p:RestoreLockedMode=true
dotnet build native/windows/installer/Installer.wixproj -c Release -o release/windows
```

The MSI is `release/windows/HexagonNPUSimCity-arm64.msi`. It installs per-machine,
creates a Start Menu shortcut and supports MSI uninstall/major upgrades. It is
unsigned unless signed separately; no certificate or production key is included.
The .NET runtime is bundled; the Evergreen WebView2 Runtime is a prerequisite.
Only trusted bundled pages can send native benchmark commands.

The official [Microsoft.ML.OnnxRuntime.QNN package](https://www.nuget.org/packages/Microsoft.ML.OnnxRuntime.QNN/1.23.2)
supplies the Windows ARM64 backend. Inspect package licenses and preserve notices
before distributing it. The [QNN EP documentation](https://onnxruntime.ai/docs/execution-providers/QNN-ExecutionProvider.html)
describes fixed-shape/operator constraints, provider options and profiling.
The local Mac build does not establish Windows-on-Snapdragon hardware execution
or MSI installation. The separate Ubuntu QCS6490 test uses QAIRT directly, not
the Windows ONNX Runtime package.

## Linux Debian Package

The build creates `release/linux/HexagonNPUSimCity-all.deb` from `dist/`, using
[tools/deb.mjs](../tools/deb.mjs). Build on a machine with Node >=22.18 and
`dpkg-deb` available:

```sh
npm ci
npm run build
node tools/deb.mjs
dpkg-deb --info release/linux/HexagonNPUSimCity-all.deb
```

If `dpkg-deb` is absent, the tool only stages files under
`build/deb/hexagon-npu-simcity/` and prints a message; it has **not** produced a
package. Install the distribution's `dpkg` tooling and rerun the packaging step.

On a Debian-family target:

```sh
sudo apt install ./HexagonNPUSimCity-all.deb
hexagon-npu-simcity
```

The package is `Architecture: all` and depends on Python >=3.8, not Node. It
installs `/usr/bin/hexagon-npu-simcity`, static files under
`/usr/lib/hexagon-npu-simcity/web/`, and a desktop entry. The launcher binds only
to `127.0.0.1:8770`, opens the default browser when `xdg-open` is available, and
stops its child HTTP server when the launcher exits. Set `HEXAGON_PORT` to use
a different available port. The browser still needs WebGL2.

```sh
HEXAGON_PORT=8771 hexagon-npu-simcity
sudo apt remove hexagon-npu-simcity
```

For a headless board, leave the launcher running and access it through an SSH
forward, for example `ssh -N -L 8771:127.0.0.1:8770 ubuntu@ubuntu.local`, then
open `http://127.0.0.1:8771/` on the development machine. Do not expose its simple
static server to the public internet.

This package can serve the visualization on amd64 or arm64 systems, including
Ubuntu boards. It does not install QAIRT, an LLM, App Lab, GPU/NPU drivers, or the
QCS6490 validation tools. A portable package is not a hardware-support guarantee.

## Ollama, llama.cpp and LM Studio

Start an existing local server with a model you already have, then:

```sh
npm run build
npm run runtime
```

Open the printed `http://127.0.0.1:4318` URL. In **Runtime measurements**, select a
source, connect, choose a discovered model and explicitly run the 32-token sample.
The server does not download models, pass tools to models or forward arbitrary
prompts. A selected local model may be loaded by its server when the sample runs.

Defaults: Ollama port 11434, llama.cpp port 8080, LM Studio port 1234. Set
`OLLAMA_URL`, `LLAMACPP_URL` or `LMSTUDIO_URL` for other loopback origins. API keys
can be supplied via the corresponding `*_API_KEY` environment variable; they are
not sent to the browser or logged by this service.

| Variable | Purpose |
| --- | --- |
| `RUNTIME_PORT` | Dashboard listen port, default `4318`; allowed range `1024` to `65535` |
| `RUNTIME_ORIGIN` | One additional exact trusted browser origin, not wildcard CORS |
| `OLLAMA_URL`, `LLAMACPP_URL`, `LMSTUDIO_URL` | Loopback HTTP(S) origins; credentials, paths, queries and fragments are rejected |
| `OLLAMA_API_KEY`, `LLAMACPP_API_KEY`, `LMSTUDIO_API_KEY` | Optional upstream bearer credentials, supplied outside the browser |

The service accepts only the three known providers, model discovery, and a fixed
matrix-multiplication prompt capped at 32 tokens. It rejects concurrent workload
requests, upstream redirects, invalid Host/Origin headers, and oversized payloads.
Upstream requests have a 30-second timeout. It is not an arbitrary prompt proxy
or a remote administration endpoint.

For a remote board server, use SSH forwarding instead of relaxing the loopback
restriction. For example, forward its port 8080 to local port 8081 in a separate
terminal, then start the dashboard with that upstream:

```sh
ssh -N -L 8081:127.0.0.1:8080 ubuntu@ubuntu.local
```

```sh
LLAMACPP_URL=http://127.0.0.1:8081 npm run runtime
```

A tunnel makes a timing endpoint accessible; it does not establish NPU use.

For the Windows shell, explicitly allow its bundled origin when starting the
service: `RUNTIME_ORIGIN=https://hexagon.simcity.local npm run runtime` (use
`$env:RUNTIME_ORIGIN="https://hexagon.simcity.local"` in PowerShell). HTTPS Pages
to local HTTP requests may be blocked by the browser's local-network/mixed-content
policy; the locally served dashboard avoids that dependency. Do not open the
service to the LAN or use wildcard CORS as a workaround.

- Ollama: `eval_count / (eval_duration / 1e9)`, excluding load/prompt processing.
- llama.cpp: `timings.predicted_n / (timings.predicted_ms / 1000)`.
- LM Studio v0: completion count divided by `stats.generation_time` in seconds,
  or its reported token rate when the duration is unavailable. The adapter
  intentionally targets the documented v0 API for this response schema.
- Wall-clock request latency is labelled separately. Missing rates remain
  unavailable. These APIs do not prove QNN usage; the backend remains unverified.

References: [Ollama generate API](https://docs.ollama.com/api/generate),
[llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server),
[LM Studio v0 stats](https://lmstudio.ai/docs/developer/rest/endpoints).

### Recorded Local Llama Smoke Test

[measurements/llama-local.json](measurements/llama-local.json) records a
2026-09-17 run on an Apple M1 Pro using Qwen2.5-0.5B-Instruct Q4_K_M. It checked
server health, model discovery, nonempty generated text, one excluded dashboard
warm-up, five timing samples, and timing-unit conversion. It is not a model
accuracy test, controlled benchmark, or Qualcomm/Apple Neural Engine result.
The report's `backend` remains `unverified`; its `llamaVersion` field is empty,
so that report alone does not establish the server build version.

With an explicitly started llama.cpp server and dashboard, rerun the smoke tool
from the repository root:

```sh
LLAMACPP_URL=http://127.0.0.1:8080 \
DASHBOARD_URL=http://127.0.0.1:4318 \
LLAMA_MODEL_ALIAS=qwen2.5-0.5b-instruct-q4_k_m \
node --import tsx tools/llama-smoke.mjs
```

It overwrites `docs/measurements/llama-local.json`; review the resulting diff
before retaining a new measurement. The tool does not install a server or model,
and `llama-server` must be on `PATH` for its version query. A sample may trigger
model loading in an already-running inference server.

## Arduino Measured Connector

The two [Arduino App Lab apps](../arduino/README.md) have different purposes:
port 7080 serves illustrative telemetry and LED controls; the port-7000 bench
app displays reported llama.cpp token rates through the App Lab message bridge.
Neither automatically imports the offline QCS6490 report. The QCS6490 guide
documents the native Ubuntu path independently of App Lab.

## Automation and Release Gates

- CI runs dependency audit, typecheck, unit/integration tests, browser pixel and
  interaction tests, Android unit/lint/APK build and Windows CPU tests/ARM64 MSI
  packaging. The `verify` job also packages the Debian build, checks
  `Architecture: all`, and installs/removes it on Ubuntu. Reports and artifacts
  are retained on Actions. These workflow definitions do not themselves prove
  the latest remote run succeeded.
- Pages deploys the successful `main` CI artifact; no privileged workflow
  executes a pull request's scripts.
- A stable `vMAJOR.MINOR.PATCH` tag must match the package version and MSI limits.
  Release automation reuses CI and requires four deliverables:
  `HexagonNPUSimCity-web.zip`, `HexagonNPUSimCity-arm64-cpu-preview.apk`,
  `HexagonNPUSimCity-arm64.msi`, and `HexagonNPUSimCity-all.deb`, plus generated
  `SHA256SUMS`. A missing release is created as a draft. For an existing tag's
  release, assets are uploaded with `--clobber` without changing its publication
  status; rerunning can therefore replace assets on an already-public release.
- A manually dispatched release workflow on a branch runs packaging but skips
  the tag-only publishing job. Stable `/releases/latest/download/...` links
  require an eligible published release, not merely a pushed tag or a draft.
- Dependabot checks npm, GitHub Actions, Gradle and NuGet weekly.
- Before publishing a draft: check APK/MSI install and uninstall, signing and
  license notices, physical-device QNN execution, output verification, and CPU
  comparison. CI success alone does not certify Hexagon acceleration.
- The Python QCS6490 validator tests and physical-board execution are separate
  commands documented in [the NPU guide](qcs6490-npu.md); the current main CI
  workflow does not run them. The Arduino connector has its own path-filtered
  workflow and test command.
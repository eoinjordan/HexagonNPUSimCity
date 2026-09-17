# Native Packages and Measured Runtimes

## Status and Boundaries

The web city remains illustrative. A separate **Runtime measurements** panel can
show timings from a local inference server or an explicit native arithmetic run.
Measured values never replace the city's synthetic TOPS/power/utilization values.

| Target | Implemented | Verification boundary |
| --- | --- | --- |
| Android ARM64 | Local WebView shell; CPU sample; optional QNN-enabled AAR/HTP library path | APK build and Java unit tests run locally. No phone/emulator was attached. Default APK is CPU-only, not secretly QNN-accelerated. |
| Windows ARM64 | WebView2 shell; official ONNX Runtime QNN package; WiX MSI definition | Cross-compilation and publish payload verified; shared C# workload executes on CPU in tests. MSI creation/install and QNN device execution require Windows. |
| Local runtimes | Ollama, llama.cpp, LM Studio v0 adapters; opt-in 32-token sample | HTTP contracts and timing units tested with controlled responses. No LLM server/model was launched or downloaded automatically. |

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
No real Snapdragon device test has been run as part of local Mac verification.

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

## Automation and Release Gates

- CI runs dependency audit, typecheck, unit/integration tests, browser pixel and
  interaction tests, Android unit/lint/APK build and Windows CPU tests/ARM64 MSI
  packaging. Reports and artifacts are retained on Actions.
- Pages deploys the successful `main` CI artifact; no privileged workflow
  executes a pull request's scripts.
- A stable `vMAJOR.MINOR.PATCH` tag must match the package version and MSI limits.
  Release automation reuses CI, requires all three platform artifacts, generates
  SHA256 checksums and creates a **draft**, not an automatically public release.
- Dependabot checks npm, GitHub Actions, Gradle and NuGet weekly.
- Before publishing a draft: check APK/MSI install and uninstall, signing and
  license notices, physical-device QNN execution, output verification, and CPU
  comparison. CI success alone does not certify Hexagon acceleration.
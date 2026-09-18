# v1.1.0 - QCS6490 Runtime And Installer Update

## What's New

- Rebuilt Android ARM64, Windows ARM64 and Debian installers with the updated web app.
- Added opt-in QCS6490 Runtime panel support for NPU vision, CPU language/VLM and no-dispatch idle, including image upload.
- Added the Ubuntu gateway, reversible service templates, checked QNN arithmetic and vision evidence, and the complete NPU setup/rollback guide.
- Reconciled installation, measurement, Arduino and release documentation with the current implementation.
- Refreshed all four simulation GIFs and added a real board-gateway recording with reproducible capture tooling and provenance.

The installer versions are `1.1.0` (Debian `1.1.0-1`). The preview signing and
hardware-validation limitations below still apply. The separately deployed board
gateway and its licensed model/QAIRT dependencies are not bundled in these installers.

## Preview Packages

| Asset | Contents and requirements |
| --- | --- |
| `HexagonNPUSimCity-web.zip` | Static WebGL2 visualization; simulation numbers remain illustrative. |
| `HexagonNPUSimCity-arm64-cpu-preview.apk` | Android ARM64 evaluation APK, debug-key-signed and CPU-only by default; not a QNN-enabled distribution. |
| `HexagonNPUSimCity-arm64.msi` | Self-contained Windows ARM64 host with ONNX Runtime QNN; Windows 11, WebView2 and supported Snapdragon drivers are required for HTP. |
| `HexagonNPUSimCity-all.deb` | Architecture-independent static web build and Python >=3.8 launcher; opens `http://127.0.0.1:8770/`. No NPU runtime or LLM is bundled. |

Android QNN builds require a matching ONNX Runtime QNN AAR and licensed HTP
libraries. Windows CPU and QNN samples are explicit actions; QNN rejects CPU
fallback. See the
[native package guide](https://github.com/eoinjordan/HexagonNPUSimCity/blob/main/docs/native.md).

## QCS6490 NPU Support Work

Eoin Jordan's Ubuntu/QCS6490 validation work established QNN HTP execution for a
fixed UINT8 dense matrix graph: 32 executions, 65,536 exact output comparisons,
and accelerator/operator profiling. The CLI source and reviewed evidence are in
the repository; these tools and Qualcomm's SDK are not bundled in the packages.
See the
[full NPU support guide](https://github.com/eoinjordan/HexagonNPUSimCity/blob/v1.1.0/docs/qcs6490-npu.md).

![QCS6490 gateway running NPU vision, CPU language and idle](https://raw.githubusercontent.com/eoinjordan/HexagonNPUSimCity/v1.1.0/docs/media/qcs6490.gif)

The recording shows actual completed requests; its playback speed is not a
performance measurement, and the surrounding city remains illustrative.

The repository also includes a loopback QCS6490 gateway and web-panel support for
MobileNet-v2 image classification on QNN HTP, an explicitly CPU-only language/VLM
worker, and idle with no inference dispatch. Vision output was compared with the
same quantized model on CPU and checked against accelerator/convolution profiles.
The gateway and its model/runtime dependencies need the separate board setup;
installing a preview package does not automatically install or enable them.

This is not an LLM throughput result or certification of the Android/Windows
hosts. The tested GenieX Q4_0 path aborted on Hexagon v68, so no working NPU LLM
replacement is claimed. The simulation remains illustrative.

## Publication Checks

Native workloads are arithmetic smoke tests, not trained-model accuracy
benchmarks or peak NPU measurements. CI does not certify device acceleration.

MSI packages are unsigned unless signed separately before publication. Android
preview signing keys are not stable production update keys. Review licensing,
signing, install/uninstall and target-device results before publishing. The
workflow creates a draft only when the tag has no release yet; an existing
release receives replacement assets without a publication-status change.

`SHA256SUMS` accompanies the packages for integrity checking.

Android reference: https://github.com/edgeimpulse/example-android-inferencing/tree/main/qnn-hardware-acceleration
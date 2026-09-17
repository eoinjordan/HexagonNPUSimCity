# Preview Packages

- Web: standalone static build; simulation numbers remain illustrative.
- Android ARM64 CPU preview: debug-key-signed evaluation APK, not a QNN-enabled distribution. QNN builds require a matching ONNX Runtime QNN AAR and licensed HTP libraries; see the native guide.
- Windows ARM64 MSI: self-contained app with ONNX Runtime QNN; requires Windows 11, WebView2 and a supported Snapdragon device/driver for HTP execution. CPU and QNN samples are explicit actions; QNN rejects CPU fallback.

Native workloads are tiny arithmetic smoke tests with verified expected output,
not trained-model accuracy benchmarks or peak NPU measurements. Hardware execution
requires testing on the target device; CI does not certify Snapdragon acceleration.

MSI packages are unsigned unless signed separately before publication. Android
preview signing keys are not stable production update keys. Review licensing,
signing, install/uninstall and target-device results before publishing this draft.

`SHA256SUMS` accompanies the packages for integrity checking.

Android reference: https://github.com/edgeimpulse/example-android-inferencing/tree/main/qnn-hardware-acceleration
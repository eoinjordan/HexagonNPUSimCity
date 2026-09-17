using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace HexagonNPUSimCity;

public sealed record WorkloadResult(string backend, bool cpuFallbackDisabled, int iterations, double meanMs, bool outputMatches);

public static class Workload
{
    public static byte[] Sample() => Enumerable.Range(0, 64).Select(index => (byte)(124 + index % 8)).ToArray();

    public static void Verify(byte[] output)
    {
        if (!output.SequenceEqual(Sample())) throw new InvalidOperationException("Quantized sample output mismatch");
    }

    public static WorkloadResult Run(string modelPath, string backend)
    {
        if (backend is not ("cpu" or "qnn")) throw new ArgumentException("Unknown backend");
        bool qnn = backend == "qnn";
        if (qnn && (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.Arm64))
            throw new PlatformNotSupportedException("QNN HTP requires native Windows ARM64 on a supported Snapdragon device");
        using var options = new SessionOptions { IntraOpNumThreads = 1 };
        if (qnn)
        {
            if (!OrtEnv.Instance().GetAvailableProviders().Contains("QNNExecutionProvider"))
                throw new InvalidOperationException("QNN execution provider is unavailable");
            string backendPath = Path.Combine(AppContext.BaseDirectory, "QnnHtp.dll");
            if (!File.Exists(backendPath)) throw new FileNotFoundException("QnnHtp.dll is missing from this package");
            options.AddSessionConfigEntry("session.disable_cpu_ep_fallback", "1");
            options.AppendExecutionProvider("QNN", new Dictionary<string, string>
            {
                ["backend_path"] = backendPath,
                ["htp_performance_mode"] = "balanced",
                ["offload_graph_io_quantization"] = "0"
            });
        }
        using var session = new InferenceSession(modelPath, options);
        var input = NamedOnnxValue.CreateFromTensor("input", new DenseTensor<byte>(Sample(), new[] { 1, 64 }));
        double elapsed = 0;
        for (int iteration = 0; iteration < 28; iteration++)
        {
            long started = Stopwatch.GetTimestamp();
            using var output = session.Run(new[] { input });
            double duration = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            Verify(output.Single().AsTensor<byte>().ToArray());
            if (iteration >= 3) elapsed += duration;
        }
        return new WorkloadResult(qnn ? "qnn-htp" : "cpu", qnn, 25, elapsed / 25, true);
    }
}
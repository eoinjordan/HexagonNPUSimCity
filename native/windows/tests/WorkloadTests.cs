using Xunit;

namespace HexagonNPUSimCity.Tests;

public sealed class WorkloadTests
{
    [Fact]
    public void CpuExecutesTheQuantizedModelAndVerifiesEveryOutput()
    {
        var result = Workload.Run(Path.Combine(AppContext.BaseDirectory, "matmul-qdq.onnx"), "cpu");
        Assert.Equal("cpu", result.backend);
        Assert.False(result.cpuFallbackDisabled);
        Assert.True(result.outputMatches);
        Assert.Equal(25, result.iterations);
        Assert.True(double.IsFinite(result.meanMs) && result.meanMs >= 0);
    }

    [Fact]
    public void BadOutputAndUnknownBackendsAreRejected()
    {
        Assert.Throws<InvalidOperationException>(() => Workload.Verify(new byte[64]));
        Assert.Throws<InvalidOperationException>(() => Workload.Verify(new byte[1]));
        Assert.Throws<ArgumentException>(() => Workload.Run("missing.onnx", "unknown"));
    }

    [Fact]
    public void SampleBuffersDoNotShareMutableState()
    {
        byte[] first = Workload.Sample();
        first[0] = 0;
        Assert.Equal(124, Workload.Sample()[0]);
        Assert.Equal(131, Workload.Sample()[7]);
        Workload.Verify(Workload.Sample());
    }

    [Fact]
    public void QnnCannotBeSelectedOnAnUnsupportedHost()
    {
        if (!OperatingSystem.IsWindows() || System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture != System.Runtime.InteropServices.Architecture.Arm64)
            Assert.Throws<PlatformNotSupportedException>(() => Workload.Run("missing.onnx", "qnn"));
    }
}
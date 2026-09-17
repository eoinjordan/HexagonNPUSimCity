using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace HexagonNPUSimCity;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainWindow());
    }
}

internal sealed class MainWindow : Form
{
    private const string Origin = "https://hexagon.simcity.local";
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private bool running;

    public MainWindow()
    {
        Text = "Hexagon NPU SimCity";
        ClientSize = new Size(1280, 800);
        MinimumSize = new Size(390, 600);
        Controls.Add(web);
        Shown += async (_, _) => await Initialize();
    }

    private async Task Initialize()
    {
        try
        {
            string webPath = Path.Combine(AppContext.BaseDirectory, "web");
            if (!File.Exists(Path.Combine(webPath, "index.html"))) throw new FileNotFoundException("Bundled web assets are missing");
            string dataPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HexagonNPUSimCity", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: dataPath);
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("hexagon.simcity.local", webPath, CoreWebView2HostResourceAccessKind.DenyCors);
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
            web.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
            web.CoreWebView2.NavigationStarting += (_, args) => args.Cancel = !Trusted(args.Uri);
            web.CoreWebView2.NewWindowRequested += (_, args) => args.Handled = true;
            web.CoreWebView2.WebMessageReceived += Receive;
            web.CoreWebView2.Navigate(Origin + "/index.html");
        }
        catch (Exception error)
        {
            MessageBox.Show(this, error.Message + "\nWindows 11 and the Microsoft Edge WebView2 Runtime are required.", Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static bool Trusted(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.GetLeftPart(UriPartial.Authority) == Origin;

    private async void Receive(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!Trusted(args.Source)) return;
        string? id = null;
        bool claimed = false;
        try
        {
            if (args.WebMessageAsJson.Length > 1024) return;
            using var request = JsonDocument.Parse(args.WebMessageAsJson);
            var root = request.RootElement;
            id = root.GetProperty("id").GetString();
            string? command = root.GetProperty("command").GetString();
            string? backend = root.GetProperty("backend").GetString();
            if (id is null || id.Length > 64 || command != "benchmark" || backend is not ("cpu" or "qnn")) return;
            if (running) throw new InvalidOperationException("A native workload is already running");
            running = claimed = true;
            var result = await Task.Run(() => Workload.Run(Path.Combine(AppContext.BaseDirectory, "models", "matmul-qdq.onnx"), backend));
            Reply(new { id, result.backend, result.cpuFallbackDisabled, result.iterations, result.meanMs, result.outputMatches });
        }
        catch (Exception error)
        {
            if (id is not null) Reply(new { id, error = error.Message });
        }
        finally { if (claimed) running = false; }
    }

    private void Reply(object message)
    {
        if (!IsDisposed && !web.IsDisposed) web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) web.Dispose();
        base.Dispose(disposing);
    }
}
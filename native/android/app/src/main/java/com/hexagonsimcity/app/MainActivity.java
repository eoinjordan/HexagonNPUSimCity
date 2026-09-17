package com.hexagonsimcity.app;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private WebView webView;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean running = new AtomicBoolean();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView error = new TextView(this);
            error.setText("Update Android System WebView to run Hexagon NPU SimCity.");
            setContentView(error);
            return;
        }
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(ORIGIN + "/assets/web/");
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse result = assets.shouldInterceptRequest(request.getUrl());
                return result != null ? result : new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        WebViewCompat.addWebMessageListener(webView, "HexagonNative", Collections.singleton(ORIGIN), (view, message, sourceOrigin, isMainFrame, reply) -> {
            if (!isMainFrame || !sourceOrigin.toString().equals(ORIGIN)) return;
            try {
                JSONObject request = new JSONObject(message.getData());
                String id = request.getString("id");
                if (id.length() > 64 || !request.optString("command").equals("benchmark")) return;
                String backend = request.getString("backend");
                if (!backend.equals("cpu") && !backend.equals("qnn")) return;
                if (!running.compareAndSet(false, true)) {
                    reply.postMessage(new JSONObject().put("id", id).put("error", "A native workload is already running").toString());
                    return;
                }
                worker.execute(() -> {
                    JSONObject result;
                    try { result = Workload.run(this, backend); }
                    catch (Exception | LinkageError error) {
                        result = new JSONObject();
                        try { result.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()); }
                        catch (Exception ignored) { }
                    }
                    try { result.put("id", id); } catch (Exception ignored) { }
                    String json = result.toString();
                    running.set(false);
                    runOnUiThread(() -> { if (!isDestroyed()) reply.postMessage(json); });
                });
            } catch (Exception ignored) { }
        });
        setContentView(webView);
        webView.loadUrl(ORIGIN + "/assets/web/index.html");
    }

    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        if (webView != null) {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.removeWebMessageListener(webView, "HexagonNative");
            webView.destroy();
        }
        super.onDestroy();
    }
}
package com.hexagonsimcity.app;

import android.content.Context;
import android.os.SystemClock;
import android.system.Os;
import ai.onnxruntime.OnnxJavaType;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtProvider;
import ai.onnxruntime.OrtSession;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

public final class Workload {
    static byte[] sample() {
        byte[] values = new byte[64];
        for (int index = 0; index < values.length; index++) values[index] = (byte) (124 + index % 8);
        return values;
    }

    static void verify(byte[] output) {
        if (!Arrays.equals(sample(), output)) throw new IllegalStateException("Quantized sample output mismatch");
    }

    static JSONObject run(Context context, String backend) throws Exception {
        if (!backend.equals("cpu") && !backend.equals("qnn")) throw new IllegalArgumentException("Unknown backend");
        boolean qnn = backend.equals("qnn");
        OrtEnvironment environment = OrtEnvironment.getEnvironment();
        if (qnn && !OrtEnvironment.getAvailableProviders().contains(OrtProvider.QNN)) {
            throw new IllegalStateException("QNN unavailable: install a QNN-enabled build with matching HTP libraries");
        }
        byte[] model;
        try (InputStream input = context.getAssets().open("models/matmul-qdq.onnx"); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            model = bytes.toByteArray();
        }
        try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
            options.setIntraOpNumThreads(1);
            if (qnn) {
                String directory = context.getApplicationInfo().nativeLibraryDir;
                File library = new File(directory, "libQnnHtp.so");
                if (!library.isFile()) throw new IllegalStateException("Matching libQnnHtp.so is missing");
                Os.setenv("ADSP_LIBRARY_PATH", directory + ";/vendor/lib/rfsa/adsp;/vendor/dsp/cdsp;/system/lib/rfsa/adsp", true);
                options.addConfigEntry("session.disable_cpu_ep_fallback", "1");
                Map<String, String> settings = new HashMap<>();
                settings.put("backend_path", library.getAbsolutePath());
                settings.put("htp_performance_mode", "balanced");
                settings.put("offload_graph_io_quantization", "0");
                options.addQnn(settings);
            }
            try (OrtSession session = environment.createSession(model, options)) {
                ByteBuffer input = ByteBuffer.allocateDirect(64);
                input.put(sample()).rewind();
                try (OnnxTensor tensor = OnnxTensor.createTensor(environment, input, new long[]{1, 64}, OnnxJavaType.UINT8)) {
                    long duration = 0;
                    for (int iteration = 0; iteration < 28; iteration++) {
                        long start = SystemClock.elapsedRealtimeNanos();
                        try (OrtSession.Result output = session.run(Collections.singletonMap("input", tensor))) {
                            long elapsed = SystemClock.elapsedRealtimeNanos() - start;
                            ByteBuffer result = ((OnnxTensor) output.get(0)).getByteBuffer();
                            byte[] values = new byte[result.remaining()];
                            result.get(values);
                            verify(values);
                            if (iteration >= 3) duration += elapsed;
                        }
                    }
                    return new JSONObject().put("backend", qnn ? "qnn-htp" : "cpu")
                        .put("cpuFallbackDisabled", qnn).put("iterations", 25)
                        .put("meanMs", duration / 25.0 / 1e6).put("outputMatches", true);
                }
            }
        }
    }
}